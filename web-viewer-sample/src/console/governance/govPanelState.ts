// web-viewer-sample/src/console/governance/govPanelState.ts
// GovPanelState：集中治理面板可操作狀態。spectator 唯讀（disabled，誠實表態，非隱藏）；
// DataChannel 未就緒 → 等待 viewer 連線（R2）。streamRole 沿用 Window.tsx isSpectatorStreamMode 的語意。
export type StreamRole = "primary" | "spectator";

export interface GovPanelInput {
  streamRole: StreamRole;
  dataChannelReady: boolean;
  // T6：review session lifecycle 是否在 active 狀態（active/created）。非 active（queued/blocked/
  // failed/closing/closed/dropped）時治理動作不可操作（即使 primary + DataChannel 就緒）。
  // 預設 true 以維持既有呼叫端相容（未帶 lifecycle 視為不限制）。
  lifecycleActive?: boolean;
}

export interface GovPanelState {
  canOperate: boolean;
  disabledReason: "spectator_read_only" | "waiting_viewer" | "session_not_active" | null;
}

export function resolveGovPanelState(input: GovPanelInput): GovPanelState {
  if (input.streamRole === "spectator") {
    return { canOperate: false, disabledReason: "spectator_read_only" };
  }
  if (!input.dataChannelReady) {
    return { canOperate: false, disabledReason: "waiting_viewer" };
  }
  // T6：lifecycle 非 active（明確傳入 false）→ 唯讀，誠實表態（session 已關閉 / 排隊 / 失敗，治理動作無意義）。
  if (input.lifecycleActive === false) {
    return { canOperate: false, disabledReason: "session_not_active" };
  }
  return { canOperate: true, disabledReason: null };
}

// UI 顯示用文案（誠實，不假裝 ready）。
export const GOV_PANEL_REASON_TEXT: Record<NonNullable<GovPanelState["disabledReason"]>, string> = {
  spectator_read_only: "旁觀者唯讀：治理操作面板僅供檢視，不可建立 / 派工 / 標示 / 匯出",
  waiting_viewer: "等待 viewer 連線：3D 標示需 primary viewer 的 WebRTC DataChannel 就緒",
  session_not_active: "session 非進行中：review 已關閉／排隊／失敗，治理操作（檢核／標示／A8）暫不可用",
};
