// A1 治理 rule-run client — 只打 coordinator :8004 的 /api/governance/* proxy（loopback 轉發至
// governance-service 127.0.0.1:49102）。瀏覽器永不直連內部服務（邊界 B1）。
// coordinator base 用全站／部署一致的正規 env 名 VITE_COORDINATOR_API_BASE（compose 注入、deploy.ps1
// 經 WEB_VIEWER_COORDINATOR_API_BASE 設定、config/env.ts 亦讀此名）。保留舊名 VITE_COORDINATOR_BASE
// 為相容 fallback（正規名優先），預設與 config/env.ts 一致為 http://127.0.0.1:8004。
import { defaultCoordinatorBase } from "./coordinatorBase";

const COORD_BASE: string =
  import.meta.env.VITE_COORDINATOR_API_BASE
  ?? import.meta.env.VITE_COORDINATOR_BASE
  ?? defaultCoordinatorBase();

export interface RuleRunRequest {
  ifc_source_path: string;
  rule_set?: string;
  model_version_id?: string;
  element_mapping_path?: string;
  ids_path?: string; // 提供時改用 buildingSMART IDS（ifctester）
}

export interface RuleRunSourceMetadata {
  source_kind?: string | null;
  ifc_ready_job_id?: string | null;
  idempotency_key?: string | null;
  project_id?: string | null;
  project_display_name?: string | null;
  model_category?: string | null;
  model_version_id?: string | null;
  source_ifc_etag?: string | null;
  review_session_id?: string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
}

export interface RuleRunStatus {
  rule_run_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  score: number | null;
  rule_set: string;
  model_version_id: string | null;
  source_metadata?: RuleRunSourceMetadata | null;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    unique_elements?: number;
    target_summary: Record<string, number>;
    warnings: string[];
  } | null;
}

export interface RuleRunHistoryItem extends RuleRunStatus {
  started_at: string | null;
  finished_at: string | null;
}

export interface RuleRunHistoryFilters {
  project_id?: string;
  model_category?: string;
  model_version_id?: string;
  ifc_ready_job_id?: string;
  idempotency_key?: string;
  review_session_id?: string;
  limit?: number;
  offset?: number;
}

export interface RuleRunHistoryResponse {
  filters: Record<string, string>;
  limit: number;
  offset: number;
  total: number;
  items: RuleRunHistoryItem[];
}

export interface RuleResultRow {
  ifc_guid: string | null;
  usd_prim_path: string | null;
  rule_code: string;
  severity: string;
  status: "pass" | "fail" | "error";
  message: string;
  mapping_information_status?: string | null;
  mapping_issue_code?: string | null;
  mapping_issue_count?: number | null;
}

// A1 §4.2 失敗構件抽屜：後端開 model 補 name/type/storey（查詢期 enrichment，非持久化）。
export interface FailureRow {
  ifc_guid: string | null;
  ifc_name: string | null;
  ifc_type: string | null;
  storey: string | null;
  severity: string | null; // DB severity TEXT 可為 NULL → 後端 r.get("severity") 回 JSON null
  rule_code: string;
  message: string;
  usd_prim_path: string | null;
}

export interface FailuresResponse {
  rule_run_id: string;
  rule_code: string | null; // 過濾時回填該規則碼；未過濾為 null
  limit: number;
  offset: number;
  total: number;
  items: FailureRow[];
}

// F12（2026-07-10）：governance 面同樣把逾時下沉到原語層（與 coordinatorClient 對稱）；
// __setGovFetchTimeoutMsForTests 僅測試 seam。呼叫端可自帶 init.signal 覆寫（保留彈性）。
const DEFAULT_GOV_FETCH_TIMEOUT_MS = 15_000;
const A4_MODEL_SEARCH_FETCH_TIMEOUT_MS = 150_000;
let GOV_FETCH_TIMEOUT_MS = DEFAULT_GOV_FETCH_TIMEOUT_MS;
export function __setGovFetchTimeoutMsForTests(ms: number | null): void {
  GOV_FETCH_TIMEOUT_MS = ms ?? DEFAULT_GOV_FETCH_TIMEOUT_MS;
}

function a4SearchTimeoutSignal(interpretMode?: ModelSearchInterpretMode): AbortSignal {
  // Governance defaults an omitted mode to auto. Keep model-capable searches
  // above the coordinator's 140-second hard ceiling, without lengthening every
  // governance request or the explicit deterministic path.
  const timeoutMs = interpretMode === "deterministic"
    ? GOV_FETCH_TIMEOUT_MS
    : A4_MODEL_SEARCH_FETCH_TIMEOUT_MS;
  return AbortSignal.timeout(timeoutMs);
}

