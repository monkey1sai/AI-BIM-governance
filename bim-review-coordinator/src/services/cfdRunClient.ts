// Internal client for the streaming CFD job service (building-energy-cfd-p2-contract.md §3.1).
//
// Loopback-only peer (STREAMING_CONVERSION_API_BASE); writes carry
// X-Internal-Conversion-Token exactly like StreamingConversionClient. Every call
// returns the upstream status + parsed body so the browser-facing routes can pass
// error_code bodies through without re-inventing them.

export interface CfdUpstreamReply {
  status: number;
  body: Record<string, unknown>;
}

export class CfdUpstreamUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfdUpstreamUnavailable";
  }
}

type FetchLike = typeof fetch;

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export class CfdRunClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly options: { fetchImpl?: FetchLike; requestTimeoutMs?: number } = {},
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.internalToken
      ? { ...extra, "X-Internal-Conversion-Token": this.internalToken }
      : extra;
  }

  private async call(method: "GET" | "POST", relativePath: string, body?: unknown): Promise<CfdUpstreamReply> {
    const url = new URL(relativePath, ensureTrailingSlash(this.baseUrl)).toString();
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let upstream: Response;
    try {
      upstream = await fetchImpl(url, {
        method,
        headers: this.headers(body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 15_000),
        redirect: "error",
      });
    } catch (error) {
      throw new CfdUpstreamUnavailable(`streaming CFD job service unreachable: ${(error as Error).message}`);
    }
    const text = await upstream.text();
    let parsed: Record<string, unknown> = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        parsed = { detail: text.slice(0, 256) };
      }
    }
    return { status: upstream.status, body: parsed };
  }

  createRun(body: Record<string, unknown>): Promise<CfdUpstreamReply> {
    return this.call("POST", "api/cfd-runs", body);
  }

  listRuns(query: { conversion_job_id?: string; status?: string; limit?: number } = {}): Promise<CfdUpstreamReply> {
    const params = new URLSearchParams();
    if (query.conversion_job_id) params.set("conversion_job_id", query.conversion_job_id);
    if (query.status) params.set("status", query.status);
    if (query.limit) params.set("limit", String(query.limit));
    const suffix = params.toString();
    return this.call("GET", `api/cfd-runs${suffix ? `?${suffix}` : ""}`);
  }

  getRun(runId: string): Promise<CfdUpstreamReply> {
    return this.call("GET", `api/cfd-runs/${encodeURIComponent(runId)}`);
  }

  getRunResult(runId: string): Promise<CfdUpstreamReply> {
    return this.call("GET", `api/cfd-runs/${encodeURIComponent(runId)}/result`);
  }

  getRunExclusions(runId: string): Promise<CfdUpstreamReply> {
    return this.call("GET", `api/cfd-runs/${encodeURIComponent(runId)}/exclusions`);
  }

  cancelRun(runId: string): Promise<CfdUpstreamReply> {
    return this.call("POST", `api/cfd-runs/${encodeURIComponent(runId)}/cancel`, {});
  }

  /** S8: cfd-options/v1 (defaults, contract bounds, presets, host limits). */
  getOptions(): Promise<CfdUpstreamReply> {
    return this.call("GET", "api/cfd-options");
  }

  /** S8: cfd-estimate/v1 for a cfd-estimate-request/v1 body (read-only on the streaming side). */
  estimate(body: Record<string, unknown>): Promise<CfdUpstreamReply> {
    return this.call("POST", "api/cfd-estimates", body);
  }
}
