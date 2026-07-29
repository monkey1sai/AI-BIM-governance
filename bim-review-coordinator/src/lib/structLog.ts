/**
 * Cross-service structured log adapter (TypeScript).
 *
 * Source of truth: docs/contracts/structured-log-schema.md and
 * tests/contracts/structured-log/schema.json. This module is one of four
 * adapters; the others (Python, PowerShell, Browser) live in their respective
 * sub-repos and produce records that validate against the same schema.
 *
 * Contract test: bim-review-coordinator/tests/contracts/structured-log/validate.contract.test.ts
 *
 * Failure mode contract:
 *   - sink failures NEVER throw to callers; the adapter writes
 *     "[structLog sink failed]" + the record to stderr and keeps going
 *   - circular references in `data` produce a downgraded
 *     operation_anomaly record, not a crash
 *   - logger creation emits env_snapshot before returning
 *
 * This adapter is intentionally dependency-free (Node stdlib only). It is
 * imported from coordinator's main entry (src/index.ts) and from request
 * handlers (src/app.ts) and the EventLog mirror (src/services/eventLog.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// -------------------- Public schema types --------------------

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type EventType =
  | "logic_error"
  | "operation_anomaly"
  | "env_snapshot"
  | "lifecycle"
  | "audit"
  | "network"
  | "general";

export type Service = "coordinator" | "streaming-server" | "viewer" | "scripts";

export type EnvSource = ".env" | ".env.example" | "system" | "docker-compose" | "default";

export interface EnvVar {
  key: string;
  source: EnvSource;
  value_or_redacted: string;
  type: "string" | "number" | "boolean" | "null" | "object" | "array";
}

export interface NetworkData {
  direction: "inbound" | "outbound";
  protocol: "http" | "websocket" | "socket.io" | "webrtc-signal" | "datachannel";
  peer: "coordinator" | "streaming-server" | "external-edge" | "external-cloud" | "kit-subprocess" | "viewer";
  status: number | string;
  duration_ms?: number;
  path?: string;
}

export interface AuditData {
  action: string;
  actor: string;
  target: string;
  /**
   * conv-prioritize-retry (模式 3 ③):controlled action 操作者在 confirm 對話框填入的
   * 自由理由。可空字串。寫入 audit trail 供事後追溯「為何插隊/重試」。
   */
  reason?: string;
  /**
   * conv-watch-toggle (spec §4.1):toggle 類 controlled action 的方向布林。watcher 啟停
   * 成功 audit 須提供獨立 `enabled` 欄位（不僅靠 target 字串編碼），供日後以 enabled 查
   * audit 的工具命中。其他 action 不設此欄即可(optional,backward-compatible)。
   */
  enabled?: boolean;
}

export type LifecycleSubjectKind =
  | "review_session"
  | "conversion_job"
  | "kit_subprocess"
  | "ifc_ready_job"
  | "script_run"
  | "outbox_delivery";

export interface LifecycleData {
  phase: "start" | "active" | "closing" | "closed";
  subject_kind: LifecycleSubjectKind;
  subject_id: string;
  [extra: string]: unknown;
}

export interface AnomalyData {
  anomaly_kind: "retry" | "fallback" | "timeout" | "unexpected_state";
  reason: string;
  [extra: string]: unknown;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event_type: EventType;
  service: Service;
  component: string;
  run_id: string;
  trace_id: string;
  msg: string;
  data: Record<string, unknown>;
  seq?: number;
  caller?: string;
  error?: { name: string; message: string; stack_tail: string[] };
  parent_event_id?: string;
  parent_trace_id?: string;
}

// -------------------- Public logger surface --------------------

export interface StructLogger {
  readonly service: Service;
  readonly runId: string;
  readonly currentFile: () => string;
  readonly recordsWritten: () => number;
  readonly recordsDropped: () => number;
  readonly lastFailure: () => { ts: string; reason: string } | null;

  debug(component: string, msg: string, data?: Record<string, unknown>): void;
  info(component: string, msg: string, data?: Record<string, unknown>): void;
  warn(component: string, msg: string, data?: Record<string, unknown>): void;
  error(component: string, msg: string, err: unknown, data?: Record<string, unknown>): void;
  fatal(component: string, msg: string, err: unknown, data?: Record<string, unknown>): void;

