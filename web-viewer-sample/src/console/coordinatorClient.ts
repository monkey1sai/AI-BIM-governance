// Coordinator 自有 REST client（B/C/F 頁用）—— 只打 coordinator :8004 的 coordinator-owned
// 端點（非 governance proxy）。瀏覽器永不直連 :49100 / :49101 / :49102（邊界 B1）。
//
// 端點查證（誠實鐵律核心，2026-06-03 對 bim-review-coordinator/src/app.ts 逐一查證）：
//   GET  /health                                  ✓ as-built
//   GET  /api/runtime/status                      ✓ as-built（coordinator-visible runtime summary：
//                                                    sessions / kit_instance_bindings / ifc_ready_jobs /
//                                                    observations；read-only，Kit 內部 stage state 仍需
//                                                    DataChannel / Kit log 佐證）
//   GET  /api/review-sessions/:id/stream-config   ✓ as-built（F 頁）
//   GET  /api/external/ifc-ready[?limit]          ✓ as-built（C 頁 intake 佇列列表）
//   GET  /api/external/ifc-ready/:jobId           ✓ as-built（單一 job）
// 「未查證到」而不打的幻覺端點（設計 agent 發明，app.ts 無對應 route）：
//   /api/governance/uploads、/api/governance/runtime/{sessions|health|metrics}
//   → 一律不呼叫、不 mock 假端點；改用上方真實 /api/runtime/status 取等價資訊。
// callback-outbox 直查（/api/internal/callback-outbox/:id）需 internal token，瀏覽器不可達 →
//   不在此 client 提供；outbox 摘要改由 ifc_ready job 的 callback_outbox_id 觀察（誠實標 demo/未取得）。

import { defaultCoordinatorBase } from "./coordinatorBase";
import type { ConversionQualityMetricsSummary } from "../types/review";

const env = (import.meta as { env?: Record<string, string> }).env;

const COORD_BASE: string =
  env?.VITE_COORDINATOR_API_BASE ?? env?.VITE_COORDINATOR_BASE ?? defaultCoordinatorBase();

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    // 與 jsonPost/jsonPut 一致萃取 coordinator `{ detail }`（誠實鐵律）：getIfcReadyJob 等輪詢 GET
    // 失敗時，A1 狀態行直接把 .message 顯給操作員；只 throw statusText 會把後端「job 不存在 /
    // 未配置」等可操作提示吞成無意義的 "404 Not Found"。errorDetail best-effort，無 body 才退 statusText。
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    // 與 jsonPut 一致：萃取 coordinator `{ detail }`（誠實鐵律）。sessionClose 等 controlled
    // action 的 400「sessionId 不合法」/ 404「session 不存在」須在 dialog 顯出可操作提示，
    // 只 throw status/statusText 會把後端訊息吞掉（errorDetail 說明見下）。
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

// PUT mutation：body 收斂為 Record<string, unknown>，呼叫方必須明確傳物件。
// 不再 `?? {}` fallback（對 mutation 語意危險：null body 靜默變空物件 → 後端誤判
// enabled 缺漏 → 400）；型別層即阻擋 null/undefined body 的呼叫。
// 失敗回應 detail 萃取（誠實鐵律）：coordinator 對 400/403/409/422/500 一律回 `{ detail }`，
// 若只 throw status/statusText 會把後端「未配置/不在 allowlist」等可操作提示吞掉，dialog 顯
// 不出承諾的誠實失敗。best-effort 讀 body：先試 JSON 取 detail，退而求 text，皆失敗才退回
// statusText（不讓萃取本身丟錯遮蔽真正的 HTTP 失敗）。
async function errorDetail(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return res.statusText;
    try {
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail) return parsed.detail;
    } catch {
      /* 非 JSON：用原始 text */
    }
    return text;
  } catch {
    return res.statusText;
  }
}

async function jsonPut<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

// /health 真實回應形狀（app.ts:388）。
export interface CoordinatorHealth {
  status: string;
  service: string;
  kit_signaling_port: number;
}

