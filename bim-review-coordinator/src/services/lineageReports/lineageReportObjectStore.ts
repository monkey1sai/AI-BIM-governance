import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";

/**
 * 轉檔對齊報表（legacy MinIO watch 流程）專用的物件儲存 port。
 *
 * 與 watcher 的 ObjectStorePort 分開：watcher 只讀；本 port 另外能讀 companion
 * `schedule.csv`（有上限），並只能在 `<IFC 資料夾>/lineage-reports/<轉檔編號>/`
 * 以 conditional create 寫入兩份報表。帳號沒有寫入權限時回 `denied`，不當成錯誤。
 */
export interface LineageReportObjectPort {
  /** 物件不存在回 null；超過 maxBytes 拋 LineageObjectTooLargeError；其他上游錯誤往上拋。 */
  getObjectBytes(key: string, maxBytes: number): Promise<{ bytes: Buffer; etag: string } | null>;
  /** 已存在回 exists（絕不覆寫）；沒有權限回 denied；其他上游錯誤往上拋。 */
  putObjectIfAbsent(key: string, body: Buffer, contentType: string): Promise<"created" | "exists" | "denied">;
  destroy(): void;
}

export class LineageObjectTooLargeError extends Error {
  constructor(readonly key: string, readonly maxBytes: number) {
    super(`object exceeds ${maxBytes} bytes`);
    this.name = "LineageObjectTooLargeError";
  }
}

export class LineageReportWriteScopeError extends Error {
  constructor(readonly key: string) {
    super("object key is outside the lineage report write scope");
    this.name = "LineageReportWriteScopeError";
  }
}

const REPORT_KEY_PATTERN =
  /^(?:[^/]+\/)*lineage-reports\/[A-Za-z0-9_-]{1,128}\/alignment_report\.(?:json|csv)$/;

/** 寫入 carve-out：只允許 `.../lineage-reports/<轉檔編號>/alignment_report.{json,csv}`。 */
export function assertLineageReportObjectKey(key: string): void {
  if (!REPORT_KEY_PATTERN.test(key) || key.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new LineageReportWriteScopeError(key);
  }
}

function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function errorName(err: unknown): string {
  return (err as { name?: string })?.name ?? "";
}

const isNotFound = (err: unknown): boolean =>
  ["NotFound", "NoSuchKey"].includes(errorName(err)) || httpStatus(err) === 404;
const isPreconditionFailed = (err: unknown): boolean =>
  errorName(err) === "PreconditionFailed" || httpStatus(err) === 412;
const isAccessDenied = (err: unknown): boolean =>
  ["AccessDenied", "Forbidden"].includes(errorName(err)) || httpStatus(err) === 403;

const stripQuotes = (etag: string | undefined): string => (etag ?? "").replace(/^"+|"+$/g, "");

export interface S3LineageReportObjectStoreOptions {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export function createS3LineageReportObjectStore(opts: S3LineageReportObjectStoreOptions): LineageReportObjectPort {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });
  return {
    async getObjectBytes(key, maxBytes) {
      let resp;
      try {
        resp = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const body = resp.Body as Readable | undefined;
      if (!body) return { bytes: Buffer.alloc(0), etag: stripQuotes(resp.ETag) };
      if (resp.ContentLength !== undefined && resp.ContentLength > maxBytes) {
        body.destroy();
        throw new LineageObjectTooLargeError(key, maxBytes);
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        total += buffer.length;
        if (total > maxBytes) {
          body.destroy();
          throw new LineageObjectTooLargeError(key, maxBytes);
        }
        chunks.push(buffer);
      }
      return { bytes: Buffer.concat(chunks, total), etag: stripQuotes(resp.ETag) };
    },

    async putObjectIfAbsent(key, body, contentType) {
      assertLineageReportObjectKey(key);
      // HEAD 先擋掉「已存在」與「連讀都不行」；真正的不覆寫保證仍是下方 If-None-Match。
      try {
        await client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key }));
        return "exists";
      } catch (err) {
        if (isAccessDenied(err)) return "denied";
        if (!isNotFound(err)) throw err;
      }
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: opts.bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
            IfNoneMatch: "*",
          }),
        );
        return "created";
      } catch (err) {
        if (isPreconditionFailed(err)) return "exists";
        if (isAccessDenied(err)) return "denied";
        throw err;
      }
    },

    destroy() {
      client.destroy();
    },
  };
}