  network(component: string, msg: string, data: NetworkData, level?: LogLevel): void;
  audit(component: string, msg: string, data: AuditData, level?: LogLevel): void;
  lifecycle(component: string, msg: string, data: LifecycleData, level?: LogLevel): void;
  anomaly(component: string, msg: string, data: AnomalyData, level?: LogLevel): void;
  envSnapshot(component: string, vars: EnvVar[]): void;

  /** Manually attach a record (e.g. routing a viewer-side record through coordinator) without re-running redaction. */
  writeRaw(record: LogRecord): void;

  withTraceId(traceId: string): StructLogger;
  noteDropped(reason?: string): void;
  flushAndClose(): void;
}

// -------------------- Allow-list loading --------------------

const SECRET_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL)/i;

interface AllowListSpec {
  allow_list: string[];
  secret_patterns: string[];
}

let _allowListCache: { keys: Set<string>; patterns: RegExp } | null = null;

function resolveAllowListPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/lib/structLog.ts -> repo root is 4 levels up: src/lib -> src -> coordinator -> repo
  return path.resolve(here, "..", "..", "..", "tests", "contracts", "structured-log", "env-allowlist.json");
}

export function loadAllowList(filePath: string = resolveAllowListPath()): {
  keys: Set<string>;
  patterns: RegExp;
} {
  if (_allowListCache) return _allowListCache;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const spec = JSON.parse(raw) as AllowListSpec;
    const patternSource = spec.secret_patterns.join("|");
    _allowListCache = {
      keys: new Set(spec.allow_list),
      patterns: new RegExp(patternSource, "i"),
    };
  } catch {
    _allowListCache = { keys: new Set(), patterns: SECRET_PATTERN };
  }
  return _allowListCache;
}

/** Used in tests to force a fresh load (e.g. after monkey-patching the JSON). */
export function _resetAllowListCacheForTest(): void {
  _allowListCache = null;
}

// -------------------- Utility helpers (exported for tests) --------------------

export function generateRunId(now: Date = new Date(), randomHex?: string): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mi = now.getUTCMinutes().toString().padStart(2, "0");
  const ss = now.getUTCSeconds().toString().padStart(2, "0");
  const hex = randomHex ?? randomBytes(3).toString("hex");
  return `run_${yyyy}${mm}${dd}_${hh}${mi}${ss}_${hex}`;
}

export function isoUtcMs(now: Date = new Date()): string {
  return now.toISOString().replace(/\.(\d{3})\d*Z$/, ".$1Z");
}

export function dateDirFromIso(ts: string): string {
  // ts is "YYYY-MM-DDTHH:MM:SS.mmmZ"; the date directory uses YYYY-MM-DD in UTC.
  return ts.slice(0, 10);
}

function typeOfValue(value: unknown): EnvVar["type"] {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "string";
}

/**
 * Redact a single env var value according to docs/contracts/structured-log-schema.md §5.1.
 *
 *   1. Allow-list hit → emit raw value (string-coerced).
 *   2. Key matches secret pattern → "[REDACTED:type=...,len=...]".
 *   3. Otherwise → "[TYPE:type=...,len=...]" — type + length only.
 */
export function redactEnvValue(
  key: string,
  value: unknown,
  allowList: { keys: Set<string>; patterns: RegExp } = loadAllowList(),
): EnvVar {
  const type = typeOfValue(value);
  const stringValue = value === null || value === undefined ? "" : String(value);
  if (allowList.keys.has(key)) {
    return { key, source: "system", value_or_redacted: stringValue, type };
  }
  if (allowList.patterns.test(key)) {
    return {
      key,
      source: "system",
      value_or_redacted: `[REDACTED:type=${type}, len=${stringValue.length}]`,
      type,
    };
  }
  return {
    key,
    source: "system",
    value_or_redacted: `[TYPE:type=${type}, len=${stringValue.length}]`,
    type,
  };
}

export const MAX_REDACTION_DEPTH = 8;