// A4 safe error surface：A4 的 query/error UI 只能拿到 allowlist 內的 stable code，
// 不得取得 coordinator/upstream diagnostics（避免 endpoint / path / secret 洩漏）。
export type A4SafeErrorCode =
  | "a4_authentication_required"
  | "a4_authentication_unavailable"
  | "a4_session_not_found"
  | "a4_session_not_active"
  | "a4_session_source_unavailable"
  | "a4_primary_authority_required"
  | "a4_authentic_lease_unavailable"
  | "a4_lab_scope_not_enabled"
  | "a4_trusted_context_unavailable"
  | "a4_issue_not_eligible"
  | "invalid_a4_issue_controls"
  | "a4_proof_expired"
  | "a4_proof_unavailable"
  | "partial_fallback_unavailable"
  | "stale_session_artifact"
  | "invalid_a4_search_controls"
  | "governance_service_unavailable";

const A4_SAFE_ERROR_CODES = new Set<A4SafeErrorCode>([
  "a4_authentication_required",
  "a4_authentication_unavailable",
  "a4_session_not_found",
  "a4_session_not_active",
  "a4_session_source_unavailable",
  "a4_primary_authority_required",
  "a4_authentic_lease_unavailable",
  "a4_lab_scope_not_enabled",
  "a4_trusted_context_unavailable",
  "a4_issue_not_eligible",
  "invalid_a4_issue_controls",
  "a4_proof_expired",
  "a4_proof_unavailable",
  "partial_fallback_unavailable",
  "stale_session_artifact",
  "invalid_a4_search_controls",
  "governance_service_unavailable",
]);

export class A4GovernanceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: A4SafeErrorCode,
  ) {
    super(`A4 governance request failed (${status})`);
    this.name = "A4GovernanceError";
  }
}

