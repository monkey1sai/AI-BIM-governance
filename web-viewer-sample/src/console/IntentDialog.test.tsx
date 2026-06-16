import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentDialog } from "./IntentDialog";

describe("IntentDialog", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement; let prev: unknown; let root: Root | null;
  beforeEach(() => { prev = (globalThis as Record<string, unknown>)[actEnvKey]; (globalThis as Record<string, unknown>)[actEnvKey] = true; container = document.createElement("div"); document.body.appendChild(container); root = null; });
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); document.body.removeChild(container); (globalThis as Record<string, unknown>)[actEnvKey] = prev; });

  it("open=false 不渲染內容", async () => {
    root = createRoot(container);
    await act(async () => { root!.render(<IntentDialog open={false} title="t" cost="c" onConfirm={async () => {}} onCancel={() => {}} />); });
    expect(container.textContent ?? "").not.toContain("確認執行");
  });

  it("確認執行呼叫 onConfirm 帶 reason 文字", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    root = createRoot(container);
    await act(async () => { root!.render(<IntentDialog open title="插隊" cost="此 job 將排到佇列最前" onConfirm={onConfirm} onCancel={() => {}} />); });
    const textarea = container.querySelector("textarea")!;
    await act(async () => { textarea.value = "趕工"; textarea.dispatchEvent(new Event("input", { bubbles: true })); });
    const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("確認執行"))!;
    await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onConfirm).toHaveBeenCalledWith("趕工");
  });

  // onConfirm reject 時，component 不得讓 rejection 逸散成 unhandledrejection。
  // 失敗顯示誠實錯誤、不關 dialog 的責任在 caller（caller 須自行 catch+setErr），
  // 但 component 本身要有安全網：click handler await 並吞掉 rejection，避免使用者只看到 console
  // 一個無聲的 unhandledrejection。caller 仍負責 UI 反饋，此處只防 promise 逸散。
  it("onConfirm reject 不逸散為 unhandledrejection（component 安全網）", async () => {
    const rejections: unknown[] = [];
    const onRej = (e: PromiseRejectionEvent) => { rejections.push(e.reason); e.preventDefault(); };
    globalThis.addEventListener?.("unhandledrejection", onRej as EventListener);
    try {
      const onConfirm = vi.fn().mockRejectedValue(new Error("POST 502"));
      root = createRoot(container);
      await act(async () => { root!.render(<IntentDialog open title="插隊" cost="此 job 將排到佇列最前" onConfirm={onConfirm} onCancel={() => {}} />); });
      const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("確認執行"))!;
      await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      // 讓 microtask queue 排空，rejection（若有）會在此前觸發。
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(onConfirm).toHaveBeenCalled();
      expect(rejections).toHaveLength(0);
    } finally {
      globalThis.removeEventListener?.("unhandledrejection", onRej as EventListener);
    }
  });
});
