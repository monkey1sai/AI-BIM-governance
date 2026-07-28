/**
 * Browser viewer adapter for the cross-service structured log baseline.
 *
 * Source of truth: docs/contracts/structured-log-schema.md.
 * Schema artifact: tests/contracts/structured-log/schema.json.
 *
 * Unlike the coordinator (Node) adapter, this one cannot write to a local
 * filesystem. Records accumulate in an in-memory ring buffer and flush to the
 * coordinator's `POST /api/internal/viewer-log` endpoint on three triggers
 * (whichever comes first):
 *
 *  1. Buffer reaches `flushAtRecords` (default 50)
 *  2. `flushIntervalMs` elapses since last flush (default 2000)
 *  3. Explicit `logger.flush()` call
 *
 * Failed POSTs (network down, 5xx from coordinator) keep records in the buffer
 * up to `retainOnFailureMs` (default 5 min). When the buffer is full, the
 * oldest record is dropped; a `console.error` always fires as a last-resort
 * observability surface so dev console still sees the issue.
 *
 * No global side effects are triggered by importing this module. The caller
 * must invoke `createBrowserLogger(...)` and optionally `installGlobalHandlers(...)`
 * to wire up `window.addEventListener('error', ...)` and `unhandledrejection`.
 */

import envAllowListSpec from "../../../tests/contracts/structured-log/env-allowlist.json";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type EventType =
  | "logic_error"
  | "operation_anomaly"
  | "env_snapshot"
  | "lifecycle"
  | "audit"
  | "network"
  | "general";

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event_type: EventType;
  service: "viewer";
  component: string;
  run_id: string;
  trace_id: string;
  msg: string;
  data: Record<string, unknown>;
  seq?: number;
  caller?: string;
  error?: { name: string; message: string; stack_tail: string[] };
  parent_trace_id?: string;
}

export interface NetworkData {
  direction: "inbound" | "outbound";
  protocol: "http" | "websocket" | "socket.io" | "webrtc-signal" | "datachannel";
  peer: "coordinator" | "streaming-server" | "external-edge" | "external-cloud" | "kit-subprocess" | "viewer";
  status: number | string;
  duration_ms?: number;
  path?: string;
}

export interface LifecycleData {
  phase: "start" | "active" | "closing" | "closed";
  subject_kind: "review_session" | "conversion_job" | "kit_subprocess" | "ifc_ready_job" | "script_run" | "outbox_delivery";
  subject_id: string;
  [extra: string]: unknown;
}

export interface AnomalyData {
  anomaly_kind: "retry" | "fallback" | "timeout" | "unexpected_state";
  reason: string;
  [extra: string]: unknown;
}

export type EnvSource = ".env" | ".env.example" | "system" | "docker-compose" | "default";

export interface EnvVar {
  key: string;
  source: EnvSource;
  value_or_redacted: string;
  type: "string" | "number" | "boolean" | "null" | "object" | "array";
}

export interface BrowserStructLogger {
  readonly runId: string;
  readonly traceId: string;
  bufferLength(): number;
  flushedTotal(): number;
  droppedTotal(): number;
  lastFlushStatus(): { ts: string; status: "ok" | "failed"; detail?: string } | null;

  debug(component: string, msg: string, data?: Record<string, unknown>): void;
  info(component: string, msg: string, data?: Record<string, unknown>): void;
  warn(component: string, msg: string, data?: Record<string, unknown>): void;
  error(component: string, msg: string, err: unknown, data?: Record<string, unknown>): void;
  fatal(component: string, msg: string, err: unknown, data?: Record<string, unknown>): void;

  network(component: string, msg: string, data: NetworkData, level?: LogLevel): void;
  lifecycle(component: string, msg: string, data: LifecycleData, level?: LogLevel): void;
  anomaly(component: string, msg: string, data: AnomalyData, level?: LogLevel): void;

  /** Update the active trace_id (e.g. when entering a new review session). */
  setTraceId(traceId: string): void;

  /** Pause or resume timer/threshold flushes without blocking explicit flush(). */
  setAutoFlushPaused(paused: boolean): void;

  /** Manually trigger a flush. Returns the number of records persisted. */
  flush(): Promise<number>;

  /** Used by tests / Chrome MCP to inspect last N records still in buffer. */
  tail(n?: number): LogRecord[];

