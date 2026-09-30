// 本機 IFC 進件的終態判定（自 RealIfcConsolePage 的輪詢規則抽出，兩處共用避免漂移）。純函式。
export const INTAKE_POLL_MS = 5000;
export const INTAKE_MAX_ATTEMPTS = 36; // 5 s × 36 ≈ 180 s，與 #demo-control 相同

export type IntakeOutcome =
  | { kind: "converting"; status: string }
  | { kind: "ready"; viewerUrl: string; sessionId: string | null }
  | { kind: "download_failed" }
  | { kind: "conversion_failed" }
  | { kind: "blocked" }
  | { kind: "timeout"; status: string };

export interface IntakeJobView {
  viewer_url?: string | null; web_view_session_id?: string | null;
  download_status?: string | null; conversion_status?: string | null;
}

export function classifyIntakeJob(job: IntakeJobView, attempt: number, maxAttempts = INTAKE_MAX_ATTEMPTS): IntakeOutcome {
  if (job.viewer_url) return { kind: "ready", viewerUrl: job.viewer_url, sessionId: job.web_view_session_id ?? null };
  if (job.download_status === "failed") return { kind: "download_failed" };
  const status = String(job.conversion_status ?? "").toLowerCase();
  if (status === "failed") return { kind: "conversion_failed" };
  if (status.includes("block")) return { kind: "blocked" };
  if (attempt >= maxAttempts) return { kind: "timeout", status: job.conversion_status ?? "pending" };
  return { kind: "converting", status: job.conversion_status ?? "queued" };
}