export function redactDataBeforeWrite(
  data: unknown,
  allowList: { keys: Set<string>; patterns: RegExp } = loadAllowList(),
  activePath: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;
  if (depth > MAX_REDACTION_DEPTH) return "[Truncated]";
  if (activePath.has(data as object)) return "[Circular]";
  activePath.add(data as object);

  try {
    if (Array.isArray(data)) {
      return data.map((item) => redactDataBeforeWrite(item, allowList, activePath, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      out[key] = allowList.patterns.test(key)
        ? "[REDACTED]"
        : redactDataBeforeWrite(value, allowList, activePath, depth + 1);
    }
    return out;
  } finally {
    activePath.delete(data as object);
  }
}

function sanitizeEnvSnapshotVars(value: unknown): EnvVar[] {
  if (!Array.isArray(value)) return [];
  const vars: EnvVar[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const row = candidate as Partial<EnvVar>;
    if (
      typeof row.key !== "string"
      || typeof row.source !== "string"
      || typeof row.value_or_redacted !== "string"
      || typeof row.type !== "string"
    ) continue;
    vars.push({
      key: row.key,
      source: row.source as EnvSource,
      value_or_redacted: row.value_or_redacted,
      type: row.type as EnvVar["type"],
    });
  }
  return vars;
}

function sanitizeInboundEnvSnapshotVars(value: unknown): EnvVar[] {
  return sanitizeEnvSnapshotVars(value).map((row) => {
    const sanitized = redactEnvValue(row.key, row.value_or_redacted);
    return {
      ...row,
      value_or_redacted: sanitized.value_or_redacted,
    };
  });
}

function sanitizeRecordData(
  eventType: EventType,
  data: Record<string, unknown>,
  trustEnvSnapshotValues = true,
): Record<string, unknown> {
  try {
    if (eventType !== "env_snapshot") {
      return redactDataBeforeWrite(data) as Record<string, unknown>;
    }
    const allowList = loadAllowList();
    const activePath = new WeakSet<object>();
    activePath.add(data);
    try {
      const safe: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key === "vars") {
          safe.vars = trustEnvSnapshotValues
            ? sanitizeEnvSnapshotVars(value)
            : sanitizeInboundEnvSnapshotVars(value);
        } else {
          safe[key] = allowList.patterns.test(key)
            ? "[REDACTED]"
            : redactDataBeforeWrite(value, allowList, activePath, 1);
        }
      }
      return safe;
    } finally {
      activePath.delete(data);
    }
  } catch {
    return { redaction_failure: "[Truncated]" };
  }
}

/**
 * JSON.stringify with circular-reference protection and Error / Date / BigInt
 * coercion. Never throws.
 */
export function safeStringify(record: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(record, function replacer(this: unknown, _key, value) {
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    if (value && typeof value === "object") {
      if (seen.has(value as object)) return "[Circular]";
      seen.add(value as object);
    }
    return value;
  });
}

// -------------------- Runtime validator for viewer-log intake --------------------

const VALID_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error", "fatal"]);
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  "logic_error",
  "operation_anomaly",
  "env_snapshot",
  "lifecycle",
  "audit",
  "network",
  "general",
]);
const VALID_SERVICES: ReadonlySet<string> = new Set(["coordinator", "streaming-server", "viewer", "scripts"]);
const VALID_ENV_SOURCES: ReadonlySet<string> = new Set([".env", ".env.example", "system", "docker-compose", "default"]);
const VALID_ENV_TYPES: ReadonlySet<string> = new Set(["string", "number", "boolean", "null", "object", "array"]);
const VALID_ANOMALY_KINDS: ReadonlySet<string> = new Set(["retry", "fallback", "timeout", "unexpected_state"]);
const VALID_LIFECYCLE_PHASES: ReadonlySet<string> = new Set(["start", "active", "closing", "closed"]);
const VALID_LIFECYCLE_SUBJECTS: ReadonlySet<string> = new Set([
  "review_session", "conversion_job", "kit_subprocess", "ifc_ready_job", "script_run", "outbox_delivery",
]);
const VALID_NETWORK_DIRECTIONS: ReadonlySet<string> = new Set(["inbound", "outbound"]);
const VALID_NETWORK_PROTOCOLS: ReadonlySet<string> = new Set([
  "http", "websocket", "socket.io", "webrtc-signal", "datachannel",
]);
const VALID_NETWORK_PEERS: ReadonlySet<string> = new Set([
  "coordinator", "streaming-server", "external-edge", "external-cloud", "kit-subprocess", "viewer",
]);
const RUN_ID_PATTERN = /^run_\d{8}_\d{6}_[0-9a-f]{6}$/;
const TRACE_ID_PATTERN = /^(ifcready_|rev_|stream_conv_|script_|external_)[A-Za-z0-9_\-]+$/;
const ISO_MS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CALLER_PATTERN = /^.+:\d+$/;
const LOG_RECORD_KEYS = new Set([
  "ts", "level", "event_type", "service", "component", "run_id", "trace_id", "msg", "data",
  "seq", "caller", "error", "parent_event_id", "parent_trace_id",
]);