async function jsonFetch<T>(path: string, init?: RequestInit, options?: { safeError?: boolean }): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    // init.signal 覆寫保留（#384 的 a4SearchTimeoutSignal 靠它把 model-capable
    // search 拉到 150s；移除會讓 semantic search 退回 15s 逾時）。
    signal: init?.signal ?? AbortSignal.timeout(GOV_FETCH_TIMEOUT_MS),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (options?.safeError) {
      // A4 query/error surfaces must not acquire coordinator/upstream diagnostics.
      let code: A4SafeErrorCode | undefined;
      try {
        const body = await res.clone().json() as { error_code?: unknown; detail?: { code?: unknown } };
        const candidate = body.error_code ?? body.detail?.code;
        if (typeof candidate === "string" && A4_SAFE_ERROR_CODES.has(candidate as A4SafeErrorCode)) {
          code = candidate as A4SafeErrorCode;
        }
      } catch {
        // HTTP status remains safe when no allowlisted code is available.
      }
      throw new A4GovernanceError(res.status, code);
    }
    let detail = res.statusText;
    try {
      const body = await res.clone().json() as { detail?: unknown; error?: unknown; reason?: unknown };
      const picked = body.detail ?? body.error ?? body.reason;
      detail = typeof picked === "string" ? picked : JSON.stringify(body);
    } catch {
      try {
        const text = await res.text();
        if (text.trim()) detail = text.trim();
      } catch {
        // Keep statusText fallback.
      }
    }
    throw new Error(`governance proxy ${path} -> ${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

function localDevPrincipalHeaders(userToken: string): Record<string, string> {
  if (!userToken) {
    throw new Error("A4 local-dev principal carrier is required.");
  }
  return { "X-User-Token": userToken };
}

export const governanceClient = {
  base: COORD_BASE,
  // A1 file-library browse：唯讀 local file-server tree（storage/{projectId}/{modelId}/*.ifc）。
  // 經 coordinator :8004 proxy → governance-service /api/files/tree。source_kind 為誠實標記
  // （local_fs；未來真 MinIO 接上改 s3）。
  filesTree: () => jsonFetch<FilesTreeResponse>("/api/governance/files/tree"),
  createRuleRun: (req: RuleRunRequest) =>
    jsonFetch<{ rule_run_id: string; status: string }>("/api/governance/rule-runs", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  // 統一治理控制台 MVP（W1）：由 review session 直接起 rule-run；server IFC 路徑由 coordinator 端解析
  // （瀏覽器不持有、不手填模型路徑，守邊界 B1）。後端誠實 404（無進件 IFC）/ 502（governance 離線）。
  createRuleRunForSession: (sessionId: string, body?: { ids_path?: string; rule_set?: string }) =>
    jsonFetch<{ rule_run_id: string; status: string }>(
      `/api/governance/rule-runs/for-session/${encodeURIComponent(sessionId)}`,
      { method: "POST", body: JSON.stringify(body ?? {}) }
    ),
  // A1 MinIO downloaded/no-session path：browser 只傳 ifc_ready_job_id，由 coordinator
  // server-side 解析 host IFC path，並排入 governance CPU rule-run queue；
  // 不把 MinIO key 或 host_local_path 當 ifc_source_path，也不排 IFC->USD 轉檔。
  createRuleRunForIfcReady: (ifcReadyJobId: string, body?: { ids_path?: string; rule_set?: string }) =>
    jsonFetch<{ rule_run_id: string; status: string }>(
      `/api/governance/rule-runs/for-ifc-ready/${encodeURIComponent(ifcReadyJobId)}`,
      { method: "POST", body: JSON.stringify(body ?? {}) }
    ),
  // A1 local_fs（file-library）：files/tree 對瀏覽器把 version.path 遮蔽成 "[server-path]"，
  // 瀏覽器不可能回送真路徑。改送 {project_id, model_id, version_name} 邏輯三段，coordinator
  // server-side 解析真 IFC path 後轉發 governance rule-run（守邊界 B1，同 for-session 語意）。
  // 後端誠實：404 library_version_not_found（version 解析不到）/ 502（governance 離線）。
  createRuleRunForLibrary: (req: LibraryRuleRunRequest) =>
    jsonFetch<{ rule_run_id: string; status: string }>("/api/governance-library/rule-runs", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  listRuleRuns: (filters: RuleRunHistoryFilters = {}) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return jsonFetch<RuleRunHistoryResponse>(`/api/governance/rule-runs${suffix}`);
  },
  getRuleRun: (id: string) => jsonFetch<RuleRunStatus>(`/api/governance/rule-runs/${id}`),
  getResults: (id: string, status?: string) =>
    jsonFetch<{ results: RuleResultRow[] }>(
      `/api/governance/rule-runs/${id}/results${status ? `?status=${status}` : ""}`
    ).then((r) => r.results),
  // A1 §4.2 失敗構件抽屜：按規則分組 + 分頁 + 樓層 enrichment（mirror getResults）。
  // 經 coordinator :8004 proxy → governance-service GET /rule-runs/:id/failures。
  getFailures: (id: string, rule?: string, limit = 50, offset = 0) => {
    const qs = new URLSearchParams();
    if (rule) qs.set("rule", rule);
    qs.set("limit", String(limit));
    qs.set("offset", String(offset));
    return jsonFetch<FailuresResponse>(
      `/api/governance/rule-runs/${id}/failures?${qs.toString()}`
    );
  },
  exportUrl: (id: string) => `${COORD_BASE}/api/governance/rule-runs/${id}/export?fmt=excel`,

  // console-mapping-proxy：viewer 經 coordinator :8004 proxy 載入 element_mapping（守邊界：
  // SHALL NOT HTTP 直連 :49101）。多 binding 時以 mappingUrl 指定要哪個 binding 的 mapping
  // （coordinator 以 session binding 白名單驗證，選對 asset 且防任意 URL）。回傳原樣
  // element_mapping JSON（呼叫端以 isElementMappingDocument 驗證）。
  elementMappingForSession: (sessionId: string, mappingUrl?: string) =>
    jsonFetch<unknown>(
      `/api/governance/element-mapping/for-session/${encodeURIComponent(sessionId)}${
        mappingUrl ? `?url=${encodeURIComponent(mappingUrl)}` : ""
      }`
    ),

  // A2 model-version diff（GlobalId 多級對齊）
  createDiff: (req: DiffRequest) =>
    jsonFetch<{ diff_id: string; status: string }>("/api/governance/diffs", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  // A2 diff（file-library）：同 createRuleRunForLibrary 語意——base/target 各送邏輯三段，
  // coordinator server-side 解析雙真路徑後轉發 governance /api/diffs（手填真路徑仍走 createDiff）。
  createDiffForLibrary: (req: LibraryDiffRequest) =>
    jsonFetch<{ diff_id: string; status: string }>("/api/governance-library/diffs", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  getDiff: (id: string) => jsonFetch<DiffStatus>(`/api/governance/diffs/${id}`),
  getDiffItems: (id: string, changeType?: string) =>
    jsonFetch<{ items: DiffItemRow[] }>(
      `/api/governance/diffs/${id}/items${changeType ? `?change_type=${changeType}` : ""}`
    ).then((r) => r.items),
  diffIssueImpact: (id: string) => jsonFetch<DiffIssueImpact>(`/api/governance/diffs/${id}/issue-impact`),
  // 3D colour overlay：後端誠實回 501（p15）—— overlay 走 client highlightPrimsRequest（需 viewer
  // DataChannel），非後端 server-push。不吞錯、不假裝成功：直接回傳後端的 {ok, status, detail}，
  // 由 UI 誠實顯示「後端未提供（p15）」。後端離線（proxy 502）則 ok=false 並帶 detail。
  applyDiffOverlay: (id: string): Promise<DiffOverlayResult> =>
    fetch(`${COORD_BASE}/api/governance/diffs/${id}/apply-overlay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then(async (res) => {
      let detail = "";
      try {
        const body = (await res.json()) as { detail?: string };
        detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
      } catch {
        detail = res.statusText;
      }
      return { ok: res.ok, status: res.status, detail };
    }),

  // A3 cross-discipline federation（OpenUSD sublayer）
  createFederatedSet: (name: string) =>
    jsonFetch<{ set_id: string; status: string }>("/api/governance/federated-sets", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  addFederatedMember: (setId: string, member: FederatedMember) =>
    jsonFetch<{ member_id: string }>(`/api/governance/federated-sets/${setId}/members`, {
      method: "POST",
      body: JSON.stringify(member),
    }),
  validateCoords: (setId: string) =>
    jsonFetch<CoordReport>(`/api/governance/federated-sets/${setId}/validate-coords`, { method: "POST" }),
  buildFederatedSet: (setId: string) =>
    jsonFetch<FederatedBuildResult>(`/api/governance/federated-sets/${setId}/build`, { method: "POST" }),
  reviewRoom: (setId: string) =>
    jsonFetch<ReviewRoomDescriptor>(`/api/governance/federated-sets/${setId}/review-room`),

  // A4 search：deterministic grammar 和/或 Ornith vLLM structured filters。
  // for-session / for-ifc-ready 由 coordinator 解析 host IFC；LLM key 只在 governance env。
  searchLlmStatus: () => jsonFetch<ModelSearchLlmStatus>("/api/governance/search/llm-status"),
  searchModelForSession: async (
    sessionId: string,
    body: { query: string; limit?: number; interpret_mode?: ModelSearchInterpretMode; retry_of_query_id?: string },
    userToken: string,
  ) =>
    jsonFetch<ModelSearchResponse>(
      `/api/governance/search/model/for-session/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        signal: a4SearchTimeoutSignal(body.interpret_mode),
        headers: localDevPrincipalHeaders(userToken),
        body: JSON.stringify(body),
      },
      { safeError: true },
    ),
  searchModelForIfcReady: async (
    ifcReadyJobId: string,
    body: { query: string; limit?: number; interpret_mode?: ModelSearchInterpretMode; retry_of_query_id?: string },
    userToken: string,
  ) =>
    jsonFetch<ModelSearchResponse>(
      `/api/governance/search/model/for-ifc-ready/${encodeURIComponent(ifcReadyJobId)}`,
      {
        method: "POST",
        signal: a4SearchTimeoutSignal(body.interpret_mode),
        headers: localDevPrincipalHeaders(userToken),
        body: JSON.stringify(body),
      },
      { safeError: true },
    ),

  // Issue tracking
  createIssue: (req: IssueCreateRequest) =>
    jsonFetch<IssueRow>("/api/governance/issues", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  listIssues: (status?: string, filters?: { model_version_id?: string; kind?: "issue" | "annotation" }) => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (filters?.model_version_id) qs.set("model_version_id", filters.model_version_id);
    if (filters?.kind) qs.set("kind", filters.kind);
    const q = qs.toString();
    return jsonFetch<{ issues: IssueRow[] }>(`/api/governance/issues${q ? `?${q}` : ""}`).then((r) => r.issues);
  },
  getIssue: (id: string) =>
    jsonFetch<{ issue: IssueRow; events: unknown[] }>(`/api/governance/issues/${encodeURIComponent(id)}`).then((r) => r.issue),
  transitionIssue: (id: string, toStatus: string, note?: string) =>
    jsonFetch<IssueRow>(`/api/governance/issues/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ to_status: toStatus, note }),
    }),
  issuesFromRuleRun: (runId: string) =>
    jsonFetch<{ created: number; issue_ids: string[] }>(`/api/governance/issues/from-rule-run/${runId}`, { method: "POST" }),
  issuesFromDiff: (diffId: string) =>
    jsonFetch<{ created: number; issue_ids: string[] }>(`/api/governance/issues/from-diff/${diffId}`, { method: "POST" }),

  // BCF 匯出（只含正式 issue：kind=issue 且有 ifc_guid）。直連下載 URL。
  bcfExportUrl: (params?: { model_version_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.model_version_id) qs.set("model_version_id", params.model_version_id);
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString();
    return `${COORD_BASE}/api/governance/bcf/export${q ? `?${q}` : ""}`;
  },
};

