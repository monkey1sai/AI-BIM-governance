import crypto from "node:crypto";
// 重用下游 conversion-artifact-id-sanitize 的 sanitizeArtifactIdPart 為「安全 id」唯一真相，
// 不在 watcher 另造一套規則（streamingConversionClient 只 import types + node:crypto，無循環依賴）。
import { sanitizeArtifactIdPart } from "./streamingConversionClient.js";

/**
 * minio-watch-auto-intake（O4 B 案）純函式核心：MinIO object key → intake 欄位導出、
 * 確定性 idempotency / correlation key、層級檢查、啟動 fail-fast asserts 與 status 投影
 * 型別。不含任何 I/O——watcher loop / toggle / pollNow 在 minioWatchSurface.ts（deep
 * module），S3 存取在 minioObjectStore.ts（ObjectStorePort seam）。
 * 規約：key `{prefix}{專案原名}/…(動態中間層)…/{種類}/{版本}/model.ifc`，
 * 去 prefix + 去 keySuffix 後須 ≥3 段（首段=專案、倒數第二段=種類、末段=版本；中間動態層數量不限）。
 */

export function stripEtagQuotes(etag: string): string {
  return etag.replace(/^"+|"+$/g, "");
}

/**
 * bucket|key|etag 的確定性 sha256；前綴 mw_ + 前 16 hex（重啟重掃命中既有 idempotencyIndex）。
 *
 * 前置條件（precondition）：`key` 不得含 `|`。hash input 以 `|` 分隔 bucket/key/etag，
 * S3/MinIO bucket name 規範禁 `|`、etag 為 hex 不含 `|`，但 object key 允許任意 UTF-8。
 * 若 key 含 `|`（例如 `project|id/model/model.ifc`），可能與另一組 (bucket, key, etag)
 * 撞同一 hash，導致兩物件共用 idempotencyKey、第二個 intake 被當 idempotent_replay 靜默丟棄。
 * 本系統 production bucket 路徑規約為 `{專案原名}/…/{種類}/{版本}/model.ifc`（數值/字母），不含 `|`。
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
  /** 安全代號：重用 sanitizeArtifactIdPart（純中文→mv_<hash8>、含非安全→${safe}_<hash8>、英數原樣）。 */
  projectId: string;
  /** 專案原名（如中文），如實保留供顯示/對帳；不參與下游安全 id。 */
  projectDisplayName: string;
  /** 種類＝去 prefix/suffix 後的倒數第二段。 */
  category: string;
  /** 版本＝最後一段。 */
  externalModelVersionId: string;
  /** etag → source_ifc.etag（去外層引號，不重複加引號）。 */
  sourceEtagFrom: (etag: string) => string;
}

export interface DeriveErr {
  ok: false;
  reason: string;
}

/**
 * MinIO object key → intake 欄位（projectId / projectDisplayName / category / externalModelVersionId）。
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
  // q3-pipe-guard：key 含 '|' 與 idempotencyKeyFor 的 bucket|key|etag 分隔符衝突（見本檔上方
  // idempotencyKeyFor precondition），會撞 hash → 第二個 intake 被當 idempotent_replay 靜默丟棄。
  // listMinioObjects / 手動觸發端各自已擋，但自動 watcher（triggerIntake）經本共用函式進 intake
  // 未擋 → 於 derivation 補上，三路一致拒收，避免壞 key 進 intake 破壞 ledger hash 契約。
  if (key.includes("|")) {
    return { ok: false, reason: `key 不合法：不得含 '|'（與 idempotency hash 分隔符衝突）：${key}` };
  }
  const afterPrefix = prefix ? key.slice(prefix.length) : key;
  if (!afterPrefix.endsWith(keySuffix)) {
    return { ok: false, reason: `key 不以 suffix 結尾：${key}` };
  }
  const withoutSuffix = afterPrefix.slice(0, afterPrefix.length - keySuffix.length);
  // 不用 filter(Boolean)：S3/MinIO 允許 `899//xxx/model.ifc`（含空 segment）為獨立 key，
  // filter 會把空 segment 靜默吃掉，使雙斜線 key 被誤判為合法的 ≥3 段而與正常 key 撞同一 projectId/modelId
  // 重複觸發。改保留空 segment，≥3 段且皆非空才合法。
  const segments = withoutSuffix.split("/");
  // ≥3 段、皆非空、且無純點段（. / ..）才合法：第一段=專案、倒數第二段=種類、最後一段=版本，
  // 中間動態層（專案管理者動態管理）識別時忽略。保留空段檢查（防雙斜線靜默正規化）；
  // 純點段拒收防 `..` 原樣成為 project_id 的路徑穿越形狀（dots 在 SAFE_ID_RE 內、sanitize 不擋）。
  if (segments.length < 3 || segments.some((s) => s === "" || s === "." || s === "..")) {
    return {
      ok: false,
      reason: `去 prefix/suffix 後未湊齊三段（專案/種類/版本，不可含空段或 . / ..）：${withoutSuffix}`,
    };
  }
  const projectRaw = segments[0];
  const category = segments[segments.length - 2];
  const version = segments[segments.length - 1];
  return {
    ok: true,
    // 重用下游 sanitizeArtifactIdPart 為唯一安全真相；dispatch 端再 sanitize 對已安全值冪等 → 跨路徑同代號。
    projectId: sanitizeArtifactIdPart(projectRaw),
    projectDisplayName: projectRaw,
    category,
    externalModelVersionId: version,
    sourceEtagFrom: stripEtagQuotes,
  };
}

/**
 * watcher run 的 status 投影（GET /api/external/minio-watch/status 的啟用態 payload；
 * 對外 JSON 契約，欄位不可增刪改名）。run 生命週期與計數器寫入在 minioWatchSurface.ts。
 */
