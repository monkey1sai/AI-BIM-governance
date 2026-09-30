import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompassHud, CompassHudLive, type CompassSource } from "./CompassHud";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function show(heading: number | null) {
  act(() => root.render(<CompassHud heading={heading} />));
  return container.querySelector<HTMLElement>('[data-testid="viewer-compass"]')!;
}

describe("CompassHud", () => {
  it("turns the rose so the letter the camera looks toward is on top, labelled as project north", () => {
    const hud = show(90);
    expect(hud.dataset.heading).toBe("90");
    expect(hud.dataset.state).toBe("known");
    expect(hud.querySelector('[data-testid="viewer-compass-rose"]')!.getAttribute("transform")).toBe("rotate(-90)");
    expect(hud.textContent).toContain("專案北");
    expect(hud.textContent).not.toContain("真北");
    // pointer-events: none makes a tooltip unreachable; the explanation lives in the accessible name.
    expect(hud.getAttribute("title")).toBeNull();
    expect(hud.getAttribute("aria-label")).toContain("90°");
    expect(hud.getAttribute("aria-label")).toContain("方位以模型 +Y 為專案北");
  });

  it("keeps each letter upright while the rose turns", () => {
    const hud = show(135.4);
    expect(hud.dataset.heading).toBe("135");
    const north = hud.querySelector('[data-testid="viewer-compass-n"]')!;
    expect(north.textContent).toBe("N");
    expect(north.getAttribute("transform")).toBe("rotate(135.4 0 -29)");
    expect([...hud.querySelectorAll("text")].map(node => node.textContent)).toEqual(["N", "E", "S", "W"]);
  });

  it("rounds 359.6 degrees to north instead of 360", () => {
    expect(show(359.6).dataset.heading).toBe("0");
  });

  it("shows an un-rotated, dimmed rose and says the bearing is unknown when there is no reading", () => {
    const hud = show(null);
    expect(hud.dataset.heading).toBe("");
    expect(hud.dataset.state).toBe("unknown");
    expect(hud.querySelector('[data-testid="viewer-compass-rose"]')!.getAttribute("transform")).toBe("rotate(0)");
    expect(hud.textContent).toContain("方位未取得");
    expect(hud.textContent).not.toContain("專案北");
    expect(hud.getAttribute("aria-label")).toContain("方位以模型 +Y 為專案北；IFC 真北未接入時不代表真實方位");
  });

  it("discloses how many camera reads it has made", () => {
    expect(show(null).dataset.reads).toBe("0");
    act(() => root.render(<CompassHud heading={45} reads={7} />));
    expect(container.querySelector<HTMLElement>('[data-testid="viewer-compass"]')!.dataset.reads).toBe("7");
  });

  it("follows its reading source without the parent re-rendering", () => {
    let snapshot = { heading: null as number | null, reads: 0 };
    const listeners = new Set<() => void>();
    const source: CompassSource = {
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      getSnapshot: () => snapshot,
    };
    act(() => root.render(<CompassHudLive source={source} />));
    const hud = () => container.querySelector<HTMLElement>('[data-testid="viewer-compass"]')!;
    expect(hud().dataset.heading).toBe("");
    act(() => { snapshot = { heading: 270, reads: 1 }; listeners.forEach((listener) => listener()); });
    expect(hud().dataset.heading).toBe("270");
    expect(hud().dataset.reads).toBe("1");
  });

  it("never takes pointer input from the 3D stage", () => {
    const hud = show(0);
    expect(hud.getAttribute("aria-hidden")).toBeNull();
    expect(hud.className).toContain("gv-compass");
    expect(hud.querySelector("button, a, input")).toBeNull();
  });
});
