// web-viewer-sample/src/console/governance/govPanelState.ts
// GovPanelState：集中治理面板可操作狀態。spectator 唯讀（disabled，誠實表態，非隱藏）；
// DataChannel 未就緒 → 等待 viewer 連線（R2）。streamRole 沿用 Window.tsx isSpectatorStreamMode 的語意。
export type StreamRole = "primary" | "spectator";

export interface GovPanelInput {
  streamRole: StreamRole;
  dataChannelReady: boolean;
}

export interface GovPanelState {
  canOperate: boolean;
  disabledReason: "spectator_read_only" | "waiting_viewer" | null;
}

export function resolveGovPanelState(input: GovPanelInput): GovPanelState {
  if (input.streamRole === "spectator") {
    return { canOperate: false, disabledReason: "spectator_read_only" };
  }
  if (!input.dataChannelReady) {
    return { canOperate: false, disabledReason: "waiting_viewer" };
  }
  return { canOperate: true, disabledReason: null };
}

// UI 顯示用文案（誠實，不假裝 ready）。
export const GOV_PANEL_REASON_TEXT: Record<NonNullable<GovPanelState["disabledReason"]>, string> = {
  spectator_read_only: "旁觀者唯讀：治理操作面板僅供檢視，不可建立 / 派工 / 標示 / 匯出",
  waiting_viewer: "等待 viewer 連線：3D 標示需 primary viewer 的 WebRTC DataChannel 就緒",
};
