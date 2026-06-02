// A1 治理 rule-run client — 只打 coordinator :8004 的 /api/governance/* proxy（loopback 轉發至
// governance-service 127.0.0.1:49102）。瀏覽器永不直連內部服務（邊界 B1）。
const COORD_BASE: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_COORDINATOR_BASE ?? "http://127.0.0.1:8004";

export interface RuleRunRequest {
  ifc_source_path: string;
  rule_set?: string;
  model_version_id?: string;
  element_mapping_path?: string;
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
  createRuleRun: (req: RuleRunRequest) =>
    jsonFetch<{ rule_run_id: string; status: string }>("/api/governance/rule-runs", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  getRuleRun: (id: string) => jsonFetch<RuleRunStatus>(`/api/governance/rule-runs/${id}`),
  getResults: (id: string, status?: string) =>
    jsonFetch<{ results: RuleResultRow[] }>(
      `/api/governance/rule-runs/${id}/results${status ? `?status=${status}` : ""}`
    ).then((r) => r.results),
  exportUrl: (id: string) => `${COORD_BASE}/api/governance/rule-runs/${id}/export?fmt=excel`,

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
};

export interface DiffRequest {
  base_ifc_path: string;
  target_ifc_path: string;
  base_model_version_id?: string;
  target_model_version_id?: string;
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
  ifc_type?: string;
  ifc_name?: string | null;
  change_summary: string;
}
