// web-viewer-sample/src/console/OperatorConsole.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorBody } from "./OperatorConsole";

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
