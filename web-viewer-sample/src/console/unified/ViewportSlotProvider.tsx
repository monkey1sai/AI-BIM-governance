// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useMemo, useRef, useState } from "react";
import type { MeasurementAction, MeasurementState } from "../../viewerCommandChannel/measurement";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";
import type { ViewerCommandFamily } from "../../viewerCommandChannel/registry";
import { useViewerCommandState } from "./useViewerCommandState";
import type { ReactNode } from "react";
import { classifyViewerPhase, sameViewerGate, type ViewerGate } from "../viewerGate";
import type { USDPrimNode } from "../EmbeddedViewer";
import type { ViewerHostActions } from "../ReviewSessionViewerPane";
import { ViewportSlotContext } from "./viewportSlot";
import type { ViewportDockSubscription, ViewportSlotApi, WorkspaceViewerPublication } from "./viewportSlot";

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [controlsEl, setControlsEl] = useState<HTMLElement | null>(null);
  const [viewerPublication, setViewerPublication] = useState<WorkspaceViewerPublication | null>(null);
  const [dockSubscription, setDockSubscription] = useState<ViewportDockSubscription | null>(null);
  const dockGenerationRef = useRef(0);
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [gate, setGateState] = useState<ViewerGate | null>(null);
  const gateRef = useRef<ViewerGate | null>(null);
  const [stageTree, setStageTreeState] = useState<USDPrimNode[]>([]);
  const [selectedStagePaths, setSelectedStagePaths] = useState<string[]>([]);
  const [hostActions, setHostActions] = useState<ViewerHostActions | null>(null);
  const hostActionsRef = useRef<ViewerHostActions | null>(null);
  const activeSessionIdRef = useRef("");
  const sessionAuthorityInitializedRef = useRef(false);
  const resolvePort = useCallback(() => hostActionsRef.current?.commands, []);
  const { commandState, send, invalidate } = useViewerCommandState(gateRef, resolvePort);
  const [measurementState, setMeasurementState] = useState<MeasurementState>({ status: "idle" });
  const controlMeasurement = useCallback((action: MeasurementAction) => {
    if (action === "start" && gateRef.current?.command.ok !== true) return false;
    if (hostActionsRef.current?.commands.controlMeasurement(action)) return true;
    setMeasurementState({ status: "error", reason: "unavailable" });
    return false;
  }, []);
  const commands = useMemo<ViewerCommandPort>(() => ({ send, controlMeasurement }), [send, controlMeasurement]);
  const invalidateCommands = useCallback((family?: ViewerCommandFamily) => {
    if (!family) {
      setMeasurementState(previous => previous.status === "idle" || previous.status === "unconfirmed" ? previous : { status: "unconfirmed" });
    }
    invalidate(family);
  }, [invalidate]);

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlotEl(el); }, []);
  const setActiveSessionId = useCallback((sessionId: string) => {
    sessionAuthorityInitializedRef.current = true;
    const nextSessionId = sessionId.trim();
    if (activeSessionIdRef.current !== nextSessionId) {
      activeSessionIdRef.current = nextSessionId;
      invalidateCommands();
      gateRef.current = null;
      setGateState(null);
      setStageTreeState([]);
      setSelectedStagePaths([]);
    }
    setActiveSessionIdState(nextSessionId);
  }, [invalidateCommands]);
  const setGate = useCallback((next: ViewerGate | null) => {
    const commandOpen = next?.command.ok === true;
    if (!commandOpen) invalidateCommands();
    gateRef.current = next;
    setGateState((prev) => (prev && next && sameViewerGate(prev, next) ? prev : next));
    if (!commandOpen) {
      setStageTreeState([]);
      setSelectedStagePaths([]);
    }
  }, [invalidateCommands]);
  const setStageTree = useCallback((nodes: USDPrimNode[]) => {
    // Window.tsx 已把 nested getChildrenResponse 合併進完整 root tree，再以 stage_tree 下傳。
    setStageTreeState(nodes);
  }, []);
  const registerHostActions = useCallback((actions: ViewerHostActions | null) => {
    hostActionsRef.current = actions;
    setHostActions(actions);
    if (!actions) invalidateCommands();
  }, [invalidateCommands]);
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

  const phase = classifyViewerPhase(activeSessionId, gate);
  const value = useMemo<ViewportSlotApi>(() => ({
    activeSessionId, setActiveSessionId,
    gate, setGate, phase,
    commands, commandState, invalidateCommands,
    measurementState, setMeasurementState, controlMeasurement,
    stageTree, setStageTree,
    selectedStagePaths, setSelectedStagePaths,
    hostActions, registerHostActions,
    slotEl, registerSlot,
    controlsEl, registerControls: setControlsEl,
    viewerPublication, publishViewer,
    dockSubscription, subscribeDock,
  }), [
    activeSessionId, setActiveSessionId,
    gate, setGate, phase,
    commands, commandState, invalidateCommands,
    measurementState, controlMeasurement,
    stageTree, setStageTree,
    selectedStagePaths,
    hostActions, registerHostActions,
    slotEl, registerSlot,
    controlsEl,
    viewerPublication, publishViewer,
    dockSubscription, subscribeDock,
  ]);

  return <ViewportSlotContext.Provider value={value}>{children}</ViewportSlotContext.Provider>;
}
