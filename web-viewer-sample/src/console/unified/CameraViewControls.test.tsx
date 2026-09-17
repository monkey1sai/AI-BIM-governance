import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CameraViewControls } from "./CameraViewControls";
import { getLang, setLang } from "../i18n";
import type { CameraState } from "../cameraViewBridge";

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
const ortho: CameraState = { projection: "orthographic", position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, fovDeg: null, orthoHeight: 12 };
beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
const button = (id: string) => box.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;

it("starts idle with every control disabled when the viewer is not ready", () => {
  act(() => root.render(<CameraViewControls ready={false} state={{ status: "idle" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未套用視角");
  expect(box.textContent).toContain("不是真北");
  expect([...box.querySelectorAll("button, input")].every(el => (el as HTMLButtonElement).disabled)).toBe(true);
  expect(box.querySelector("canvas,video,iframe")).toBeNull();
});
it("sends each preset with the building scope and switches to all when site is included", () => {
  const send = vi.fn();
  act(() => root.render(<CameraViewControls ready state={{ status: "idle" }} onSend={send} />));
  for (const view of ["top", "front", "back", "left", "right", "iso"]) act(() => button(`camera-preset-${view}`).click());
  expect(send.mock.calls.map(call => call[0])).toEqual(["top", "front", "back", "left", "right", "iso"]
    .map(view => ({ action: "preset", view, scope: "building" })));
  act(() => box.querySelector<HTMLInputElement>('[data-testid="camera-include-site"]')!.click());
  act(() => button("camera-preset-top").click());
  expect(send).toHaveBeenLastCalledWith({ action: "preset", view: "top", scope: "all" });
});
it("sends projection changes and marks the confirmed projection", () => {
  const send = vi.fn();
  act(() => root.render(<CameraViewControls ready state={{ status: "applied", camera: ortho }} onSend={send} />));
  expect(button("camera-projection-orthographic").getAttribute("aria-pressed")).toBe("true");
  expect(button("camera-projection-perspective").getAttribute("aria-pressed")).toBe("false");
  expect(box.textContent).toContain("正交");
  expect(box.textContent).toContain("(1.00, 2.00, 3.00)");
  act(() => button("camera-projection-perspective").click());
  expect(send).toHaveBeenCalledWith({ action: "projection", projection: "perspective" });
});
it("disables actions while pending and explains errors without internal words", () => {
  act(() => root.render(<CameraViewControls ready state={{ status: "pending" }} onSend={vi.fn()} />));
  expect(button("camera-preset-top").disabled).toBe(true);
  expect(box.textContent).toContain("等待套用");
  for (const reason of ["rejected", "transport", "timeout", "readback"] as const) {
    act(() => root.render(<CameraViewControls ready state={{ status: "error", reason }} onSend={vi.fn()} />));
    expect(box.textContent).toContain("未能套用");
    expect(box.textContent).not.toContain("ACK");
    expect(box.textContent).not.toContain("Roadmap");
  }
  act(() => root.render(<CameraViewControls ready state={{ status: "unconfirmed" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未確認");
});
