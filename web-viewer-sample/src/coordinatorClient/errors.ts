// Coordinator Browser Client errors (docs/architecture/coordinator-browser-client-adr.md §2).
import type { QueuedForInstanceConflict } from "../contract/coordinatorApi";

const CONTRACT_ERROR_CODE = /^[a-z0-9_]{1,64}$/;

/** A reply body's `error_code` when it is a contract code (lowercase snake case, at most 64 characters); otherwise null. */
export function contractErrorCode(value: unknown): string | null {
  return typeof value === "string" && CONTRACT_ERROR_CODE.test(value) ? value : null;
}

/**
 * Every failure of a coordinator-answered route: a non-2xx reply, a 2xx reply that is not JSON, or a 2xx reply whose
 * shape the client cannot accept. The message keeps the console's long-standing format, which several places show
 * through `String(error)`.
 */
export class CoordinatorHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly detail: string,
    /** The body's contract `error_code`; null when an older coordinator or a non-JSON body sent none. */
    readonly errorCode: string | null = null,
    /** The parsed JSON reply, when the failure had one (never part of the message). */
    readonly body: unknown = null,
  ) {
    super(`coordinator ${path} -> ${status} ${detail}`);
    this.name = "CoordinatorHttpError";
  }
}

/** `POST /api/review-sessions` answered 409 `queued_for_instance`: no Kit capacity, and the request is kept. */
export class QueuedForInstanceError extends CoordinatorHttpError {
  constructor(path: string, readonly response: QueuedForInstanceConflict) {
    super(path, 409, response.detail || "No Kit capacity available.", contractErrorCode(response.error_code) ?? "queued_for_instance", response);
    this.name = "QueuedForInstanceError";
  }
}

export function isQueuedForInstanceError(error: unknown): error is QueuedForInstanceError {
  return error instanceof QueuedForInstanceError;
}

/** 404 on any coordinator route (for example `/api/dev/*` when dev routes are disabled). */
export function isCoordinatorNotFound(error: unknown): boolean {
  return error instanceof CoordinatorHttpError && error.status === 404;
}

/** `/api/dev/*` answered 404 `dev_routes_disabled` (ENABLE_DEV_ROUTES=false). */
export function isDevRoutesDisabled(error: unknown): boolean {
  return error instanceof CoordinatorHttpError && error.status === 404 && error.errorCode === "dev_routes_disabled";
}