export interface MinioWatcherStatus {
  enabled: true;
  bucket: string;
  prefix: string;
  interval_seconds: number;
  last_poll_at: string | null;
  // 單調遞增：每輪 tick 完成（list 成功、不論是否有觸發）後 +1。供「watcher loop 是否仍在
  // 推進」的判斷，取代 last_poll_at 時間戳比較（同毫秒兩輪 timestamp 相等會 false-negative）。
  poll_count: number;
  last_error: string | null;
  baseline_count: number | null;
  seen_count: number;
  triggered_total: number;
  skipped_malformed_total: number;
  last_triggered: Array<{ key: string; job_id: string | null; error: string | null; at: string }>;
}

/**
 * selfBaseUrl 安全約束（SSRF 防護）：watcher 對 selfBaseUrl 自打 `POST /api/external/ifc-ready`
 * 並夾帶 `X-Webhook-Secret`。若 selfBaseUrl 由被注入的 env 指向任意外部 host，secret 會被
 * 洩漏給該 host。故只允許 loopback host（127.0.0.1 / localhost）且 protocol 必為 http:。
 * 違反即 throw（fail-fast，明示安全約束），不靜默降級。
 */
export function assertLoopbackSelfBaseUrl(selfBaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(selfBaseUrl);
  } catch {
    throw new Error(
      `MinIO watcher selfBaseUrl 不是合法 URL：${selfBaseUrl}（安全約束：必須為 http://127.0.0.1 或 http://localhost 的 loopback intake）`,
    );
  }
  if (url.protocol !== "http:") {
    throw new Error(
      `MinIO watcher selfBaseUrl 必須使用 http: scheme（收到 ${url.protocol}）。安全約束：watcher 夾帶 X-Webhook-Secret 自打 loopback intake，禁止非 http loopback。`,
    );
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(
      `MinIO watcher selfBaseUrl host 必須為 127.0.0.1 或 localhost（收到 ${url.hostname}）。安全約束：防止 X-Webhook-Secret 經 SSRF 洩漏給任意 host。`,
    );
  }
}

/**
 * keySuffix 邊界約束（Codex review P2 修復）：keySuffix 必須以 `/` 開頭。
 * 非 boundary-aligned 後綴（如 `model.ifc`）下，`988/zzz/model.ifc` 去後綴會留下
 * `988/zzz/`（trailing 空 segment）→ deriveIntakeFromKey 全數判 malformed →
 * 每個命中物件都被永久 skip（靜默無作為）。不做自動補 `/` normalize：複合後綴
 * （如 `_v2/model.ifc`，匹配 `988/zzz_v2/model.ifc`）語意上合法，盲目前置 `/`
 * 會改變其匹配集合；故 fail-fast 要求 operator 明確給 boundary-aligned 值。
 */
export function assertBoundaryAlignedKeySuffix(keySuffix: string): void {
  if (!keySuffix.startsWith("/")) {
    throw new Error(
      `MinIO watcher keySuffix 必須以 '/' 開頭（收到 ${JSON.stringify(keySuffix)}）。` +
        `非 boundary-aligned 後綴會讓所有命中物件被 deriveIntakeFromKey 判為 malformed 而永久 skip（靜默無作為）。` +
        `例：MINIO_WATCH_KEY_SUFFIX=/model.ifc。`,
    );
  }
}
