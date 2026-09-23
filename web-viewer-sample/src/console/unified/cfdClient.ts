// CFD 風場 run 的 console client（building-energy-cfd-p2-contract.md §3.2, slice S3）。
// 只打 coordinator :8004 的 /api/cfd/* 與 /api/review-sessions/{id}/cfd-overlays；瀏覽器永不直連 :49101。
// 回應以「status + body」原樣交給面板：非 2xx 是值不是例外，讓 UI 依 error_code 誠實表態
//（cfd_disabled／source_not_ready／direction_not_ready／cfd_upstream_unavailable…）。
import { coordinatorClient, coordinatorUrl } from "../coordinatorClient";
import type { components } from "../../generated/coordinator-api";

export type CfdRunLedgerRecord = components["schemas"]["CfdRunLedgerRecord"];
export type CfdRunStatusDocument = components["schemas"]["CfdRunStatusDocument"];
export type CfdRunDetailResponse = components["schemas"]["CfdRunDetailResponse"];
export type CfdRunListResponse = components["schemas"]["CfdRunListResponse"];
export type CfdRunResult = components["schemas"]["CfdRunResult"];
export type CfdRunDirectionResult = components["schemas"]["CfdRunDirectionResult"];
export type CfdRunCreateRequest = components["schemas"]["CfdRunCreateRequest"];
export type CfdOverlayRegistrationResponse = components["schemas"]["CfdOverlayRegistrationResponse"];
export type CfdRunStatus = CfdRunLedgerRecord["status"];
/** S6 A1 finding: pedestrian-wind exceedance → governance issue through the coordinator (existing /api/issues). */
export type CfdFindingRequest = components["schemas"]["CfdFindingRequest"];
export type CfdFindingResponse = components["schemas"]["CfdFindingResponse"];
export type CfdFinding = components["schemas"]["CfdFinding"];
export type CfdRunOrigin = components["schemas"]["CfdRunOrigin"];
/** S8 settings phase A: options served by the streaming service through the coordinator (cfd-options/v1). */
export type CfdOptionsDocument = components["schemas"]["CfdOptionsDocument"];
export type CfdOptionsField = components["schemas"]["CfdOptionsField"];
export type CfdOptionsPreset = components["schemas"]["CfdOptionsPreset"];
/** S8: read-only estimate before submitting (cfd-estimate-request/v1 → cfd-estimate/v1). */
export type CfdEstimateRequest = components["schemas"]["CfdEstimateRequest"];
export type CfdEstimate = components["schemas"]["CfdEstimate"];
export type CfdSettingsProfile = components["schemas"]["CfdSettingsProfile"];
/** S7: a ready model the wind panel can target without a review session (from GET /api/conversion/records). */
export interface WindModelOption {
  conversionJobId: string;
  /** Display label: project name · category · short model version; never the raw object key. */
  label: string;
}

export interface CfdReply<T> {
  /** HTTP 狀態；0＝網路／逾時失敗（未收到回應）。 */
  status: number;
  body: T | null;
  errorCode: string | null;
  detail: string | null;
}

export interface CfdConsoleClient {
  /** Runs of one model; omit the id for the cross-model overview (newest first). */
  listRuns(conversionJobId?: string | null, limit?: number): Promise<CfdReply<CfdRunListResponse>>;
  /** S7: ready models the panel can submit against without a review session. */
  listModels(): Promise<CfdReply<{ items: WindModelOption[] }>>;
  createRun(body: CfdRunCreateRequest): Promise<CfdReply<CfdRunStatusDocument>>;
  getRun(runId: string): Promise<CfdReply<CfdRunDetailResponse>>;
  getRunResult(runId: string): Promise<CfdReply<CfdRunResult>>;
  cancelRun(runId: string): Promise<CfdReply<CfdRunStatusDocument>>;
  registerOverlay(sessionId: string, runId: string, windFromDegrees: number): Promise<CfdReply<CfdOverlayRegistrationResponse>>;
  /** S6: open governance issues for every ready direction above the threshold (idempotent per run/direction/threshold). */
  createFindings(runId: string, body: CfdFindingRequest): Promise<CfdReply<CfdFindingResponse>>;
  /** S8: defaults, contract bounds, presets and host limits; the settings form is built from this alone. */
  getOptions(): Promise<CfdReply<CfdOptionsDocument>>;
  /** S8: cell/time estimate for the current settings (nothing is stored). */
  estimate(body: CfdEstimateRequest): Promise<CfdReply<CfdEstimate>>;
}

export const CFD_TERMINAL_STATUSES: ReadonlySet<CfdRunStatus> = new Set(["ready", "failed", "cancelled"]);

const TIMEOUT_MS = 15_000;

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CfdReply<T>> {
  let response: Response;
  try {
    response = await fetch(coordinatorUrl(path), {
      method,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { status: 0, body: null, errorCode: null, detail: error instanceof Error ? error.message : String(error) };
  }
  let parsed: unknown = null;
  const text = await response.text();
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  if (!response.ok) {
    return {
      status: response.status,
      body: null,
      errorCode: typeof record?.error_code === "string" ? record.error_code : null,
      detail: typeof record?.detail === "string" ? record.detail : response.statusText || null,
    };
  }
  return { status: response.status, body: (parsed as T) ?? null, errorCode: null, detail: null };
}

export const cfdConsoleClient: CfdConsoleClient = {
  listRuns: (conversionJobId, limit = 50) => call("GET", conversionJobId
    ? `/api/cfd/runs?conversion_job_id=${encodeURIComponent(conversionJobId)}&limit=${limit}`
    : `/api/cfd/runs?limit=${limit}`),
  listModels: async () => {
    try {
      const records = await coordinatorClient.getConversionRecords(100);
      const items = records.items
        .filter((record) => record.status === "ready" && typeof record.conversion_job_id === "string" && record.conversion_job_id)
        .map((record) => ({
          conversionJobId: record.conversion_job_id as string,
          label: `${record.project_display_name || record.project_id} · ${record.category} · ${record.external_model_version_id.slice(0, 8)}`,
        }));
      return { status: 200, body: { items }, errorCode: null, detail: null };
    } catch (error) {
      return { status: 0, body: null, errorCode: null, detail: error instanceof Error ? error.message : String(error) };
    }
  },
  createRun: (body) => call("POST", "/api/cfd/runs", body),
  getRun: (runId) => call("GET", `/api/cfd/runs/${encodeURIComponent(runId)}`),
  getRunResult: (runId) => call("GET", `/api/cfd/runs/${encodeURIComponent(runId)}/result`),
  cancelRun: (runId) => call("POST", `/api/cfd/runs/${encodeURIComponent(runId)}/cancel`, {}),
  createFindings: (runId, body) => call("POST", `/api/cfd/runs/${encodeURIComponent(runId)}/findings`, body),
  getOptions: () => call("GET", "/api/cfd/options"),
  estimate: (body) => call("POST", "/api/cfd/estimates", body),
  registerOverlay: (sessionId, runId, windFromDegrees) =>
    call("POST", `/api/review-sessions/${encodeURIComponent(sessionId)}/cfd-overlays`, { run_id: runId, wind_from_degrees: windFromDegrees }),
};