// /api/runtime/status 真實回應形狀（app.ts:buildRuntimeStatus）。只挑前端會用到的欄位；
// 其餘以 passthrough 保留。首幀只透過 first_frame_at 表示；GPU / conversion 秒數不在此回應內 → 前端不得捏造。
export interface RuntimeSessionSummary {
  session_id: string;
  status: string;
  project_id: string;
  model_version_id: string;
  participant_count: number;
  expected_stage_url: string | null;
  expected_mapping_url?: string | null;
  conversion_status: string | null;
  kit_instance_ids: string[];
  created_at: string;
  updated_at: string;
  // VG-01（task#0 後端化）：runtime/status 透出真首幀證據（app.ts:2258 `first_frame_at ?? null`）。
  // 後端可能尚未回此欄（舊版本）或無首幀 → optional + nullable，前端誠實顯 not_observed，不捏造。
  first_frame_at?: string | null;
}
export interface RuntimeKitBinding {
  session_id: string;
  kit_instance_id: string;
  status: string; // KitInstance.status 權威 enum（allocated/starting/ready/draining/released/failed）
  assigned_artifact_ids: string[];
  started_at: string | null;
  last_heartbeat_at: string | null;
  released_at: string | null;
}
export interface RuntimeIfcReadyJob {
  ifc_ready_job_id: string;
  status: string;
  project_id: string;
  external_model_version_id: string;
  download_status: string | null;
  conversion_job_id: string | null;
  conversion_status: string | null;
  conversion_authority: string | null;
  callback_outbox_id: string | null;
  review_session_id: string | null;
  viewer_url: string | null;
  created_at: string;
}
export interface RuntimeStatus {
  service: { status: string; name: string; uptime_seconds: number; generated_at: string };
  configured_endpoints: {
    coordinator: { host: string; port: number; public_host: string; public_base_url: string };
    viewer: { browser_url_base: string; handoff_path: string };
    conversion_authority: { base_url: string; authority: string };
    kit: { id: string; signalingServer: string; signalingPort: number; mediaServer: string; mediaPort: number | null }[];
  };
  sessions: { count: number; active_count: number; participant_count: number; items: RuntimeSessionSummary[] };
  kit_instance_bindings: RuntimeKitBinding[];
  ifc_ready_jobs: { count: number; recent: RuntimeIfcReadyJob[] };
  observations: {
    classification: string;
    note: string;
    web_plane: { coordinator_port: number; viewer_port: number };
    host_native_plane: { conversion_api_base: string; kit_signal_ports: number[]; kit_media_ports: number[] };
  };
}

// C 頁 intake 佇列列表（app.ts:712 summarizeIfcReadyJob）。
export interface IfcReadyListItem {
  ifc_ready_job_id: string;
  status: string;
  project_id: string;
  external_model_version_id: string;
  download_status: string | null;
  conversion_status: string | null;
  conversion_authority: string | null;
  // conv-prioritize-retry:in-flight→0、queued→1-based、其餘→null。供插隊鈕 disabled 判斷。
  // summarizeIfcReadyJob 永遠輸出此欄（job.queue_position ?? null），故 non-optional——
  // 強制消費方只處理 number | null（不含 undefined），與 spec §4.3 的 null 守門語意對齊。
  queue_position: number | null;
  // m2a-coverage-report:wire 已有（app.ts summarizeIfcReadyJob:1907），補型別供 #conv 展開讀取。
  conversion_job_id: string | null;
  dispatch_error: string | null;
  review_session_id: string | null;
  viewer_url: string | null;
  expected_stage_url: string | null;
  expected_mapping_url: string | null;
  created_at: string;
  // conv-prioritize-retry §2.4：summarizeIfcReadyJob 永遠輸出 updated_at(app.ts:2133)；
  // job 變更後此欄前進是前端可見證據（task#4 prioritize/retry 成功後 load() 重抓據以確認狀態前進）。
  updated_at: string;
}

// B1（PR #259）落地的單一權威轉檔生命週期狀態（services/lifecycleStatus.ts deriveLifecycleStatus）。
// ⚠ 手動同步點：此值集鏡像後端 ConversionLedgerStatus（bim-review-coordinator/src/services/conversionLedger.ts）。
// 前後端無 shared schema / codegen；後端增刪狀態值時 MUST 同步此處。coordinatorClient.test.ts 的
// 「值集鎖定」測試鎖住此陣列，使任何前端漏改在 CI 被攔（後端增值仍需人工同步，測試僅守前端不被悄改）。
export const CONVERSION_LIFECYCLE_STATUS_VALUES = ["detected", "queued", "converting", "ready", "failed"] as const;
export type ConversionLifecycleStatus = (typeof CONVERSION_LIFECYCLE_STATUS_VALUES)[number];

// A1（B2）排隊轉檔回應：POST /api/conversion/trigger。成功 202 帶 ifc_ready_job_id；
// MinIO 未設定 503 由 jsonPost throw（帶後端 detail），不會走到這裡。
export interface TriggerConversionResponse {
  ifc_ready_job_id: string;
  status?: string;
  trigger_source?: string;
}

