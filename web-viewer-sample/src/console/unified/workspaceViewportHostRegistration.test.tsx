// WorkspaceViewportHost 的 host actions 註冊（docs/architecture/viewport-slot-adr.md 2026-09-24 修訂）：真 provider、host 與 pane，
// runtime/status 由測試 store 發布。pane handle 原樣註冊，只有 commands 換成晚綁定到目前 pane 的 port；
// 換 Dock、換 mode 或 Dock 不帶 paneRef 都不註冊 null，離線與 host 卸載時才註冊 null。
import { act, useCallback, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRoomHandoff, ReviewSessionViewerPaneHandle, ViewerHostActions } from "../ReviewSessionViewerPane";
import type { SectionInput, SectionReply } from "../../viewerCommandChannel/sectionPlane";
import { RT_IDLE, idleFetchers, sessionItem, spyCoordinatorEndpoints } from "./__testdata__/coordinatorMocks";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { ConsoleDataContext } from "./consoleData";
import { CoordinatorStatusStore, coordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointSlice } from "./coordinatorStatusStore";
import { ViewportSlotContext, useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";

const SESSION = "review_session_host_actions";
const runtimeStatus = { ...RT_IDLE, sessions: { count: 1, active_count: 1, participant_count: 0, items: [sessionItem(SESSION)] } };
const handoff: ReviewRoomHandoff = {
  source: "a1", sessionId: SESSION, ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null,
  expectedStageUrl: null, mappingInformationStatus: null, mappingIssueCode: null, mappingIssueCount: null,
};
const SECTION: SectionInput = { enabled: true, axis: "z", direction: 1, position: 2 };
const SECTION_APPLIED: SectionReply = { status: "applied", clientRequestId: "c1", requestId: "r1", effective: SECTION };
type PaneRef = { current: ReviewSessionViewerPaneHandle | null };

let container: HTMLDivElement, root: Root, store: CoordinatorStatusStore, api: ViewportSlotApi;
let registrations: (ViewerHostActions | null)[];

async function flush(n = 12) { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); }

/** 記下 host 每一次 registerHostActions，再原樣交給真 provider。 */
function RecordRegistrations({ children }: { children: ReactNode }) {
  const slot = useViewportSlot()!;
  api = slot;
  const register = slot.registerHostActions;
  const registerHostActions = useCallback((actions: ViewerHostActions | null) => {
    registrations.push(actions);
    register(actions);
  }, [register]);
  const value = useMemo(() => ({ ...slot, registerHostActions }), [slot, registerHostActions]);
  return <ViewportSlotContext.Provider value={value}>{children}</ViewportSlotContext.Provider>;
}

function publishRuntime(state: "live" | "offline") {
  const testStore = store as unknown as { publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void };
  testStore.publish("runtimeStatus", state === "live"
    ? { data: runtimeStatus, state: "live", httpStatus: 200, message: null, lastUpdatedAt: Date.now() }
    : { data: RT_IDLE, state: "offline", httpStatus: 503, message: "runtime unavailable", lastUpdatedAt: Date.now() });
}

async function render(withHost: boolean) {
  await act(async () => {
    root.render(
      <ConsoleDataContext.Provider value={store}>
        <ViewportSlotProvider><RecordRegistrations>{withHost ? <WorkspaceViewportHost /> : null}</RecordRegistrations></ViewportSlotProvider>
      </ConsoleDataContext.Provider>,
    );
  });
  await flush();
}

/** 掛上 host、發布 A1 viewer，Dock 以 paneRef 訂閱；回傳 Dock 的解除訂閱。 */
async function mountPane(paneRef: PaneRef) {
  await render(true);
  let leaveDock!: () => void;
  await act(async () => {
    api.publishViewer({ mode: "a1-inline", handoff });
    leaveDock = api.subscribeDock({ paneRef });
  });
  await flush();
  return leaveDock;
}

/** slot 的 hostActions 就是這個 pane handle：成員相同，commands 以外是同一個函式，commands 另外包過。 */
function expectRegisteredAsIs(pane: ReviewSessionViewerPaneHandle | null) {
  expect(pane).not.toBeNull();
  expect(api.hostActions).not.toBeNull();
  const registered = api.hostActions as unknown as Record<string, unknown>;
  const handle = pane as unknown as Record<string, unknown>;
  expect(Object.keys(registered).sort()).toEqual(Object.keys(handle).sort());
  for (const key of Object.keys(handle).filter(name => name !== "commands")) expect(registered[key]).toBe(handle[key]);
  expect(api.hostActions!.commands).not.toBe(pane!.commands);
}

