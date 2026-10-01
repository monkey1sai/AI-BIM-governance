import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CfdHudCanvas } from "./CfdHudCanvas";
import { drawCfdHud, type CfdHudModel } from "./cfdHud";
vi.mock("./cfdHud", async () => ({ ...await vi.importActual("./cfdHud"), drawCfdHud: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("paints at display resolution, follows camera readings, takes no input and releases observers/timers", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = disconnect; });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ scale: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 800, height: 600 } as DOMRect);
  let snapshot = { heading: 0, reads: 1 };
  const listeners = new Set<() => void>();
  const source = { subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, getSnapshot: () => snapshot };
  const hud: CfdHudModel = { revisionId: "rev", runId: "cfd_sample123", windFrom: 0, modelBearing: 0,
    northLabel: "相對 project north", validationLevel: "screening", purpose: "design_comparison_only", velocity: null, pressure: null };
  const container = document.createElement("div"), root = createRoot(container);
  act(() => root.render(<CfdHudCanvas hud={hud} source={source} />));
  const canvas = container.querySelector("canvas")!;
  expect(canvas.style.pointerEvents).toBe("none");
  expect(canvas.width).toBe(800 * window.devicePixelRatio);
  expect(canvas.getAttribute("aria-label")).toContain("設計比較用");
  act(() => { snapshot = { heading: 90, reads: 2 }; listeners.forEach(fn => fn()); });
  expect(vi.mocked(drawCfdHud).mock.calls.slice(-1)[0]?.[4]).toBe(90);
  const before = vi.mocked(drawCfdHud).mock.calls.length;
  act(() => vi.advanceTimersByTime(1000));
  expect(vi.mocked(drawCfdHud).mock.calls.length).toBe(before + 1);
  act(() => root.unmount());
  expect(disconnect).toHaveBeenCalled(); expect(listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
});
