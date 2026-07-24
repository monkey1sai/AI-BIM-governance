import { afterEach, describe, expect, it, vi } from "vitest";

import { createBrowserLogger, type BrowserLoggerOptions } from "./structLog";
import {
  bootstrapStructLog,
  resetStructLogBootstrapForTests,
  traceIdFromSearch,
} from "./structLogBootstrap";

const SAFE_SNAPSHOT_VARS: NonNullable<BrowserLoggerOptions["browserSnapshotVars"]> = [
  {
    key: "COORDINATOR_PORT",
    source: "default",
    value_or_redacted: "8005",
    type: "string",
  },
  {
    key: "VIEWER_PORT",
    source: "default",
    value_or_redacted: "5175",
    type: "string",
  },
];

afterEach(() => {
  resetStructLogBootstrapForTests();
  vi.restoreAllMocks();
});

describe("traceIdFromSearch", () => {
  it.each([
    "ifcready_1779687625000_064c6813",
    "rev_review_session_abc-123",
    "stream_conv_job_abc-123",
    "script_run_20260724_120000_a1b2c3",
  ])("accepts one documented safe trace carrier: %s", (traceId) => {
    expect(traceIdFromSearch(`?trace_id=${encodeURIComponent(traceId)}`)).toBe(traceId);
  });

  it("accepts the documented 200-character maximum", () => {
    const traceId = `ifcready_${"a".repeat(191)}`;
    expect(traceId).toHaveLength(200);
    expect(traceIdFromSearch(`?trace_id=${traceId}`)).toBe(traceId);
  });

  it.each([
    ["missing", "?session=review_session_123"],
    ["empty", "?trace_id="],
    ["duplicate", "?trace_id=ifcready_a&trace_id=ifcready_a"],
    ["duplicate with conflicting values", "?trace_id=ifcready_a&trace_id=rev_b"],
    ["double IFC-ready prefix", "?trace_id=ifcready_ifcready_a"],
    ["cross-prefix payload", "?trace_id=rev_ifcready_a"],
    ["unknown prefix", "?trace_id=unknown_a"],
    ["schema-only external prefix", "?trace_id=external_a"],
    ["leading whitespace", "?trace_id=%20ifcready_a"],
    ["embedded control", "?trace_id=ifcready_a%0Ab"],
    ["arbitrary JSON payload", "?trace_id=%7B%22trace_id%22%3A%22ifcready_a%22%7D"],
    ["over maximum", `?trace_id=ifcready_${"a".repeat(192)}`],
  ])("rejects %s", (_label, search) => {
    expect(traceIdFromSearch(search)).toBeNull();
  });
});

describe("bootstrapStructLog", () => {
  it("creates one singleton, installs handlers once, exposes the logger, and flushes to coordinator", async () => {
    const transport = vi.fn(async (_url: string, _body: unknown[]) => ({ ok: true, status: 200 }));
    const createLogger = vi.fn((options: BrowserLoggerOptions) =>
      createBrowserLogger({
        ...options,
        enableTimer: false,
        transport,
        runId: "run_20260724_120000_a1b2c3",
      }),
    );
    const addEventListener = vi.spyOn(window, "addEventListener");
    const search = "?session=review_session_demo&trace_id=ifcready_root_123";

    const first = bootstrapStructLog({
      search,
      coordinatorApiBase: "http://127.0.0.1:8005",
      browserSnapshotVars: SAFE_SNAPSHOT_VARS,
      createLogger,
      win: window,
    });
    const second = bootstrapStructLog({
      search,
      coordinatorApiBase: "http://127.0.0.1:8005",
      browserSnapshotVars: SAFE_SNAPSHOT_VARS,
      createLogger,
      win: window,
    });

    expect(second).toBe(first);
    expect(createLogger).toHaveBeenCalledTimes(1);
    expect(createLogger).toHaveBeenCalledWith(expect.objectContaining({
      initialTraceId: "ifcready_root_123",
      endpoint: "http://127.0.0.1:8005/api/internal/viewer-log",
      browserSnapshotVars: SAFE_SNAPSHOT_VARS,
    }));
    expect(addEventListener.mock.calls.filter(([name]) => name === "error")).toHaveLength(1);
    expect(addEventListener.mock.calls.filter(([name]) => name === "unhandledrejection")).toHaveLength(1);
    expect(window.__structLog?.logger).toBe(first);

    const snapshots = first.tail().filter((record) => record.event_type === "env_snapshot");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      trace_id: "ifcready_root_123",
      data: { vars: SAFE_SNAPSHOT_VARS },
    });

    await first.flush();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe("http://127.0.0.1:8005/api/internal/viewer-log");
    expect(transport.mock.calls[0][0]).not.toContain(":5175");
  });

  it("rejects an untrusted coordinator base through the shared validator", () => {
    expect(() => bootstrapStructLog({
      search: "?trace_id=ifcready_root_123",
      coordinatorApiBase: "https://attacker.example",
      browserSnapshotVars: SAFE_SNAPSHOT_VARS,
      win: window,
    })).toThrow(/untrusted coordinator base/i);
  });
});
