// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Workspace viewport slot（introduce-viewer-app-integration-surface design §4 V-A′）
// 中欄 slot 與 ViewportHost 之間的契約：頁面只註冊矩形＋發布 handoff；host 負責掛載唯一一份
// ReviewSessionViewerPane。同一 review session 跨 A1↔A4 不重 claim（pane 的 lease 只隨 handoff.sessionId 重置）。
// 本檔只有 context／型別（不含元件，讓 react-refresh 邊界乾淨）；Provider 在 ViewportSlotProvider.tsx。
// 公開面見 docs/architecture/viewport-slot-adr.md §2：viewer 指令只經 commands，狀態依 registry 泛型推導。
// context 缺席（legacy 深連結）時模組頁維持原本 inline 行為。
// ═══════════════════════════════════════════════════════════════════════
import { createContext, useContext } from "react";
import type { MeasurementAction, MeasurementState } from "../../viewerCommandChannel/measurement";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { CorrelatedViewerCommand, ViewerCommandFamily, ViewerCommandReplies } from "../../viewerCommandChannel/registry";
import type { Ref } from "react";
import type {
  ReviewRoomHandoff,
  ReviewSessionViewerPaneHandle,
  ViewerHostActions,
} from "../ReviewSessionViewerPane";
import type { ViewerGate, ViewerPhase } from "../viewerGate";
import type { HighlightResultMessage, StageTreeMessage, USDPrimNode } from "../EmbeddedViewer";
import type { ViewerCommandState } from "./useViewerCommandState";

export type WorkspaceViewerMode = "a1-inline" | "a2-overlay" | "a3-inline" | "a4-inline";

export interface WorkspaceViewerPublication {
  mode: WorkspaceViewerMode;
  handoff: ReviewRoomHandoff;
  showHandoffActions?: boolean;
}

/** 目前 Dock 的訂閱（gate、批次 ACK、Stage 樹通知與 pane handle）；Dock 卸載即解除。 */
export interface ViewportDockSubscription {
  onBatchGateChange?: (gate: ViewerGate) => void;
  onBatchAck?: (message: HighlightResultMessage) => void;
  onStageTree?: (message: StageTreeMessage) => void;
  paneRef?: Ref<ReviewSessionViewerPaneHandle>;
}

export interface ViewportSlotApi {
  /** 跨 dock 共用的 review session；由 publishViewer 的 handoff.sessionId 播種，也可由頁面主動設定。 */
  activeSessionId: string; setActiveSessionId(sessionId: string): void;
  /** pane 回報的 viewer 證據 gate（單一來源）；phase 由 command 判定的代碼推導，FlowGuide 只顯示。 */
  gate: ViewerGate | null; setGate(gate: ViewerGate | null): void; phase: ViewerPhase;
  /** viewer 指令一律經此 port；狀態依 registry 的 family 保存，同 family 同時只送一筆。 */
  commands: ViewerCommandPort;
  commandState<C extends CorrelatedViewerCommand>(command: C): ViewerCommandState<ViewerCommandReplies[C]>;
  /** 指定 family 只讓該 family 失效；不指定時連同量測一起失效。 */
  invalidateCommands(family?: ViewerCommandFamily): void;
  measurementState: MeasurementState; setMeasurementState(state: MeasurementState): void;
  /** 指令閘門未開時不開始量測；回傳 false 表示沒有送出。 */
  controlMeasurement(action: MeasurementAction): boolean;
  /** live 下傳的 USD Stage 樹結構（Issue #609）與 Kit 回報的選取。 */
  stageTree: USDPrimNode[]; setStageTree(nodes: USDPrimNode[]): void;
  selectedStagePaths: string[]; setSelectedStagePaths(paths: string[]): void;
  /** host 註冊的 viewer 操作；未掛載 pane 時為 null。 */
  hostActions: ViewerHostActions | null; registerHostActions(actions: ViewerHostActions | null): void;
  /** 中欄容器 ref callback；null＝解除註冊（host 轉 visibility:hidden，不 unmount）。 */
  slotEl: HTMLElement | null; registerSlot(el: HTMLElement | null): void;
  /** UI-only outlet. Moving controls must never move the streaming iframe. */
  controlsEl: HTMLElement | null; registerControls(el: HTMLElement | null): void;
  /** Workspace 保留觀看資料；Dock 的生命週期只管理訂閱。 */
  viewerPublication: WorkspaceViewerPublication | null; publishViewer(p: WorkspaceViewerPublication): void;
  dockSubscription: ViewportDockSubscription | null; subscribeDock(s: ViewportDockSubscription): () => void;
}

export const ViewportSlotContext = createContext<ViewportSlotApi | null>(null);

export function useViewportSlot(): ViewportSlotApi | null {
  return useContext(ViewportSlotContext);
}
