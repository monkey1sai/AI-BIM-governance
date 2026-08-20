import { createHash } from "node:crypto";
import { S3Client, ListObjectsV2Command, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * `getObjectBytes` 的預設位元組上限（32 MiB）。用途界定（勿擴權）：governed lineage 的
 * **source manifest / schedule 這類小型描述檔**才整檔進記憶體；IFC／RVT／USDC 等模型
 * 二進位一律不得走本路徑，要摘要請用 `streamSha256`（串流、不整檔載入）。
 */
export const DEFAULT_GET_OBJECT_MAX_BYTES = 32 * 1024 * 1024;

/** `headObjectVersioned` 的回傳：單一（可指定版本的）物件中繼資料。 */
export interface ObjectVersionHead {
  /** etag（去引號，與 headEtag 同形；上游未回 ETag → 空字串）。 */
  etag: string;
  /** Content-Length（bytes）；上游未提供時為 null——不以 0 冒充「空物件」。 */
  sizeBytes: number | null;
  /** x-amz-version-id；bucket 未開版本控管或上游未回傳時為 null（不捏造版本）。 */
  versionId: string | null;
}

/** `streamSha256` 的回傳：串流實測的摘要與位元組數。 */
export interface ObjectStreamDigest {
  /** 小寫 hex SHA-256。 */
  sha256: string;
  /** 實際讀進 hash 的位元組數（實測值，不是轉述 Content-Length）。 */
  sizeBytes: number;
}

/**
 * `getObjectBytes` 超出位元組上限。上限是硬邊界：超過即失敗，不截斷、不回半截內容
 *（截斷回傳等於把「太大讀不得」謊報成「這就是全部內容」）。
 */
export class ObjectTooLargeError extends Error {
  readonly key: string;
  readonly maxBytes: number;
  /** 已知大小；只知道「至少這麼多」時為已讀取位元組數（下界）。 */
  readonly observedBytes: number;
  constructor(key: string, maxBytes: number, observedBytes: number) {
    super(`object ${key} exceeds maxBytes ${maxBytes} (observed ${observedBytes})`);
    this.name = "ObjectTooLargeError";
    this.key = key;
    this.maxBytes = maxBytes;
    this.observedBytes = observedBytes;
  }
}

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
  /**
   * 帶版本的 head：回 etag（去引號）／size／versionId。`versionId` 省略 → 讀當前版本。
   * 物件或指定版本不存在（404 / NotFound / NoSuchKey / NoSuchVersion）→ null；其他上游
   * 錯誤（憑證 / 連線 / 5xx）一律 **向上 propagate**（誠實鐵律：不把上游失敗謊報成
   * 「物件不存在」，那會讓 lineage 把 upstream outage 誤判成 artifact_not_found）。
   *
   * L3b 加性擴充（governed lineage source manifest discovery）；既有 6 方法語意不動。
   */
  headObjectVersioned(key: string, versionId?: string): Promise<ObjectVersionHead | null>;
  /**
   * 整檔讀進記憶體。超過 `maxBytes`（預設 `DEFAULT_GET_OBJECT_MAX_BYTES`）→ 拋
   * `ObjectTooLargeError`，且是**讀取途中就中止**（不先吃滿再事後檢查）。用途只限小型
   * manifest／schedule 描述檔；模型二進位請走 `streamSha256`。
   *
   * 失敗契約：**一律不吞**——物件不存在也是 throw。本方法回傳型別不含 null，用空
   * Buffer／null 冒充「沒有」等於謊報內容；存在性請先問 `headObjectVersioned`。
   */
  getObjectBytes(key: string, versionId?: string, maxBytes?: number): Promise<Buffer>;
  /**
   * 串流計算 SHA-256 與實際位元組數。**不得**整檔載入記憶體（chunk 餵進 hash 即丟），
   * 因此 GB 級 IFC／RVT 也安全。失敗契約同 `getObjectBytes`：全部向上 propagate。
   */
  streamSha256(key: string, versionId?: string): Promise<ObjectStreamDigest>;
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

/**
 * 「物件（或該版本）不存在」的判定。刻意與 `headEtag` 內嵌的同義判斷分開寫：既有方法
 * 逐字不動（本 PR 為加性擴充），且本判定多收一個版本專屬的 NoSuchVersion。
 * 只有這一類錯誤能收斂成 null；其餘一律 rethrow。
 */
function isObjectAbsentError(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || name === "NoSuchVersion" || status === 404;
}

/**
 * 逐 chunk 走訪 GetObject 的 Body。Node runtime 下 SDK 回 Readable（async iterable）；
 * 為保險也支援 web ReadableStream（getReader）。結構化型別判斷，不依賴 DOM lib。
 * 任何時刻只 yield 一個 chunk——`streamSha256` 的「不整檔載入記憶體」由此保證。
 */
async function* iterateBodyChunks(body: unknown, key: string): AsyncGenerator<Uint8Array> {
  if (body === undefined || body === null) {
    throw new Error(`GetObject returned no body for ${key}`);
  }
  const iterable = body as AsyncIterable<Uint8Array | string>;
  if (typeof iterable[Symbol.asyncIterator] === "function") {
    for await (const chunk of iterable) {
      yield typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    }
    return;
  }
  const web = body as { getReader?: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } };
  if (typeof web.getReader === "function") {
    const reader = web.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
    return;
  }
  throw new Error(`GetObject body for ${key} is not a readable stream`);
}

