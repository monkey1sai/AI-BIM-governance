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
//   不在此 client 提供。F2⑩（880f20d）起 coordinator 另開瀏覽器可達的 redacted 摘要
//   GET /api/callback-outbox/summary（明確排除 payload/target_url）→ getCallbackOutboxSummary。

import { defaultCoordinatorBase } from "./coordinatorBase";
import type { components as kitManagerComponents } from "../generated/kit-manager-api";
import type { IssueRow, RuleRunHistoryResponse } from "./governanceClient";

const COORD_BASE: string =
  import.meta.env.VITE_COORDINATOR_API_BASE
  ?? import.meta.env.VITE_COORDINATOR_BASE
  ?? defaultCoordinatorBase();

// W4（2026-07-10）：operator 頁（KitConsolePage / RealIfcConsolePage）需要「原樣顯示 HTTP 狀態碼」
// 的 raw fetch 語意（非 2xx 是值不是錯誤），不能走會 throw 的 jsonGet——但裸相對路徑在
// dev :5173→:8004 分離部署會斷。匯出 base 組 URL helper：raw 語意保留、base 解析統一。
export function coordinatorUrl(path: string): string {
  return `${COORD_BASE}${path}`;
}

export function isSecureOperatorTransport(base: string = COORD_BASE): boolean {
  try {
    const url = new URL(base, window.location.origin);
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

// F12（2026-07-10）：共用 fetch 原語內建逾時——wedged socket 過去會讓 await 永久 pending，
// 呼叫端 busy 卡死只能整頁重載（SharedStatusProvider 自建 watchdog 自救，其他消費端裸奔）。
// 保護下沉到原語層：預設 15s（輪詢 GET 為 1s cadence 短請求，15s 天花板安全）；
// __setFetchTimeoutMsForTests 僅測試 seam。
let FETCH_TIMEOUT_MS = 15000;
export function __setFetchTimeoutMsForTests(ms: number | null): void {
  FETCH_TIMEOUT_MS = ms ?? 15000;
}
function fetchTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

// unified-console-runtime-truth slice 2（D3）：呼叫端需要區分「404＝dev routes 已關閉（canonical-linux）」
// 與其他失敗，但既有 `coordinator <path> -> <status> <detail>` 訊息格式已被多處 String(e) 顯示依賴——
// 故以 Error 子類攜帶 status／path，message 逐字不變。目前只有 jsonGet 丟此類（消費者：getTestDataProjects、
// getConversionsHistory）；其他原語維持既有 Error（不在本切片範圍）。
export class CoordinatorHttpError extends Error {
  constructor(readonly path: string, readonly status: number, detail: string) {
    super(`coordinator ${path} -> ${status} ${detail}`);
    this.name = "CoordinatorHttpError";
  }
}

/** 404 專屬判定：/api/dev/* 於 ENABLE_DEV_ROUTES=false 回 404 → 消費者顯示「dev routes 已關閉」而非泛用錯誤。 */
export function isCoordinatorNotFound(error: unknown): boolean {
  return error instanceof CoordinatorHttpError && error.status === 404;
}

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, { headers: { Accept: "application/json" }, signal: fetchTimeoutSignal() });
  if (!res.ok) {
    // 與 jsonPost/jsonPut 一致萃取 coordinator `{ detail }`（誠實鐵律）：getIfcReadyJob 等輪詢 GET
    // 失敗時，A1 狀態行直接把 .message 顯給操作員；只 throw statusText 會把後端「job 不存在 /
    // 未配置」等可操作提示吞成無意義的 "404 Not Found"。errorDetail best-effort，無 body 才退 statusText。
    throw new CoordinatorHttpError(path, res.status, await errorDetail(res));
  }
  return res.json() as Promise<T>;
}

async function jsonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: fetchTimeoutSignal(),
  });
  if (!res.ok) {
    // 與 jsonPut 一致：萃取 coordinator `{ detail }`（誠實鐵律）。sessionClose 等 controlled
    // action 的 400「sessionId 不合法」/ 404「session 不存在」須在 dialog 顯出可操作提示，
    // 只 throw status/statusText 會把後端訊息吞掉（errorDetail 說明見下）。
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

async function jsonPostWithHeaders<T>(path: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
    signal: fetchTimeoutSignal(),
  });
  if (!res.ok) {
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
    signal: fetchTimeoutSignal(),
  });
  if (!res.ok) {
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

async function jsonPutWithHeaders<T>(path: string, body: Record<string, unknown>, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: fetchTimeoutSignal(),
  });
  if (!res.ok) {
    throw new Error(`coordinator ${path} -> ${res.status} ${await errorDetail(res)}`);
  }
  return res.json() as Promise<T>;
}

