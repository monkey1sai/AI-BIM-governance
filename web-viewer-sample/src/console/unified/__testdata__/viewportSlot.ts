// Viewport Slot test doubles (docs/architecture/viewport-slot-adr.md §2): every member present, spies for the
// actions, and a command port that answers unavailable unless a test supplies one.
import { vi } from "vitest";
import { fakeViewerCommandPort } from "../../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { ViewerHostActions } from "../../ReviewSessionViewerPane";
import { classifyViewerPhase } from "../../viewerGate";
import type { ViewportSlotApi } from "../viewportSlot";

export function fakeViewerHostActions(overrides: Partial<ViewerHostActions> = {}): ViewerHostActions {
  return {
    commands: fakeViewerCommandPort({}),
    requestStageTree: vi.fn(),
    selectPrim: vi.fn(),
    sendToolbarAction: vi.fn(),
    applyStageBinding: vi.fn(),
    ...overrides,
  };
}

/** A slot to render pages against; `phase` follows `activeSessionId` and `gate` unless it is overridden. */
export function fakeViewportSlot(overrides: Partial<ViewportSlotApi> = {}): ViewportSlotApi {
  const activeSessionId = overrides.activeSessionId ?? "";
  const gate = overrides.gate ?? null;
  return {
    activeSessionId, setActiveSessionId: vi.fn(),
    gate, setGate: vi.fn(), phase: classifyViewerPhase(activeSessionId, gate),
    commands: fakeViewerCommandPort({}), commandState: () => ({ status: "idle" }), invalidateCommands: vi.fn(),
    measurementState: { status: "idle" }, setMeasurementState: vi.fn(), controlMeasurement: vi.fn(() => false),
    stageTree: [], setStageTree: vi.fn(),
    selectedStagePaths: [], setSelectedStagePaths: vi.fn(),
    hostActions: null, registerHostActions: vi.fn(),
    slotEl: null, registerSlot: vi.fn(),
    controlsEl: null, registerControls: vi.fn(),
    viewerPublication: null, publishViewer: vi.fn(),
    dockSubscription: null, subscribeDock: vi.fn(() => vi.fn()),
    ...overrides,
  };
}
