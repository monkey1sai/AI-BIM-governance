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

const env = (import.meta as { env?: Record<string, string> }).env;
function defaultCoordinatorBase(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:8004";
  const { origin, pathname, port } = window.location;
  const devPorts = new Set(["5173", "5174", "5180"]);
  if (pathname.startsWith("/ui") && !devPorts.has(port)) return origin;
  return "http://127.0.0.1:8004";
}

const COORD_BASE: string =
  env?.VITE_COORDINATOR_API_BASE ?? env?.VITE_COORDINATOR_BASE ?? defaultCoordinatorBase();

async function jsonGet<T>(path: string): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`coordinator ${path} -> ${res.status} ${res.statusText}`);
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
// 其餘以 passthrough 保留。GPU / 首幀 / conversion 秒數**不在**此回應內 → 前端不得捏造。
export interface RuntimeSessionSummary {
  session_id: string;
  status: string;
  project_id: string;
  model_version_id: string;
  participant_count: number;
  expected_stage_url: string | null;
  conversion_status: string | null;
  kit_instance_ids: string[];
  created_at: string;
  updated_at: string;
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
  review_session_id: string | null;
  viewer_url: string | null;
  expected_stage_url: string | null;
  expected_mapping_url: string | null;
  created_at: string;
}

// F 頁 stream-config（app.ts:510）。GPU 遙測不在此回應 → 不捏造。
export interface StreamConfigResponse {
  session_id: string;
  status: string;
  kit_instances?: unknown[];
  [k: string]: unknown;
}

export const coordinatorClient = {
  base: COORD_BASE,
  health: () => jsonGet<CoordinatorHealth>("/health"),
  runtimeStatus: () => jsonGet<RuntimeStatus>("/api/runtime/status"),
  listIfcReady: (limit = 20) => jsonGet<{ count: number; items: IfcReadyListItem[] }>(`/api/external/ifc-ready?limit=${limit}`),
  streamConfig: (sessionId: string) => jsonGet<StreamConfigResponse>(`/api/review-sessions/${encodeURIComponent(sessionId)}/stream-config`),
  // 既有 viewer attach 入口（coordinator server-side redirect 至 browser-visible viewer URL）。
  // P4 Review Room「在既有 viewer 開啟」用此組 URL（不動 App.tsx / Window.tsx）。
  openInViewerUrl: (sessionId: string) => `${COORD_BASE}/ui/open?session=${encodeURIComponent(sessionId)}`,
};
