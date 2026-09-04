// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — WorkspaceViewportHost（introduce-viewer-app-integration-surface design §4 V-A′ / tasks S3a）
// 掛在 UnifiedShell page-root 的 absolute 兄弟層；頁面經 useViewportSlot().registerSlot(el) 註冊中欄矩形，
// ResizeObserver 同步。live-only：coordinator runtime/status 非 live 時 return null ＝ 零新 DOM（design gate 的
// /api 503 stub 下不會出現 iframe／video，manifest live_surface_policy 安全）。內容物＝重用 ReviewSessionViewerPane
// （12 態渲染、lease/heartbeat、gate 全沿用，不新造第二套）。離開 workspace 由 UnifiedShell 的 page prop 顯式 unmount。
// ═══════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ReviewSessionViewerPane } from "../ReviewSessionViewerPane";
import type {
  ReviewRoomHandoff,
  ReviewSessionViewerPaneBatchGate,
  ReviewSessionViewerPaneHandle,
} from "../ReviewSessionViewerPane";
import type { StageTreeMessage } from "../EmbeddedViewer";
import { t } from "../i18n";
import { useConsoleData } from "./consoleData";
import { useViewportSlot } from "./viewportSlot";
import { MONO } from "./fixtures";

interface SlotRect { left: number; top: number; width: number; height: number; }

function measure(slotEl: HTMLElement, hostParent: HTMLElement | null): SlotRect | null {
  const s = slotEl.getBoundingClientRect();
  if (s.width <= 0 || s.height <= 0) return null;
  const p = hostParent ? hostParent.getBoundingClientRect() : { left: 0, top: 0 };
  return { left: s.left - p.left, top: s.top - p.top, width: s.width, height: s.height };
}

export interface WorkspaceViewportHostProps {
  /** 測試縫：直接指定 pane 的 first-frame 逾時（生產路徑不傳）。 */
  firstFrameTimeoutMs?: number;
}