  /** Stop timers, drain pending records once if a transport is reachable. */
  shutdown(): Promise<void>;
}

export interface BrowserLoggerOptions {
  /** Override the in-memory clock used for `ts` and rotation decisions. */
  now?: () => Date;
  /** Override random hex used in run_id (tests). */
  randomHex?: () => string;
  /** Override the run id directly. */
  runId?: string;
  /** Trace id to attach to every record until `setTraceId` is called. */
  initialTraceId?: string;
  /** Explicit browser-safe runtime config or metadata for the startup snapshot. */
  browserSnapshotVars?: EnvVar[];
  /** Max records held in buffer; older ones dropped when exceeded. */
  bufferCapacity?: number;
  /** Records buffered before triggering an automatic flush. */
  flushAtRecords?: number;
  /** Milliseconds between auto-flushes (timer). */
  flushIntervalMs?: number;
  /** Milliseconds a failed record stays in buffer before being dropped. */
  retainOnFailureMs?: number;
  /** Maximum retries for a single flush before giving up. */
  flushMaxAttempts?: number;
  /** Initial backoff in ms for retry. Doubles each attempt. */
  flushBackoffMs?: number;
  /**
   * Endpoint URL (or function returning one). Default
   * `${origin}/api/internal/viewer-log` resolved at call time.
   */
  endpoint?: string | (() => string);
  /**
   * Override the transport function. Defaults to global `fetch`. Tests
   * inject this to avoid jsdom.
   */
  transport?: (url: string, body: LogRecord[]) => Promise<{ ok: boolean; status: number; detail?: string }>;
  /** Set to `false` to disable timer-based flushing entirely (tests). */
  enableTimer?: boolean;
}

const DEFAULTS = {
  bufferCapacity: 500,
  flushAtRecords: 50,
  flushIntervalMs: 2000,
  retainOnFailureMs: 5 * 60 * 1000,
  flushMaxAttempts: 3,
  flushBackoffMs: 500,
};

const ENV_ALLOW_LIST = new Set(envAllowListSpec.allow_list);
const SECRET_PATTERN = new RegExp(envAllowListSpec.secret_patterns.join("|"), "i");
const ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const ENV_SOURCES = new Set<EnvSource>([".env", ".env.example", "system", "docker-compose", "default"]);
const ENV_TYPES = new Set<EnvVar["type"]>(["string", "number", "boolean", "null", "object", "array"]);

function sanitizeBrowserSnapshotVars(vars: EnvVar[]): EnvVar[] {
  if (!Array.isArray(vars)) return [];
  const safeVars: EnvVar[] = [];
  for (const candidate of vars) {
    if (!candidate || typeof candidate !== "object") continue;
    const { key, source, value_or_redacted: value, type } = candidate;
    if (
      typeof key !== "string" ||
      !ENV_KEY_PATTERN.test(key) ||
      !ENV_SOURCES.has(source) ||
      typeof value !== "string" ||
      !ENV_TYPES.has(type)
    ) {
      continue;
    }
    const value_or_redacted = ENV_ALLOW_LIST.has(key)
      ? value
      : SECRET_PATTERN.test(key)
        ? `[REDACTED:type=${type}, len=${value.length}]`
        : `[TYPE:type=${type}, len=${value.length}]`;
    safeVars.push({ key, source, value_or_redacted, type });
  }
  return safeVars;
}

function defaultRandomHex(): string {
  // 6 hex digits using crypto when available, Math.random fallback otherwise.
  const cryptoGlobal = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoGlobal?.getRandomValues) {
    const bytes = new Uint8Array(3);
    cryptoGlobal.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
}

export function generateRunId(now: Date = new Date(), randomHex: () => string = defaultRandomHex): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  return `run_${yyyy}${mm}${dd}_${hh}${mi}${ss}_${randomHex()}`;
}

export function isoUtcMs(now: Date = new Date()): string {
  return now.toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, function replacer(_k, v) {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return "[Circular]";
      seen.add(v as object);
    }
    return v;
  });
}

function extractStackTail(err: unknown, max = 8): string[] {
  if (!err || typeof err !== "object") return [];
  const stack = (err as { stack?: unknown }).stack;
  if (typeof stack !== "string") return [];
  return stack.split("\n").slice(1, max + 1).map((line) => line.trim());
}

