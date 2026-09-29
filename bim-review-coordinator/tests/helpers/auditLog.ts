// Structured-log audit harness for app-level tests: a logger injected through createCoordinatorApp that writes to a
// temporary directory, and a reader for the audit records it wrote (the approach of tests/conversion-control-routes.test.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger, type StructLogger } from "../../src/lib/structLog.js";

export interface AuditLogHarness {
  logger: StructLogger;
  /** Temporary log root; the caller removes it. */
  logRoot: string;
}

export function createAuditLogHarness(): AuditLogHarness {
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-audit-log-"));
  return { logger: createLogger("coordinator", { logRoot, skipEnvSnapshot: true }), logRoot };
}

/** Audit records the logger wrote, optionally only those whose `data.action` equals `action`. */
export function readAuditRecords(logger: StructLogger, action?: string): Array<Record<string, unknown>> {
  const file = logger.currentFile();
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf-8").trim();
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.event_type === "audit"
      && (action === undefined || (record.data as Record<string, unknown> | undefined)?.action === action));
}
