import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SectionPlaneControls } from "./SectionPlaneControls";
import { getLang, setLang } from "../i18n";
let root: Root, box: HTMLDivElement;
const previousLang = getLang();
beforeEach(() => { setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; box = document.createElement("div"); document.body.append(box); root = createRoot(box); });
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
it("keeps controls outside the viewport and starts with no assumed effective state", () => {
  act(() => root.render(<SectionPlaneControls ready={false} state={{ status: "idle" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未設定");
  expect(box.textContent).toContain("模型座標單位");
  expect(box.querySelector("canvas,video,iframe")).toBeNull();
  expect([...box.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
});
it("sends explicit coordinates and prevents pending actions", () => {
  const send = vi.fn();
  act(() => root.render(<SectionPlaneControls ready state={{ status: "idle" }} onSend={send} />));
  const apply = box.querySelector<HTMLButtonElement>('[data-testid="section-apply"]')!;
  act(() => apply.click());
  expect(send).toHaveBeenCalledWith({ enabled: true, axis: "z", direction: 1, position: 0 });
  act(() => root.render(<SectionPlaneControls ready state={{ status: "pending" }} onSend={send} />));
  expect(apply.disabled).toBe(true);
  expect(box.textContent).toContain("等待套用");
});

it("allows off after an invalid unsubmitted draft and sends a safe off payload", () => {
  const send = vi.fn();
  act(() => root.render(<SectionPlaneControls ready state={{ status: "applied", effective: { enabled: true, axis: "x", direction: -1, position: 15 } }} onSend={send} />));
  const input = box.querySelector<HTMLInputElement>('input[type="number"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(box.querySelector<HTMLButtonElement>('[data-testid="section-apply"]')!.disabled).toBe(true);
  const off = box.querySelector<HTMLButtonElement>('[data-testid="section-off"]')!;
  expect(off.disabled).toBe(false);
  act(() => off.click());
  expect(send).toHaveBeenCalledWith({ enabled: false, axis: "z", direction: 1, position: 0 });
});
it("separates effective result from editable draft and shows invalidation", () => {
  act(() => root.render(<SectionPlaneControls ready state={{ status: "applied", effective: { enabled: true, axis: "x", direction: -1, position: 15 } }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("已回覆設定：X");
  expect(box.textContent).toContain("15");
  act(() => root.render(<SectionPlaneControls ready state={{ status: "unconfirmed" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("尚未確認");
  expect(box.textContent).not.toContain("已回覆設定");
});
it.each(["rejected", "transport", "timeout", "readback"] as const)("renders a human reason for %s", reason => {
  act(() => root.render(<SectionPlaneControls ready state={{ status: "error", reason }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("未能套用");
  expect(box.textContent).not.toContain("ACK");
  expect(box.textContent).not.toContain("Roadmap");
});