function classifyError(err: unknown): { name: string; message: string; stack_tail: string[] } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack_tail: extractStackTail(err) };
  }
  if (err && typeof err === "object") {
    const obj = err as { name?: unknown; message?: unknown; stack?: unknown };
    return {
      name: typeof obj.name === "string" ? obj.name : "Error",
      message: typeof obj.message === "string" ? obj.message : safeStringify(err),
      stack_tail: typeof obj.stack === "string" ? extractStackTail(err) : [],
    };
  }
  return { name: "NonErrorThrown", message: String(err), stack_tail: [] };
}

interface BufferEntry {
  record: LogRecord;
  enqueuedAtMs: number;
}

interface LoggerState {
  runId: string;
  traceId: string;
  buffer: BufferEntry[];
  bufferCapacity: number;
  flushAtRecords: number;
  flushIntervalMs: number;
  retainOnFailureMs: number;
  flushMaxAttempts: number;
  flushBackoffMs: number;
  endpoint: () => string;
  transport: NonNullable<BrowserLoggerOptions["transport"]>;
  now: () => Date;
  flushedTotal: number;
  droppedTotal: number;
  lastFlushStatus: { ts: string; status: "ok" | "failed"; detail?: string } | null;
  autoFlushPaused: boolean;
  inFlightFlush: Promise<number> | null;
  timerId: ReturnType<typeof setInterval> | null;
  seqByTrace: Map<string, number>;
  closed: boolean;
}

function nextSeq(state: LoggerState, traceId: string): number {
  const current = state.seqByTrace.get(traceId) ?? 0;
  const next = current + 1;
  state.seqByTrace.set(traceId, next);
  return next;
}

function defaultEndpoint(): string {
  const origin =
    typeof window !== "undefined" && window.location && typeof window.location.origin === "string"
      ? window.location.origin
      : "http://127.0.0.1:8004";
  return `${origin}/api/internal/viewer-log`;
}

async function defaultTransport(url: string, body: LogRecord[]): Promise<{ ok: boolean; status: number; detail?: string }> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetchFn) {
    return { ok: false, status: 0, detail: "no_fetch_in_environment" };
  }

  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, detail: `http_${response.status}` };
    }

    let acknowledgement: unknown;
    try {
      acknowledgement = await response.json();
    } catch {
      return { ok: false, status: response.status, detail: "viewer_log_ack_malformed" };
    }
    if (
      typeof acknowledgement !== "object"
      || acknowledgement === null
      || !Number.isSafeInteger((acknowledgement as { accepted?: unknown }).accepted)
      || (acknowledgement as { accepted: number }).accepted < 0
      || !Number.isSafeInteger((acknowledgement as { dropped?: unknown }).dropped)
      || (acknowledgement as { dropped: number }).dropped < 0
    ) {
      return { ok: false, status: response.status, detail: "viewer_log_ack_malformed" };
    }
    if (
      (acknowledgement as { accepted: number }).accepted !== body.length
      || (acknowledgement as { dropped: number }).dropped !== 0
    ) {
      return { ok: false, status: response.status, detail: "viewer_log_ack_incomplete" };
    }
    return { ok: true, status: response.status };
  } catch {
    return { ok: false, status: 0, detail: "viewer_log_transport_failed" };
  }
}

function buildRecord(state: LoggerState, level: LogLevel, eventType: EventType, component: string, msg: string, data: Record<string, unknown> = {}, options: { caller?: string; error?: LogRecord["error"]; parent_trace_id?: string } = {}): LogRecord {
  const ts = isoUtcMs(state.now());
  const traceId = state.traceId;
  const record: LogRecord = {
    ts,
    level,
    event_type: eventType,
    service: "viewer",
    component,
    run_id: state.runId,
    trace_id: traceId,
    msg,
    data,
    seq: nextSeq(state, traceId),
  };
  if (options.caller) record.caller = options.caller;
  if (options.error) record.error = options.error;
  if (options.parent_trace_id) record.parent_trace_id = options.parent_trace_id;
  return record;
}

