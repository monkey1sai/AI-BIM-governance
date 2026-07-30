// VG-01：viewer 端（Window.tsx）parent postMessage 的「元件 / 整合」層測試，與純函式守衛測（windowParentMessage.test.ts）互補。
// 這裡實際建構真 App 元件、跑真 render() / 真 _handleParentMessage，鎖三件 spec 行為（純函式測無法覆蓋的整合面）：
//   1) S3 render：嵌入時 GovernanceOverlay 收到空 failedElements + 顯示 viewer-embedded-list-collapsed 提示（§2.3 雙清單收合）。
//   2) M2 整合：_handleParentMessage 內 shouldAcceptParentMessage → deriveOverlayInputs → canHandleHighlight 串起來，
//      canOperate=false 時 highlight 靜默丟棄（不呼 _overlayHighlight、不回 highlight_result）；canOperate=true 才走既有路徑。
//   3) M5 degraded：document.referrer 為空時 _postToParent / viewer_ready 靜默丟棄（by design，不崩潰、不對 "*" 廣播）。
//      ⚠ 此為 spec §M5 明文接受的已知風險（「不新增 env var / 不新增 origin 注入機制 / 複用 document.referrer 交叉驗」）；
//        本測 not observed 任何 fallback——只鎖「空 referrer 時安全降級且不崩潰」，避免被誤改成 spec 禁止的注入機制。
//
// 建構策略：用 `new App(props)` 直接拿真實例，只跑 render() / 實例方法，不觸發 componentDidMount 的 fetchUSDAssets /
// _bootstrapReview 網路副作用（jsdom 無對應後端，亦守誠實鐵律不接 mock 後端）。state 以實例 state 物件覆寫需要的欄位。
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppStream from "../AppStream";
import App from "../Window";
import { reviewEnv } from "../config/env";
import { getLang, setLang } from "./i18n";

const PARENT_ORIGIN = "http://127.0.0.1:8004"; // console（coordinator）origin；複用 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單。
const DATA_CHANNEL_TRACE_ID = "ifcready_window_parent_message";
const initialLang = getLang();

type AppInternals = {
  state: Record<string, unknown>;
  _handleParentMessage: (e: MessageEvent) => void;
  _handleCustomEvent: (event: { event_type?: string; messageRecipient?: string; data?: string; payload?: unknown } | null) => void;
  _overlayHighlight: (f: unknown) => unknown;
  _overlayHighlightMany: (f: unknown[]) => unknown;
  _postToParent: (m: Record<string, unknown>, allowedOriginsCache?: ReadonlySet<string>) => void;
  _sendStreamMessage: (m: { event_type: string; payload?: unknown }) => void;
  _runtimeMutatorBlockReason: (eventType: string) => string | null;
  _appendReviewEvent: (event: string) => void;
  _appendDemoOutgoing: (label: string, payload: unknown) => void;
  _appendDemoIncoming: (label: string, payload: unknown) => void;
  _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string) => void;
  _completeStageLoadFromVisibleStream: () => boolean;
  _resyncStageBindingProof: () => Promise<boolean>;
  _finishStageLoad: () => void;
  _hasRemoteVideoFrame: () => boolean;
  _applyBinding: (selection: Array<{
    artifact_id: string;
    model_version_id: string;
    usdc_url?: string;
    role: "primary" | "secondary";
    load_order: number;
    ready: boolean;
  }>, revisionId: string) => void;
  _firstFramePosted: boolean;
  pendingStageUrl: string | null;
  _mappingCache: { primPathForGuid: (g: string) => string | null; guidForPrimPathOrAncestor?: (p: string) => string | null } | null;
  _reverseLookupGuid: (path: string) => void;
  _onSelectUSDPrims: (prims: Set<{ path: string; name: string }>) => void;
  _onStageReset: () => void;
  _openSelectedAsset: () => void;
  _canOpenSelectedAsset: () => boolean;
  _heartbeatStandaloneViewerLease: (sessionId: string, lease: {
    lease_id: string;
    lease_token: string;
    role: "primary";
    expires_at: string;
    heartbeat_after_ms: number;
  }) => Promise<void>;
  _dropStandaloneViewerLease: (reason?: string) => void;
  standaloneViewerLease: {
    lease_id: string;
    lease_token: string;
    role: "primary";
    expires_at: string;
    heartbeat_after_ms: number;
  } | null;
  verifiedDataChannelAuthority: {
    sessionId: string;
    traceId: string;
    connectionGeneration: number;
  } | null;
  reviewSocketEpoch: number;
  componentMounted: boolean;
  deferredOpenStageId: number | null;
  render: () => React.ReactElement;
};
const internals = (app: App): AppInternals => app as unknown as AppInternals;

function setEmbedded(referrer: string): { postMessage: ReturnType<typeof vi.fn> } {
  const parent = { postMessage: vi.fn() };
  // 嵌入：window.parent !== window；parent origin 由 document.referrer parse（M5）。
  Object.defineProperty(window, "parent", { value: parent as unknown as Window, configurable: true });
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  return parent;
}

function highlightMessage(items: Array<Record<string, unknown>>): MessageEvent {
  return new MessageEvent("message", { data: { protocol: "vg01", type: "highlight", items }, origin: PARENT_ORIGIN });
}

function clearMessage(): MessageEvent {
  return new MessageEvent("message", { data: { protocol: "vg01", type: "clear" }, origin: PARENT_ORIGIN });
}

function focusMessage(ifc_guid: string): MessageEvent {
  return new MessageEvent("message", { data: { protocol: "vg01", type: "focus", ifc_guid }, origin: PARENT_ORIGIN });
}

function operableApp(): App {
  window.history.replaceState({}, "", `/?session=review_session_x&trace_id=${DATA_CHANNEL_TRACE_ID}`);
  const app = new App({} as never);
  const target = internals(app);
  target.verifiedDataChannelAuthority = {
    sessionId: "review_session_x",
    traceId: DATA_CHANNEL_TRACE_ID,
    connectionGeneration: target.reviewSocketEpoch,
  };
  target.state = {
    ...target.state,
    viewerTab: "issues",
    reviewSessionId: "review_session_x",
    reviewLifecycleStatus: "active",
    latestStreamConfig: {
      session_id: "review_session_x",
      trace_id: DATA_CHANNEL_TRACE_ID,
      lifecycle_status: "active",
      source: "local_fixed",
      webrtc: {
        signalingServer: "127.0.0.1",
        signalingPort: 49100,
        mediaServer: "127.0.0.1",
        mediaPort: null,
      },
      model: {
        status: "ready",
        artifact_id: null,
        url: null,
        mapping_url: null,
        conversion_job_id: null,
      },
      artifacts: [],
      artifact_bindings: [],
      kit_instance_bindings: [],
    },
  };
  const handleCustomEvent = target._handleCustomEvent.bind(app);
  target._handleCustomEvent = (event) => handleCustomEvent(event
    ? {
        ...event,
        payload: {
          ...(event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : {}),
          trace_id: DATA_CHANNEL_TRACE_ID,
        },
      }
    : event);
  return app;
}

function postedTypes(parent: { postMessage: ReturnType<typeof vi.fn> }): string[] {
  return parent.postMessage.mock.calls.map((c) => (c[0] as { type?: string }).type ?? "");
}

function useSynchronousSetState(app: App): void {
  vi.spyOn(app, "setState").mockImplementation((update: unknown, callback?: () => void) => {
    const patch = typeof update === "function"
      ? (update as (state: Record<string, unknown>) => Record<string, unknown>)(internals(app).state)
      : update;
    if (patch && typeof patch === "object") {
      internals(app).state = { ...internals(app).state, ...(patch as Record<string, unknown>) };
    }
    callback?.();
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  reviewEnv.viewerLeaseToken = "";
  reviewEnv.sourceClientId = "dev_user_001";
  reviewEnv.userToken = "";
  setLang(initialLang);
});

describe("S3 render：嵌入時失敗清單收合於 console（viewer 僅作高亮引擎）", () => {
  const failed = [
    { ifc_guid: "GUID-AAA", severity: "error", rule_code: "R-01" },
    { ifc_guid: "GUID-BBB", severity: "warning", rule_code: "R-02" },
  ];

  function renderOverlayBranch(): string {
    // render 分支守衛（Window.tsx:2321）：viewerTab==="issues" && reviewSessionId → 渲染 GovernanceOverlay 區塊。
    const app = new App({} as never);
    internals(app).state = {
      ...internals(app).state,
      viewerTab: "issues",
      reviewSessionId: "review_session_x",
      reviewLifecycleStatus: "active",
      govFailedElements: failed,
    };
    return renderToString(internals(app).render());
  }

  it("嵌入（window.parent !== window）→ 顯示 viewer-embedded-list-collapsed 提示，且 GovernanceOverlay 不再列出失敗列", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const html = renderOverlayBranch();
    // 提示出現（誠實標註：空清單非「真的無失敗」，而是由 parent 工作台顯示）。
    expect(html).toContain('data-testid="viewer-embedded-list-collapsed"');
    // failedElements 被 failedElementsForEmbed 收斂為空 → overlay 落入「目前無治理失敗構件」分支、無 gov-failed-row、無 GUID。
    expect(html).toContain("目前無治理失敗構件");
    expect(html).not.toContain('data-testid="gov-failed-row"');
    expect(html).not.toContain("GUID-AAA");
    expect(html).not.toContain("GUID-BBB");
  });

  it("非嵌入（window.parent === window）→ 不顯示收合提示，GovernanceOverlay 照舊列出失敗列（單機行為零變更）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    const html = renderOverlayBranch();
    expect(html).not.toContain('data-testid="viewer-embedded-list-collapsed"');
    expect(html).toContain('data-testid="gov-failed-row"');
    expect(html).toContain("GUID-AAA");
    expect(html).toContain("GUID-BBB");
  });
});

