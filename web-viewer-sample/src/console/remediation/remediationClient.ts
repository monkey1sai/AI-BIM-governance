import { coordinatorUrl } from "../coordinatorClient";

export interface RemediationCommand {
  expected_revision: number;
  revised_model_version_id: string;
  revised_run_id: string;
  revised_result_id: string;
  idempotency_key: string;
  note?: string;
}
export interface RemediationReceipt {
  issue: { id: string; status: string; revision: number; [key: string]: unknown };
  confirmation: {
    schema_version: "a1-remediation/v1";
    id: string;
    issue_id: string;
    revised: { run_id: string; model_version_id: string; anchor_id: string; [key: string]: unknown };
    [key: string]: unknown;
  };
  replayed: boolean;
}
type ErrorCode = "invalid_request" | "request_failed" | "invalid_response"
  | "remediation_authorization_unavailable" | "remediation_authorization_denied"
  | "remediation_conflict" | "remediation_evidence_invalid" | "remediation_persistence_unavailable";

export class RemediationClientError extends Error {
  constructor(readonly code: ErrorCode, readonly status = 0) {
    super(code);
    this.name = "RemediationClientError";
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    && value === value.trim() && !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}
function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function receiptMatches(value: unknown, issueId: string, command: RemediationCommand): value is RemediationReceipt {
  if (!object(value) || !object(value.issue) || !object(value.confirmation)) return false;
  const { issue, confirmation } = value;
  const revised = confirmation.revised;
  return issue.id === issueId && identifier(issue.status) && revision(issue.revision)
    && typeof value.replayed === "boolean"
    && confirmation.schema_version === "a1-remediation/v1" && identifier(confirmation.id)
    && confirmation.issue_id === issueId && object(revised)
    && revised.run_id === command.revised_run_id
    && revised.model_version_id === command.revised_model_version_id
    && revised.anchor_id === command.revised_result_id;
}
const safeStatuses: Partial<Record<ErrorCode, number>> = {
  remediation_authorization_unavailable: 503,
  remediation_authorization_denied: 403,
  remediation_conflict: 409,
  remediation_evidence_invalid: 422,
  remediation_persistence_unavailable: 503,
};

/** One attempt only. An uncertain POST outcome must be retried explicitly with the same command/key.
 * Receipt validation checks shape/correlation, not backend authority or source evidence.
 */
async function confirm(issueId: string, input: RemediationCommand, signal?: AbortSignal): Promise<RemediationReceipt> {
  if (!object(input)) throw new RemediationClientError("invalid_request");
  // Snapshot only allowed fields before the first await. Never serialize browser actor/role/PASS.
  const command: RemediationCommand = {
    expected_revision: input.expected_revision,
    revised_model_version_id: input.revised_model_version_id,
    revised_run_id: input.revised_run_id,
    revised_result_id: input.revised_result_id,
    idempotency_key: input.idempotency_key,
    note: input.note === undefined ? "" : input.note,
  };
  if (!identifier(issueId) || !revision(command.expected_revision)
    || ![command.revised_model_version_id, command.revised_run_id,
      command.revised_result_id, command.idempotency_key].every(identifier)
    || typeof command.note !== "string" || command.note.length > 4000) {
    throw new RemediationClientError("invalid_request");
  }
  const controller = new AbortController();
  const abort = () => controller.abort(); // Never propagate caller-provided sensitive abort reasons.
  const checkAbort = () => {
    if (controller.signal.aborted) throw new RemediationClientError("request_failed");
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 15000);
  try {
    checkAbort();
    const response = await fetch(coordinatorUrl(
      "/api/governance/issues/" + encodeURIComponent(issueId) + "/confirm-remediation",
    ), {
      method: "POST", credentials: "same-origin", redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-A1-Intent": "confirm" },
      body: JSON.stringify(command), signal: controller.signal,
    });
    checkAbort();
    let value: unknown;
    try { value = await response.json(); }
    catch {
      checkAbort();
      throw new RemediationClientError(response.ok ? "invalid_response" : "request_failed", response.status);
    }
    checkAbort();
    if (!response.ok) {
      const code = object(value) && object(value.detail) ? value.detail.code : undefined;
      const safeCode = typeof code === "string" && Object.prototype.hasOwnProperty.call(safeStatuses, code)
        && safeStatuses[code as ErrorCode] === response.status ? code as ErrorCode : "request_failed";
      throw new RemediationClientError(safeCode, response.status);
    }
    if (!receiptMatches(value, issueId, command)) throw new RemediationClientError("invalid_response", response.status);
    return value; // Replay returns current Issue, which may already be reopened.
  } catch (error) {
    if (error instanceof RemediationClientError) throw error;
    throw new RemediationClientError("request_failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export const remediationClient = { confirm };