// A1（B2）轉檔狀態輪詢：GET /api/external/ifc-ready/:jobId（summarizeIfcReadyJob 子集）。
// 主讀 conversion_lifecycle_status；該欄缺失時誠實降級用 conversion_status / download_status。
export interface IfcReadyJobDetail {
  ifc_ready_job_id: string;
  status: string;
  conversion_lifecycle_status: ConversionLifecycleStatus | null;
  download_status: string | null;
  conversion_status: string | null;
  review_session_id: string | null;
}


// minio-watch-auto-intake：GET /api/external/minio-watch/status 真實回應形狀。
// 關閉時只有 enabled=false + note；啟用時帶完整計數。credentials 永不在此回應。
export interface MinioWatchStatus {
  enabled: boolean;
  bucket?: string | null;
  prefix?: string | null;
  interval_seconds?: number;
  note?: string;
  last_poll_at?: string | null;
  // 單調遞增 tick 計數（後端 MinioWatcherStatus.poll_count）。供 loop liveness 判斷，
  // 免依賴時鐘解析度（同毫秒兩輪 last_poll_at 相等會無法區分）。enabled=false 時不帶。
  poll_count?: number;
  last_error?: string | null;
  baseline_count?: number | null;
  seen_count?: number;
  triggered_total?: number;
  skipped_malformed_total?: number;
  last_triggered?: Array<{ key: string; job_id: string | null; error: string | null; at: string }>;
}

// F 頁 stream-config（app.ts:510）。GPU 遙測不在此回應 → 不捏造。
export interface StreamConfigResponse {
  session_id: string;
  status: string;
  kit_instances?: unknown[];
  [k: string]: unknown;
}

// m2a-coverage-report：GET /api/conversions/:id/quality-metrics 回應形狀。
export interface ConversionQualityMetricsResponse {
  conversion_job_id: string;
  quality_metrics_summary: ConversionQualityMetricsSummary | null;
  usdc_url?: string | null;
  mapping_url?: string | null;
}

// conv-prioritize-retry:POST /api/conversion/jobs/:id/{prioritize,retry} 回應形狀。
export interface ConversionControlResponse {
  ifc_ready_job_id: string;
  status: string;
  queue_position?: number | null;
  queued_order?: string[];
}

// IX-SS-04：POST /api/review-sessions/:id/close 回傳（重用 close 路由；只取消費端用到的欄位）。
export interface SessionCloseResponse {
  session_id: string;
  status: string;
}

// Task 5 MinIO 閉環 Phase 1：ConversionLedger 的 status 值域（後端 ConversionLedgerRecord.status
// 權威 enum）。單一來源供 ConversionRecord 與 ConversionTriggerResponse 共用，避免兩處各寫 union
// 而漂移；UI chip-patch 對 wire 的寬型別 status 做 runtime narrow 時以此為合法集合。
export type ConversionLedgerStatus = "detected" | "queued" | "converting" | "ready" | "failed";

// Task 5 MinIO 閉環 Phase 1：GET /api/conversion/records 回應中的紀錄形狀。
// 對齊後端 ConversionLedgerRecord（省略前端用不到的 bucket/correlation_id）。
export interface ConversionRecord {
  idempotency_key: string;
  project_id: string;
  project_display_name: string;
  category: string;
  external_model_version_id: string;
  conversion_job_id: string | null;
  status: ConversionLedgerStatus;
  usdc_key: string | null;
  coverage_report: unknown | null;
  // Task 8：ledger 列「未轉/failed」一鍵觸發鈕需要原始 object_key 才能呼 triggerConversion(key)（方向1：走 main #259 端點）。
  // 對齊後端 ConversionLedgerRecord.object_key（conversionLedger.ts:21，Phase 1 可為 null——
  // watcher 自動落帳的舊紀錄可能無 key；手動觸發者會帶 key）。null 時前端不掛觸發鈕。
  object_key: string | null;
  detected_at: string;
  updated_at: string;
}