describe("M2 整合：_handleParentMessage highlight 受 canOperate 守衛（spectator / 未就緒靜默丟棄）", () => {
  it("canOperate=false（未就緒：無 issues 分頁 / 無串流）→ highlight 靜默丟棄，不呼 _overlayHighlight、不回 highlight_result", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never); // 預設 state：viewerTab="model"、無 reviewSessionId、無串流 → streamReady=false → canOperate=false
    const overlaySpy = vi.spyOn(internals(app), "_overlayHighlight");
    internals(app)._handleParentMessage(highlightMessage([{ ifc_guid: "GUID-AAA", severity: "error" }]));
    expect(overlaySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");
  });

  it("canOperate=true（issues 分頁 + session + lifecycle active）→ 走既有路徑：呼 _overlayHighlight 並逐筆回 highlight_result", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    internals(app).state = {
      ...internals(app).state,
      viewerTab: "issues",
      reviewSessionId: "review_session_x",
      reviewLifecycleStatus: "active",
    };
    // 不接真 Kit：_overlayHighlight 回 unmapped（誠實——無 MappingCache 本就回 unmapped），僅驗整合鏈有呼到 + 有回報。
    const overlaySpy = vi
      .spyOn(internals(app), "_overlayHighlight")
      .mockReturnValue({ ok: false, reason: "unmapped" });
    internals(app)._handleParentMessage(highlightMessage([{ ifc_guid: "GUID-AAA", severity: "error" }]));
    expect(overlaySpy).toHaveBeenCalledTimes(1);
    const highlightResults = parent.postMessage.mock.calls
      .map((c) => c[0] as { type?: string; ok?: boolean; reason?: string })
      .filter((p) => p.type === "highlight_result");
    expect(highlightResults).toHaveLength(1);
    expect(highlightResults[0]).toMatchObject({ ok: false, reason: "unmapped" });
  });

  it("origin 不在白名單 → 整則丟棄（不呼 _overlayHighlight）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    internals(app).state = {
      ...internals(app).state,
      viewerTab: "issues",
      reviewSessionId: "review_session_x",
      reviewLifecycleStatus: "active",
    };
    const overlaySpy = vi.spyOn(internals(app), "_overlayHighlight");
    const evilEvent = new MessageEvent("message", {
      data: { protocol: "vg01", type: "highlight", items: [{ ifc_guid: "GUID-AAA", severity: "error" }] },
      origin: "http://evil.example",
    });
    internals(app)._handleParentMessage(evilEvent);
    expect(overlaySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");
  });
});

describe("M5 degraded：document.referrer 為空時 _postToParent 安全降級（spec 明文接受的已知風險）", () => {
  it("referrer 為空 → viewer_ready 不送出、不崩潰（not observed 任何 fallback；不對 \"*\" 廣播）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(""); // 模擬 Referrer-Policy 抑制 referrer 的降級情境
    const app = new App({} as never);
    expect(() => internals(app)._postToParent({ type: "viewer_ready" })).not.toThrow();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("referrer 存在且在白名單 → viewer_ready 正常送出（帶 protocol:vg01，targetOrigin 非 \"*\"）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    internals(app)._postToParent({ type: "viewer_ready" });
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ protocol: "vg01", type: "viewer_ready" });
    expect(parent.postMessage.mock.calls[0][1]).toBe(PARENT_ORIGIN); // targetOrigin 非 "*"
  });
});

describe("Important #1：_handleParentMessage 的 clear / focus 也受 canOperate / spectator 守衛（§2.2 共同要求，非僅 highlight）", () => {
  it("canOperate=false（未就緒：無 issues 分頁 / 無串流）→ clear 靜默丟棄，不呼 _sendStreamMessage", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never); // 預設 state：未就緒 → canOperate=false
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage");
    internals(app)._handleParentMessage(clearMessage());
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("spectator（view-only）→ clear 靜默丟棄，不送 clearHighlightRequest（誠實鐵律：spectator 不送 mutating）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const stubGet = vi.spyOn(URLSearchParams.prototype, "get").mockImplementation((k: string) => (k === "streamRole" ? "spectator" : null));
    const app = operableApp(); // issues + session + active，但 spectator 應壓過
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage");
    internals(app)._handleParentMessage(clearMessage());
    expect(sendSpy).not.toHaveBeenCalled();
    stubGet.mockRestore();
  });

  it("spectator（view-only）→ focus 靜默丟棄，不送 focusPrimRequest", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const stubGet = vi.spyOn(URLSearchParams.prototype, "get").mockImplementation((k: string) => (k === "streamRole" ? "spectator" : null));
    const app = operableApp();
    internals(app)._mappingCache = { primPathForGuid: () => "/World/G_x" }; // 確保不是因為缺對映才不送
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage");
    internals(app)._handleParentMessage(focusMessage("GUID-AAA"));
    expect(sendSpy).not.toHaveBeenCalled();
    stubGet.mockRestore();
  });

  it("canOperate=true（primary + issues + session + active）→ clear 走既有路徑送 clearHighlightRequest", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => {});
    internals(app)._handleParentMessage(clearMessage());
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({ event_type: "clearHighlightRequest" });
  });

  it("canOperate=true → focus 解析到 primPath 後送 focusPrimRequest", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    internals(app)._mappingCache = { primPathForGuid: (g: string) => (g === "GUID-AAA" ? "/World/G_AAA" : null) };
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => {});
    internals(app)._handleParentMessage(focusMessage("GUID-AAA"));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({ event_type: "focusPrimRequest" });
  });
});

describe("C M4 runtime command bridge：central send path classifies UI-local/read-only vs mutators", () => {
  const runtimeMutators = [
    "openStageRequest",
    "loadArtifactGroupRequest",
    "composeStageRequest",
    "highlightPrimsRequest",
    "focusPrimRequest",
    "clearHighlightRequest",
    "selectPrimsRequest",
    "makePrimsPickable",
    "resetStage",
  ];

  it("spectator direct mutator bypass attempts are rejected before AppStream.sendMessage", () => {
    const stubGet = vi.spyOn(URLSearchParams.prototype, "get").mockImplementation((k: string) => (k === "streamRole" ? "spectator" : null));
    const app = operableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    for (const eventType of runtimeMutators) {
      internals(app)._sendStreamMessage({ event_type: eventType, payload: {} });
    }

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledTimes(runtimeMutators.length);
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("spectator view-only"));
    stubGet.mockRestore();
  });

  it("spectator read-only loadingStateQuery remains allowed", () => {
    const stubGet = vi.spyOn(URLSearchParams.prototype, "get").mockImplementation((k: string) => (k === "streamRole" ? "spectator" : null));
    const app = operableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} });

    expect(sendSpy).toHaveBeenCalledWith({
      event_type: "loadingStateQuery",
      payload: {
        session_id: "review_session_x",
        trace_id: DATA_CHANNEL_TRACE_ID,
      },
    });
    stubGet.mockRestore();
  });

  it("primary mutator without viewer lease token is rejected before AppStream.sendMessage", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "";
    const app = operableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/G_AAA" } });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("primary mutator is sent with runtime authority payload", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/G_AAA" } });

    expect(sendSpy).toHaveBeenCalledWith({
      event_type: "focusPrimRequest",
      payload: expect.objectContaining({
        prim_path: "/World/G_AAA",
        role: "primary",
        source_client_id: "viewer_lease_primary",
        viewer_lease_token: "lease_token_primary",
        session_id: "review_session_x",
        trace_id: DATA_CHANNEL_TRACE_ID,
      }),
    });
  });

  it("每個 runtime mutator attempt 自動取得不同 request_id，caller 明示的 correlation 保持不變", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    for (const eventType of runtimeMutators) {
      internals(app)._sendStreamMessage({ event_type: eventType, payload: {} });
    }
    internals(app)._sendStreamMessage({
      event_type: "focusPrimRequest",
      payload: { request_id: "caller_req_001", prim_path: "/World/C" },
    });

    const requestIds = sendSpy.mock.calls.map((call) => (
      (call[0] as { payload: { request_id: string } }).payload.request_id
    ));
    const generatedIds = requestIds.slice(0, runtimeMutators.length);
    expect(generatedIds.every((requestId) => /^cmd_/.test(requestId))).toBe(true);
    expect(new Set(generatedIds).size).toBe(runtimeMutators.length);
    expect(requestIds[runtimeMutators.length]).toBe("caller_req_001");
  });

  it("openedStageResult with binding_revision_id is the production binding apply acknowledgement", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://primary.usdc",
      govBindingApplyState: { status: "applying" },
    };
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_binding_ack_001",
        url: "stage://primary.usdc",
        binding_revision_id: "rev_binding_001",
      },
    });

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_binding_ack_001",
        url: "stage://primary.usdc",
        binding_revision_id: "rev_binding_001",
      },
    });

    expect(internals(app).state.govBindingActiveRevision).toBe("rev_binding_001");
    expect(internals(app).state.govBindingLastGoodRevision).toBe("rev_binding_001");
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applied" });
  });

  it.each([
    ["missing request_id", {}],
    ["unknown request_id", { request_id: "req_unsolicited_001" }],
  ])("openedStageResult with %s cannot mutate stage or binding proof", (_label, correlationPayload) => {
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://primary.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      govBindingActiveRevision: null,
      govBindingLastGoodRevision: null,
      govBindingApplyState: { status: "applying" },
    };
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        url: "stage://primary.usdc",
        binding_revision_id: "rev_unsolicited_001",
        ...correlationPayload,
      },
    });

    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("pending");
    expect(internals(app).state.govBindingActiveRevision).toBeNull();
    expect(internals(app).state.govBindingLastGoodRevision).toBeNull();
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual([]);
  });
});

describe("Automatic pickability follow-up", () => {
  it("empty getChildrenResponse is a no-op and does not send an invalid mutator", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage");

    internals(app)._handleCustomEvent({
      event_type: "getChildrenResponse",
      payload: { prim_path: "/World", children: [] },
    });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(internals(app).state.usdPrims).toEqual([]);
  });
});