export type ValidationResult = { valid: true; record: LogRecord } | { valid: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && record[key].length > 0;
}

function isErrorShape(value: unknown, allowExtraFields: boolean): boolean {
  if (!isRecord(value)) return false;
  if (!allowExtraFields && Object.keys(value).some((key) => !["name", "message", "stack_tail"].includes(key))) {
    return false;
  }
  return hasNonEmptyString(value, "name")
    && typeof value.message === "string"
    && Array.isArray(value.stack_tail)
    && value.stack_tail.length <= 8
    && value.stack_tail.every((line) => typeof line === "string");
}

function validateEventData(eventType: EventType, data: Record<string, unknown>, error: unknown): string | null {
  switch (eventType) {
    case "logic_error":
      return isErrorShape(error, false) && isErrorShape(data.error, true) ? null : "bad_logic_error_data";
    case "operation_anomaly":
      return typeof data.anomaly_kind === "string"
        && VALID_ANOMALY_KINDS.has(data.anomaly_kind)
        && hasNonEmptyString(data, "reason")
        ? null
        : "bad_operation_anomaly_data";
    case "env_snapshot": {
      if (!Array.isArray(data.vars)) return "bad_env_snapshot_data";
      const validVars = data.vars.every((value) => {
        if (!isRecord(value)) return false;
        if (Object.keys(value).some((key) => !["key", "source", "value_or_redacted", "type"].includes(key))) {
          return false;
        }
        return hasNonEmptyString(value, "key")
          && typeof value.source === "string"
          && VALID_ENV_SOURCES.has(value.source)
          && typeof value.value_or_redacted === "string"
          && typeof value.type === "string"
          && VALID_ENV_TYPES.has(value.type);
      });
      return validVars ? null : "bad_env_snapshot_data";
    }
    case "lifecycle":
      return typeof data.phase === "string"
        && VALID_LIFECYCLE_PHASES.has(data.phase)
        && typeof data.subject_kind === "string"
        && VALID_LIFECYCLE_SUBJECTS.has(data.subject_kind)
        && hasNonEmptyString(data, "subject_id")
        ? null
        : "bad_lifecycle_data";
    case "audit":
      return hasNonEmptyString(data, "action")
        && hasNonEmptyString(data, "actor")
        && hasNonEmptyString(data, "target")
        ? null
        : "bad_audit_data";
    case "network": {
      const statusValid = (typeof data.status === "string" && data.status.length > 0)
        || Number.isInteger(data.status);
      const durationValid = data.duration_ms === undefined
        || (Number.isInteger(data.duration_ms) && (data.duration_ms as number) >= 0);
      const pathValid = data.path === undefined
        || (typeof data.path === "string" && !data.path.includes("?"));
      return typeof data.direction === "string"
        && VALID_NETWORK_DIRECTIONS.has(data.direction)
        && typeof data.protocol === "string"
        && VALID_NETWORK_PROTOCOLS.has(data.protocol)
        && typeof data.peer === "string"
        && VALID_NETWORK_PEERS.has(data.peer)
        && statusValid
        && durationValid
        && pathValid
        ? null
        : "bad_network_data";
    }
    case "general":
      return null;
  }
}

