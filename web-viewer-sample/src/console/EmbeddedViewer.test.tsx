// EmbeddedViewer postMessage 橋測試（vg01 協定）
// 用 createRoot + act 比照 IntentDialog.test.tsx 慣例（無 @testing-library/react）
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedViewer, type EmbeddedViewerHandle } from "./EmbeddedViewer";
import type { StageBindingResultMessage, StageBindingSelection } from "../viewerCommandChannel/viewerEmbedProtocol";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

it("section download-style bridge only resolves correlated replies from the actual frame", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const ref = { current: null as EmbeddedViewerHandle | null };
  await act(async () => root.render(<EmbeddedViewer ref={ref} sessionId="review_session_section" viewerOrigin={VIEWER_ORIGIN} />));
  const frame = container.querySelector("iframe")!, source = frame.contentWindow!;
  const post = vi.spyOn(source, "postMessage");
  fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, source);
  let settled = false;
  const reply = ref.current!.commands.send("section_plane", { enabled: true, axis: "z", direction: 1, position: 2 }).then(value => { settled = true; return value; });
  const id = (post.mock.calls[post.mock.calls.length - 1][0] as { clientRequestId: string }).clientRequestId;
  const ack = { protocol: "vg01", type: "section_result", status: "applied", requestId: "runtime_1", clientRequestId: id };
  fireMessage(ack, "https://evil.test", source); fireMessage(ack, VIEWER_ORIGIN, window);
  fireMessage({ ...ack, clientRequestId: "old" }, VIEWER_ORIGIN, source);
  await Promise.resolve(); expect(settled).toBe(false);
  fireMessage(ack, VIEWER_ORIGIN, source); expect((await reply).status).toBe("applied");
  post.mockRestore(); await act(async () => root.unmount()); container.remove();
});
it("section pending is cancelled on iframe reload and unmount", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const ref = { current: null as EmbeddedViewerHandle | null };
  await act(async () => root.render(<EmbeddedViewer ref={ref} sessionId="review_session_section" viewerOrigin={VIEWER_ORIGIN} />));
  const frame = container.querySelector("iframe")!, source = frame.contentWindow!;
  fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, source);
  const pending = ref.current!.commands.send("section_plane", { enabled: true, axis: "z", direction: 1, position: 2 });
  await act(async () => frame.dispatchEvent(new Event("load")));
  expect((await pending).status).toBe("unconfirmed");
  fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, source);
  const again = ref.current!.commands.send("section_plane", { enabled: false, axis: "z", direction: 1, position: 2 });
  await act(async () => root.unmount()); expect((await again).status).toBe("unconfirmed"); container.remove();
});


function fireMessage(data: unknown, origin: string, source: Window | null) {
  const ev = new MessageEvent("message", { data, origin, source: source as Window });
  window.dispatchEvent(ev);
}

