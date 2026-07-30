import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * MinIO Watch Surface 的物件儲存 port（seam）。兩個 adapter：本檔的真 S3 adapter
 * （production）與測試的 in-memory fake（tests/helpers/fakeObjectStore.ts）——兩個
 * adapter 才構成真 seam，watcher/browse 測試不再 vi.mock 模組。
 * PR2 起 folder browse／head／probe 也走本 port；舊 minioClient.ts free functions 退場。
 */
export interface ObjectStorePort {
  /** 列出 prefix 下全部物件（分頁在 adapter 內收斂；etag 保留原始值，含外層引號）。 */
  listObjects(prefix: string): Promise<Array<{ key: string; etag: string }>>;
  /**
   * 資料夾語意 list（Delimiter）：commonPrefixes=資料夾、contents=當層直屬檔。
   * 單層仍處理 IsTruncated（分頁在 adapter 內收斂，超 1000 子前綴/物件不截斷）。
   */
  listFolder(prefix: string, delimiter: string): Promise<{
    commonPrefixes: string[];
    contents: Array<{ key: string; etag: string }>;
  }>;
  /**
   * 該 prefix（遞迴，不帶 Delimiter）下是否含指定 suffix 的葉物件；命中即早停。
   * 失敗契約（誠實鐵律，勿改）：send() 拋例外（憑證錯 / 網路斷 / MinIO 5xx）必須
   * **向上 propagate**，由呼叫端收斂成 502。絕不可 try/catch 後回 false——那等於把
   * 「查不到」謊報成「無 source IFC」。寧可整頁誠實失敗 + 前端重試，不部分降級捏造 badge。
   */
  hasKeyWithSuffix(prefix: string, suffix: string): Promise<boolean>;
  /**
   * 取單一物件的 etag（去引號）。命中 → etag 字串（可能為空字串）；物件不存在
   * （404 / NotFound / NoSuchKey）→ null。其他上游錯誤（憑證 / 連線 / 5xx）一律
   * **向上 propagate**（誠實鐵律：不把上游失敗謊報成「物件不存在」）。
   */
  headEtag(key: string): Promise<string | null>;
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
    async listFolder(prefix: string, delimiter: string) {
      const commonPrefixes: string[] = [];
      const contents: Array<{ key: string; etag: string }> = [];
      let token: string | undefined;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({
            Bucket: opts.bucket,
            Prefix: prefix || undefined,
            Delimiter: delimiter || undefined,
            ContinuationToken: token,
          }),
        );
        for (const cp of resp.CommonPrefixes ?? []) {
          if (cp.Prefix) commonPrefixes.push(cp.Prefix);
        }
        for (const obj of resp.Contents ?? []) {
          if (obj.Key) contents.push({ key: obj.Key, etag: obj.ETag ?? "" });
        }
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (token);
      return { commonPrefixes, contents };
    },
    async hasKeyWithSuffix(prefix: string, suffix: string): Promise<boolean> {
      // 命中即早停；例外 propagate（見 port 契約：不得吞錯回 false）。
      let token: string | undefined;
      do {
        const resp = await client.send(
          new ListObjectsV2Command({ Bucket: opts.bucket, Prefix: prefix, ContinuationToken: token }),
        );
        if ((resp.Contents ?? []).some((o) => o.Key?.endsWith(suffix))) return true;
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (token);
      return false;
    },
    async headEtag(key: string): Promise<string | null> {
      try {
        const resp = await client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key }));
        return (resp.ETag ?? "").replace(/^"+|"+$/g, "");
      } catch (err) {
        // 只把「物件不存在」收斂成 null；其餘錯誤 rethrow 讓呼叫端回 502（不誤判為 not_found）。
        const name = (err as { name?: string })?.name ?? "";
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (name === "NotFound" || name === "NoSuchKey" || status === 404) return null;
        throw err;
      }
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