/**
 * Lightweight runtime validation used by viewer-log intake to drop malformed
 * records without dragging ajv into the production bundle. Spec-strictness lives
 * in the contract tests (tests/contracts/structured-log/test_validate.py and
 * the ajv-backed Vitest sibling).
 */
export function validateLogRecordBasic(input: unknown): ValidationResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, reason: "not_an_object" };
  }
  const rec = input as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!LOG_RECORD_KEYS.has(key)) return { valid: false, reason: "unknown_top_level_field" };
  }
  const required = ["ts", "level", "event_type", "service", "component", "run_id", "trace_id", "msg", "data"] as const;
  for (const field of required) {
    if (!(field in rec)) return { valid: false, reason: `missing_${field}` };
  }
  if (typeof rec.ts !== "string" || !ISO_MS_PATTERN.test(rec.ts)) return { valid: false, reason: "bad_ts" };
  if (typeof rec.level !== "string" || !VALID_LEVELS.has(rec.level)) return { valid: false, reason: "bad_level" };
  if (typeof rec.event_type !== "string" || !VALID_EVENT_TYPES.has(rec.event_type)) {
    return { valid: false, reason: "bad_event_type" };
  }
  if (typeof rec.service !== "string" || !VALID_SERVICES.has(rec.service)) {
    return { valid: false, reason: "bad_service" };
  }
  if (typeof rec.component !== "string" || rec.component.length === 0 || rec.component.length > 200) {
    return { valid: false, reason: "bad_component" };
  }
  if (typeof rec.run_id !== "string" || !RUN_ID_PATTERN.test(rec.run_id)) {
    return { valid: false, reason: "bad_run_id" };
  }
  if (typeof rec.trace_id !== "string" || rec.trace_id.length > 200 || !TRACE_ID_PATTERN.test(rec.trace_id)) {
    return { valid: false, reason: "bad_trace_id" };
  }
  if (typeof rec.msg !== "string" || rec.msg.length === 0 || rec.msg.length > 2000) {
    return { valid: false, reason: "bad_msg" };
  }
  if (rec.data === null || typeof rec.data !== "object" || Array.isArray(rec.data)) {
    return { valid: false, reason: "bad_data" };
  }
  if (rec.seq !== undefined && (!Number.isInteger(rec.seq) || (rec.seq as number) < 1)) {
    return { valid: false, reason: "bad_seq" };
  }
  if (rec.caller !== undefined && (typeof rec.caller !== "string" || !CALLER_PATTERN.test(rec.caller))) {
    return { valid: false, reason: "bad_caller" };
  }
  if (rec.parent_event_id !== undefined && (typeof rec.parent_event_id !== "string" || rec.parent_event_id.length === 0)) {
    return { valid: false, reason: "bad_parent_event_id" };
  }
  if (rec.parent_trace_id !== undefined && (typeof rec.parent_trace_id !== "string" || !TRACE_ID_PATTERN.test(rec.parent_trace_id))) {
    return { valid: false, reason: "bad_parent_trace_id" };
  }
  if (rec.error !== undefined && !isErrorShape(rec.error, false)) return { valid: false, reason: "bad_error" };
  const eventDataError = validateEventData(
    rec.event_type as EventType,
    rec.data as Record<string, unknown>,
    rec.error,
  );
  if (eventDataError) return { valid: false, reason: eventDataError };
  const record: LogRecord = {
    ts: rec.ts as string,
    level: rec.level as LogLevel,
    event_type: rec.event_type as EventType,
    service: rec.service as Service,
    component: rec.component as string,
    run_id: rec.run_id as string,
    trace_id: rec.trace_id as string,
    msg: rec.msg as string,
    data: rec.data as Record<string, unknown>,
  };
  if (rec.seq !== undefined) record.seq = rec.seq as number;
  if (rec.caller !== undefined) record.caller = rec.caller as string;
  if (rec.error !== undefined) record.error = rec.error as LogRecord["error"];
  if (rec.parent_event_id !== undefined) record.parent_event_id = rec.parent_event_id as string;
  if (rec.parent_trace_id !== undefined) record.parent_trace_id = rec.parent_trace_id as string;
  return { valid: true, record };
}

