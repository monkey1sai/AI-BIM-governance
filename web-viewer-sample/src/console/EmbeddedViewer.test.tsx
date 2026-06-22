// EmbeddedViewer postMessage 橋測試（vg01 協定）
// 用 createRoot + act 比照 IntentDialog.test.tsx 慣例（無 @testing-library/react）
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedViewer } from "./EmbeddedViewer";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

function fireMessage(data: unknown, origin: string, source: Window | null) {
  const ev = new MessageEvent("message", { data, origin, source: source as Window });
  window.dispatchEvent(ev);
}

/** 共用 render helper：回傳 { container, root } */
function renderViewer(
  props: Parameters<typeof EmbeddedViewer>[0],
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
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
});
