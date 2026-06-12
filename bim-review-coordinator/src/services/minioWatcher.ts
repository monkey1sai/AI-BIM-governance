import crypto from "node:crypto";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

// 最小 structLog 介面（避免 import app 造成循環依賴；app 傳入真 logger）。
// withTraceId 為 optional：watcher 內部只呼叫 anomaly()，但真實 StructuredLogger 含
// withTraceId — 測試樁與真 logger 都能不靠 as never 直接滿足此介面。
interface WatcherLogger {
  anomaly: (op: string, msg: string, fields: Record<string, unknown>) => void;
  withTraceId?: (id: string) => { anomaly: WatcherLogger["anomaly"] };
}

export interface MinioWatcherOptions {
  endpoint: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
  keySuffix: string;
  intervalSeconds: number;
  selfBaseUrl: string;       // loopback intake base，如 http://127.0.0.1:8004
  webhookSecret: string;
  structLog: WatcherLogger;
}

export interface MinioWatcherHandle {
  dispose: () => void;
  getStatus: () => MinioWatcherStatus;
}

export interface MinioWatcherStatus {
  enabled: true;
  bucket: string;
  prefix: string;
  interval_seconds: number;
  last_poll_at: string | null;
  last_error: string | null;
  baseline_count: number | null;
  seen_count: number;
  triggered_total: number;
  skipped_malformed_total: number;
  last_triggered: Array<{ key: string; job_id: string | null; error: string | null; at: string }>;
}

export function startMinioWatcher(opts: MinioWatcherOptions): MinioWatcherHandle {
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true, // MinIO 必要（path-style addressing）
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });

  const seen = new Map<string, string>(); // key → etag
  const status: MinioWatcherStatus = {
    enabled: true,
    bucket: opts.bucket,
    prefix: opts.prefix,
    interval_seconds: opts.intervalSeconds,
    last_poll_at: null,
    last_error: null,
    baseline_count: null,
    seen_count: 0,
    triggered_total: 0,
    skipped_malformed_total: 0,
    last_triggered: [],
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let isFirstRound = true;

  function recordTriggered(key: string, jobId: string | null, error: string | null): void {
    status.last_triggered.unshift({ key, job_id: jobId, error, at: new Date().toISOString() });
    status.last_triggered = status.last_triggered.slice(0, 5);
  }

  async function listAllKeys(): Promise<Array<{ key: string; etag: string }>> {
    const out: Array<{ key: string; etag: string }> = [];
    let continuationToken: string | undefined;
    do {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: opts.bucket,
          Prefix: opts.prefix || undefined,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) out.push({ key: obj.Key, etag: obj.ETag ?? "" });
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  async function triggerIntake(key: string, etag: string): Promise<void> {
    const derived = deriveIntakeFromKey({ key, prefix: opts.prefix, keySuffix: opts.keySuffix });
    if (!derived.ok) {
      status.skipped_malformed_total += 1;
      return;
    }
    const presignedRef = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
      { expiresIn: 3600 },
    );
    const idemKey = idempotencyKeyFor(opts.bucket, key, etag);
    const corrId = correlationIdFor(opts.bucket, key, etag);
    const etagShort = derived.sourceEtagFrom(etag).slice(0, 8);
    const body = {
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: derived.projectId,
      external_model_version_id: derived.externalModelVersionId,
      external_conversion_task_id: `${derived.externalModelVersionId}_mw_${etagShort}`,
      source_ifc: {
        ref: presignedRef,
        etag: derived.sourceEtagFrom(etag),
        filename: "model.ifc",
        format: "ifc",
      },
      requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
    };
    try {
      const resp = await fetch(`${opts.selfBaseUrl}/api/external/ifc-ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": opts.webhookSecret,
          "X-Correlation-Id": corrId,
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (resp.status >= 400) {
        recordTriggered(key, null, `intake ${resp.status}: ${text.slice(0, 120)}`);
      } else {
        const parsed = JSON.parse(text || "{}") as { ifc_ready_job_id?: string };
        status.triggered_total += 1; // idempotent_replay 也計為觸發（誠實統計），不重複建 job 由 store 保證
        recordTriggered(key, parsed.ifc_ready_job_id ?? null, null);
      }
    } catch (err) {
      recordTriggered(key, null, err instanceof Error ? err.message : String(err));
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const objects = (await listAllKeys()).filter((o) => o.key.endsWith(opts.keySuffix));
      status.last_poll_at = new Date().toISOString();
      status.last_error = null;
      if (isFirstRound) {
        for (const o of objects) seen.set(o.key, o.etag);
        status.baseline_count = seen.size;
        isFirstRound = false;
      } else {
        for (const o of objects) {
          const prev = seen.get(o.key);
          if (prev === o.etag) continue; // 同 key 同 etag → 不觸發
          seen.set(o.key, o.etag);
          await triggerIntake(o.key, o.etag);
        }
      }
      status.seen_count = seen.size;
    } catch (err) {
      status.last_error = err instanceof Error ? err.message : String(err);
      opts.structLog.anomaly("minioWatch", "minio watch tick failed", {
        anomaly_kind: "retry",
        reason: status.last_error,
        bucket: opts.bucket,
      });
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), opts.intervalSeconds * 1000);
    }
  }

  // 首輪立即跑（不等一個 interval）。
  timer = setTimeout(() => void tick(), 0);

  return {
    dispose: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      client.destroy();
    },
    getStatus: () => ({ ...status, last_triggered: [...status.last_triggered] }),
  };
}
