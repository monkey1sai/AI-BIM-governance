// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — WorkspaceViewerMount：模組頁掛 viewer 的單一入口。
// 在 3D 工作區（ViewportSlotContext 存在）→ 把 handoff publish 給 WorkspaceViewportHost，本地不掛 pane
// （避免與中央 viewport 雙重 claim lease）。在 legacy 深連結（context 缺席，如 #version-diff、#a1-workbench）
// → 原地掛 ReviewSessionViewerPane，行為與改版前逐字相同。
// 對呼叫端而言只是把 <ReviewSessionViewerPane …/> 換成 <WorkspaceViewerMount …/>，props 同名同義。
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useRef } from "react";
import type { Ref } from "react";
import { ReviewSessionViewerPane } from "../ReviewSessionViewerPane";
import type {
  ReviewRoomHandoff,
  ReviewSessionViewerPaneBatchGate,
  ReviewSessionViewerPaneHandle,
} from "../ReviewSessionViewerPane";
import type { HighlightResultMessage } from "../EmbeddedViewer";
import { useViewportSlot } from "./viewportSlot";
import type { WorkspaceViewerMode } from "./viewportSlot";

export interface WorkspaceViewerMountProps {
  mode: WorkspaceViewerMode;
  handoff: ReviewRoomHandoff;
  showHandoffActions?: boolean;
  onBatchGateChange?: (gate: ReviewSessionViewerPaneBatchGate) => void;
  onBatchAck?: (message: HighlightResultMessage) => void;
  /** A2 批次 apply 需要 pane handle；host 模式下透傳給中央 pane，legacy 模式下直接掛在本地 pane。 */
  paneRef?: Ref<ReviewSessionViewerPaneHandle>;
}

export function WorkspaceViewerMount({ mode, handoff, showHandoffActions = true, onBatchGateChange, onBatchAck, paneRef }: WorkspaceViewerMountProps) {
  const slot = useViewportSlot();
  // callback 走 ref：identity 變動不重新 publish（避免 publish→provider setState→頁面 re-render→再 publish 的迴圈）。
  const gateRef = useRef(onBatchGateChange);
  gateRef.current = onBatchGateChange;
  const ackRef = useRef(onBatchAck);
  ackRef.current = onBatchAck;
  // handoff 以值指紋比較（頁面常以字面物件建構，identity 每 render 皆新）。
  const handoffFingerprint = JSON.stringify(handoff);
  const handoffRef = useRef(handoff);
  handoffRef.current = handoff;
  const publish = slot?.publish;

  useEffect(() => {
    if (!publish) return;
    publish({
      mode,
      handoff: handoffRef.current,
      showHandoffActions,
      onBatchGateChange: (gate) => gateRef.current?.(gate),
      onBatchAck: (message) => ackRef.current?.(message),
      paneRef,
    });
    return () => { publish(null); };
  }, [publish, mode, handoffFingerprint, showHandoffActions, paneRef]);

  if (slot) return null;
  return (
    <ReviewSessionViewerPane
      ref={paneRef}
      mode={mode}
      handoff={handoff}
      showHandoffActions={showHandoffActions}
      onBatchGateChange={onBatchGateChange}
      onBatchAck={onBatchAck}
    />
  );
}
