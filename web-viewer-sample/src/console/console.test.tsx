// Edge Console 誠實性 smoke：確認頁面可渲染、provenance 標記存在、A1 顯示「實測」證據、
// A2/A3 帶 provenance 與真實邊界、無願景假數字。用 renderToString（不需 @testing-library / 網路）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppsPage, CoordinatorPage, FederationPage, IntakePage, IssuesRuleCenterPage, OverviewPage, RuntimePage, SemanticViewerPage, VersionDiffPage } from "./pages";
import { coordinatorClient } from "./coordinatorClient";
import { DEPENDENCIES, ENDPOINTS } from "./data";
import { isFakeMappingDocument } from "../types/mapping";

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

  // ── P2-1 Overview：BoundaryDiagram + DEPENDENCIES + ENDPOINTS（誠實授權風險）──
  it("P2-1 Overview DEPENDENCIES 標 copyleft 且不寫「零授權風險」", () => {
    const html = renderToString(<OverviewPage />);
    // 授權風險表必須出現 copyleft（LGPL 元件），且嚴禁「零授權風險 / 零相依」字串。
    expect(html).toContain("copyleft");
    expect(html).toContain("LGPL-3.0");
    expect(html).not.toContain("零授權風險");
    expect(html).not.toContain("零相依");
    // 三欄服務邊界圖：WEB-PLANE → BOUNDARY → INTERNAL，視覺化「瀏覽器永不直連」。
    expect(html).toContain("WEB-PLANE");
    expect(html).toContain("瀏覽器永不直連");
    // ENDPOINTS 路由清單：真實 coordinator route（查證自 app.ts）。
    expect(html).toContain("/api/runtime/status");
    expect(html).toContain("/api/external/ifc-ready");
  });

  it("P2-1 DEPENDENCIES 常量含 copyleft 條目，無「零授權風險」宣稱", () => {
    expect(DEPENDENCIES.some((d) => d.risk === "copyleft")).toBe(true);
    expect(DEPENDENCIES.every((d) => !/零授權風險|zero.?license.?risk/i.test(`${d.name}${d.use}${d.note ?? ""}`))).toBe(true);
  });

  // ── P2-2 Semantic Viewer：fake-vs-real 隔離（fake mapping 被標 demo / 拒絕當真）──
  it("P2-2 Semantic Viewer 誠實標示 fake 隔離與 p1（無 DataChannel）", () => {
    const html = renderToString(<SemanticViewerPage />);
    expect(html).toContain("fake-vs-real 隔離");
    expect(html).toContain("fake_for_smoke_test");
    // 點構件 highlight 需 viewer DataChannel（console 無此鏈）→ 標 p1，不做假按鈕。
    expect(html).toContain("DataChannel");
    expect(html).toContain("後端待建 · P1"); // PROV_LABEL.p1
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
  });

  it("P2-2 fake mapping 文件被 isFakeMappingDocument 判為 fake（不冒充真 mapping）", () => {
    // 四個 fake 旗標任一成立即當 fake（重用既有工具）。
    expect(isFakeMappingDocument({ mock: true })).toBe(true);
    expect(isFakeMappingDocument({ allow_fake_mapping: true })).toBe(true);
    expect(isFakeMappingDocument({ summary: { fake_mapping_count: 3 } })).toBe(true);
    expect(isFakeMappingDocument({ items: [{ mapping_method: "fake_for_smoke_test" }] })).toBe(true);
    // 真實 mapping（無任何 fake 旗標）不被誤判。
    expect(isFakeMappingDocument({ items: [{ ifc_guid: "g", usd_prim_path: "/World/X", mapping_method: "guid_exact" }] })).toBe(false);
  });

  // ── P2-3 Coordinator/Intake/Runtime：真實 body + 只打 :8004 + GPU 未取得標 demo ──
  it("P2-3 coordinatorClient 只打 coordinator :8004（不直連 :49102 / :49101 / :49100）", () => {
    expect(coordinatorClient.base).toContain(":8004");
    const openUrl = coordinatorClient.openInViewerUrl("review_session_abc");
    expect(openUrl).toContain(":8004");
    expect(openUrl).not.toContain(":49102");
    expect(openUrl).not.toContain(":49101");
    expect(openUrl).not.toContain(":49100");
    // 真實 coordinator 端點存在於 ENDPOINTS 清單（查證自 app.ts），未含幻覺端點。
    const paths = ENDPOINTS.map((e) => e.path);
    expect(paths).toContain("/api/runtime/status");
    expect(paths.some((p) => p.startsWith("/api/governance/runtime"))).toBe(false); // 幻覺端點不得出現
    expect(paths.some((p) => p === "/api/governance/uploads")).toBe(false); // 幻覺端點不得出現
  });

  it("P2-3 Coordinator/Intake/Runtime 真實 body：GPU / 首幀 無遙測標未取得（非 fail，非捏造）", () => {
    const coord = renderToString(<CoordinatorPage />);
    expect(coord).toContain("/api/runtime/status");
    expect(coord).toContain("port listening ≠ has frame"); // 首幀誠實標示
    expect(coord).not.toContain("99.1%");

    const intake = renderToString(<IntakePage />);
    expect(intake).toContain("/api/external/ifc-ready");
    expect(intake).toContain("不承諾精準 GUID"); // mapping fidelity 誠實
    expect(intake).toContain("未取得"); // conversion 秒數 / GPU 無遙測

    const runtime = renderToString(<RuntimePage />);
    expect(runtime).toContain("stream-config");
    expect(runtime).toContain("未取得"); // GPU 無遙測標未取得
    expect(runtime).not.toContain("92.4%");
  });
});