describe("Runtime command rejection consumer：visible terminal、changed-unconfirmed block 與 authenticated resync", () => {
  it("authority outage 顯示 persistent aria-live retryable terminal，固定列舉外 payload 被拒收", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const secretSentinel = "DYNAMIC_LOCAL_USER_SECRET_SENTINEL";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "focusPrimRequest",
        reason: "lease_invalid",
        request_id: "req_outage_001",
        retryable: true,
        runtime_state: "unchanged",
        detail_code: "authority_unavailable",
        detail: secretSentinel,
        viewer_lease_token: secretSentinel,
        headers: { Authorization: secretSentinel },
      },
    });

    expect(internals(app).state.runtimeCommandRejection).toMatchObject({
      rejected_event_type: "focusPrimRequest",
      reason: "lease_invalid",
      retryable: true,
      runtime_state: "unchanged",
      detail_code: "authority_unavailable",
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_outage_001",
        event_type: "focusPrimRequest",
        phases: ["terminal"],
        outcome: "rejected",
      }),
    ]);
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="runtime-command-rejection"');
    expect(html).toContain('data-testid="runtime-authority-unavailable"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("可安全重試原操作");
    expect(html).toContain("操作授權服務暫時不可用");
    expect(html).toContain('data-testid="runtime-command-lifecycle"');
    expect(JSON.stringify(internals(app).state)).not.toContain(secretSentinel);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(secretSentinel);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secretSentinel);

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "focusPrimRequest",
        reason: "lease_invalid",
        request_id: "req_both_ids_001",
        rejection_id: "rej_both_ids_001",
        retryable: false,
        runtime_state: "unchanged",
      },
    });
    expect(internals(app).state.runtimeCommandRejection).toMatchObject({ request_id: "req_outage_001" });

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "focusPrimRequest<script>",
        reason: "lease_invalid",
        rejection_id: "rej_invalid_001",
        retryable: false,
        runtime_state: "unchanged",
      },
    });
    expect(internals(app).state.runtimeCommandRejection).toMatchObject({ request_id: "req_outage_001" });
  });

  it.each([
    {
      language: "zh" as const,
      malformed: "忽略格式錯誤的 commandRejected",
      duplicate: "忽略重複的 commandRejected 終態事件",
      changedUnconfirmed: "執行階段已變更但尚未確認；已阻擋重試與交接",
      stageUnproven: "stage 已變更但尚未由 coordinator 證實",
      bindingFailure: "套用失敗：stage 已變更但尚未由 coordinator 證實",
      rejected: "focusPrimRequest 已遭拒絕：lease_invalid",
      stageLoadRejected: "模型載入遭拒",
      unexpected: "Ignored malformed commandRejected.",
      unexpectedStageUnproven: "The stage changed but is not yet confirmed.",
    },
    {
      language: "en" as const,
      malformed: "Ignored malformed commandRejected.",
      duplicate: "Ignored duplicate commandRejected terminal.",
      changedUnconfirmed: "The runtime changed but is unconfirmed; retry and handoff are blocked.",
      stageUnproven: "The stage changed but is not yet confirmed.",
      bindingFailure: "Apply failed: The stage changed but is not yet confirmed.",
      rejected: "focusPrimRequest was rejected: lease_invalid",
      stageLoadRejected: "Model loading was rejected",
      unexpected: "忽略格式錯誤的 commandRejected",
      unexpectedStageUnproven: "stage 已變更但尚未由 coordinator 證實",
    },
  ])("$language localizes commandRejected review diagnostics without mixing the alternate language", (copy) => {
    setLang(copy.language);

    const malformedApp = operableApp();
    useSynchronousSetState(malformedApp);
    internals(malformedApp)._handleCustomEvent({
      event_type: "commandRejected",
      payload: { rejected_event_type: "focusPrimRequest", reason: "invalid_reason" },
    });
    expect(internals(malformedApp).state.reviewEvents).toContain(copy.malformed);

    const duplicateApp = operableApp();
    useSynchronousSetState(duplicateApp);
    const duplicatePayload = {
      rejected_event_type: "focusPrimRequest",
      reason: "lease_invalid",
      request_id: `req_duplicate_${copy.language}`,
      retryable: false,
      runtime_state: "unchanged" as const,
    };
    internals(duplicateApp)._handleCustomEvent({ event_type: "commandRejected", payload: duplicatePayload });
    internals(duplicateApp)._handleCustomEvent({ event_type: "commandRejected", payload: duplicatePayload });
    expect(internals(duplicateApp).state.reviewEvents).toContain(copy.rejected);
    expect(internals(duplicateApp).state.reviewEvents).toContain(copy.duplicate);

    const changedApp = operableApp();
    useSynchronousSetState(changedApp);
    internals(changedApp)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "loadArtifactGroupRequest",
        reason: "lease_invalid",
        rejection_id: `rej_changed_${copy.language}`,
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });
    expect(internals(changedApp).state.reviewEvents).toContain(copy.changedUnconfirmed);
    expect(internals(changedApp).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: copy.stageUnproven,
    });
    const changedHtml = renderToString(internals(changedApp).render());
    expect(changedHtml).toContain(copy.bindingFailure);
    expect(changedHtml).not.toContain(copy.unexpectedStageUnproven);

    const stageLoadApp = operableApp();
    useSynchronousSetState(stageLoadApp);
    internals(stageLoadApp)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        rejection_id: `rej_stage_${copy.language}`,
        retryable: false,
        runtime_state: "unchanged",
      },
    });
    const reviewText = (internals(stageLoadApp).state.reviewEvents as string[]).join("\n");
    expect(reviewText).toContain(copy.stageLoadRejected);
    expect(reviewText).not.toContain(copy.unexpected);
    expect(internals(stageLoadApp).state.loadingText).toBe(copy.stageLoadRejected);
  });

  it.each([
    {
      language: "zh" as const,
      expected: "忽略 commandRejected：被拒絕的事件與請求內容不相符",
      alternate: "Ignored commandRejected: rejected event does not match the request context.",
    },
    {
      language: "en" as const,
      expected: "Ignored commandRejected: rejected event does not match the request context.",
      alternate: "忽略 commandRejected：被拒絕的事件與請求內容不相符",
    },
  ])("$language localizes a tracked request-context mismatch without the alternate language", (copy) => {
    setLang(copy.language);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    internals(app)._sendStreamMessage({
      event_type: "focusPrimRequest",
      payload: { request_id: `req_context_${copy.language}`, prim_path: "/World/Expected" },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: `req_context_${copy.language}`,
        retryable: false,
        runtime_state: "unchanged",
      },
    });

    const reviewText = (internals(app).state.reviewEvents as string[]).join("\n");
    expect(reviewText).toContain(copy.expected);
    expect(reviewText).not.toContain(copy.alternate);
  });

  it("snapshots zh commandRejected review copy before deferred functional updaters run", () => {
    setLang("zh");
    const app = operableApp();
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    const deferredUpdaters: Array<(state: Record<string, unknown>) => Record<string, unknown> | null> = [];
    vi.spyOn(app, "setState").mockImplementation((update: unknown) => {
      if (typeof update === "function") {
        deferredUpdaters.push(update as (state: Record<string, unknown>) => Record<string, unknown> | null);
      }
    });

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "focusPrimRequest",
        reason: "lease_invalid",
        rejection_id: "rej_deferred_generic",
        retryable: false,
        runtime_state: "unchanged",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "loadArtifactGroupRequest",
        reason: "lease_invalid",
        rejection_id: "rej_deferred_changed",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });

    setLang("en");
    for (const update of deferredUpdaters) {
      const patch = update(internals(app).state);
      if (patch) internals(app).state = { ...internals(app).state, ...patch };
    }

    const reviewText = (internals(app).state.reviewEvents as string[]).join("\n");
    expect(reviewText).toContain("focusPrimRequest 已遭拒絕：lease_invalid");
    expect(reviewText).toContain("執行階段已變更但尚未確認；已阻擋重試與交接");
    expect(reviewText).not.toContain("focusPrimRequest was rejected: lease_invalid");
    expect(reviewText).not.toContain("The runtime changed but is unconfirmed; retry and handoff are blocked.");
  });

  const rejectionReasonCases = [
    ["spectator_readonly", "目前為僅檢視模式，無法執行此操作", "This action is unavailable in read-only spectator mode."],
    ["lease_invalid", "檢視者 lease 無效或已過期", "The viewer lease is invalid or has expired."],
    ["session_lifecycle_blocked", "目前 session 狀態不允許此操作", "The current session state does not allow this action."],
    ["unauthorized_source_client", "目前來源無權執行此操作", "The current source is not authorized to perform this action."],
    ["unsupported_command", "目前 runtime 不支援此操作", "The current runtime does not support this action."],
    ["invalid_payload", "操作資料無效，未執行任何變更", "The command data is invalid; no change was performed."],
  ] as const;

  it.each(rejectionReasonCases)("%s renders the complete localized rejection matrix", (reason, zhReason, enReason) => {
    const languageCases = [
      { language: "zh" as const, title: "執行階段命令遭拒絕", expectedReason: zhReason, retry: "可安全重試原操作", noRetry: "請勿盲目重試" },
      { language: "en" as const, title: "Runtime command rejected", expectedReason: enReason, retry: "You can safely retry the original action.", noRetry: "Do not retry blindly." },
    ];

    for (const languageCase of languageCases) {
      for (const retryable of [true, false]) {
        setLang(languageCase.language);
        const app = operableApp();
        internals(app).state = {
          ...internals(app).state,
          runtimeCommandRejection: {
            rejected_event_type: "focusPrimRequest",
            reason,
            request_id: `req_${reason}_${languageCase.language}_${retryable}`,
            retryable,
            runtime_state: "unchanged",
          },
        };

        const html = renderToString(internals(app).render());
        expect(html).toContain('data-testid="runtime-command-rejection"');
        expect(html).toContain('data-testid="runtime-command-rejection-reason-code"');
        expect(html).toContain(languageCase.title);
        expect(html).toContain(languageCase.expectedReason);
        expect(html).toContain(reason);
        expect(html).toContain(retryable ? languageCase.retry : languageCase.noRetry);
      }
    }
  });

  it.each([
    {
      language: "zh" as const,
      authority: "操作授權服務暫時不可用",
      authorityDetail: "請稍後重新執行原操作，系統不會重播舊 transaction。",
      stage: "stage 已變更但尚未由 coordinator 證實",
      stageDetail: "handoff 已阻擋。",
      resync: "重新同步 stage proof",
      noRetry: "請勿盲目重試",
      leaseInvalid: "檢視者 lease 無效或已過期",
    },
    {
      language: "en" as const,
      authority: "The operation authority service is temporarily unavailable.",
      authorityDetail: "Retry the original action later; the system will not replay an old transaction.",
      stage: "The stage changed but is not yet confirmed.",
      stageDetail: "Handoff is blocked.",
      resync: "Resync stage proof",
      noRetry: "Do not retry blindly.",
      leaseInvalid: "The viewer lease is invalid or has expired.",
    },
  ])("$language prioritizes authority outage and stage-unproven copy", (copy) => {
    setLang(copy.language);
    const app = operableApp();
    internals(app).state = {
      ...internals(app).state,
      runtimeCommandRejection: {
        rejected_event_type: "focusPrimRequest",
        reason: "lease_invalid",
        request_id: `req_outage_${copy.language}`,
        retryable: true,
        runtime_state: "unchanged",
        detail_code: "authority_unavailable",
      },
    };

    let html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="runtime-authority-unavailable"');
    expect(html).toContain(copy.authority);
    expect(html).toContain(copy.authorityDetail);
    expect(html).not.toContain(copy.leaseInvalid);

    internals(app).state = {
      ...internals(app).state,
      runtimeCommandRejection: {
        rejected_event_type: "loadArtifactGroupRequest",
        reason: "lease_invalid",
        request_id: `req_outage_changed_${copy.language}`,
        retryable: true,
        runtime_state: "changed_unconfirmed",
        detail_code: "authority_unavailable",
      },
    };
    html = renderToString(internals(app).render());
    expect(html).toContain(copy.authority);
    expect(html).toContain(copy.authorityDetail);
    expect(html).toContain(copy.stage);
    expect(html).toContain(copy.stageDetail);
    expect(html).toContain(copy.resync);
    expect(html).toContain('data-testid="runtime-command-rejection-stage-unproven"');
    expect(html).toContain('data-testid="runtime-command-resync"');
    expect(html).toContain(copy.noRetry);

    internals(app).state = {
      ...internals(app).state,
      runtimeCommandRejection: {
        rejected_event_type: "loadArtifactGroupRequest",
        reason: "lease_invalid",
        request_id: `req_changed_${copy.language}`,
        retryable: true,
        runtime_state: "changed_unconfirmed",
      },
    };
    html = renderToString(internals(app).render());
    expect(html).toContain(copy.stage);
    expect(html).toContain(copy.stageDetail);
    expect(html).toContain(copy.resync);
    expect(html).toContain('data-testid="runtime-command-resync"');
    expect(html).toContain(copy.noRetry);
  });

  it("accepted 是 executing 非 terminal；bindingApplied 才完成 lifecycle", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    internals(app)._sendStreamMessage({
      event_type: "composeStageRequest",
      payload: {
        request_id: "req_lifecycle_001",
        binding_revision_id: "rev_lifecycle_001",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "accepted",
        request_id: "req_lifecycle_001",
        binding_revision_id: "rev_lifecycle_001",
      },
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_lifecycle_001",
        phases: ["pending", "executing"],
      }),
    ]);

    internals(app)._handleCustomEvent({
      event_type: "bindingApplied",
      payload: {
        request_id: "req_lifecycle_001",
        binding_revision_id: "rev_lifecycle_001",
      },
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_lifecycle_001",
        event_type: "composeStageRequest",
        phases: ["pending", "executing", "terminal"],
        outcome: "success",
      }),
    ]);
  });

  it.each([
    ["clearHighlightRequest", "clearHighlightResult"],
    ["selectPrimsRequest", "selectPrimsResult"],
    ["makePrimsPickable", "makePrimsPickableResponse"],
    ["resetStage", "resetStageResponse"],
  ])("%s 只由 correlated %s 收斂為 terminal", (requestEventType, terminalEventType) => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const requestId = `req_${requestEventType}`;

    internals(app)._sendStreamMessage({ event_type: requestEventType, payload: { request_id: requestId } });
    internals(app)._handleCustomEvent({
      event_type: terminalEventType,
      payload: { result: "success", request_id: requestId },
    });

    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: requestId,
        event_type: requestEventType,
        phases: ["pending", "terminal"],
        outcome: "success",
      }),
    ]);
  });

  it("不相符的 terminal event 不得完成另一型 request", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    internals(app)._sendStreamMessage({
      event_type: "clearHighlightRequest",
      payload: { request_id: "req_wrong_terminal_001" },
    });
    internals(app)._handleCustomEvent({
      event_type: "selectPrimsResult",
      payload: { result: "success", request_id: "req_wrong_terminal_001" },
    });

    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_wrong_terminal_001",
        phases: ["pending"],
      }),
    ]);
  });

  it("changed_unconfirmed rejection 是 first terminal；late opened/binding success 不得覆寫", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));

    internals(app)._sendStreamMessage({
      event_type: "composeStageRequest",
      payload: {
        request_id: "req_first_terminal_001",
        binding_revision_id: "rev_first_terminal_001",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "composeStageRequest",
        reason: "lease_invalid",
        request_id: "req_first_terminal_001",
        retryable: true,
        runtime_state: "changed_unconfirmed",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "bindingApplied",
      payload: {
        request_id: "req_first_terminal_001",
        binding_revision_id: "rev_first_terminal_001",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_first_terminal_001",
        binding_revision_id: "rev_first_terminal_001",
        url: "stage://late-success.usdc",
      },
    });

    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_first_terminal_001",
        phases: ["pending", "terminal"],
        outcome: "rejected",
      }),
    ]);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
  });

  it("unchanged rejection 後的同 request late open success 不得套用 stage side effects", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://first-terminal.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "first-terminal", url: "stage://first-terminal.usdc" },
    };
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_rejected_then_open_001", url: "stage://first-terminal.usdc" },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: "req_rejected_then_open_001",
        retryable: false,
        runtime_state: "unchanged",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_rejected_then_open_001",
        url: "stage://first-terminal.usdc",
      },
    });

    expect(internals(app).state.runtimeCommandRejection).toMatchObject({
      request_id: "req_rejected_then_open_001",
    });
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).not.toBe("matched");
  });

  it("open success 後的同 request late changed_unconfirmed rejection 不得重新封鎖", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://success-first.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "success-first", url: "stage://success-first.usdc" },
    };
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_open_then_reject_001",
        binding_revision_id: "rev_success_first_001",
        url: "stage://success-first.usdc",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_open_then_reject_001",
        binding_revision_id: "rev_success_first_001",
        url: "stage://success-first.usdc",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: "req_open_then_reject_001",
        retryable: true,
        runtime_state: "changed_unconfirmed",
      },
    });

    expect(internals(app).state.runtimeCommandRejection).toBeNull();
    expect(internals(app).state.loadedStageUrl).toBe("stage://success-first.usdc");
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    internals(app)._sendStreamMessage({
      event_type: "focusPrimRequest",
      payload: { request_id: "req_after_terminal_001", prim_path: "/World/Allowed" },
    });
    expect(sendSpy.mock.calls.filter(
      ([message]) => (message as { event_type?: string }).event_type === "focusPrimRequest",
    )).toHaveLength(1);
  });

  it("changed_unconfirmed 先阻擋所有 mutator/handoff，只有同 revision authenticated status 才恢復", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://authorized.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "authorized", url: "stage://authorized.usdc" },
    };
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        stage_binding: {
          active_binding_revision: "rev_other",
          last_good_binding_revision: "rev_other",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        stage_binding: {
          active_binding_revision: "rev_other",
          last_good_binding_revision: "rev_other",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        stage_binding: {
          active_binding_revision: "rev_authorized_001",
          last_good_binding_revision: "rev_authorized_001",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_changed_001",
        url: "stage://authorized.usdc",
        binding_revision_id: "rev_authorized_001",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: "req_changed_001",
        retryable: true,
        runtime_state: "changed_unconfirmed",
        detail_code: "authority_unavailable",
      },
    });
    await flushMicrotasks();

    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_changed_001",
        phases: ["pending", "terminal"],
        outcome: "rejected",
      }),
    ]);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(parent.postMessage.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: null,
      status: "unproven",
      binding_revision_id: "rev_authorized_001",
    }));
    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/Blocked" } });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const reviewEvents = internals(app).state.reviewEvents as string[];
    expect(reviewEvents[reviewEvents.length - 1]).toContain("stage binding proof resync required");

    const fetchCountBeforeBlindRetry = fetchSpy.mock.calls.length;
    internals(app)._applyBinding([{
      artifact_id: "artifact_primary",
      model_version_id: "version_001",
      usdc_url: "stage://authorized.usdc",
      role: "primary",
      load_order: 0,
      ready: true,
    }], "client_revision_must_not_be_used");
    internals(app)._openSelectedAsset();
    expect(fetchSpy).toHaveBeenCalledTimes(fetchCountBeforeBlindRetry);

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_late_success_001",
        url: "stage://authorized.usdc",
        binding_revision_id: "rev_authorized_001",
      },
    });
    await flushMicrotasks();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/StillBlocked" } });
    expect(sendSpy).toHaveBeenCalledTimes(1);

    expect(await internals(app)._resyncStageBindingProof()).toBe(false);
    expect(await internals(app)._resyncStageBindingProof()).toBe(true);
    expect(fetchSpy.mock.calls[2][1]).toMatchObject({
      headers: expect.objectContaining({ "X-User-Token": "local_user_token_primary" }),
    });
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.loadedStageUrl).toBe("stage://authorized.usdc");
    expect(internals(app).state.runtimeCommandRejection).toBeNull();
    expect(parent.postMessage.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: "stage://authorized.usdc",
      status: "active",
      binding_revision_id: "rev_authorized_001",
    }));

    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/Allowed" } });
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(internals(app).state)).not.toContain("local_user_token_primary");
    expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("local_user_token_primary");
  });

  it("舊 revision 的延遲 resync 不得解除較新的 changed_unconfirmed gate", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://a.usdc",
      selectedUSDAsset: { name: "a", url: "stage://a.usdc" },
      stageLoadStatus: "pending",
    };
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));

    let resolveFirstA: (response: Response) => void = () => {};
    let resolveSecondA: (response: Response) => void = () => {};
    const firstA = new Promise<Response>((resolve) => { resolveFirstA = resolve; });
    const secondA = new Promise<Response>((resolve) => { resolveSecondA = resolve; });
    const pendingB = new Promise<Response>(() => {});
    const fetchSpy = vi.fn()
      .mockImplementationOnce(() => firstA)
      .mockImplementationOnce(() => secondA)
      .mockImplementationOnce(() => pendingB);
    vi.stubGlobal("fetch", fetchSpy);
    const bindingResponse = (revision: string) => new Response(JSON.stringify({
      stage_binding: {
        active_binding_revision: revision,
        last_good_binding_revision: revision,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const rejectChanged = (requestId: string) => internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: requestId,
        retryable: true,
        runtime_state: "changed_unconfirmed",
        detail_code: "authority_unavailable",
      },
    });

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_a", url: "stage://a.usdc", binding_revision_id: "rev_a" },
    });
    rejectChanged("req_a");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const secondAResync = internals(app)._resyncStageBindingProof();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    resolveSecondA(bindingResponse("rev_a"));
    expect(await secondAResync).toBe(true);

    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://b.usdc",
      selectedUSDAsset: { name: "b", url: "stage://b.usdc" },
      loadedStageUrl: null,
      stageLoadStatus: "pending",
    };
    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_b", url: "stage://b.usdc", binding_revision_id: "rev_b" },
    });
    rejectChanged("req_b");
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    resolveFirstA(bindingResponse("rev_a"));
    await flushMicrotasks();

    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.runtimeCommandRejection).toMatchObject({
      request_id: "req_b",
      binding_revision_id: "rev_b",
    });
    internals(app)._sendStreamMessage({ event_type: "focusPrimRequest", payload: { prim_path: "/World/BlockedByB" } });
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(parent.postMessage.mock.calls.map((call) => call[0])).not.toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: "stage://b.usdc",
      status: "active",
      binding_revision_id: "rev_a",
    }));
  });

  it("前一 revision active 後的新 exact composition partial failure 會清除 proof 並通知 parent unproven", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    useSynchronousSetState(app);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://a.usdc",
      selectedUSDAsset: { name: "a", url: "stage://a.usdc" },
      stageLoadStatus: "pending",
    };
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_a", url: "stage://a.usdc", binding_revision_id: "rev_a" },
    });

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_a",
        url: "stage://a.usdc",
        binding_revision_id: "rev_a",
      },
    });
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.govBindingActiveRevision).toBe("rev_a");

    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://b.usdc",
      selectedUSDAsset: { name: "b", url: "stage://b.usdc" },
      stageLoadStatus: "pending",
      loadedStageUrl: "stage://a.usdc",
    };
    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_b", url: "stage://b.usdc", binding_revision_id: "rev_b" },
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "error",
        request_id: "req_b",
        url: "stage://b.usdc",
        error: "Stage open failed.",
        binding_revision_id: "rev_b",
        runtime_state: "changed_failed",
        partial_load: true,
        failed_bindings: [{ artifact_id: "secondary_b" }],
      },
    });

    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.govBindingActiveRevision).toBeNull();
    expect(internals(app).state.govBindingLastGoodRevision).toBe("rev_a");
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "runtime_changed_transaction_failed",
    });
    expect(parent.postMessage.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: null,
      status: "unproven",
      binding_revision_id: "rev_b",
    }));
  });
});

