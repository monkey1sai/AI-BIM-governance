// Edge Console 誠實性 smoke：確認頁面可渲染、provenance 標記存在、A1 顯示「實測」證據、
// A2/A3 誠實標待建、無願景假數字。用 renderToString（不需 @testing-library / 網路）。
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppsPage, FederationPage, IssuesRuleCenterPage, OverviewPage, VersionDiffPage } from "./pages";

describe("edge console honesty smoke", () => {
  it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    const html = renderToString(<AppsPage onOpen={() => {}} />);
    expect(html).toContain("A1");
    expect(html).toContain("A10");
    expect(html).toContain("Governance &amp; Rule Checker");
    expect(html).toContain("ec-prov");
  });

  it("A1 Rule Center 顯示真實 IFC 實測 artifact（非捏造）", () => {
    const html = renderToString(<IssuesRuleCenterPage />);
    expect(html).toContain("7126"); // 真實評估構件數
    expect(html).toContain("實測 artifact");
    expect(html).toContain("執行規則檢核");
    expect(html).toContain("IDS-XML"); // 誠實標 IDS 待建
    expect(html).toContain("後端待建"); // BCF / Issue DB 待建
  });

  it("A2 / A3 為誠實骨架，標後端待建，不顯示捏造數字", () => {
    expect(renderToString(<VersionDiffPage />)).toContain("後端待建");
    expect(renderToString(<FederationPage />)).toContain("後端待建");
  });

  it("Overview 無任何願景假數字", () => {
    const html = renderToString(<OverviewPage />);
    expect(html).not.toContain("127 rules");
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
  });
});
