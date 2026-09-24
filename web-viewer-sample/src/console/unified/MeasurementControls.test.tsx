import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { MeasurementControls } from "./MeasurementControls";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import { getLang, setLang } from "../i18n";

let root: Root, box: HTMLDivElement;
const previousLang = getLang();
beforeEach(() => {
  setLang("zh"); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); setLang(previousLang); });
const button = (name: string) => box.querySelector<HTMLButtonElement>(`[data-testid="measurement-${name}"]`)!;

it("disables unavailable start, permits pending cancellation, and only displays confirmed distance", () => {
  const send = vi.fn();
  act(() => root.render(<MeasurementControls ready={false} state={{ status: "idle" }} onSend={send} />));
  expect(button("start").disabled).toBe(true);
  expect(box.querySelector("output,video,iframe")).toBeNull();
  act(() => root.render(<MeasurementControls ready state={{ status: "pending" }} onSend={send} />));
  expect(button("start").disabled).toBe(true);
  act(() => button("cancel").click());
  expect(send).toHaveBeenCalledWith("cancel");
  act(() => root.render(<MeasurementControls ready state={{ status: "result", distanceMetres: 2.3 }} onSend={send} />));
  expect(box.querySelector("output")?.textContent).toBe("2.300 m");
  act(() => button("clear").click());
  expect(send).toHaveBeenLastCalledWith("clear");
  act(() => root.render(<MeasurementControls ready state={{ status: "unconfirmed" }} onSend={send} />));
  expect(box.querySelector("output")).toBeNull();
});

it("retains provider measurement across Dock subscriptions and invalidates it on session or gate loss", () => {
  let slot: ViewportSlotApi;
  function Probe() { slot = useViewportSlot()!; return null; }
  act(() => root.render(<ViewportSlotProvider><Probe /></ViewportSlotProvider>));
  const send = vi.fn(() => true);
  act(() => {
    slot.setActiveSessionId("review_session_one");
    slot.registerHostActions?.({ commands: fakeViewerCommandPort({}, send) });
    slot.setGate(OPEN_GATE);
    slot.setMeasurementState?.({ status: "result", distanceMetres: 2.3 });
  });
  let dispose: () => void;
  act(() => { dispose = slot.subscribeDock({}); });
  act(() => { dispose(); slot.subscribeDock({}); });
  expect(slot!.measurementState).toMatchObject({ status: "result", distanceMetres: 2.3 });
  act(() => slot.sendMeasurement?.("start"));
  expect(send).toHaveBeenCalledWith("start");
  act(() => slot.setActiveSessionId("review_session_two"));
  expect(slot!.measurementState?.status).toBe("unconfirmed");
  act(() => slot.sendMeasurement?.("start"));
  expect(send).toHaveBeenCalledOnce();
  act(() => {
    slot.setGate(OPEN_GATE);
    slot.setMeasurementState?.({ status: "second" });
  });
  act(() => slot.setGate(null));
  expect(slot!.measurementState?.status).toBe("unconfirmed");
  act(() => slot.sendMeasurement?.("cancel"));
  expect(send).toHaveBeenLastCalledWith("cancel");
});
it("explains a native surface miss and keeps confirmed coordinates collapsed", () => {
  act(() => root.render(<MeasurementControls ready state={{ status: "error", reason: "restore_focus_before_measurement" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("請先按「還原檢視」");
  act(() => root.render(<MeasurementControls ready state={{ status: "error", reason: "no_hit" }} onSend={vi.fn()} />));
  expect(box.textContent).toContain("未點到模型表面");
  expect(box.querySelector("output")).toBeNull();
  act(() => root.render(<MeasurementControls ready state={{ status: "result", requestId: "request-1", distanceMetres: 3,
    points: [[0, 0, 0], [0, 0, 3]] }} onSend={vi.fn()} />));
  const details = box.querySelector<HTMLDetailsElement>("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("3.000000");
  expect(details.textContent).toContain("request-1");
  act(() => root.render(<MeasurementControls ready state={{ status: "unconfirmed" }} onSend={vi.fn()} />));
  expect(box.querySelector("details,output")).toBeNull();
});
