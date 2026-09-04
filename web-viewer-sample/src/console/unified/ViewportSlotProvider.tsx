// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import type { USDPrimNode } from "../EmbeddedViewer";
import { resolveViewerCommandGate, ViewportSlotContext } from "./viewportSlot";
import type { ViewportHostActions, ViewportPublication, ViewportSlotApi } from "./viewportSlot";

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [publication, setPublication] = useState<ViewportPublication | null>(null);
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [gate, setGateState] = useState<ReviewSessionViewerPaneBatchGate | null>(null);
  const [stageTree, setStageTreeState] = useState<USDPrimNode[]>([]);
  const hostActionsRef = useRef<ViewportHostActions | null>(null);
  const activeSessionIdRef = useRef("");
  const sessionAuthorityInitializedRef = useRef(false);

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlotEl(el); }, []);
  const setActiveSessionId = useCallback((sessionId: string) => {
    sessionAuthorityInitializedRef.current = true;
    const nextSessionId = sessionId.trim();
    if (activeSessionIdRef.current !== nextSessionId) {
      activeSessionIdRef.current = nextSessionId;
      setGateState(null);
      setStageTreeState([]);
    }
    setActiveSessionIdState(nextSessionId);
  }, []);
  const setGate = useCallback((next: ReviewSessionViewerPaneBatchGate | null) => {
    setGateState((prev) => (
      prev && next
      && prev.canSend === next.canSend
      && prev.reason === next.reason
      && prev.canSendViewerCommand === next.canSendViewerCommand
      && prev.viewerCommandReason === next.viewerCommandReason
        ? prev
        : next
    ));
    if (!resolveViewerCommandGate(next).canSend) setStageTreeState([]);
  }, []);
  const setStageTree = useCallback((nodes: USDPrimNode[]) => {
    // Window.tsx 已把 nested getChildrenResponse 合併進完整 root tree，再以 stage_tree 下傳。
    setStageTreeState(nodes);
  }, []);
  const registerHostActions = useCallback((actions: ViewportHostActions | null) => {
    hostActionsRef.current = actions;
  }, []);
  const requestStageTree = useCallback((primPath?: string) => {
    hostActionsRef.current?.requestStageTree?.(primPath);
  }, []);
  const selectPrim = useCallback((primPath: string, multiSelect?: boolean) => {
    hostActionsRef.current?.selectPrim?.(primPath, multiSelect);
  }, []);
  const sendToolbarAction = useCallback((
    action: "reset_camera" | "camera_view" | "toggle_fullscreen" | "toggle_projection",
    cameraView?: string,
  ) => {
    hostActionsRef.current?.sendToolbarAction?.(action, cameraView);
  }, []);
  const publish = useCallback((next: ViewportPublication | null) => {
    setPublication(next);
    // 僅首次播種共用 session；可見 input 一旦成為 authority，後續 publication 不得覆寫或復活舊 handoff。
    if (next && next.handoff.sessionId.trim() && !sessionAuthorityInitializedRef.current) {
      setActiveSessionId(next.handoff.sessionId);
    }
    if (!next) {
      setGateState(null);
      setStageTreeState([]);
    }
  }, [setActiveSessionId]);

  const value = useMemo<ViewportSlotApi>(() => ({
    registerSlot,
    slotEl,
    publish,
    publication,
    activeSessionId,
    setActiveSessionId,
    gate,
    setGate,
    stageTree,
    setStageTree,
    requestStageTree,
    selectPrim,
    sendToolbarAction,
    registerHostActions,
  }), [
    registerSlot,
    slotEl,
    publish,
    publication,
    activeSessionId,
    setActiveSessionId,
    gate,
    setGate,
    stageTree,
    setStageTree,
    requestStageTree,
    selectPrim,
    sendToolbarAction,
    registerHostActions,
  ]);

  return <ViewportSlotContext.Provider value={value}>{children}</ViewportSlotContext.Provider>;
}