export function WorkspaceViewportHost({ firstFrameTimeoutMs }: WorkspaceViewportHostProps) {
  const slot = useViewportSlot();
  const snap = useConsoleData(["runtimeStatus"]);
  const live = snap.runtimeStatus.state === "live" && snap.runtimeStatus.data !== null;
  const hostRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<SlotRect | null>(null);
  const mountTokenRef = useRef<string>(`ws_viewport_${Math.random().toString(36).slice(2, 10)}`);

  const slotEl = slot?.slotEl ?? null;
  // useEffect（非 useLayoutEffect）：unified.test.tsx 以 renderToString 純渲染殼層，layout effect 會吐 SSR 警告；
  // 位置同步晚一個 paint 對 absolute 覆蓋層可接受。
  useEffect(() => {
    if (!live || !slotEl) { setRect(null); return; }
    const parent = hostRef.current?.parentElement ?? null;
    const sync = () => setRect(measure(slotEl, parent));
    sync();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(slotEl);
    if (parent) ro?.observe(parent);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [live, slotEl]);

  const publication = slot?.publication ?? null;
  const activeSessionId = slot?.activeSessionId ?? "";
  // 共用 session 是單一 authority：publish 會先播種；可見 input 之後即使清空，也不回退舊 handoff。
  const handoff = useMemo<ReviewRoomHandoff | null>(() => {
    if (!publication) return null;
    const sid = activeSessionId;
    return sid === publication.handoff.sessionId ? publication.handoff : { ...publication.handoff, sessionId: sid };
  }, [publication, activeSessionId]);

  // gate 單一來源：pane 回報 → context（FlowGuide 讀）→ 再透傳給發布頁（A2 批次 apply 鈕）。
  const setGate = slot?.setGate;
  const pageGateRef = useRef(publication?.onBatchGateChange);
  pageGateRef.current = publication?.onBatchGateChange;
  const onGate = useMemo(() => (gate: ReviewSessionViewerPaneBatchGate) => {
    setGate?.(gate);
    pageGateRef.current?.(gate);
  }, [setGate]);
  useEffect(() => () => { setGate?.(null); }, [setGate]);

  const paneHandleRef = useRef<ReviewSessionViewerPaneHandle | null>(null);
  const extPaneRef = publication?.paneRef;
  const setCombinedPaneRef = useCallback((node: ReviewSessionViewerPaneHandle | null) => {
    paneHandleRef.current = node;
    if (typeof extPaneRef === "function") {
      extPaneRef(node);
    } else if (extPaneRef && typeof extPaneRef === "object") {
      (extPaneRef as { current: ReviewSessionViewerPaneHandle | null }).current = node;
    }
  }, [extPaneRef]);

  const registerHostActions = slot?.registerHostActions;
  useEffect(() => {
    registerHostActions?.({
      requestStageTree: (primPath) => paneHandleRef.current?.requestStageTree(primPath),
      selectPrim: (primPath, multiSelect) => paneHandleRef.current?.selectPrim(primPath, multiSelect),
      sendToolbarAction: (action, cameraView) => paneHandleRef.current?.sendToolbarAction(action, cameraView),
    });
    return () => registerHostActions?.(null);
  }, [registerHostActions]);

  const setStageTree = slot?.setStageTree;
  const pageStageTreeRef = useRef(publication?.onStageTree);
  pageStageTreeRef.current = publication?.onStageTree;
  const onStageTree = useCallback((msg: StageTreeMessage) => {
    setStageTree?.(msg.children);
    pageStageTreeRef.current?.(msg);
  }, [setStageTree]);

  useEffect(() => {
    if (live) return;
    setStageTree?.([]);
    const reason = t("coordinator runtime/status 已離線", "coordinator runtime/status is offline");
    const offlineGate: ReviewSessionViewerPaneBatchGate = {
      canSend: false,
      reason,
      canSendViewerCommand: false,
      viewerCommandReason: reason,
    };
    setGate?.(offlineGate);
    pageGateRef.current?.(offlineGate);
  }, [live, setGate, setStageTree]);

  if (!live) return null; // 零新 DOM（離線／design gate）

  const style: CSSProperties = rect
    ? { position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, visibility: "visible" }
    : { position: "absolute", left: 0, top: 0, width: 0, height: 0, visibility: "hidden" };

  return (
    <div
      ref={hostRef}
      data-uc="viewport"
      data-prov="asbuilt"
      data-mount-token={mountTokenRef.current}
      data-state={handoff ? "published" : "empty"}
      style={{
        ...style,
        overflow: "auto",
        background: "var(--ab-surface)",
        border: "1px solid rgba(120,160,210,.14)",
        borderRadius: 10,
        boxSizing: "border-box",
        zIndex: 5,
      }}
    >
      {handoff && publication ? (
        <ReviewSessionViewerPane
          ref={setCombinedPaneRef}
          mode={publication.mode}
          handoff={handoff}
          showHandoffActions={publication.showHandoffActions ?? true}
          onBatchGateChange={onGate}
          onBatchAck={publication.onBatchAck}
          onSessionIdChange={slot?.setActiveSessionId}
          onStageTree={onStageTree}
          {...(firstFrameTimeoutMs !== undefined ? { firstFrameTimeoutMs } : {})}
        />
      ) : (
        <div data-testid="ws-viewport-empty" role="status" aria-live="polite" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".1em", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>
            WebRTC viewport
          </span>
          <span style={{ fontSize: 13, color: "var(--ab-text)" }}>
            {t("尚未綁定 review session。請在右側工具 Dock 選擇或建立 session，viewer 會在此掛載並等待 first frame。",
               "No review session is bound yet. Pick or create a session in the tool dock on the right; the viewer mounts here and waits for the first frame.")}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ab-text-muted)" }}>
            {t("不自動 claim viewer lease；啟動一律由你按下「啟動 3D Session」。", "The viewer lease is never auto-claimed; you start it with “Start 3D Session”.")}
          </span>
        </div>
      )}
    </div>
  );
}
