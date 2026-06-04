// web-viewer-sample/src/console/governance/windowOverlayGlue.ts
// Window.tsx 與 overlay 之間的純函式膠水：把 viewer 的 spectator / 串流就緒狀態轉成 GovPanelState 輸入。
// DataChannel 就緒以「串流已連線且有畫面」近似（viewer 已可送 _sendStreamMessage）。
import { resolveGovPanelState, type GovPanelState, type StreamRole } from "./govPanelState";

export interface ViewerOverlayStatus {
  spectator: boolean;
  streamReady: boolean; // = showStream && hasRemoteVideoFrame()
}

export interface OverlayInputs {
  streamRole: StreamRole;
  dataChannelReady: boolean;
  panelState: GovPanelState;
}

export function deriveOverlayInputs(status: ViewerOverlayStatus): OverlayInputs {
  const streamRole: StreamRole = status.spectator ? "spectator" : "primary";
  const dataChannelReady = status.streamReady;
  return { streamRole, dataChannelReady, panelState: resolveGovPanelState({ streamRole, dataChannelReady }) };
}
