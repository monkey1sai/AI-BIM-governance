import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  VIEWER_LEASE_HEARTBEAT_DEFAULT_MS,
  VIEWER_LEASE_HEARTBEAT_FLOOR_MS,
  viewerLeaseHeartbeatDelayMs,
} from "./viewerLeaseHeartbeat";

describe("viewerLeaseHeartbeatDelayMs", () => {
  it("passes through the coordinator cadence when at or above the floor", () => {
    expect(viewerLeaseHeartbeatDelayMs(15_000)).toBe(15_000);
    expect(viewerLeaseHeartbeatDelayMs(VIEWER_LEASE_HEARTBEAT_FLOOR_MS)).toBe(VIEWER_LEASE_HEARTBEAT_FLOOR_MS);
    expect(viewerLeaseHeartbeatDelayMs(60_000)).toBe(60_000);
  });

  it("floors sub-floor cadence to protect the coordinator", () => {
    expect(viewerLeaseHeartbeatDelayMs(1)).toBe(VIEWER_LEASE_HEARTBEAT_FLOOR_MS);
    expect(viewerLeaseHeartbeatDelayMs(4_999)).toBe(VIEWER_LEASE_HEARTBEAT_FLOOR_MS);
  });

  it("falls back to the default for missing or invalid cadence without fabricating a value", () => {
    for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "15000", {}]) {
      expect(viewerLeaseHeartbeatDelayMs(bad)).toBe(VIEWER_LEASE_HEARTBEAT_DEFAULT_MS);
    }
  });
});

describe("f4-viewer-lease-fork structural invariant", () => {
  // learning-ledger f4：兩個 lease client 不得再各自手寫 heartbeat 排程數值。
  // 本結構測試釘住：兩個消費端都 import 共用 helper，且不得殘留 local Math.max(...heartbeat_after_ms) 分岔。
  const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), "utf8");

  it("both lease clients consume the shared heartbeat policy helper", () => {
    const pane = read("../console/ReviewSessionViewerPane.tsx");
    const standalone = read("../Window.tsx");
    // pane 經注入縫消費政策：預設綁定必須是共用 helper 本體。
    expect(pane).toContain("heartbeatDelayFn = viewerLeaseHeartbeatDelayMs");
    expect(standalone).toContain("viewerLeaseHeartbeatDelayMs(");
    const localFork = /Math\.max\(\s*[\d_]+\s*,\s*[^)]*heartbeat_after_ms/u;
    expect(pane).not.toMatch(localFork);
    expect(standalone).not.toMatch(localFork);
  });
});
