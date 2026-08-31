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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppStream from "../AppStream";
import App from "../Window";
import { reviewEnv } from "../config/env";
import { FakeAppStreamer } from "../harness/fakeStreamer";
import { HARNESS_REVIEW_AUTHORITY } from "../harness/fixtures/reviewAuthority";
import { getLang, setLang } from "./i18n";

const PARENT_ORIGIN = "http://127.0.0.1:8004"; // console（coordinator）origin；複用 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單。
const DATA_CHANNEL_TRACE_ID = "ifcready_window_parent_message";
const initialLang = getLang();

type AppInternals = {
  state: Record<string, unknown>;
  _handleParentMessage: (e: MessageEvent) => void;
  _handleCustomEvent: (
    event: { event_type?: string; messageRecipient?: string; data?: string; payload?: unknown } | null,
    streamGeneration?: number,
  ) => void;
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
  _beginStageAttempt: (url: string) => number;
  _scheduleStageLoadTimeout: (generation: number) => void;
  _scheduleLoadingStateQuery: (delayMs?: number) => void;
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
  loadingStatePollCount: number;
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
  type StreamEvent = {
    event_type?: string;
    messageRecipient?: string;
    data?: string;
    payload?: unknown;
  };
  const streamGenerationTarget = target as unknown as {
    _handleCustomEvent: (event: StreamEvent | null, streamGeneration?: number) => void;
  };
  const handleCustomEvent = streamGenerationTarget._handleCustomEvent.bind(app);
  streamGenerationTarget._handleCustomEvent = (event, streamGeneration) => handleCustomEvent(event
    ? {
        ...event,
        payload: {
          ...(event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
            ? event.payload as Record<string, unknown>
            : {}),
          trace_id: DATA_CHANNEL_TRACE_ID,
        },
      }
    : event, streamGeneration);
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

function renderedAppStreamProps(app: App): { onStreamFailed: () => void } {
  const find = (node: React.ReactNode): { onStreamFailed: () => void } | null => {
    if (!React.isValidElement(node)) return null;
    if (node.type === AppStream) return node.props as { onStreamFailed: () => void };
    const children = React.Children.toArray((node.props as { children?: React.ReactNode }).children);
    for (const child of children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const props = find(internals(app).render());
  if (!props) throw new Error("expected rendered AppStream");
  return props;
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

  it("fails closed when openedStageResult revision differs from the correlated request", () => {
    setLang("en");
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId: string;
        stageUrl: string;
        stageAttemptGeneration: number;
      }>;
    };
    const stageUrl = "stage://revision-guard.usdc";
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      runtimeCommandLifecycles: [{
        request_id: "req_revision_guard",
        event_type: "loadArtifactGroupRequest",
        phases: ["pending"],
      }],
    };
    privateApp.runtimeCommandContexts.set("req_revision_guard", {
      eventType: "loadArtifactGroupRequest",
      bindingRevisionId: "rev_expected",
      stageUrl,
      stageAttemptGeneration: generation,
    });

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_revision_guard",
        url: stageUrl,
        binding_revision_id: "rev_stale",
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "terminal" }));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.loadingText).toBe("Stage authorization mismatch");
    expect(privateApp.runtimeCommandContexts.has("req_revision_guard")).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_revision_guard")).toEqual({
      eventType: "loadArtifactGroupRequest",
      outcome: "error",
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: "req_revision_guard",
        phases: ["pending", "terminal"],
        outcome: "error",
      }),
    ]));
  });

  it("fails closed when a correlated openedStageResult omits the required binding revision", () => {
    setLang("en");
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId: string;
        stageUrl: string;
        stageAttemptGeneration: number;
      }>;
    };
    const stageUrl = "stage://revision-missing.usdc";
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      runtimeCommandLifecycles: [{
        request_id: "req_revision_missing",
        event_type: "loadArtifactGroupRequest",
        phases: ["pending"],
      }],
    };
    privateApp.runtimeCommandContexts.set("req_revision_missing", {
      eventType: "loadArtifactGroupRequest",
      bindingRevisionId: "rev_expected",
      stageUrl,
      stageAttemptGeneration: generation,
    });

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_revision_missing",
        url: stageUrl,
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "terminal" }));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.loadingText).toBe("Stage authorization mismatch");
    expect(internals(app).state.streamDiagnostic).toContain("Received revision: missing");
    expect(privateApp.runtimeCommandContexts.has("req_revision_missing")).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_revision_missing")).toEqual({
      eventType: "loadArtifactGroupRequest",
      outcome: "error",
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: "req_revision_missing",
        phases: ["pending", "terminal"],
        outcome: "error",
      }),
    ]));
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
      title: "模型載入逾時",
      target: "目標：stage://timeout.usdc",
      diagnostic: "診斷：remote-video element not found",
      lastState: "最後狀態：stage://timeout.usdc busy",
      guidance: "Kit 已連線但沒有回報模型載入完成，請檢查該 USDC 是否可由 Kit 開啟。",
      alternateTitle: "Model loading timed out",
      alternateTarget: "Target: stage://timeout.usdc",
    },
    {
      language: "en" as const,
      title: "Model loading timed out",
      target: "Target: stage://timeout.usdc",
      diagnostic: "Diagnostic: remote-video element not found",
      lastState: "Last state: stage://timeout.usdc busy",
      guidance: "Kit is connected but did not report model loading as complete. Verify that Kit can open this USDC.",
      alternateTitle: "模型載入逾時",
      alternateTarget: "目標：stage://timeout.usdc",
    },
  ])("$language renders both timeout terminals with localized visible diagnostics and guidance", (copy) => {
    vi.useFakeTimers();
    setLang(copy.language);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";

    const timerApp = operableApp();
    useSynchronousSetState(timerApp);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    internals(timerApp).pendingStageUrl = "stage://timeout.usdc";
    const timerGeneration = internals(timerApp)._beginStageAttempt("stage://timeout.usdc");
    internals(timerApp)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: `req_timer_${copy.language}`, url: "stage://timeout.usdc" },
    });
    vi.spyOn(internals(timerApp), "_completeStageLoadFromVisibleStream").mockReturnValue(false);
    internals(timerApp)._scheduleStageLoadTimeout(timerGeneration);
    vi.runOnlyPendingTimers();

    const timerHtml = renderToString(internals(timerApp).render());
    expect(timerHtml).toContain(copy.title);
    expect(timerHtml).toContain(copy.target);
    expect(timerHtml).toContain(copy.diagnostic);
    expect(timerHtml).toContain(copy.guidance);
    expect(timerHtml).not.toContain(copy.alternateTitle);
    expect(timerHtml).not.toContain(copy.alternateTarget);

    const pollingApp = operableApp();
    useSynchronousSetState(pollingApp);
    internals(pollingApp).state = {
      ...internals(pollingApp).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "timeout", url: "stage://timeout.usdc" },
    };
    internals(pollingApp).pendingStageUrl = "stage://timeout.usdc";
    internals(pollingApp).loadingStatePollCount = 90;
    internals(pollingApp)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://timeout.usdc", loading_state: "busy" },
    });

    const pollingHtml = renderToString(internals(pollingApp).render());
    expect(pollingHtml).toContain(copy.title);
    expect(pollingHtml).toContain(copy.target);
    expect(pollingHtml).toContain(copy.lastState);
    expect(pollingHtml).toContain(copy.guidance);
    expect(pollingHtml).not.toContain(copy.alternateTitle);
    expect(pollingHtml).not.toContain(copy.alternateTarget);
  });

  it("a correlated timeout terminal rejects a late openedStageResult success without clearing its visible failure", () => {
    vi.useFakeTimers();
    setLang("en");
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://timeout.usdc",
      selectedUSDAsset: { name: "timeout", url: "stage://timeout.usdc" },
    };
    internals(app).pendingStageUrl = "stage://timeout.usdc";
    const attemptGeneration = internals(app)._beginStageAttempt("stage://timeout.usdc");
    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_timeout_terminal_001",
        url: "stage://timeout.usdc",
        trace_id: DATA_CHANNEL_TRACE_ID,
      },
    });
    vi.spyOn(internals(app), "_completeStageLoadFromVisibleStream").mockReturnValue(false);
    internals(app)._scheduleStageLoadTimeout(attemptGeneration);
    vi.runOnlyPendingTimers();
    const timeoutHtml = renderToString(internals(app).render());

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_timeout_terminal_001",
        url: "stage://timeout.usdc",
        trace_id: DATA_CHANNEL_TRACE_ID,
      },
    });

    expect(internals(app).state.runtimeCommandLifecycles).toEqual([
      expect.objectContaining({
        request_id: "req_timeout_terminal_001",
        phases: ["pending", "terminal"],
        outcome: "timed-out",
      }),
    ]);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(renderToString(internals(app).render())).toBe(timeoutHtml);
  });

  it("marks the scheduled 45s stage-load-timeout terminal with a state-specific test anchor", () => {
    vi.useFakeTimers();
    setLang("zh");
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";

    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    internals(app).pendingStageUrl = "stage://timeout-anchor.usdc";
    const generation = internals(app)._beginStageAttempt("stage://timeout-anchor.usdc");
    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_timeout_anchor_45s", url: "stage://timeout-anchor.usdc" },
    });
    vi.spyOn(internals(app), "_completeStageLoadFromVisibleStream").mockReturnValue(false);
    internals(app)._scheduleStageLoadTimeout(generation);
    vi.runOnlyPendingTimers();

    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain('data-stage-failure-reason="stage-load-timeout"');
  });

  it("marks the 90x1s busy-poll stage-load-timeout terminal with the same state-specific test anchor", () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "poll-timeout-anchor", url: "stage://poll-timeout-anchor.usdc" },
    };
    internals(app).pendingStageUrl = "stage://poll-timeout-anchor.usdc";
    internals(app).loadingStatePollCount = 90;
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://poll-timeout-anchor.usdc", loading_state: "busy" },
    });

    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain('data-stage-failure-reason="stage-load-timeout"');
  });

  it("does not tag an unrelated stage-load failure with the stage-load-timeout anchor", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _failStageLoad: (title: string, diagnostic?: string, generation?: number) => void;
    };
    const generation = privateApp._beginStageAttempt("stage://non-timeout-failure.usdc");
    privateApp._failStageLoad("Stage loading state did not report a URL", undefined, generation);

    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).not.toContain('data-stage-failure-reason="stage-load-timeout"');
    expect(html).toContain('data-stage-failure-reason="generic"');
  });

  it("applies a late changed_failed terminal to its timed-out stage without reviving it", () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      activeStageAttempt: { generation: number; status: string } | null;
    };
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const stageUrl = "stage://timeout-changed-failed.usdc";
    const bindingRevisionId = "rev_timeout_changed_failed";
    const requestId = "req_timeout_changed_failed";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      selectedUSDAsset: { name: "timeout changed failed", url: stageUrl },
      govBindingActiveRevision: "rev_last_good",
      govBindingLastGoodRevision: "rev_last_good",
    };
    internals(app).pendingStageUrl = stageUrl;
    const attemptGeneration = internals(app)._beginStageAttempt(stageUrl);
    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: requestId,
        url: stageUrl,
        binding_revision_id: bindingRevisionId,
        trace_id: DATA_CHANNEL_TRACE_ID,
      },
    });
    vi.spyOn(internals(app), "_completeStageLoadFromVisibleStream").mockReturnValue(false);
    internals(app)._scheduleStageLoadTimeout(attemptGeneration);
    vi.runOnlyPendingTimers();

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "error",
        request_id: requestId,
        url: stageUrl,
        binding_revision_id: bindingRevisionId,
        runtime_state: "changed_failed",
        error: "secondary layer failed after deadline",
        trace_id: DATA_CHANNEL_TRACE_ID,
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptGeneration,
      status: "terminal",
    }));
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ request_id: requestId, outcome: "timed-out" }),
    ]));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.govBindingActiveRevision).toBeNull();
    expect(internals(app).state.govBindingLastGoodRevision).toBe("rev_last_good");
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "runtime_changed_transaction_failed",
    });
  });

  it("claims every command in one attempt, then ignores its late loading-state and progress terminals", () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _scheduleStageLoadTimeout: (generation: number) => void;
      _completeStageLoadFromVisibleStream: () => boolean;
      activeStageAttempt: { generation: number; status: string } | null;
      runtimeCommandContexts: Map<string, { eventType: string; stageAttemptGeneration: number }>;
    };
    const generation = privateApp._beginStageAttempt("stage://timeout.usdc");
    internals(app).pendingStageUrl = "stage://timeout.usdc";
    privateApp.runtimeCommandContexts.set("req_timeout_first", {
      eventType: "openStageRequest",
      stageAttemptGeneration: generation,
    });
    privateApp.runtimeCommandContexts.set("req_timeout_second", {
      eventType: "openStageRequest",
      stageAttemptGeneration: generation,
    });
    vi.spyOn(privateApp, "_completeStageLoadFromVisibleStream").mockReturnValue(false);
    privateApp._scheduleStageLoadTimeout(generation);
    vi.runOnlyPendingTimers();

    const timeoutText = internals(app).state.loadingText;
    const timeoutDiagnostic = internals(app).state.streamDiagnostic;
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://timeout.usdc", loading_state: "idle" },
    });
    internals(app)._handleCustomEvent({
      event_type: "updateProgressActivity",
      payload: { text: "None" },
    });

    expect(privateApp.activeStageAttempt).toEqual({
      generation,
      status: "terminal",
      targetUrl: "stage://timeout.usdc",
      terminalReason: "stage-load-timeout",
    });
    expect(internals(app).pendingStageUrl).toBeNull();
    expect(internals(app).state.loadingText).toBe(timeoutText);
    expect(internals(app).state.streamDiagnostic).toBe(timeoutDiagnostic);
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({ request_id: "req_timeout_first", outcome: "timed-out" }),
      expect.objectContaining({ request_id: "req_timeout_second", outcome: "timed-out" }),
    ]));
  });

  it("does not let uncorrelated A busy/idle or a direct late None progress mutate superseding attempt B", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      confirmedStageBindingRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        stageAttemptGeneration: number;
        stageUrl: string;
      }>;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: "stage://b.usdc",
      selectedUSDAsset: { name: "B", url: "stage://b.usdc" },
      usdAssets: [
        { name: "A", url: "stage://a.usdc" },
        { name: "B", url: "stage://b.usdc" },
      ],
      runtimeCommandLifecycles: [{
        request_id: "req_a_superseded",
        event_type: "openStageRequest",
        phases: ["pending"],
      }],
    };
    const generationA = privateApp._beginStageAttempt("stage://a.usdc");
    internals(app).pendingStageUrl = "stage://a.usdc";
    privateApp.runtimeCommandContexts.set("req_a_superseded", {
      eventType: "openStageRequest",
      stageAttemptGeneration: generationA,
      stageUrl: "stage://a.usdc",
    });
    const generationB = privateApp._beginStageAttempt("stage://b.usdc");
    internals(app).pendingStageUrl = "stage://b.usdc";
    privateApp.confirmedStageBindingRevision = "revision_b";
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    expect(privateApp.runtimeCommandContexts.has("req_a_superseded")).toBe(false);
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: "req_a_superseded",
        phases: ["pending", "terminal"],
        outcome: "superseded",
      }),
    ]));

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://a.usdc", loading_state: "busy" },
    });
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://a.usdc", loading_state: "idle" },
    });
    internals(app).loadingStatePollCount = 90;
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://b.usdc", loading_state: "busy" },
    });
    internals(app)._handleCustomEvent({
      event_type: "updateProgressActivity",
      payload: { text: "None" },
    });

    expect(privateApp.activeStageAttempt).toEqual({
      generation: generationB,
      status: "pending",
      targetUrl: "stage://b.usdc",
    });
    expect(internals(app).pendingStageUrl).toBe("stage://b.usdc");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).not.toBe("matched");
    expect(internals(app).state.loadingText).toBe("正在載入模型...");
    expect(internals(app)._firstFramePosted).toBe(false);
    expect((internals(app).state.runtimeCommandLifecycles as Array<{ outcome?: string }>)
      .some((entry) => entry.outcome === "success")).toBe(false);

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://b.usdc", loading_state: "idle" },
    });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: generationB,
      status: "pending",
    }));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
  });

  it("requires correlated completion when a stale idle response can share the superseding attempt URL", () => {
    setLang("en");
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      confirmedStageBindingRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        stageAttemptGeneration: number;
        stageUrl: string;
      }>;
    };
    const sharedUrl = "stage://same-url.usdc";
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: sharedUrl,
      selectedUSDAsset: { name: "same-url", url: sharedUrl },
      usdAssets: [{ name: "same-url", url: sharedUrl }],
    };
    privateApp._beginStageAttempt(sharedUrl);
    internals(app).pendingStageUrl = sharedUrl;
    const generationB = privateApp._beginStageAttempt(sharedUrl);
    internals(app).pendingStageUrl = sharedUrl;
    privateApp.confirmedStageBindingRevision = "revision_same_url_b";
    privateApp.runtimeCommandContexts.set("req_same_url_b", {
      eventType: "openStageRequest",
      stageAttemptGeneration: generationB,
      stageUrl: sharedUrl,
    });
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: sharedUrl, loading_state: "idle" },
    });

    expect(privateApp.activeStageAttempt).toEqual({
      generation: generationB,
      status: "pending",
      targetUrl: sharedUrl,
    });
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadingText).toBe("Stage observed; awaiting correlated completion evidence.");

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_same_url_b",
        url: sharedUrl,
        binding_revision_id: "revision_same_url_b",
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: generationB,
      status: "completed",
    }));
    expect(internals(app).state.loadedStageUrl).toBe(sharedUrl);
    expect(internals(app).state.stageLoadStatus).toBe("matched");
  });

  it.each([
    ["stream stop", "_handleStreamStopped"] as const,
    ["reconnect", "_reconnectStream"] as const,
  ])("%s invalidates an active attempt so its late openedStageResult cannot overwrite the disconnect UI", (label, method) => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _handleStreamStopped: (kind: "stopped", message: unknown) => void;
      _reconnectStream: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageAttemptGeneration: number;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        stageAttemptGeneration?: number;
        stageUrl?: string;
      }>;
    };
    const generation = privateApp._beginStageAttempt("stage://disconnect.usdc");
    internals(app).pendingStageUrl = "stage://disconnect.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://disconnect.usdc",
      selectedUSDAsset: { name: "disconnect", url: "stage://disconnect.usdc" },
    };
    privateApp.runtimeCommandContexts.set(`req_${method}`, {
      eventType: "openStageRequest",
      stageAttemptGeneration: generation,
      stageUrl: "stage://disconnect.usdc",
    });
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);

    if (method === "_handleStreamStopped") privateApp._handleStreamStopped("stopped", { reason: "test" });
    else privateApp._reconnectStream();

    const terminalLoadingText = internals(app).state.loadingText;
    const terminalStageStatus = internals(app).state.stageLoadStatus;
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: `req_${method}`,
        url: "stage://disconnect.usdc",
      },
    });

    expect(privateApp.activeStageAttempt).toBeNull();
    expect(privateApp.stageAttemptGeneration).toBe(generation + 1);
    expect(internals(app).pendingStageUrl).toBeNull();
    expect(internals(app).state.loadingText, label).toBe(terminalLoadingText);
    expect(internals(app).state.stageLoadStatus, label).toBe(terminalStageStatus);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect((internals(app).state.runtimeCommandLifecycles as Array<{ request_id: string; outcome?: string }>)
      .some((entry) => entry.request_id === `req_${method}` && entry.outcome === "success")).toBe(false);
  });

  it("clears active parent stage proof when the current stream stops", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _handleStreamStopped: (kind: "stopped", message: unknown) => void;
    };
    const stageUrl = "stage://stopped-active.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: stageUrl,
      stageLoadStatus: "matched",
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      showStream: true,
    };
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);

    privateApp._handleStreamStopped("stopped", { reason: "runtime stopped" });

    // 失敗態矩陣 stream-disconnected（task 5.6 slice-3）：viewer 於 WebRTC 終止時
    // 必須對 parent 發 stream_state，console 端才能於 5 秒內轉入可見斷線態。
    const streamStatePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { protocol?: string; type?: string; state?: string; kind?: string })
      .filter((message) => message.type === "stream_state");
    expect(streamStatePosts.length).toBe(1);
    expect(streamStatePosts[0].protocol).toBe("vg01");
    expect(streamStatePosts[0].state).toBe("disconnected");
    expect(streamStatePosts[0].kind).toBe("stopped");

    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("disconnected");
    expect(internals(app).state.showStream).toBe(false);
    expect(renderToString(internals(app).render())).toContain("webrtc_disconnected");
    const unprovenPosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string })
      .filter((message) => (
        message.type === "stage_loaded"
        && message.stageUrl === null
        && message.status === "unproven"
      ));
    expect(unprovenPosts).toHaveLength(1);
  });

  it("terminalizes same-generation focus/A4 work when the stream stops before a late result", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const requestId = "req_focus_after_stream_stop";
    const privateApp = internals(app) as unknown as {
      _handleStreamStopped: (kind: "stopped", message: unknown) => void;
      runtimeCommandContexts: Map<string, { eventType: string }>;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
      a4HandoffPendingRequestId: string | null;
      streamGeneration: number;
    };
    privateApp.runtimeCommandContexts.set(requestId, { eventType: "focusPrimRequest" });
    privateApp.a4HandoffPendingRequestId = requestId;
    internals(app).state = {
      ...internals(app).state,
      a4Handoff: {
        ...(internals(app).state.a4Handoff as Record<string, unknown>),
        status: "pending",
        phase: "executing",
        request_id: requestId,
      },
    };

    privateApp._handleStreamStopped("stopped", { reason: "runtime stopped" });
    const stoppedGeneration = privateApp.streamGeneration;
    internals(app)._handleCustomEvent({
      event_type: "focusPrimResult",
      payload: { request_id: requestId, result: "success" },
    });

    expect(privateApp.streamGeneration).toBe(stoppedGeneration);
    expect(privateApp.runtimeCommandContexts.has(requestId)).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get(requestId)).toEqual({
      eventType: "focusPrimRequest",
      outcome: "superseded",
    });
    expect(internals(app).state.a4Handoff).toEqual(expect.objectContaining({
      status: "rejected",
      phase: "terminal",
      detail: "stream_lifecycle_superseded",
    }));
    expect((internals(app).state.runtimeCommandLifecycles as Array<{ request_id: string; outcome?: string }>)
      .some((entry) => entry.request_id === requestId && entry.outcome === "success")).toBe(false);
  });

  it("advances the stream generation before a deferred React reconnect remount can receive an old stop callback", () => {
    const app = operableApp();
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _handleStreamStopped: (kind: "stopped", message: unknown, streamGeneration?: number) => void;
      _reconnectStream: () => void;
      streamGeneration: number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const oldStreamGeneration = privateApp.streamGeneration;
    vi.spyOn(app, "setState").mockImplementation(() => undefined);
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);

    privateApp._reconnectStream();
    expect(internals(app).state.streamMountKey).toBe(oldStreamGeneration);

    const newAttemptGeneration = privateApp._beginStageAttempt("stage://new-generation.usdc");
    internals(app).pendingStageUrl = "stage://new-generation.usdc";
    privateApp._handleStreamStopped("stopped", { reason: "old generation" }, oldStreamGeneration);

    expect(privateApp.streamGeneration).toBe(oldStreamGeneration + 1);
    expect(privateApp.activeStageAttempt).toEqual({
      generation: newAttemptGeneration,
      status: "pending",
      targetUrl: "stage://new-generation.usdc",
    });
    expect(internals(app).pendingStageUrl).toBe("stage://new-generation.usdc");
  });

  it("fences a stale AppStream failed callback while forwarding the current generation", () => {
    const onStreamFailed = vi.fn();
    const app = new App({ onStreamFailed } as never);
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _reconnectStream: () => void;
    };
    internals(app).state = {
      ...internals(app).state,
      reviewSessionId: "review_session_stream_failed",
      reviewLifecycleStatus: "active",
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: "stage://stream-failed.usdc" },
      },
    };
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    const staleOnStreamFailed = renderedAppStreamProps(app).onStreamFailed;

    privateApp._reconnectStream();
    staleOnStreamFailed();

    expect(onStreamFailed).not.toHaveBeenCalled();
    renderedAppStreamProps(app).onStreamFailed();
    expect(onStreamFailed).toHaveBeenCalledTimes(1);
  });

  it("endpoint lifecycle replacement cancels the old attempt timer before a new AppStream mounts", () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _scheduleStageLoadTimeout: (generation: number) => void;
      _replaceStreamLifecycle: () => number;
      streamGeneration: number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const oldStreamGeneration = privateApp.streamGeneration;
    const oldAttemptGeneration = privateApp._beginStageAttempt("stage://old-endpoint.usdc");
    internals(app).pendingStageUrl = "stage://old-endpoint.usdc";
    privateApp._scheduleStageLoadTimeout(oldAttemptGeneration);
    expect(vi.getTimerCount()).toBe(1);

    const replacementGeneration = privateApp._replaceStreamLifecycle();

    expect(replacementGeneration).toBe(oldStreamGeneration + 1);
    expect(privateApp.activeStageAttempt).toBeNull();
    expect(internals(app).pendingStageUrl).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a replacement stream waits for its own readiness probe instead of scheduling a second stage open", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _onStreamStarted: (streamGeneration?: number) => void;
      _pollForKitReady: () => void;
      _scheduleDeferredOpenStage: () => void;
      streamGeneration: number;
    };
    internals(app).state = {
      ...internals(app).state,
      // Mirrors _bootstrapReview's endpoint-change reset. The previous stream
      // may have been ready, but a replacement must prove its own readiness.
      isKitReady: false,
      selectedUSDAsset: { name: "replacement", url: "stage://replacement.usdc" },
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: "stage://replacement.usdc" },
      },
    };
    const poll = vi.spyOn(privateApp, "_pollForKitReady").mockImplementation(() => undefined);
    const deferredOpen = vi.spyOn(privateApp, "_scheduleDeferredOpenStage");

    privateApp._onStreamStarted();

    expect(poll).toHaveBeenCalledTimes(1);
    expect(deferredOpen).not.toHaveBeenCalled();
  });

  it("bootstrap endpoint replacement resets the ready stream and opens only after the replacement readiness reply", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _bootstrapReview: () => Promise<void>;
      _connectReviewSocket: (sessionId: string, traceId: string) => void;
      _scheduleStreamStartTimeout: () => void;
      _beginA4Handoff: (sessionId: string) => Promise<void>;
      _onStreamStarted: (streamGeneration?: number) => void;
      _pollForKitReady: () => void;
      _openSelectedAsset: () => void;
      coordinatorClient: {
        getReviewSession: (sessionId: string) => Promise<unknown>;
        getStreamConfig: (sessionId: string) => Promise<unknown>;
      };
      streamGeneration: number;
    };
    const previousReviewEnv = {
      defaultSessionId: reviewEnv.defaultSessionId,
      defaultReviewRequestId: reviewEnv.defaultReviewRequestId,
      autoCreateSession: reviewEnv.autoCreateSession,
      hasExplicitEmptySessionId: reviewEnv.hasExplicitEmptySessionId,
    };
    const streamConfig = (signalingPort: number, stageUrl: string) => ({
      session_id: "review_session_x",
      trace_id: DATA_CHANNEL_TRACE_ID,
      lifecycle_status: "active",
      source: "local_fixed",
      webrtc: {
        signalingServer: "127.0.0.1",
        signalingPort,
        mediaServer: "127.0.0.1",
        mediaPort: null,
      },
      model: {
        status: "ready",
        artifact_id: `artifact_${signalingPort}`,
        url: stageUrl,
        mapping_url: null,
        conversion_job_id: null,
      },
      artifacts: [],
      artifact_bindings: [{
        binding_id: `binding_${signalingPort}`,
        artifact_group_id: "group_x",
        model_version_id: "version_x",
        artifact_id: `artifact_${signalingPort}`,
        display_name: `Stage ${signalingPort}`,
        source_ifc_filename: "sample.ifc",
        artifact_role: "derived",
        url: stageUrl,
        mapping_url: null,
        load_order: 0,
        routing_policy: "same_instance",
        ready_status: "ready",
      }],
      kit_instance_bindings: [],
    });

    try {
      reviewEnv.defaultSessionId = "review_session_x";
      reviewEnv.defaultReviewRequestId = "";
      reviewEnv.autoCreateSession = true;
      reviewEnv.hasExplicitEmptySessionId = false;
      vi.spyOn(privateApp.coordinatorClient, "getReviewSession").mockResolvedValue({
        session_id: "review_session_x",
        project_id: "project_x",
        model_version_id: "version_x",
      } as never);
      vi.spyOn(privateApp.coordinatorClient, "getStreamConfig")
        .mockResolvedValueOnce(streamConfig(49100, "stage://old-endpoint.usdc") as never)
        .mockResolvedValueOnce(streamConfig(49101, "stage://replacement-endpoint.usdc") as never);
      vi.spyOn(privateApp, "_connectReviewSocket").mockImplementation(() => undefined);
      vi.spyOn(privateApp, "_scheduleStreamStartTimeout").mockImplementation(() => undefined);
      vi.spyOn(privateApp, "_beginA4Handoff").mockResolvedValue(undefined);

      await privateApp._bootstrapReview();
      const oldGeneration = privateApp.streamGeneration;
      internals(app).state = {
        ...internals(app).state,
        isKitReady: true,
        showStream: true,
        webrtcLifecycleStatus: "started",
      };
      const openSelectedAsset = vi.spyOn(privateApp, "_openSelectedAsset").mockImplementation(() => undefined);
      const pollForKitReady = vi.spyOn(privateApp, "_pollForKitReady").mockImplementation(() => undefined);

      await privateApp._bootstrapReview();

      expect(privateApp.streamGeneration).toBe(oldGeneration + 1);
      expect(internals(app).state).toMatchObject({
        isKitReady: false,
        showStream: false,
        webrtcLifecycleStatus: "initializing",
        streamMountKey: oldGeneration + 1,
      });
      expect(openSelectedAsset).not.toHaveBeenCalled();

      privateApp._onStreamStarted(privateApp.streamGeneration);
      expect(pollForKitReady).toHaveBeenCalledTimes(1);
      expect(openSelectedAsset).not.toHaveBeenCalled();

      internals(app)._handleCustomEvent({
        event_type: "loadingStateResponse",
        payload: {
          url: "stage://replacement-endpoint.usdc",
          loading_state: "idle",
        },
      });
      expect(openSelectedAsset).toHaveBeenCalledTimes(1);
    } finally {
      Object.assign(reviewEnv, previousReviewEnv);
    }
  });

  it("waits for a missing model to become ready before starting the WebRTC timeout", async () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _bootstrapReview: (sessionIdOverride?: string) => Promise<void>;
      _connectReviewSocket: (sessionId: string, traceId: string) => void;
      _scheduleStreamStartTimeout: () => void;
      _beginA4Handoff: (sessionId: string) => Promise<void>;
      coordinatorClient: {
        getReviewSession: (sessionId: string) => Promise<unknown>;
        getStreamConfig: (sessionId: string) => Promise<unknown>;
      };
      componentMounted: boolean;
    };
    const previousReviewEnv = {
      defaultSessionId: reviewEnv.defaultSessionId,
      defaultReviewRequestId: reviewEnv.defaultReviewRequestId,
      autoCreateSession: reviewEnv.autoCreateSession,
      hasExplicitEmptySessionId: reviewEnv.hasExplicitEmptySessionId,
    };
    const streamConfig = (status: "missing" | "ready") => ({
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
        status,
        artifact_id: status === "ready" ? "artifact_ready" : null,
        url: status === "ready" ? "stage://ready.usdc" : null,
        mapping_url: null,
        conversion_job_id: "conversion_pending",
      },
      artifacts: [],
      artifact_bindings: [],
      kit_instance_bindings: [],
    });

    try {
      privateApp.componentMounted = true;
      reviewEnv.defaultSessionId = "review_session_x";
      reviewEnv.defaultReviewRequestId = "";
      reviewEnv.autoCreateSession = true;
      reviewEnv.hasExplicitEmptySessionId = false;
      vi.spyOn(privateApp.coordinatorClient, "getReviewSession").mockResolvedValue({
        session_id: "review_session_x",
        project_id: "project_x",
        model_version_id: "version_x",
      } as never);
      const getStreamConfig = vi.spyOn(privateApp.coordinatorClient, "getStreamConfig")
        .mockResolvedValueOnce(streamConfig("missing") as never)
        .mockResolvedValueOnce(streamConfig("ready") as never);
      vi.spyOn(privateApp, "_connectReviewSocket").mockImplementation(() => undefined);
      const scheduleStreamStart = vi.spyOn(privateApp, "_scheduleStreamStartTimeout").mockImplementation(() => undefined);
      vi.spyOn(privateApp, "_beginA4Handoff").mockResolvedValue(undefined);

      await privateApp._bootstrapReview();

      expect(getStreamConfig).toHaveBeenCalledTimes(1);
      expect(privateApp._connectReviewSocket).toHaveBeenCalledTimes(1);
      expect(scheduleStreamStart).not.toHaveBeenCalled();
      expect(internals(app).state.latestStreamConfig).toMatchObject({ model: { status: "missing" } });

      await vi.advanceTimersByTimeAsync(3_000);

      expect(getStreamConfig).toHaveBeenCalledTimes(2);
      expect(privateApp._connectReviewSocket).toHaveBeenCalledTimes(1);
      expect(internals(app).state.latestStreamConfig).toMatchObject({ model: { status: "ready" } });
      expect(scheduleStreamStart).toHaveBeenCalledTimes(1);
    } finally {
      privateApp.componentMounted = false;
      vi.clearAllTimers();
      vi.useRealTimers();
      Object.assign(reviewEnv, previousReviewEnv);
    }
  });

  it("keeps a new stage attempt intact when old sendMessage resolve and rejection settle after reconnect", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _reconnectStream: () => void;
      _scheduleStreamStartTimeout: () => void;
      _sendStreamMessage: (message: { event_type: string; payload: Record<string, unknown> }) => boolean;
      _isCurrentStreamCallback: (streamGeneration: number, kind: string) => boolean;
      streamGeneration: number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandContexts: Map<string, { eventType: string; stageAttemptGeneration: number; stageUrl: string }>;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
    };
    let resolveOldLoading!: (result: unknown) => void;
    let rejectOldStage!: (reason: unknown) => void;
    let resolveOldHighlight!: (result: unknown) => void;
    const oldLoading = new Promise<unknown>((resolve) => { resolveOldLoading = resolve; });
    const oldStage = new Promise<unknown>((_resolve, reject) => { rejectOldStage = reject; });
    const oldHighlight = new Promise<unknown>((resolve) => { resolveOldHighlight = resolve; });
    vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(oldLoading)
      .mockReturnValueOnce(oldStage)
      .mockReturnValueOnce(oldHighlight);
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_scheduleStreamStartTimeout").mockImplementation(() => undefined);
    const streamGuard = vi.spyOn(privateApp, "_isCurrentStreamCallback");
    const oldStreamGeneration = privateApp.streamGeneration;

    expect(privateApp._sendStreamMessage({ event_type: "loadingStateQuery", payload: {} })).toBe(true);
    const oldAttemptGeneration = privateApp._beginStageAttempt("stage://old-stream.usdc");
    internals(app).pendingStageUrl = "stage://old-stream.usdc";
    expect(privateApp._sendStreamMessage({
      event_type: "openStageRequest",
      payload: { request_id: "req_old_generation_stage", url: "stage://old-stream.usdc" },
    })).toBe(true);
    expect(privateApp.runtimeCommandContexts.get("req_old_generation_stage")).toEqual(expect.objectContaining({
      stageAttemptGeneration: oldAttemptGeneration,
    }));
    expect(privateApp._sendStreamMessage({
      event_type: "highlightPrimsRequest",
      payload: { request_id: "req_old_generation_highlight", mode: "replace", items: [] },
    })).toBe(true);
    expect(privateApp.runtimeCommandContexts.get("req_old_generation_highlight")).toEqual(expect.objectContaining({
      eventType: "highlightPrimsRequest",
    }));

    privateApp._reconnectStream();
    const newAttemptGeneration = privateApp._beginStageAttempt("stage://new-stream.usdc");
    internals(app).pendingStageUrl = "stage://new-stream.usdc";
    privateApp.runtimeCommandContexts.set("req_new_generation_stage", {
      eventType: "openStageRequest",
      stageAttemptGeneration: newAttemptGeneration,
      stageUrl: "stage://new-stream.usdc",
    });
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://new-stream.usdc",
      selectedUSDAsset: { name: "new-stream", url: "stage://new-stream.usdc" },
      loadingText: "new generation loading",
      stageLoadStatus: "pending",
      isKitReady: false,
      webrtcLifecycleStatus: "started",
    };

    resolveOldLoading({
      trace_id: DATA_CHANNEL_TRACE_ID,
      loadingState: "busy",
      url: "stage://old-stream.usdc",
    });
    rejectOldStage(new Error("old stage transport closed"));
    resolveOldHighlight(null);
    await flushMicrotasks();

    expect(privateApp.streamGeneration).toBe(oldStreamGeneration + 1);
    expect(streamGuard).toHaveBeenCalledWith(oldStreamGeneration, "custom-event");
    expect(streamGuard).toHaveBeenCalledWith(oldStreamGeneration, "openStageRequest-error");
    expect(privateApp.activeStageAttempt).toEqual({
      generation: newAttemptGeneration,
      status: "pending",
      targetUrl: "stage://new-stream.usdc",
    });
    expect(privateApp.runtimeCommandContexts.has("req_new_generation_stage")).toBe(true);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_old_generation_stage")).toEqual({
      eventType: "openStageRequest",
      outcome: "superseded",
    });
    expect(privateApp.runtimeCommandContexts.has("req_old_generation_highlight")).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_old_generation_highlight")).toEqual({
      eventType: "highlightPrimsRequest",
      outcome: "superseded",
    });
    expect(internals(app).pendingStageUrl).toBe("stage://new-stream.usdc");
    expect(internals(app).state.loadingText).toBe("new generation loading");
    expect(internals(app).state.stageLoadStatus).toBe("pending");
    expect(internals(app).state.isKitReady).toBe(false);
  });

  it("reconnect rejects old readiness and non-None progress until the new stream has started", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _reconnectStream: () => void;
      _openSelectedAsset: () => void;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: false,
      selectedUSDAsset: { name: "reconnect", url: "stage://reconnect.usdc" },
    };
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    const open = vi.spyOn(privateApp, "_openSelectedAsset");
    privateApp._reconnectStream();
    const reconnectText = internals(app).state.loadingText;

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://old.usdc", loading_state: "busy" },
    });
    internals(app)._handleCustomEvent({
      event_type: "updateProgressActivity",
      payload: { text: "Loading old stage" },
    });

    expect(internals(app).state.webrtcLifecycleStatus).toBe("initializing");
    expect(internals(app).state.isKitReady).toBe(false);
    expect(internals(app).state.loadingText).toBe(reconnectText);
    expect(open).not.toHaveBeenCalled();
  });

  it("accepts an empty first readiness response and opens the selected stage", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _openSelectedAsset: () => void;
    };
    const asset = { name: "fresh runtime", url: "stage://fresh-runtime.usdc" };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: false,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: asset,
      expectedStageUrl: asset.url,
      usdAssets: [asset],
    };
    const open = vi.spyOn(privateApp, "_openSelectedAsset").mockImplementation(() => undefined);

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "", loading_state: "idle" },
    });

    expect(internals(app).state.isKitReady).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ignores an uncorrelated empty-URL loading-state response during an active attempt", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const generation = privateApp._beginStageAttempt("stage://pending.usdc");
    internals(app).pendingStageUrl = "stage://pending.usdc";
    internals(app).loadingStatePollCount = 3;
    internals(app).state = { ...internals(app).state, isKitReady: true, loadingText: "正在載入模型..." };

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "", loading_state: "idle" },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation,
      status: "pending",
    }));
    expect(internals(app).loadingStatePollCount).toBe(3);
    expect(internals(app).state.loadingText).toBe("正在載入模型...");
  });

  it("allows a matching manual loading-state query for a completed attempt without degrading it", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      _recordLoadedStageEvidence: (url: string, source: string, state: string) => boolean;
    };
    const generation = privateApp._beginStageAttempt("stage://completed.usdc");
    privateApp.activeStageAttempt!.status = "completed";
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: "stage://completed.usdc",
      loadedStageUrl: "stage://completed.usdc",
      stageLoadStatus: "matched",
      usdAssets: [{ name: "completed", url: "stage://completed.usdc" }],
    };
    const evidence = vi.spyOn(privateApp, "_recordLoadedStageEvidence").mockReturnValue(true);

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://completed.usdc", loading_state: "idle" },
    });

    expect(evidence).toHaveBeenCalledWith("stage://completed.usdc", "loadingStateResponse", "idle");
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "completed" }));
    expect(internals(app).state.loadedStageUrl).toBe("stage://completed.usdc");
    expect(internals(app).state.stageLoadStatus).toBe("matched");
  });

  it("keeps the timeout diagnostic visible over a remote frame", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _claimStageAttemptTimeout: (generation: number) => void;
      _failStageLoad: (title: string, diagnostic: string, generation: number) => void;
    };
    const generation = privateApp._beginStageAttempt("stage://timeout.usdc");
    internals(app).pendingStageUrl = "stage://timeout.usdc";
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    privateApp._claimStageAttemptTimeout(generation);
    privateApp._failStageLoad("Model loading timed out", "Target: stage://timeout.usdc", generation);

    expect(internals(app).state.showStream).toBe(true);
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain("Model loading timed out");
    expect(html).toContain("Target: stage://timeout.usdc");
  });

  it("redacts credentials and query data from visible stage timeout diagnostics", () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _scheduleStageLoadTimeout: (generation: number) => void;
    };
    const sensitiveStageUrl = "https://viewer:secret@stage.example/model.usdc?X-Amz-Signature=sentinel#fragment";
    internals(app).pendingStageUrl = sensitiveStageUrl;
    const generation = privateApp._beginStageAttempt(sensitiveStageUrl);

    privateApp._scheduleStageLoadTimeout(generation);
    vi.runOnlyPendingTimers();

    expect(internals(app).state.streamDiagnostic).toContain("https://stage.example/model.usdc");
    expect(internals(app).state.streamDiagnostic).not.toContain("viewer:secret");
    expect(internals(app).state.streamDiagnostic).not.toContain("X-Amz-Signature");
    expect(internals(app).state.streamDiagnostic).not.toContain("fragment");
  });

  it("redacts a busy-state URL before its polling timeout becomes visible", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const sensitiveStageUrl = "https://viewer:secret@stage.example/busy.usdc?X-Amz-Signature=sentinel#fragment";
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "busy", url: sensitiveStageUrl },
    };
    internals(app).pendingStageUrl = sensitiveStageUrl;
    internals(app).loadingStatePollCount = 90;

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: sensitiveStageUrl, loading_state: "busy" },
    });

    const html = renderToString(internals(app).render());
    expect(html).toContain("https://stage.example/busy.usdc busy");
    expect(html).not.toContain("viewer:secret");
    expect(html).not.toContain("X-Amz-Signature");
    expect(html).not.toContain("fragment");
  });

  it("keeps every terminal stage failure visible over a stale remote frame", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _failStageLoad: (title: string, diagnostic: string, generation: number) => void;
    };
    const generation = privateApp._beginStageAttempt("stage://rejected.usdc");
    internals(app).pendingStageUrl = "stage://rejected.usdc";
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);

    privateApp._failStageLoad("Model loading failed", "authorization rejected", generation);

    expect(internals(app).state.showStream).toBe(true);
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Model loading failed");
    expect(html).toContain("authorization rejected");
  });

  it("does not send an older same-URL preauthorization after a newer attempt takes ownership", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "same", url: "stage://same.usdc" },
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        stage_composition: {
          primary: { artifact_id: "artifact_same", url: "stage://same.usdc", load_order: 0 },
          secondary_layers: [],
        },
      },
    };
    let resolveFirst: ((value: unknown) => void) | undefined;
    let resolveSecond: ((value: unknown) => void) | undefined;
    const privateApp = internals(app) as unknown as {
      _preauthorizeStageBinding: () => Promise<unknown>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockResolvedValue(true);
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => true);
    const transaction = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_test",
      binding_revision_id: "revision_test",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_same", role: "primary", load_order: 0, usdc_url: "stage://same.usdc" },
        secondary_layers: [],
      },
    };

    internals(app)._openSelectedAsset();
    internals(app)._openSelectedAsset();
    await flushMicrotasks();
    expect(resolveFirst).toBeTypeOf("function");
    expect(resolveSecond).toBeTypeOf("function");
    expect(cancel).toHaveBeenCalledTimes(1);

    resolveFirst?.(transaction);
    await flushMicrotasks();
    expect(send).not.toHaveBeenCalled();

    resolveSecond?.(transaction);
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "openStageRequest" }));
  });

  it("keeps later preauthorization retries fenced when superseded cancellation is not confirmed", async () => {
    const app = operableApp();
    const privateApp = internals(app) as unknown as {
      _preauthorizeStageBindingWithinDeadline: (
        artifacts: Array<{ artifact_id: string; role: "primary" | "secondary"; load_order: number }>,
      ) => Promise<unknown>;
      _preauthorizeStageBinding: (
        artifacts: unknown,
        clientRequestId: string,
        signal?: AbortSignal,
      ) => Promise<unknown>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
    };
    const artifacts = [{ artifact_id: "artifact_primary", role: "primary" as const, load_order: 0 }];
    const preauthorize = vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementation((_artifacts, _clientRequestId, signal) => {
        if (!signal) throw new Error("expected preauthorization abort signal");
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("superseded", "AbortError")),
            { once: true },
          );
        });
      });
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockResolvedValue(false);

    const firstFailure = privateApp._preauthorizeStageBindingWithinDeadline(artifacts).catch((error) => error);
    const secondFailure = privateApp._preauthorizeStageBindingWithinDeadline(artifacts).catch((error) => error);
    expect((await secondFailure as DOMException).name).toBe("AbortError");
    expect((await firstFailure as DOMException).name).toBe("AbortError");

    const thirdFailure = await privateApp._preauthorizeStageBindingWithinDeadline(artifacts).catch((error) => error);
    expect((thirdFailure as DOMException).name).toBe("AbortError");
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel.mock.calls[1]?.[0]).toBe(cancel.mock.calls[0]?.[0]);
    expect(preauthorize).toHaveBeenCalledTimes(1);
  });

  it("bounds preauthorization cancellation while primary lease acquisition stalls", async () => {
    vi.useFakeTimers();
    const app = operableApp();
    internals(app).state = { ...internals(app).state, reviewSessionId: "review_session_x" };
    const privateApp = internals(app) as unknown as {
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      _ensureStandaloneLabUserToken: () => string;
      _ensurePrimaryViewerLease: () => Promise<string | null>;
    };
    vi.spyOn(privateApp, "_ensureStandaloneLabUserToken").mockReturnValue("test-user-token");
    vi.spyOn(privateApp, "_ensurePrimaryViewerLease").mockImplementation(() => new Promise(() => {}));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cancellation = privateApp._cancelStageBindingPreauthorization("stage_preauth_stalled_lease");
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(cancellation).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts the manual Kit proof deadline only after preauthorization sends the command", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://manual-deadline.usdc";
    const privateApp = internals(app) as unknown as {
      _openSelectedAsset: () => void;
      _preauthorizeStageBinding: () => Promise<unknown>;
      _scheduleStageLoadTimeout: (generation: number) => void;
      _scheduleLoadingStateQuery: (delayMs?: number) => void;
    };
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "manual deadline", url: stageUrl },
      expectedStageUrl: stageUrl,
      usdAssets: [{ name: "manual deadline", url: stageUrl }],
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: stageUrl },
        artifact_bindings: [{ artifact_id: "artifact_manual_deadline", url: stageUrl, load_order: 0 }],
      },
    };
    let resolvePreauthorization: ((value: unknown) => void) | undefined;
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementation(() => new Promise((resolve) => { resolvePreauthorization = resolve; }));
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const send = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({} as never);
    const schedule = vi.spyOn(privateApp, "_scheduleStageLoadTimeout").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_scheduleLoadingStateQuery").mockImplementation(() => undefined);

    privateApp._openSelectedAsset();
    expect(send).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();

    resolvePreauthorization?.({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_manual_deadline",
      binding_revision_id: "revision_manual_deadline",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_manual_deadline", role: "primary", load_order: 0, usdc_url: stageUrl },
        secondary_layers: [],
      },
    });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "openStageRequest" }));
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale busy probe until manual preauthorization dispatches the command", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://manual-authorization-fence.usdc";
    const privateApp = internals(app) as unknown as {
      _openSelectedAsset: () => void;
      _preauthorizeStageBinding: () => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      _scheduleStageLoadTimeout: (generation: number) => void;
      stageDispatchCallbacks: WeakMap<object, () => void>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "manual authorization fence", url: stageUrl },
      expectedStageUrl: stageUrl,
      usdAssets: [{ name: "manual authorization fence", url: stageUrl }],
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: stageUrl },
        artifact_bindings: [{ artifact_id: "artifact_manual_authorization_fence", url: stageUrl, load_order: 0 }],
      },
    };
    let resolvePreauthorization: ((value: unknown) => void) | undefined;
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementation(() => new Promise((resolve) => { resolvePreauthorization = resolve; }));
    const send = vi.spyOn(privateApp, "_sendStreamMessage").mockImplementation((message) => {
      privateApp.stageDispatchCallbacks.get(message as object)?.();
      return true;
    });
    const schedule = vi.spyOn(privateApp, "_scheduleStageLoadTimeout").mockImplementation(() => undefined);
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);

    privateApp._openSelectedAsset();
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: stageUrl, loading_state: "busy" },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: stageUrl,
    }));
    expect(internals(app).state.stageLoadStatus).toBe("pending");
    expect(send).not.toHaveBeenCalled();

    resolvePreauthorization?.({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_manual_fence",
      binding_revision_id: "revision_manual_fence",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_manual_authorization_fence", role: "primary", load_order: 0, usdc_url: stageUrl },
        secondary_layers: [],
      },
    });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "openStageRequest" }));
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("times out manual preauthorization separately without claiming a Kit stage timeout", async () => {
    vi.useFakeTimers();
    setLang("en");
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://manual-authorization-timeout.usdc";
    const privateApp = internals(app) as unknown as {
      _openSelectedAsset: () => void;
      _preauthorizeStageBinding: (
        artifacts: unknown,
        clientRequestId: string,
        signal?: AbortSignal,
      ) => Promise<unknown>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      _sendStreamMessage: (message: unknown) => boolean;
      activeStageAttempt: { status: string; terminalReason?: string } | null;
    };
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: { name: "manual authorization timeout", url: stageUrl },
      expectedStageUrl: stageUrl,
      usdAssets: [{ name: "manual authorization timeout", url: stageUrl }],
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: stageUrl },
        artifact_bindings: [{ artifact_id: "artifact_manual_authorization_timeout", url: stageUrl, load_order: 0 }],
      },
    };
    let preauthorizationSignal: AbortSignal | undefined;
    const preauthorize = vi.spyOn(privateApp, "_preauthorizeStageBinding").mockImplementation((_artifacts, _clientRequestId, signal) => {
      preauthorizationSignal = signal;
      return new Promise(() => {});
    });
    let confirmCancellation!: (confirmed: boolean) => void;
    const cancellation = new Promise<boolean>((resolve) => { confirmCancellation = resolve; });
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockReturnValue(cancellation);
    const send = vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(true);

    privateApp._openSelectedAsset();
    await vi.advanceTimersByTimeAsync(45_000);

    expect(send).not.toHaveBeenCalled();
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
    expect(privateApp.activeStageAttempt?.terminalReason).toBeUndefined();
    expect(preauthorizationSignal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith(expect.stringMatching(/^stage_preauth_/));
    expect(internals(app).state.streamDiagnostic).toContain(
      "Stage binding authorization timed out before a load command was sent to Kit.",
    );

    privateApp._openSelectedAsset();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(preauthorize).toHaveBeenCalledTimes(1);

    confirmCancellation(true);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(preauthorize).toHaveBeenCalledTimes(2);
  });

  it("does not let an older binding preauthorization overwrite a newer manual open", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const bindingStageUrl = "stage://binding-pending.usdc";
    const manualStageUrl = "stage://manual-open.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: null,
      selectedUSDAsset: { name: "manual", url: manualStageUrl },
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        stage_composition: {
          primary: { artifact_id: "artifact_manual", url: manualStageUrl, load_order: 0 },
          secondary_layers: [],
        },
      },
    };
    let resolveBinding: ((value: unknown) => void) | undefined;
    let resolveManualOpen: ((value: unknown) => void) | undefined;
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _openSelectedAsset: AppInternals["_openSelectedAsset"];
      _preauthorizeStageBinding: () => Promise<unknown>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveBinding = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveManualOpen = resolve; }));
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockResolvedValue(true);
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => true);
    const bindingTransaction = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_binding",
      binding_revision_id: "revision_binding",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_binding", role: "primary", load_order: 0, usdc_url: bindingStageUrl },
        secondary_layers: [],
      },
    };
    const manualOpenTransaction = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_manual",
      binding_revision_id: "revision_manual",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_manual", role: "primary", load_order: 0, usdc_url: manualStageUrl },
        secondary_layers: [],
      },
    };

    privateApp._applyBinding([{
      artifact_id: "artifact_binding",
      model_version_id: "version_binding",
      usdc_url: bindingStageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding");
    privateApp._openSelectedAsset();
    await flushMicrotasks();
    expect(resolveBinding).toBeTypeOf("function");
    expect(resolveManualOpen).toBeTypeOf("function");
    expect(cancel).toHaveBeenCalledTimes(1);

    resolveManualOpen?.(manualOpenTransaction);
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "openStageRequest" }));
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: manualStageUrl,
    }));

    resolveBinding?.(bindingTransaction);
    await flushMicrotasks();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: "loadArtifactGroupRequest" }));
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: manualStageUrl,
    }));
  });

  it("ignores stale loading-state probes while binding preauthorization is pending", async () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const knownStageUrl = "stage://known.usdc";
    const bindingStageUrl = "stage://binding-pending.usdc";
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "known", url: knownStageUrl },
      usdAssets: [{ name: "known", url: knownStageUrl }],
      loadingText: "等待 binding authorization",
      stageLoadStatus: "unproven",
      isLoading: false,
    };
    let resolvePreauthorization: ((value: unknown) => void) | undefined;
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: () => Promise<unknown>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementation(() => new Promise((resolve) => { resolvePreauthorization = resolve; }));
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => true);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_pending",
      model_version_id: "version_binding_pending",
      usdc_url: bindingStageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_pending");
    for (let i = 0; i < 91; i++) {
      internals(app)._handleCustomEvent({
        event_type: "loadingStateResponse",
        payload: { url: knownStageUrl, loading_state: "busy" },
      });
    }

    expect(privateApp.activeStageAttempt).toBeNull();
    expect(internals(app).loadingStatePollCount).toBe(0);
    expect(internals(app).state.loadingText).toBe("等待 binding authorization");
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
    expect(send).not.toHaveBeenCalled();

    resolvePreauthorization?.({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_binding_pending",
      binding_revision_id: "revision_binding_pending",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_binding_pending", role: "primary", load_order: 0, usdc_url: bindingStageUrl },
        secondary_layers: [],
      },
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: bindingStageUrl,
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "loadArtifactGroupRequest" }));
  });

  it("does not send a pending binding after reconnect invalidates its stage intent", async () => {
    vi.useFakeTimers();
    const app = operableApp();
    useSynchronousSetState(app);
    const bindingStageUrl = "stage://binding-reconnect-pending.usdc";
    let resolvePreauthorization: ((value: unknown) => void) | undefined;
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _reconnectStream: () => void;
      _preauthorizeStageBinding: () => Promise<unknown>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementation(() => new Promise((resolve) => { resolvePreauthorization = resolve; }));
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => undefined);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_reconnect_pending",
      model_version_id: "version_binding_reconnect_pending",
      usdc_url: bindingStageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_reconnect_pending");
    privateApp._reconnectStream();
    expect(internals(app).state.webrtcLifecycleStatus).toBe("initializing");
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "stage_binding_apply_superseded",
    });

    resolvePreauthorization?.({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_binding_reconnect_pending",
      binding_revision_id: "revision_binding_reconnect_pending",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_binding_reconnect_pending", role: "primary", load_order: 0, usdc_url: bindingStageUrl },
        secondary_layers: [],
      },
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(privateApp.activeStageAttempt).toBeNull();
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: "loadArtifactGroupRequest" }));
    expect(internals(app).state.webrtcLifecycleStatus).toBe("initializing");
  });

  it.each([
    {
      language: "zh" as const,
      title: "模型載入失敗",
      diagnostic: "無法建立 stage binding authorization，已阻擋載入指令",
      alternateTitle: "Model loading failed",
      alternateDiagnostic: "Could not create stage binding authorization; the stage-load command was blocked.",
    },
    {
      language: "en" as const,
      title: "Model loading failed",
      diagnostic: "Could not create stage binding authorization; the stage-load command was blocked.",
      alternateTitle: "模型載入失敗",
      alternateDiagnostic: "無法建立 stage binding authorization，已阻擋載入指令",
    },
  ])("$language renders the current binding preauthorization rejection as a visible terminal failure", async (copy) => {
    setLang(copy.language);
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: () => Promise<unknown>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageLoadFailureActive: boolean;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockRejectedValue(new Error("coordinator unavailable"));
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => undefined);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_rejected",
      model_version_id: "version_binding_rejected",
      usdc_url: "stage://binding-rejected.usdc",
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_rejected");
    await flushMicrotasks();

    expect(send).not.toHaveBeenCalled();
    expect(privateApp.activeStageAttempt).toBeNull();
    expect(privateApp.stageLoadFailureActive).toBe(true);
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "coordinator stage binding preauthorization 失敗",
    });
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.diagnostic);
    expect(html).not.toContain(copy.alternateTitle);
    expect(html).not.toContain(copy.alternateDiagnostic);
  });

  it("ignores an older binding preauthorization rejection after a newer manual open", async () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const bindingStageUrl = "stage://binding-reject-pending.usdc";
    const manualStageUrl = "stage://manual-reject-open.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: null,
      selectedUSDAsset: { name: "manual", url: manualStageUrl },
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        stage_composition: {
          primary: { artifact_id: "artifact_manual_reject", url: manualStageUrl, load_order: 0 },
          secondary_layers: [],
        },
      },
    };
    let rejectBinding: ((reason?: unknown) => void) | undefined;
    let resolveManualOpen: ((value: unknown) => void) | undefined;
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _openSelectedAsset: AppInternals["_openSelectedAsset"];
      _preauthorizeStageBinding: () => Promise<unknown>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectBinding = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveManualOpen = resolve; }));
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockResolvedValue(true);
    const send = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => true);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_reject_pending",
      model_version_id: "version_binding_reject_pending",
      usdc_url: bindingStageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_reject_pending");
    privateApp._openSelectedAsset();
    await flushMicrotasks();
    expect(rejectBinding).toBeTypeOf("function");
    expect(resolveManualOpen).toBeTypeOf("function");
    expect(cancel).toHaveBeenCalledTimes(1);

    resolveManualOpen?.({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "authorization_manual_reject",
      binding_revision_id: "revision_manual_reject",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_manual_reject", role: "primary", load_order: 0, usdc_url: manualStageUrl },
        secondary_layers: [],
      },
    });
    await flushMicrotasks();
    rejectBinding?.(new Error("older binding rejected"));
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: "openStageRequest" }));
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: manualStageUrl,
    }));
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "stage_binding_apply_superseded",
    });
    expect(renderToString(internals(app).render())).not.toContain('data-testid="stage-load-failure"');
  });

  it.each([
    {
      language: "zh" as const,
      advisory: "stage 已觀察，等待已關聯的完成證據",
      alternateAdvisory: "Stage observed; awaiting correlated completion evidence.",
    },
    {
      language: "en" as const,
      advisory: "Stage observed; awaiting correlated completion evidence.",
      alternateAdvisory: "stage 已觀察，等待已關聯的完成證據",
    },
  ])("$language keeps an uncorrelated same-target idle response advisory", (copy) => {
    setLang(copy.language);
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageLoadFailureActive: boolean;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "selected", url: "stage://selected-idle.usdc" },
      usdAssets: [{ name: "selected", url: "stage://selected-idle.usdc" }],
    };
    const generation = privateApp._beginStageAttempt("stage://unknown-idle.usdc");
    internals(app).pendingStageUrl = "stage://unknown-idle.usdc";

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://unknown-idle.usdc", loading_state: "idle" },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation,
      status: "pending",
      targetUrl: "stage://unknown-idle.usdc",
    }));
    expect(privateApp.stageLoadFailureActive).toBe(false);
    expect(internals(app).state.loadingText).toBe(copy.advisory);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    const html = renderToString(internals(app).render());
    expect(html).not.toContain('data-testid="stage-load-failure"');
    expect(html).toContain(copy.advisory);
    expect(html).not.toContain(copy.alternateAdvisory);
  });

  it("reconnect resolves an old stalled harness request without replaying it into the new generation", async () => {
    vi.useFakeTimers();
    const firstStart = vi.fn();
    const firstEvent = vi.fn();
    const secondStart = vi.fn();
    const secondEvent = vi.fn();
    const props = (onStart: (message: unknown) => void, onCustomEvent: (message: unknown) => void) => ({
      streamConfig: { onStart, onCustomEvent, onStreamStats: vi.fn() },
    });
    try {
      await FakeAppStreamer.connect(props(firstStart, firstEvent));
      const controls = globalThis as typeof globalThis & {
        __AI_BIM_FAKE_KIT__?: { stallNextStageLoad: () => void };
      };
      expect(controls.__AI_BIM_FAKE_KIT__?.stallNextStageLoad).toBeTypeOf("function");
      controls.__AI_BIM_FAKE_KIT__!.stallNextStageLoad();
      const stalled = FakeAppStreamer.sendMessage({
        event_type: "openStageRequest",
        payload: {
          session_id: HARNESS_REVIEW_AUTHORITY.sessionId,
          trace_id: HARNESS_REVIEW_AUTHORITY.traceId,
          url: "harness://stage/World/sample-building.usd",
        },
      });

      await FakeAppStreamer.connect(props(secondStart, secondEvent));
      await expect(stalled).resolves.toBeNull();
      await vi.runAllTimersAsync();

      expect(firstStart).not.toHaveBeenCalled();
      expect(firstEvent).not.toHaveBeenCalled();
      expect(secondStart).toHaveBeenCalledTimes(1);
      expect(secondEvent).not.toHaveBeenCalled();
    } finally {
      FakeAppStreamer.terminate();
    }
  });

  it("stalled harness busy events use the same default stage URL as the completion response", async () => {
    vi.useFakeTimers();
    const onCustomEvent = vi.fn();
    try {
      await FakeAppStreamer.connect({
        streamConfig: { onStart: vi.fn(), onCustomEvent, onStreamStats: vi.fn() },
      });
      const controls = globalThis as typeof globalThis & {
        __AI_BIM_FAKE_KIT__?: {
          stallNextStageLoad: () => void;
          emitBusyStageResponses: (count: number) => void;
        };
      };
      expect(controls.__AI_BIM_FAKE_KIT__?.stallNextStageLoad).toBeTypeOf("function");
      expect(controls.__AI_BIM_FAKE_KIT__?.emitBusyStageResponses).toBeTypeOf("function");
      controls.__AI_BIM_FAKE_KIT__!.stallNextStageLoad();
      void FakeAppStreamer.sendMessage({
        event_type: "openStageRequest",
        payload: {
          session_id: HARNESS_REVIEW_AUTHORITY.sessionId,
          trace_id: HARNESS_REVIEW_AUTHORITY.traceId,
        },
      });
      controls.__AI_BIM_FAKE_KIT__!.emitBusyStageResponses(1);
      await vi.runAllTimersAsync();

      expect(onCustomEvent).toHaveBeenCalledWith(expect.objectContaining({
        event_type: "loadingStateResponse",
        payload: expect.objectContaining({ url: "harness://stage/World/sample-building.usd" }),
      }));
    } finally {
      FakeAppStreamer.terminate();
    }
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

  it("stale same-URL changed_unconfirmed resync 不得把 A 升級給 B，且 B 的 exact proof 可恢復", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _applyChangedUnconfirmedStageSafety: (
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        stageAttemptGeneration: number | null | undefined,
      ) => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId?: string;
        stageUrl?: string;
        stageAttemptGeneration?: number;
      }>;
      _getChildren: () => void;
    };
    const stageUrl = "stage://same-url-resync.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "same-url", url: stageUrl },
    };
    const bindingResponse = (revision: string) => new Response(JSON.stringify({
      stage_binding: {
        active_binding_revision: revision,
        last_good_binding_revision: revision,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(bindingResponse("rev_a"))
      .mockResolvedValueOnce(bindingResponse("rev_b"));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    const attemptA = privateApp._beginStageAttempt(stageUrl);
    const attemptB = privateApp._beginStageAttempt(stageUrl);
    parent.postMessage.mockClear();

    privateApp._applyChangedUnconfirmedStageSafety("rev_a", stageUrl, attemptA);
    await flushMicrotasks();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "pending",
      targetUrl: stageUrl,
    }));
    expect(privateApp.stageProofBlockedRevision).toBe("rev_a");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(parent.postMessage.mock.calls.map((call) => call[0])).not.toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl,
      status: "active",
      binding_revision_id: "rev_a",
    }));

    privateApp.runtimeCommandContexts.set("req_b", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_b",
      stageUrl,
      stageAttemptGeneration: attemptB,
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_b",
        url: stageUrl,
        binding_revision_id: "rev_b",
      },
    });
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "completed",
      targetUrl: stageUrl,
    }));
    expect(privateApp.stageProofBlockedRevision).toBeNull();
    expect(internals(app).state.loadedStageUrl).toBe(stageUrl);
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(parent.postMessage.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl,
      status: "active",
      binding_revision_id: "rev_b",
    }));
  });

  it("late non-stage changed_unconfirmed 不得用舊 B status 跨 revision 恢復 proof", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _applyChangedUnconfirmedStageSafety: (
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        stageAttemptGeneration: number | null | undefined,
      ) => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId?: string;
        stageUrl?: string;
        stageAttemptGeneration?: number;
      }>;
      _getChildren: () => void;
    };
    const stageB = "stage://completed-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "completed-b", url: stageB },
    };
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      stage_binding: {
        active_binding_revision: "rev_b",
        last_good_binding_revision: "rev_b",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    const attemptB = privateApp._beginStageAttempt(stageB);
    privateApp.runtimeCommandContexts.set("req_completed_b", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_b",
      stageUrl: stageB,
      stageAttemptGeneration: attemptB,
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_completed_b",
        url: stageB,
        binding_revision_id: "rev_b",
      },
    });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "completed",
    }));
    parent.postMessage.mockClear();

    privateApp._applyChangedUnconfirmedStageSafety(
      "rev_a",
      "stage://late-compose-a.usdc",
      undefined,
    );
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(privateApp.stageProofBlockedRevision).toBe("rev_a");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    const stagePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string; binding_revision_id?: string })
      .filter((message) => message.type === "stage_loaded");
    expect(stagePosts).toContainEqual(expect.objectContaining({ stageUrl: null, status: "unproven" }));
    expect(stagePosts).not.toContainEqual(expect.objectContaining({
      stageUrl: stageB,
      status: "active",
      binding_revision_id: "rev_b",
    }));
  });

  it("B status resync 在 B proof timeout 後不得覆寫 terminal failure", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _applyChangedUnconfirmedStageSafety: (
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        stageAttemptGeneration: number | null | undefined,
      ) => void;
      _failStageLoad: (loadingText: string, diagnostic: string, attemptGeneration: number) => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId?: string;
        stageUrl?: string;
        stageAttemptGeneration?: number;
      }>;
      _getChildren: () => void;
    };
    const stageUrl = "stage://timeout-resync-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "timeout-resync-b", url: stageUrl },
    };
    const bindingResponse = (revision: string) => new Response(JSON.stringify({
      stage_binding: {
        active_binding_revision: revision,
        last_good_binding_revision: revision,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    let resolveBStatus: (response: Response) => void = () => {};
    const pendingBStatus = new Promise<Response>((resolve) => { resolveBStatus = resolve; });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(bindingResponse("rev_a"))
      .mockImplementationOnce(() => pendingBStatus);
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    const attemptA = privateApp._beginStageAttempt(stageUrl);
    const attemptB = privateApp._beginStageAttempt(stageUrl);
    privateApp._applyChangedUnconfirmedStageSafety("rev_a", stageUrl, attemptA);
    await flushMicrotasks();
    parent.postMessage.mockClear();

    privateApp.runtimeCommandContexts.set("req_timeout_b", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_b",
      stageUrl,
      stageAttemptGeneration: attemptB,
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_timeout_b",
        url: stageUrl,
        binding_revision_id: "rev_b",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    privateApp._failStageLoad("stage-load-timeout", "test-timeout", attemptB);
    resolveBStatus(bindingResponse("rev_b"));
    await flushMicrotasks();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "terminal",
    }));
    expect(privateApp.stageProofBlockedRevision).toBe("rev_b");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(parent.postMessage.mock.calls.map((call) => call[0])).not.toContainEqual(expect.objectContaining({
      type: "stage_loaded",
      stageUrl,
      status: "active",
      binding_revision_id: "rev_b",
    }));
  });

  it("B status resync 在 lifecycle invalidation 後不得跨 attempt 升級", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    reviewEnv.userToken = "local_user_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _applyChangedUnconfirmedStageSafety: (
        bindingRevisionId: string | undefined,
        stageUrl: string | null | undefined,
        stageAttemptGeneration: number | null | undefined,
      ) => void;
      _invalidateStageAttempt: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId?: string;
        stageUrl?: string;
        stageAttemptGeneration?: number;
      }>;
      _getChildren: () => void;
    };
    const stageUrl = "stage://invalidated-resync-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      selectedUSDAsset: { name: "invalidated-resync-b", url: stageUrl },
    };
    const bindingResponse = (revision: string) => new Response(JSON.stringify({
      stage_binding: {
        active_binding_revision: revision,
        last_good_binding_revision: revision,
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    let resolveBStatus: (response: Response) => void = () => {};
    const pendingBStatus = new Promise<Response>((resolve) => { resolveBStatus = resolve; });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(bindingResponse("rev_a"))
      .mockImplementationOnce(() => pendingBStatus);
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    const attemptA = privateApp._beginStageAttempt(stageUrl);
    const attemptB = privateApp._beginStageAttempt(stageUrl);
    privateApp._applyChangedUnconfirmedStageSafety("rev_a", stageUrl, attemptA);
    await flushMicrotasks();
    parent.postMessage.mockClear();

    privateApp.runtimeCommandContexts.set("req_invalidated_b", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_b",
      stageUrl,
      stageAttemptGeneration: attemptB,
    });
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_invalidated_b",
        url: stageUrl,
        binding_revision_id: "rev_b",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    privateApp._invalidateStageAttempt();
    resolveBStatus(bindingResponse("rev_b"));
    await flushMicrotasks();

    expect(privateApp.activeStageAttempt).toBeNull();
    expect(privateApp.stageProofBlockedRevision).toBe("rev_b");
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(parent.postMessage.mock.calls.map((call) => call[0])).not.toContainEqual(expect.objectContaining({
      type: "stage_loaded",
      stageUrl,
      status: "active",
      binding_revision_id: "rev_b",
    }));
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
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);

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
    expect(internals(app).state.showStream).toBe(true);
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain("模型組合僅部分套用");
    expect(parent.postMessage.mock.calls.map((call) => call[0])).toContainEqual(expect.objectContaining({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: null,
      status: "unproven",
      binding_revision_id: "rev_b",
    }));
    const unprovenPosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string; binding_revision_id?: string })
      .filter((message) => (
        message.type === "stage_loaded"
        && message.stageUrl === null
        && message.status === "unproven"
        && message.binding_revision_id === "rev_b"
      ));
    expect(unprovenPosts).toHaveLength(1);
  });

  it("晚到的 superseded A changed_failed 不得使 pending B 失敗或通知 parent", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId: string;
        stageUrl: string;
        stageAttemptGeneration: number;
      }>;
      stageLoadFailureActive: boolean;
    };
    const stageA = "stage://late-changed-failed-a.usdc";
    const stageB = "stage://pending-b.usdc";
    const attemptA = privateApp._beginStageAttempt(stageA);
    privateApp.runtimeCommandContexts.set("req_late_changed_failed_a", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_late_changed_failed_a",
      stageUrl: stageA,
      stageAttemptGeneration: attemptA,
    });
    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      selectedUSDAsset: { name: "pending B", url: stageB },
      loadedStageUrl: null,
      stageLoadStatus: "pending",
    };
    parent.postMessage.mockClear();

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "error",
        request_id: "req_late_changed_failed_a",
        url: stageA,
        error: "late partial failure",
        binding_revision_id: "rev_late_changed_failed_a",
        runtime_state: "changed_failed",
        partial_load: true,
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "pending",
      targetUrl: stageB,
    }));
    expect(privateApp.stageLoadFailureActive).toBe(false);
    expect(internals(app).state.stageLoadStatus).toBe("pending");
    expect(parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string })
      .filter((message) => message.type === "stage_loaded"))
      .toHaveLength(0);
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
    const preauthorizationBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(preauthorizationBody).toMatchObject({
      source_client_id: "viewer_lease_primary",
      role: "primary",
      artifacts: [{ artifact_id: "artifact_primary", role: "primary", load_order: 0 }],
    });
    expect(preauthorizationBody.client_request_id).toMatch(/^stage_preauth_/);
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

  it("starts a fresh binding attempt and correlates the composition load command", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: () => Promise<Record<string, unknown>>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        stageAttemptGeneration?: number;
        stageUrl?: string;
      }>;
    };
    const transaction = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "stage_auth_retry",
      binding_revision_id: "rev_binding_retry",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: {
          artifact_id: "artifact_retry",
          role: "primary",
          load_order: 0,
          usdc_url: "stage://binding-retry.usdc",
        },
        secondary_layers: [],
      },
    };
    const preauthorize = vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue(transaction);
    const send = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const selection = [{
      artifact_id: "artifact_retry",
      model_version_id: "version_retry",
      usdc_url: "stage://binding-retry.usdc",
      role: "primary" as const,
      load_order: 0,
      ready: true,
    }];

    privateApp._applyBinding(selection, "rev_ui_retry");
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const firstAttempt = privateApp.activeStageAttempt;
    expect(firstAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: "stage://binding-retry.usdc",
    }));
    expect(internals(app).pendingStageUrl).toBe("stage://binding-retry.usdc");
    const firstStageLoadPayload = send.mock.calls
      .map(([message]) => message as { event_type?: string; payload?: unknown })
      .find((message) => message.event_type === "loadArtifactGroupRequest")?.payload as { request_id: string };
    expect(privateApp.runtimeCommandContexts.get(firstStageLoadPayload.request_id)).toEqual(expect.objectContaining({
      eventType: "loadArtifactGroupRequest",
      stageAttemptGeneration: firstAttempt!.generation,
      stageUrl: "stage://binding-retry.usdc",
    }));

    expect(preauthorize).toHaveBeenCalledTimes(1);
  });

  it("fences a prior stage attempt before newer binding preauthorization resolves", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _beginStageAttempt: (url: string) => number;
      _preauthorizeStageBinding: () => Promise<Record<string, unknown>>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId: string;
        stageUrl: string;
        stageAttemptGeneration: number;
      }>;
    };
    const priorStageUrl = "stage://prior-before-preauth.usdc";
    const nextStageUrl = "stage://next-before-preauth.usdc";
    const priorGeneration = privateApp._beginStageAttempt(priorStageUrl);
    internals(app).pendingStageUrl = priorStageUrl;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: priorStageUrl,
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      runtimeCommandLifecycles: [{
        request_id: "req_prior_before_preaut",
        event_type: "loadArtifactGroupRequest",
        phases: ["pending"],
      }],
    };
    privateApp.runtimeCommandContexts.set("req_prior_before_preaut", {
      eventType: "loadArtifactGroupRequest",
      bindingRevisionId: "rev_prior_before_preaut",
      stageUrl: priorStageUrl,
      stageAttemptGeneration: priorGeneration,
    });
    let resolvePreauthorization!: (value: Record<string, unknown>) => void;
    const preauthorization = new Promise<Record<string, unknown>>((resolve) => { resolvePreauthorization = resolve; });
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockImplementation(() => preauthorization);
    const send = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});

    privateApp._applyBinding([{
      artifact_id: "artifact_next_before_preaut",
      model_version_id: "version_next_before_preaut",
      usdc_url: nextStageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_ui_next_before_preaut");

    expect(privateApp.activeStageAttempt).toBeNull();
    expect(internals(app).pendingStageUrl).toBeNull();
    expect(privateApp.runtimeCommandContexts.has("req_prior_before_preaut")).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_prior_before_preaut")).toEqual({
      eventType: "loadArtifactGroupRequest",
      outcome: "superseded",
    });

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_prior_before_preaut",
        url: priorStageUrl,
        binding_revision_id: "rev_prior_before_preaut",
      },
    });
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: "req_prior_before_preaut",
        phases: ["pending", "terminal"],
        outcome: "superseded",
      }),
    ]));

    resolvePreauthorization({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "stage_auth_next_before_preaut",
      binding_revision_id: "rev_next_before_preaut",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: {
          artifact_id: "artifact_next_before_preaut",
          role: "primary",
          load_order: 0,
          usdc_url: nextStageUrl,
        },
        secondary_layers: [],
      },
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: nextStageUrl,
    }));
    expect(send.mock.calls.filter(([message]) => (message as { event_type?: string }).event_type === "loadArtifactGroupRequest"))
      .toHaveLength(1);
  });

  it.each([
    {
      language: "zh" as const,
      title: "模型載入失敗",
      target: "目標：stage://binding-send-rejected.usdc",
      error: "錯誤：stream_transport_error",
      alternateTitle: "Model loading failed",
      alternateTarget: "Target: stage://binding-send-rejected.usdc",
      alternateError: "Error: stream_transport_error",
    },
    {
      language: "en" as const,
      title: "Model loading failed",
      target: "Target: stage://binding-send-rejected.usdc",
      error: "Error: stream_transport_error",
      alternateTitle: "模型載入失敗",
      alternateTarget: "目標：stage://binding-send-rejected.usdc",
      alternateError: "錯誤：stream_transport_error",
    },
  ])("$language terminalizes a binding attempt when its composition send is rejected and ignores a later success", async (copy) => {
    vi.useFakeTimers();
    setLang(copy.language);
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: () => Promise<Record<string, unknown>>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
      runtimeCommandContexts: Map<string, { eventType: string }>;
    };
    const stageUrl = "stage://binding-send-rejected.usdc";
    const transaction = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "stage_auth_send_rejected",
      binding_revision_id: "rev_binding_send_rejected",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: {
          artifact_id: "artifact_send_rejected",
          role: "primary",
          load_order: 0,
          usdc_url: stageUrl,
        },
        secondary_layers: [],
      },
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue(transaction);
    const send = vi.spyOn(AppStream, "sendMessage").mockRejectedValue(new Error("stream transport failed"));

    privateApp._applyBinding([{
      artifact_id: "artifact_send_rejected",
      model_version_id: "version_send_rejected",
      usdc_url: stageUrl,
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_ui_send_rejected");
    for (let i = 0; i < 20; i++) await Promise.resolve();

    const sent = send.mock.calls.find(([message]) => (
      (message as { event_type?: string }).event_type === "loadArtifactGroupRequest"
    ))?.[0] as { payload: { request_id: string } } | undefined;
    expect(sent).toBeDefined();
    const requestId = sent!.payload.request_id;
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "terminal",
      targetUrl: stageUrl,
    }));
    expect(internals(app).pendingStageUrl).toBeNull();
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.loadingText).toBe(copy.title);
    expect(internals(app).state.streamDiagnostic).toContain(copy.target);
    expect(internals(app).state.streamDiagnostic).toContain(copy.error);
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: copy.title,
    });
    expect(privateApp.runtimeCommandContexts.has(requestId)).toBe(false);
    expect(privateApp.runtimeCommandTerminalClaims.get(requestId)).toEqual({
      eventType: "loadArtifactGroupRequest",
      outcome: "error",
    });
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: requestId,
        phases: ["pending", "terminal"],
        outcome: "error",
      }),
    ]));
    const html = renderToString(internals(app).render());
    expect(html).toContain('data-testid="stage-load-failure"');
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.target);
    expect(html).toContain(copy.error);
    expect(html).not.toContain(copy.alternateTitle);
    expect(html).not.toContain(copy.alternateTarget);
    expect(html).not.toContain(copy.alternateError);

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: requestId,
        url: stageUrl,
        binding_revision_id: transaction.binding_revision_id,
      },
    });
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
  });

  it("ignores a stale binding preauthorization resolution after a newer apply owns the stage", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: (
        artifacts: unknown,
        clientRequestId: string,
      ) => Promise<Record<string, unknown>>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    let resolveA!: (value: Record<string, unknown>) => void;
    let resolveB!: (value: Record<string, unknown>) => void;
    const authorizationA = new Promise<Record<string, unknown>>((resolve) => { resolveA = resolve; });
    const authorizationB = new Promise<Record<string, unknown>>((resolve) => { resolveB = resolve; });
    let requestA = "";
    let requestB = "";
    let confirmCancellation!: (cancelled: boolean) => void;
    const cancellation = new Promise<boolean>((resolve) => { confirmCancellation = resolve; });
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization")
      .mockReturnValue(cancellation);
    const preauthorize = vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementationOnce((_artifacts, clientRequestId) => {
        requestA = clientRequestId;
        return authorizationA;
      })
      .mockImplementationOnce((_artifacts, clientRequestId) => {
        requestB = clientRequestId;
        return authorizationB;
      });
    const send = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const selection = (artifactId: string, usdcUrl: string) => [{
      artifact_id: artifactId,
      model_version_id: `version_${artifactId}`,
      usdc_url: usdcUrl,
      role: "primary" as const,
      load_order: 0,
      ready: true,
    }];
    const transaction = (artifactId: string, usdcUrl: string) => ({
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: `stage_auth_${artifactId}`,
      binding_revision_id: `rev_${artifactId}`,
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: artifactId, role: "primary", load_order: 0, usdc_url: usdcUrl },
        secondary_layers: [],
      },
    });

    privateApp._applyBinding(selection("artifact_a", "stage://a.usdc"), "rev_ui_a");
    privateApp._applyBinding(selection("artifact_b", "stage://b.usdc"), "rev_ui_b");
    expect(requestA).toMatch(/^stage_preauth_/);
    expect(cancel).toHaveBeenCalledWith(requestA);
    expect(preauthorize).toHaveBeenCalledTimes(1);

    confirmCancellation(true);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(requestB).toMatch(/^stage_preauth_/);
    expect(requestB).not.toBe(requestA);
    expect(preauthorize).toHaveBeenCalledTimes(2);
    resolveB(transaction("artifact_b", "stage://b.usdc"));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: "stage://b.usdc",
    }));
    expect(send.mock.calls.filter(([message]) => (message as { event_type?: string }).event_type === "loadArtifactGroupRequest"))
      .toHaveLength(1);

    resolveA(transaction("artifact_a", "stage://a.usdc"));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: "stage://b.usdc",
    }));
    expect(send.mock.calls.filter(([message]) => (message as { event_type?: string }).event_type === "loadArtifactGroupRequest"))
      .toHaveLength(1);
  });

  it("ignores a stale binding preauthorization rejection after a newer apply owns the stage", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: () => Promise<Record<string, unknown>>;
      _cancelStageBindingPreauthorization: (clientRequestId: string) => Promise<boolean>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    let rejectA!: (reason?: unknown) => void;
    let resolveB!: (value: Record<string, unknown>) => void;
    const authorizationA = new Promise<Record<string, unknown>>((_resolve, reject) => { rejectA = reject; });
    const authorizationB = new Promise<Record<string, unknown>>((resolve) => { resolveB = resolve; });
    const preauthorize = vi.spyOn(privateApp, "_preauthorizeStageBinding")
      .mockImplementationOnce(() => authorizationA)
      .mockImplementationOnce(() => authorizationB);
    const cancel = vi.spyOn(privateApp, "_cancelStageBindingPreauthorization").mockResolvedValue(true);
    const send = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({});
    const selection = (artifactId: string, usdcUrl: string) => [{
      artifact_id: artifactId,
      model_version_id: `version_${artifactId}`,
      usdc_url: usdcUrl,
      role: "primary" as const,
      load_order: 0,
      ready: true,
    }];
    const transactionB = {
      status: "pending",
      session_id: "review_session_x",
      stage_binding_authorization_id: "stage_auth_b",
      binding_revision_id: "rev_b",
      pending_expires_at: "2099-01-01T00:00:00Z",
      stage_composition: {
        primary: { artifact_id: "artifact_b", role: "primary", load_order: 0, usdc_url: "stage://b.usdc" },
        secondary_layers: [],
      },
    };

    privateApp._applyBinding(selection("artifact_a", "stage://a.usdc"), "rev_ui_a");
    privateApp._applyBinding(selection("artifact_b", "stage://b.usdc"), "rev_ui_b");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    resolveB(transactionB);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    rejectA(new Error("stale authorization failed"));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(preauthorize).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      status: "pending",
      targetUrl: "stage://b.usdc",
    }));
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
    expect(send.mock.calls.filter(([message]) => (message as { event_type?: string }).event_type === "loadArtifactGroupRequest"))
      .toHaveLength(1);
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
  it("visible fallback stays provisional until a same-generation correlated success promotes it", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://visible-stream.usdc";
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      confirmedStageBindingRevision: string | null;
      runtimeCommandContexts: Map<string, { eventType: string; bindingRevisionId: string; stageUrl: string; stageAttemptGeneration: number }>;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      usdAssets: [{ name: "visible stream", url: stageUrl }],
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    privateApp.runtimeCommandContexts.set("req_visible_provisional", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_visible_provisional",
      stageUrl,
      stageAttemptGeneration: generation,
    });
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    expect(internals(app)._completeStageLoadFromVisibleStream()).toBe(true);

    let posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null; status?: string });
    // frame 可見 → 仍送 first_frame（誠實：有畫面），但不得攜帶未經 Kit 證實的 pendingStageUrl
    // （此處為 P1 修正的核心觀測點：first_frame.stageUrl 必為 null，A1 端 onFirstFrame 不會 setLoadedStageUrl
    //  → isStageMatched 維持 false → 高亮鈕保持 disabled，直到 Kit 真回報相符 URL）。
    expect(posted.find((m) => m.type === "first_frame")).toMatchObject({ stageUrl: null });
    expect(posted.find((m) => m.type === "stage_loaded")).toMatchObject({ stageUrl: null, status: "unproven" });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "provisional" }));
    expect(internals(app).pendingStageUrl).toBe(stageUrl);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_visible_provisional",
        url: stageUrl,
        binding_revision_id: "rev_visible_provisional",
      },
    });

    posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null; status?: string });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "completed" }));
    expect(internals(app).state.loadedStageUrl).toBe(stageUrl);
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(posted.filter((m) => m.type === "first_frame")).toHaveLength(1);
    expect(posted.filter((m) => m.type === "stage_loaded")).toEqual([
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
      expect.objectContaining({ stageUrl, status: "active" }),
    ]);
  });

  it("a visible remote video does not extend the fixed 45-second stage proof deadline", () => {
    vi.useFakeTimers();
    const originalStreamStartTimeoutMs = reviewEnv.streamStartTimeoutMs;
    reviewEnv.streamStartTimeoutMs = 120_000;
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://visible-without-proof.usdc";
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _scheduleStageLoadTimeout: (generation: number) => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string; terminalReason?: string } | null;
    };
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => undefined);

    try {
      privateApp._scheduleStageLoadTimeout(generation);
      expect(internals(app)._completeStageLoadFromVisibleStream()).toBe(true);
      expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
        generation,
        status: "provisional",
        targetUrl: stageUrl,
      }));

      vi.advanceTimersByTime(44_999);
      expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "provisional" }));

      vi.advanceTimersByTime(1);
      expect(privateApp.activeStageAttempt).toEqual({
        generation,
        status: "terminal",
        targetUrl: stageUrl,
        terminalReason: "stage-load-timeout",
      });
      expect(internals(app).pendingStageUrl).toBeNull();
      expect(internals(app).state.loadingText).toBe("模型載入逾時");
      expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ event_type: "loadingStateQuery" }));
    } finally {
      reviewEnv.streamStartTimeoutMs = originalStreamStartTimeoutMs;
    }
  });

  it("ignores a late same-target busy response after the stage attempt is completed", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://completed-busy.usdc";
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number) => void;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      confirmedStageBindingRevision: string | null;
      loadingStatePollCount: number;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      usdAssets: [{ name: "completed busy", url: stageUrl }],
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    privateApp.confirmedStageBindingRevision = "rev_completed_busy";
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    const sendSpy = vi.spyOn(internals(app), "_sendStreamMessage").mockImplementation(() => undefined);

    privateApp._completeStageLoad(stageUrl, "rev_completed_busy", generation);
    sendSpy.mockClear();
    const stableState = {
      loadingText: internals(app).state.loadingText,
      isLoading: internals(app).state.isLoading,
      loadedStageUrl: internals(app).state.loadedStageUrl,
      stageLoadStatus: internals(app).state.stageLoadStatus,
    };
    const stablePollCount = privateApp.loadingStatePollCount;

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: stageUrl, loading_state: "busy" },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "completed" }));
    expect(internals(app).state).toMatchObject(stableState);
    expect(privateApp.loadingStatePollCount).toBe(stablePollCount);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("an exact-target idle stays unproven until correlated authenticated completion promotes it", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = operableApp();
    useSynchronousSetState(app);
    const stageUrl = "stage://visible-idle.usdc";
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      confirmedStageBindingRevision: string | null;
      runtimeCommandContexts: Map<string, { eventType: string; bindingRevisionId: string; stageUrl: string; stageAttemptGeneration: number }>;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      expectedStageUrl: stageUrl,
      loadedStageUrl: null,
      usdAssets: [{ name: "visible idle", url: stageUrl }],
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    privateApp.runtimeCommandContexts.set("req_visible_idle", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_visible_idle",
      stageUrl,
      stageAttemptGeneration: generation,
    });
    vi.spyOn(internals(app), "_hasRemoteVideoFrame").mockReturnValue(true);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    expect(internals(app)._completeStageLoadFromVisibleStream()).toBe(true);
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: stageUrl, loading_state: "idle" },
    });

    let posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null; status?: string });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "provisional" }));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(posted.filter((m) => m.type === "first_frame")).toHaveLength(1);
    expect(posted.filter((m) => m.type === "stage_loaded")).toEqual([
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
    ]);

    privateApp.confirmedStageBindingRevision = "rev_visible_idle";
    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: stageUrl, loading_state: "idle" },
    });

    posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null; status?: string });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "provisional" }));
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(posted.filter((m) => m.type === "first_frame")).toHaveLength(1);
    expect(posted.filter((m) => m.type === "stage_loaded")).toEqual([
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
    ]);

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_visible_idle",
        url: stageUrl,
        binding_revision_id: "rev_visible_idle",
      },
    });

    posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null; status?: string });
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ generation, status: "completed" }));
    expect(internals(app).state.loadedStageUrl).toBe(stageUrl);
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(posted.filter((m) => m.type === "first_frame")).toHaveLength(1);
    expect(posted.filter((m) => m.type === "stage_loaded").slice(-1)[0]).toMatchObject({ stageUrl, status: "active" });
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
  let previousLeaseEnv: { sourceClientId: string; viewerLeaseToken: string };

  beforeEach(() => {
    previousLeaseEnv = {
      sourceClientId: reviewEnv.sourceClientId,
      viewerLeaseToken: reviewEnv.viewerLeaseToken,
    };
  });

  afterEach(() => {
    Object.assign(reviewEnv, previousLeaseEnv);
  });

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
    const privateApp = internals(app) as unknown as {
      _failStageLoad: (loadingText: string, diagnostic?: string, attemptGeneration?: number | null, bindingFailureReason?: string) => void;
    };
    const failStageLoad = vi.spyOn(privateApp, "_failStageLoad");
    trackBindingRequest(app, "openStageRequest", "req_binding_003", "rev_binding_003");
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: { result: "success", request_id: "req_binding_003", binding_revision_id: "rev_binding_003" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "missing_stage_evidence" });
    expect(failStageLoad.mock.calls[failStageLoad.mock.calls.length - 1]?.[3]).toBe("missing_stage_evidence");
    expect(internals(app).state.govBindingActiveRevision).toBeUndefined();
  });

  it("redacts the expected stage URL in a missing-evidence failure", () => {
    const app = bindingApplyApp();
    const sensitiveStageUrl = "https://viewer:secret@stage.example/missing.usdc?X-Amz-Signature=sentinel#fragment";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: sensitiveStageUrl,
    };
    trackBindingRequest(app, "openStageRequest", "req_binding_redacted_missing", "rev_binding_redacted_missing");

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_binding_redacted_missing",
        binding_revision_id: "rev_binding_redacted_missing",
      },
    });

    const html = renderToString(internals(app).render());
    expect(html).toContain("https://stage.example/missing.usdc");
    expect(html).not.toContain("viewer:secret");
    expect(html).not.toContain("X-Amz-Signature");
    expect(html).not.toContain("fragment");
  });

  it("loadArtifactGroupResult result=error → failed 帶 Kit error reason", () => {
    const app = bindingApplyApp();
    const sensitiveError = "kit_compose_failed https://viewer:secret@stage.example/compose.usdc?X-Amz-Signature=sentinel authorization=BearerSentinel Bearer BareBearerSentinel Basic BareBasicSentinel Authorization Bearer HeaderBearerSentinel";
    trackBindingRequest(app, "loadArtifactGroupRequest", "req_binding_004", "rev_binding_004");
    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: { result: "error", request_id: "req_binding_004", binding_revision_id: "rev_binding_004", error: sensitiveError },
    });
    const reason = String((internals(app).state.govBindingApplyState as { reason: string }).reason);
    expect(reason).toContain("https://stage.example/compose.usdc");
    expect(reason).not.toContain("viewer:secret");
    expect(reason).not.toContain("X-Amz-Signature");
    expect(reason).not.toContain("BearerSentinel");
    expect(reason).not.toContain("BareBearerSentinel");
    expect(reason).not.toContain("BareBasicSentinel");
    expect(reason).not.toContain("HeaderBearerSentinel");
  });

  it("redacts a Kit-reported stage URL in a non-timeout error diagnostic", () => {
    const app = bindingApplyApp();
    const sensitiveStageUrl = "https://viewer:secret@stage.example/error.usdc?X-Amz-Signature=sentinel#fragment";
    const sensitiveError = `kit_open_failed ${sensitiveStageUrl} authorization: Bearer HeaderSentinel token=RuntimeSentinel`;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    trackBindingRequest(app, "openStageRequest", "req_binding_redacted_error", "rev_binding_redacted_error");

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "error",
        request_id: "req_binding_redacted_error",
        binding_revision_id: "rev_binding_redacted_error",
        url: sensitiveStageUrl,
        error: sensitiveError,
      },
    });

    const html = renderToString(internals(app).render());
    const diagnostic = String(internals(app).state.streamDiagnostic);
    const logged = consoleError.mock.calls.map((call) => call.join(" ")).join(" ");
    expect(html).toContain("https://stage.example/error.usdc");
    expect(html).not.toContain("viewer:secret");
    expect(html).not.toContain("X-Amz-Signature");
    expect(html).not.toContain("fragment");
    expect(diagnostic).not.toContain("RuntimeSentinel");
    expect(diagnostic).not.toContain("HeaderSentinel");
    expect(logged).not.toContain("RuntimeSentinel");
    expect(logged).not.toContain("HeaderSentinel");
  });

  it("ignores an untracked composition error instead of overwriting the active binding state", () => {
    const app = bindingApplyApp();

    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "error",
        request_id: "req_retired_composition_error",
        binding_revision_id: "rev_retired",
        error: "late_kit_compose_failed",
      },
    });

    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
  });

  it("consumes a superseded artifact-group error once without mutating B", () => {
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      runtimeCommandContexts: Map<string, {
        eventType: string;
        bindingRevisionId: string;
        stageAttemptGeneration: number;
        stageUrl: string;
      }>;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
    };
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://b.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      govBindingApplyState: { status: "applying" },
      runtimeCommandLifecycles: [{
        request_id: "req_a_artifact_error",
        event_type: "loadArtifactGroupRequest",
        phases: ["pending"],
      }],
    };
    const generationA = privateApp._beginStageAttempt("stage://a.usdc");
    internals(app).pendingStageUrl = "stage://a.usdc";
    privateApp.runtimeCommandContexts.set("req_a_artifact_error", {
      eventType: "loadArtifactGroupRequest",
      bindingRevisionId: "rev_a",
      stageAttemptGeneration: generationA,
      stageUrl: "stage://a.usdc",
    });
    const generationB = privateApp._beginStageAttempt("stage://b.usdc");
    internals(app).pendingStageUrl = "stage://b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://b.usdc",
      loadedStageUrl: null,
      stageLoadStatus: "pending",
      govBindingApplyState: { status: "applying" },
    };
    const lateError = {
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "error",
        request_id: "req_a_artifact_error",
        binding_revision_id: "rev_a",
        error: "late artifact group failure",
      },
    };

    internals(app)._handleCustomEvent(lateError);
    internals(app)._handleCustomEvent(lateError);

    expect(privateApp.runtimeCommandTerminalClaims.get("req_a_artifact_error")).toEqual({
      eventType: "loadArtifactGroupRequest",
      outcome: "superseded",
    });
    expect(privateApp.runtimeCommandContexts.has("req_a_artifact_error")).toBe(false);
    expect(internals(app).state.runtimeCommandLifecycles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        request_id: "req_a_artifact_error",
        phases: ["pending", "terminal"],
        outcome: "superseded",
      }),
    ]));
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: generationB,
      status: "pending",
    }));
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
    expect(internals(app).state.stageLoadStatus).toBe("pending");
  });

  it.each([
    ["missing binding revision", {}],
    ["mismatched binding revision", { binding_revision_id: "rev_binding_wrong" }],
  ])("ignores a composition error with %s instead of overwriting the active binding state", (_label, revisionPayload) => {
    const app = bindingApplyApp();
    trackBindingRequest(app, "loadArtifactGroupRequest", "req_binding_guarded_error", "rev_binding_guarded");

    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "error",
        request_id: "req_binding_guarded_error",
        error: "untrusted_kit_compose_failed",
        ...revisionPayload,
      },
    });

    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });
  });

  it("changing the binding primary replaces the selected mapping target before Kit completion", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _applyBinding: (selection: Array<{
        artifact_id: string;
        model_version_id: string;
        usdc_url?: string;
        role: "primary" | "secondary";
        load_order: number;
        ready: boolean;
      }>, revisionId: string) => void;
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      _clearStageLoadTimeout: () => void;
      _mappingCache: unknown;
      _mappingCacheUrl: string | null;
    };
    const oldAsset = { name: "old primary", url: "stage://old-primary.usdc" };
    const newAsset = { name: "new primary", url: "stage://new-primary.usdc" };
    internals(app).state = {
      ...internals(app).state,
      usdAssets: [oldAsset, newAsset],
      selectedUSDAsset: oldAsset,
      expectedStageUrl: oldAsset.url,
      mappingUrl: "mapping://old-primary.json",
      mappingStatus: "已載入 old mapping",
      mappingSummary: { mapped_count: 1 },
      mappingItems: [{ usd_prim_path: "/World/Old" }],
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        artifact_bindings: [
          { url: oldAsset.url, mapping_url: "mapping://old-primary.json" },
          { url: newAsset.url, mapping_url: "mapping://new-primary.json" },
        ],
      },
    };
    privateApp._mappingCache = { stale: true };
    privateApp._mappingCacheUrl = "mapping://old-primary.json";
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue({
      binding_revision_id: "rev_new_primary",
      stage_binding_authorization_id: "stage_auth_new_primary",
      stage_composition: {
        primary: { usdc_url: newAsset.url },
        secondary_layers: [],
      },
    } as never);
    vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(true);

    try {
      privateApp._applyBinding([{
        artifact_id: "artifact_new_primary",
        model_version_id: "version_x",
        usdc_url: newAsset.url,
        role: "primary",
        load_order: 0,
        ready: true,
      }], "rev_new_primary");
      await flushMicrotasks();

      expect(internals(app).state).toMatchObject({
        selectedUSDAsset: newAsset,
        expectedStageUrl: newAsset.url,
        mappingUrl: "mapping://new-primary.json",
        mappingStatus: "尚未載入 mapping",
        mappingItems: [],
      });
      expect(privateApp._mappingCache).toBeNull();
      expect(privateApp._mappingCacheUrl).toBeNull();
    } finally {
      privateApp._clearStageLoadTimeout();
    }
  });

  it("binding composition terminalizes immediately when its authorized command is not sent", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      _clearStageLoadTimeout: () => void;
      activeStageAttempt: { status: string } | null;
      pendingStageUrl: string | null;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue({
      binding_revision_id: "rev_unsent_binding",
      stage_binding_authorization_id: "stage_auth_unsent_binding",
      stage_composition: {
        primary: { usdc_url: "stage://unsent-binding.usdc" },
        secondary_layers: [],
      },
    } as never);
    vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(false);

    try {
      privateApp._applyBinding([{
        artifact_id: "artifact_unsent_binding",
        model_version_id: "version_x",
        usdc_url: "stage://unsent-binding.usdc",
        role: "primary",
        load_order: 0,
        ready: true,
      }], "rev_unsent_binding");
      await flushMicrotasks();

      expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
      expect(privateApp.pendingStageUrl).toBeNull();
      expect(internals(app).state).toMatchObject({
        isLoading: false,
        govBindingApplyState: { status: "failed" },
      });
    } finally {
      privateApp._clearStageLoadTimeout();
    }
  });

  it("a sent binding apply becomes superseded when a later stage intent replaces its attempt", async () => {
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      _beginStageAttempt: (url: string) => number;
      _clearStageLoadTimeout: () => void;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue({
      binding_revision_id: "rev_sent_binding",
      stage_binding_authorization_id: "stage_auth_sent_binding",
      stage_composition: {
        primary: { usdc_url: "stage://sent-binding.usdc" },
        secondary_layers: [],
      },
    } as never);
    vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(true);

    try {
      privateApp._applyBinding([{
        artifact_id: "artifact_sent_binding",
        model_version_id: "version_x",
        usdc_url: "stage://sent-binding.usdc",
        role: "primary",
        load_order: 0,
        ready: true,
      }], "rev_sent_binding");
      await flushMicrotasks();
      expect(internals(app).state.govBindingApplyState).toEqual({ status: "applying" });

      privateApp._beginStageAttempt("stage://manual-replacement.usdc");

      expect(internals(app).state.govBindingApplyState).toEqual({
        status: "failed",
        reason: "stage_binding_apply_superseded",
      });
    } finally {
      privateApp._clearStageLoadTimeout();
    }
  });

  it("binding apply authorization times out visibly without sending a Kit composition command", async () => {
    vi.useFakeTimers();
    setLang("en");
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockImplementation(() => new Promise(() => {}));
    const send = vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(true);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_authorization_timeout",
      model_version_id: "version_x",
      usdc_url: "stage://binding-authorization-timeout.usdc",
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_authorization_timeout");
    await vi.advanceTimersByTimeAsync(45_000);

    expect(send).not.toHaveBeenCalled();
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "stage_binding_authorization_timeout",
    });
    expect(internals(app).state.streamDiagnostic).toContain(
      "Stage binding authorization timed out before a load command was sent to Kit.",
    );
  });

  it("does not let a stale busy probe overwrite a binding authorization timeout", async () => {
    vi.useFakeTimers();
    setLang("en");
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _applyBinding: AppInternals["_applyBinding"];
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      stageLoadFailureActive: boolean;
    };
    internals(app).state = {
      ...internals(app).state,
      isKitReady: true,
      webrtcLifecycleStatus: "started",
      selectedUSDAsset: { name: "stale probe", url: "stage://stale-probe.usdc" },
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockImplementation(() => new Promise(() => {}));
    const send = vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(true);

    privateApp._applyBinding([{
      artifact_id: "artifact_binding_authorization_stale_probe",
      model_version_id: "version_x",
      usdc_url: "stage://stale-probe.usdc",
      role: "primary",
      load_order: 0,
      ready: true,
    }], "rev_binding_authorization_stale_probe");
    await vi.advanceTimersByTimeAsync(45_000);
    const failureText = internals(app).state.loadingText;
    const failureDiagnostic = internals(app).state.streamDiagnostic;

    internals(app)._handleCustomEvent({
      event_type: "loadingStateResponse",
      payload: { url: "stage://stale-probe.usdc", loading_state: "busy" },
    });

    expect(send).not.toHaveBeenCalled();
    expect(privateApp.stageLoadFailureActive).toBe(true);
    expect(internals(app).loadingStatePollCount).toBe(0);
    expect(internals(app).state.loadingText).toBe(failureText);
    expect(internals(app).state.streamDiagnostic).toBe(failureDiagnostic);
    expect(renderToString(internals(app).render())).toContain('data-testid="stage-load-failure"');
  });

  it("ordinary stage open terminalizes immediately when its authorized command is not sent", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _openSelectedAsset: () => void;
      _preauthorizeStageBinding: (selection: unknown[]) => Promise<unknown>;
      _sendStreamMessage: (message: unknown) => boolean;
      _clearStageLoadTimeout: () => void;
      activeStageAttempt: { status: string } | null;
      pendingStageUrl: string | null;
    };
    const asset = { name: "ordinary stage", url: "stage://ordinary-unsent.usdc" };
    internals(app).state = {
      ...internals(app).state,
      selectedUSDAsset: asset,
      expectedStageUrl: asset.url,
      usdAssets: [asset],
      latestStreamConfig: {
        ...(internals(app).state.latestStreamConfig as Record<string, unknown>),
        model: { status: "ready", url: asset.url },
        artifact_bindings: [{ artifact_id: "artifact_ordinary", url: asset.url, load_order: 0 }],
      },
    };
    vi.spyOn(privateApp, "_preauthorizeStageBinding").mockResolvedValue({
      binding_revision_id: "rev_unsent_open",
      stage_binding_authorization_id: "stage_auth_unsent_open",
      stage_composition: {
        primary: { usdc_url: asset.url },
        secondary_layers: [],
      },
    } as never);
    vi.spyOn(privateApp, "_sendStreamMessage").mockReturnValue(false);

    try {
      privateApp._openSelectedAsset();
      await flushMicrotasks();

      expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
      expect(privateApp.pendingStageUrl).toBeNull();
      expect(internals(app).state.isLoading).toBe(false);
    } finally {
      privateApp._clearStageLoadTimeout();
    }
  });

  it("composition error acknowledgement terminalizes its owning stage attempt", () => {
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      activeStageAttempt: { generation: number; status: string } | null;
      pendingStageUrl: string | null;
      runtimeCommandContexts: Map<string, Record<string, unknown>>;
    };
    const generation = privateApp._beginStageAttempt("stage://composition-error.usdc");
    privateApp.pendingStageUrl = "stage://composition-error.usdc";
    privateApp.runtimeCommandContexts.set("req_composition_error", {
      eventType: "loadArtifactGroupRequest",
      bindingRevisionId: "rev_composition_error",
      stageAttemptGeneration: generation,
      stageUrl: "stage://composition-error.usdc",
    });

    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "error",
        request_id: "req_composition_error",
        binding_revision_id: "rev_composition_error",
        error: "kit_compose_failed",
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
    expect(privateApp.pendingStageUrl).toBeNull();
    expect(internals(app).state).toMatchObject({
      isLoading: false,
      govBindingApplyState: { status: "failed", reason: "kit_compose_failed" },
    });
  });

  it("success without a loaded URL terminalizes its owning stage attempt instead of polling", () => {
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _clearLoadingStateRetry: () => void;
      activeStageAttempt: { generation: number; status: string } | null;
      pendingStageUrl: string | null;
      runtimeCommandContexts: Map<string, Record<string, unknown>>;
    };
    const generation = privateApp._beginStageAttempt("stage://missing-url.usdc");
    privateApp.pendingStageUrl = "stage://missing-url.usdc";
    privateApp.runtimeCommandContexts.set("req_missing_url", {
      eventType: "openStageRequest",
      bindingRevisionId: "rev_missing_url",
      stageAttemptGeneration: generation,
      stageUrl: "stage://missing-url.usdc",
    });

    try {
      internals(app)._handleCustomEvent({
        event_type: "openedStageResult",
        payload: {
          result: "success",
          request_id: "req_missing_url",
          binding_revision_id: "rev_missing_url",
        },
      });

      expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({ status: "terminal" }));
      expect(privateApp.pendingStageUrl).toBeNull();
      expect(internals(app).state).toMatchObject({
        isLoading: false,
        govBindingApplyState: { status: "failed", reason: "missing_stage_evidence" },
      });
    } finally {
      privateApp._clearLoadingStateRetry();
    }
  });

  it("terminal stage failure clears the parent stage proof", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = bindingApplyApp();
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _failStageLoad: (loadingText: string, diagnostic?: string, attemptGeneration?: number | null) => void;
      pendingStageUrl: string | null;
    };
    const generation = privateApp._beginStageAttempt("stage://parent-proof.usdc");
    privateApp.pendingStageUrl = "stage://parent-proof.usdc";

    privateApp._failStageLoad("stage timeout", "no correlated completion", generation);

    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stage_loaded", stageUrl: null, status: "unproven" }),
      PARENT_ORIGIN,
    );
  });
});

