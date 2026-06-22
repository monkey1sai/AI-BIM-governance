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
import App from "../Window";

const PARENT_ORIGIN = "http://127.0.0.1:8004"; // console（coordinator）origin；複用 VITE_ALLOWED_COORDINATOR_ORIGINS 白名單。

type AppInternals = {
  state: Record<string, unknown>;
  _handleParentMessage: (e: MessageEvent) => void;
  _overlayHighlight: (f: unknown) => unknown;
  _postToParent: (m: Record<string, unknown>) => void;
  _sendStreamMessage: (m: { event_type: string; payload?: unknown }) => void;
  _completeStageLoad: (loadedUrl?: string) => void;
  _finishStageLoad: () => void;
  _firstFramePosted: boolean;
  _mappingCache: { primPathForGuid: (g: string) => string | null } | null;
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