import type {
  ArtifactHealthSnapshot as ContractArtifactHealthSnapshot,
  CallbackOutboxEntry,
  CallbackOutboxSummary as ContractCallbackOutboxSummary,
  ClaimViewerLeaseResponse,
  ClosedSessionItem,
  ClosedSessionPage,
  ConversionLedgerStatus as ContractConversionLedgerStatus,
  ConversionPrioritizeResponse,
  ConversionQualityMetricsResponse as ContractConversionQualityMetricsResponse,
  ConversionRecordItem,
  ConversionRetryResponse,
  ConversionTriggerResponse,
  CreateReviewSessionBindingInput as ContractCreateReviewSessionBindingInput,
  CreateReviewSessionRequest as ContractCreateReviewSessionRequest,
  IfcReadyDetailResponse,
  IfcReadyListItem as ContractIfcReadyListItem,
  IfcReadyReviewSessionOpen,
  IssueSnapshotAccepted,
  KitMediaState as ContractKitMediaState,
  KitRuntimeHealthEntry as ContractKitRuntimeHealthEntry,
  MinioFolderBrowsePayload,
  MinioFolderNode as ContractMinioFolderNode,
  MinioNotConfiguredListing,
  MinioObjectView,
  MinioWatchDisabledStatus,
  MinioWatcherStatus,
  PublicViewerLease,
  ReadyReviewIntentRequest,
  ReadyReviewSessionResponse as ContractReadyReviewSessionResponse,
  RecreateSessionResponse,
  ReviewSession,
  RuntimeIfcReadyJob as ContractRuntimeIfcReadyJob,
  RuntimeKitBinding as ContractRuntimeKitBinding,
  RuntimeSessionSummary as ContractRuntimeSessionSummary,
  RuntimeStatusResponse,
  SessionIdlePolicyResponse,
  StreamConfigResponse as ContractStreamConfigResponse,
  ViewerLeaseRole as ContractViewerLeaseRole,
  ViewerLeaseStatus as ContractViewerLeaseStatus,
} from "../contract/coordinatorApi";

// ── Coordinator Browser Contract：以下名稱保留給既有 call site，定義一律由生成契約推導 ──
// （src/contract/coordinatorApi.ts ← generated/coordinator-api.ts ← tests/contracts/*.openapi.json）。
// 不在契約內的面（/health、/api/dev/*、kit-manager proxy、SSE）仍手寫，見本區塊尾。

export type SessionIdlePolicy = SessionIdlePolicyResponse;
export type ArtifactHealthSnapshot = ContractArtifactHealthSnapshot;
export type RuntimeSessionSummary = ContractRuntimeSessionSummary;
export type ViewerLeaseRole = ContractViewerLeaseRole;
export type ViewerLeaseStatus = ContractViewerLeaseStatus;
export type ViewerLeaseSummary = PublicViewerLease;
export type ViewerLeaseClaimResponse = ClaimViewerLeaseResponse;
export type RuntimeKitBinding = ContractRuntimeKitBinding;
export type RuntimeIfcReadyJob = ContractRuntimeIfcReadyJob;
export type KitMediaState = ContractKitMediaState;
export type KitRuntimeHealthEntry = ContractKitRuntimeHealthEntry;
export type RuntimeStatus = RuntimeStatusResponse;
export type ClosedReviewSessionItem = ClosedSessionItem;
export type ClosedReviewSessionPage = ClosedSessionPage;
export type RecreateReviewSessionResponse = RecreateSessionResponse;
/** 明確意圖（legacy 的空物件不由前端送出）。 */
export type ReadyReviewIntent = Extract<ReadyReviewIntentRequest, { mode: string }>;
export type ReadyReviewSessionResponse = ContractReadyReviewSessionResponse;
export type IfcReadyListItem = ContractIfcReadyListItem;

export type ConversionLifecycleStatus = ContractConversionLedgerStatus;
// 值集由契約型別鎖定：陣列若多列或少列一個值，`satisfies` 與下方完整性斷言即在編譯期失敗。
export const CONVERSION_LIFECYCLE_STATUS_VALUES = ["detected", "queued", "converting", "ready", "failed"] as const satisfies readonly ConversionLifecycleStatus[];
type ConversionLifecycleValuesComplete = ConversionLifecycleStatus extends (typeof CONVERSION_LIFECYCLE_STATUS_VALUES)[number] ? true : never;
export const conversionLifecycleValuesComplete: ConversionLifecycleValuesComplete = true;

