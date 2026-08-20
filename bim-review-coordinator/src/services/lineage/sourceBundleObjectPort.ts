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
//
// **Owner carve-out（2026-08-20 裁決）**：`putIfAbsent` 是 coordinator 對 MinIO 的
// **唯一**寫入面，且只開給 legacy enrollment confirm 的 `manifest.json` conditional
// create。`assertManifestObjectKey` 是這條 carve-out 的**機器強制**：任何不以
// `/manifest.json` 結尾的 key 一律拋錯，不發出請求。正本：`bim-review-coordinator/AGENTS.md`
// 的 Required Boundaries carve-out 段。
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
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

/**
 * governed manifest 的固定檔名。
 *
 * 三個地方共用同一個字：discovery（哪些 prefix 是 governed version）、legacy 判定
 * （有 manifest 就不是 `LEGACY_UNMANAGED`）、以及 carve-out 的寫入 gate。
 * 多一種拼法就是多一個 authority，所以這裡是唯一定義處（`legacyEnrollment.ts`
 * 只 re-export）。
 */
export const MANIFEST_OBJECT_NAME = "manifest.json";

/** carve-out 的 key 形狀：只有以此結尾的 object key 可被 `putIfAbsent` 寫入。 */
export const MANIFEST_OBJECT_SUFFIX = `/${MANIFEST_OBJECT_NAME}`;

export type PutIfAbsentOutcome =
  | { outcome: "created"; versionId: string; etag: string }
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
   * **owner carve-out（2026-08-20）**：這是 coordinator 對 MinIO 的唯一寫入面，
   * 且僅限 governed prefix 之下、以 `/manifest.json` 結尾的 key —— 其餘 key 由
   * `assertManifestObjectKey` fail-closed 擋下，連請求都不發。已存在時回
   * `conflict_existing_manifest`（可重試），**絕不覆寫**。
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

/**
 * 寫入超出 owner carve-out 的範圍（2026-08-20 裁決只開 `manifest.json` 一種 key）。
 *
 * 這不是使用者輸入錯誤而是**呼叫端的程式錯誤**，故不帶 `httpStatus`：route 層的
 * 4xx 映射不會撿它，會冒到 error middleware 變 500。carve-out 的邊界寧可以 500
 * 尖叫，也不要被靜默降級成一個看起來像正常拒絕的 4xx。
 */
export class SourceBundleWriteScopeError extends Error {
  readonly code = "source_bundle_write_scope_violation";

  constructor(readonly objectKey: string) {
    super(
      `coordinator MinIO write carve-out only covers ${MANIFEST_OBJECT_SUFFIX} conditional create; refusing to write ${objectKey}`,
    );
    this.name = "SourceBundleWriteScopeError";
  }
}

/**
 * PutObject 成功了但回應缺 `VersionId`／`ETag`。
 *
 * governed bucket **必須**開 versioning：沒有 version id 就組不出 governed locator
 * （`?versionId=` 是契約必填），這份 manifest 也就無法被後續重驗引用。誠實 fail-closed，
 * 不用空字串偽造一個 locator。注意此時 object **已寫入**：重試會得到
 * `conflict_existing_manifest`，那是正確且可讀的後續狀態。
 */
export class SourceBundleWriteResponseError extends Error {
  readonly code = "source_bundle_write_response_incomplete";

  constructor(
    readonly bucket: string,
    detail: string,
  ) {
    super(detail);
    this.name = "SourceBundleWriteResponseError";
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

/**
 * owner carve-out 的機器強制（2026-08-20）。
 *
 * coordinator 只被授權 conditional-create governed bundle 的 `manifest.json`。
 * 任何其他 key（artifact bytes、暫存檔、其他路徑）一律在**發出請求前**拒絕，
 * 讓「只寫這一個 key」成為程式碼事實，而不是一句文件承諾。
 *
 * 也擋掉裸 `manifest.json`（沒有前置 `/`）：governed manifest 一定住在
 * `<prefix>/<version>/` 之下，bucket 根目錄的 manifest 不是本 carve-out 的對象。
 */
export function assertManifestObjectKey(objectKey: string): void {
  if (typeof objectKey !== "string" || !objectKey.endsWith(MANIFEST_OBJECT_SUFFIX)) {
    throw new SourceBundleWriteScopeError(String(objectKey));
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
    if (object.objectKey.endsWith(MANIFEST_OBJECT_SUFFIX)) {
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

/**
 * conditional create 的「物件已存在」訊號。
 *
 * `If-None-Match: *` 命中既有 object 時，MinIO／S3 回 **412 Precondition Failed**
 * （code `PreconditionFailed`）。**只**映射 412：S3 在並行寫入時另有 409
 * `ConditionalRequestConflict`，那是「條件還沒判完」而不是「manifest 已存在」，
 * 讓它照常 propagate 成錯誤，比誤報成一個 conflict 文件誠實。
 */
function isPreconditionFailed(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "PreconditionFailed" || status === 412;
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

    async putIfAbsent(
      ref: Omit<ParsedRef, "versionId">,
      body: Buffer,
      contentType: string,
    ): Promise<PutIfAbsentOutcome> {
      // 兩道 fail-closed gate 都在發請求之前：D-3 allowlist ＋ carve-out key 形狀。
      assertRefAllowed(ref, allow);
      assertManifestObjectKey(ref.objectKey);
      let resp;
      try {
        resp = await client.send(
          new PutObjectCommand({
            Bucket: ref.bucket,
            Key: ref.objectKey,
            Body: body,
            ContentType: contentType,
            ContentLength: body.length,
            // conditional create：object 已存在時 server 端拒絕，寫入不發生。
            // 這是「並行升格只允許一個成功」在 store 層的唯一保證——不用先 HEAD
            // 再 PUT（那是 TOCTOU，兩個 operator 會雙雙看到「不存在」）。
            IfNoneMatch: "*",
          }),
        );
      } catch (err) {
        if (isPreconditionFailed(err)) return { outcome: "conflict_existing_manifest" };
        throw err;
      }
      const versionId = resp.VersionId ?? "";
      const etag = stripEtagQuotes(resp.ETag);
      if (versionId === "" || etag === "") {
        throw new SourceBundleWriteResponseError(
          ref.bucket,
          `PutObject 對 ${ref.objectKey} 成功但回應缺 ${versionId === "" ? "VersionId（governed bucket 必須開 versioning）" : "ETag"}；無法組出 governed locator`,
        );
      }
      return { outcome: "created", versionId, etag };
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