// -------------------- Persistence helper (used by viewer-log intake) --------------------

export interface PersistResult {
  written: number;
  dropped: number;
  droppedReasons: Map<string, number>;
}

/**
 * Persist a batch of already-validated records straight to
 * `<logRoot>/<service>/<YYYY-MM-DD>/<service>-<run_id>.jsonl`. Used by the
 * coordinator's `POST /api/internal/viewer-log` handler to write viewer
 * records under `logs/viewer/...` instead of coordinator's own file.
 */
export function persistRecordsToServicePaths(
  records: LogRecord[],
  logRoot: string = defaultLogRoot(),
): PersistResult {
  const result: PersistResult = { written: 0, dropped: 0, droppedReasons: new Map() };
  for (const record of records) {
    const safeRecord: LogRecord = {
      ...record,
      data: sanitizeRecordData(record.event_type, record.data, false),
    };
    const dateDir = dateDirFromIso(record.ts);
    const dir = path.join(logRoot, record.service, dateDir);
    if (!ensureDir(dir)) {
      result.dropped += 1;
      result.droppedReasons.set("mkdir_failed", (result.droppedReasons.get("mkdir_failed") ?? 0) + 1);
      continue;
    }
    const file = path.join(dir, `${record.service}-${record.run_id}.jsonl`);
    try {
      fs.appendFileSync(file, safeStringify(safeRecord) + "\n", { encoding: "utf-8" });
      result.written += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.name : "append_failed";
      result.dropped += 1;
      result.droppedReasons.set(reason, (result.droppedReasons.get(reason) ?? 0) + 1);
    }
  }
  return result;
}

export function extractStackTail(err: unknown, max: number = 8): string[] {
  if (!err || typeof err !== "object") return [];
  const stack = (err as { stack?: unknown }).stack;
  if (typeof stack !== "string") return [];
  return stack.split("\n").slice(1, max + 1).map((line) => line.trim());
}

// -------------------- Logger implementation --------------------

interface LoggerInternalState {
  service: Service;
  runId: string;
  logRoot: string;
  traceId: string | null;
  currentDate: string;
  currentFile: string;
  recordsWritten: number;
  recordsDropped: number;
  lastFailure: { ts: string; reason: string } | null;
  ringBuffer: LogRecord[];
  ringBufferSize: number;
  envSnapshotEmitted: boolean;
  closed: boolean;
  // Per-trace_id sequence counters, shared between parent and child loggers.
  seqByTrace: Map<string, number>;
  // Optional clock override for tests.
  now: () => Date;
}

const RING_BUFFER_DEFAULT = 100;

function defaultLogRoot(): string {
  const fromEnv = process.env.LOG_ROOT;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return path.resolve(process.cwd(), "logs");
}

function ensureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

function buildFilePath(state: LoggerInternalState, dateDir: string): string {
  return path.join(state.logRoot, state.service, dateDir, `${state.service}-${state.runId}.jsonl`);
}

function rotateIfNeeded(state: LoggerInternalState, recordDate: string): void {
  if (state.currentDate === recordDate) return;
  state.currentDate = recordDate;
  state.currentFile = buildFilePath(state, recordDate);
  ensureDir(path.dirname(state.currentFile));
}

function recordSinkFailure(state: LoggerInternalState, reason: string, record: LogRecord, line: string): void {
  state.recordsDropped += 1;
  state.lastFailure = { ts: isoUtcMs(state.now()), reason };
  state.ringBuffer.push(record);
  while (state.ringBuffer.length > state.ringBufferSize) state.ringBuffer.shift();
  try {
    process.stderr.write(`[structLog sink failed: ${reason}] ${line}\n`);
  } catch {
    // give up — there is no further fallback path.
  }
}