/** 契約把 trigger 回應記為上游 passthrough；前端額外依賴 ifc_ready_job_id 存在（消費端假設，非契約保證）。 */
export type TriggerConversionResponse = ConversionTriggerResponse & { ifc_ready_job_id: string };
export type IfcReadyJobDetail = IfcReadyDetailResponse;
export type IfcReadyReviewSessionResponse = IfcReadyReviewSessionOpen;
/** GET /api/external/minio-watch/status 是 enabled/disabled 兩種形狀的 union；此為既有消費端沿用的扁平化視圖。 */
export type MinioWatchStatus =
  & { enabled: boolean }
  & Partial<Omit<MinioWatcherStatus, "enabled">>
  & Partial<Omit<MinioWatchDisabledStatus, "enabled">>;
export type StreamConfigResponse = ContractStreamConfigResponse;
export type ConversionQualityMetricsResponse = ContractConversionQualityMetricsResponse;
export type ConversionControlResponse = ConversionPrioritizeResponse | ConversionRetryResponse;
export type SessionCloseResponse = Pick<ReviewSession, "session_id" | "status">;
export type CreateReviewSessionBindingInput = ContractCreateReviewSessionBindingInput;
export type CreateReviewSessionRequest = ContractCreateReviewSessionRequest;
export type CreateReviewSessionResponse = ReviewSession;
/** 前端顯示用的狀態機；wire 上契約為 string，消費端須自行 narrow。 */
export type CallbackOutboxEntryStatus = "pending" | "delivered" | "dead_letter";
export type CallbackOutboxSummaryEntry = CallbackOutboxEntry;
export type CallbackOutboxSummary = ContractCallbackOutboxSummary;
export type IssueSnapshotResponse = IssueSnapshotAccepted;
export type ConversionLedgerStatus = ContractConversionLedgerStatus;
export type ConversionRecord = ConversionRecordItem;
export type MinioObject = MinioObjectView;
export type MinioFolderNode = ContractMinioFolderNode;
/** getMinioFolder 永遠帶 delimiter=/，回應為 folder 瀏覽或「未設定」兩種之一；此為兩者的扁平化視圖。 */
export type MinioFolderListing =
  & Omit<MinioFolderBrowsePayload, "bucket" | "cache">
  & { bucket: string | null; cache?: MinioFolderBrowsePayload["cache"]; note?: MinioNotConfiguredListing["note"] };

// ── 契約外的面（維持手寫）─────────────────────────────────────────────────

// /health 真實回應形狀（app.ts）。不在 Coordinator Browser Contract 內。
export interface CoordinatorHealth {
  status: string;
  service: string;
  kit_signaling_port: number;
}

// Conversion-service job history pass-through (GET /api/dev/conversions → proxied to conversion service).
// /api/dev/* 不在契約內；shape is a pass-through artifact from an external service; type it loosely.
export interface DevConversionRecord {
  conversion_job_id?: string;
  status?: string;
  source_ifc_filename?: string;
  [k: string]: unknown;
}

export interface DevConversionArtifact {
  artifact_id?: string;
  role?: string;
  url?: string;
  [k: string]: unknown;
}

export interface DevConversionResult {
  status?: string;
  ready?: boolean;
  artifacts?: Record<string, DevConversionArtifact>;
  [k: string]: unknown;
}

// C1 契約收斂（2026-07-21）：KitInstanceState 改由 kit-manager-api openapi 生成型別 alias
// （generated/kit-manager-api.ts，再生成：cd web-viewer-sample && npm run generate:api-types）。
// Drift 註記：openapi 契約僅標 instance_id/status 為 required（pydantic 有 default 的欄位不入
// required），但後端序列化恆帶全部欄位——wire 上實際必存在。故以 Required<> 做最小 local 收緊。
export type KitInstanceState = Required<kitManagerComponents["schemas"]["KitInstanceState"]>;

// GET /api/kit/health 是 coordinator 對 kit-manager /health 的 forward-only proxy；body 由 kit-manager 決定。
export interface KitHealth {
  status?: string;
  [k: string]: unknown;
}

// SSE frame（GET /api/minio/events），非 REST 契約。
export interface MinioChangeEvent {
  type: "minio.changed";
  prefixes: string[];
  reason?: string;
  at: string;
}