describe("Late trusted viewer lease recovery", () => {
  it("不同 late token 只替換既有 deferred timer；執行一次後 matched stage 不重開", () => {
    vi.useFakeTimers();
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.viewerLeaseToken = "";
    reviewEnv.userToken = "";
    const app = operableApp();
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "primary", url: "stage://primary.usdc" },
      isKitReady: true,
      stageLoadStatus: "unproven",
    };
    const openSpy = vi.spyOn(internals(app), "_openSelectedAsset").mockImplementation(() => {});
    const tokenMessage = (token: string, userToken: string) => new MessageEvent("message", {
      origin: PARENT_ORIGIN,
      data: { protocol: "vg01", type: "viewer_lease_token", token, user_token: userToken },
    });

    internals(app)._handleParentMessage(tokenMessage("lease_late_a", ""));
    expect(vi.getTimerCount()).toBe(0);
    internals(app)._handleParentMessage(tokenMessage("lease_late_a", "local_user_a"));
    expect(vi.getTimerCount()).toBe(1);
    const firstTimer = internals(app).deferredOpenStageId;
    internals(app)._handleParentMessage(tokenMessage("lease_late_b", "local_user_b"));
    expect(vi.getTimerCount()).toBe(1);
    expect(internals(app).deferredOpenStageId).not.toBe(firstTimer);
    expect(reviewEnv.viewerLeaseToken).toBe("lease_late_b");
    expect(reviewEnv.userToken).toBe("local_user_b");

    vi.runOnlyPendingTimers();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    internals(app).state = { ...internals(app).state, stageLoadStatus: "matched" };
    internals(app)._handleParentMessage(tokenMessage("lease_late_c", "local_user_c"));
    expect(vi.getTimerCount()).toBe(0);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});