describe("P1：production stage completion correlation 與 parent proof 撤銷", () => {
  it("NVIDIA OpenStageEvent 未 echo correlation 時，使用同一筆已送 request 的 verified fields 完成 stage", async () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(PARENT_ORIGIN + "/ui");
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const stageUrl = "stage://sdk-open-stage.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
      action: "message",
      status: "success",
      info: "",
      url: stageUrl,
    });

    internals(app)._sendStreamMessage({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_sdk_open_stage",
        binding_revision_id: "rev_sdk_open_stage",
        url: stageUrl,
      },
    });
    await flushMicrotasks();

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation,
      status: "completed",
      targetUrl: stageUrl,
    }));
    expect(internals(app).state.loadedStageUrl).toBe(stageUrl);
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    const stagePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string })
      .filter((message) => message.type === "stage_loaded");
    expect(stagePosts).toEqual([
      expect.objectContaining({
        stageUrl,
        status: "active",
        binding_revision_id: "rev_sdk_open_stage",
      }),
    ]);
  });

  it("keeps a native loadArtifactGroup error non-terminal until its changed_failed DataChannel result arrives", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _sendStreamMessage: (message: { event_type: string; payload: Record<string, unknown> }) => boolean;
      runtimeCommandContexts: Map<string, unknown>;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const stageUrl = "stage://native-partial-load.usdc";
    const requestId = "req_native_partial_load";
    const bindingRevisionId = "rev_native_partial_load";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
      govBindingActiveRevision: "rev_last_good",
      govBindingApplyState: { status: "applying" },
    };
    const generation = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
      action: "message",
      status: "error",
      info: "generic SDK acknowledgement",
      url: stageUrl,
    });

    expect(privateApp._sendStreamMessage({
      event_type: "loadArtifactGroupRequest",
      payload: {
        request_id: requestId,
        binding_revision_id: bindingRevisionId,
        url: stageUrl,
      },
    })).toBe(true);
    await flushMicrotasks();

    // The SDK wrapper has no protocol correlation/runtime_state and therefore
    // must not consume the transaction before Kit's authenticated terminal.
    expect(privateApp.runtimeCommandContexts.has(requestId)).toBe(true);
    expect(internals(app).state.govBindingActiveRevision).toBe("rev_last_good");

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "error",
        request_id: requestId,
        binding_revision_id: bindingRevisionId,
        url: stageUrl,
        error: "secondary layer failed",
        runtime_state: "changed_failed",
        partial_load: true,
        failed_bindings: [{ artifact_id: "artifact_secondary" }],
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation,
      status: "terminal",
    }));
    expect(internals(app).state.govBindingActiveRevision).toBeNull();
    expect(internals(app).state.govBindingApplyState).toEqual({
      status: "failed",
      reason: "runtime_changed_transaction_failed",
    });
  });

  it("A 已 active 後同 URL 的 B terminal failure 會撤銷 parent 的 A proof", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(PARENT_ORIGIN + "/ui");
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number) => void;
      _failStageLoad: (loadingText: string, diagnostic?: string, attemptGeneration?: number) => void;
      _getChildren: () => void;
    };
    const stageA = "stage://proof-same-url.usdc";
    const stageB = stageA;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    privateApp._completeStageLoad(stageA, "rev_proof_a", attemptA);

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
    };
    privateApp._failStageLoad("Model loading failed", "authorization rejected", attemptB);

    const stagePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string })
      .filter((message) => message.type === "stage_loaded");
    expect(stagePosts).toEqual([
      expect.objectContaining({ stageUrl: stageA, status: "active" }),
      // Selecting B immediately revokes A; B's terminal failure repeats the
      // idempotent unproven state after it becomes terminal.
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
    ]);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
  });

  it("已完成 stage 後的 compose changed_unconfirmed 會以 binding revision 撤銷 parent proof", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(PARENT_ORIGIN + "/ui");
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number) => void;
      _getChildren: () => void;
    };
    const stageUrl = "stage://completed-compose-proof.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => undefined));
    const attempt = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    privateApp._completeStageLoad(stageUrl, "rev_completed_stage", attempt);

    internals(app)._sendStreamMessage({
      event_type: "composeStageRequest",
      payload: {
        request_id: "req_completed_compose",
        binding_revision_id: "rev_changed_compose",
      },
    });
    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "composeStageRequest",
        reason: "lease_invalid",
        request_id: "req_completed_compose",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });

    const stagePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string; binding_revision_id?: string })
      .filter((message) => message.type === "stage_loaded");
    expect(stagePosts).toEqual([
      expect.objectContaining({ stageUrl, status: "active", binding_revision_id: "rev_completed_stage" }),
      expect.objectContaining({ stageUrl: null, status: "unproven", binding_revision_id: "rev_changed_compose" }),
    ]);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
  });

  it("延遲的舊 compose changed_unconfirmed 不得 terminalize 較新的 pending stage", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(PARENT_ORIGIN + "/ui");
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number) => void;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
    };
    const stageA = "stage://completed-compose-a.usdc";
    const stageB = "stage://newer-pending-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => undefined));
    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    privateApp._completeStageLoad(stageA, "rev_completed_a", attemptA);
    internals(app)._sendStreamMessage({
      event_type: "composeStageRequest",
      payload: {
        request_id: "req_old_compose",
        binding_revision_id: "rev_old_compose",
      },
    });

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    parent.postMessage.mockClear();

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "composeStageRequest",
        reason: "lease_invalid",
        request_id: "req_old_compose",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });

    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "pending",
      targetUrl: stageB,
    }));
    // The stale transaction still establishes the global proof block; it may
    // not, however, turn B itself terminal or revoke a new parent proof.
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    internals(app)._sendStreamMessage({
      event_type: "focusPrimRequest",
      payload: { prim_path: "/World/BlockedUntilResync" },
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: "stage_loaded",
      stageUrl: null,
      status: "unproven",
      binding_revision_id: "rev_old_compose",
    }), PARENT_ORIGIN);
  });

  it("same-URL native opens stay single-flight and start B proof timing only after B dispatches", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _getChildren: () => void;
    };
    const stageUrl = "stage://same-url-native-queue.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
    };
    const timeoutSpy = vi.spyOn(internals(app), "_scheduleStageLoadTimeout").mockImplementation(() => undefined);
    const pollSpy = vi.spyOn(internals(app), "_scheduleLoadingStateQuery").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveA = resolve; });
    const second = new Promise<unknown>((resolve) => { resolveB = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    const attemptA = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_native_a",
        binding_revision_id: "rev_native_a",
        url: stageUrl,
      },
    }, attemptA)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(attemptA);

    const attemptB = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_native_b",
        binding_revision_id: "rev_native_b",
        url: stageUrl,
      },
    }, attemptB)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(pollSpy).toHaveBeenCalledTimes(1);

    resolveA({
      action: "message",
      status: "success",
      info: "A completed",
      url: stageUrl,
    });
    await flushMicrotasks();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenCalledWith(attemptB);
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(internals(app).state.loadedStageUrl).toBeNull();

    resolveB({
      action: "message",
      status: "success",
      info: "B completed",
      url: stageUrl,
    });
    await flushMicrotasks();

    expect(internals(app).state.govBindingActiveRevision).toBe("rev_native_b");
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.loadedStageUrl).toBe(stageUrl);
  });

  it("manual loadArtifactGroup waits for its correlated DataChannel terminal before dispatching a queued native open", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _getChildren: () => void;
    };
    const stageA = "stage://native-open-a.usdc";
    const stageB = "stage://native-binding-b.usdc";
    const stageC = "stage://native-open-c.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    let resolveA!: (value: unknown) => void;
    let resolveC!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveA = resolve; });
    // SDK 5.18.2 treats loadArtifactGroupRequest as an unknown command: its
    // send Promise resolves to a generic ACK instead of openedStageResult.
    const second = Promise.resolve({ action: "message", status: "success", info: "SDK accepted" });
    const third = new Promise<unknown>((resolve) => { resolveC = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);

    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_open_a",
        binding_revision_id: "rev_open_a",
        url: stageA,
      },
    }, attemptA)).toBe(true);

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    expect(privateApp._dispatchStageRequest({
      event_type: "loadArtifactGroupRequest",
      payload: {
        request_id: "req_binding_b",
        binding_revision_id: "rev_binding_b",
        url: stageB,
      },
    }, attemptB)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    resolveA({ action: "message", status: "success", info: "A completed", url: stageA });
    await flushMicrotasks();
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const attemptC = privateApp._beginStageAttempt(stageC);
    internals(app).pendingStageUrl = stageC;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageC,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_open_c",
        binding_revision_id: "rev_open_c",
        url: stageC,
      },
    }, attemptC)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: {
        result: "accepted",
        request_id: "req_binding_b",
        binding_revision_id: "rev_binding_b",
        url: stageB,
      },
    });
    expect(sendSpy).toHaveBeenCalledTimes(2);

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        request_id: "req_binding_b",
        binding_revision_id: "rev_binding_b",
        url: stageB,
      },
    });
    expect(sendSpy).toHaveBeenCalledTimes(3);

    resolveC({ action: "message", status: "success", info: "C completed", url: stageC });
    await flushMicrotasks();

    expect(internals(app).state.govBindingActiveRevision).toBe("rev_open_c");
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.loadedStageUrl).toBe(stageC);
  });

  it("manual loadArtifactGroup transport rejection releases its queued native open", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _getChildren: () => void;
    };
    const stageB = "stage://manual-transport-b.usdc";
    const stageC = "stage://manual-transport-c.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    let rejectB!: (reason?: unknown) => void;
    let resolveC!: (value: unknown) => void;
    const first = new Promise<unknown>((_resolve, reject) => { rejectB = reject; });
    const second = new Promise<unknown>((resolve) => { resolveC = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    expect(privateApp._dispatchStageRequest({
      event_type: "loadArtifactGroupRequest",
      payload: {
        request_id: "req_transport_b",
        binding_revision_id: "rev_transport_b",
        url: stageB,
      },
    }, attemptB)).toBe(true);

    const attemptC = privateApp._beginStageAttempt(stageC);
    internals(app).pendingStageUrl = stageC;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageC,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_transport_c",
        binding_revision_id: "rev_transport_c",
        url: stageC,
      },
    }, attemptC)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    rejectB(new Error("transport failed"));
    await flushMicrotasks();
    expect(sendSpy).toHaveBeenCalledTimes(2);

    resolveC({ action: "message", status: "success", info: "C completed", url: stageC });
    await flushMicrotasks();
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.loadedStageUrl).toBe(stageC);
  });

  it("a stale manual changed_unconfirmed terminal fences its queued native open before slot release", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
    };
    const stageB = "stage://native-manual-b.usdc";
    const stageC = "stage://queued-after-manual-c.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockResolvedValue({
      action: "message",
      status: "success",
      info: "SDK accepted",
    });

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    expect(privateApp._dispatchStageRequest({
      event_type: "loadArtifactGroupRequest",
      payload: {
        request_id: "req_manual_b",
        binding_revision_id: "rev_manual_b",
        url: stageB,
      },
    }, attemptB)).toBe(true);
    await flushMicrotasks();
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const attemptC = privateApp._beginStageAttempt(stageC);
    internals(app).pendingStageUrl = stageC;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageC,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_queued_c",
        binding_revision_id: "rev_queued_c",
        url: stageC,
      },
    }, attemptC)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "loadArtifactGroupRequest",
        reason: "lease_invalid",
        request_id: "req_manual_b",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });

    expect(privateApp.stageProofBlockedRevision).toBe("rev_manual_b");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptC,
      status: "terminal",
    }));
  });

  it("a superseded openStage changed_unconfirmed terminal fences B before A's native callback releases it", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _getChildren: () => void;
      activeStageAttempt: { generation: number; status: string; targetUrl: string } | null;
      stageProofBlockedRevision: string | null;
    };
    const stageA = "stage://superseded-open-a.usdc";
    const stageB = "stage://fenced-open-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    let resolveA!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveA = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockReturnValueOnce(first);

    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_superseded_open_a",
        binding_revision_id: "rev_superseded_open_a",
        url: stageA,
      },
    }, attemptA)).toBe(true);

    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
    };
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_fenced_open_b",
        binding_revision_id: "rev_fenced_open_b",
        url: stageB,
      },
    }, attemptB)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: "req_superseded_open_a",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });
    expect(privateApp.stageProofBlockedRevision).toBe("rev_superseded_open_a");
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "pending",
    }));

    resolveA({ action: "message", status: "success", info: "late A", url: stageA });
    await flushMicrotasks();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    expect(privateApp.activeStageAttempt).toEqual(expect.objectContaining({
      generation: attemptB,
      status: "terminal",
    }));
  });

  it("a timed-out openStage changed_unconfirmed terminal still fences the next lifecycle", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _replaceStreamLifecycle: () => number;
      _onStreamStarted: (streamGeneration?: number) => void;
      _queryLoadingState: () => void;
      _pollForKitReady: () => void;
      stageProofBlockedRevision: string | null;
      runtimeCommandTerminalClaims: Map<string, { eventType: string; outcome: string }>;
    };
    const stageA = "stage://timed-out-open-a.usdc";
    const stageB = "stage://after-timed-out-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_queryLoadingState").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_pollForKitReady").mockImplementation(() => undefined);
    const pending = new Promise<unknown>(() => undefined);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockReturnValue(pending);

    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_timed_out_open_a",
        binding_revision_id: "rev_timed_out_open_a",
        url: stageA,
      },
    }, attemptA)).toBe(true);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(privateApp.runtimeCommandTerminalClaims.get("req_timed_out_open_a")).toEqual({
      eventType: "openStageRequest",
      outcome: "timed-out",
    });

    internals(app)._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "openStageRequest",
        reason: "lease_invalid",
        request_id: "req_timed_out_open_a",
        retryable: false,
        runtime_state: "changed_unconfirmed",
      },
    });
    expect(privateApp.stageProofBlockedRevision).toBe("rev_timed_out_open_a");

    const replacementGeneration = privateApp._replaceStreamLifecycle();
    privateApp._onStreamStarted(replacementGeneration);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
      webrtcLifecycleStatus: "started",
    };
    const attemptB = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_after_timed_out_b",
        binding_revision_id: "rev_after_timed_out_b",
        url: stageB,
      },
    }, attemptB)).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("hung native SDK slot fails the latest intent and fences retry until lifecycle replacement", async () => {
    vi.useFakeTimers();
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _replaceStreamLifecycle: () => number;
      _onStreamStarted: (streamGeneration?: number) => void;
      _queryLoadingState: () => void;
      _pollForKitReady: () => void;
      _getChildren: () => void;
    };
    const stageUrl = "stage://hung-native-slot.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
    };
    let resolveA!: (value: unknown) => void;
    let resolveD!: (value: unknown) => void;
    const hung = new Promise<unknown>((resolve) => { resolveA = resolve; });
    const replacement = new Promise<unknown>((resolve) => { resolveD = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(hung)
      .mockReturnValueOnce(replacement);
    vi.spyOn(privateApp, "_queryLoadingState").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_pollForKitReady").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);

    const attemptA = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_hung_native_a",
        binding_revision_id: "rev_hung_native_a",
        url: stageUrl,
      },
    }, attemptA)).toBe(true);

    const attemptB = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_hung_native_b",
        binding_revision_id: "rev_hung_native_b",
        url: stageUrl,
      },
    }, attemptB)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(45_001);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
    const attemptC = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_hung_native_c",
        binding_revision_id: "rev_hung_native_c",
        url: stageUrl,
      },
    }, attemptC)).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const replacementGeneration = privateApp._replaceStreamLifecycle();
    privateApp._onStreamStarted(replacementGeneration);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
      webrtcLifecycleStatus: "started",
    };
    const attemptD = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_hung_native_d",
        binding_revision_id: "rev_hung_native_d",
        url: stageUrl,
      },
    }, attemptD)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    resolveA({ action: "message", status: "success", info: "late old slot", url: stageUrl });
    await Promise.resolve();
    await Promise.resolve();
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(internals(app).state.stageLoadStatus).toBe("pending");

    resolveD({ action: "message", status: "success", info: "replacement slot", url: stageUrl });
    await Promise.resolve();
    await Promise.resolve();
    expect(internals(app).state.stageLoadStatus).toBe("matched");
  });

  it("stream stop keeps same-generation starts fenced until a replacement lifecycle starts, then ignores the old callback", async () => {
    reviewEnv.sourceClientId = "viewer_lease_primary";
    reviewEnv.viewerLeaseToken = "lease_token_primary";
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _dispatchStageRequest: (message: { event_type: string; payload: Record<string, unknown> }, attemptGeneration: number) => boolean;
      _handleStreamStopped: (kind: "stopped", message: unknown) => void;
      _reconnectStream: () => void;
      _onStreamStarted: (streamGeneration?: number) => void;
      _getChildren: () => void;
      _queryLoadingState: () => void;
      _pollForKitReady: () => void;
      streamGeneration: number;
    };
    const stageA = "stage://stopped-native-a.usdc";
    const stageB = "stage://reconnected-native-b.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageA,
      stageLoadStatus: "pending",
      webrtcLifecycleStatus: "started",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_queryLoadingState").mockImplementation(() => undefined);
    vi.spyOn(privateApp, "_pollForKitReady").mockImplementation(() => undefined);
    let resolveA!: (value: unknown) => void;
    let resolveB!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => { resolveA = resolve; });
    const second = new Promise<unknown>((resolve) => { resolveB = resolve; });
    const sendSpy = vi.spyOn(AppStream, "sendMessage")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);

    const attemptA = privateApp._beginStageAttempt(stageA);
    internals(app).pendingStageUrl = stageA;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_stopped_a",
        binding_revision_id: "rev_stopped_a",
        url: stageA,
      },
    }, attemptA)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    privateApp._handleStreamStopped("stopped", { reason: "test" });
    const stoppedGeneration = privateApp.streamGeneration;
    privateApp._onStreamStarted(stoppedGeneration);
    expect(internals(app).state.webrtcLifecycleStatus).toBe("stopped");
    const blockedAttempt = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_blocked_b",
        binding_revision_id: "rev_blocked_b",
        url: stageB,
      },
    }, blockedAttempt)).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    privateApp._reconnectStream();
    const replacementGeneration = privateApp.streamGeneration;
    privateApp._onStreamStarted(replacementGeneration);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageB,
      stageLoadStatus: "pending",
      loadedStageUrl: null,
      webrtcLifecycleStatus: "started",
    };
    const retryAttempt = privateApp._beginStageAttempt(stageB);
    internals(app).pendingStageUrl = stageB;
    expect(privateApp._dispatchStageRequest({
      event_type: "openStageRequest",
      payload: {
        request_id: "req_reconnected_b",
        binding_revision_id: "rev_reconnected_b",
        url: stageB,
      },
    }, retryAttempt)).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    resolveA({ action: "message", status: "success", info: "old A", url: stageA });
    await flushMicrotasks();
    expect(internals(app).state.stageLoadStatus).toBe("pending");
    expect(sendSpy).toHaveBeenCalledTimes(2);

    resolveB({ action: "message", status: "success", info: "new B", url: stageB });
    await flushMicrotasks();
    expect(internals(app).state.stageLoadStatus).toBe("matched");
    expect(internals(app).state.loadedStageUrl).toBe(stageB);
  });

  it("stream lifecycle invalidation revokes an already active parent stage proof", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(PARENT_ORIGIN + "/ui");
    const app = operableApp();
    useSynchronousSetState(app);
    const privateApp = internals(app) as unknown as {
      _beginStageAttempt: (url: string) => number;
      _completeStageLoad: (loadedUrl?: string, bindingRevisionId?: string, attemptGeneration?: number) => void;
      _replaceStreamLifecycle: () => number;
      _getChildren: () => void;
    };
    const stageUrl = "stage://disconnect-proof.usdc";
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: stageUrl,
      stageLoadStatus: "pending",
    };
    vi.spyOn(privateApp, "_getChildren").mockImplementation(() => undefined);
    const attempt = privateApp._beginStageAttempt(stageUrl);
    internals(app).pendingStageUrl = stageUrl;
    privateApp._completeStageLoad(stageUrl, "rev_disconnect", attempt);

    privateApp._replaceStreamLifecycle();

    const stagePosts = parent.postMessage.mock.calls
      .map((call) => call[0] as { type?: string; stageUrl?: string | null; status?: string })
      .filter((message) => message.type === "stage_loaded");
    expect(stagePosts).toEqual([
      expect.objectContaining({ stageUrl, status: "active" }),
      expect.objectContaining({ stageUrl: null, status: "unproven" }),
    ]);
    expect(internals(app).state.loadedStageUrl).toBeNull();
    expect(internals(app).state.stageLoadStatus).toBe("unproven");
  });
});

