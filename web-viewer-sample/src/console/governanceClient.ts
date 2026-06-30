// A1 治理 rule-run client — 只打 coordinator :8004 的 /api/governance/* proxy（loopback 轉發至
// governance-service 127.0.0.1:49102）。瀏覽器永不直連內部服務（邊界 B1）。
// coordinator base 用全站／部署一致的正規 env 名 VITE_COORDINATOR_API_BASE（compose 注入、deploy.ps1
// 經 WEB_VIEWER_COORDINATOR_API_BASE 設定、config/env.ts 亦讀此名）。保留舊名 VITE_COORDINATOR_BASE
// 為相容 fallback（正規名優先），預設與 config/env.ts 一致為 http://127.0.0.1:8004。
import { defaultCoordinatorBase } from "./coordinatorBase";

const env = (import.meta as { env?: Record<string, string> }).env;

const COORD_BASE: string =
  env?.VITE_COORDINATOR_API_BASE ?? env?.VITE_COORDINATOR_BASE ?? defaultCoordinatorBase();

export interface RuleRunRequest {
  ifc_source_path: string;
  rule_set?: string;
  model_version_id?: string;
  element_mapping_path?: string;
  ids_path?: string; // 提供時改用 buildingSMART IDS（ifctester）
}

export interface RuleRunStatus {
  rule_run_id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  score: number | null;
  rule_set: string;
  model_version_id: string | null;
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

export interface RuleResultRow {
  ifc_guid: string | null;
  usd_prim_path: string | null;
  rule_code: string;
  severity: string;
  status: "pass" | "fail" | "error";
  message: string;
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

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${COORD_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`governance proxy ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
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

  // Issue tracking
  listIssues: (status?: string) =>
    jsonFetch<{ issues: IssueRow[] }>(`/api/governance/issues${status ? `?status=${status}` : ""}`).then((r) => r.issues),
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
  source_type: string;
}

export interface DiffRequest {
  base_ifc_path: string;
  target_ifc_path: string;
  base_model_version_id?: string;
  target_model_version_id?: string;
  include_geometry?: boolean;
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
