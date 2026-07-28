import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "../../src/lib/structLog.js";
import { EventLog } from "../../src/services/eventLog.js";

/**
 * EventLog → structured log mirror contract (per docs/contracts/structured-log-schema.md §9
 * and openspec/changes/cross-service-structured-log-baseline §4).
 *
 * The original storage/event-log/<sessionId>.jsonl file is unchanged; in addition,
 * every successful append emits a `lifecycle` record into the structured log.
 */
describe("EventLog → structLog mirror", () => {
  let storageRoot: string;
  let logRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "eventlog-mirror-storage-"));
    logRoot = mkdtempSync(join(tmpdir(), "eventlog-mirror-logs-"));
  });

  afterEach(() => {
    try {
      rmSync(storageRoot, { recursive: true, force: true });
      rmSync(logRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  function readMirrorLines(logger: { currentFile: () => string }): unknown[] {
    return readFileSync(logger.currentFile(), "utf-8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  it("mirrors sessionCreated to lifecycle phase=start, subject_kind=review_session", () => {
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260526_142010_a3f900", skipEnvSnapshot: true });
    const eventLog = new EventLog(storageRoot, {
      structLog: logger,
      resolveTraceId: (sessionId) => `rev_${sessionId}`,
    });

    eventLog.append("review_session_aaa", "sessionCreated", { foo: 1 });

    const mirrored = readMirrorLines(logger).filter((r): r is Record<string, unknown> =>
      (r as { event_type?: string }).event_type === "lifecycle",
    );
    expect(mirrored).toHaveLength(1);
    const rec = mirrored[0] as Record<string, unknown> & { data: { phase: string; subject_kind: string; subject_id: string } };
    expect(rec.data.phase).toBe("start");
    expect(rec.data.subject_kind).toBe("review_session");
    expect(rec.data.subject_id).toBe("review_session_aaa");
    expect(rec.trace_id).toBe("rev_review_session_aaa");
  });

  it("maps the six EventLog types to documented subject_kind/phase pairs", () => {
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260526_142010_a3f900", skipEnvSnapshot: true });
    const eventLog = new EventLog(storageRoot, {
      structLog: logger,
      resolveTraceId: (sessionId) => `rev_${sessionId}`,
    });

    const cases: Array<[string, string, unknown, { phase: string; subject_kind: string; subject_id: string }]> = [
      ["review_session_a", "sessionCreated", {}, { phase: "start", subject_kind: "review_session", subject_id: "review_session_a" }],
      ["review_session_a", "sessionActive", {}, { phase: "active", subject_kind: "review_session", subject_id: "review_session_a" }],
      ["review_session_a", "sessionClosing", {}, { phase: "closing", subject_kind: "review_session", subject_id: "review_session_a" }],
      ["review_session_a", "sessionClosed", {}, { phase: "closed", subject_kind: "review_session", subject_id: "review_session_a" }],
      [
        "review_session_a",
        "kitInstanceReleased",
        { kit_instance_id: "kit_local_001" },
        { phase: "closed", subject_kind: "kit_subprocess", subject_id: "kit_local_001" },
      ],
      [
        "review_session_a",
        "kitInstancesReleased",
        { kit_instance_ids: ["kit_local_001", "kit_local_002"] },
        { phase: "closed", subject_kind: "kit_subprocess", subject_id: "kit_local_001,kit_local_002" },
      ],
    ];

    for (const [sessionId, type, payload] of cases) {
      eventLog.append(sessionId, type, payload);
    }

    const records = readMirrorLines(logger).filter(
      (r): r is { event_type: string; data: Record<string, string> } =>
        (r as { event_type?: string }).event_type === "lifecycle",
    );
    expect(records).toHaveLength(cases.length);
    cases.forEach(([, , , expected], index) => {
      const got = records[index].data;
      expect({ phase: got.phase, subject_kind: got.subject_kind, subject_id: got.subject_id }).toEqual(expected);
    });
  });

  it("uses an injected canonical IFC-ready root and skips an unresolved mirror", () => {
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260526_142010_a3f900", skipEnvSnapshot: true });
    const eventLog = new EventLog(storageRoot, {
      structLog: logger,
      resolveTraceId: (sessionId) => sessionId === "review_session_linked" ? "ifcready_exact_root" : null,
    });

    eventLog.append("review_session_linked", "sessionCreated", {});
    eventLog.append("review_session_unresolved", "sessionCreated", {});

    const mirrored = readMirrorLines(logger).filter((record): record is { trace_id: string } =>
      (record as { event_type?: string }).event_type === "lifecycle",
    );
    expect(mirrored.map((record) => record.trace_id)).toEqual(["ifcready_exact_root"]);
  });

  it("does not break EventLog when structLog is omitted (backward compat)", () => {
    const eventLog = new EventLog(storageRoot);
    expect(() => eventLog.append("review_session_a", "sessionCreated", {})).not.toThrow();
  });

  it("preserves storage/event-log file shape (no extra fields injected)", () => {
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260526_142010_a3f900", skipEnvSnapshot: true });
    const eventLog = new EventLog(storageRoot, {
      structLog: logger,
      resolveTraceId: (sessionId) => `rev_${sessionId}`,
    });
    eventLog.append("review_session_a", "sessionCreated", { src: "test" });

    const files = readdirSync(storageRoot).filter((f) => f.endsWith(".jsonl"));
    expect(files).toHaveLength(1);
    const text = readFileSync(join(storageRoot, files[0]!), "utf-8").trim();
    const stored = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["created_at", "event_id", "payload", "sequence", "session_id", "type"].sort());
  });
});
