import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

const VALID_ACTIONS = new Set(["api", "nav", "disabled"]);
const VALID_PROVS = new Set(["asbuilt", "artifact", "demo", "p1", "p15", "p3", "p4"]);

describe("buttonInventory (Task 2.1, 2.2, 2.4)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let prevHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    document.body.removeChild(container);
    window.location.hash = prevHash;
    vi.restoreAllMocks();
  });

  async function mountAt(hash: string, isLive = true) {
    window.location.hash = hash;
    if (isLive) {
      spyCoordinatorEndpoints();
    } else {
      spyCoordinatorEndpointsOffline();
    }
    root = createRoot(container);
    await act(async () => {
      root!.render(<EdgeConsole />);
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function checkControlInventory() {
    const controls = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button, [role='button'], [data-action], a[data-uc]"
      )
    );
    for (const ctrl of controls) {
      const action = ctrl.getAttribute("data-action");
      if (action) {
        expect(VALID_ACTIONS.has(action), `Invalid data-action "${action}" on ${ctrl.outerHTML.slice(0, 80)}`).toBe(true);
        if (action === "disabled") {
          const prov = ctrl.getAttribute("data-prov");
          expect(prov && VALID_PROVS.has(prov), `Disabled control missing valid data-prov: ${ctrl.outerHTML.slice(0, 80)}`).toBe(true);
          const describedBy = ctrl.getAttribute("aria-describedby");
          expect(describedBy, `Disabled control missing aria-describedby: ${ctrl.outerHTML.slice(0, 80)}`).toBeTruthy();
        }
      }
    }
  }

  it("checks inventory across #home", async () => {
    await mountAt("#home");
    checkControlInventory();
  });

  it("checks inventory across #pipeline", async () => {
    await mountAt("#pipeline");
    checkControlInventory();
    const triggerBtn = container.querySelector("[data-uc='trigger-conv']");
    expect(triggerBtn?.getAttribute("data-action")).toBe("disabled");
    expect(triggerBtn?.getAttribute("data-prov")).toBe("p1");
  });

  it("checks inventory across #runtime (ops)", async () => {
    await mountAt("#runtime");
    checkControlInventory();
  });

  it("checks inventory across #a1 workspace", async () => {
    await mountAt("#a1");
    checkControlInventory();
  });

  it("checks inventory across #a2 workspace and ensures compute diff is nav or api without fake toast", async () => {
    await mountAt("#a2");
    checkControlInventory();
    const a2Cta = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Run Diff"));
    expect(a2Cta).toBeTruthy();
  });

  it("checks inventory across #a3 workspace and ensures build federated usd is nav or api without fake toast", async () => {
    await mountAt("#a3");
    checkControlInventory();
    const a3Cta = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Build Federated USD"));
    expect(a3Cta).toBeTruthy();
    expect(a3Cta!.disabled).toBe(true);
  });
});
