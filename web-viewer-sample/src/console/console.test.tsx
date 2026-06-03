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

  it("A1 補匯出 Excel（真實）與在 3D 中標示（誠實 p1，無 DataChannel）", () => {
    const html = renderToString(<IssuesRuleCenterPage />);
    // [匯出 Excel]：client exportUrl 直連 proxy，真實下載（asbuilt）。
    expect(html).toContain("匯出 Excel");
    // [匯出 Excel] SHALL 標 asbuilt（誠實標示操作員看得到 provenance），且初始（無成功 run）SHALL disabled。
    const excelBtn = html.match(/<button[^>]*disabled[^>]*>[^<]*?匯出 Excel[\s\S]*?<\/button>/);
    expect(excelBtn).not.toBeNull();
    expect(excelBtn?.[0]).toContain("已實作"); // PROV_LABEL.asbuilt
    // [在 3D 中標示]：console 無 viewer DataChannel → 誠實標 p1，且按鈕 disabled（非假按鈕）。
    expect(html).toContain("在 3D 中標示");
    expect(html).toContain("後端待建 · P1"); // PROV_LABEL.p1
    expect(html).toContain("DataChannel"); // 誠實說明：需 viewer DataChannel
  });

  it("A2 補 apply-overlay：誠實標 p15，不假裝成功", () => {
    const a2 = renderToString(<VersionDiffPage />);
    expect(a2).toContain("ec-prov"); // provenance 標記存在
    expect(a2).not.toContain("99.1%"); // 無願景假數字
    // apply-overlay 後端誠實回 501 → UI 標 p15 + 說明走 client highlightPrimsRequest，非 server-push。
    expect(a2).toContain("套用 3D Overlay");
    expect(a2).toContain("後端待建 · P1.5"); // PROV_LABEL.p15
    expect(a2).toContain("501"); // 誠實顯示後端回應碼，不偽裝成功
    // 初始（尚無成功 diff）時 [套用 3D Overlay] SHALL disabled（真實 gating，須 diff status===succeeded
    // 才 enable；失敗 / 無結果保持 disabled）——非點了無意義的假按鈕。
    const overlayBtn = a2.match(/<button[^>]*>[\s\S]*?套用 3D Overlay[\s\S]*?<\/button>/);
    expect(overlayBtn).not.toBeNull();
    expect(overlayBtn?.[0]).toContain("disabled");
  });

  it("A3 補 member visibility toggle：build 時帶入，改動須重新 Build（誠實，不捏造即時）", () => {
    // A3 federation 後端已實作（per-member transform + review-room handoff），但仍誠實標 provenance
    // 與真實邊界（member immutable），不捏造數字。
    const a3 = renderToString(<FederationPage />);
    expect(a3).toContain("ec-prov");
    expect(a3).toContain("immutable"); // member usdc immutable 邊界
    expect(a3).not.toContain("99.1%");
    // visibility checkbox 存在；誠實標示「無即時切換、須重新 Build」（不捏造即時能力）。
    expect(a3).toContain("visible");
    expect(a3).toContain("重新 Build");
    expect(a3).toContain("visibility_default");
  });

  it("Overview 無任何願景假數字", () => {
    const html = renderToString(<OverviewPage />);
    expect(html).not.toContain("127 rules");
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
  });
});