describe("EmbeddedViewer postMessage 橋", () => {
  let prev: unknown;
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    prev = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    (globalThis as Record<string, unknown>)[actEnvKey] = prev;
  });

  it("iframe src 帶 session query 指向 viewerOrigin", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("src")).toContain(VIEWER_ORIGIN);
    expect(iframe.getAttribute("src")).toContain("session=review_session_abc");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(iframe.getAttribute("allow")).toContain("autoplay");
  });

  it("origin 不符的 message 丟棄（不呼叫 callback）", async () => {
    const onFirstFrame = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={onFirstFrame} />);
    });
    // source 用 iframe.contentWindow（即正確來源 frame），讓本測試「只」隔離 origin 守衛：
    // 若改用 window 當 source，source 守衛會先擋下、即使 origin 守衛退化也會誤過。
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, "http://evil.example", iframeWin);
    expect(onFirstFrame).not.toHaveBeenCalled();
  });

  it("viewerOrigin 帶尾斜線/路徑前綴時：純 origin 的 message 仍被接受（normalize 守衛）", async () => {
    const onFirstFrame = vi.fn();
    root = createRoot(container);
    await act(async () => {
      // 部署常見：viewer 入口 base 帶尾斜線甚至路徑前綴；e.origin 永遠是純 origin。
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={`${VIEWER_ORIGIN}/bim-viewer/`} onFirstFrame={onFirstFrame} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, VIEWER_ORIGIN, iframeWin);
    expect(onFirstFrame).toHaveBeenCalledTimes(1);
  });

  it("stream_state 訊息經 origin 守衛後轉發 onStreamState（task 5.6 stream-disconnected）", async () => {
    const onStreamState = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onStreamState={onStreamState} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "stream_state", state: "disconnected", kind: "stopped" }, "http://evil.example", iframeWin);
    expect(onStreamState).not.toHaveBeenCalled();
    fireMessage({ protocol: "vg01", type: "stream_state", state: "disconnected", kind: "stopped" }, VIEWER_ORIGIN, iframeWin);
    expect(onStreamState).toHaveBeenCalledTimes(1);
    expect(onStreamState.mock.calls[0][0]).toMatchObject({ state: "disconnected", kind: "stopped" });
  });

  it("iframe src 帶尾斜線 viewerOrigin 不產生雙斜線、且帶 coordinator handoff query", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={`${VIEWER_ORIGIN}/`}
          coordinatorApiBase="http://192.168.10.105:8004"
          coordinatorSocketUrl="http://192.168.10.105:8004"
        />,
      );
    });
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src.startsWith(`${VIEWER_ORIGIN}/?`)).toBe(true); // 尾斜線被吸收，無 `//?`
    expect(src).not.toContain("//?");
    expect(src).toContain("session=review_session_abc");
    expect(src).toContain("coordinatorApiBase=http%3A%2F%2F192.168.10.105%3A8004");
    expect(src).toContain("coordinatorSocketUrl=http%3A%2F%2F192.168.10.105%3A8004");
  });

  it("iframe src 只帶 primary viewer lease identity，不把 token 放進 URL", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          streamRole="primary"
          kitInstanceId="kit_local_001"
          userId="a1_auto_primary"
          displayName="A1 auto primary viewer"
          sourceClientId="viewer_lease_primary"
          viewerLeaseToken="lease_token_primary"
          userToken="local_user_token_primary"
        />,
      );
    });
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src).toContain("session=review_session_abc");
    expect(src).toContain("streamRole=primary");
    expect(src).toContain("kitInstanceId=kit_local_001");
    expect(src).toContain("userId=a1_auto_primary");
    expect(src).toContain("displayName=A1+auto+primary+viewer");
    expect(src).toContain("sourceClientId=viewer_lease_primary");
    expect(src).not.toContain("viewerLeaseToken");
    expect(src).not.toContain("lease_token_primary");
    expect(src).not.toContain("userToken");
    expect(src).not.toContain("local_user_token_primary");
  });

  // 迴歸鎖：viewer main.tsx 的 bootstrapStructLog 是 fail-closed——iframe URL 少了 trace_id
  // 就 throw、React 不 mount、畫面全白且不發起 WebRTC。coordinator /ui/open 會補 canonical
  // trace_id，內嵌路徑必須同樣帶上，否則 A1 / A2 / A3 / A4 的 inline viewer 一律白畫面。
  it("iframe src 帶 canonical trace_id（缺 trace carrier viewer 會 fail-closed 白畫面）", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          traceId="rev_review_session_abc"
        />,
      );
    });
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src).toContain("trace_id=rev_review_session_abc");
  });

  // ifc-ready 建立的 session 的 canonical trace 前綴是 ifcready_，不是 rev_：
  // 前端只能透傳 coordinator 給的值，不得自行合成 `rev_${sessionId}`。
  it("iframe src 原樣透傳 ifcready_ 前綴的 trace carrier", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          traceId="ifcready_1788403854334_c383a04a"
        />,
      );
    });
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src).toContain("trace_id=ifcready_1788403854334_c383a04a");
    expect(src).not.toContain("rev_review_session_abc");
  });

  it("未提供 trace carrier 時不塞空的 trace_id query", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const src = container.querySelector("iframe")!.getAttribute("src")!;
    expect(src).not.toContain("trace_id");
  });

  it("viewer_ready 後用 postMessage 傳 viewer lease token（targetOrigin 非 \"*\"）", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          viewerLeaseToken="lease_token_primary"
          userToken="local_user_token_primary"
        />,
      );
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");

    fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, iframeWin);

    expect(postSpy).toHaveBeenCalledWith(
      {
        protocol: "vg01",
        type: "viewer_lease_token",
        token: "lease_token_primary",
        user_token: "local_user_token_primary",
      },
      VIEWER_ORIGIN,
    );
  });

  it("缺 protocol 的 message 丟棄", async () => {
    const onSelectedGuid = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onSelectedGuid={onSelectedGuid} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ type: "selected_guid", ifcGuid: "g1" }, VIEWER_ORIGIN, iframeWin);
    expect(onSelectedGuid).not.toHaveBeenCalled();
  });

  it("vg01 message 由 iframe.contentWindow 來時分派到對應 callback", async () => {
    const onFirstFrame = vi.fn();
    const onHighlightResult = vi.fn();
    const onSelectedGuid = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          onFirstFrame={onFirstFrame}
          onHighlightResult={onHighlightResult}
          onSelectedGuid={onSelectedGuid}
        />,
      );
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" }, VIEWER_ORIGIN, iframeWin);
    fireMessage({ protocol: "vg01", type: "highlight_result", requestId: "r1", ok: false, reason: "unmapped" }, VIEWER_ORIGIN, iframeWin);
    fireMessage({ protocol: "vg01", type: "selected_guid", ifcGuid: "guid-123" }, VIEWER_ORIGIN, iframeWin);
    expect(onFirstFrame).toHaveBeenCalledWith(expect.objectContaining({ stageUrl: "stage://x" }));
    expect(onHighlightResult).toHaveBeenCalledWith(expect.objectContaining({ reason: "unmapped" }));
    expect(onSelectedGuid).toHaveBeenCalledWith("guid-123");
  });

  // 對抗複驗 Important #1：viewer_ready / stage_loaded 也須有 dispatch 回歸鎖（Task 3 stage-truth 比對依賴 onStageLoaded）。
  it("vg01 viewer_ready / stage_loaded 分派到對應 callback", async () => {
    const onViewerReady = vi.fn();
    const onStageLoaded = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN}
          onViewerReady={onViewerReady} onStageLoaded={onStageLoaded} />,
      );
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, iframeWin);
    const stageLoaded = {
      protocol: "vg01" as const,
      type: "stage_loaded" as const,
      stageUrl: "stage://loaded",
      status: "active" as const,
      binding_revision_id: "rev_binding_001",
    };
    fireMessage(stageLoaded, VIEWER_ORIGIN, iframeWin);
    expect(onViewerReady).toHaveBeenCalledTimes(1);
    expect(onStageLoaded).toHaveBeenCalledWith(stageLoaded);
  });

  it("stage_loaded 缺 authority status 時正規化為 unproven；unproven 狀態誠實分派", async () => {
    const onStageLoaded = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onStageLoaded={onStageLoaded} />,
      );
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "stage_loaded", stageUrl: "stage://legacy" }, VIEWER_ORIGIN, iframeWin);
    expect(onStageLoaded).toHaveBeenCalledWith({
      protocol: "vg01",
      type: "stage_loaded",
      stageUrl: null,
      status: "unproven",
    });
    onStageLoaded.mockClear();

    const unproven = {
      protocol: "vg01" as const,
      type: "stage_loaded" as const,
      stageUrl: null,
      status: "unproven" as const,
      binding_revision_id: "rev_binding_002",
    };
    fireMessage(unproven, VIEWER_ORIGIN, iframeWin);
    expect(onStageLoaded).toHaveBeenCalledWith(unproven);
  });

  it("bearer 在 viewer_ready 前不送；ready 後 props 晚到才經受限 origin 交付", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");

    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          viewerLeaseToken="lease_token_late"
          userToken="local_user_late_a"
        />,
      );
    });
    expect(postSpy).not.toHaveBeenCalled();

    fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, iframeWin);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "viewer_lease_token",
      token: "lease_token_late",
      user_token: "local_user_late_a",
    }), VIEWER_ORIGIN);

    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          viewerLeaseToken="lease_token_late"
          userToken="local_user_late_b"
        />,
      );
    });
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      token: "lease_token_late",
      user_token: "local_user_late_b",
    }), VIEWER_ORIGIN);
  });

  it("iframe navigation clears readiness and withholds bearer until the new document sends viewer_ready", async () => {
    const onViewerReady = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          viewerLeaseToken="lease_token_before_reload"
          userToken="local_user_before_reload"
          onViewerReady={onViewerReady}
        />,
      );
    });
    const iframe = container.querySelector("iframe")!;
    const iframeWin = iframe.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");

    fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, iframeWin);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(onViewerReady).toHaveBeenCalledTimes(1);

    await act(async () => { iframe.dispatchEvent(new Event("load")); });
    await act(async () => {
      root!.render(
        <EmbeddedViewer
          sessionId="review_session_abc"
          viewerOrigin={VIEWER_ORIGIN}
          viewerLeaseToken="lease_token_after_reload"
          userToken="local_user_after_reload"
          onViewerReady={onViewerReady}
        />,
      );
    });
    expect(postSpy).toHaveBeenCalledTimes(1);

    fireMessage({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, iframeWin);
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      token: "lease_token_after_reload",
      user_token: "local_user_after_reload",
    }), VIEWER_ORIGIN);
    expect(onViewerReady).toHaveBeenCalledTimes(2);
  });

  it("message 來自非 iframe.contentWindow 的 source 丟棄", async () => {
    const onFirstFrame = vi.fn();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={onFirstFrame} />);
    });
    // window 非 iframe.contentWindow → 應丟棄
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, VIEWER_ORIGIN, window);
    expect(onFirstFrame).not.toHaveBeenCalled();
  });

  // 送出側：spec §6.2 要求 postMessage targetOrigin 必須是 viewerOrigin（非 "*"）
  it("sendHighlight 經 ref handle 送到 contentWindow.postMessage（type=highlight + items + targetOrigin 非 \"*\"）", async () => {
    const ref = createRef<EmbeddedViewerHandle>();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer ref={ref} sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");
    const items = [{ ifc_guid: "guid-1", severity: "high", rule_code: "R-01" }];
    await act(async () => { ref.current!.sendHighlight(items, "client-highlight-1"); });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postSpy.mock.calls[0];
    expect(payload).toEqual({ protocol: "vg01", type: "highlight", items, clientRequestId: "client-highlight-1" });
    expect(targetOrigin).toBe(VIEWER_ORIGIN); // 非 "*"
  });

  // A2 F2⑥ 批次疊加：sendHighlightBatch 走獨立 type=highlight_batch（viewer 端組單一
  // highlightPrimsRequest 聯集選取），不與逐筆 type=highlight 混用；targetOrigin 同樣非 "*"。
  it("sendHighlightBatch 經 ref handle 送 type=highlight_batch（單一 postMessage 帶全部 items，targetOrigin 非 \"*\"）", async () => {
    const ref = createRef<EmbeddedViewerHandle>();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer ref={ref} sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");
    const items = [
      { ifc_guid: "guid-add", severity: "added" },
      { ifc_guid: "guid-del", severity: "error" },
      { ifc_guid: "guid-mod", severity: "warning" },
    ];
    await act(async () => { ref.current!.sendHighlightBatch(items, "client-highlight-batch-1"); });

    expect(postSpy).toHaveBeenCalledTimes(1); // 單一 postMessage，非逐筆
    const [payload, targetOrigin] = postSpy.mock.calls[0];
    expect(payload).toEqual({ protocol: "vg01", type: "highlight_batch", items, clientRequestId: "client-highlight-batch-1" });
    expect(targetOrigin).toBe(VIEWER_ORIGIN);
  });

  it("sendFocus / sendClear 送出帶 viewerOrigin 的 targetOrigin（非 \"*\"）", async () => {
    const ref = createRef<EmbeddedViewerHandle>();
    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer ref={ref} sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} />);
    });
    const iframeWin = container.querySelector("iframe")!.contentWindow!;
    const postSpy = vi.spyOn(iframeWin, "postMessage");
    await act(async () => { ref.current!.sendFocus("guid-9"); });
    await act(async () => { ref.current!.sendClear(); });

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[0][0]).toEqual({ protocol: "vg01", type: "focus", ifc_guid: "guid-9" });
    expect(postSpy.mock.calls[0][1]).toBe(VIEWER_ORIGIN);
    expect(postSpy.mock.calls[1][0]).toEqual({ protocol: "vg01", type: "clear" });
    expect(postSpy.mock.calls[1][1]).toBe(VIEWER_ORIGIN);
  });

  // 回歸鎖（IMPORTANT #1）：message listener 只掛一次，不因 re-render（新 props object reference）重掛。
  // 舊 dep=[props] 會在每個 render cycle remove+add，detach/attach 微小時窗會靜默丟訊息。
  it("父元件多次 re-render 不重掛 message listener（addEventListener 僅一次），且最新 callback 仍生效", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const countMessage = (calls: unknown[][]) => calls.filter(([t]) => t === "message").length;

    root = createRoot(container);
    await act(async () => {
      root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={vi.fn()} />);
    });
    // 模擬高頻 poll：多次以新的 props object（新 inline closure）重渲染
    let onFirstFrameLatest = vi.fn();
    for (let i = 0; i < 3; i++) {
      onFirstFrameLatest = vi.fn();
      await act(async () => {
        root!.render(<EmbeddedViewer sessionId="review_session_abc" viewerOrigin={VIEWER_ORIGIN} onFirstFrame={onFirstFrameLatest} />);
      });
    }

    // listener 只掛一次、未在 re-render 期間 remove（舊 [props] 寫法會掛 4 次 / remove 3 次）
    expect(countMessage(addSpy.mock.calls)).toBe(1);
    expect(countMessage(removeSpy.mock.calls)).toBe(0);

    // 且 propsRef 仍指向最新 callback：re-render 後送訊息分派到最後一個 onFirstFrame
    const iframeWin = container.querySelector("iframe")!.contentWindow;
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "stage://y" }, VIEWER_ORIGIN, iframeWin);
    expect(onFirstFrameLatest).toHaveBeenCalledWith(expect.objectContaining({ stageUrl: "stage://y" }));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