/**
 * 提早中止未讀完的 body（超過上限時釋放 socket）。此處的 catch 僅涵蓋「中止動作本身
 * 失敗」，不得用來吞掉呼叫端正在拋的真錯誤——呼叫端的 throw 在本函式之後照舊發生。
 */
function abortBodyStream(body: unknown): void {
  const s = body as { destroy?: () => void; cancel?: () => Promise<void> };
  try {
    if (typeof s?.destroy === "function") {
      s.destroy();
    } else if (typeof s?.cancel === "function") {
      void s.cancel().catch(() => undefined);
    }
  } catch {
    // 中止失敗不改寫上層錯誤（上層已在拋 ObjectTooLargeError／原始 SDK 錯誤）。
  }
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
    async headObjectVersioned(key: string, versionId?: string): Promise<ObjectVersionHead | null> {
      try {
        const resp = await client.send(
          new HeadObjectCommand({ Bucket: opts.bucket, Key: key, VersionId: versionId }),
        );
        // S3／MinIO 對未開版本控管的 bucket 回字面 "null"；那不是可引用的版本 → 收成 null。
        const rawVersion = resp.VersionId;
        return {
          etag: (resp.ETag ?? "").replace(/^"+|"+$/g, ""),
          sizeBytes: typeof resp.ContentLength === "number" ? resp.ContentLength : null,
          versionId: rawVersion && rawVersion !== "null" ? rawVersion : null,
        };
      } catch (err) {
        // 只把「物件／版本不存在」收斂成 null；憑證錯與 5xx 一律 rethrow（見 port 契約）。
        if (isObjectAbsentError(err)) return null;
        throw err;
      }
    },
    async getObjectBytes(key: string, versionId?: string, maxBytes?: number): Promise<Buffer> {
      const limit = maxBytes ?? DEFAULT_GET_OBJECT_MAX_BYTES;
      // 這裡刻意不 try/catch：404／憑證錯／5xx 全部向上 propagate（回傳型別不含 null）。
      const resp = await client.send(
        new GetObjectCommand({ Bucket: opts.bucket, Key: key, VersionId: versionId }),
      );
      // 先用 Content-Length 早退，省下整份下載；header 缺漏或說謊時，下方逐 chunk 累計才是硬邊界。
      const declared = typeof resp.ContentLength === "number" ? resp.ContentLength : null;
      if (declared !== null && declared > limit) {
        abortBodyStream(resp.Body);
        throw new ObjectTooLargeError(key, limit, declared);
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of iterateBodyChunks(resp.Body, key)) {
        total += chunk.byteLength;
        if (total > limit) {
          abortBodyStream(resp.Body);
          throw new ObjectTooLargeError(key, limit, total);
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, total);
    },
    async streamSha256(key: string, versionId?: string): Promise<ObjectStreamDigest> {
      const resp = await client.send(
        new GetObjectCommand({ Bucket: opts.bucket, Key: key, VersionId: versionId }),
      );
      const hash = createHash("sha256");
      let sizeBytes = 0;
      // 逐 chunk 餵入後即丟；任何時刻只持有單一 chunk。
      // 勿改成「先 concat／getObjectBytes 再 hash」——那會把 GB 級模型整份吃進記憶體，
      // 並讓本方法無謂地繼承 getObjectBytes 的位元組上限。
      for await (const chunk of iterateBodyChunks(resp.Body, key)) {
        hash.update(chunk);
        sizeBytes += chunk.byteLength;
      }
      return { sha256: hash.digest("hex"), sizeBytes };
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
