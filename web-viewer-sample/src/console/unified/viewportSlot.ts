// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Workspace viewport slot（introduce-viewer-app-integration-surface design §4 V-A′）
// 中欄 slot 與 ViewportHost 之間的契約：頁面只註冊矩形＋發布 handoff；host 負責掛載唯一一份
// ReviewSessionViewerPane。同一 review session 跨 A1↔A4 不重 claim（pane 的 lease 只隨 handoff.sessionId 重置）。
// 本檔只有 context／型別／純函式（不含元件，讓 react-refresh 邊界乾淨）；Provider 在 ViewportSlotProvider.tsx。
// context 缺席（legacy 深連結）時模組頁維持原本 inline 行為。
// ═══════════════════════════════════════════════════════════════════════
import { createContext, useContext } from "react";
import type { SectionInput, SectionState } from "../../viewerCommandChannel/sectionPlane";
import type { MeasurementAction, MeasurementState } from "../../viewerCommandChannel/measurement";
import type { CameraViewInput, CameraViewState, FlyState } from "../../viewerCommandChannel/camera";
import type { OverlayStyleInput, OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { Ref } from "react";
import type {
  ReviewRoomHandoff,
  ReviewSessionViewerPaneHandle,
} from "../ReviewSessionViewerPane";
import type { ViewerGate } from "../viewerGate";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import type { HighlightResultMessage, StageTreeMessage, USDPrimNode } from "../EmbeddedViewer";

export type WorkspaceViewerMode = "a1-inline" | "a2-overlay" | "a3-inline" | "a4-inline";

export interface ViewportPublication {
  mode: WorkspaceViewerMode;
  handoff: ReviewRoomHandoff;
  showHandoffActions?: boolean;
  onBatchGateChange?: (gate: ViewerGate) => void;
  onBatchAck?: (message: HighlightResultMessage) => void;
  onStageTree?: (message: StageTreeMessage) => void;
  paneRef?: Ref<ReviewSessionViewerPaneHandle>;
}

export type WorkspaceViewerPublication = Pick<ViewportPublication, "mode" | "handoff" | "showHandoffActions">;
export type ViewportDockSubscription = Omit<ViewportPublication, keyof WorkspaceViewerPublication>;

export interface ViewportHostActions {
  commands?: ViewerCommandPort;
  requestStageTree?: (primPath?: string) => void;
  selectPrim?: (primPath: string, multiSelect?: boolean) => void;
  sendToolbarAction?: (
    action: "reset_camera" | "frame_all" | "camera_view" | "toggle_fullscreen" | "toggle_projection",
    cameraView?: string,
  ) => void;
  applyStageBinding?: (artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>;
}

export interface ViewportSlotApi {
  /** UI-only outlet. Moving controls must never move the streaming iframe. */
  controlsEl?: HTMLElement | null;
  registerControls?: (el: HTMLElement | null) => void;
  measurementState?: MeasurementState;
  setMeasurementState?: (state: MeasurementState) => void;
  sendMeasurement?: (action: MeasurementAction) => void;
  sectionState?: SectionState;
  sendSectionPlane?: (input: SectionInput) => void;
  invalidateSection?: () => void;
  cameraViewState?: CameraViewState;
  sendCameraView?: (input: CameraViewInput) => void;
  refreshCameraState?: () => void;
  flyState?: FlyState;
  sendFlySpeed?: (speed: number) => void;
  /** S5：CFD 疊圖透明度（Kit session layer 覆寫 displayOpacity）；疊圖換層後由面板呼叫 invalidate。 */
  overlayStyleState?: OverlayStyleState;
  sendOverlayStyle?: (input: OverlayStyleInput) => void;
  invalidateOverlayStyle?: () => void;
  selectedStagePaths?: string[];
  setSelectedStagePaths?: (paths: string[]) => void;
  /** 中欄容器 ref callback；null＝解除註冊（host 轉 visibility:hidden，不 unmount）。 */
  registerSlot: (el: HTMLElement | null) => void;
  slotEl: HTMLElement | null;
  /** Workspace 保留觀看資料；Dock 的生命週期只管理訂閱。 */
  publishViewer: (publication: WorkspaceViewerPublication) => void;
  viewerPublication: WorkspaceViewerPublication | null;
  subscribeDock: (subscription: ViewportDockSubscription) => () => void;
  dockSubscription: ViewportDockSubscription | null;
  /** 相容入口；null 僅解除最後一次此入口所建立的訂閱，不刪 viewer binding。 */
  publish: (publication: ViewportPublication | null) => void;
  publication: ViewportPublication | null;
  /** 跨 dock 共用的 review session；由 publication.handoff.sessionId 播種，也可由頁面主動設定。 */
  activeSessionId: string;
  setActiveSessionId: (sessionId: string) => void;
  /** pane 回報的 viewer 證據 gate（單一來源；FlowGuide 只做分類顯示，不另造判定）。 */
  gate: ViewerGate | null;
  setGate: (gate: ViewerGate | null) => void;
  /** live 下傳的 USD Stage 樹結構（Issue #609）。 */
  stageTree: USDPrimNode[];
  setStageTree: (nodes: USDPrimNode[]) => void;
  /** 向 viewer 發送 stage 樹查詢請求。 */
  requestStageTree: (primPath?: string) => void;
  /** 向 viewer 點選 USD Prim（Issue #609）。 */
  selectPrim: (primPath: string, multiSelect?: boolean) => void;
  /** 工具列視角／全螢幕／重置命令通道（Issue #605）。 */
  sendToolbarAction: (
    action: "reset_camera" | "frame_all" | "camera_view" | "toggle_fullscreen" | "toggle_projection",
    cameraView?: string,
  ) => void;
  /** S3：以既有 stage-binding 交易套用 primary＋secondary（CFD 疊圖）；host 未掛載時回 failed。 */
  applyStageBinding?: (artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>;
  /** host 註冊底層執行 handle 的 callback。 */
  registerHostActions?: (actions: ViewportHostActions | null) => void;
}

export const ViewportSlotContext = createContext<ViewportSlotApi | null>(null);

export function useViewportSlot(): ViewportSlotApi | null {
  return useContext(ViewportSlotContext);
}