export interface IssueRow {
  id: string;
  kind: "issue" | "annotation";
  title: string;
  status: string;
  severity: string;
  ifc_guid: string | null;
  usd_prim_path: string | null;
  rule_code?: string | null;
  model_version_id?: string | null;
  source_type: string;
}

export interface IssueCreateRequest {
  title: string;
  description?: string;
  severity?: string;
  ifc_guid?: string | null;
  usd_prim_path?: string | null;
  model_version_id?: string | null;
  assignee?: string | null;
}

export type ModelSearchInterpretMode = "deterministic" | "semantic" | "auto";

export interface ModelSearchLlmStatus {
  service: string;
  enabled: boolean;
  configured: boolean;
  state: string;
  model: string | null;
  checked_at: string | null;
  check_source: string;
  freshness: string;
  ttl_s: number;
  transport_class: string;
  error_code: string | null;
  reference?: string;
  config_source_keys?: string[];
}

export interface ModelSearchPropertyFilter {
  name: string;
  op: string;
  value: number;
}

export interface ModelSearchInterpretedFilters {
  raw_query: string;
  ifc_classes: string[];
  storey_tokens: string[];
  property_filters: ModelSearchPropertyFilter[];
  name_contains: string[];
  unmatched_fragments: string[];
  interpretable: boolean;
  notes: string[];
  interpret_source?: string;
  confidence: number | null;
  confidence_basis: string | null;
}