function enqueue(state: LoggerState, record: LogRecord): void {
  const entry: BufferEntry = { record, enqueuedAtMs: state.now().getTime() };
  state.buffer.push(entry);
  if (state.buffer.length > state.bufferCapacity) {
    const dropped = state.buffer.splice(0, state.buffer.length - state.bufferCapacity);
    state.droppedTotal += dropped.length;
    try {
      console.error(`[structLog] viewer buffer overflow; dropped ${dropped.length} oldest record(s)`);
    } catch {
      // ignore
    }
  }
}

async function flushBatch(state: LoggerState): Promise<number> {
  const inFlight = state.buffer.slice();
  const inFlightRecords = inFlight.map((b) => b.record);
  const url = state.endpoint();
  let backoff = state.flushBackoffMs;
  let lastDetail: string | undefined;
  for (let attempt = 1; attempt <= state.flushMaxAttempts; attempt += 1) {
    let result: { ok: boolean; status: number; detail?: string };
    try {
      result = await state.transport(url, inFlightRecords);
    } catch (err) {
      result = {
        ok: false,
        status: 0,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    if (result.ok) {
      // remove the in-flight entries (only those still at the head — if new
      // ones arrived after slice() they remain).
      const removed = state.buffer.splice(0, inFlight.length);
      state.flushedTotal += removed.length;
      state.lastFlushStatus = { ts: isoUtcMs(state.now()), status: "ok" };
      return removed.length;
    }
    lastDetail = result.detail ?? `http_${result.status}`;
    // Backoff before retrying.
    if (attempt < state.flushMaxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff *= 2;
    }
  }
  // Failed permanently. Drop expired entries (older than retainOnFailureMs).
  const cutoff = state.now().getTime() - state.retainOnFailureMs;
  const before = state.buffer.length;
  state.buffer = state.buffer.filter((entry) => entry.enqueuedAtMs >= cutoff);
  const expired = before - state.buffer.length;
  if (expired > 0) {
    state.droppedTotal += expired;
    try {
      console.error(`[structLog] viewer flush failed; ${expired} record(s) expired and dropped`);
    } catch {
      // ignore
    }
  }
  state.lastFlushStatus = { ts: isoUtcMs(state.now()), status: "failed", detail: lastDetail };
  return 0;
}

function flushOnce(state: LoggerState): Promise<number> {
  if (state.inFlightFlush) return state.inFlightFlush;
  if (state.buffer.length === 0) return Promise.resolve(0);

  const inFlight = flushBatch(state).finally(() => {
    if (state.inFlightFlush === inFlight) state.inFlightFlush = null;
  });
  state.inFlightFlush = inFlight;
  return inFlight;
}

async function flushManually(state: LoggerState): Promise<number> {
  const existing = state.inFlightFlush;
  if (!existing) return flushOnce(state);

  let flushedTotal = await existing;
  if (state.buffer.length > 0) {
    flushedTotal += await flushOnce(state);
  }
  return flushedTotal;
}

export function createBrowserLogger(options: BrowserLoggerOptions = {}): BrowserStructLogger {
  const now = options.now ?? (() => new Date());
  const randomHex = options.randomHex ?? defaultRandomHex;
  const runId = options.runId ?? generateRunId(now(), randomHex);
  const traceId = options.initialTraceId ?? `script_${runId}`;
  const endpointFn: () => string = (() => {
    const ep = options.endpoint;
    if (typeof ep === "function") return ep;
    if (typeof ep === "string") return () => ep;
    return defaultEndpoint;
  })();
  const state: LoggerState = {
    runId,
    traceId,
    buffer: [],
    bufferCapacity: options.bufferCapacity ?? DEFAULTS.bufferCapacity,
    flushAtRecords: options.flushAtRecords ?? DEFAULTS.flushAtRecords,
    flushIntervalMs: options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
    retainOnFailureMs: options.retainOnFailureMs ?? DEFAULTS.retainOnFailureMs,
    flushMaxAttempts: options.flushMaxAttempts ?? DEFAULTS.flushMaxAttempts,
    flushBackoffMs: options.flushBackoffMs ?? DEFAULTS.flushBackoffMs,
    endpoint: endpointFn,
    transport: options.transport ?? defaultTransport,
    now,
    flushedTotal: 0,
    droppedTotal: 0,
    lastFlushStatus: null,
    autoFlushPaused: false,
    inFlightFlush: null,
    timerId: null,
    seqByTrace: new Map(),
    closed: false,
  };

  if (options.enableTimer !== false) {
    state.timerId = setInterval(() => {
      if (state.autoFlushPaused) return;
      void flushOnce(state).catch(() => {
        // flushOnce already records lastFlushStatus on failure; swallow here.
      });
    }, state.flushIntervalMs);
  }

  function append(record: LogRecord): void {
    if (state.closed) return;
    enqueue(state, record);
    if (!state.autoFlushPaused && state.buffer.length >= state.flushAtRecords) {
      void flushOnce(state).catch(() => {
        // flushOnce already records lastFlushStatus; swallow.
      });
    }
  }

  const logger: BrowserStructLogger = {
    get runId() {
      return state.runId;
    },
    get traceId() {
      return state.traceId;
    },
    bufferLength: () => state.buffer.length,
    flushedTotal: () => state.flushedTotal,
    droppedTotal: () => state.droppedTotal,
    lastFlushStatus: () => state.lastFlushStatus,
    debug(component, msg, data) {
      append(buildRecord(state, "debug", "general", component, msg, data));
    },
    info(component, msg, data) {
      append(buildRecord(state, "info", "general", component, msg, data));
    },
    warn(component, msg, data) {
      append(buildRecord(state, "warn", "general", component, msg, data));
    },
    error(component, msg, err, data) {
      const classified = classifyError(err);
      append(
        buildRecord(state, "error", "logic_error", component, msg, { ...(data ?? {}), error: classified }, {
          caller: classified.stack_tail[0],
          error: classified,
        }),
      );
    },
    fatal(component, msg, err, data) {
      const classified = classifyError(err);
      append(
        buildRecord(state, "fatal", "logic_error", component, msg, { ...(data ?? {}), error: classified }, {
          caller: classified.stack_tail[0],
          error: classified,
        }),
      );
    },
    network(component, msg, data, level = "info") {
      append(buildRecord(state, level, "network", component, msg, data as unknown as Record<string, unknown>));
    },
    lifecycle(component, msg, data, level = "info") {
      append(buildRecord(state, level, "lifecycle", component, msg, data as unknown as Record<string, unknown>));
    },
    anomaly(component, msg, data, level = "warn") {
      append(buildRecord(state, level, "operation_anomaly", component, msg, data as unknown as Record<string, unknown>));
    },
    setTraceId(traceId) {
      state.traceId = traceId;
    },
    setAutoFlushPaused(paused) {
      state.autoFlushPaused = paused;
    },
    async flush() {
      return flushManually(state);
    },
    tail(n = 100) {
      return state.buffer.slice(-n).map((entry) => entry.record);
    },
    async shutdown() {
      state.closed = true;
      if (state.timerId !== null) clearInterval(state.timerId);
      await flushManually(state).catch(() => undefined);
    },
  };
  const safeVars = sanitizeBrowserSnapshotVars(options.browserSnapshotVars ?? []);
  append(buildRecord(state, "info", "env_snapshot", "bootstrap", "browser env snapshot", { vars: safeVars }));
  return logger;
}

/**
 * Wires `window.error`, `unhandledrejection`, and `window.__structLog.tail`
 * inspection. Idempotent on the given window: calling twice replaces the prior
 * handlers.
 */
export function installGlobalHandlers(
  logger: BrowserStructLogger,
  win: (Window & typeof globalThis) | undefined = typeof window !== "undefined" ? window : undefined,
): () => void {
  if (!win) return () => undefined;
  const errorHandler = (event: ErrorEvent) => {
    logger.error("globalError", event.message || "window error", event.error ?? event, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };
  const rejectionHandler = (event: PromiseRejectionEvent) => {
    logger.error("unhandledRejection", "unhandled promise rejection", event.reason);
  };
  win.addEventListener("error", errorHandler);
  win.addEventListener("unhandledrejection", rejectionHandler);
  (win as Window & { __structLog?: { tail: (n?: number) => LogRecord[]; logger: BrowserStructLogger } }).__structLog = {
    logger,
    tail: (n) => logger.tail(n),
  };
  return () => {
    win.removeEventListener("error", errorHandler);
    win.removeEventListener("unhandledrejection", rejectionHandler);
    delete (win as Window & { __structLog?: unknown }).__structLog;
  };
}
