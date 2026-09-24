import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FlyNavigationControls } from "./FlyNavigationControls";
import { getLang, setLang } from "../i18n";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
const noCommands = fakeViewerCommandPort({});
beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
const button = (id: string) => box.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
function setSpeed(value: string) {
  const input = box.querySelector<HTMLInputElement>('input[type="number"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("explains the official fly controls", () => {
  act(() => root.render(<FlyNavigationControls ready commands={noCommands} state={{ status: "idle" }} camera={{ status: "idle" }} />));
  for (const text of ["先點一下 3D 畫面", "按住滑鼠右鍵", "W／A／S／D", "Q／E", "滾輪"]) expect(box.textContent).toContain(text);
  expect(box.querySelector('[data-testid="fly-speed-hint"]')?.textContent).toContain("每秒 7 公尺");
});
it("applies only a bounded speed and shows the Kit readback", () => {
  const setFlySpeed = vi.fn();
  const commands = fakeViewerCommandPort({ fly_navigation: setFlySpeed });
  act(() => root.render(<FlyNavigationControls ready commands={commands} state={{ status: "idle" }} camera={{ status: "idle" }} />));
  act(() => button("fly-speed-apply").click());
  expect(setFlySpeed).toHaveBeenCalledWith(1);
  setSpeed("0");
  expect(button("fly-speed-apply").disabled).toBe(true);
  expect(box.querySelector('[role="alert"]')).not.toBeNull();
  setSpeed("2.5");
  act(() => button("fly-speed-apply").click());
  expect(setFlySpeed).toHaveBeenLastCalledWith(2.5);
  act(() => root.render(<FlyNavigationControls ready commands={commands} state={{ status: "applied", speed: 2 }} camera={{ status: "idle" }} />));
  expect(box.textContent).toContain("目前速度：2");
});
it("reads the camera and shows the confirmed position", () => {
  const readCamera = vi.fn();
  const camera = { status: "applied" as const, camera: { projection: "perspective" as const, position: [4, 5, 6] as [number, number, number],
    direction: [0, 1, 0] as [number, number, number], up: [0, 0, 1] as [number, number, number], targetDistance: 3, fovDeg: 45, orthoHeight: null } };
  act(() => root.render(<FlyNavigationControls ready commands={fakeViewerCommandPort({ camera_state: readCamera })} state={{ status: "idle" }} camera={camera} />));
  act(() => button("fly-read-camera").click());
  expect(readCamera).toHaveBeenCalledTimes(1);
  expect(readCamera).toHaveBeenCalledWith(null);
  expect(box.querySelector('[data-testid="fly-camera-summary"]')!.textContent).toContain("(4.00, 5.00, 6.00)");
});
it("disables everything when the viewer is not ready", () => {
  act(() => root.render(<FlyNavigationControls ready={false} commands={noCommands} state={{ status: "idle" }} camera={{ status: "idle" }} />));
  expect(button("fly-speed-apply").disabled).toBe(true);
  expect(button("fly-read-camera").disabled).toBe(true);
  expect(box.textContent).toContain("沒有操作權限");
});
it("shows a specific blocked reason when provided, and the generic sentence otherwise", () => {
  act(() => root.render(<FlyNavigationControls ready={false} commands={noCommands} state={{ status: "idle" }} camera={{ status: "idle" }}
    blockedReason="spectator 唯讀" />));
  expect(box.textContent).toContain("無法操作：spectator 唯讀");
  expect(box.textContent).not.toContain("模型尚未就緒或目前沒有操作權限。");
  act(() => root.render(<FlyNavigationControls ready={false} commands={noCommands} state={{ status: "idle" }} camera={{ status: "idle" }} />));
  expect(box.textContent).toContain("模型尚未就緒或目前沒有操作權限。");
});
