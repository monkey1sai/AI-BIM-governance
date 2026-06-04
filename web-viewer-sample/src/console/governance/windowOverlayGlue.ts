// web-viewer-sample/src/console/governance/windowOverlayGlue.ts
// Window.tsx 與 overlay 之間的純函式膠水：把 viewer 的 spectator / 串流就緒狀態轉成 GovPanelState 輸入。
// DataChannel 就緒以「串流已連線且有畫面」近似（viewer 已可送 _sendStreamMessage）。
import { resolveGovPanelState, type GovPanelState, type StreamRole } from "./govPanelState";

export interface ViewerOverlayStatus {
  spectator: boolean;
  streamReady: boolean; // = showStream && hasRemoteVideoFrame()
  // T6：review session lifecycle 是否 active（active/created）。非 active（queued/blocked/failed/
  // closing/closed/dropped）時治理動作唯讀。預設 true 以維持既有呼叫端相容（不帶則不限制）。
  lifecycleActive?: boolean;
}

export interface OverlayInputs {
  streamRole: StreamRole;
  dataChannelReady: boolean;
  panelState: GovPanelState;
}

export function deriveOverlayInputs(status: ViewerOverlayStatus): OverlayInputs {
  const streamRole: StreamRole = status.spectator ? "spectator" : "primary";
  const dataChannelReady = status.streamReady;
  // 未帶 lifecycleActive 時視為 true（不阻擋），維持既有測試與呼叫端行為。
  const lifecycleActive = status.lifecycleActive ?? true;
  return { streamRole, dataChannelReady, panelState: resolveGovPanelState({ streamRole, dataChannelReady, lifecycleActive }) };
}
