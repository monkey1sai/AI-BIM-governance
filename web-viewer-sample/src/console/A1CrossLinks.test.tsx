// web-viewer-sample/src/console/A1CrossLinks.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A1GovernanceWorkbenchPage } from "./pages";

describe("A1 cross-link chips", () => {
  it("renders #minio and #sessions chips, disabled before any selection (evidence-typed)", () => {
    const html = renderToString(<A1GovernanceWorkbenchPage />);
    // Parse the SSR string into a DOM so `disabled` is asserted per-button, INDEPENDENT of JSX
    // prop-serialization order. `Btn` (components.tsx:113) renders `disabled` BEFORE `data-testid`
    // and nothing follows `data-testid` except `>`, so a regex like
    // /data-testid="a1-link-minio"[^>]*disabled/ can NEVER match the real markup even when the button
    // is correctly disabled. Use a DOM query (order-independent, same approach as every other task).
    const doc = new DOMParser().parseFromString(html, "text/html");
    const minio = doc.querySelector('[data-testid="a1-link-minio"]');
    const sessions = doc.querySelector('[data-testid="a1-link-sessions"]');
    expect(minio).not.toBeNull();
    expect(sessions).not.toBeNull();
    // No selection on server render → both chips must be disabled (no fake enabled navigation).
    expect((minio as HTMLButtonElement).disabled).toBe(true);
    expect((sessions as HTMLButtonElement).disabled).toBe(true);
  });

  it("upgrades the existing a1-conv-link to target #minio directly, carrying source=a1 (MD 三頁合一 Task 8：A1 → 模型資料與轉檔頁)", () => {
    const html = renderToString(<A1GovernanceWorkbenchPage />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const convLink = doc.querySelector('[data-testid="a1-conv-link"]');
    expect(convLink).not.toBeNull();
    const href = convLink?.getAttribute("href") ?? "";
    expect(href.startsWith("#minio")).toBe(true); // MD 合一後直接指向 #minio，不再依賴 #conv → #minio alias 重導（Task 7/8）
    expect(href).toContain("source=a1");          // receiver (ModelDataPage) reads source; job_id appended when a conv job exists
  });
});
