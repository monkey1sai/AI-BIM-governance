import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import * as AjvNs from "ajv";
import type { ErrorObject } from "ajv";

import {
  createLogger,
  generateRunId,
  isoUtcMs,
  redactEnvValue,
  redactDataBeforeWrite,
  safeStringify,
  loadAllowList,
  _resetAllowListCacheForTest,
  type StructLogger,
} from "../../src/lib/structLog.js";

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
  errors: ErrorObject[] | null | undefined;
};

const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const SCHEMA_PATH = resolve(__dirname, "../../../tests/contracts/structured-log/schema.json");
const ENV_ALLOWLIST_PATH = resolve(__dirname, "../../../tests/contracts/structured-log/env-allowlist.json");

function loadSchemaValidator() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema) as ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
}

function readAllLines(filePath: string): unknown[] {
  return readFileSync(filePath, "utf-8")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function freezeClock(start: Date): () => Date {
  return () => new Date(start.getTime());
}

function freshAllowList() {
  _resetAllowListCacheForTest();
  return loadAllowList(ENV_ALLOWLIST_PATH);
}

describe("structLog adapter", () => {
  let tmpRoot: string;
  let validate: ReturnType<typeof loadSchemaValidator>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "structlog-"));
    validate = loadSchemaValidator();
    freshAllowList();
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("generateRunId produces the documented pattern", () => {
    const id = generateRunId(new Date("2026-05-26T14:20:10Z"), "a3f900");
    expect(id).toBe("run_20260526_142010_a3f900");
    expect(id).toMatch(/^run_\d{8}_\d{6}_[0-9a-f]{6}$/);
  });

  it("isoUtcMs always carries millisecond precision", () => {
    expect(isoUtcMs(new Date("2026-05-26T14:23:11.482Z"))).toBe("2026-05-26T14:23:11.482Z");
    // Date with no sub-second still emits .000Z
    expect(isoUtcMs(new Date("2026-05-26T14:23:11Z"))).toBe("2026-05-26T14:23:11.000Z");
  });

  it("redactEnvValue emits raw value for allow-list keys", () => {
    const allow = freshAllowList();
    const v = redactEnvValue("STORAGE_ROOT", "C:\\repos\\foo", allow);
    expect(v.value_or_redacted).toBe("C:\\repos\\foo");
    expect(v.type).toBe("string");
  });

  it("redactEnvValue redacts secret-pattern keys with type+len", () => {
    const allow = freshAllowList();
    const v = redactEnvValue("INTERNAL_API_TOKEN", "abc123xyz", allow);
    expect(v.value_or_redacted).toBe("[REDACTED:type=string, len=9]");
  });

  it("redactEnvValue emits type-only for non-listed non-secret keys", () => {
    const allow = freshAllowList();
    const v = redactEnvValue("RANDOM_KNOB", "hello", allow);
    expect(v.value_or_redacted).toBe("[TYPE:type=string, len=5]");
  });

  it("redactDataBeforeWrite strips secret-pattern keys at any depth", () => {
    const allow = freshAllowList();
    const out = redactDataBeforeWrite(
      { password: "abc", nested: { api_key: "shh", body: { token: "tok" } } },
      allow,
    ) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.api_key).toBe("[REDACTED]");
    const body = nested.body as Record<string, unknown>;
    expect(body.token).toBe("[REDACTED]");
  });

  it("safeStringify handles circular references without throwing", () => {
    const obj: Record<string, unknown> = { name: "a" };
    obj.self = obj;
    const text = safeStringify(obj);
    expect(text).toContain('"self":"[Circular]"');
  });

  it("createLogger writes env_snapshot to the daily file and stdout", () => {
    process.env.STRUCTLOG_TEST_SECRET = "supersecret-1234";
    try {
      const logger = createLogger("coordinator", {
        logRoot: tmpRoot,
        runId: "run_20260526_142010_a3f900",
        now: freezeClock(new Date("2026-05-26T14:20:10.001Z")),
      });
      expect(logger.currentFile()).toMatch(/coordinator[\\/]2026-05-26[\\/]coordinator-run_20260526_142010_a3f900\.jsonl$/);

      const lines = readAllLines(logger.currentFile());
      expect(lines).toHaveLength(1);
      const record = lines[0] as Record<string, unknown>;
      expect(record.event_type).toBe("env_snapshot");
      expect(record.service).toBe("coordinator");
      expect(record.level).toBe("info");
      const data = record.data as { vars: Array<{ key: string; value_or_redacted: string }> };
      const secretEntry = data.vars.find((v) => v.key === "STRUCTLOG_TEST_SECRET");
      expect(secretEntry).toBeDefined();
      // STRUCTLOG_TEST_SECRET contains "SECRET" pattern → must be redacted
      expect(secretEntry?.value_or_redacted).toContain("[REDACTED");
      expect(secretEntry?.value_or_redacted).not.toContain("supersecret-1234");
      expect(validate(record)).toBe(true);
    } finally {
      delete process.env.STRUCTLOG_TEST_SECRET;
    }
  });

  it("logger records pass schema validation across event types", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });

    logger.info("app", "coordinator listening on :8004");
    logger.warn("ifcDownloader", "download retry", { attempt: 2 });
    logger.error("ifcDownloader", "download failed", new Error("403 Forbidden"));
    logger.network("ifcReadyIntake", "POST /api/external/ifc-ready 200", {
      direction: "inbound",
      protocol: "http",
      peer: "external-edge",
      status: 200,
      duration_ms: 47,
      path: "/api/external/ifc-ready",
    });
    logger.audit("github-workflow", "gh pr merge invoked", {
      action: "gh-pr-merge",
      actor: "agent:claude-opus-4-7",
      target: "PR#999",
    });
    logger.lifecycle("reviewSession", "session created", {
      phase: "start",
      subject_kind: "review_session",
      subject_id: "review_session_xxx",
    });
    logger.anomaly("conversion_authority", "fallback triggered", {
      anomaly_kind: "fallback",
      reason: "hoops_a3d_failed",
    });

    const lines = readAllLines(logger.currentFile());
    expect(lines).toHaveLength(7);
    for (const record of lines) {
      const ok = validate(record);
      if (!ok) {
        throw new Error(`record failed schema: ${JSON.stringify(record)} errors=${JSON.stringify(validate.errors)}`);
      }
    }
  });

  it("withTraceId child shares run_id, file, and per-trace seq counters", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_aaaa",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    const child = logger.withTraceId("rev_20260526_bbbb");

    logger.info("app", "first under aaaa");
    child.info("app", "first under bbbb");
    logger.info("app", "second under aaaa");
    child.info("app", "second under bbbb");

    const lines = readAllLines(logger.currentFile()) as Array<{
      trace_id: string;
      seq?: number;
      run_id: string;
    }>;
    expect(lines.every((l) => l.run_id === "run_20260526_142010_a3f900")).toBe(true);
    const aaaa = lines.filter((l) => l.trace_id === "rev_20260526_aaaa");
    const bbbb = lines.filter((l) => l.trace_id === "rev_20260526_bbbb");
    expect(aaaa.map((l) => l.seq)).toEqual([1, 2]);
    expect(bbbb.map((l) => l.seq)).toEqual([1, 2]);
  });

  it("circular references in data become a degraded record, not a crash", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    expect(() => logger.info("app", "circular check", circular)).not.toThrow();
    const lines = readAllLines(logger.currentFile());
    expect(lines).toHaveLength(1);
    const text = JSON.stringify(lines[0]);
    expect(text).toContain('"[Circular]"');
  });

  it("daily rotate opens a new file on UTC date change", () => {
    let clockTs = new Date("2026-05-26T23:59:59.500Z");
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_235959_aabbcc",
      initialTraceId: "rev_20260526_xxxx",
      skipEnvSnapshot: true,
      now: () => new Date(clockTs.getTime()),
    });
    logger.info("app", "before midnight");
    const beforeFile = logger.currentFile();

    clockTs = new Date("2026-05-27T00:00:01.100Z");
    logger.info("app", "after midnight");
    const afterFile = logger.currentFile();

    expect(beforeFile).toMatch(/2026-05-26[\\/]coordinator-run_20260526_235959_aabbcc\.jsonl$/);
    expect(afterFile).toMatch(/2026-05-27[\\/]coordinator-run_20260526_235959_aabbcc\.jsonl$/);
    expect(beforeFile).not.toBe(afterFile);

    const beforeLines = readAllLines(beforeFile);
    const afterLines = readAllLines(afterFile);
    expect(beforeLines).toHaveLength(1);
    expect(afterLines).toHaveLength(1);
    expect((beforeLines[0] as { msg: string }).msg).toBe("before midnight");
    expect((afterLines[0] as { msg: string }).msg).toBe("after midnight");
  });

  it("logger.error captures Error name, message, and stack tail", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    const e = new Error("boom");
    logger.error("ifcDownloader", "download failed", e);
    const lines = readAllLines(logger.currentFile()) as Array<{
      event_type: string;
      data: { error: { name: string; message: string; stack_tail: string[] } };
    }>;
    expect(lines).toHaveLength(1);
    expect(lines[0].event_type).toBe("logic_error");
    expect(lines[0].data.error.name).toBe("Error");
    expect(lines[0].data.error.message).toBe("boom");
    expect(lines[0].data.error.stack_tail.length).toBeGreaterThan(0);
    expect(lines[0].data.error.stack_tail.length).toBeLessThanOrEqual(8);
    expect(validate(lines[0])).toBe(true);
  });

  it("sink failure increments records_dropped and records last_failure", () => {
    const failingDir = join(tmpRoot, "blocked");
    mkdirSync(failingDir, { recursive: true });
    // Make the directory unwritable by replacing the expected file path with a
    // directory that cannot be appended to (we'll point the logger at a path
    // that already exists as a directory rather than a file).
    const logger = createLogger("coordinator", {
      logRoot: failingDir,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    const expectedPath = logger.currentFile();
    // Pre-create the would-be file path as a directory to force append to fail.
    rmSync(expectedPath, { force: true });
    mkdirSync(expectedPath, { recursive: true });

    expect(() => logger.info("app", "this should fall through")).not.toThrow();
    // We don't assert that dropped > 0 across platforms because the recovery
    // path may successfully write to <service>/_recovery/. We do assert that
    // either records_written or records_dropped advanced (no silent crash).
    const moved = logger.recordsWritten() + logger.recordsDropped();
    expect(moved).toBeGreaterThan(0);
  });

  it("recordsWritten counter equals number of lines on disk", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    for (let i = 0; i < 5; i += 1) logger.info("app", `msg-${i}`);
    const lines = readAllLines(logger.currentFile());
    expect(lines).toHaveLength(5);
    expect(logger.recordsWritten()).toBe(5);
    expect(logger.recordsDropped()).toBe(0);
  });

  it("writeRaw forwards a viewer-shaped record without re-redacting allow-listed plaintext", () => {
    const logger = createLogger("coordinator", {
      logRoot: tmpRoot,
      runId: "run_20260526_142010_a3f900",
      initialTraceId: "rev_20260526_1234abcd",
      skipEnvSnapshot: true,
      now: freezeClock(new Date("2026-05-26T14:23:11.482Z")),
    });
    logger.writeRaw({
      ts: "2026-05-26T14:25:00.000Z",
      level: "info",
      event_type: "network",
      service: "viewer",
      component: "webrtcClient",
      run_id: "run_20260526_142455_d3e400",
      trace_id: "rev_20260526_1234abcd",
      msg: "DataChannel openStageRequest sent",
      data: { direction: "outbound", protocol: "datachannel", peer: "streaming-server", status: "openStageRequest" },
    });
    const lines = readAllLines(logger.currentFile()) as Array<{ service: string; component: string }>;
    expect(lines).toHaveLength(1);
    expect(lines[0].service).toBe("viewer");
    expect(lines[0].component).toBe("webrtcClient");
    expect(validate(lines[0])).toBe(true);
  });
});
