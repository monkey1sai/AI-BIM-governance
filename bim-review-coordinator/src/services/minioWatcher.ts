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

/** bucket|key|etag 的確定性 sha256；前綴 mw_ + 前 16 hex（重啟重掃命中既有 idempotencyIndex）。 */
export function idempotencyKeyFor(bucket: string, key: string, etag: string): string {
  const digest = crypto.createHash("sha256").update(`${bucket}|${key}|${stripEtagQuotes(etag)}`).digest("hex");
  return `mw_${digest.slice(0, 16)}`;
}

/** correlation：minio-watch-<hash8>（只記 key 不記 presigned URL，避免敏感簽章入 log）。 */
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

export function deriveIntakeFromKey(input: {
  key: string;
  prefix: string;
  keySuffix: string;
}): DeriveOk | DeriveErr {
  const { key, prefix, keySuffix } = input;
  if (prefix && !key.startsWith(prefix)) {
    return { ok: false, reason: `key 不在 prefix 下：${key}` };
  }
  const afterPrefix = prefix ? key.slice(prefix.length) : key;
  if (!afterPrefix.endsWith(keySuffix)) {
    return { ok: false, reason: `key 不以 suffix 結尾：${key}` };
  }
  const withoutSuffix = afterPrefix.slice(0, afterPrefix.length - keySuffix.length);
  const segments = withoutSuffix.split("/").filter(Boolean);
  if (segments.length !== 2) {
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
