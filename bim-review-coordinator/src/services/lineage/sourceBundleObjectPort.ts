// bim-review-coordinator/src/services/lineage/sourceBundleObjectPort.ts
//
// Governed source-bundle 專用的 MinIO object port（**新 port，不動既有
// `ObjectStorePort`**）。
//
// 為什麼另開一個 port 而不是擴充 `services/minioObjectStore.ts`：
//   1. 既有 port 綁單一 config bucket，governed locator 卻自帶 authority/bucket；
//   2. 既有 port 沒有 body stream（算不了 SHA-256）、沒有 versionId、`headEtag`
//      不回 size；
//   3. 往 `ObjectStorePort` 加必填成員會逼 `tests/helpers/fakeObjectStore.ts` 與
//      `minioWatchSurface` 同步改（GitNexus impact LOW/5，但那是「不抑制 legacy」
//      規則下不必要的變更面）。新 port 讓 legacy watcher 面零改動。
//
// 誠實鐵律沿用既有 port 的契約：只有「物件不存在」收斂成 null，其餘上游錯誤
// （憑證／連線／5xx）一律向上 propagate，絕不謊報成 not_found。
//
// D-3（coordinator 裁決）：authority／bucket 走 **fail-closed allowlist**。
// 不在清單內的 locator 一律拒絕，不做任何連線。
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { isRefParseFailure, parseMinioRef, type ParsedRef } from "./minioLocator.js";

/** HEAD 一個指定 object version 的觀測結果。 */
export interface VersionedObjectHead {
  etag: string;
  sizeBytes: number;
  versionId: string;
}

/** `listObjectsUnder` 回傳的單筆觀測（只含 current version）。 */
export interface VersionedObjectSummary {
  /** 完整 governed locator（`minio://authority/bucket/key?versionId=...`）。 */
  ref: string;
  authority: string;
  bucket: string;
  objectKey: string;
  versionId: string;
  etag: string;
  sizeBytes: number;
}

export type PutIfAbsentOutcome =
  | { outcome: "created"; versionId: string }
  | { outcome: "conflict_existing_manifest" };

/**
 * Governed source-bundle object port。
 *
 * 全部方法都以 `ParsedRef`（authority/bucket/objectKey/versionId）為輸入，
 * 因此呼叫端不可能繞過 locator 解析直接拼字串 key。
 */
export interface SourceBundleObjectPort {
  /** 依 authority+bucket allowlist 解析後 HEAD 指定 version；不存在回 null，其餘錯誤 propagate。 */
  headVersioned(ref: ParsedRef): Promise<VersionedObjectHead | null>;
  /** streaming 讀 body 並回傳 sha256（不把整份載入記憶體）。 */
  sha256Versioned(ref: ParsedRef): Promise<string>;
  /** 只給 manifest.json（小檔）；超過 `maxBytes` 一律 fail-closed 拋錯，不靜默截斷。 */
  getBytesVersioned(ref: ParsedRef, maxBytes: number): Promise<Buffer>;
  /**
   * legacy enrollment 用：conditional create（`If-None-Match: *`）。
   *
   * **D-4（coordinator 裁決，preview-only）**：真 S3 adapter 目前**不實作**寫入，
   * 一律拋 `SourceBundleWriteNotPermittedError`。coordinator 至今只讀 MinIO，
   * 新增寫入權責需要 owner 對 `bim-review-coordinator/AGENTS.md` 的明示 carve-out。
   * 介面成員保留，讓 carve-out 落地時是 adapter 內的單點變更。
   */
  putIfAbsent(
    ref: Omit<ParsedRef, "versionId">,
    body: Buffer,
    contentType: string,
  ): Promise<PutIfAbsentOutcome>;
  /**
   * reconciliation discovery：回傳 `prefix` 之下**直接含 `manifest.json`** 的
   * version prefix（含結尾 `/`），排序後去重。
   */
  listVersionPrefixes(prefix: string): Promise<string[]>;
  /** 列出 `prefix` 之下全部 object 的 current version（legacy preview 的唯讀觀測面）。 */
  listObjectsUnder(prefix: string): Promise<VersionedObjectSummary[]>;
  /** 釋放底層連線資源。 */
  destroy(): void | Promise<void>;
}

/** authority／bucket 不在 allowlist（fail-closed，D-3）。 */
export class SourceBundleAccessDeniedError extends Error {
  readonly code = "source_bundle_locator_not_allowlisted";

  constructor(
    readonly authority: string,
    readonly bucket: string,
    detail: string,
  ) {
    super(detail);
    this.name = "SourceBundleAccessDeniedError";
  }
}

/** coordinator 尚未取得 MinIO 寫入 carve-out（D-4，preview-only）。 */
export class SourceBundleWriteNotPermittedError extends Error {
  readonly code = "source_bundle_write_awaiting_owner_carve_out";
  readonly httpStatus = 501;

