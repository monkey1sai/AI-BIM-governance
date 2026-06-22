// EmbeddedViewer postMessage 橋測試（vg01 協定）
// 用 createRoot + act 比照 IntentDialog.test.tsx 慣例（無 @testing-library/react）
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedViewer, type EmbeddedViewerHandle } from "./EmbeddedViewer";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

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
    fireMessage({ protocol: "vg01", type: "first_frame", stageUrl: "u" }, "http://evil.example", window);
    expect(onFirstFrame).not.toHaveBeenCalled();
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
    fireMessage({ protocol: "vg01", type: "stage_loaded", stageUrl: "stage://loaded" }, VIEWER_ORIGIN, iframeWin);
    expect(onViewerReady).toHaveBeenCalledTimes(1);
    expect(onStageLoaded).toHaveBeenCalledWith("stage://loaded");
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
    await act(async () => { ref.current!.sendHighlight(items); });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [payload, targetOrigin] = postSpy.mock.calls[0];
    expect(payload).toEqual({ protocol: "vg01", type: "highlight", items });
    expect(targetOrigin).toBe(VIEWER_ORIGIN); // 非 "*"
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
      // eslint-disable-next-line no-await-in-loop
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
