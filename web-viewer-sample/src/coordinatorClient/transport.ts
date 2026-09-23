// Coordinator Browser Client transport (docs/architecture/coordinator-browser-client-adr.md §2): one way to call a
// coordinator route, one error type for its failures, and one timeout rule.
import { contractErrorCode, CoordinatorHttpError } from "./errors";
import { routePath, type RouteSpec } from "./routes";

export interface CoordinatorTransportOptions {
  /** Coordinator base URL (empty for same-origin). */
  baseUrl: string;
  /** Defaults to the global `fetch`, resolved at call time so a test can stub it. */
  fetch?: typeof fetch;
  /** Default timeout for calls that bring no `signal` of their own; none when absent or undefined. */
  timeoutMs?: number | (() => number | undefined);
}

export interface CoordinatorCallOptions {
  /** Values of the route template's `{param}` segments, percent-encoded into the path. */
  params?: Record<string, string>;
  /** Query string without the leading `?`; an empty or absent one adds nothing. */
  query?: URLSearchParams | string;
  /** Sent as JSON; a body-less call to a non-GET route sends `{}`. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Keep the request alive through page unload (lease release on `pagehide`). */
  keepalive?: boolean;
  /** Wins over the instance's default timeout. */
  signal?: AbortSignal;
}

export interface CoordinatorTransport {
  readonly baseUrl: string;
  /**
   * Call a tagged route at the path its template gives and return the JSON body. A non-2xx reply, or a 2xx reply that is
   * not JSON, is a `CoordinatorHttpError`; a network failure, abort or timeout rejects as `fetch` does.
   */
  request<T>(route: RouteSpec, call?: CoordinatorCallOptions): Promise<T>;
}

interface Failure {
  detail: string;
  errorCode: string | null;
  body: unknown;
}

/** The failure's display detail (the body's `detail`, else its text, else the status text) and contract code. */
async function failureOf(response: Response): Promise<Failure> {
  try {
    const text = await response.text();
    if (!text) return { detail: response.statusText, errorCode: null, body: null };
    try {
      const parsed = JSON.parse(text) as { detail?: unknown; error_code?: unknown } | null;
      const errorCode = contractErrorCode(parsed?.error_code);
      if (typeof parsed?.detail === "string" && parsed.detail) return { detail: parsed.detail, errorCode, body: parsed };
      return { detail: text, errorCode, body: parsed };
    } catch {
      return { detail: text, errorCode: null, body: null };
    }
  } catch {
    return { detail: response.statusText, errorCode: null, body: null };
  }
}

export function createCoordinatorTransport(options: CoordinatorTransportOptions): CoordinatorTransport {
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const defaultTimeoutMs = (): number | undefined => (
    typeof options.timeoutMs === "function" ? options.timeoutMs() : options.timeoutMs
  );
  return {
    baseUrl: options.baseUrl,
    async request<T>(route: RouteSpec, call: CoordinatorCallOptions = {}): Promise<T> {
      const path = routePath(route, call.params, call.query);
      const timeoutMs = defaultTimeoutMs();
      const signal = call.signal ?? (timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs));
      const init: RequestInit = route.method === "GET"
        ? { headers: { Accept: "application/json", ...call.headers } }
        : {
          method: route.method,
          headers: { Accept: "application/json", "Content-Type": "application/json", ...call.headers },
          body: JSON.stringify(call.body ?? {}),
        };
      if (signal) init.signal = signal;
      if (call.keepalive) init.keepalive = true;
      const response = await fetchImpl(`${options.baseUrl}${path}`, init);
      if (!response.ok) {
        const failure = await failureOf(response);
        throw new CoordinatorHttpError(path, response.status, failure.detail, failure.errorCode, failure.body);
      }
      try {
        return await response.json() as T;
      } catch (error) {
        // Only a body that is not JSON is a malformed reply; a read cut short by an abort, timeout or network failure
        // rejects as the same failure would from fetch.
        if (!(error instanceof SyntaxError)) throw error;
        throw new CoordinatorHttpError(path, 502, "coordinator reply is not JSON", "coordinator_response_malformed");
      }
    },
  };
}
