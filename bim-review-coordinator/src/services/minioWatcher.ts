import crypto from "node:crypto";

/**
 * minio-watch-auto-intake（O4 B 案）純函式核心：MinIO object key → intake 欄位導出、
 * 確定性 idempotency / correlation key、層級檢查。不含任何 I/O（list / presign / POST
 * 在 Task 4 的 watcher loop）。規約：key `{prefix}{projectId}/{modelId}/model.ifc`，
 * 去 prefix + 去 keySuffix 後須恰兩層（projectId / modelId）。
 */

function stripEtagQuotes(etag: string): string {
  return etag.replace(/^"+|"+$/g, "");
}

/**
 * bucket|key|etag 的確定性 sha256；前綴 mw_ + 前 16 hex（重啟重掃命中既有 idempotencyIndex）。
 *
 * 前置條件（precondition）：`key` 不得含 `|`。hash input 以 `|` 分隔 bucket/key/etag，
 * S3/MinIO bucket name 規範禁 `|`、etag 為 hex 不含 `|`，但 object key 允許任意 UTF-8。
 * 若 key 含 `|`（例如 `project|id/model/model.ifc`），可能與另一組 (bucket, key, etag)
 * 撞同一 hash，導致兩物件共用 idempotencyKey、第二個 intake 被當 idempotent_replay 靜默丟棄。
 * 本系統 production bucket 路徑規約為 `{projectId}/{modelId}/model.ifc`（數值/字母），不含 `|`。
 */
export function idempotencyKeyFor(bucket: string, key: string, etag: string): string {
  const digest = crypto.createHash("sha256").update(`${bucket}|${key}|${stripEtagQuotes(etag)}`).digest("hex");
  return `mw_${digest.slice(0, 16)}`;
}

/**
 * correlation：minio-watch-<hash8>（只記 key 不記 presigned URL，避免敏感簽章入 log）。
 *
 * 前置條件同 {@link idempotencyKeyFor}：`key` 不得含 `|`（hash input 以 `|` 分隔 bucket/key/etag）。
 */
export function correlationIdFor(bucket: string, key: string, etag: string): string {
  const digest = crypto.createHash("sha256").update(`${bucket}|${key}|${stripEtagQuotes(etag)}`).digest("hex");
  return `minio-watch-${digest.slice(0, 8)}`;
}

export interface DeriveOk {
  ok: true;
  projectId: string;
  externalModelVersionId: string;
  /** etag → source_ifc.etag（去外層引號，不重複加引號）。 */
  sourceEtagFrom: (etag: string) => string;
}

export interface DeriveErr {
  ok: false;
  reason: string;
}

/**
 * MinIO object key → intake 欄位（projectId / modelId）。
 *
 * 前置條件（precondition）：非空 `prefix` 必須以 `/` 結尾。否則 `89` 這種非 boundary-aligned
 * prefix 會用 `startsWith` 命中 `899/...`，去 prefix 後切出 projectId='9'（而非 '899'），
 * 造成 job 掛在錯誤 project 下且無 error log（靜默資料污染）。此函式在 prefix 不以 `/` 結尾時
 * 直接回 `ok=false`；呼叫端（Task 4 watcher loop）也可在 config 階段 normalize prefix。
 */
export function deriveIntakeFromKey(input: {
  key: string;
  prefix: string;
  keySuffix: string;
}): DeriveOk | DeriveErr {
  const { key, prefix, keySuffix } = input;
  if (prefix && !prefix.endsWith("/")) {
    return { ok: false, reason: `prefix 必須以 '/' 結尾或為空字串：${prefix}` };
  }
  if (prefix && !key.startsWith(prefix)) {
    return { ok: false, reason: `key 不在 prefix 下：${key}` };
  }
  const afterPrefix = prefix ? key.slice(prefix.length) : key;
  if (!afterPrefix.endsWith(keySuffix)) {
    return { ok: false, reason: `key 不以 suffix 結尾：${key}` };
  }
  const withoutSuffix = afterPrefix.slice(0, afterPrefix.length - keySuffix.length);
  // 不用 filter(Boolean)：S3/MinIO 允許 `899//xxx/model.ifc`（含空 segment）為獨立 key，
  // filter 會把空 segment 靜默吃掉，使雙斜線 key 被誤判為合法兩層而與正常 key 撞同一 projectId/modelId
  // 重複觸發。改保留空 segment，恰兩層且皆非空才合法。
  const segments = withoutSuffix.split("/");
  if (segments.length !== 2 || segments.some((s) => s === "")) {
    return {
      ok: false,
      reason: `去 prefix/suffix 後非恰兩層（projectId/modelId）：${withoutSuffix}`,
    };
  }
  const [projectId, externalModelVersionId] = segments;
  return {
    ok: true,
    projectId,
    externalModelVersionId,
    sourceEtagFrom: stripEtagQuotes,
  };
}
