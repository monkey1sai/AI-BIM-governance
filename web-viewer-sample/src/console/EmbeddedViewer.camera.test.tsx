import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EmbeddedViewer, type EmbeddedViewerHandle } from "./EmbeddedViewer";

const VIEWER_ORIGIN = "http://127.0.0.1:5173";
const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: 40, orthoHeight: null };
function fire(data: unknown, origin: string, source: Window | null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
}
async function mount() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const ref = { current: null as EmbeddedViewerHandle | null };
  await act(async () => root.render(<EmbeddedViewer ref={ref} sessionId="review_session_camera" viewerOrigin={VIEWER_ORIGIN} />));
  const frame = container.querySelector("iframe")!, source = frame.contentWindow!;
  const post = vi.spyOn(source, "postMessage");
  fire({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, source);
  return { container, root, ref, frame, source, post,
    lastId: () => (post.mock.calls[post.mock.calls.length - 1][0] as { clientRequestId: string }).clientRequestId,
    async dispose() { post.mockRestore(); await act(async () => root.unmount()); container.remove(); } };
}

it("camera view resolves only the correlated reply from the actual frame", async () => {
  const view = await mount();
  const reply = view.ref.current!.commands.send("camera_view", { action: "preset", view: "iso", scope: "all" });
  expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "camera_view",
    camera: { action: "preset", view: "iso", scope: "all" } });
  const ack = { protocol: "vg01", type: "camera_view_result", status: "applied", requestId: "runtime_1",
    clientRequestId: view.lastId(), camera };
  fire(ack, "https://evil.test", view.source);
  fire({ ...ack, clientRequestId: "old" }, VIEWER_ORIGIN, view.source);
  fire({ ...ack, camera: { ...camera, fovDeg: 999 } }, VIEWER_ORIGIN, view.source);
  let settled = false; void reply.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  fire(ack, VIEWER_ORIGIN, view.source);
  expect(await reply).toMatchObject({ status: "applied", camera: { targetDistance: 30 } });
  await view.dispose();
});
it("camera state and fly speed use their own result types", async () => {
  const view = await mount();
  const state = view.ref.current!.commands.send("camera_state", null);
  fire({ protocol: "vg01", type: "camera_state_result", status: "applied", requestId: "r2", clientRequestId: view.lastId(), camera },
    VIEWER_ORIGIN, view.source);
  expect((await state).status).toBe("applied");
  const fly = view.ref.current!.commands.send("fly_navigation", 3);
  expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "fly_navigation", speed: 3 });
  fire({ protocol: "vg01", type: "fly_navigation_result", status: "applied", requestId: "r3", clientRequestId: view.lastId(), speed: 2 },
    VIEWER_ORIGIN, view.source);
  expect(await fly).toMatchObject({ status: "applied", speed: 2 });
  await view.dispose();
});
it("rejects invalid input, reports busy, and cancels on reload or unmount", async () => {
  const view = await mount();
  expect(await view.ref.current!.commands.send("fly_navigation", 0)).toEqual({ status: "error", reason: "invalid" });
  expect(await view.ref.current!.commands.send("camera_view", { action: "projection", projection: "fisheye" } as never))
    .toEqual({ status: "error", reason: "invalid" });
  const first = view.ref.current!.commands.send("camera_view", { action: "projection", projection: "orthographic" });
  expect(await view.ref.current!.commands.send("camera_state", null)).toEqual({ status: "error", reason: "busy" });
  await act(async () => view.frame.dispatchEvent(new Event("load")));
  expect(await first).toEqual({ status: "unconfirmed" });
  fire({ protocol: "vg01", type: "viewer_ready" }, VIEWER_ORIGIN, view.source);
  const again = view.ref.current!.commands.send("fly_navigation", 2);
  await act(async () => view.root.unmount());
  expect(await again).toEqual({ status: "unconfirmed" });
  view.post.mockRestore(); view.container.remove();
});
it("an unsolicited unconfirmed result invalidates viewer command state", async () => {
  const onSectionInvalidated = vi.fn();
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<EmbeddedViewer sessionId="review_session_camera" viewerOrigin={VIEWER_ORIGIN}
    onSectionInvalidated={onSectionInvalidated} />));
  const source = container.querySelector("iframe")!.contentWindow!;
  fire({ protocol: "vg01", type: "camera_view_result", status: "unconfirmed" }, VIEWER_ORIGIN, source);
  fire({ protocol: "vg01", type: "fly_navigation_result", status: "unconfirmed" }, VIEWER_ORIGIN, source);
  expect(onSectionInvalidated).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount()); container.remove();
});
it("sends view and section commands when the page is not a secure context", async () => {
  // LAN http pages have no crypto.randomUUID; commands must still be sent.
  vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
  const view = await mount();
  try {
    const fly = view.ref.current!.commands.send("fly_navigation", 1);
    expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "fly_navigation", speed: 1 });
    expect(view.lastId()).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    fire({ protocol: "vg01", type: "fly_navigation_result", status: "applied", requestId: "r4", clientRequestId: view.lastId(), speed: 1 },
      VIEWER_ORIGIN, view.source);
    expect(await fly).toMatchObject({ status: "applied", speed: 1 });
    const firstId = view.lastId();
    void view.ref.current!.commands.send("section_plane", { enabled: true, axis: "z", direction: 1, position: 1 });
    expect(view.post.mock.calls[view.post.mock.calls.length - 1][0]).toMatchObject({ type: "section_plane" });
    expect(view.lastId()).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
    expect(view.lastId()).not.toBe(firstId);
  } finally {
    vi.unstubAllGlobals();
    await view.dispose();
  }
});
