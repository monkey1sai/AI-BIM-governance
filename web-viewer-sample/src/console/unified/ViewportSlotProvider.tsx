// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useMemo, useRef, useState } from "react";
import { parseSectionInput, type SectionInput, type SectionReply } from "../../viewerCommandChannel/sectionPlane";
import type { MeasurementAction, MeasurementState } from "../../viewerCommandChannel/measurement";
import { parseCameraViewInput, parseFlySpeed, type CameraReply, type CameraViewInput, type FlyReply } from "../../viewerCommandChannel/camera";
import { useViewerCommandState } from "./useViewerCommandState";
import type { ReactNode } from "react";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import type { USDPrimNode } from "../EmbeddedViewer";
import { resolveViewerCommandGate, ViewportSlotContext } from "./viewportSlot";
import type { ViewportDockSubscription, ViewportHostActions, ViewportPublication, ViewportSlotApi, WorkspaceViewerPublication } from "./viewportSlot";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";

type CameraCommand = CameraViewInput | { action: "read" };
const validateCameraCommand = (input: CameraCommand) => input.action === "read" || parseCameraViewInput(input) !== null;
const validateFlySpeed = (speed: number) => parseFlySpeed(speed) !== null;
const validateSection = (input: SectionInput) => parseSectionInput(input) !== null;

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [controlsEl, setControlsEl] = useState<HTMLElement | null>(null);
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
  const resolveCameraCommand = useCallback(() => {
    const commands = hostActionsRef.current?.commands;
    if (!commands) return undefined;
    return (input: CameraCommand) => (input.action === "read"
      ? commands.send("camera_state", null) : commands.send("camera_view", input));
  }, []);
  const resolveFlySpeed = useCallback(() => {
    const commands = hostActionsRef.current?.commands;
    return commands ? (speed: number) => commands.send("fly_navigation", speed) : undefined;
  }, []);
  const resolveSection = useCallback(() => {
    const commands = hostActionsRef.current?.commands;
    return commands ? (input: SectionInput) => commands.send("section_plane", input) : undefined;
  }, []);
  const camera = useViewerCommandState<CameraCommand, CameraReply>(gateRef, validateCameraCommand, resolveCameraCommand);
  const fly = useViewerCommandState<number, FlyReply>(gateRef, validateFlySpeed, resolveFlySpeed);
  const section = useViewerCommandState<SectionInput, SectionReply>(gateRef, validateSection, resolveSection);
  const { run: runCamera, invalidate: invalidateCamera } = camera;
  const { invalidate: invalidateFly } = fly;
  const { state: sectionState, run: sendSectionPlane, invalidate: invalidateSectionState } = section;
  const sendCameraView = useCallback((input: CameraViewInput) => runCamera(input), [runCamera]);
  const refreshCameraState = useCallback(() => runCamera({ action: "read" }), [runCamera]);
  const [measurementState, setMeasurementState] = useState<MeasurementState>({ status: "idle" });
  const sendMeasurement = useCallback((action: MeasurementAction) => {
    if (action === "start" && !resolveViewerCommandGate(gateRef.current).canSend) return;
    if (!hostActionsRef.current?.commands?.controlMeasurement(action)) {
      setMeasurementState({ status: "error", reason: "unavailable" });
    }
  }, []);
  const invalidateSection = useCallback(() => {
    setMeasurementState(previous => previous.status === "idle" || previous.status === "unconfirmed" ? previous : { status: "unconfirmed" });
    invalidateSectionState(); invalidateCamera(); invalidateFly();
  }, [invalidateSectionState, invalidateCamera, invalidateFly]);

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
    action: "reset_camera" | "frame_all" | "camera_view" | "toggle_fullscreen" | "toggle_projection",
    cameraView?: string,
  ) => {
    // Kit's resetStage/frame_all restore the opening camera (incl. projection), so the last
    // applied/confirmed camera readback is stale the moment the host action goes out.
    if (action === "reset_camera" || action === "frame_all") invalidateCamera();
    hostActionsRef.current?.sendToolbarAction?.(action, cameraView);
  }, [invalidateCamera]);
  const applyStageBinding = useCallback(async (artifacts: StageBindingSelection[]): Promise<StageBindingResultMessage> => {
    const actions = hostActionsRef.current;
    if (!actions?.applyStageBinding) {
      return { protocol: "vg01", type: "stage_binding_result", status: "failed", revision_id: null, reason: "viewer_unavailable" };
    }
    return actions.applyStageBinding(artifacts);
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
    controlsEl, registerControls: setControlsEl,
    measurementState, setMeasurementState, sendMeasurement,
    sectionState, sendSectionPlane, invalidateSection,
    cameraViewState: camera.state, sendCameraView, refreshCameraState,
    flyState: fly.state, sendFlySpeed: fly.run,
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
    applyStageBinding,
    registerHostActions,
  }), [
    controlsEl,
    measurementState, sendMeasurement,
    sectionState, sendSectionPlane, invalidateSection,
    camera.state, sendCameraView, refreshCameraState,
    fly.state, fly.run,
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
    applyStageBinding,
    registerHostActions,
  ]);

  return <ViewportSlotContext.Provider value={value}>{children}</ViewportSlotContext.Provider>;
}
