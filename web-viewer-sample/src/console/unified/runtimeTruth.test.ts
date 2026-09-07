// unified-console-runtime-truth slice 1：真值投影純函式（design §3.2 渲染規則＋§3.3 pickers）。
import { describe, expect, it } from "vitest";
import type { IssueRow } from "../governanceClient";
import type { EndpointSlice } from "./coordinatorStatusStore";
import type { RuntimeStatus } from "../coordinatorClient";
import {
  cell, cellSub, cellText, conversionCounts, healthOf, kitMediaSuspect, lastUpdatedText, openIssueCount, outboxPending,
} from "./runtimeTruth";
import { RT_IDLE, conversionRecord, outboxEntries } from "./__testdata__/coordinatorMocks";

const L = { unavailable: "未取得", offline: "未連線" };
const live = <T,>(data: T, at = 1_000): EndpointSlice<T> => ({ data, state: "live", httpStatus: 200, message: null, lastUpdatedAt: at });
const offline: EndpointSlice<never> = { data: null, state: "offline", httpStatus: 503, message: "coordinator /x -> 503 off", lastUpdatedAt: null };
const error: EndpointSlice<never> = { data: null, state: "error", httpStatus: 404, message: "coordinator /x -> 404 no instance", lastUpdatedAt: null };

describe("cell / cellText / cellSub", () => {
  it("live 顯示值；pick 回 null → unavailable（未取得）", () => {
    expect(cellText(cell(live({ n: 7 }), (d) => d.n), L)).toBe("7");
    const c = cell(live({ n: 7 }), () => null);
    expect(c.state).toBe("unavailable");
    expect(cellText(c, L)).toBe("未取得");
    expect(cellSub(c, L, () => "x")).toBe("未取得");
  });
  it("offline → —／未連線；error → 狀態碼／後端訊息；永不回 0", () => {
    const off = cell(offline, () => 0);
    expect(off.state).toBe("offline");
    expect(cellText(off, L)).toBe("—");
    expect(cellSub(off, L, () => "x")).toBe("未連線");
    const err = cell(error, () => 0);
    expect(cellText(err, L)).toBe("404");
    expect(cellSub(err, L, () => "x")).toBe("coordinator /x -> 404 no instance");
  });
});

describe("pickers（截斷窗不對子集算數）", () => {
  it("conversionCounts：非終態＝running；count > items.length → null", () => {
    expect(conversionCounts({ count: 4, items: [conversionRecord("a", "detected"), conversionRecord("b", "queued"), conversionRecord("c", "ready"), conversionRecord("d", "failed")] }))
      .toEqual({ running: 2, ready: 1, failed: 1 });
    expect(conversionCounts({ count: 101, items: [conversionRecord("a", "ready")] })).toBeNull();
  });
  it("outboxPending：pending 計數＋attempts 摘要；total > entries.length → null", () => {
    expect(outboxPending({ total: 36, limit: 200, entries: outboxEntries(36, 0, 5) })).toEqual({ pending: 36, attempts: 0, maxAttempts: 5 });
    expect(outboxPending({ total: 201, limit: 200, entries: outboxEntries(200, 0, 5) })).toBeNull();
  });
  it("openIssueCount：非 resolved／rejected 才算未結", () => {
    const row = (status: string): IssueRow => ({ id: status, kind: "issue", title: "t", status, severity: "high", ifc_guid: null, usd_prim_path: null, source_type: "rule" });
    expect(openIssueCount({ issues: [row("open"), row("in_review"), row("resolved"), row("rejected")] })).toBe(2);
  });
  it("healthOf：live→ok（或 degradedWhen）；error→degraded；offline→unknown", () => {
    expect(healthOf(live({ status: "ok" }))).toBe("ok");
    expect(healthOf(live({ status: "down" }), (d) => d.status !== "ok")).toBe("degraded");
    expect(healthOf(error)).toBe("degraded");
    expect(healthOf(offline)).toBe("unknown");
  });
  it("lastUpdatedText：無 live → —；有 live → 取最新時間（HH:mm:ss）", () => {
    expect(lastUpdatedText([offline, error])).toBe("—");
    expect(lastUpdatedText([live(1, Date.UTC(2026, 7, 25, 1, 2, 3)), offline])).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  it("kitMediaSuspect（#768）：suspect 才回；欄位缺席／ok／unknown／非 live → null（不臆造）", () => {
    const entry = (media_state: "ok" | "suspect" | "unknown", streak = 0) => ({
      kit_instance_id: "kit_local_001", media_state, source: "viewer_lease_evidence" as const, detail: `d-${media_state}`,
      no_first_frame_streak: streak, qualifying_lease_count: streak, last_first_frame_at: null, evidence_lease_ids: [],
    });
    expect(kitMediaSuspect(live({ ...RT_IDLE }))).toBeNull();
    expect(kitMediaSuspect(live({ ...RT_IDLE, kit_runtime_health: [entry("ok")] }))).toBeNull();
    expect(kitMediaSuspect(live({ ...RT_IDLE, kit_runtime_health: [entry("unknown", 1)] }))).toBeNull();
    expect(kitMediaSuspect(live({ ...RT_IDLE, kit_runtime_health: [entry("ok"), entry("suspect", 2)] })))
      .toEqual({ kit_instance_id: "kit_local_001", detail: "d-suspect", streak: 2 });
    expect(kitMediaSuspect(offline as EndpointSlice<RuntimeStatus>)).toBeNull();
    expect(kitMediaSuspect(error as EndpointSlice<RuntimeStatus>)).toBeNull();
  });
});