  constructor(detail = "coordinator MinIO write is awaiting owner carve-out") {
    super(detail);
    this.name = "SourceBundleWriteNotPermittedError";
  }
}

/** `getBytesVersioned` 超過 `maxBytes`：fail-closed，不截斷。 */
export class SourceBundleObjectTooLargeError extends Error {
  readonly code = "source_bundle_object_too_large";

  constructor(
    readonly objectKey: string,
    readonly maxBytes: number,
  ) {
    super(`object ${objectKey} exceeds the ${maxBytes} byte read limit`);
    this.name = "SourceBundleObjectTooLargeError";
  }
}

/** governed prefix 字串格式錯誤（必須是 authority/bucket 具名的 `minio://` 前綴）。 */
export class SourceBundlePrefixError extends Error {
  readonly code = "source_bundle_prefix_malformed";

  constructor(detail: string) {
    super(detail);
    this.name = "SourceBundlePrefixError";
  }
}

export interface SourceBundleAllowlist {
  allowedAuthorities: readonly string[];
  allowedBuckets: readonly string[];
}

/**
 * fail-closed allowlist gate（D-3）。
 *
 * 空清單代表「什麼都不允許」而不是「全部允許」——這是刻意的：一個忘了設定
 * allowlist 的部署必須完全打不開 governed 讀取面，而不是靜默變成全開。
 */
export function assertRefAllowed(
  ref: Pick<ParsedRef, "authority" | "bucket">,
  allow: SourceBundleAllowlist,
): void {
  if (!allow.allowedAuthorities.includes(ref.authority)) {
    throw new SourceBundleAccessDeniedError(
      ref.authority,
      ref.bucket,
      `MinIO authority ${ref.authority} is not in the governed authority allowlist`,
    );
  }
  if (!allow.allowedBuckets.includes(ref.bucket)) {
    throw new SourceBundleAccessDeniedError(
      ref.authority,
      ref.bucket,
      `MinIO bucket ${ref.bucket} is not in the governed bucket allowlist`,
    );
  }
}

export interface ParsedGovernedPrefix {
  authority: string;
  bucket: string;
  keyPrefix: string;
}