// ── task#2 fix：C M4 Task3 兩項 gap 補上「會實際執行」的自動化回歸網 ─────────────────────────────
// Gap1（既有 tree handler 未在「未就緒 / 無 lease」情境下被測）：_onSelectUSDPrims 與 _onStageReset
//   同樣送 runtime mutator（selectPrimsRequest / focusPrimRequest / resetStage），必須與 openStageRequest
//   一樣經同一中央閘門（_runtimeMutatorBlockReason via _sendStreamMessage）：未就緒時「誠實記事件、不送出」
//   （非靜默失效），primary + lease 就緒時才真送出並帶 runtime authority payload（不被閘門誤擋）。
// Gap2（mapping-row 選列＝UI-local 之前僅靠人工讀原始碼）：直接取 Window.render() 真接線的 onSelectGuid
//   （點對構表列 / 語意選取的唯一 Window 端 handler）呼叫之，只更新 govSelectedGuid，不得送任何 runtime
//   mutator；若未來被誤接到 mutator，AppStream.sendMessage 會被呼到而使本測失敗（把行為鎖進回歸網）。
describe("C M4 Task3 gap fix：既有 tree handler 走同一 runtime mutator 閘門 + mapping-row 選列為 UI-local", () => {
  function modelTabApp(): App {
    const app = new App({} as never);
    internals(app).state = {
      ...internals(app).state,
      viewerTab: "model",
      reviewSessionId: "review_session_x",
      reviewLifecycleStatus: "active",
    };
    return app;
  }

  function primSet(...paths: string[]): Set<{ path: string; name: string }> {
    return new Set(paths.map((path) => ({ path, name: path.split("/").pop() ?? path })));
  }

  // 深度優先走 render() 元素樹，回傳第一個帶指定 function prop 的 props（onSelectGuid 唯 MockViewport 有）。
  function findPropHolder(node: unknown, propName: string): Record<string, unknown> | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findPropHolder(child, propName);
        if (found) return found;
      }
      return null;
    }
    if (!node || typeof node !== "object") return null;
    const props = (node as { props?: Record<string, unknown> }).props;
    if (!props) return null;
    if (typeof props[propName] === "function") return props;
    return findPropHolder(props.children, propName);
  }

  it("_onSelectUSDPrims：primary 未取得 viewer lease token → selectPrimsRequest/focusPrimRequest 不送出，且誠實記事件（非靜默）", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = ""; // 未就緒（無 lease token）
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(internals(app), "_reverseLookupGuid").mockImplementation(() => {}); // 反查另有測（見下方 selected_guid 段），此處隔離
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._onSelectUSDPrims(primSet("/World/G_AAA"));

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("_onSelectUSDPrims：primary + lease token 就緒 → 送 selectPrimsRequest 與 focusPrimRequest，皆帶 runtime authority payload（未被閘門誤擋）", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(internals(app), "_reverseLookupGuid").mockImplementation(() => {});
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._onSelectUSDPrims(primSet("/World/G_AAA"));

    const events = sendSpy.mock.calls.map((c) => (c[0] as { event_type: string }).event_type);
    expect(events).toContain("selectPrimsRequest");
    expect(events).toContain("focusPrimRequest");
    for (const call of sendSpy.mock.calls) {
      expect(call[0]).toMatchObject({
        payload: expect.objectContaining({
          role: "primary",
          source_client_id: "viewer_lease_primary",
          viewer_lease_token: "lease_token_primary",
          session_id: "review_session_x",
        }),
      });
    }
  });

  it("_onStageReset：primary 未取得 viewer lease token → selectPrimsRequest([])/resetStage 不送出，且誠實記事件", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "";
    const app = operableApp();
    useSynchronousSetState(app);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._onStageReset();

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("_onStageReset：primary + lease token 就緒 → 送 selectPrimsRequest 與 resetStage，皆帶 runtime authority payload", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._onStageReset();

    const events = sendSpy.mock.calls.map((c) => (c[0] as { event_type: string }).event_type);
    expect(events).toContain("selectPrimsRequest");
    expect(events).toContain("resetStage");
    for (const call of sendSpy.mock.calls) {
      expect(call[0]).toMatchObject({
        payload: expect.objectContaining({
          role: "primary",
          viewer_lease_token: "lease_token_primary",
          session_id: "review_session_x",
        }),
      });
    }
  });

  it("mapping-row 選列（render 真接線的 onSelectGuid）只更新 govSelectedGuid，不送任何 runtime mutator（即使 primary+lease 就緒）", () => {
    // 刻意設成 primary + lease 就緒（此時 mutator 是「可以送」的），以證明「不送」純因 UI-local 分類，非因閘門擋下。
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = modelTabApp();
    useSynchronousSetState(app);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});

    const holder = findPropHolder(internals(app).render(), "onSelectGuid");
    expect(holder).not.toBeNull();
    (holder!.onSelectGuid as (g: string) => void)("GUID-XYZ");

    expect(internals(app).state.govSelectedGuid).toBe("GUID-XYZ");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// ── quality review 補強（task#2 fix）：VG-01 postMessage 橋真穿越 runtime mutator lease 閘門直到 AppStream.sendMessage ──