// Task 5 MinIO 閉環 Phase 1：GET /api/minio/objects 回應中的物件形狀。
// 對齊後端 MinioObjectView（key/etag/role/project_id/project_display_name/category/version）。
// Task 6：加 idempotency_key（後端預計算 mw_<hash16>，前端 chip 用以查 ConversionRecord map）。
export interface MinioObject {
  key: string;
  etag: string;
  role: "source_ifc" | "parsed_usdc" | "other";
  project_id: string | null;
  project_display_name: string | null;
  category: string | null;
  version: string | null;
  // Task 6：後端在 listMinioObjects/listMinioFolder 對**所有**物件（含 role='other'）無條件呼
  // idempotencyKeyFor(bucket,key,etag) 並寫入（minioClient.ts:133,230），故 wire 恆為 string（非 null）。
  // MinioObjectView.idempotency_key 後端型別亦為非 nullable string。前端 chip 以此 key 對
  // ConversionRecord map lookup；.ifc/非 .ifc 一律有值，差別只在 role 與是否掛語意 badge。
  idempotency_key: string;
}

// Task 6 MinIO 資料夾導覽：GET /api/minio/objects?delimiter=/ 回應中的資料夾節點形狀。
// 對齊後端 MinioFolderNode（minioClient.ts:35-38）：CommonPrefix 字串 + 該 prefix（遞迴）是否含
// .ifc 葉物件（spec §2.5 第 5 點『含 source IFC』folder badge）。後端對每個 CommonPrefix 各 probe
// 一次 has_source_ifc，故 wire 是物件陣列而非純字串陣列；前端消費端可安全做 folder.prefix 字串操作。
export interface MinioFolderNode {
  prefix: string;
  has_source_ifc: boolean;
}

// Task 6 MinIO 資料夾導覽：GET /api/minio/objects?delimiter=/ 回應形狀（additive）。
// folders = CommonPrefixes（各層子資料夾節點 + has_source_ifc），objects = 當層直屬非前綴物件。
export interface MinioFolderListing {
  bucket: string | null;
  prefix: string;
  folders: MinioFolderNode[];
  objects: MinioObject[];
  count: number;
  // MinIO 未設定分支（app.ts:1296-1309）回 200 + note；已設定分支不帶此欄。前端據以區分 empty 態
  // (a) 未設定 vs (b) 已設定但當前 prefix 無物件。optional 對齊 wire shape，免消費端防禦性 cast。
  note?: string;
}

// Task 6：POST /api/conversion/trigger 回應形狀。
// 成功回 {status, idempotency_key}，前端直接 patch chip（零額外 round-trip）。
// Task 6 chip-patch runtime guard：把 wire 的寬 string status narrow 成 ConversionLedgerStatus。
// ConversionRecord.status 的 wire 型別是寬 string（後端 ledger.status）；ledger 實際只會是
// ConversionLedgerStatus 之一，但 wire 無法在 compile time 擋住非法值。故 chip 衍生（ledgerChipStatus）
// 消費端 MUST 先用 narrowConversionStatus() 做 runtime narrow，非合法值回 null 顯 unknown / 不 patch，
// 而非靜默把 chip 設成非法狀態（誠實鐵律）。供 Task 6 UI 消費 ConversionRecord 用。
const CONVERSION_LEDGER_STATUSES: readonly ConversionLedgerStatus[] = [
  "detected",
  "queued",
  "converting",
  "ready",
  "failed",
];
export function narrowConversionStatus(status: string): ConversionLedgerStatus | null {
  return (CONVERSION_LEDGER_STATUSES as readonly string[]).includes(status)
    ? (status as ConversionLedgerStatus)
    : null;
}