const PREFIX_PATTERN = /^minio:\/\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:\/([^?#\s]*))?$/;

/**
 * 解析 discovery prefix。
 *
 * 形狀刻意與 locator 同族（`minio://<authority>/<bucket>/<keyPrefix>`），只是不帶
 * `?versionId=`。裸 key prefix 一律拒絕：port 不綁單一 bucket，沒有 authority／bucket
 * 就無從判 allowlist，這裡放行等於把 D-3 的 fail-closed 開一個洞。
 */
export function parseGovernedPrefix(prefix: string): ParsedGovernedPrefix {
  if (typeof prefix !== "string" || prefix.includes("\n") || prefix.includes("\r")) {
    throw new SourceBundlePrefixError("governed prefix must be a single-line string");
  }
  const matched = PREFIX_PATTERN.exec(prefix);
  if (!matched) {
    throw new SourceBundlePrefixError(
      "governed prefix must look like minio://<authority>/<bucket>/<keyPrefix>",
    );
  }
  return { authority: matched[1], bucket: matched[2], keyPrefix: matched[3] ?? "" };
}

/** 由分量組回 governed locator 字串。 */
export function buildMinioRef(ref: ParsedRef): string {
  return `minio://${ref.authority}/${ref.bucket}/${ref.objectKey}?versionId=${ref.versionId}`;
}

/** `objectKey` 之上的 prefix（含結尾 `/`）；沒有 `/` 時回空字串。 */
function containingPrefix(objectKey: string): string {
  const index = objectKey.lastIndexOf("/");
  return index < 0 ? "" : objectKey.slice(0, index + 1);
}

/** 從 `listObjectsUnder` 的結果導出含 `manifest.json` 的 version prefix。 */
export function versionPrefixesFromObjects(
  objects: readonly VersionedObjectSummary[],
): string[] {
  const prefixes = new Set<string>();
  for (const object of objects) {
    if (object.objectKey.endsWith("/manifest.json")) {
      prefixes.add(
        `minio://${object.authority}/${object.bucket}/${containingPrefix(object.objectKey)}`,
      );
    }
  }
  return [...prefixes].sort();
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return (
    name === "NotFound" ||
    name === "NoSuchKey" ||
    name === "NoSuchVersion" ||
    status === 404
  );
}

function stripEtagQuotes(etag: string | undefined): string {
  return (etag ?? "").replace(/^"+|"+$/g, "");
}

export interface S3SourceBundleObjectPortOptions {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  allowedAuthorities: string[];
  allowedBuckets: string[];
}

/**
 * 真 MinIO adapter。
 *
 * 與 `createS3ObjectStore` 同一組 S3Client 設定（`forcePathStyle: true` 是 MinIO 必要），
 * 但**不**綁單一 bucket：bucket 由 locator 決定，邊界由 allowlist 守。
 */
export function createS3SourceBundleObjectPort(
  opts: S3SourceBundleObjectPortOptions,
): SourceBundleObjectPort {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true, // MinIO 必要（path-style addressing）
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });
  const allow: SourceBundleAllowlist = {
    allowedAuthorities: opts.allowedAuthorities,
    allowedBuckets: opts.allowedBuckets,
  };

  async function openBody(ref: ParsedRef): Promise<Readable> {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.objectKey, VersionId: ref.versionId }),
    );
    const body = resp.Body as unknown as Readable | undefined;
    if (!body) {
      throw new Error(`GetObject returned no body for ${ref.objectKey}`);
    }
    return body;
  }

  const port: SourceBundleObjectPort = {
    async headVersioned(ref: ParsedRef): Promise<VersionedObjectHead | null> {
      assertRefAllowed(ref, allow);
      try {
        const resp = await client.send(
          new HeadObjectCommand({
            Bucket: ref.bucket,
            Key: ref.objectKey,
            VersionId: ref.versionId,
          }),
        );
        return {
          etag: stripEtagQuotes(resp.ETag),
          sizeBytes: resp.ContentLength ?? 0,
          versionId: resp.VersionId ?? ref.versionId,
        };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async sha256Versioned(ref: ParsedRef): Promise<string> {
      assertRefAllowed(ref, allow);
      const body = await openBody(ref);
      const hash = crypto.createHash("sha256");
      // streaming：整份 184 MB 的 RVT 不會進記憶體，只有 chunk 逐段餵給 hash。
      for await (const chunk of body) {
        hash.update(chunk as Buffer);
      }
      return hash.digest("hex");
    },

    async getBytesVersioned(ref: ParsedRef, maxBytes: number): Promise<Buffer> {
      assertRefAllowed(ref, allow);
      const body = await openBody(ref);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of body) {
        const buffer = chunk as Buffer;
        total += buffer.length;
        if (total > maxBytes) {
          body.destroy();
          throw new SourceBundleObjectTooLargeError(ref.objectKey, maxBytes);
        }
        chunks.push(buffer);
      }
      return Buffer.concat(chunks);
    },

    async putIfAbsent(): Promise<PutIfAbsentOutcome> {
      // D-4：preview-only。真寫入等 owner carve-out。
      throw new SourceBundleWriteNotPermittedError();
    },

    async listVersionPrefixes(prefix: string): Promise<string[]> {
      return versionPrefixesFromObjects(await port.listObjectsUnder(prefix));
    },

    async listObjectsUnder(prefix: string): Promise<VersionedObjectSummary[]> {
      const parsed = parseGovernedPrefix(prefix);
      assertRefAllowed(parsed, allow);
      const out: VersionedObjectSummary[] = [];
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      do {
        // ListObjectVersions（不是 ListObjectsV2）：governed 面需要 VersionId，
        // 而 ListObjectsV2 不回。只收 IsLatest 的那一版當 current。
        const resp = await client.send(
          new ListObjectVersionsCommand({
            Bucket: parsed.bucket,
            Prefix: parsed.keyPrefix || undefined,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
          }),
        );
        for (const version of resp.Versions ?? []) {
          if (!version.Key || !version.VersionId || version.IsLatest !== true) continue;
          out.push({
            ref: buildMinioRef({
              authority: parsed.authority,
              bucket: parsed.bucket,
              objectKey: version.Key,
              versionId: version.VersionId,
            }),
            authority: parsed.authority,
            bucket: parsed.bucket,
            objectKey: version.Key,
            versionId: version.VersionId,
            etag: stripEtagQuotes(version.ETag),
            sizeBytes: version.Size ?? 0,
          });
        }
        if (resp.IsTruncated) {
          keyMarker = resp.NextKeyMarker;
          versionIdMarker = resp.NextVersionIdMarker;
        } else {
          keyMarker = undefined;
          versionIdMarker = undefined;
        }
      } while (keyMarker !== undefined || versionIdMarker !== undefined);
      return out;
    },

    destroy(): void {
      client.destroy();
    },
  };
  return port;
}

/**
 * 由 governed locator 字串取得已通過 allowlist 的 `ParsedRef`。
 *
 * 解析失敗與 allowlist 拒絕是兩種不同的失敗：前者回 `null`（呼叫端轉成
 * locator 類 integrity diagnostic），後者拋 `SourceBundleAccessDeniedError`
 * （呼叫端轉成 `semantic_contract_violation`）。
 */
export function resolveAllowedRef(
  ref: string,
  allow: SourceBundleAllowlist,
): ParsedRef | null {
  const parsed = parseMinioRef(ref);
  if (isRefParseFailure(parsed)) return null;
  assertRefAllowed(parsed, allow);
  return parsed;
}
