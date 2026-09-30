import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompassHud } from "./CompassHud";

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
    expect(hud.getAttribute("title")).toBe("方位以模型 +Y 為專案北；IFC 真北未接入時不代表真實方位");
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
    expect(hud.getAttribute("title")).toBe("方位以模型 +Y 為專案北；IFC 真北未接入時不代表真實方位");
  });

  it("never takes pointer input from the 3D stage", () => {
    const hud = show(0);
    expect(hud.getAttribute("aria-hidden")).toBeNull();
    expect(hud.className).toContain("gv-compass");
    expect(hud.querySelector("button, a, input")).toBeNull();
  });
});