export const coordinatorClient = {
  base: COORD_BASE,
  health: () => jsonGet<CoordinatorHealth>("/health"),
  runtimeStatus: () => jsonGet<RuntimeStatus>("/api/runtime/status"),
  listIfcReady: (limit = 20) => jsonGet<{ count: number; items: IfcReadyListItem[] }>(`/api/external/ifc-ready?limit=${limit}`),
  minioWatchStatus: () => jsonGet<MinioWatchStatus>("/api/external/minio-watch/status"),
  streamConfig: (sessionId: string) => jsonGet<StreamConfigResponse>(`/api/review-sessions/${encodeURIComponent(sessionId)}/stream-config`),
  conversionQualityMetrics: (conversionJobId: string) =>
    jsonGet<ConversionQualityMetricsResponse>(`/api/conversions/${encodeURIComponent(conversionJobId)}/quality-metrics`),
  conversionPrioritize: (id: string, reason?: string) =>
    jsonPost<ConversionControlResponse>(`/api/conversion/jobs/${encodeURIComponent(id)}/prioritize`, { reason }),
  conversionRetry: (id: string, reason?: string) =>
    jsonPost<ConversionControlResponse>(`/api/conversion/jobs/${encodeURIComponent(id)}/retry`, { reason }),
  conversionWatchToggle: (enabled: boolean, reason?: string) =>
    jsonPut<MinioWatchStatus>("/api/conversion/watch", { enabled, reason }),
  // IX-SS-04：operator「結束 session」＝協作式 close 的觸發。重用既有 jsonPost；body 只帶 reason，
  // 不帶 final_events（operator 強制結束無協作終結事件，spec §4.2）。
  sessionClose: (sessionId: string, reason?: string) =>
    jsonPost<SessionCloseResponse>(`/api/review-sessions/${encodeURIComponent(sessionId)}/close`, { reason }),
  // VG-01：列 active review session（A1 頁 session 下拉，S2）。
  // 已查證（2026-06-22 grep app.ts）：無 bare GET /api/review-sessions（spec §1.3 誤判）→
  // 用 /api/runtime/status.sessions.items 為唯一真源。回傳統一成 { items: RuntimeSessionSummary[] }，
  // 讓 A1 page 端 mapping 不變。
  listReviewSessions: async (): Promise<{ items: RuntimeSessionSummary[] }> => {
    const rt = await jsonGet<RuntimeStatus>("/api/runtime/status");
    return { items: rt.sessions.items };
  },
  // VG-01：viewer 首幀回報轉發（viewer postMessage first_frame → console → coordinator）。viewer 不直連 coordinator。
  // 後端 route = POST /api/review-sessions/:sessionId/first-frame（app.ts:878，task#0 落地）。
  reportFirstFrame: (sessionId: string, endpointId?: string) =>
    jsonPost<{ session_id: string; first_frame_at: string }>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/first-frame`,
      { endpoint_id: endpointId },
    ),
  // 既有 viewer attach 入口（coordinator server-side redirect 至 browser-visible viewer URL）。
  // P4 Review Room「在既有 viewer 開啟」用此組 URL（不動 App.tsx / Window.tsx）。
  openInViewerUrl: (sessionId: string) => `${COORD_BASE}/ui/open?session=${encodeURIComponent(sessionId)}`,
  // Task 5 MinIO 閉環 Phase 1：讀持久 ConversionLedger（GET /api/conversion/records）。
  // detected_at desc；limit 預設 50（符合 Task 3 route 行為）。
  getConversionRecords: (limit = 50) =>
    jsonGet<{ count: number; items: ConversionRecord[] }>(`/api/conversion/records?limit=${limit}`),
  // Task 5 MinIO 閉環 Phase 1：唯讀 S3 list proxy（GET /api/minio/objects）。
  // prefix 可省略（使用後端預設 config.minioWatchPrefix）；有值時 encodeURIComponent 防注入。
  getMinioObjects: (prefix?: string) =>
    jsonGet<{ bucket: string | null; count: number; objects: MinioObject[] }>(
      `/api/minio/objects${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`,
    ),
  // Task 6 MinIO 資料夾導覽：帶 delimiter=/ 的 S3 list proxy（GET /api/minio/objects?delimiter=/）。
  // 回 MinioFolderListing（folders = CommonPrefixes，objects = 當層直屬物件）。
  // prefix 可省略（頂層 list）；有值時 encodeURIComponent 防注入。
  // 注意：delimiter=/ 必須 encodeURIComponent → %2F，否則部分 proxy/framework 解析異常。
  getMinioFolder: (prefix?: string): Promise<MinioFolderListing> => {
    const params = new URLSearchParams({ delimiter: "/" });
    if (prefix) params.set("prefix", prefix);
    return jsonGet<MinioFolderListing>(`/api/minio/objects?${params.toString()}`);
  },
  // A1（B2）：操作員手動把 MinIO 物件排入 IFC→USD 轉檔（POST /api/conversion/trigger {key}）。
  // 前端只送 key；presign 與 webhook secret 一律 coordinator server-side（誠實／簽章不出瀏覽器）。
  // §3.4 對齊：minio-folderview 的一鍵觸發鈕改採此 main 端點（IP allowlist 守門），不再自帶 x-dev-token 版。
  triggerConversion: (key: string) =>
    jsonPost<TriggerConversionResponse>("/api/conversion/trigger", { key }),
  // A1（B2）：單一 ifc-ready job 輪詢（讀 conversion_lifecycle_status）。
  getIfcReadyJob: (jobId: string) =>
    jsonGet<IfcReadyJobDetail>(`/api/external/ifc-ready/${encodeURIComponent(jobId)}`),
};
