import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceFlowGuide } from "./WorkspaceFlowGuide";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";

describe("WorkspaceFlowGuide A1", () => {
  let container: HTMLDivElement;
  let root: Root;
  let slot: ViewportSlotApi | null = null;
  function Probe() { slot = useViewportSlot(); return null; }

  beforeEach(async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(<ViewportSlotProvider><Probe /><WorkspaceFlowGuide dock="a1" /></ViewportSlotProvider>); });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  const states = () => [...container.querySelectorAll("[data-uc^='ws-flow-step-']")]
    .map(step => [step.getAttribute("data-uc")!.replace("ws-flow-step-", ""), step.getAttribute("data-state")]);

  it("orders A1 by function and does not mark the rule check done just because a review is selected", async () => {
    expect(states()).toEqual([["review", "current"], ["3d", "todo"], ["run", "todo"], ["highlight", "todo"], ["deliver", "todo"]]);
    await act(async () => { slot!.setActiveSessionId("review_session_x"); });
    expect(states()).toEqual([["review", "done"], ["3d", "current"], ["run", "todo"], ["highlight", "todo"], ["deliver", "todo"]]);
  });

  it("marks only the step right after 3D as current once 3D is ready", async () => {
    await act(async () => {
      slot!.setActiveSessionId("review_session_x");
      slot!.setGate({ canSend: true, reason: "", canSendViewerCommand: true, viewerCommandReason: "" });
    });
    expect(states()).toEqual([["review", "done"], ["3d", "done"], ["run", "current"], ["highlight", "todo"], ["deliver", "todo"]]);
  });
});
