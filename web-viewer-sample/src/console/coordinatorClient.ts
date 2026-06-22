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
    throw new Error(`coordinator ${path} -> ${res.status} ${res.statusText}`);
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
};