export interface ModelSearchResultRow {
  ifc_guid: string | null;
  usd_prim_path: string | null;
  ifc_class: string;
  name: string | null;
  storey: string | null;
  properties: Record<string, unknown>;
  match_status: string;
  confidence: number | null;
  confidence_basis?: string | null;
  evidence_refs: string[];
  action_eligible?: boolean;
  proof_eligible?: boolean;
  issue_eligible?: boolean;
  highlight_eligible: boolean;
}

export interface ModelSearchResponse {
  status: "ok" | "uninterpreted" | string;
  query_id?: string;
  retry_of_query_id?: string | null;
  model_version_id?: string | null;
  interpret_mode?: ModelSearchInterpretMode | string;
  search_scope?: "session_table_only" | "ifc_ready_table_only" | "table_only" | string;
  completion_scope?: string;
  proof_eligible?: boolean;
  issue_eligible?: boolean;
  highlight_eligible?: boolean;
  interpreted_filters: ModelSearchInterpretedFilters;
  results: ModelSearchResultRow[];
  stats: {
    total: number;
    matched: number;
    unmapped: number;
    scanned: number;
    returned?: number;
    mapped?: number;
    not_matched?: number;
    truncated?: boolean;
    total_is_lower_bound?: boolean;
    scan_complete?: boolean;
  };
  evidence_refs: unknown[];
  model_invocation?: {
    attempted: boolean;
    served_model: string | null;
    finish_reason: string | null;
    latency_ms: number | null;
    error_code: string | null;
  };
  session_binding?: {
    review_session_id: string | null;
    principal_ref: string | null;
    model_version_id: string | null;
    primary_artifact_id: string | null;
    active_binding_revision: string | null;
    mapping_provenance: "server_resolved" | "unavailable" | null;
    primary_lease_capability: "verified" | "lab_unverified" | null;
  } | null;
  error_code?: string | null;
  retryable?: boolean;
  // partial fallback 的傳輸型別先補齊（後端已可回傳）；本 change 的 UI 不實作
  // partial-confirmation-required / confirmed partial 兩個 visible state，
  // 它們仍屬 deferred 母版 a4-semantic-search-model-qa。
  partial_execution_confirmed?: boolean;
  partial_confirmation_available?: boolean;
  partial_fallback_id?: string | null;
  partial_fallback_expires_at?: string | null;
  next_step?: string | null;
}

