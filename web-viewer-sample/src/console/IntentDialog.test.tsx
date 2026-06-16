import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentDialog } from "./IntentDialog";

describe("IntentDialog", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement; let prev: unknown;
  beforeEach(() => { prev = (globalThis as Record<string, unknown>)[actEnvKey]; (globalThis as Record<string, unknown>)[actEnvKey] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); (globalThis as Record<string, unknown>)[actEnvKey] = prev; });

  it("open=false 不渲染內容", async () => {
    const root = createRoot(container);
    await act(async () => { root.render(<IntentDialog open={false} title="t" cost="c" onConfirm={async () => {}} onCancel={() => {}} />); });
    expect(container.textContent ?? "").not.toContain("確認執行");
  });

  it("確認執行呼叫 onConfirm 帶 reason 文字", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const root = createRoot(container);
    await act(async () => { root.render(<IntentDialog open title="插隊" cost="此 job 將排到佇列最前" onConfirm={onConfirm} onCancel={() => {}} />); });
    const textarea = container.querySelector("textarea")!;
    await act(async () => { textarea.value = "趕工"; textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("確認執行"))!;
    await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onConfirm).toHaveBeenCalledWith("趕工");
  });
});