// Task 6 chip-patch runtime guard：wire 的寬 string status → ConversionLedgerStatus runtime narrow。
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
  listClosedReviewSessions: (limit = 20, cursor?: string) => {
    const params = new URLSearchParams({ status: "closed", limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return jsonGet<ClosedReviewSessionPage>(`/api/review-sessions?${params.toString()}`);
  },
  recreateReviewSession: (closedSessionId: string, idempotencyKey: string) =>
    jsonPostWithHeaders<RecreateReviewSessionResponse>(
      `/api/review-sessions/${encodeURIComponent(closedSessionId)}/recreate`,
      {},
      { "Idempotency-Key": idempotencyKey },
    ),
  kitInstanceCurrent: () => jsonGet<KitInstanceState>("/api/kit/instances/current"),
  listIfcReady: (limit = 20) => jsonGet<{ count: number; items: IfcReadyListItem[] }>(`/api/external/ifc-ready?limit=${limit}`),
  createReviewSessionForIfcReady: (jobId: string) =>
    jsonPost<IfcReadyReviewSessionResponse>(`/api/external/ifc-ready/${encodeURIComponent(jobId)}/review-session`, {}),
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
  // A3-G1：由 federation review-room descriptor 建 review session（POST /api/review-sessions）。
  // 形狀見 CreateReviewSessionRequest 註；成功 HTTP 200 回 session JSON，失敗（409 無 Kit 容量 /
  // 400 schema）由 jsonPost 萃取 detail 後 throw。
  createReviewSession: (body: CreateReviewSessionRequest) =>
    jsonPost<CreateReviewSessionResponse>("/api/review-sessions", body),
  claimViewerLease: (sessionId: string, body: {
    viewer_id: string;
    user_id?: string;
    display_name?: string | null;
    requested_role?: "auto" | "primary" | "spectator";
    client_nonce?: string | null;
    preferred_kit_instance_id?: string | null;
  }, userToken: string) =>
    jsonPostWithHeaders<ViewerLeaseClaimResponse>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/claim`,
      body,
      { "X-User-Token": userToken },
    ),
  viewerLeaseHeartbeat: (
    sessionId: string,
    leaseId: string,
    leaseToken: string,
    body: { first_frame?: boolean; loaded_stage_url?: string | null; datachannel_ready?: boolean },
  ) =>
    jsonPostWithHeaders<ViewerLeaseSummary>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(leaseId)}/heartbeat`,
      body,
      { "X-Viewer-Lease-Token": leaseToken },
    ),
  releaseViewerLease: (sessionId: string, leaseId: string, leaseToken: string) =>
    jsonPostWithHeaders<ViewerLeaseSummary>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(leaseId)}/release`,
      {},
      { "X-Viewer-Lease-Token": leaseToken },
    ),
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
  // A4 Handoff：建立 session-scoped transient 3D handoff intent。
  createA4Handoff: (
    sessionId: string,
    body: { action: "focus" | "highlight"; evidence_proofs: string[] },
    userToken: string,
  ) =>
    jsonPostWithHeaders<{
      handoff_id: string;
      url: string;
      expires_at: string;
      action: "focus" | "highlight";
      prim_paths: string[];
      binding: unknown;
    }>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/a4-handoffs`,
      body,
      { "X-User-Token": userToken },
    ),
  // Task 5 MinIO 閉環 Phase 1：讀持久 ConversionLedger（GET /api/conversion/records）。
  // detected_at desc；limit 預設 50（符合 Task 3 route 行為）。
  getConversionRecords: (limit = 50) =>
    jsonGet<{ count: number; items: ConversionRecord[] }>(`/api/conversion/records?limit=${limit}`),
  getObjectConversionHistory: (key: string, sourceId: string) =>
    jsonGet<{ count: number; items: ConversionRecord[] }>(`/api/conversion/records?limit=100&object_key=${encodeURIComponent(key)}&source_id=${encodeURIComponent(sourceId)}`),
  reconvertIfc: (key: string, requestId: string, expectedEtag: string) =>
    jsonPost<{ ready_model_id: string; status?: string; conversion_job_id?: string | null; intent_replay: boolean }>(
      "/api/conversion/trigger", { key, force_retrigger: true, request_id: requestId, expected_etag: expectedEtag }),
  readyReviewSession: (readyModelId: string, intent: ReadyReviewIntent) =>
    jsonPost<ReadyReviewSessionResponse>(`/api/conversion/records/${encodeURIComponent(readyModelId)}/review-session`, intent),
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
  minioEventsUrl: () => `${COORD_BASE}/api/minio/events`,
  getMinioFolder: (prefix?: string, options?: { refresh?: boolean }): Promise<MinioFolderListing> => {
    const params = new URLSearchParams({ delimiter: "/" });
    if (prefix) params.set("prefix", prefix);
    if (options?.refresh) params.set("refresh", "1");
    return jsonGet<MinioFolderListing>(`/api/minio/objects?${params.toString()}`);
  },
  // A1（B2）：操作員手動把 MinIO 物件排入 IFC→USD 轉檔（POST /api/conversion/trigger {key}）。
  // 前端只送 key；presign 與 webhook secret 一律 coordinator server-side（誠實／簽章不出瀏覽器）。
  // §3.4 對齊：minio-folderview 的一鍵觸發鈕改採此 main 端點（IP allowlist 守門），不再自帶 x-dev-token 版。
  triggerConversion: (key: string, options?: { forceRetrigger?: boolean }) =>
    jsonPost<TriggerConversionResponse>(
      "/api/conversion/trigger",
      options?.forceRetrigger === true ? { key, force_retrigger: true } : { key },
    ),
  // A1（B2）：單一 ifc-ready job 輪詢（讀 conversion_lifecycle_status）。
  getIfcReadyJob: (jobId: string) =>
    jsonGet<IfcReadyJobDetail>(`/api/external/ifc-ready/${encodeURIComponent(jobId)}`),
  // CV 轉檔歷史（純前端補洞）：讀既有 GET /api/dev/conversions（conversion service 側 job 歷史，
  // 與 coordinator ledger getConversionRecords 不同源）。後端不改（N2/N4）。
  getConversionsHistory: () =>
    jsonGet<{ items: DevConversionRecord[]; count?: number }>("/api/dev/conversions"),
  getConversionResult: (jobId: string) =>
    jsonGet<DevConversionResult>(`/api/dev/conversions/${encodeURIComponent(jobId)}/result`),
  // R8（2026-07-10）：local_fs 測試 fixtures 專案清單（coordinator config 驅動；
  // 前端只渲染「測試資料」badge，編號不進程式碼——D-05／鐵律 #3）。
  getTestDataProjects: () =>
    jsonGet<{ projects: string[] }>("/api/dev/test-data-projects"),
  // F2⑩ 瀏覽器觀測面：redacted callback outbox 摘要（無 token；newest-first）。
  // limit 預設 50 對齊後端預設；後端上限 200、非法值 400（帶 detail，jsonGet 萃取後 throw）。
  getCallbackOutboxSummary: (limit = 50) =>
    jsonGet<CallbackOutboxSummary>(`/api/callback-outbox/summary?limit=${limit}`),
  // F2⑩：issue/檢核統計 metadata-only 回拋雲端。瀏覽器只送識別碼
  // （rule_run_id / 可選 model_version_id）；統計由 coordinator server-side 向 governance 查詢，
  // 查不到回 502 不入列（誠實，不偽造統計）。成功 202 帶 outbox_id。
  postIssueSnapshot: (sessionId: string, body: { rule_run_id: string; model_version_id?: string }) =>
    jsonPost<IssueSnapshotResponse>(
      `/api/review-sessions/${encodeURIComponent(sessionId)}/issue-snapshot`,
      body,
    ),
  // unified-console-runtime-truth（edge-console-operator-frontend MODIFIED：允許端點清單擴充）。
  // 三者皆為既有 :8004 端點（app.ts:3779、governanceProxy.ts:521,223）；共用 poller 唯一入口，
  // 讓 vitest 一律於 coordinatorClient 層 spy 注入 mock。
  kitHealth: () => jsonGet<KitHealth>("/api/kit/health"),
  governanceIssues: () => jsonGet<{ issues: IssueRow[] }>("/api/governance/issues"),
  governanceRuleRuns: (limit = 5) => jsonGet<RuleRunHistoryResponse>(`/api/governance/rule-runs?limit=${limit}`),
  getSessionIdleStatus: (sessionId: string) =>
    jsonGet<{
      session_id: string;
      enabled: boolean;
      has_connected_viewer: boolean;
      is_counting_down: boolean;
      remaining_seconds: number | null;
      last_activity_at: string | null;
    }>(`/api/review-sessions/${encodeURIComponent(sessionId)}/idle-status`),
  getSessionIdlePolicy: () =>
    jsonGet<SessionIdlePolicy>("/api/runtime/session-idle-policy"),
  updateSessionIdlePolicy: (
    timeoutMs: number | null,
    expectedRevision: number,
    expectedProcessEpoch: string,
    reason: string,
    operatorToken: string,
  ) => {
    if (!isSecureOperatorTransport()) {
      return Promise.reject(new Error("operator credential transport requires HTTPS or exact loopback HTTP"));
    }
    return jsonPutWithHeaders<SessionIdlePolicy>(
      "/api/runtime/session-idle-policy",
      {
        timeout_ms: timeoutMs,
        expected_revision: expectedRevision,
        expected_process_epoch: expectedProcessEpoch,
        reason,
      },
      { "X-Operator-Token": operatorToken },
    );
  },
};
