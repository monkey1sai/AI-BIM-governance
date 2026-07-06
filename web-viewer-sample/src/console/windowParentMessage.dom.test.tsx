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

const PARENT_ORIGIN = "http://127.0.0.1:8004"; // console（coordinator）origin；複用 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單。

type AppInternals = {
  state: Record<string, unknown>;
  _handleParentMessage: (e: MessageEvent) => void;
  _handleCustomEvent: (event: { event_type?: string; messageRecipient?: string; data?: string; payload?: unknown } | null) => void;
  _overlayHighlight: (f: unknown) => unknown;
  _postToParent: (m: Record<string, unknown>, allowedOriginsCache?: ReadonlySet<string>) => void;
  _sendStreamMessage: (m: { event_type: string; payload?: unknown }) => void;
  _appendReviewEvent: (event: string) => void;
  _appendDemoOutgoing: (label: string, payload: unknown) => void;
  _appendDemoIncoming: (label: string, payload: unknown) => void;
  _completeStageLoad: (loadedUrl?: string) => void;
  _completeStageLoadFromVisibleStream: () => boolean;
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
  const app = new App({} as never);
  internals(app).state = {
    ...internals(app).state,
    viewerTab: "issues",
    reviewSessionId: "review_session_x",
    reviewLifecycleStatus: "active",
  };
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
  reviewEnv.viewerLeaseToken = "";
  reviewEnv.sourceClientId = "dev_user_001";
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

    expect(sendSpy).toHaveBeenCalledWith({ event_type: "loadingStateQuery", payload: {} });
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
      }),
    });
  });

  it("openedStageResult with binding_revision_id is the production binding apply acknowledgement", () => {
    const app = operableApp();
    useSynchronousSetState(app);
    internals(app).state = {
      ...internals(app).state,
      expectedStageUrl: "stage://primary.usdc",
      govBindingApplyState: { status: "applying" },
    };
    vi.spyOn(internals(app), "_appendDemoIncoming").mockImplementation(() => {});
    vi.spyOn(internals(app), "_appendReviewEvent").mockImplementation(() => {});

    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: {
        result: "success",
        url: "stage://primary.usdc",
        binding_revision_id: "rev_binding_001",
      },
    });

    expect(internals(app).state.govBindingActiveRevision).toBe("rev_binding_001");
    expect(internals(app).state.govBindingLastGoodRevision).toBe("rev_binding_001");
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "applied" });
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
    const app = operableApp();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/viewer-leases/claim")) {
        return new Response(JSON.stringify({ lease_id: "viewer_lease_primary", lease_token: "lease_token_primary", role: "primary" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/stage-binding")) {
        return new Response(JSON.stringify({ ok: true }), {
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
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      viewer_id: "dev_user_001",
      requested_role: "primary",
    });
    expect(String(fetchSpy.mock.calls[1][0])).toContain("/api/review-sessions/review_session_x/stage-binding");
    expect(fetchSpy.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-Viewer-Lease-Token": "lease_token_primary" }),
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[1][1]?.body))).toMatchObject({
      source_client_id: "viewer_lease_primary",
      role: "primary",
      binding_revision_id: "rev_binding_001",
      primary_artifact_id: "artifact_primary",
    });
    expect(sendSpy).toHaveBeenCalledWith({
      event_type: "loadArtifactGroupRequest",
      payload: {
        binding_revision_id: "rev_binding_001",
        stage_composition: {
          primary: expect.objectContaining({
            artifact_id: "artifact_primary",
            usdc_url: "stage://primary.usdc",
            load_order: 0,
          }),
          secondary_layers: [],
        },
      },
    });
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
    expect(posted.find((m) => m.type === "stage_loaded")).toMatchObject({ stageUrl: null });
  });

  it("Kit 真回報相符 loaded URL（_completeStageLoad(url)）→ first_frame / stage_loaded 帶該真 url（非 null）", () => {
    vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", PARENT_ORIGIN);
    const parent = setEmbedded(`${PARENT_ORIGIN}/ui`);
    const app = new App({} as never);
    const stageUrl = "stage://visible-stream.usdc";
    internals(app).state = { ...internals(app).state, expectedStageUrl: stageUrl, loadedStageUrl: null };
    internals(app).pendingStageUrl = stageUrl;

    internals(app)._completeStageLoad(stageUrl); // Kit handler 路徑：帶真 loaded URL

    // 對照組：有 Kit 證實的 loaded URL 時，first_frame/stage_loaded 才攜帶真 stageUrl（A1 端據此閉合 stage-match）。
    const posted = parent.postMessage.mock.calls.map((c) => c[0] as { type?: string; stageUrl?: string | null });
    expect(posted.find((m) => m.type === "first_frame")).toMatchObject({ stageUrl });
    expect(posted.find((m) => m.type === "stage_loaded")).toMatchObject({ stageUrl });
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

  it("openedStageResult success 但 loaded URL 與 expected 不符 → failed(stale_stage_or_mismatch)，不宣告 applied", () => {
    const app = bindingApplyApp();
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: { result: "success", url: "stage://stale-other.usdc", binding_revision_id: "rev_binding_002" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "stale_stage_or_mismatch" });
    expect(internals(app).state.govBindingActiveRevision).toBeUndefined();
  });

  it("openedStageResult success 但缺 loaded URL（無 stage-match 證據）→ failed(missing_stage_evidence)，不偽宣告 applied", () => {
    const app = bindingApplyApp();
    internals(app)._handleCustomEvent({
      event_type: "openedStageResult",
      payload: { result: "success", binding_revision_id: "rev_binding_003" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "missing_stage_evidence" });
    expect(internals(app).state.govBindingActiveRevision).toBeUndefined();
  });

  it("loadArtifactGroupResult result=error → failed 帶 Kit error reason", () => {
    const app = bindingApplyApp();
    internals(app)._handleCustomEvent({
      event_type: "loadArtifactGroupResult",
      payload: { result: "error", binding_revision_id: "rev_binding_004", error: "kit_compose_failed" },
    });
    expect(internals(app).state.govBindingApplyState).toEqual({ status: "failed", reason: "kit_compose_failed" });
  });
});