// 本檔既有「Important #1 clear/focus canOperate」兩測（:267 /:277）用 spyOn(_sendStreamMessage).mockImplementation
// 把整個 _sendStreamMessage 換掉，只斷言「有呼叫 _sendStreamMessage」，從未真正跑到 _runtimeMutatorBlockReason /
// _withRuntimeAuthority——即使 lease 閘門邏輯被改壞（例如條件寫反）仍會綠燈。此處改為直接 spy AppStream.sendMessage，
// 讓 VG-01 embedded 高亮 / 聚焦 / 清除（EmbeddedViewer/ReviewSessionViewerPane 用來實作 A1「在 3D 高亮失敗構件」
// 的核心 postMessage 橋，全走 _handleParentMessage → 同一中央 _sendStreamMessage）真的穿越 lease 閘門：
//   無 lease token → 不呼 AppStream.sendMessage、且誠實記 reviewEvent（"primary viewer lease token required"，非靜默）；
//   有 lease token → 呼 AppStream.sendMessage、payload 帶 runtime authority 欄位（role / source_client_id /
//   viewer_lease_token / session_id）。此即 Window.tsx:_runtimeMutatorBlockReason NOTE 標註「gate 亦刻意覆蓋 VG-01
//   embedded 路徑」的回歸證據；embedded 端實務上由 ReviewSessionViewerPane 先推 viewer_lease_token 再 enable 高亮鈕。
describe("C M4 Task3 gap fix：VG-01 postMessage 橋（highlight/focus/clear）真穿越 lease 閘門至 AppStream.sendMessage", () => {
  function embeddedOperableApp(): App {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp(); // primary + issues + session + active → canOperate=true（見本檔 :267 /:277）
    reviewEnv.sourceClientId = "viewer_lease_primary";
    return app;
  }

  // clear ───────────────────────────────────────────────────────────────────
  it("clear：無 lease token → 不呼 AppStream.sendMessage，且誠實記 reviewEvent（非靜默）", () => {
    reviewEnv.viewerLeaseToken = "";
    const app = embeddedOperableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._handleParentMessage(clearMessage());

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("clear：有 lease token → 呼 AppStream.sendMessage 送 clearHighlightRequest，payload 帶 runtime authority", () => {
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = embeddedOperableApp();
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._handleParentMessage(clearMessage());

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({
      event_type: "clearHighlightRequest",
      payload: expect.objectContaining({
        role: "primary",
        source_client_id: "viewer_lease_primary",
        viewer_lease_token: "lease_token_primary",
        session_id: "review_session_x",
      }),
    });
  });

  // focus ───────────────────────────────────────────────────────────────────
  it("focus：無 lease token → 不呼 AppStream.sendMessage，且誠實記 reviewEvent", () => {
    reviewEnv.viewerLeaseToken = "";
    const app = embeddedOperableApp();
    internals(app)._mappingCache = { primPathForGuid: () => "/World/G_AAA" }; // 排除因缺對映才不送（確保 primPath 解析到）
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._handleParentMessage(focusMessage("GUID-AAA"));

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("focus：有 lease token → 呼 AppStream.sendMessage 送 focusPrimRequest，payload 帶 runtime authority", () => {
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = embeddedOperableApp();
    internals(app)._mappingCache = { primPathForGuid: (g: string) => (g === "GUID-AAA" ? "/World/G_AAA" : null) };
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._handleParentMessage(focusMessage("GUID-AAA"));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({
      event_type: "focusPrimRequest",
      payload: expect.objectContaining({
        prim_path: "/World/G_AAA",
        role: "primary",
        viewer_lease_token: "lease_token_primary",
        session_id: "review_session_x",
      }),
    });
  });

  // highlight（A1 核心路徑：_overlayHighlight → HighlightBridge → _sendStreamMessage）──────────
  it("highlight：無 lease token → 不呼 AppStream.sendMessage，且誠實記 reviewEvent（gate 於 _sendStreamMessage 擋下）", () => {
    reviewEnv.viewerLeaseToken = "";
    const app = embeddedOperableApp();
    internals(app).state = { ...internals(app).state, showStream: true };
    internals(app)._mappingCache = { primPathForGuid: () => "/World/G_AAA" };
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true); // dataChannelReady=true → bridge 會嘗試送，才碰得到 gate
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._handleParentMessage(highlightMessage([{ ifc_guid: "GUID-AAA", severity: "error" }]));

    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("primary viewer lease token required"));
  });

  it("highlight：有 lease token → 呼 AppStream.sendMessage 送 highlightPrimsRequest，payload 帶 runtime authority", () => {
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = embeddedOperableApp();
    internals(app).state = { ...internals(app).state, showStream: true };
    internals(app)._mappingCache = { primPathForGuid: (g: string) => (g === "GUID-AAA" ? "/World/G_AAA" : null) };
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    vi.spyOn(internals(app), "_appendDemoOutgoing").mockImplementation(() => {});

    internals(app)._handleParentMessage(highlightMessage([{ ifc_guid: "GUID-AAA", severity: "error" }]));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({
      event_type: "highlightPrimsRequest",
      payload: expect.objectContaining({
        role: "primary",
        source_client_id: "viewer_lease_primary",
        viewer_lease_token: "lease_token_primary",
        session_id: "review_session_x",
      }),
    });
  });
});

describe("Important #2：_firstFramePosted 隨 stage 重載重置（多模型切換時第二個 stage 完成仍回報 first_frame）", () => {
  it("第二次 _completeStageLoad（換載 stage）→ 再次送 first_frame / stage_loaded", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    internals(app).state = { ...internals(app).state, expectedStageUrl: null };
    // 第一次完成 → first_frame + stage_loaded
    internals(app)._completeStageLoad("stage://first.usdc");
    expect(postedTypes(parent).filter((t) => t === "first_frame")).toHaveLength(1);
    // 模擬換載另一個 stage：_finishStageLoad（重載清理點）後第二次完成。
    internals(app)._finishStageLoad();
    internals(app)._completeStageLoad("stage://second.usdc");
    // 重置後第二個 stage 完成仍回報 first_frame（否則 IX-A1-06 無法重滿足，高亮鈕保持 disabled）。
    expect(postedTypes(parent).filter((t) => t === "first_frame")).toHaveLength(2);
    expect(postedTypes(parent).filter((t) => t === "stage_loaded")).toHaveLength(2);
  });
});

describe("Standalone stage binding：頂層 viewer 無 parent token 時自動 claim primary lease", () => {
  it("先 claim primary viewer lease，再帶 token 呼叫 stage-binding，通過後才送 loadArtifactGroupRequest", async () => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    reviewEnv.viewerLeaseToken = "";
    reviewEnv.sourceClientId = "dev_user_001";
    reviewEnv.userToken = "";
    const app = operableApp();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith("/viewer-leases/claim")) {
        return new Response(JSON.stringify({
          lease_id: "viewer_lease_primary",
          lease_token: "lease_token_primary",
          role: "primary",
          expires_at: new Date(Date.now() + 45_000).toISOString(),
          heartbeat_after_ms: 15_000,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/stage-binding")) {
        return new Response(JSON.stringify({
          status: "pending",
          session_id: "review_session_x",
          stage_binding_authorization_id: "stage_auth_001",
          binding_revision_id: "rev_authorized_001",
          pending_expires_at: "2026-07-22T12:00:30.000Z",
          stage_composition: {
            primary: {
              artifact_id: "artifact_primary",
              role: "primary",
              load_order: 0,
              usdc_url: "stage://authorized-primary.usdc",
            },
            secondary_layers: [],
          },
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => {});

    internals(app)._applyBinding([
      {
        artifact_id: "artifact_primary",
        model_version_id: "version_demo_001",
        usdc_url: "stage://primary.usdc",
        role: "primary",
        load_order: 0,
        ready: true,
      },
    ], "rev_binding_001");
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/api/review-sessions/review_session_x/viewer-leases/claim");
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: "POST" });
    const generatedUserToken = (fetchSpy.mock.calls[0][1]?.headers as Record<string, string>)["X-User-Token"];
    expect(generatedUserToken).toMatch(/^standalone_viewer_operator_/);
    expect(generatedUserToken).not.toBe(reviewEnv.defaultUserId);
    expect(generatedUserToken).not.toBe("dev_user_001");
    expect(reviewEnv.userToken).toBe(generatedUserToken);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      viewer_id: "dev_user_001",
      user_id: generatedUserToken,
      requested_role: "primary",
    });
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/api/review-sessions/review_session_x/stage-binding");
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "X-User-Token": generatedUserToken,
        "X-Viewer-Lease-Token": "lease_token_primary",
      }),
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toEqual({
      source_client_id: "viewer_lease_primary",
      role: "primary",
      artifacts: [{ artifact_id: "artifact_primary", role: "primary", load_order: 0 }],
    });
    expect(sendSpy).toHaveBeenCalledWith({
      event_type: "loadArtifactGroupRequest",
      payload: {
        url: "stage://authorized-primary.usdc",
        requested_stage_url: "stage://authorized-primary.usdc",
        stage_binding_authorization_id: "stage_auth_001",
        binding_revision_id: "rev_authorized_001",
        stage_composition: {
          primary: expect.objectContaining({
            artifact_id: "artifact_primary",
            usdc_url: "stage://authorized-primary.usdc",
            load_order: 0,
          }),
          secondary_layers: [],
        },
      },
    });
  });

  it("heartbeats a fresh standalone lease and clears it before any expired-token mutator", async () => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    reviewEnv.sourceClientId = "dev_user_001";
    const app = operableApp();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    useSynchronousSetState(app);
    const lease = {
      lease_id: "viewer_lease_primary",
      lease_token: "lease_token_primary",
      role: "primary" as const,
      expires_at: new Date(Date.now() + 45_000).toISOString(),
      heartbeat_after_ms: 15_000,
    };
    internals(app).standaloneViewerLease = lease;
    internals(app).componentMounted = true;
    const refreshedExpiry = new Date(Date.now() + 90_000).toISOString();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        lease_id: lease.lease_id,
        expires_at: refreshedExpiry,
        heartbeat_after_ms: 15_000,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await internals(app)._heartbeatStandaloneViewerLease("review_session_x", lease);

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/viewer-leases/viewer_lease_primary/heartbeat");
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-Viewer-Lease-Token": "lease_token_primary" }),
    });
    expect(internals(app).standaloneViewerLease?.expires_at).toBe(refreshedExpiry);

    internals(app).standaloneViewerLease = {
      ...lease,
      expires_at: new Date(Date.now() - 1).toISOString(),
    };
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    internals(app)._sendStreamMessage({ event_type: "resetStage", payload: {} });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(reviewEnv.viewerLeaseToken).toBe("");
    expect(reviewEnv.sourceClientId).toBe("dev_user_001");
    expect(internals(app).standaloneViewerLease).toBeNull();
    internals(app).componentMounted = false;
    internals(app)._dropStandaloneViewerLease();
  });
});

