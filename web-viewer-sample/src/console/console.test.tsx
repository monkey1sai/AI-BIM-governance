// Edge Console 誠實性 smoke：確認頁面可渲染、provenance 標記存在、A1 顯示「實測」證據、
// A2/A3 帶 provenance 與真實邊界、無願景假數字。用 renderToString（不需 @testing-library / 網路）。
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
    expect(html).toContain("IDS-XML"); // IDS 匯入後端已實作（ifctester）
    // BCF 2.1 匯出後端已落地（純 stdlib，不依賴 GPLv3）→ 頁面誠實標「已實作」而非「待建」。
    expect(html).toContain("匯出 BCF 2.1");
    expect(html).not.toContain("99.1%"); // 無願景假數字
  });

  it("A2 / A3 帶 provenance、不顯示捏造數字", () => {
    const a2 = renderToString(<VersionDiffPage />);
    expect(a2).toContain("ec-prov"); // provenance 標記存在
    expect(a2).not.toContain("99.1%"); // 無願景假數字

    // A3 federation 後端已實作（per-member transform + review-room handoff），但仍誠實標 provenance
    // 與真實邊界（member immutable），不捏造數字。
    const a3 = renderToString(<FederationPage />);
    expect(a3).toContain("ec-prov");
    expect(a3).toContain("immutable"); // member usdc immutable 邊界
    expect(a3).not.toContain("99.1%");
  });

  it("Overview 無任何願景假數字", () => {
    const html = renderToString(<OverviewPage />);
    expect(html).not.toContain("127 rules");
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
  });
});