// Task 5.6 slice-4：standalone viewer origin 頁的斷線／首幀逾時可見面（spec: 每態 SHALL 有穩定測試錨點與明示可行動作）。
// stream-disconnected 與 first-frame-timeout 共用 stream-diagnostic-panel 診斷面與 MockViewport 的
// viewer-reconnect-stream 動作（canReconnect: webrtcStatus ∈ stopped/terminated/failed）。
describe("task 5.6 standalone 失敗態可見面（slice-4）", () => {
  // 注意：useSynchronousSetState 名稱以 use 開頭，rules-of-hooks 會把具名 helper 內的呼叫誤判為
  // hook 違規；因此 app 準備（含該 helper）留在各 it 的匿名 callback 內，這裡只收斂 render 斷面。
  function terminalHtml(app: App): string {
    // MockViewport（reconnect 動作載體）的 render 分支守衛：viewerTab==="model" && reviewSessionId。
    internals(app).state = { ...internals(app).state, viewerTab: "model" };
    return renderToString(internals(app).render());
  }

  it("stream-disconnected：斷線終態 render 出 stream-diagnostic-panel 錨點與 viewer-reconnect-stream 動作", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    (internals(app) as unknown as {
      _handleStreamStopped: (kind: "stopped", message: unknown) => void;
    })._handleStreamStopped("stopped", { reason: "slice4_disconnect" });
    const html = terminalHtml(app);
    expect(html).toContain("data-testid=\"stream-diagnostic-panel\"");
    expect(html).toContain("webrtc_disconnected");
    expect(html).toContain("data-testid=\"viewer-reconnect-stream\"");
  });

  it("first-frame-timeout：stream start 逾時 render 出同一診斷 panel 錨點與 reconnect 動作", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const app = operableApp();
    useSynchronousSetState(app);
    vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
    (internals(app) as unknown as {
      _handleStreamStartTimeout: () => void;
    })._handleStreamStartTimeout();
    const html = terminalHtml(app);
    expect(html).toContain("data-testid=\"stream-diagnostic-panel\"");
    expect(html).toContain("WebRTC 串流未建立");
    expect(html).toContain("data-testid=\"viewer-reconnect-stream\"");
  });

  it("i18n 接線：en 模式下斷線診斷與 reconnect 動作以英文呈現", () => {
    setLang("en");
    try {
      vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
      const app = operableApp();
      useSynchronousSetState(app);
      vi.spyOn(AppStream, "stop").mockImplementation(() => undefined);
      (internals(app) as unknown as {
        _handleStreamStopped: (kind: "stopped", message: unknown) => void;
      })._handleStreamStopped("stopped", { reason: "slice4_i18n" });
      const html = terminalHtml(app);
      expect(html).toContain("Endpoint");
      expect(html).toContain("Reconnect WebRTC");
      expect(html).not.toContain("端點");
    }
    finally {
      setLang(initialLang);
    }
  });
});
