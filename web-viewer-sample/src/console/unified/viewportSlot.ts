// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Workspace viewport slot（introduce-viewer-app-integration-surface design §4 V-A′）
// 中欄 slot 與 ViewportHost 之間的契約：頁面只註冊矩形＋發布 handoff；host 負責掛載唯一一份
// ReviewSessionViewerPane。同一 review session 跨 A1↔A4 不重 claim（pane 的 lease 只隨 handoff.sessionId 重置）。
// 本檔只有 context／型別／純函式（不含元件，讓 react-refresh 邊界乾淨）；Provider 在 ViewportSlotProvider.tsx。
// context 缺席（legacy 深連結）時模組頁維持原本 inline 行為。
// ═══════════════════════════════════════════════════════════════════════
import { createContext, useContext } from "react";
import type { Ref } from "react";
import type {
  ReviewRoomHandoff,
  ReviewSessionViewerPaneBatchGate,
  ReviewSessionViewerPaneHandle,
} from "../ReviewSessionViewerPane";
import type { HighlightResultMessage } from "../EmbeddedViewer";

export type WorkspaceViewerMode = "a1-inline" | "a2-overlay" | "a3-inline" | "a4-inline";

export interface ViewportPublication {
  mode: WorkspaceViewerMode;
  handoff: ReviewRoomHandoff;
  showHandoffActions?: boolean;
  onBatchGateChange?: (gate: ReviewSessionViewerPaneBatchGate) => void;
  onBatchAck?: (message: HighlightResultMessage) => void;
  paneRef?: Ref<ReviewSessionViewerPaneHandle>;
}

export interface ViewportSlotApi {
  /** 中欄容器 ref callback；null＝解除註冊（host 轉 visibility:hidden，不 unmount）。 */
  registerSlot: (el: HTMLElement | null) => void;
  slotEl: HTMLElement | null;
  /** 模組頁發布 handoff；null＝該頁離場。host 只掛最後一筆。 */
  publish: (publication: ViewportPublication | null) => void;
  publication: ViewportPublication | null;
  /** 跨 dock 共用的 review session；由 publication.handoff.sessionId 播種，也可由頁面主動設定。 */
  activeSessionId: string;
  setActiveSessionId: (sessionId: string) => void;
  /** pane 回報的 viewer 證據 gate（單一來源；FlowGuide 只做分類顯示，不另造判定）。 */
  gate: ReviewSessionViewerPaneBatchGate | null;
  setGate: (gate: ReviewSessionViewerPaneBatchGate | null) => void;
}

export const ViewportSlotContext = createContext<ViewportSlotApi | null>(null);

export function useViewportSlot(): ViewportSlotApi | null {
  return useContext(ViewportSlotContext);
}

/**
 * 把 pane 回報的 gate reason 分類成導引階段。只做「顯示分類」：判定本體仍是 ReviewSessionViewerPane
 * 的單一 gate 鏈（spec Requirement：不得存在第二套 gate）。字串來源＝pane 的 i18n 文案（zh/en 兩版）。
 */
export type ViewerPhase = "no-session" | "session-selected" | "lease-pending" | "waiting-first-frame" | "waiting-datachannel" | "stage-mismatch" | "blocked" | "ready";

export function classifyViewerPhase(activeSessionId: string, gate: ReviewSessionViewerPaneBatchGate | null): ViewerPhase {
  if (!activeSessionId) return "no-session";
  if (!gate) return "session-selected";
  if (gate.canSend) return "ready";
  const r = gate.reason;
  if (/手動啟動|attach Kit session|manually start/i.test(r)) return "lease-pending";
  if (/第一幀|first frame/i.test(r)) return "waiting-first-frame";
  if (/DataChannel/i.test(r)) return "waiting-datachannel";
  if (/stage/i.test(r)) return "stage-mismatch";
  return "blocked";
}