describe("Important #4（修訂）：visible-stream 完成路徑不得把 pendingStageUrl 當作 Kit 已證實的 loaded 證據", () => {
  // 誠實鐵律修正：原行為把 pendingStageUrl 灌進 first_frame/stage_loaded 並標 stage matched，
  // 但「畫面可見」不等於「Kit 已回報該 stage 載入完成」——舊模型殘影 + 新 pendingStageUrl 會被誤判為已對齊，
  // 使 A1 對「未證實的 stage」開放高亮。修正後：frame 可見仍誠實送 first_frame，但 stageUrl 為 null、
  // 且 stageLoadStatus 維持 unproven（有 expected 卻無 Kit loaded URL），高亮鈕保持 disabled 直到 Kit 真回報相符 URL。
  it("_completeStageLoadFromVisibleStream（Kit 未回 loaded URL）→ first_frame 帶 stageUrl:null、stage 不標 matched", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    const stageUrl = "stage://visible-stream.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
    };
    internals(app).pendingStageUrl = stageUrl;
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);

    expect(internals(app)._completeStageLoadFromVisibleStream()).toBe(true);

    const posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null });
    // frame 可見 → 仍送 first_frame（誠實：有畫面），但不得攜帶未經 Kit 證實的 pendingStageUrl
    // （此處為 P1 修正的核心觀測點：first_frame.stageUrl 必為 null，A1 端 onFirstFrame 不會 setLoadedStageUrl
    //  → isStageMatched 維持 false → 高亮鈕保持 disabled，直到 Kit 真回報相符 URL）。
    expect(posted.find((m) => m.type === "first_frame")).toMatchObject({ stageUrl: null });
    expect(posted.find((m) => m.type === "stage_loaded")).toMatchObject({ stageUrl: null, status: "unproven" });
  });

  it("Kit 真回報相符 loaded URL（_completeStageLoad(url)）→ first_frame / stage_loaded 帶該真 url（非 null）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    const stageUrl = "stage://visible-stream.usdc";
    internals(app).state = { ...internals(app).state, expectedStageUrl: stageUrl, loadedStageUrl: null };
    internals(app).pendingStageUrl = stageUrl;

    internals(app)._completeStageLoad(stageUrl, "rev_binding_proven"); // Kit handler 路徑：帶 coordinator-confirmed revision

    // 對照組：有 Kit 證實的 loaded URL 時，first_frame/stage_loaded 才攜帶真 stageUrl（A1 端據此閉合 stage-match）。
    const posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null });
    expect(posted.find((m) => m.type === "first_frame")).toMatchObject({ stageUrl });
    expect(posted.find((m) => m.type === "stage_loaded")).toMatchObject({
      stageUrl,
      status: "active",
      binding_revision_id: "rev_binding_proven",
    });
  });
});

describe("Important #3：allowedCoordinatorOrigins 空白名單時 _postToParent 降級須留診斷（不再半靜默失敗）", () => {
  it("白名單為空 → _postToParent 不送出但 console.warn 留下診斷（deploy 忘設 env 的線索）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", ""); // 模擬忘記設定 env var
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = new App({} as never);
    internals(app)._postToParent({ type: "viewer_ready" });
    expect(parent.postMessage).not.toHaveBeenCalled(); // 安全：不對未授權 origin 送
    expect(warnSpy).toHaveBeenCalled(); // 但要留診斷，不可半靜默
    warnSpy.mockRestore();
  });
});

// ── quality review 補強（Task 2 fix）──────────────────────────────────────────
// 補三項 Important 的測試缺口 / 守衛缺口（皆 §2 / §5 範圍內，嚴格 additive，不改既有 reject 行為）。

describe("Q-Important #1：第二層 referrer 交叉驗（event.origin 通過白名單，但 referrer origin 不符）→ 整則丟棄且不崩潰", () => {
  // §M5 已知 trade-off：shouldAcceptParentMessage（白名單）通過後，再以 document.referrer parse 出的
  // parent origin 做交叉驗（Window.tsx:682）。既有 M5 測只鎖「空 referrer 安全降級」；此處補
  // 「referrer 存在但 origin 不符」這條路徑——event.origin=PARENT_ORIGIN（在白名單）但 referrer=other.example。
  it("referrer=http://other.example 而 event.origin=PARENT_ORIGIN（在白名單）→ 不呼 _overlayHighlight、不回 highlight_result、不崩潰", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    // referrer 指向另一 origin（非白名單）→ _consoleParentOrigin() 回 http://other.example，
    // 與 event.origin（PARENT_ORIGIN）不符 → 第二層交叉驗應丟棄。
    const parent = setEmbedded("http://other.example/whatever");
    const app = operableApp(); // issues + session + active：排除是 canOperate=false 才不處理的可能
    const overlaySpy = vi.spyOn(internals(app), "_overlayHighlight");
    expect(() =>
      internals(app)._handleParentMessage(highlightMessage([{ ifc_guid: "GUID-AAA", severity: "error" }])),
    ).not.toThrow();
    expect(overlaySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");
  });
});

describe("Q-Important #2：highlight 分支須驗 payload 形狀（items 非陣列 / item 非物件 / ifc_guid 非字串一律丟棄）", () => {
  // postMessage 跨 origin 反序列化，TS cast 不做執行期檢查。惡意 / 錯誤 sender 傳入 items:[null] / [42] /
  // 缺 ifc_guid 時，_overlayHighlight 不該收到非法 FailedElement（守衛原則對齊：origin 驗白名單後，payload 也須驗）。
  function rawHighlight(items: unknown): MessageEvent {
    return new MessageEvent("message", { data: { protocol: "vg01", type: "highlight", items }, origin: PARENT_ORIGIN });
  }

  it("items 非陣列（items: 42）→ 不呼 _overlayHighlight、不崩潰", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    const overlaySpy = vi.spyOn(internals(app), "_overlayHighlight");
    expect(() => internals(app)._handleParentMessage(rawHighlight(42))).not.toThrow();
    expect(overlaySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");
  });

  it("items 含 null / 數字 / 缺 ifc_guid 的非法 item → 跳過非法者、僅對合法 item 呼 _overlayHighlight", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    const overlaySpy = vi
      .spyOn(internals(app), "_overlayHighlight")
      .mockReturnValue({ ok: false, reason: "unmapped" });
    const items = [null, 42, { severity: "error" }, { ifc_guid: 99 }, { ifc_guid: "GUID-OK", severity: "error" }];
    expect(() => internals(app)._handleParentMessage(rawHighlight(items))).not.toThrow();
    // 只有最後一筆合法（ifc_guid 為字串）→ _overlayHighlight 恰呼 1 次，且只回 1 筆 highlight_result。
    expect(overlaySpy).toHaveBeenCalledTimes(1);
    expect(overlaySpy.mock.calls[0][0]).toMatchObject({ ifc_guid: "GUID-OK" });
    const highlightResults = postedTypes(parent).filter((t) => t === "highlight_result");
    expect(highlightResults).toHaveLength(1);
  });
});

// ── A2 F2⑥：highlight_batch（單一批次 request＝Kit 聯集選取）──
// 與逐筆 type=highlight 分開的新 case：全部 items 經 _overlayHighlightMany 裝進「一個」
// highlightPrimsRequest，並回「一個」帶 sent_count/unmapped_count 的 highlight_result。
// 既有 type=highlight 的逐筆語意（Q-Important #2/#3 所鎖）完全不動。
describe("A2 highlight_batch：單一批次 request + 單一 ack（誠實計數）", () => {
  function batchMessage(items: unknown): MessageEvent {
    return new MessageEvent("message", { data: { protocol: "vg01", type: "highlight_batch", items }, origin: PARENT_ORIGIN });
  }

  it("canOperate=false → 靜默丟棄（不呼 _overlayHighlightMany、不回 highlight_result）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never); // 未就緒 → canOperate=false
    const manySpy = vi.spyOn(internals(app), "_overlayHighlightMany");
    internals(app)._handleParentMessage(batchMessage([{ ifc_guid: "GUID-AAA", severity: "error" }]));
    expect(manySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");
  });

  it("items 非陣列 / 全非法 → 丟棄不崩潰；混入非法 item 只把合法者交給 _overlayHighlightMany", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    const manySpy = vi.spyOn(internals(app), "_overlayHighlightMany")
      .mockReturnValue({ ok: true, requestId: "req_b", sent: [{ ifc_guid: "GUID-OK", primPath: "/World/OK" }], unmapped: [] });
    expect(() => internals(app)._handleParentMessage(batchMessage(42))).not.toThrow();
    expect(() => internals(app)._handleParentMessage(batchMessage([null, 7, { severity: "error" }]))).not.toThrow();
    expect(manySpy).not.toHaveBeenCalled();
    expect(postedTypes(parent)).not.toContain("highlight_result");

    internals(app)._handleParentMessage(batchMessage([null, { ifc_guid: "GUID-OK", severity: "error" }]));
    expect(manySpy).toHaveBeenCalledTimes(1);
    expect(manySpy.mock.calls[0][0]).toEqual([{ ifc_guid: "GUID-OK", severity: "error" }]);
  });

  it("多 items → _overlayHighlightMany 收「整批一次」，並只回「一個」帶 sent_count/unmapped_count 的 highlight_result", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    const manySpy = vi.spyOn(internals(app), "_overlayHighlightMany").mockReturnValue({
      ok: true,
      requestId: "req_batch_1",
      sent: [{ ifc_guid: "GUID-A", primPath: "/World/A" }, { ifc_guid: "GUID-B", primPath: "/World/B" }],
      unmapped: ["GUID-C"],
    });
    const items = [
      { ifc_guid: "GUID-A", severity: "added" },
      { ifc_guid: "GUID-B", severity: "error" },
      { ifc_guid: "GUID-C", severity: "warning" },
    ];
    internals(app)._handleParentMessage(batchMessage(items));
    expect(manySpy).toHaveBeenCalledTimes(1); // 整批一次，非逐筆三次
    expect(manySpy.mock.calls[0][0]).toEqual(items);
    const results = parent.postMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p.type === "highlight_result");
    expect(results).toHaveLength(1); // 單一批次 ack
    expect(results[0]).toMatchObject({ ok: true, requestId: "req_batch_1", sent_count: 2, unmapped_count: 1, unmapped_guids: ["GUID-C"] });
  });

  it("bridge 回拒（datachannel_not_ready）→ 單一 ok:false ack 帶 reason（誠實，不假裝已送）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    vi.spyOn(internals(app), "_overlayHighlightMany").mockReturnValue({ ok: false, reason: "datachannel_not_ready" });
    internals(app)._handleParentMessage(batchMessage([{ ifc_guid: "GUID-A", severity: "error" }]));
    const results = parent.postMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p.type === "highlight_result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, reason: "datachannel_not_ready", requestId: "" });
  });

  it("真 _overlayHighlightMany（有 mappingCache + stub 串流）→ 恰送一個 highlightPrimsRequest（mode:replace 聯集，不逐筆互清）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    internals(app).state = { ...internals(app).state, showStream: true };
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    internals(app)._mappingCache = {
      primPathForGuid: (g: string) => (g === "GUID-A" ? "/World/A" : g === "GUID-B" ? "/World/B" : null),
    };
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => {});
    internals(app)._handleParentMessage(batchMessage([
      { ifc_guid: "GUID-A", severity: "error" },
      { ifc_guid: "GUID-B", severity: "warning" },
      { ifc_guid: "GUID-NOPE", severity: "error" },
    ]));
    // 單一 DataChannel request 帶兩個 mapped prim（聯集）；unmapped 不進 items。
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const msg = sendSpy.mock.calls[0][0] as { event_type: string; payload: { mode: string; items: Array<{ prim_path: string }> } };
    expect(msg.event_type).toBe("highlightPrimsRequest");
    expect(msg.payload.mode).toBe("replace");
    expect(msg.payload.items.map((i) => i.prim_path)).toEqual(["/World/A", "/World/B"]);
  });
});

