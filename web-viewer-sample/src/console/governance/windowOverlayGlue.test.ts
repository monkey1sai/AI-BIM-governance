// web-viewer-sample/src/console/governance/windowOverlayGlue.test.ts
import { describe, expect, it } from "vitest";
import { deriveOverlayInputs } from "./windowOverlayGlue";

describe("Window overlay glue（spectator + DataChannel 就緒 → GovPanelState）", () => {
  it("primary + stream 已連線有畫面 → 可操作", () => {
    const r = deriveOverlayInputs({ spectator: false, streamReady: true });
    expect(r.streamRole).toBe("primary");
    expect(r.panelState.canOperate).toBe(true);
  });
  it("spectator → 唯讀（無論串流）", () => {
    const r = deriveOverlayInputs({ spectator: true, streamReady: true });
    expect(r.streamRole).toBe("spectator");
    expect(r.panelState.canOperate).toBe(false);
    expect(r.panelState.disabledReason).toBe("spectator_read_only");
  });
  it("primary + 串流未就緒 → 等待 viewer", () => {
    const r = deriveOverlayInputs({ spectator: false, streamReady: false });
    expect(r.panelState.canOperate).toBe(false);
    expect(r.panelState.disabledReason).toBe("waiting_viewer");
  });
});