// stage-binding 套用的回覆對照（docs/architecture/viewport-slot-adr.md 2026-09-24 修訂）：同一時間只開一筆；
// 別的 id、沒有 id、錯 origin、錯來源的回覆一律忽略；90 s 未回以 timed_out 結算，卸載以 superseded 結算並清掉 timer。
describe("EmbeddedViewer applyStageBinding 對照", () => {
  const ARTIFACTS: StageBindingSelection[] = [{ artifact_id: "art_primary", role: "primary", load_order: 0 }];
  const APPLIED = { protocol: "vg01", type: "stage_binding_result", status: "applied", revision_id: "rev_1" } as const;
  const failed = (clientRequestId: string, reason: string): StageBindingResultMessage =>
    ({ protocol: "vg01", type: "stage_binding_result", status: "failed", clientRequestId, revision_id: null, reason });
  const tick = () => act(async () => { await Promise.resolve(); });
  let prev: unknown;

  /** 結算前 result 為 undefined，斷言當下就失敗，不必等到測試逾時。 */
  function track(promise: Promise<StageBindingResultMessage>) {
    const box: { result?: StageBindingResultMessage } = {};
    void promise.then(result => { box.result = result; });
    return box;
  }

  async function mount() {
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container); const ref = createRef<EmbeddedViewerHandle>();
    await act(async () => root.render(<EmbeddedViewer ref={ref} sessionId="review_session_binding" viewerOrigin={VIEWER_ORIGIN} />));
    const source = container.querySelector("iframe")!.contentWindow!;
    // 不交給 jsdom 真的投遞（它會再排一個 setTimeout），pending timer 就只有 90 s 逾時這一個。
    const post = vi.spyOn(source, "postMessage").mockImplementation(() => {});
    return {
      handle: ref.current!, source, post,
      lastRequest: () => post.mock.calls[post.mock.calls.length - 1][0] as { clientRequestId: string },
      async dispose() { await act(async () => root.unmount()); container.remove(); },
    };
  }

  beforeEach(() => {
    prev = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prev;
  });

  it("posts apply_stage_binding with a fresh client request id to the viewer origin and settles on the reply carrying it", async () => {
    const view = await mount();
    const first = track(view.handle.applyStageBinding(ARTIFACTS));
    const id = view.lastRequest().clientRequestId;
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    expect(view.post.mock.calls).toEqual([[{ protocol: "vg01", type: "apply_stage_binding", artifacts: ARTIFACTS, clientRequestId: id }, VIEWER_ORIGIN]]);
    expect(vi.getTimerCount()).toBe(1);
    fireMessage({ ...APPLIED, clientRequestId: id }, VIEWER_ORIGIN, view.source);
    await tick();
    expect(first.result).toEqual({ ...APPLIED, clientRequestId: id });
    expect(vi.getTimerCount()).toBe(0);
    void view.handle.applyStageBinding(ARTIFACTS);
    expect(view.post).toHaveBeenCalledTimes(2);
    expect(view.lastRequest().clientRequestId).not.toBe(id);
    await view.dispose();
  });

  it("answers command_pending without posting while a request is open", async () => {
    const view = await mount();
    const open = track(view.handle.applyStageBinding(ARTIFACTS));
    const second = track(view.handle.applyStageBinding(ARTIFACTS));
    await tick();
    expect(second.result).toMatchObject({ status: "failed", reason: "command_pending", revision_id: null });
    expect(second.result?.clientRequestId).not.toBe(view.lastRequest().clientRequestId);
    expect(view.post).toHaveBeenCalledTimes(1);
    expect(open.result).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    await view.dispose();
  });

  it("ignores replies with another id, without an id, from another origin or from another frame", async () => {
    const view = await mount();
    const open = track(view.handle.applyStageBinding(ARTIFACTS));
    const id = view.lastRequest().clientRequestId;
    fireMessage({ ...APPLIED, clientRequestId: "someone_else" }, VIEWER_ORIGIN, view.source);
    fireMessage(APPLIED, VIEWER_ORIGIN, view.source);
    fireMessage({ ...APPLIED, clientRequestId: id }, "https://evil.test", view.source);
    fireMessage({ ...APPLIED, clientRequestId: id }, VIEWER_ORIGIN, window);
    await tick();
    expect(open.result).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    fireMessage({ ...APPLIED, clientRequestId: id }, VIEWER_ORIGIN, view.source);
    await tick();
    expect(open.result).toEqual({ ...APPLIED, clientRequestId: id });
    await view.dispose();
  });

  it("settles timed_out after 90 s, and the late reply of that request does not settle the next one", async () => {
    const view = await mount();
    const expired = track(view.handle.applyStageBinding(ARTIFACTS));
    const expiredId = view.lastRequest().clientRequestId;
    await act(async () => { vi.advanceTimersByTime(89_999); });
    await tick();
    expect(expired.result).toBeUndefined();
    await act(async () => { vi.advanceTimersByTime(1); });
    await tick();
    expect(expired.result).toEqual(failed(expiredId, "timed_out"));
    expect(vi.getTimerCount()).toBe(0);
    const next = track(view.handle.applyStageBinding(ARTIFACTS));
    const nextId = view.lastRequest().clientRequestId;
    expect(nextId).not.toBe(expiredId);
    fireMessage({ ...APPLIED, clientRequestId: expiredId }, VIEWER_ORIGIN, view.source);
    await tick();
    expect(next.result).toBeUndefined();
    fireMessage({ ...APPLIED, clientRequestId: nextId }, VIEWER_ORIGIN, view.source);
    await tick();
    expect(next.result).toEqual({ ...APPLIED, clientRequestId: nextId });
    await view.dispose();
  });

  it("settles the open request as superseded and clears its timer on unmount", async () => {
    const view = await mount();
    const open = track(view.handle.applyStageBinding(ARTIFACTS));
    const id = view.lastRequest().clientRequestId;
    expect(vi.getTimerCount()).toBe(1);
    await view.dispose();
    await tick();
    expect(open.result).toEqual(failed(id, "superseded"));
    expect(vi.getTimerCount()).toBe(0);
  });
});
