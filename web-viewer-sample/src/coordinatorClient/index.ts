// Coordinator Browser Client public surface (docs/architecture/coordinator-browser-client-adr.md §2).
import { defaultCoordinatorBase } from "../console/coordinatorBase";
import { createCoordinatorClient, isSecureOperatorTransport as isSecureOperatorTransportFor } from "./client";

const COORD_BASE: string =
  import.meta.env.VITE_COORDINATOR_API_BASE
  ?? import.meta.env.VITE_COORDINATOR_BASE
  ?? defaultCoordinatorBase();

// A wedged socket must not leave a console call pending forever: without a signal of its own, a console call gives up
// after 15 s (the polling GETs are short). The viewer's client has no default timeout.
let consoleTimeoutMs = 15000;
/** Test seam only. */
export function __setFetchTimeoutMsForTests(ms: number | null): void {
  consoleTimeoutMs = ms ?? 15000;
}

/** The console's client: the configured coordinator base and a 15 s default timeout. */
export const coordinatorClient = createCoordinatorClient({ baseUrl: COORD_BASE, timeoutMs: () => consoleTimeoutMs });

/** A console URL on the coordinator, for raw fetches that must show non-2xx statuses as values. */
export function coordinatorUrl(path: string): string {
  return `${COORD_BASE}${path}`;
}

export function isSecureOperatorTransport(base: string = COORD_BASE): boolean {
  return isSecureOperatorTransportFor(base);
}

export { createCoordinatorClient, type CoordinatorBrowserClient } from "./client";
export {
  CoordinatorHttpError,
  QueuedForInstanceError,
  isCoordinatorNotFound,
  isDevRoutesDisabled,
  isQueuedForInstanceError,
} from "./errors";
export * from "./types";
