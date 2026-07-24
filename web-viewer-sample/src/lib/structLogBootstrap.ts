import { trustedCoordinatorBase } from "../config/env";
import {
  createBrowserLogger,
  installGlobalHandlers,
  type BrowserLoggerOptions,
  type BrowserStructLogger,
  type LogRecord,
} from "./structLog";

const TRACE_ID_MAX_LENGTH = 200;
const TRACE_ID_PATTERN = /^(ifcready_|rev_|stream_conv_|script_)([A-Za-z0-9_-]+)$/;
const TRACE_ID_PREFIX_PATTERN = /^(?:ifcready_|rev_|stream_conv_|script_|external_)/;

declare global {
  interface Window {
    __structLog?: {
      logger: BrowserStructLogger;
      tail: (n?: number) => LogRecord[];
    };
  }
}

type BrowserWindow = Window & typeof globalThis;

export interface StructLogBootstrapOptions {
  search: string;
  coordinatorApiBase: string;
  browserSnapshotVars: NonNullable<BrowserLoggerOptions["browserSnapshotVars"]>;
  win?: BrowserWindow;
  createLogger?: (options: BrowserLoggerOptions) => BrowserStructLogger;
  installHandlers?: (logger: BrowserStructLogger, win: BrowserWindow) => () => void;
}

let singletonLogger: BrowserStructLogger | null = null;
let removeGlobalHandlers: (() => void) | null = null;

/** Return one safe documented trace carrier, or null when the query is absent or invalid. */
export function traceIdFromSearch(search: string): string | null {
  const values = new URLSearchParams(search).getAll("trace_id");
  if (values.length !== 1) return null;

  const traceId = values[0];
  if (traceId.length > TRACE_ID_MAX_LENGTH) return null;
  const match = TRACE_ID_PATTERN.exec(traceId);
  if (!match) return null;

  // A trace already includes exactly one origin prefix. Reject nested or
  // cross-prefixed payloads instead of normalizing attacker-controlled input.
  if (TRACE_ID_PREFIX_PATTERN.test(match[2])) return null;
  return traceId;
}

/** Create and expose the process-wide browser logger exactly once. */
export function bootstrapStructLog(options: StructLogBootstrapOptions): BrowserStructLogger {
  if (singletonLogger) return singletonLogger;

  const coordinatorApiBase = trustedCoordinatorBase(options.coordinatorApiBase);
  if (!coordinatorApiBase) {
    throw new Error("Untrusted coordinator base for structured log bootstrap");
  }

  const createLogger = options.createLogger ?? createBrowserLogger;
  const installHandlers = options.installHandlers ?? installGlobalHandlers;
  const win = options.win ?? (typeof window !== "undefined" ? window : undefined);
  if (!win) throw new Error("Browser window is required for structured log bootstrap");

  const traceId = traceIdFromSearch(options.search);
  const logger = createLogger({
    ...(traceId ? { initialTraceId: traceId } : {}),
    browserSnapshotVars: options.browserSnapshotVars,
    endpoint: `${coordinatorApiBase}/api/internal/viewer-log`,
  });

  removeGlobalHandlers = installHandlers(logger, win);
  singletonLogger = logger;
  return logger;
}

/** Test-only isolation for Vitest's shared jsdom window. */
export function resetStructLogBootstrapForTests(): void {
  removeGlobalHandlers?.();
  removeGlobalHandlers = null;
  singletonLogger = null;
}
