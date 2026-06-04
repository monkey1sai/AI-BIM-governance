// web-viewer-sample/src/console/governance/govPanelState.test.ts
import { describe, expect, it } from "vitest";
import { resolveGovPanelState } from "./govPanelState";

describe("GovPanelState（spectator 唯讀 / 等待 viewer）", () => {
  it("primary + DataChannel ready → 可操作", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: true });
    expect(s.canOperate).toBe(true);
    expect(s.disabledReason).toBeNull();
  });

  it("spectator → 不可操作（唯讀，誠實表態，非隱藏）", () => {
    const s = resolveGovPanelState({ streamRole: "spectator", dataChannelReady: true });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("spectator_read_only");
  });

  it("DataChannel 未就緒 → 不可操作（等待 viewer 連線，非假按鈕）", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("waiting_viewer");
  });

  it("spectator 優先於 waiting（唯讀無論連線與否都不可操作）", () => {
    const s = resolveGovPanelState({ streamRole: "spectator", dataChannelReady: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("spectator_read_only");
  });

  // T6：lifecycle 非 active → 不可操作（session 已關閉／排隊／失敗）。
  it("primary + DataChannel ready 但 lifecycle 非 active → 不可操作（session_not_active）", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: true, lifecycleActive: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("session_not_active");
  });

  it("primary + DataChannel ready + lifecycle active → 可操作", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: true, lifecycleActive: true });
    expect(s.canOperate).toBe(true);
    expect(s.disabledReason).toBeNull();
  });

  it("lifecycleActive 省略（既有呼叫端相容）→ 不因 lifecycle 阻擋（仍可操作）", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: true });
    expect(s.canOperate).toBe(true);
    expect(s.disabledReason).toBeNull();
  });

  it("spectator 優先於 lifecycle 非 active（唯讀優先）", () => {
    const s = resolveGovPanelState({ streamRole: "spectator", dataChannelReady: true, lifecycleActive: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("spectator_read_only");
  });

  it("waiting viewer 優先於 lifecycle 非 active（先等連線）", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: false, lifecycleActive: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("waiting_viewer");
  });
});
