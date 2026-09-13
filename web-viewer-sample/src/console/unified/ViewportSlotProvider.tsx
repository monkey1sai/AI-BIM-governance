// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseSectionInput, type SectionInput, type SectionState } from "../sectionPlaneBridge";
import type { ReactNode } from "react";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import type { USDPrimNode } from "../EmbeddedViewer";
import { resolveViewerCommandGate, ViewportSlotContext } from "./viewportSlot";
import type { ViewportDockSubscription, ViewportHostActions, ViewportPublication, ViewportSlotApi, WorkspaceViewerPublication } from "./viewportSlot";

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [viewerPublication, setViewerPublication] = useState<WorkspaceViewerPublication | null>(null);
  const [dockSubscription, setDockSubscription] = useState<ViewportDockSubscription | null>(null);
  const dockGenerationRef = useRef(0);
  const legacyDisposeRef = useRef<(() => void) | null>(null);
  const publication = useMemo<ViewportPublication | null>(() => viewerPublication
    ? { ...viewerPublication, ...(dockSubscription ?? {}) }
    : null, [viewerPublication, dockSubscription]);
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [gate, setGateState] = useState<ReviewSessionViewerPaneBatchGate | null>(null);
  const gateRef = useRef<ReviewSessionViewerPaneBatchGate | null>(null);
  const [stageTree, setStageTreeState] = useState<USDPrimNode[]>([]);
  const [selectedStagePaths, setSelectedStagePaths] = useState<string[]>([]);
  const hostActionsRef = useRef<ViewportHostActions | null>(null);
  const activeSessionIdRef = useRef("");
  const sessionAuthorityInitializedRef = useRef(false);
  const [sectionState, setSectionState] = useState<SectionState>({ status: "idle" });
  const sectionBusy = useRef(false);
  const sectionGeneration = useRef(0);
  const invalidateSection = useCallback(() => {
    ++sectionGeneration.current; sectionBusy.current = false;
    setSectionState(previous => previous.status === "idle" || previous.status === "unconfirmed" ? previous : { status: "unconfirmed" });
  }, []);
  useEffect(() => () => { ++sectionGeneration.current; }, []);
  const sendSectionPlane = useCallback((input: SectionInput) => {
    if (sectionBusy.current) return;
    if (!parseSectionInput(input)) { setSectionState({ status: "error", reason: "invalid" }); return; }
    const send = hostActionsRef.current?.sendSectionPlane;
    if (!resolveViewerCommandGate(gateRef.current).canSend || !send) {
      setSectionState({ status: "error", reason: "unavailable" }); return;
    }
    const generation = ++sectionGeneration.current;
    sectionBusy.current = true; setSectionState({ status: "pending" });
    void Promise.resolve().then(() => {
      if (generation !== sectionGeneration.current || !resolveViewerCommandGate(gateRef.current).canSend) return null;
      return send(input);
    }).then(reply => {
      if (generation !== sectionGeneration.current || !reply) return;
      sectionBusy.current = false; setSectionState(reply);
    }).catch(() => {
      if (generation !== sectionGeneration.current) return;
      sectionBusy.current = false; setSectionState({ status: "error", reason: "transport" });
    });
  }, []);

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlotEl(el); }, []);
  const setActiveSessionId = useCallback((sessionId: string) => {
    sessionAuthorityInitializedRef.current = true;
    const nextSessionId = sessionId.trim();
    if (activeSessionIdRef.current !== nextSessionId) {
      activeSessionIdRef.current = nextSessionId;
      invalidateSection();
      gateRef.current = null;
      setGateState(null);
      setStageTreeState([]);
      setSelectedStagePaths([]);
    }
    setActiveSessionIdState(nextSessionId);
  }, [invalidateSection]);
  const setGate = useCallback((next: ReviewSessionViewerPaneBatchGate | null) => {
    if (!resolveViewerCommandGate(next).canSend) invalidateSection();
    gateRef.current = next;
    setGateState((prev) => (
      prev && next
      && prev.canSend === next.canSend
      && prev.reason === next.reason
      && prev.canSendViewerCommand === next.canSendViewerCommand
      && prev.viewerCommandReason === next.viewerCommandReason
        ? prev
        : next
    ));
    if (!resolveViewerCommandGate(next).canSend) {
      setStageTreeState([]);
      setSelectedStagePaths([]);
    }
  }, [invalidateSection]);
  const setStageTree = useCallback((nodes: USDPrimNode[]) => {
    // Window.tsx 已把 nested getChildrenResponse 合併進完整 root tree，再以 stage_tree 下傳。
    setStageTreeState(nodes);
  }, []);
  const registerHostActions = useCallback((actions: ViewportHostActions | null) => {
    hostActionsRef.current = actions;
    if (!actions) invalidateSection();
  }, [invalidateSection]);
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
  const publishViewer = useCallback((next: WorkspaceViewerPublication) => {
    setViewerPublication({ mode: next.mode, handoff: next.handoff, showHandoffActions: next.showHandoffActions });
    // handoff 留作資料；觀看 authority 仍為 activeSessionId，顯式清空後不重新播種。
    if (next.handoff.sessionId.trim() && !sessionAuthorityInitializedRef.current) {
      setActiveSessionId(next.handoff.sessionId);
    }
  }, [setActiveSessionId]);

  const subscribeDock = useCallback((next: ViewportDockSubscription) => {
    const generation = ++dockGenerationRef.current;
    setDockSubscription(next);
    // A retained Pane emits only on gate transitions; initialize each new Dock now.
    if (gateRef.current) next.onBatchGateChange?.(gateRef.current);
    return () => {
      if (dockGenerationRef.current !== generation) return;
      ++dockGenerationRef.current;
      setDockSubscription(null);
    };
  }, []);

  const publish = useCallback((next: ViewportPublication | null) => {
    if (!next) {
      legacyDisposeRef.current?.();
      legacyDisposeRef.current = null;
      return;
    }
    publishViewer(next);
    legacyDisposeRef.current = subscribeDock({
      onBatchGateChange: next.onBatchGateChange,
      onBatchAck: next.onBatchAck,
      onStageTree: next.onStageTree,
      paneRef: next.paneRef,
    });
  }, [publishViewer, subscribeDock]);

  const value = useMemo<ViewportSlotApi>(() => ({
    sectionState, sendSectionPlane, invalidateSection,
    selectedStagePaths, setSelectedStagePaths,
    registerSlot,
    slotEl,
    publishViewer,
    viewerPublication,
    subscribeDock,
    dockSubscription,
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
    sectionState, sendSectionPlane, invalidateSection,
    selectedStagePaths,
    publishViewer, viewerPublication, subscribeDock, dockSubscription,
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
