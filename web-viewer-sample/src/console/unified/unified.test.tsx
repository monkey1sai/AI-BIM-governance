// UnifiedConsole（IA v2）冒煙：approved 鍵 {home,a1..a10,conv,runtime} 由 EdgeConsole 頂層分流
// 掛 UnifiedShell + 新頁（HomePage/WorkspacePage/ConceptPage/PipelinePage/OpsPage）。
// 比照 console.test.tsx 模式：renderToString（jsdom，不需 @testing-library / 網路）+
// 釘 hash（prevHash try/finally 還原）+ pin zh（i18n module singleton 隔離）。
// A1-A4 workspace mounts canonical live modules; unavailable backends remain
// visible as loading/unavailable states rather than prototype data.
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
    // unified-console-runtime-truth：KPI 為真值 cell（SSR 快照＝尚未連線 → — / offline），fixture 固定值不得出現。
    expect(html).toContain('data-uc="kpi-conv-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("最後更新 —");
    for (const lit of ["2026-07-14", "990_model.ifc", "S-240601", "rule-run #88", "OB-201"]) expect(html, lit).not.toContain(lit);
  });

  it("#a1 渲染 live workspace：dockTabs 5 顆 + Kit fail-closed 契約 + A1 真模組", () => {
    const html = renderAtHash("#a1");
    // dock tabs 5 顆（fixtures.dockTabs 的 label）。
    expect(html).toContain("A1 治理檢核");
    expect(html).toContain("A2 版本差異");
    expect(html).toContain("A3 Federation");
    expect(html).toContain("A4 語意查詢");
    expect(html).toContain("Issues / BCF");
    // Shared Kit runtime evidence contract; no fabricated ACK/status.
    expect(html).toContain("DataChannel");
    expect(html).toContain("A1 · 治理與模型檢核");
    expect(html).not.toContain("openedStageResult ✓");
    expect(html).not.toContain("rule-run #88");
  });

  it("#a3 渲染 workspace 且 dock=A3 Federation（非 A1 dock）", () => {
    const html = renderAtHash("#a3");
    // Canonical A3 builder is mounted directly; no prototype member paths.
    expect(html).toContain("A3 Federation");
    expect(html).toContain("Federation Builder");
    expect(html).not.toContain("/Models/ARCH/A1_Tower.usd");
    expect(html).not.toContain("A1_Tower_v12.ifc");
  });

  it("#a5 渲染 concept：A5 標題 + Concept Preview badge（誠實標概念稿）", () => {
    const html = renderAtHash("#a5");
    expect(html).toContain("A5 · IoT / FM 數位分身"); // conceptMeta.a5.titleZh
    expect(html).toContain("Concept Preview / Roadmap"); // 概念稿誠實 badge
  });

  it("#pipeline 渲染 PipelinePage：標題 + 四欄（進件/轉檔/Review Sessions/Callback Outbox）", () => {
    const html = renderAtHash("#pipeline");
    expect(html).toContain("模型資料與轉檔生產線"); // pipe_title
    expect(html).toContain("① 進件"); // st_intake 欄
    expect(html).toContain("② 轉檔"); // st_conv 欄
    expect(html).toContain("③ Review Sessions");
    expect(html).toContain("⑤ Callback Outbox");
    expect(html).toContain("④ 3D Handoff");
    // 真值 cell（SSR＝尚未連線 → —）與 RVT 退役標示；fixture 固定值不得出現。
    expect(html).toContain('data-uc="conv-ready-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("已退役");
    for (const lit of ["demo_lib_2026.ifc", "990_model.ifc", "cj_0116", "S-240601", "OB-201"]) expect(html, lit).not.toContain(lit);
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
    // 真值 cell（SSR＝尚未連線 → —）；固定 GPU／VRAM／structLog 值不得出現。
    expect(html).toContain('data-uc="gpu-val" data-prov="asbuilt" data-state="offline"');
    expect(html).toContain("GPU Fleet"); // e2e/unified-console-routes.spec.ts:34 以此定位
    for (const lit of ["82%", "24%", "14.6/24 GB", "S-240601", "lease_8812", "cj_0117"]) expect(html, lit).not.toContain(lit);
  });

  it("誠實標記契約：A1-A4 workspace 是 asbuilt；concept 仍明確標 fixture", () => {
    for (const hash of ["#a1", "#a2", "#a3", "#a4"]) {
      const html = renderAtHash(hash);
      expect(html, hash).toContain('data-uc="unified-live-workspace" data-prov="asbuilt"');
    }
    expect(renderAtHash("#a5")).toContain('data-prov="fixture"');
    for (const hash of ["#home", "#pipeline", "#runtime"]) {
      const html = renderAtHash(hash);
      const pageRoot = html.slice(html.indexOf('data-uc="page-root"'));
      expect(pageRoot, hash).toContain('data-prov="asbuilt"');
      expect(pageRoot, hash).not.toContain('data-prov="fixture" style="display:grid'); // 舊 KPI grid 的 fixture 標記已移除
    }
  });
});