describe("Q-Important #3：_postToParent 接受外部已建的 allowedOrigins Set（避免 highlight 迴圈每筆重 parse env）", () => {
  // _handleParentMessage 開頭已建 allowedOrigins；_postToParent 應可複用它，免得 highlight 迴圈內每筆
  // highlight_result 都重新 split/map/normalize/new Set。行為不變：傳入的 Set 與內部自建結果等價時送出一致。
  it("傳入快取 Set → 仍正常送出（行為與不傳一致），且未額外呼 allowedCoordinatorOrigins", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    const cache = new Set([PARENT_ORIGIN]);
    internals(app)._postToParent({ type: "viewer_ready" }, cache);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ protocol: "vg01", type: "viewer_ready" });
    expect(parent.postMessage.mock.calls[0][1]).toBe(PARENT_ORIGIN);
  });

  it("highlight 迴圈多筆 → allowedCoordinatorOrigins 不隨筆數線性增加呼叫（複用同一 Set）", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    vi.spyOn(internals(app), "_overlayHighlight").mockReturnValue({ ok: false, reason: "unmapped" });
    const envModule = await import("../config/env");
    const originsSpy = vi.spyOn(envModule, "allowedCoordinatorOrigins");
    const items = Array.from({ length: 5 }, (_, i) => ({ ifc_guid: `GUID-${i}`, severity: "error" }));
    internals(app)._handleParentMessage(highlightMessage(items));
    // 5 筆 highlight → 若 _postToParent 每筆都自建 Set，allowedCoordinatorOrigins 會被呼 ≥6 次（1 守衛 + 5 回報）。
    // 複用快取後應僅 1 次（_handleParentMessage 開頭）。
    expect(originsSpy).toHaveBeenCalledTimes(1);
    originsSpy.mockRestore();
  });
});

// ── quality review 補強（task#2 fix）：selected_guid 送出路徑（VG-01 七區塊第7「3D 點構件→清單反查」）無測試覆蓋 ──
describe("Q-Important（task2）：selected_guid 送出（_reverseLookupGuid → _postToParent）", () => {
  it("嵌入 + 反查到 guid → 送出 selected_guid（含 ifcGuid，targetOrigin 非 \"*\"），不崩潰", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    internals(app)._mappingCache = {
      primPathForGuid: () => null,
      guidForPrimPathOrAncestor: (p: string) => (p.includes("G_AAA") ? "GUID-AAA" : null),
    };
    expect(() => internals(app)._reverseLookupGuid("/World/G_AAA/mesh_0")).not.toThrow();
    const sel = parent.postMessage.mock.calls
      .map((c) => ({ payload: c[0] as { type?: string; ifcGuid?: string | null }, target: c[1] }))
      .filter((c) => c.payload.type === "selected_guid");
    expect(sel).toHaveLength(1);
    expect(sel[0].payload.ifcGuid).toBe("GUID-AAA");
    expect(sel[0].target).toBe(PARENT_ORIGIN); // 非 "*"
  });

  it("standalone（window.parent === window）→ _reverseLookupGuid 不送 selected_guid（早返，不對 self 廣播）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    const winPost = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const app = operableApp();
    internals(app)._mappingCache = {
      primPathForGuid: () => null,
      guidForPrimPathOrAncestor: () => "GUID-AAA",
    };
    expect(() => internals(app)._reverseLookupGuid("/World/G_AAA")).not.toThrow();
    expect(winPost.mock.calls.some((c) => (c[0] as { type?: string } | null)?.type === "selected_guid")).toBe(false);
    winPost.mockRestore();
  });
});

// ── quality review 補強（task#2 fix）：Important #1 spectator lease/openStage 一致性守衛 ──────────────
// _openSelectedAsset 的 openStage 包裝在非 harness 會先 await _ensurePrimaryViewerLease() → standalone
// （window.parent === window）時真 POST viewer-leases/claim requested_role:"primary"，搶占同 session 唯一
// primary lease；且進入前已 setState isLoading:true「正在載入模型...」，被下游閘門擋下時不會重置 → 卡住。
// 修法與姊妹函式 _applyBinding（Window.tsx:1092）一致：spectator（view-only）在進入點即 return。
describe("Important #1（task2 fix）：spectator 不驅動 openStageRequest / 不索取 primary viewer lease", () => {
  function spectatorGet() {
    return vi.spyOn(URLSearchParams.prototype, "get").mockImplementation((k: string) => (k === "streamRole" ? "spectator" : null));
  }

  it("_canOpenSelectedAsset：spectator 一律回 false（automatic 載入路徑短路，與 _applyBinding 一致）", () => {
    const app = operableApp();
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "primary", url: "stage://primary.usdc" },
    };
    // 對照組：非 spectator、模型就緒、lifecycle active → 可開（證明 false 來自 spectator 而非其他前置條件）。
    expect(internals(app)._canOpenSelectedAsset()).toBe(true);
    const stubGet = spectatorGet();
    expect(internals(app)._canOpenSelectedAsset()).toBe(false);
    stubGet.mockRestore();
  });

  it("_openSelectedAsset：spectator 直呼（如 debug Open Stage）不 POST viewer-leases/claim、不送 openStageRequest、isLoading 收斂為 false", async () => {
    Object.defineProperty(window, "parent", { value: window, configurable: true }); // standalone：非 harness 才會真 claim
    reviewEnv.viewerLeaseToken = "";
    const stubGet = spectatorGet();
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "primary", url: "stage://primary.usdc" },
      isLoading: true,
      loadingText: "正在載入模型...",
    };
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ lease_id: "x", lease_token: "t", role: "primary" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchSpy);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const reviewSpy = vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._openSelectedAsset();
    await flushMicrotasks();

    expect(fetchSpy).not.toHaveBeenCalled(); // 無 primary lease claim → 不搶占真 primary 的 lease
    expect(sendSpy).not.toHaveBeenCalled(); // 無 openStageRequest（runtime mutator）送出
    expect(internals(app).state.isLoading).toBe(false); // 不留「正在載入模型...」卡住
    expect(reviewSpy).toHaveBeenCalledWith(expect.stringContaining("spectator"));
    stubGet.mockRestore();
  });
});

// ── quality review 補強（task#2 fix）：Important #2 binding-apply 失敗 / 缺證據分支回歸鎖（誠實鐵律）──────
// 既有測試僅覆蓋 happy path（openedStageResult success + url 相符 + bindingRevisionId → applied）。
// 補：(a) url 不符 → failed(stale_stage_or_mismatch)；(b) success 但缺 loaded URL（無 stage-match 證據）
// → 不得偽宣告 applied，須標 failed(missing_stage_evidence)；(c) loadArtifactGroupResult result=error → failed。
describe("Important #2（task2 fix）：binding-apply 失敗 / 缺證據分支（不偽宣告成功）", () => {
  function bindingApplyApp(): App {
    const app = operableApp();
    // Test helper name predates hooks lint; this patches class setState and is not a React hook.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://primary.usdc",
      govBindingApplyState: { status: "applying" },
    };
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});
    return app;
  }

  function trackBindingRequest(
    app: App,
    eventType: "openStageRequest" | "loadArtifactGroupRequest",
    requestId: string,
    bindingRevisionId: string,
  ): void {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    internals(app)._sendStreamMessage({
      event_type: eventType,
      payload: {
        request_id: requestId,
        binding_revision_id: bindingRevisionId,
        url: "stage://primary.usdc",
      },
    });
  }

  it("openedStageResult success 但 loaded URL 與 expected 不符 → failed(stale_stage_or_mismatch)，不宣告 applied", () => {
    const app = bindingApplyApp();
    trackBindingRequest(app, "openStageRequest", "req_binding_002", "rev_binding_002");
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: { result: "success", request_id: "req_binding_002", url: "stage://stale-other.usdc", binding_revision_id: "rev_binding_002" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "stale_stage_or_mismatch" });
    expect(internals(app).state.govBindingActiveRevision).toBeUndefined();
  });

  it("openedStageResult success 但缺 loaded URL（無 stage-match 證據）→ failed(missing_stage_evidence)，不偽宣告 applied", () => {
    const app = bindingApplyApp();
    trackBindingRequest(app, "openStageRequest", "req_binding_003", "rev_binding_003");
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: { result: "success", request_id: "req_binding_003", binding_revision_id: "rev_binding_003" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "missing_stage_evidence" });
    expect(internals(app).state.govBindingActiveRevision).toBeUndefined();
  });

  it("loadArtifactGroupResult result=error → failed 帶 Kit error reason", () => {
    const app = bindingApplyApp();
    trackBindingRequest(app, "loadArtifactGroupRequest", "req_binding_004", "rev_binding_004");
    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: { result: "error", request_id: "req_binding_004", binding_revision_id: "rev_binding_004", error: "kit_compose_failed" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "kit_compose_failed" });
  });
});
