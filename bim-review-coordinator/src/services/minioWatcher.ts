import crypto from "node:crypto";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AnomalyData } from "../lib/structLog.js";
// 重用下游 conversion-artifact-id-sanitize 的 sanitizeArtifactIdPart 為「安全 id」唯一真相，
// 不在 watcher 另造一套規則（streamingConversionClient 只 import types + node:crypto，無循環依賴）。
import { sanitizeArtifactIdPart } from "./streamingConversionClient.js";

/**
 * minio-watch-auto-intake（O4 B 案）純函式核心：MinIO object key → intake 欄位導出、
 * 確定性 idempotency / correlation key、層級檢查。不含任何 I/O（list / presign / POST
 * 在 Task 4 的 watcher loop）。規約：key `{prefix}{專案原名}/…(動態中間層)…/{種類}/{版本}/model.ifc`，
 * 去 prefix + 去 keySuffix 後須 ≥3 段（首段=專案、倒數第二段=種類、末段=版本；中間動態層數量不限）。
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

// 最小 structLog 介面（避免 import app 造成循環依賴；只 type-only import AnomalyData）。
// anomaly 的 fields 用真實 AnomalyData（要求 anomaly_kind/reason）使真 StructLogger 結構
// 可賦值——若放寬成 Record<string, unknown>，strict 函式型別檢查下真 logger（其 anomaly 參數
// 較窄）不可賦值（app.ts 傳入會 TS2322）。watcher 的唯一呼叫點即傳 {anomaly_kind,reason,...}。
// withTraceId 為 optional：watcher 內部只呼叫 anomaly()，但真實 StructuredLogger 含 withTraceId。
interface WatcherLogger {
  anomaly: (op: string, msg: string, fields: AnomalyData) => void;
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
  // intake payload 的 tenant_id（config.minioWatchTenantId，env MINIO_WATCH_TENANT_ID）。
  // 不可硬編碼：部署切 tenant 時所有 watcher intake 必須帶入此值，否則 job 與雲端 callback
  // 都會掛在錯誤 tenant 下（靜默資料污染）。
  tenantId: string;
  // loopback intake POST 的逾時（ms），default 10_000。若 app 因負載/死鎖長時間不回
  // /api/external/ifc-ready，無此保護則 fetch 永不 resolve、tick() 無限 await、finally
  // 的下一輪 setTimeout 不觸發 → watcher loop 凍結。逾時的 AbortError 與其他網路失敗
  // 同等對待（recordTriggered + return，不上浮）。比照 streamingConversionClient
  // 的 AbortSignal.timeout(requestTimeoutMs) 模式。
  intakeTimeoutMs?: number;
  // §3.4 全自動 auto-enroll：持久 ledger 去重水印（必填）。對每個 `*/model.ifc` 算
  // idkey = idempotencyKeyFor(bucket,key,etag)，查 isLedgered(idkey)：無紀錄→觸發 intake、
  // 有紀錄→skip。in-memory `seen` 僅作單輪快取，權威去重以持久 ledger 為準。
  // 移除首輪 baseline 不觸發特例：首輪即對 ledger 無紀錄物件觸發（既有未轉檔自動補轉、重啟命中
  // ledger 不重觸發）。baseline_count（首輪 `*/model.ifc` 數）仍填供 #conv 顯示，純診斷不 gate 觸發。
  // 必填（非 optional）：production app.ts 恆注入；已移除舊「省略時回落 baseline」legacy fallback
  // 分支（P5 f2：該分支 production 不走、零測試、與 spec『移除首輪 baseline 特例』字面矛盾）。
  isLedgered: (idkey: string) => boolean;
  // 可選 dirty signal：watcher 第一次看到某個 (key, etag) 時通知上層，供 MinIO folder cache
  // 做 prefix invalidation / SSE；不承載 presigned URL 或 credentials。
  onObjectObserved?: (event: {
    bucket: string;
    key: string;
    etag: string;
    idempotency_key: string;
    at: string;
  }) => void;
  structLog: WatcherLogger;
}

export interface MinioWatcherHandle {
  // async：先停排程 → await in-flight tick settle（2s 上限）→ client.destroy()，
  // 避免在 SDK 請求進行中銷毀 client 觸發 unhandled rejection。呼叫端應 await。
  dispose: () => Promise<void>;
  getStatus: () => MinioWatcherStatus;
}

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

export function startMinioWatcher(opts: MinioWatcherOptions): MinioWatcherHandle {
  // SSRF 防護：watcher 自打 selfBaseUrl 並帶 webhook secret，selfBaseUrl 必須是 loopback http。
  // 在建任何資源前 fail-fast（app 啟動段呼叫，等同 config 驗證）。
  assertLoopbackSelfBaseUrl(opts.selfBaseUrl);
  // 非 boundary-aligned keySuffix → 全物件靜默 skip，啟動即拒（同上 fail-fast 精神）。
  assertBoundaryAlignedKeySuffix(opts.keySuffix);
  // intake POST 逾時：未設或 ≤0 時用 10s 預設（防 watcher 因 app 不回應而凍結）。
  const intakeTimeoutMs = opts.intakeTimeoutMs && opts.intakeTimeoutMs > 0 ? opts.intakeTimeoutMs : 10_000;
  const client = new S3Client({
    endpoint: opts.endpoint,
    region: "us-east-1",
    forcePathStyle: true, // MinIO 必要（path-style addressing）
    credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
  });

  const seen = new Map<string, string>(); // key → etag（單輪/跨輪快取；§3.4 權威去重以持久 ledger 為準）
  const observed = new Map<string, string>(); // key → etag（dirty signal 去重；不影響 intake 重試語意）
  // §3.4 auto-enroll：ledger 去重（isLedgered 必填）。移除「首輪 baseline 不觸發」特例，每個物件
  // （含首輪）依 !isLedgered(idkey) 決定觸發；既有未轉檔自動補轉、重啟命中 ledger 不重觸發。
  const isLedgered = opts.isLedgered;
  const status: MinioWatcherStatus = {
    enabled: true,
    bucket: opts.bucket,
    prefix: opts.prefix,
    interval_seconds: opts.intervalSeconds,
    last_poll_at: null,
    poll_count: 0,
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
  // 當前在途的 tick promise（含 in-flight 的 SDK list / presign / intake POST）。dispose 用它
  // 等待當輪結束再 client.destroy()，避免在 client.send 進行中銷毀 client 觸發 unhandled rejection。
  let tickPromise: Promise<void> | null = null;

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

  // triggerIntake 回傳三態（Codex review P1 修復）：呼叫端（tick）據此決定是否把物件標進 seen。
  // - "triggered"：intake 成功（含 idempotent_replay）→ 標 seen，之後同 etag 不再觸發。
  // - "skip_permanent"：key 層級不符（malformed）→ 確定性結果，重試恆同果 → 標 seen，
  //   只計數一次（避免每輪重 derive 灌水 skipped_malformed_total）。
  // - "fail_transient"：presign / 網路 / 逾時 / HTTP error / 2xx 非 JSON → 不標 seen，
  //   下輪重試（自癒）。重試時 idempotency key 由 bucket|key|etag 確定性導出：若前次 POST
  //   其實已被 store 收下（如回應在途中斷線），重試會命中既有去重回 idempotent_replay，
  //   不重複建 job。HTTP 4xx 也視為 transient：寧可按輪詢間隔反覆重試並在 last_triggered
  //   留下可見錯誤，不可靜默放棄物件（interval floor 保證重試頻率有界）。
  type TriggerOutcome = "triggered" | "skip_permanent" | "fail_transient";

  async function triggerIntake(key: string, etag: string): Promise<TriggerOutcome> {
    const derived = deriveIntakeFromKey({ key, prefix: opts.prefix, keySuffix: opts.keySuffix });
    if (!derived.ok) {
      status.skipped_malformed_total += 1;
      return "skip_permanent";
    }
    // presign 失敗（credentials 失效 / client 已銷毀 / SDK 內部錯）只屬「此物件」失敗：
    // 記入 recordTriggered 後 return，與下方 fetch try/catch 對等。不可讓例外向上浮到
    // tick() 外層 catch——否則會覆蓋整輪 last_error 並中斷同輪其餘物件的觸發。
    let presignedRef: string;
    try {
      presignedRef = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: opts.bucket, Key: key }),
        { expiresIn: 3600 },
      );
    } catch (err) {
      recordTriggered(key, null, `presign failed: ${err instanceof Error ? err.message : String(err)}`);
      return "fail_transient";
    }
    const idemKey = idempotencyKeyFor(opts.bucket, key, etag);
    const corrId = correlationIdFor(opts.bucket, key, etag);
    const etagShort = derived.sourceEtagFrom(etag).slice(0, 8);
    const body = {
      event: "ifc_ready",
      tenant_id: opts.tenantId,
      project_id: derived.projectId,
      // 種類(倒數二層)與專案原名(中文如實顯示)隨進件傳遞；種類/原名只傳遞、不入本地 store（R5）。
      project_display_name: derived.projectDisplayName,
      model_category: derived.category,
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
        // app 死鎖/過載長時不回時逾時中斷，避免 tick() 無限 await 凍結整個 loop。
        signal: AbortSignal.timeout(intakeTimeoutMs),
      });
      const text = await resp.text();
      if (resp.status >= 400) {
        recordTriggered(key, null, `intake ${resp.status}: ${text.slice(0, 120)}`);
        return "fail_transient";
      }
      // JSON.parse 失敗（2xx 但非 JSON，如代理錯誤頁）會 throw 進下方 catch → fail_transient。
      const parsed = JSON.parse(text || "{}") as {
        ifc_ready_job_id?: string;
        download_status?: string;
      };
      // Codex review P1（failed-replay）誠實化：intake 對同 idempotency key 的 replay
      // 「不重下載也不重派工」是上游 spec（fast-ifc-link-demo-loop §2.6）既定不變量。
      // 若 2xx 回的是 download 已失敗的既有 job（首次 POST 建了 job 但同步下載 502），
      // 之後每輪重試都只會拿到同一筆失敗 job 的 200 replay，永遠不會自癒。比照 design
      // §5「下載失敗：watcher 不重送、操作者從 #/conv 看到失敗 job」的既審取捨：標 seen
      // 停止無效重試，失敗誠實記入 last_triggered（帶 job_id；不計 triggered_total，
      // 與「計數須與 error 狀態一致」的既有測試規約對齊）。補救：手動 intake 或重新上傳換 etag。
      if (parsed.download_status === "failed") {
        recordTriggered(
          key,
          parsed.ifc_ready_job_id ?? null,
          "intake replay: download_status=failed（job 已建、#/conv 可見；replay 不重下載，watcher 停止重試）",
        );
        return "skip_permanent";
      }
      status.triggered_total += 1; // idempotent_replay 也計為觸發（誠實統計），不重複建 job 由 store 保證
      recordTriggered(key, parsed.ifc_ready_job_id ?? null, null);
      return "triggered";
    } catch (err) {
      recordTriggered(key, null, err instanceof Error ? err.message : String(err));
      return "fail_transient";
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const objects = (await listAllKeys()).filter((o) => o.key.endsWith(opts.keySuffix));
      status.last_poll_at = new Date().toISOString();
      status.poll_count += 1; // 單調遞增：list 成功即計一輪（供 loop liveness 判斷，免時鐘解析度依賴）
      status.last_error = null;
      // baseline_count（純診斷）：首輪 `*/model.ifc` 數，兩種模式皆照舊填。
      // ledger 模式下它**不再 gate 觸發**（不再代表「被吸收、不轉檔」），只供 #conv 顯示
      // 「首輪可解析 IFC 數」。
      const firstRound = isFirstRound;
      if (firstRound) {
        status.baseline_count = objects.length;
        isFirstRound = false;
      }
      // §3.4：無首輪 baseline 特例。對每個 `*/model.ifc` 算 idkey 查持久 ledger 水印——無紀錄→觸發
      // intake（並由 intake 端落帳）；有紀錄→skip。in-memory `seen` 留作單輪/跨輪快取（同 key 同 etag
      // 已觸發過 → 本實例不重查 ledger、不重送）。
      for (const o of objects) {
        if (seen.get(o.key) === o.etag) continue; // 本實例已處理過此 (key,etag)
        const idkey = idempotencyKeyFor(opts.bucket, o.key, o.etag);
        if (observed.get(o.key) !== o.etag) {
          observed.set(o.key, o.etag);
          opts.onObjectObserved?.({
            bucket: opts.bucket,
            key: o.key,
            etag: stripEtagQuotes(o.etag),
            idempotency_key: idkey,
            at: new Date().toISOString(),
          });
        }
        if (isLedgered(idkey)) {
          // 持久 ledger 已有紀錄（含重啟前已落帳、或他途已觸發）→ skip 並入快取，避免每輪重查。
          seen.set(o.key, o.etag);
          continue;
        }
        const outcome = await triggerIntake(o.key, o.etag);
        // 自癒語意（Codex review P1 修復）：只有成功觸發或永久性 skip（malformed）才標 seen。
        // 暫時性失敗不標 → 下輪重試。
        if (outcome !== "fail_transient") seen.set(o.key, o.etag);
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
      if (!stopped) timer = setTimeout(runTick, opts.intervalSeconds * 1000);
    }
  }

  // 包一層：每次排程時把當輪 promise 存入 tickPromise，供 dispose 等待 in-flight tick settle。
  function runTick(): void {
    tickPromise = tick();
  }

  // 首輪立即跑（不等一個 interval）。
  timer = setTimeout(runTick, 0);

  return {
    // dispose 為 async：先 stopped=true 停掉後續排程，再 await 當前 in-flight tick settle
    //（帶 2s 上限 race，避免 tick 因外部卡住而讓 dispose 永不返回），最後才 client.destroy()。
    // 這樣 in-flight 的 SDK list / presign / intake POST 會在 client 銷毀前自然收斂，不產生
    // unhandled rejection（先前 sync dispose 立即 destroy 會中斷 in-flight client.send）。
    dispose: async (): Promise<void> => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const inFlight = tickPromise;
      if (inFlight) {
        // tick() 自身不 throw（內含 try/catch），但仍 race 一個上限保護以防永久卡住。
        let capTimer: ReturnType<typeof setTimeout> | null = null;
        const cap = new Promise<void>((resolve) => {
          capTimer = setTimeout(resolve, 2000);
        });
        try {
          await Promise.race([inFlight, cap]);
        } finally {
          if (capTimer) clearTimeout(capTimer);
        }
      }
      client.destroy();
    },
    getStatus: () => ({ ...status, last_triggered: [...status.last_triggered] }),
  };
}
