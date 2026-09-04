// introduce-viewer-app-integration-surface S3a（V-A′）：WorkspaceViewportHost 的可觀察契約。
// (1) 離線（design gate 的 /api 503）→ 零新 DOM：無 [data-uc="viewport"]、無 iframe／video；三欄與流程導引仍在。
// (2) live（runtime/status 200）→ host 掛載於 page-root，data-prov="asbuilt"，未發布 handoff 時顯示誠實空態。
// (3) 離開 workspace（page prop 變）→ host unmount。
// (4) classifyViewerPhase／ViewportSlotProvider 純邏輯。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorStatusStore, coordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointSlice } from "./coordinatorStatusStore";
import { ConsoleDataContext } from "./consoleData";
import { RT_IDLE, idleFetchers, sessionItem, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";
import { classifyViewerPhase, useViewportSlot } from "./viewportSlot";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspacePage } from "./WorkspacePage";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";

async function flush(n = 6) {
  for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); });
}

describe("WorkspaceViewportHost（V-A′）", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let previousHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    previousHash = window.location.hash;
    coordinatorStatusStore.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
    window.location.hash = previousHash;
    vi.restoreAllMocks();
  });

  async function mountAt(hash: string) {
    window.location.hash = hash;
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    await flush();
  }

  it("離線：三欄與流程導引存在，但 host 零 DOM、無 iframe／video", async () => {
    spyCoordinatorEndpointsOffline();
    await mountAt("#a1");
    expect(container.querySelector('[data-uc="unified-live-workspace"]')).not.toBeNull();
    expect(container.querySelector('[data-uc="ws-stage-tree"]')?.getAttribute("data-state")).toBe("unsupported");
    expect(container.querySelector('[data-uc="ws-viewport-slot"]')).not.toBeNull();
    expect(container.querySelector('[data-uc="ws-flow-guide"]')?.getAttribute("data-phase")).toBe("no-session");
    expect(container.querySelector('[data-uc="live-module-a1"]')).not.toBeNull();
    expect(container.querySelector('[data-uc="viewport"]')).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("video")).toBeNull();
  });

  it("live：host 掛載於 page-root、data-prov=asbuilt、未發布時為誠實空態且無 iframe", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: { ...RT_IDLE, sessions: { count: 1, active_count: 1, participant_count: 0, items: [sessionItem("review_session_t1")] } },
    });
    await mountAt("#a2");
    await flush(10);
    const host = container.querySelector('[data-uc="viewport"]');
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-prov")).toBe("asbuilt");
    expect(host?.parentElement?.getAttribute("data-uc")).toBe("page-root");
    expect(host?.getAttribute("data-state")).toBe("empty");
    expect(container.querySelector('[data-testid="ws-viewport-empty"]')).not.toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    // 既有 e2e 契約：不得出現 demo viewport
    expect(container.querySelector('[data-uc="viewport"][data-prov="demo"]')).toBeNull();
  });

  it("可見 session input 由 A 切到 B 時同步 workspace authority 且不回退舊 handoff", async () => {
    const runtimeStatus = {
      ...RT_IDLE,
      sessions: {
        count: 2,
        active_count: 2,
        participant_count: 0,
        items: [sessionItem("review_session_a"), sessionItem("review_session_b")],
      },
    };
    spyCoordinatorEndpoints({ runtimeStatus });
    const store = new CoordinatorStatusStore(idleFetchers({ runtimeStatus }), { isHidden: () => true });
    const testStore = store as unknown as {
      publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void;
    };
    testStore.publish("runtimeStatus", {
      data: runtimeStatus,
      state: "live",
      httpStatus: 200,
      message: null,
      lastUpdatedAt: Date.now(),
    });

    let api: ReturnType<typeof useViewportSlot> = null;
    function Probe() {
      api = useViewportSlot();
      return <span data-testid="active-session-probe">{api?.activeSessionId}</span>;
    }

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ConsoleDataContext.Provider value={store}>
          <ViewportSlotProvider><Probe /><WorkspaceViewportHost /></ViewportSlotProvider>
        </ConsoleDataContext.Provider>,
      );
    });
    await act(async () => {
      api!.publish({
        mode: "a1-inline",
        handoff: {
          source: "a1",
          sessionId: "review_session_a",
          ruleRunId: null,
          ifcGuid: null,
          usdPrimPath: null,
          ruleCode: null,
          severity: null,
          label: null,
          expectedStageUrl: null,
          mappingInformationStatus: null,
          mappingIssueCode: null,
          mappingIssueCount: null,
        },
      });
    });
    await flush();

    const input = container.querySelector('[data-testid="a1-inline-session-input"]') as HTMLInputElement;
    expect(input.value).toBe("review_session_a");
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "review_session_b");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    expect(api!.activeSessionId).toBe("review_session_b");
    expect(container.querySelector('[data-testid="active-session-probe"]')?.textContent).toBe("review_session_b");
    expect(input.value).toBe("review_session_b");
    expect(api!.publication?.handoff.sessionId).toBe("review_session_a");
    store.dispose();
  });

  it("live：切 dock（#a2→#a3）host 同一節點不重建（mount token 不變）", async () => {
    spyCoordinatorEndpoints();
    await mountAt("#a2");
    await flush(10);
    const before = container.querySelector('[data-uc="viewport"]')?.getAttribute("data-mount-token");
    expect(before).toBeTruthy();
    await act(async () => { window.location.hash = "#a3"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await flush(10);
    const after = container.querySelector('[data-uc="viewport"]')?.getAttribute("data-mount-token");
    expect(after).toBe(before);
    expect(container.querySelector('[data-uc="live-module-a3"]')).not.toBeNull();
  });

  it("離開 workspace（#a1→#home）host unmount", async () => {
    spyCoordinatorEndpoints();
    await mountAt("#a1");
    await flush(10);
    expect(container.querySelector('[data-uc="viewport"]')).not.toBeNull();
    await act(async () => { window.location.hash = "#home"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    await flush(10);
    expect(container.querySelector('[data-uc="viewport"]')).toBeNull();
  });

  it("工具列按鈕存在，且無 session 時為 disabled 狀態", async () => {
    spyCoordinatorEndpointsOffline();
    await mountAt("#a1");
    const toolbar = container.querySelector('[data-uc="ws-viewport-toolbar"]');
    expect(toolbar).not.toBeNull();
    const camBtn = container.querySelector('[data-testid="ws-toolbar-camera-view"]') as HTMLButtonElement | null;
    const fsBtn = container.querySelector('[data-testid="ws-toolbar-fullscreen"]') as HTMLButtonElement | null;
    const projBtn = container.querySelector('[data-testid="ws-toolbar-projection"]') as HTMLButtonElement | null;
    const resetBtn = container.querySelector('[data-testid="ws-toolbar-reset"]') as HTMLButtonElement | null;
    expect(camBtn).not.toBeNull();
    expect(fsBtn).not.toBeNull();
    expect(projBtn).not.toBeNull();
    expect(resetBtn).not.toBeNull();
    expect(camBtn?.disabled).toBe(true);
    expect(fsBtn?.disabled).toBe(true);
    expect(projBtn?.disabled).toBe(true);
    expect(resetBtn?.disabled).toBe(true);
  });

  it("runtime/status 由 live 轉 offline 時清除 gate 與 Stage 樹", async () => {
    const fetchers = idleFetchers();
    const store = new CoordinatorStatusStore(fetchers, { isHidden: () => true });
    const testStore = store as unknown as {
      publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void;
    };
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }

    root = createRoot(container);
    testStore.publish("runtimeStatus", {
      data: RT_IDLE,
      state: "live",
      httpStatus: 200,
      message: null,
      lastUpdatedAt: Date.now(),
    });
    act(() => {
      root!.render(
        <ConsoleDataContext.Provider value={store}>
          <ViewportSlotProvider><Grab /><WorkspaceViewportHost /></ViewportSlotProvider>
        </ConsoleDataContext.Provider>,
      );
    });
    expect(container.querySelector('[data-uc="viewport"]')).not.toBeNull();

    act(() => {
      api!.setStageTree([{ path: "/World/Root", name: "Root" }]);
      api!.setGate({ canSend: true, reason: "" });
    });
    expect(api!.stageTree).toHaveLength(1);
    expect(api!.gate?.canSend).toBe(true);

    act(() => {
      testStore.publish("runtimeStatus", {
        data: RT_IDLE,
        state: "offline",
        httpStatus: 503,
        message: "runtime unavailable",
        lastUpdatedAt: Date.now(),
      });
    });

    expect(container.querySelector('[data-uc="viewport"]')).toBeNull();
    expect(api!.gate).toBeNull();
    expect(api!.stageTree).toEqual([]);
    store.dispose();
  });
});
describe("classifyViewerPhase（只分類 pane 回報的 reason，不另造判定）", () => {
  it("無 session → no-session；有 session 無 gate → session-selected", () => {
    expect(classifyViewerPhase("", null)).toBe("no-session");
    expect(classifyViewerPhase("review_session_x", null)).toBe("session-selected");
  });
  it("canSend → ready；reason 依 pane 文案分類（zh／en）", () => {
    expect(classifyViewerPhase("s", { canSend: true, reason: "" })).toBe("ready");
    expect(classifyViewerPhase("s", { canSend: false, reason: "需先手動啟動 / attach Kit session" })).toBe("lease-pending");
    expect(classifyViewerPhase("s", { canSend: false, reason: "manually start / attach the Kit session first" })).toBe("lease-pending");
    expect(classifyViewerPhase("s", { canSend: false, reason: "等待 3D 第一幀" })).toBe("waiting-first-frame");
    expect(classifyViewerPhase("s", { canSend: false, reason: "waiting for viewer DataChannel" })).toBe("waiting-datachannel");
    expect(classifyViewerPhase("s", { canSend: false, reason: "stage 未對齊，禁止誤標" })).toBe("stage-mismatch");
    expect(classifyViewerPhase("s", {
      canSend: false,
      reason: "mapping_reachable=false: derived_artifact_unreachable",
      canSendViewerCommand: true,
      viewerCommandReason: "",
    })).toBe("ready");
  });
});
describe("ViewportSlotProvider", () => {
  it("publish 帶非空 session 即播種 activeSessionId；離場不清空", async () => {
    const seen: string[] = [];
    function Probe() {
      const slot = useViewportSlot();
      seen.push(slot?.activeSessionId ?? "<none>");
      return null;
    }
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(<ViewportSlotProvider><Grab /><Probe /></ViewportSlotProvider>); });
    expect(seen[seen.length - 1]).toBe("");
    await act(async () => {
      api!.publish({ mode: "a1-inline", handoff: { source: "a1", sessionId: " review_session_p ", ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null, expectedStageUrl: null, mappingInformationStatus: null, mappingIssueCode: null, mappingIssueCount: null } });
    });
    expect(seen[seen.length - 1]).toBe("review_session_p");
    await act(async () => { api!.publish(null); });
    expect(seen[seen.length - 1]).toBe("review_session_p");
    await act(async () => { root.unmount(); });
  });

  it("支援 stageTree 與 host actions 轉發（requestStageTree / selectPrim / sendToolbarAction）", async () => {
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(<ViewportSlotProvider><Grab /></ViewportSlotProvider>); });

    expect(api!.stageTree).toEqual([]);

    await act(async () => {
      api!.setStageTree([{ path: "/World/Root", name: "Root", children: [] }]);
    });
    expect(api!.stageTree).toEqual([{ path: "/World/Root", name: "Root", children: [] }]);

    await act(async () => {
      // Window.tsx 對 nested response 下傳的是已合併完成的完整 root tree。
      api!.setStageTree([{
        path: "/World/Root",
        name: "Root",
        children: [{ path: "/World/Root/Child", name: "Child" }],
      }]);
    });
    expect(api!.stageTree).toEqual([{
      path: "/World/Root",
      name: "Root",
      children: [{ path: "/World/Root/Child", name: "Child" }],
    }]);

    const calls: string[] = [];
    api!.registerHostActions?.({
      requestStageTree: (p) => calls.push(`req:${p}`),
      selectPrim: (p, m) => calls.push(`sel:${p}:${m}`),
      sendToolbarAction: (a, c) => calls.push(`act:${a}:${c}`),
    });

    api!.requestStageTree("/World/Root");
    api!.selectPrim("/World/Root/Child", true);
    api!.sendToolbarAction("camera_view", "top");

    expect(calls).toEqual([
      "req:/World/Root",
      "sel:/World/Root/Child:true",
      "act:camera_view:top",
    ]);

    await act(async () => { root.unmount(); });
  });

  it("切換 active session 時清除上一個 session 的 gate 與 Stage 樹", async () => {
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(<ViewportSlotProvider><Grab /></ViewportSlotProvider>); });
    await act(async () => {
      api!.setActiveSessionId("review_session_a");
      api!.setStageTree([{ path: "/World/A", name: "A" }]);
      api!.setGate({ canSend: true, reason: "" });
    });
    expect(api!.stageTree).toHaveLength(1);
    expect(api!.gate?.canSend).toBe(true);

    await act(async () => { api!.setGate({ canSend: false, reason: "DataChannel disconnected" }); });
    expect(api!.stageTree).toEqual([]);

    await act(async () => {
      api!.setStageTree([{ path: "/World/A", name: "A" }]);
      api!.setGate({ canSend: true, reason: "" });
    });

    await act(async () => { api!.setActiveSessionId("review_session_b"); });
    expect(api!.stageTree).toEqual([]);
    expect(api!.gate).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("mapping 不可達只封鎖 highlight，仍保留可用的 Stage 樹", async () => {
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(<ViewportSlotProvider><Grab /></ViewportSlotProvider>); });
    await act(async () => {
      api!.setStageTree([{ path: "/World/Root", name: "Root" }]);
      api!.setGate({
        canSend: false,
        reason: "mapping_reachable=false: derived_artifact_unreachable",
        canSendViewerCommand: true,
        viewerCommandReason: "",
      });
    });

    expect(api!.gate?.canSend).toBe(false);
    expect(api!.gate?.canSendViewerCommand).toBe(true);
    expect(api!.stageTree).toEqual([{ path: "/World/Root", name: "Root" }]);
    await act(async () => { root.unmount(); });
  });
});
describe("WorkspacePage 實機整合（Toolbar 遮蔽修復）", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let previousHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    previousHash = window.location.hash;
    coordinatorStatusStore.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
    window.location.hash = previousHash;
    vi.restoreAllMocks();
  });

  async function mountAt(hash: string) {
    window.location.hash = hash;
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    await flush(10);
  }

  it("工具列與容器 slot 分離，工具列具備 zIndex: 10 且不被 slot 覆蓋", async () => {
    spyCoordinatorEndpointsOffline();
    await mountAt("#a1");
    const toolbar = container.querySelector('[data-uc="ws-viewport-toolbar"]') as HTMLElement;
    const viewportSlot = container.querySelector('[data-uc="ws-viewport-slot"]') as HTMLElement;
    const viewportContainer = container.querySelector('[data-uc="ws-viewport-container"]') as HTMLElement;

    expect(toolbar).not.toBeNull();
    expect(viewportSlot).not.toBeNull();
    expect(viewportContainer).not.toBeNull();

    // 工具列與容器皆位於 slot 內，且容器在工具列下方
    expect(viewportSlot.contains(toolbar)).toBe(true);
    expect(viewportSlot.contains(viewportContainer)).toBe(true);
    expect(viewportContainer.contains(toolbar)).toBe(false);

    // 工具列 style 具備 position: relative 與 zIndex: 10
    expect(toolbar.style.zIndex).toBe("10");
  });

  it("mapping 不可達時 Stage tree 與 reset 仍依 viewer-command gate 啟用", async () => {
    spyCoordinatorEndpointsOffline();
    let api: ReturnType<typeof useViewportSlot> = null;
    function Grab() { api = useViewportSlot(); return null; }
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ViewportSlotProvider>
          <Grab />
          <WorkspacePage initialDock="a1" />
        </ViewportSlotProvider>,
      );
    });
    await flush();

    await act(async () => {
      api!.setActiveSessionId("review_session_mapping_stale");
      api!.setStageTree([{ path: "/World/Root", name: "Root" }]);
      api!.setGate({
        canSend: false,
        reason: "mapping_reachable=false: derived_artifact_unreachable",
        canSendViewerCommand: true,
        viewerCommandReason: "",
      });
    });

    expect(container.querySelector('[data-uc="ws-stage-tree"]')?.getAttribute("data-state")).toBe("active");
    expect((container.querySelector('[data-testid="ws-request-stage-tree-btn"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[data-testid="ws-toolbar-reset"]') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      api!.setGate({
        canSend: false,
        reason: "mapping_reachable=false: derived_artifact_unreachable",
        canSendViewerCommand: false,
        viewerCommandReason: "等待 3D 第一幀",
      });
    });
    expect(container.querySelector('[data-uc="ws-flow-guide"]')?.getAttribute("data-phase")).toBe("waiting-first-frame");
    const threeDStep = container.querySelector('[data-uc="ws-flow-step-3d"]')?.textContent ?? "";
    expect(threeDStep).toContain("等待 3D 第一幀");
    expect(threeDStep).not.toContain("mapping_reachable=false");
  });
});
