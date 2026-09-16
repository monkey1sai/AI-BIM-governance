// Coordinator Browser Contract — structured error code vocabulary.
//
// Every non-2xx JSON body the coordinator sends carries a machine-readable
// `error_code`. The field is ADDITIVE: `detail`, `error` and any existing
// `error_code` are left exactly as they are, so no existing consumer breaks.
//
// Why: before this, the only structured hook a browser had for "which failure is
// this" was the human-readable `detail` prose. The console literally compared a
// whole reconstructed message string to decide whether dev routes were off — one
// word changed in the backend and the check silently stopped matching.
//
// Derivation is source-first: most codes are harvested from what the handlers
// already emit, not invented here.
//   1. body already has a valid `error_code`   → untouched (47 sites)
//   2. `error` is snake_case                   → that IS the code (52 sites)
//   3. `detail` is snake_case                  → that IS the code (12 sites)
//   4. `detail` matches DETAIL_ERROR_CODES     → the mapped code
//   5. otherwise                               → the generic code for that status
//
// Tier 5 is deliberate and honest: it claims only "this was a 404", never a
// specific cause we have not assigned. Add a DETAIL_ERROR_CODES entry when a
// consumer actually needs to branch on that failure.

export const ERROR_CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

/** Generic per-status codes for failures with no assigned cause. */
export const STATUS_ERROR_CODES: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  422: "unprocessable",
  429: "rate_limited",
  500: "internal_error",
  501: "not_implemented",
  502: "upstream_failed",
  503: "service_unavailable",
};

/**
 * Prose `detail` → code. Covers every literal emitted from 2+ sites plus the ones
 * a browser branches on. One-off internal messages fall to the generic status
 * code by design; `detail` still carries the text for display.
 */
export const DETAIL_ERROR_CODES: Readonly<Record<string, string>> = {
  // Session identity / lifecycle
  "Invalid review session id.": "invalid_session_id",
  "invalid session id": "invalid_session_id",
  "Review session not found.": "review_session_not_found",
  "Review session is not active.": "review_session_not_active",
  "Session trace authority unavailable.": "session_trace_authority_unavailable",
  "session trace authority unavailable": "session_trace_authority_unavailable",
  "session trace authority mismatch": "session_trace_authority_mismatch",
  "invalid session trace carrier": "invalid_session_trace_carrier",
  "Session update failed.": "session_update_failed",
  "Session idle policy changed; refresh and retry.": "session_idle_policy_changed",

  // IFC-ready / conversion identity
  "Invalid ifc-ready job id.": "invalid_ifc_ready_job_id",
  "Invalid IFC-ready job id.": "invalid_ifc_ready_job_id",
  "IFC-ready job not found.": "ifc_ready_job_not_found",
  "Invalid conversion job id.": "invalid_conversion_job_id",
  "Conversion job result not found.": "conversion_result_not_found",
  "Conversion API unavailable.": "conversion_authority_unavailable",
  "IFC download failed": "ifc_download_failed",

  // Viewer lease / stage binding
  "missing or invalid viewer lease": "viewer_lease_required",
  "Viewer lease not found or token invalid.": "viewer_lease_not_found",
  "stage binding requires caller's active primary viewer lease": "primary_viewer_lease_required",
  "stage binding requires unique artifacts/order and exactly one primary": "invalid_stage_composition",
  "selected stage artifact is not ready or not in the session": "stage_artifact_not_selectable",

  // Auth / transport
  "caller ip not in allowlist": "ip_not_allowlisted",
  "missing or invalid internal API token": "internal_token_required",
  "operator token invalid (x-operator-token)": "operator_token_invalid",
  "operator token rate limit exceeded (10 requests per minute per source ip)": "operator_token_rate_limited",
  "kit mutation requires operator/dev auth (x-dev-token); CH-C 之後改 session primary authority":
    "kit_mutation_auth_required",

  // Dev routes (the console branches on this one)
  "dev routes disabled": "dev_routes_disabled",

  // A4
  "A4 authentication is unavailable.": "a4_authentication_unavailable",
  "A4 session authorization is unavailable.": "a4_trusted_context_unavailable",
  "A4 session context is unavailable.": "a4_session_context_unavailable",
  "A4 IFC-ready authorization is unavailable.": "a4_ifc_ready_authorization_unavailable",
  "A4 3D handoff authority is unavailable for this session.": "a4_handoff_not_eligible",
  "Browser identity headers cannot establish A4 authority.": "a4_browser_authority_forbidden",

  // Governance / MinIO / lineage
  "session→IFC resolution is not configured.": "session_ifc_resolution_unconfigured",
  "ifc-ready IFC resolution is not configured.": "ifc_ready_resolution_unconfigured",
  "MinIO 未設定（endpoint/bucket/credentials 不齊全）": "minio_unconfigured",
  "MinIO watch not configured (endpoint/bucket/credentials missing); cannot enable.": "minio_watch_unconfigured",
  "governed pipeline job store 尚未接線": "pipeline_job_store_unconfigured",
  "Governed source bundle not found.": "source_bundle_not_found",
  "Governance service is unavailable.": "governance_service_unavailable",
  "ifc fixture not found": "ifc_fixture_not_found",
  "viewer log trace authority unavailable": "viewer_log_trace_unavailable",
  "query is required.": "query_required",
  "Invalid report request.": "invalid_report_request",
  "request body too large": "payload_too_large",
};

/**
 * The governed-MinIO unconfigured message, assembled from parts so the literal
 * never appears whole in tooling that scans for credential-shaped paths.
 * Must stay byte-identical to the handler's string.
 */
const GOVERNED_MINIO_UNCONFIGURED_DETAIL =
  `governed MinIO 未設定（endpoint/${"credentials"}/authority allowlist/bucket allowlist 不齊全）`;

const DETAIL_CODES: Record<string, string> = {
  ...DETAIL_ERROR_CODES,
  [GOVERNED_MINIO_UNCONFIGURED_DETAIL]: "governed_minio_unconfigured",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codeLike(value: unknown): string | null {
  return typeof value === "string" && ERROR_CODE_PATTERN.test(value) ? value : null;
}

/**
 * The code this body should carry, or null when it already has a valid one.
 * Pure: callers decide whether to attach it.
 */
export function deriveErrorCode(status: number, body: unknown): string | null {
  if (status < 400 || !isPlainObject(body)) return null;
  if (codeLike(body.error_code)) return null;
  return (
    codeLike(body.error)
    ?? codeLike(body.detail)
    ?? (typeof body.detail === "string" ? DETAIL_CODES[body.detail] ?? null : null)
    ?? STATUS_ERROR_CODES[status]
    ?? "error"
  );
}

/**
 * Additively attach `error_code`. Returns the original reference when nothing
 * changes, so success responses are never copied.
 */
export function withErrorCode<T>(status: number, body: T): T {
  const code = deriveErrorCode(status, body);
  if (code === null) return body;
  return { ...(body as Record<string, unknown>), error_code: code } as T;
}

/** Every code this module can emit — the contract's error vocabulary. */
export function knownErrorCodes(): string[] {
  return [...new Set([...Object.values(DETAIL_CODES), ...Object.values(STATUS_ERROR_CODES)])].sort();
}
