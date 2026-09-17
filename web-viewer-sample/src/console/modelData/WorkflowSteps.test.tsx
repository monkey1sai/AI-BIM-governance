import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveWorkflowSteps } from "./stepProgress";
import { WorkflowSteps } from "./WorkflowSteps";

const states = (input: Parameters<typeof deriveWorkflowSteps>[0]) =>
  deriveWorkflowSteps(input).map((step) => `${step.key}:${step.state}`);

describe("deriveWorkflowSteps", () => {
  it("還沒選模型：第一步是現在要做的事，後兩步尚未開始", () => {
    const steps = deriveWorkflowSteps({ selectedName: null, convert: null, result: null });
    expect(steps.map((step) => step.key)).toEqual(["select", "convert", "result"]);
    expect(states({ selectedName: null, convert: null, result: null }))
      .toEqual(["select:active", "convert:todo", "result:todo"]);
    expect(steps[0]!.hint).toContain("model.ifc");
  });

  it("選好模型但沒轉過：第二步提示按「開始轉檔」", () => {
    const steps = deriveWorkflowSteps({ selectedName: "a/b/model.ifc", convert: "none", result: "none" });
    expect(steps.map((step) => step.state)).toEqual(["done", "active", "todo"]);
    expect(steps[0]!.hint).toBe("a/b/model.ifc");
    expect(steps[1]!.hint).toContain("開始轉檔");
  });

  it("轉檔中與報表整理中都是等待，不要求操作", () => {
    expect(states({ selectedName: "m.ifc", convert: "running", result: "pending" }))
      .toEqual(["select:done", "convert:waiting", "result:waiting"]);
  });

  it("轉檔完成且報表已產出：三步都完成", () => {
    expect(states({ selectedName: "m.ifc", convert: "ready", result: "generated" }))
      .toEqual(["select:done", "convert:done", "result:done"]);
  });

  it("最新轉檔失敗時提醒，較早的報表仍算已產出", () => {
    expect(states({ selectedName: "m.ifc", convert: "failed", result: "generated" }))
      .toEqual(["select:done", "convert:attention", "result:done"]);
  });

  it("報表不可用時帶出原因", () => {
    const steps = deriveWorkflowSteps({ selectedName: "m.ifc", convert: "ready", result: "problem", resultLabel: "未產出報表" });
    expect(steps[2]!.state).toBe("attention");
    expect(steps[2]!.status).toBe("未產出報表");
    expect(steps[2]!.hint).toContain("重新轉檔");
  });

  it("讀取失敗標成需要注意", () => {
    expect(states({ selectedName: "m.ifc", convert: "error", result: "error" }))
      .toEqual(["select:done", "convert:attention", "result:attention"]);
  });
});

describe("WorkflowSteps", () => {
  let node: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    node.remove();
  });

  it("依序列出三步，第一個未完成的步驟標為目前步驟", async () => {
    const steps = deriveWorkflowSteps({ selectedName: "m.ifc", convert: "none", result: "none" });
    await act(async () => root.render(<WorkflowSteps steps={steps} />));
    const list = node.querySelector('[data-testid="md-steps"]');
    expect(list?.tagName).toBe("OL");
    const items = [...node.querySelectorAll("li[data-step]")];
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual(["done", "active", "todo"]);
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, "step", null]);
    expect(items[1]!.textContent).toContain("轉檔");
    expect(items[1]!.textContent).toContain("尚未轉檔");
  });

  it("全部完成時沒有目前步驟", async () => {
    const steps = deriveWorkflowSteps({ selectedName: "m.ifc", convert: "ready", result: "generated" });
    await act(async () => root.render(<WorkflowSteps steps={steps} />));
    expect(node.querySelector('[aria-current="step"]')).toBeNull();
  });
});
