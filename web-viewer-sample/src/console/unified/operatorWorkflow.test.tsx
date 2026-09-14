import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { getLang, setLang } from "../i18n";
import { WorkflowOrientation } from "./WorkflowOrientation";

describe("model-first operator workflow", () => {
  let language: ReturnType<typeof getLang>;
  let hash: string;
  beforeEach(() => { language = getLang(); hash = location.hash; setLang("zh"); });
  afterEach(() => { setLang(language); location.hash = hash; });

  it("explains the sequence without claiming live progress or treating reviews as files", () => {
    const node = document.createElement("div");
    node.innerHTML = renderToString(<WorkflowOrientation />);
    expect(node.querySelectorAll("ol li")).toHaveLength(4);
    expect(node.textContent).toContain("不是即時完成進度");
    expect(node.textContent).toContain("同一模型可以有多筆審查");
    expect(node.textContent).toContain("不可恢復為 active");
    expect(node.querySelector("a.op-primary")?.getAttribute("href")).toBe("#minio");
    expect(node.querySelectorAll("details:not([open])")).toHaveLength(2);
  });

  it.each(["home", "minio", "conv", "sessions", "instances", "a1"])("keeps #%s in the same operational navigation", route => {
    location.hash = route;
    const node = document.createElement("div");
    node.innerHTML = renderToString(<EdgeConsole />);
    expect(node.querySelector(".uc-root nav[aria-label='主要導覽']")).not.toBeNull();
    for (const target of ["#minio", "#conv", "#sessions", "#a1", "#runtime"]) {
      expect(node.querySelector(`nav a[href='${target}']`)).not.toBeNull();
    }
    expect(node.textContent).not.toContain("Demo Project – A1 Tower");
    expect(node.querySelector("input[placeholder*='搜尋專案']")).toBeNull();
    expect(node.textContent).toContain("服務狀態 ≠ 3D 已就緒");
  });

  it("does not disable all view tools just because the model tree is unavailable", () => {
    location.hash = "a1";
    const node = document.createElement("div");
    node.innerHTML = renderToString(<EdgeConsole />);
    const tools = node.querySelector("[data-uc='ws-stage-tree']");
    expect(tools?.hasAttribute("aria-disabled")).toBe(false);
    // Each individual tool still enforces its runtime gate.
    expect(tools?.querySelectorAll("button:disabled").length).toBeGreaterThan(0);
  });
});