export interface DiffRequest {
  base_ifc_path: string;
  target_ifc_path: string;
  base_model_version_id?: string;
  target_model_version_id?: string;
  include_geometry?: boolean;
}
// file-library 邏輯識別（coordinator /api/governance-library/*；型別對齊後端 zod schema）：
// 瀏覽器只持 {project_id, model_id, version_name} 三段，真 IFC path 由 coordinator 解析。
export interface LibraryVersionRef {
  project_id: string;
  model_id: string;
  version_name: string;
}
// library://{project_id}/{model_id}/{version.name} 邏輯識別字串（A1 state.ifcPath / A2 diff input 共用）。
// files/tree 對瀏覽器把 version.path 遮蔽成 "[server-path]"（全部選項同值），path 不能當識別；
// UI 一律以此邏輯字串持有選擇，run/diff 時解回三段送 coordinator server-side 解析。
export const LIBRARY_IFC_PREFIX = "library://";
export function parseLibraryIfcPath(ifcPath: string): LibraryVersionRef | null {
  if (!ifcPath.startsWith(LIBRARY_IFC_PREFIX)) return null;
  // project_id / model_id 為單層目錄名（不含 "/"）；version name 可能帶子目錄段
  //（三層形狀如 "v1/japanese_villa.ifc"）→ 前兩段之後全部歸 version_name。
  const [projectId, modelId, ...rest] = ifcPath.slice(LIBRARY_IFC_PREFIX.length).split("/");
  const versionName = rest.join("/");
  if (!projectId || !modelId || !versionName) return null;
  return { project_id: projectId, model_id: modelId, version_name: versionName };
}
export interface LibraryRuleRunRequest extends LibraryVersionRef {
  ids_path?: string;
  model_version_id?: string;
}
export interface LibraryDiffRequest {
  base: LibraryVersionRef;
  target: LibraryVersionRef;
  include_geometry?: boolean;
  base_model_version_id?: string;
  target_model_version_id?: string;
}
export interface DiffIssueImpact {
  diff_id: string;
  base_model_version_id: string | null;
  note: string;
  possibly_addressed: { count: number; issue_ids: string[] };
  still_open: { count: number; issue_ids: string[] };
  new: { count: number };
}
// apply-overlay 回應：後端目前誠實回 501（p15），故以 ok/status/detail 描述，UI 不假裝成功。
export interface DiffOverlayResult {
  ok: boolean;
  status: number;
  detail: string;
}
export interface DiffStatus {
  diff_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  summary: {
    base_count: number;
    target_count: number;
    matched: number;
    counts: Record<string, number>;
    warnings: string[];
  } | null;
}
export interface DiffItemRow {
  change_type: string;
  ifc_guid: string | null;
  ifc_type?: string | null;
  ifc_name?: string | null;
  change_summary: string;
}

export interface FederatedMember {
  model_version_id: string;
  discipline: string;
  usd_path: string;
  layer_order?: number;
  visibility_default?: boolean;
  root_prim?: string;
  transform_json?: string; // {"translate":[x,y,z],"rotateXYZ":[..],"scale":[..]}（皆可選）
}
export interface ReviewRoomDescriptor {
  set_id: string;
  ready: boolean;
  stage_url: string | null;
  stage_composition: {
    primary: { url: string; name: string; discipline: string };
    secondary_layers: unknown[];
  } | null;
  members?: { discipline: string; usd_path: string; layer_order: number }[];
  note: string;
}
export interface CoordReport {
  consistent: boolean;
  members: Record<string, { up_axis?: string; meters_per_unit?: number; default_prim?: string | null; error?: string }>;
  issues: string[];
}
export interface FederatedBuildResult {
  usda_path: string;
  sublayer_order: string[];
  member_count: number;
  hidden: string[];
  transformed?: { root_prim: string; ops: string[] }[];
  prim_sample?: string[];
}

// A1 file-library browse 型別樹（/api/governance/files/tree 回應）。
export interface FileVersionRow {
  name: string;
  path: string; // 絕對路徑，給 rule-run ifc_source_path 用
  size_bytes: number;
  mtime: string; // ISO8601
}
export interface FileModelRow {
  model_id: string;
  versions: FileVersionRow[];
}
export interface FileProjectRow {
  project_id: string;
  models: FileModelRow[];
}
export interface FilesTreeResponse {
  root: string;
  source_kind: "local_fs" | "s3"; // 誠實標記：目前 local_fs；未來真 MinIO 改 s3
  projects: FileProjectRow[];
}
