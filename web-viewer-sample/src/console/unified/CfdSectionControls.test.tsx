import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CfdSectionControls } from "./CfdSectionControls";
import type { CfdRunDirectionResult } from "./cfdClient";
import type { CameraState } from "../../viewerCommandChannel/camera";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";

const direction = { presentation: { version: 2,
  sections: [{ id: "z25", axis: "z", position_m: 5, label: "Z 0.25H", source: "standard", polygons: 2 }],
  prims: [{ name: "Section_z25", role: "section" }, { name: "Section_z25_Vectors", role: "section_vectors" }],
} } as unknown as CfdRunDirectionResult;
const camera: CameraState = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  targetDistance: 30, centerOfInterest: [0, 0, -30], fovDeg: 60, orthoHeight: null };
let root: Root, box: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  box = document.createElement("div"); document.body.append(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });
const button = () => box.querySelector<HTMLButtonElement>('[data-testid="wind-section-view-z25"]')!;

describe("CFD section controls", () => {
  it("waits for every Kit step, reports partial failure and offers restoration", async () => {
    const onApplied = vi.fn(), onActive = vi.fn();
    const view = vi.fn(async () => ({ status: "unconfirmed" as const }));
    const commands = fakeViewerCommandPort({
      camera_state: async () => ({ status: "applied", camera }),
      overlay_visibility: async input => ({ status: "applied", items: input.items.map(i => ({ primPath: i.primPath, present: true, visible: i.visible ?? false })) }),
      section_plane: async input => "action" in input ? { status: "applied", readback: { enabled: false, owned: false, planes: [] } }
        : { status: "error", reason: "rejected" },
      camera_view: view,
    });
    act(() => root.render(<CfdSectionControls artifactId="cfd:run:w000" direction={direction} ready commands={commands} onApplied={onApplied} onActive={onActive} />));
    await act(async () => button().click());
    expect(onApplied).not.toHaveBeenCalledWith(direction.presentation!.sections[0]);
    expect(box.querySelector('[role="alert"]')!.textContent).toContain("裁切");
    expect(box.querySelector<HTMLButtonElement>('[data-testid="wind-section-leave"]')!.disabled).toBe(false);
    expect(view).not.toHaveBeenCalled();
    expect(box.querySelector('[data-testid="wind-section-steps"] [data-state="error"]')!.textContent).toContain("2 裁切");
  });
  it("re-enables the new binding after a pending old reply and rejects its late HUD update", async () => {
    let release!: (value: { status: "applied"; camera: CameraState }) => void;
    const onApplied = vi.fn(), onActive = vi.fn();
    const commands = fakeViewerCommandPort({ camera_state: () => new Promise(resolve => { release = resolve; }) });
    const render = (artifactId: string) => act(() => root.render(<CfdSectionControls artifactId={artifactId} direction={direction} ready
      commands={commands} onApplied={onApplied} onActive={onActive} />));
    render("cfd:old:w000");
    await act(async () => button().click()); expect(button().disabled).toBe(true);
    render("cfd:new:w000"); expect(button().disabled).toBe(false);
    await act(async () => release({ status: "applied", camera }));
    expect(onApplied.mock.calls.every(args => args[0] === null)).toBe(true);
    expect(box.querySelector('[role="alert"]')).toBeNull();
    expect(box.querySelector('[data-testid="wind-section-steps"]')!.textContent).toBe("");
  });
});
