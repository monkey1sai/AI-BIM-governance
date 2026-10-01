import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CfdCaptureControls } from "./CfdCaptureControls";
import type { CfdCaptureResult } from "../../components/cfdCapture";

let root: Root, box: HTMLDivElement;
let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
let downloads: string[];
let createDescriptor: PropertyDescriptor | undefined, revokeDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
  createUrl = vi.fn(() => "blob:local-capture"); revokeUrl = vi.fn(); downloads = [];
  createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
});
afterEach(() => {
  act(() => root.unmount()); box.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor); else Reflect.deleteProperty(URL, "createObjectURL");
  if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor); else Reflect.deleteProperty(URL, "revokeObjectURL");
});
const button = (label: string) => [...box.querySelectorAll("button")].find(item => item.textContent === label)!;
const result: CfdCaptureResult = { blob: new Blob(["png"], { type: "image/png" }), filename: "cfd_test_w000_20261001T000000Z.png", width: 1920, height: 1080 };

it("downloads only the completed local blob once and releases its URL", async () => {
  let complete!: (value: CfdCaptureResult) => void;
  const capture = vi.fn(() => new Promise<CfdCaptureResult>(resolve => { complete = resolve; }));
  act(() => root.render(<CfdCaptureControls capture={capture} />));
  act(() => { button("下載 PNG").click(); button("下載 PNG").click(); });
  expect(capture).toHaveBeenCalledOnce(); expect(downloads).toEqual([]);
  await act(async () => complete(result));
  expect(downloads).toEqual([result.filename]);
  expect(box.textContent).toContain("1920×1080");
  await vi.advanceTimersByTimeAsync(1000);
  expect(revokeUrl).toHaveBeenCalledWith("blob:local-capture");
});

it("cancels a pending capture without downloading a partial result", async () => {
  let reject!: (error: Error) => void;
  const capture = vi.fn(() => new Promise<CfdCaptureResult>((_, fail) => { reject = fail; }));
  const cancel = vi.fn(() => reject(new Error("cancelled")));
  act(() => root.render(<CfdCaptureControls capture={capture} cancel={cancel} />));
  act(() => button("錄製 WebM").click());
  expect(capture).toHaveBeenCalledWith({ format: "webm", durationSeconds: 5 });
  await act(async () => button("取消擷取").click());
  expect(cancel).toHaveBeenCalledOnce(); expect(createUrl).not.toHaveBeenCalled();
  expect(box.textContent).toContain("未下載不完整檔案");
});

it("discards a late completion after the result controls unmount", async () => {
  let complete!: (value: CfdCaptureResult) => void;
  const capture = () => new Promise<CfdCaptureResult>(resolve => { complete = resolve; });
  const cancel = vi.fn();
  act(() => root.render(<CfdCaptureControls capture={capture} cancel={cancel} />));
  act(() => button("下載 PNG").click());
  act(() => root.render(null));
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => complete(result));
  expect(createUrl).not.toHaveBeenCalled(); expect(downloads).toEqual([]);
});