/** 目前 pane 的 command port 回覆剖切 applied，經 slot 確認一次。 */
async function confirmSection(pane: ReviewSessionViewerPaneHandle) {
  vi.spyOn(pane.commands, "send").mockResolvedValue(SECTION_APPLIED);
  act(() => { api.setGate(OPEN_GATE); });
  await act(async () => { await api.commands.send("section_plane", SECTION); });
  expect(api.commandState("section_plane")).toEqual(SECTION_APPLIED);
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  coordinatorStatusStore.reset();
  spyCoordinatorEndpoints({ runtimeStatus });
  store = new CoordinatorStatusStore(idleFetchers({ runtimeStatus }), { isHidden: () => true });
  publishRuntime("live");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  registrations = [];
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  store.dispose();
  container.remove();
  vi.restoreAllMocks();
});

describe("WorkspaceViewportHost host actions 註冊", () => {
  it("registers the pane handle as is, with only commands wrapped in a port that forwards to the current pane", async () => {
    const paneRef: PaneRef = { current: null };
    await mountPane(paneRef);
    expectRegisteredAsIs(paneRef.current);
    const pane = paneRef.current!;
    const port = api.hostActions!.commands;

    const send = vi.spyOn(pane.commands, "send").mockResolvedValue(SECTION_APPLIED);
    const control = vi.spyOn(pane.commands, "controlMeasurement").mockReturnValue(true);
    await expect(port.send("section_plane", SECTION)).resolves.toEqual(SECTION_APPLIED);
    expect(send).toHaveBeenCalledWith("section_plane", SECTION);
    expect(port.controlMeasurement("clear")).toBe(true);
    expect(control).toHaveBeenCalledWith("clear");

    // 換 mode 會換一個 pane handle；先前註冊的 port 轉給新的 handle，不留在舊的。
    await act(async () => { api.publishViewer({ mode: "a2-overlay", handoff }); });
    await flush();
    const next = paneRef.current!;
    expect(next).not.toBe(pane);
    const nextSend = vi.spyOn(next.commands, "send").mockResolvedValue(SECTION_APPLIED);
    send.mockClear();
    await expect(port.send("section_plane", SECTION)).resolves.toEqual(SECTION_APPLIED);
    expect(nextSend).toHaveBeenCalledWith("section_plane", SECTION);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps the registration and the confirmed command state across a Dock switch, a mode change and a Dock without paneRef", async () => {
    const paneA: PaneRef = { current: null };
    let leaveDock = await mountPane(paneA);
    await confirmSection(paneA.current!);
    act(() => { api.setMeasurementState({ status: "result", distanceMetres: 2.3 }); });
    registrations = [];

    const paneB: PaneRef = { current: null };
    await act(async () => { leaveDock(); leaveDock = api.subscribeDock({ paneRef: paneB }); });
    await flush();
    expect(paneA.current).toBeNull();
    expectRegisteredAsIs(paneB.current);

    const beforeModeChange = paneB.current;
    await act(async () => { api.publishViewer({ mode: "a2-overlay", handoff }); });
    await flush();
    expect(paneB.current).not.toBe(beforeModeChange);
    expectRegisteredAsIs(paneB.current);

    const beforeDockWithoutRef = api.hostActions;
    await act(async () => { leaveDock(); api.subscribeDock({}); });
    await flush();
    expect(paneB.current).toBeNull();
    expect(api.hostActions).not.toBeNull();
    expect(api.hostActions).not.toBe(beforeDockWithoutRef);

    // 三步各一次：換 Dock 換掉 forwarded ref、換 mode 改變 pane 的 [mode] deps，都讓 pane 重建 handle；
    // 同一次 commit 裡的 ref(null) 與 ref(新 handle) 被批次成一次非 null 註冊。
    expect(registrations).toHaveLength(3);
    expect(registrations).not.toContain(null);
    expect(registrations[2]).toBe(api.hostActions);
    expect(api.commandState("section_plane")).toEqual(SECTION_APPLIED);
    expect(api.measurementState).toEqual({ status: "result", distanceMetres: 2.3 });
  });

  it("registers null when runtime/status goes offline", async () => {
    const paneRef: PaneRef = { current: null };
    await mountPane(paneRef);
    expectRegisteredAsIs(paneRef.current);
    await act(async () => { publishRuntime("offline"); });
    await flush();
    expect(container.querySelector('[data-uc="viewport"]')).toBeNull();
    expect(paneRef.current).toBeNull();
    expect(api.hostActions).toBeNull();
    expect(registrations[registrations.length - 1]).toBeNull();
  });

  it("registers null when the host unmounts while the provider stays", async () => {
    const paneRef: PaneRef = { current: null };
    await mountPane(paneRef);
    await confirmSection(paneRef.current!);
    await render(false);
    expect(container.querySelector('[data-uc="viewport"]')).toBeNull();
    expect(api.hostActions).toBeNull();
    expect(registrations[registrations.length - 1]).toBeNull();
    expect(api.commandState("section_plane")).toEqual({ status: "unconfirmed" });
  });
});