function writeRecord(state: LoggerInternalState, record: LogRecord): void {
  if (state.closed) return;
  rotateIfNeeded(state, dateDirFromIso(record.ts));
  const line = safeStringify(record) + "\n";
  // stdout first — it is best-effort but offers parallel observability.
  try {
    process.stdout.write(line);
  } catch {
    // swallow; stdout failures should not affect file sink retries.
  }
  // File sink with recovery directory fallback.
  try {
    if (!ensureDir(path.dirname(state.currentFile))) throw new Error("mkdir failed");
    fs.appendFileSync(state.currentFile, line, { encoding: "utf-8" });
    state.recordsWritten += 1;
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // Attempt to write to a recovery file on a separate path.
    try {
      const recoveryDir = path.join(state.logRoot, state.service, "_recovery");
      if (ensureDir(recoveryDir)) {
        const recoveryFile = path.join(recoveryDir, `${state.currentDate}-${state.runId}.jsonl`);
        fs.appendFileSync(recoveryFile, line, { encoding: "utf-8" });
        state.recordsWritten += 1;
        state.lastFailure = { ts: isoUtcMs(state.now()), reason: `${reason} (recovered)` };
        return;
      }
    } catch {
      // fall through
    }
    recordSinkFailure(state, reason, record, line);
  }
}

function buildRecord(
  state: LoggerInternalState,
  level: LogLevel,
  eventType: EventType,
  component: string,
  msg: string,
  data: Record<string, unknown> | undefined,
  options: { caller?: string; error?: LogRecord["error"]; parent_event_id?: string; parent_trace_id?: string } = {},
): LogRecord {
  const ts = isoUtcMs(state.now());
  // Default trace_id falls back to script_<run_id> when no upstream id has been set.
  const traceId = state.traceId ?? `script_${state.runId}`;
  const safeData = data ? sanitizeRecordData(eventType, data) : {};

  const nextSeq = (state.seqByTrace.get(traceId) ?? 0) + 1;
  state.seqByTrace.set(traceId, nextSeq);

  const record: LogRecord = {
    ts,
    level,
    event_type: eventType,
    service: state.service,
    component,
    run_id: state.runId,
    trace_id: traceId,
    msg,
    data: safeData,
    seq: nextSeq,
  };
  if (options.caller) record.caller = options.caller;
  if (options.error) record.error = options.error;
  if (options.parent_event_id) record.parent_event_id = options.parent_event_id;
  if (options.parent_trace_id) record.parent_trace_id = options.parent_trace_id;
  return record;
}

function classifyError(err: unknown): { name: string; message: string; stack_tail: string[] } {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack_tail: extractStackTail(err),
    };
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

function buildLogicErrorRecord(
  state: LoggerInternalState,
  level: "error" | "fatal",
  component: string,
  msg: string,
  err: unknown,
  data: Record<string, unknown> | undefined,
): LogRecord {
  const classified = classifyError(err);
  const merged = { ...(data ?? {}), error: classified };
  return buildRecord(state, level, "logic_error", component, msg, merged, {
    error: classified,
    // caller hint: the topmost stack tail entry often points at the originating site.
    caller: classified.stack_tail[0],
  });
}

function attemptWrite(state: LoggerInternalState, record: LogRecord): void {
  try {
    writeRecord(state, record);
  } catch (err) {
    // last-resort: the implementation above should never throw, but if it does,
    // record a degraded sink failure and swallow.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    recordSinkFailure(state, reason, record, safeStringify(record));
  }
}

function envSnapshotFromProcess(allowList: { keys: Set<string>; patterns: RegExp }): EnvVar[] {
  const env = process.env;
  return Object.keys(env)
    .sort()
    .map((key) => {
      const value = env[key];
      return redactEnvValue(key, value, allowList);
    });
}

