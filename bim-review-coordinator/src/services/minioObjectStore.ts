import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * MinIO Watch Surface 的物件儲存 port（seam）。兩個 adapter：本檔的真 S3 adapter
 * （production）與測試的 in-memory fake（tests/helpers/fakeObjectStore.ts）——兩個
 * adapter 才構成真 seam，watcher 測試不再 vi.mock 整個模組。
 *
 * PR2 預告：folder browse（listFolder/headEtag）併入本 port 後，minioClient.ts 的
 * free functions 與其呼叫端各自持有的 S3Client 生命週期一併退場。
 */
export interface ObjectStorePort {
  /** 列出 prefix 下全部物件（分頁在 adapter 內收斂；etag 保留原始值，含外層引號）。 */
  listObjects(prefix: string): Promise<Array<{ key: string; etag: string }>>;
  /** 簽出物件的 presigned GET URL。 */
  presign(key: string, expiresInSeconds: number): Promise<string>;
  /** 釋放底層連線資源。可為 async（fake 以延遲 destroy 撐開 busy 鎖測試窗口）。 */
  destroy(): void | Promise<void>;
}

export interface S3ObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function createS3ObjectStore(opts: S3ObjectStoreOptions): ObjectStorePort {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true, // MinIO 必要（path-style addressing）
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });
  return {
    async listObjects(prefix: string): Promise<Array<{ key: string; etag: string }>> {
      const out: Array<{ key: string; etag: string }> = [];
      let continuationToken: string | undefined;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({
            Bucket: opts.bucket,
            Prefix: prefix || undefined,
            ContinuationToken: continuationToken,
          }),
        );
        for (const obj of resp.Contents ?? []) {
          if (obj.Key) out.push({ key: obj.Key, etag: obj.ETag ?? "" });
        }
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (continuationToken);
      return out;
    },
    presign(key: string, expiresInSeconds: number): Promise<string> {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },
    destroy(): void {
      client.destroy();
    },
  };
}
