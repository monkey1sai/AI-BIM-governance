// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import type { USDPrimNode } from "../EmbeddedViewer";
import { ViewportSlotContext } from "./viewportSlot";
import type { ViewportHostActions, ViewportPublication, ViewportSlotApi } from "./viewportSlot";

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [publication, setPublication] = useState<ViewportPublication | null>(null);
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [gate, setGateState] = useState<ReviewSessionViewerPaneBatchGate | null>(null);
  const [stageTree, setStageTreeState] = useState<USDPrimNode[]>([]);
  const hostActionsRef = useRef<ViewportHostActions | null>(null);
  const activeSessionIdRef = useRef("");

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlotEl(el); }, []);
  const setActiveSessionId = useCallback((sessionId: string) => {
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
    const canSendViewerCommand = next?.canSendViewerCommand ?? next?.canSend;
    if (canSendViewerCommand !== true) setStageTreeState([]);
  }, []);
  const setStageTree = useCallback((nodes: USDPrimNode[]) => {
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
    // 播種共用 session：頁面帶來非空 session 即採用；頁面離場不清空（保住跨 dock 的 lease）。
    if (next && next.handoff.sessionId.trim()) setActiveSessionId(next.handoff.sessionId);
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
