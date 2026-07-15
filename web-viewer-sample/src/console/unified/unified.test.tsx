// UnifiedConsole（IA v2）冒煙：approved 鍵 {home,a1..a10,conv,runtime} 由 EdgeConsole 頂層分流
// 掛 UnifiedShell + 新頁（HomePage/WorkspacePage/ConceptPage/PipelinePage/OpsPage）。
// 比照 console.test.tsx 模式：renderToString（jsdom，不需 @testing-library / 網路）+
// 釘 hash（prevHash try/finally 還原）+ pin zh（i18n module singleton 隔離）。
// UnifiedConsole 為 fixture-first（不打 /api），誠實標記契約 = 面板帶 data-prov="fixture"。
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { getLang, setLang } from "../i18n";

/** 釘 hash → renderToString(<EdgeConsole/>) → 還原 hash（EdgeConsole 依 hash 分流雙殼）。 */
function renderAtHash(hash: string): string {
  const prevHash = window.location.hash;
  try {
    window.location.hash = hash;
    return renderToString(<EdgeConsole />);
  } finally {
    window.location.hash = prevHash;
  }
}

describe("UnifiedConsole smoke（approved 鍵 → UnifiedShell + 新頁）", () => {
  let _prevLang: ReturnType<typeof getLang>;
  beforeEach(() => { _prevLang = getLang(); setLang("zh"); });
  afterEach(() => { setLang(_prevLang); });

  it("#home 渲染 UnifiedShell：側欄兩群組 + A1–A10 十項 + footer 簽名 + Mission Control + 4 KPI", () => {
    const html = renderAtHash("#home");
    // 側欄兩群組標題（fixtures.getL(zh).g_work / g_apps）。
    expect(html).toContain("工作台");
    expect(html).toContain("AI 應用模組");
    // AI 應用模組 A1..A10 十項（側欄 code span；home launcher 亦重複出現，contain 足矣）。
    for (let i = 1; i <= 10; i += 1) expect(html).toContain(`>A${i}<`);
    // footer 簽名（UnifiedShell 側欄底部）。
    expect(html).toContain(":8004/ui · UnifiedConsole");
    // HomePage 標題（fixtures.getL(zh).home_title）+ 4 KPI 卡 label。
    expect(html).toContain("總覽 · Mission Control");
    expect(html).toContain("轉檔中"); // kpi_conv
    expect(html).toContain("活躍 Sessions"); // kpi_sess
    expect(html).toContain("未結 Issue"); // kpi_issue
    expect(html).toContain("Outbox 待送"); // kpi_outbox
  });

  it("#a1 渲染 workspace：dockTabs 5 顆 + DATACHANNEL 字條 + A1 dock 規則集 3 條", () => {
    const html = renderAtHash("#a1");
    // dock tabs 5 顆（fixtures.dockTabs 的 label）。
    expect(html).toContain("A1 治理檢核");
    expect(html).toContain("A2 Diff");
    expect(html).toContain("A3 Federation");
    expect(html).toContain("A4 語意查詢");
    expect(html).toContain("Issues / BCF");
    // DATACHANNEL 字條（底部 fixture 狀態列）。
    expect(html).toContain("DataChannel");
    expect(html).toContain("openedStageResult");
    // A1 dock 規則集 3 條（fixtures.ruleDefs zh label）。
    expect(html).toContain("防火門 FireRating ≥ 60min");
    expect(html).toContain("淨高 ≥ 2100mm");
    expect(html).toContain("管線間距 ≥ 50mm");
  });

  it("#a3 渲染 workspace 且 dock=A3 Federation（非 A1 dock）", () => {
    const html = renderAtHash("#a3");
    // A3Dock 專屬內容：SubLayer 排序 + fedMembers 的 member usd path（只在 A3Dock 出現）。
    expect(html).toContain("A3 Federation");
    expect(html).toContain("SubLayer");
    expect(html).toContain("/Models/ARCH/A1_Tower.usd");
    // dock 真的切到 A3：A1Dock 專屬的選定檔案盒（A1_Tower_v12.ifc）不得出現。
    expect(html).not.toContain("A1_Tower_v12.ifc");
  });

  it("#a5 渲染 concept：A5 標題 + Concept Preview badge（誠實標概念稿）", () => {
    const html = renderAtHash("#a5");
    expect(html).toContain("A5 · IoT / FM 數位分身"); // conceptMeta.a5.titleZh
    expect(html).toContain("Concept Preview / Roadmap"); // 概念稿誠實 badge
  });

  it("#conv 渲染 PipelinePage：標題 + 四欄（進件/轉檔/Review Sessions/Callback Outbox）", () => {
    const html = renderAtHash("#conv");
    expect(html).toContain("模型資料與轉檔生產線"); // pipe_title
    expect(html).toContain("① 進件"); // st_intake 欄
    expect(html).toContain("② 轉檔"); // st_conv 欄
    expect(html).toContain("③ Review Sessions");
    expect(html).toContain("⑤ Callback Outbox");
  });

  it("#runtime 渲染 OpsPage：標題 + 服務健康 6 列", () => {
    const html = renderAtHash("#runtime");
    expect(html).toContain("Runtime / Kit · GPU 營運"); // ops_title
    expect(html).toContain("服務健康"); // svc_health
    // fixtures.services 6 列逐一存在。
    for (const name of [
      "bim-review-coordinator",
      "governance-service",
      "conversion authority",
      "Kit signaling / WebRTC",
      "kit-manager-api",
      "MinIO watch",
    ]) expect(html, name).toContain(name);
  });

  it("誠實標記契約：每個 approved 路由的 fixture 面板帶 data-prov=\"fixture\"", () => {
    for (const hash of ["#home", "#a1", "#a3", "#a5", "#conv", "#runtime"]) {
      expect(renderAtHash(hash), hash).toContain('data-prov="fixture"');
    }
  });
});
