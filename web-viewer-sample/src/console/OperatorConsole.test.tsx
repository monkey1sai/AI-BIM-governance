// web-viewer-sample/src/console/OperatorConsole.test.tsx
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import OperatorConsole, { OperatorBody, readPage } from "./OperatorConsole";

describe("readPage() 純函式：從 hash 解出 operator 頁", () => {
  afterEach(() => { window.location.hash = ""; });

  it("空 hash → coordinator（預設）", () => {
    window.location.hash = "";
    expect(readPage()).toBe("coordinator");
  });
  it("#intake → intake", () => {
    window.location.hash = "#intake";
    expect(readPage()).toBe("intake");
  });
  it("#/console/runtime → runtime", () => {
    window.location.hash = "#/console/runtime";
    expect(readPage()).toBe("runtime");
  });
  it("未知 hash → coordinator（fallback）", () => {
    window.location.hash = "#/console/does-not-exist";
    expect(readPage()).toBe("coordinator");
  });
});

describe("OperatorConsole 殼層穩定選取子（data-testid，供 E2E）", () => {
  afterEach(() => { window.location.hash = ""; });
  it("nav 三鍵 op-nav-<key> + 內容容器 op-page 皆渲染", () => {
    window.location.hash = "";
    const html = renderToString(<OperatorConsole />);
    expect(html).toContain('data-testid="op-nav-coordinator"');
    expect(html).toContain('data-testid="op-nav-intake"');
    expect(html).toContain('data-testid="op-nav-runtime"');
    expect(html).toContain('data-testid="op-page"');
  });
});

describe("OperatorConsole 三頁獨立（不含 A1–A10 overlay）", () => {
  it("coordinator 頁渲染 Coordinator 控制台且不含治理 overlay 容器", () => {
    const html = renderToString(<OperatorBody page="coordinator" />);
    expect(html).toContain("Coordinator"); // 控制台
    expect(html).not.toContain("gov-overlay"); // 不混入 A1–A10 overlay
  });

  it("intake 頁渲染選現成模型且不含治理 overlay", () => {
    const html = renderToString(<OperatorBody page="intake" />);
    expect(html).toContain("選取現成模型");
    expect(html).not.toContain("gov-overlay");
  });

  it("runtime 頁渲染 Runtime 狀態且不含治理 overlay", () => {
    const html = renderToString(<OperatorBody page="runtime" />);
    expect(html).toContain("Runtime");
    expect(html).not.toContain("gov-overlay");
  });
});