function makeLogger(state: LoggerInternalState): StructLogger {
  const logger: StructLogger = {
    get service() {
      return state.service;
    },
    get runId() {
      return state.runId;
    },
    currentFile: () => state.currentFile,
    recordsWritten: () => state.recordsWritten,
    recordsDropped: () => state.recordsDropped,
    lastFailure: () => state.lastFailure,
    debug(component, msg, data) {
      attemptWrite(state, buildRecord(state, "debug", "general", component, msg, data));
    },
    info(component, msg, data) {
      attemptWrite(state, buildRecord(state, "info", "general", component, msg, data));
    },
    warn(component, msg, data) {
      attemptWrite(state, buildRecord(state, "warn", "general", component, msg, data));
    },
    error(component, msg, err, data) {
      attemptWrite(state, buildLogicErrorRecord(state, "error", component, msg, err, data));
    },
    fatal(component, msg, err, data) {
      attemptWrite(state, buildLogicErrorRecord(state, "fatal", component, msg, err, data));
    },
    network(component, msg, data, level = "info") {
      attemptWrite(
        state,
        buildRecord(state, level, "network", component, msg, data as unknown as Record<string, unknown>),
      );
    },
    audit(component, msg, data, level = "info") {
      attemptWrite(
        state,
        buildRecord(state, level, "audit", component, msg, data as unknown as Record<string, unknown>),
      );
    },
    lifecycle(component, msg, data, level = "info") {
      attemptWrite(
        state,
        buildRecord(state, level, "lifecycle", component, msg, data as unknown as Record<string, unknown>),
      );
    },
    anomaly(component, msg, data, level = "warn") {
      attemptWrite(
        state,
        buildRecord(state, level, "operation_anomaly", component, msg, data as unknown as Record<string, unknown>),
      );
    },
    envSnapshot(component, vars) {
      const safeVars = vars.map((v) => ({ ...v }));
      attemptWrite(state, buildRecord(state, "info", "env_snapshot", component, "env snapshot", { vars: safeVars }));
    },
    writeRaw(record) {
      attemptWrite(state, {
        ...record,
        data: sanitizeRecordData(record.event_type, record.data),
      });
    },
    withTraceId(traceId) {
      // Children share mutable counters, recovery state, and seq map with the parent
      // so file-level statistics and per-trace sequencing remain consistent.
      const childState: LoggerInternalState = Object.create(state) as LoggerInternalState;
      childState.traceId = traceId;
      return makeLogger(childState);
    },
    noteDropped(reason = "external_drop") {
      state.recordsDropped += 1;
      state.lastFailure = { ts: isoUtcMs(state.now()), reason };
    },
    flushAndClose() {
      state.closed = true;
    },
  };
  return logger;
}

// -------------------- Public factory --------------------

export interface CreateLoggerOptions {
  logRoot?: string;
  runId?: string;
  initialTraceId?: string;
  /** Override the allow-list source (used by tests). */
  allowList?: { keys: Set<string>; patterns: RegExp };
  /** Override clock (used by tests). */
  now?: () => Date;
  /** Disable the immediate env_snapshot emission (used by tests). */
  skipEnvSnapshot?: boolean;
  /** Override the env source map (used by tests when simulating .env vs system). */
  envSource?: (key: string) => EnvSource;
  ringBufferSize?: number;
}

export function createLogger(service: Service, opts: CreateLoggerOptions = {}): StructLogger {
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? generateRunId(now());
  const logRoot = opts.logRoot ?? defaultLogRoot();
  const initialTraceId = opts.initialTraceId ?? null;
  const allowList = opts.allowList ?? loadAllowList();
  const initialDate = dateDirFromIso(isoUtcMs(now()));

  const state: LoggerInternalState = {
    service,
    runId,
    logRoot,
    traceId: initialTraceId,
    currentDate: initialDate,
    currentFile: "",
    recordsWritten: 0,
    recordsDropped: 0,
    lastFailure: null,
    ringBuffer: [],
    ringBufferSize: opts.ringBufferSize ?? RING_BUFFER_DEFAULT,
    envSnapshotEmitted: false,
    closed: false,
    seqByTrace: new Map(),
    now,
  };
  state.currentFile = buildFilePath(state, state.currentDate);
  ensureDir(path.dirname(state.currentFile));

  const logger = makeLogger(state);

  if (!opts.skipEnvSnapshot) {
    const vars = envSnapshotFromProcess(allowList).map((v) =>
      opts.envSource ? { ...v, source: opts.envSource(v.key) } : v,
    );
    logger.envSnapshot("bootstrap", vars);
    state.envSnapshotEmitted = true;
  }

  return logger;
}
