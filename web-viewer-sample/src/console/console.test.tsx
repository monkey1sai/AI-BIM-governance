// Edge Console 誠實性 smoke：確認頁面可渲染、provenance 標記存在、A1 顯示「實測」證據、
// A2/A3 帶 provenance 與真實邊界、無願景假數字。用 renderToString（不需 @testing-library / 網路）。
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  A1GovernanceWorkbenchPage,
  AppsPage,
  AppVisionPage,
  CoordinatorPage,
  FailureRuleRow,
  FederationPage,
  IssuesRuleCenterPage,
  KitGpuFleetPage,
  OverviewPage,
  ReviewRoomPage,
  SemanticViewerPage,
  SessionManagementPage,
  SpecPage,
  ViewerPresentationPage,
  VersionDiffPage,
} from "./pages";
// [Task 9 MD 三頁合一] 三舊頁（ConversionSchedulingPage / IntakePage / MinioDataPage）已移除，改由 ModelDataPage 承接。
import { ModelDataPage } from "./modelData/ModelDataPage";
import { StreamConfigReader } from "./StreamConfigReader";
import EdgeConsole from "./EdgeConsole";
import { ProvLegend } from "./components";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { governanceClient, type FilesTreeResponse, type IssueRow, type RuleRunStatus, type RuleResultRow } from "./governanceClient";
import { CoordinatorGovernanceTabs, LifecycleTab } from "./coordinator/RuntimeGovernanceTabs";
import { A1A10, A1A10_DETAIL, DEPENDENCIES, ENDPOINTS, PAGES } from "./data";
import { isFakeMappingDocument } from "../types/mapping";
import { getLang, setLang } from "./i18n";

describe("edge console honesty smoke", () => {
  // i18n._lang 是 module singleton（i18n.ts）。本 describe 多個 SSR 測試（含下方 nav tooltip
  // i18n 測試）斷言預設 zh 字串；若任何測試（現在或未來新增）在此區塊內把語言切到 en 而不還原，
  // 殘留狀態會 silently 污染後續測試（positive 斷言假性轉紅、not-contains 仍綠）。pin zh before each
  // + restore after each → 永久 intra-file 隔離（其餘 describe 的 beforeEach/afterEach 不涵蓋本區塊）。
  let _prevLang: ReturnType<typeof getLang>;
  beforeEach(() => { _prevLang = getLang(); setLang("zh"); });
  afterEach(() => { setLang(_prevLang); });

  it("SpecPage lead 誠實標 MinIO 為 coordinator 外連 S3、非獨立 repo", () => {
    const html = renderToString(<SpecPage />);
    // 修正後 lead 必須含新措辭（MinIO = coordinator 外連 S3 來源）。
    expect(html).toContain("MinIO 為 coordinator 外連 S3");
    // 誠實守門（not-contains）：不得再把 MinIO 與有 sub-repo 的服務並列、隱含其有 repo boundary。
    expect(html).not.toContain("MinIO 權威仍在各自 repo 邊界");
    // Panel 本體 4 個 repo 不動（回歸：kit-manager-api 仍在）。
    expect(html).toContain("kit-manager-api");
  });

  it("nav tooltip 走 i18n：zh 下 overview 的 title 為「總覽」而非 data.ts fallback「Overview」", () => {
    // 預設 _lang=zh（i18n.ts；jsdom 無 localStorage → fallback zh），navText(overview) → NAV_LABEL.overview.biz = 總覽。
    const html = renderToString(<EdgeConsole />);
    // 修正後 nav 按鈕 title 取 navText（i18n）而非原始 data.ts label。
    expect(html).toContain('title="總覽"');
    // 誠實守門（not-contains）：overview 不應再以英文 fallback 當 tooltip。
    expect(html).not.toContain('title="Overview"');
  });

  it("Applications 啟動器列出 A1–A10 並帶 provenance", () => {
    const html = renderToString(<AppsPage onOpen={() => {}} />);
    expect(html).toContain("A1");
    expect(html).toContain("A10");
    expect(html).toContain("Governance &amp; Rule Checker");
    expect(html).toContain("ec-prov");
  });

  it("[A6 消歧義] roadmap tier 不裸印 Phase 數字（與 ProvTag 願景 Phase 矛盾），改標規劃序", () => {
    const apps = renderToString(<AppsPage onOpen={() => {}} />);
    // A6：phase=2（規劃優先序）＋ prov=p4（願景 Phase 4）——A6 卡裸印「Phase 2」會與 ProvTag 並列矛盾。
    // 斷言收斂在 A6 卡片區段（A2/A3 focus 卡的 Phase 2 為合法 asbuilt 標示）。
    const a6Card = apps.slice(apps.indexOf(">A6<"), apps.indexOf(">A7<"));
    expect(a6Card).toContain("規劃序 P2");
    expect(a6Card).not.toContain("Phase 2");
    // focus tier（A1 phase=1，prov=asbuilt）維持原樣 Phase 標示。
    expect(apps).toContain("Phase 1");
    const vision = renderToString(<AppVisionPage slug="4d-5d" onOpen={() => {}} />);
    expect(vision).not.toContain("Phase 2 ·");
    expect(vision).toContain("規劃序 P2");
  });

  it("A1 Rule Center 顯示真實 IFC 實測 artifact（非捏造）", () => {
    const html = renderToString(<IssuesRuleCenterPage />);
    expect(html).toContain("規則評估次數");
    expect(html).toContain("7126"); // 真實規則評估次數
    expect(html).toContain("唯一構件");
    expect(html).toContain("6715"); // 去重後 ifc_guid 數
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
    expect(coord).toContain("A Classic Dashboard");
    expect(coord).toContain("B ATC Tower");
    expect(coord).toContain("C Lifecycle Flow");
    expect(coord).toContain("D Terminal / Debug");
    expect(coord).toContain("port listening ≠ has frame"); // 首幀誠實標示
    expect(coord).toContain("Open primary URL 不等於 occupied");
    expect(coord).toContain("occupied 必須等 browser first-frame evidence");
    expect(coord).toContain("等待第一幀畫面");
    expect(coord).toContain("Classic Dashboard 是 operator 第一眼總覽");
    expect(coord).toContain("ATC Tower 是 endpoint / viewer lease 的航管塔");
    expect(coord).toContain("Lifecycle Flow 用來判斷為什麼還不能算 ready");
    expect(coord).toContain("Terminal / Debug 是工程證據頁");
    expect(coord).toContain("Kit-side evidence + Browser-side evidence");
    expect(coord).toContain("Kit Runtime");
    expect(coord).toContain("Endpoint Pool");
    expect(coord).toContain("Active Sessions");
    expect(coord).toContain("Viewer Evidence");
    expect(coord).toContain("Stage Truth");
    expect(coord).toContain("Recent Risk");
    expect(coord).not.toContain("99.1%");

    // [Task 9 MD 三頁合一] IntakePage 已移除；IN 誠實字樣（不承諾精準 GUID／conversion 秒數·GPU 未取得）已遷移至
    // ObjectDetailPane.test.tsx（coverage 品質三行），/api/external/ifc-ready 由 GlobalConversionPane.test.tsx 覆蓋。
    const runtime = renderToString(<CoordinatorPage />);
    expect(runtime).toContain('data-testid="rt-monitor-summary"');
    expect(runtime).toContain("GPU / VRAM");
    expect(runtime).toContain("未取得"); // GPU 無遙測標未取得
    expect(runtime).not.toContain("92.4%");
  });

  it("C/Hybrid Coordinator Console Phase 1 顯示四視角 contract，不在總覽放 raw JSON", () => {
    const html = renderToString(<CoordinatorPage />);

    expect(html).toContain("Classic Dashboard 是 operator 第一眼總覽");
    expect(html).toContain("ATC Tower 是 endpoint / viewer lease 的航管塔");
    expect(html).toContain("Lifecycle Flow 用來判斷為什麼還不能算 ready");
    expect(html).toContain("Terminal / Debug 是工程證據頁");
    expect(html).toContain("Kit-side evidence + Browser-side evidence");
    expect(html).toContain("Kit Runtime");
    expect(html).toContain("Endpoint Pool");
    expect(html).toContain("Active Sessions");
    expect(html).toContain("Viewer Evidence");
    expect(html).toContain("Stage Truth");
    expect(html).toContain("Recent Risk");
    expect(html).not.toContain('"session_id"');
    expect(html).not.toContain("stack trace");
  });

  it("Classic Dashboard stageTruth 總覽不展開 expected_stage_url 技術細節", () => {
    const rt: RuntimeStatus = {
      service: { status: "ok", name: "bim-review-coordinator", uptime_seconds: 42, generated_at: "2026-06-08T00:00:00Z" },
      configured_endpoints: {
        coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
        viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/ui/open" },
        conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "local_fixed" },
        kit: [
          {
            id: "kit-primary",
            signalingServer: "127.0.0.1",
            signalingPort: 49100,
            mediaServer: "127.0.0.1",
            mediaPort: 49101,
          },
        ],
      },
      sessions: {
        count: 1,
        active_count: 1,
        participant_count: 1,
        items: [
          {
            session_id: "review_session_secret",
            status: "active",
            project_id: "project-1",
            model_version_id: "model-1",
            participant_count: 1,
            expected_stage_url: "http://example.test/model.usdc",
            conversion_status: "succeeded",
            kit_instance_ids: ["kit-primary"],
            created_at: "2026-06-08T00:00:00Z",
            updated_at: "2026-06-08T00:00:00Z",
          },
        ],
      },
      kit_instance_bindings: [],
      ifc_ready_jobs: { count: 0, recent: [] },
      observations: {
        classification: "runtime_status",
        note: "fake runtime for SSR privacy regression",
        web_plane: { coordinator_port: 8004, viewer_port: 5173 },
        host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [49100], kit_media_ports: [49101] },
      },
    };

    const html = renderToString(<CoordinatorGovernanceTabs rt={rt} busy={false} err={null} onRefresh={() => {}} />);
    const stageTruthOverview = html.match(/Stage Truth[\s\S]{0,160}/)?.[0] ?? "";

    expect(html).toContain("stage loaded 未觀測");
    expect(html).toContain("展開技術細節");
    expect(html).toContain("stage truth detail");
    expect(html).toContain("expected_stage_url=http://example.test/model.usdc");
    expect(stageTruthOverview).not.toContain("example.test");
    expect(html).not.toContain('"session_id"');
  });

  it("LifecycleTab 顯示 NVIDIA 官方 GPU/串流硬約束（1 GPU/stream・無 migrate・port≠frame）", () => {
    const html = renderToString(<LifecycleTab />);
    expect(html).toContain("1 GPU");
    expect(html).toContain("terminate");
    expect(html).toContain("port listening");
    expect(html).toContain("NVIDIA");
  });

  it("ProvLegend 可信度圖例顯示 4 階分類學（已實作/實測/示範/後端未建）+ 白話意思", () => {
    const html = renderToString(<ProvLegend />);
    expect(html).toContain("可信度圖例");
    expect(html).toContain("已實作");
    expect(html).toContain("實測 artifact");
    expect(html).toContain("示範資料");
    expect(html).toContain("後端未建");
    expect(html).toContain("真的能用");
  });

  // ── P3-1 A5–A10 vision 詳頁（A4 已 live #a4，不在 A1A10_DETAIL）──
  it("P3-1 每個 A5–A10 vision 詳頁含「後端未建」且 scenario 標範例情境（非真實 run）", () => {
    expect(Object.keys(A1A10_DETAIL)).not.toContain("ai-search");
    for (const slug of Object.keys(A1A10_DETAIL)) {
      const html = renderToString(<AppVisionPage slug={slug} onOpen={() => {}} />);
      expect(html, slug).toContain("後端未建");
      expect(html, slug).toContain("範例情境");
      expect(html, slug).toContain("非真實 run");
      expect(html, slug).toContain("非已實作 route");
      expect(html, slug).not.toContain("99.1%");
      expect(html, slug).not.toContain("92.4%");
      expect(html, slug).not.toContain("實測 312");
      expect(html, slug).not.toContain("實測 17,000");
    }
  });

  it("P3-1 A5–A10 roadmap 卡片皆可點（route 指向 vision 詳頁）且標 p3/p4；A4 已進 focus live route", () => {
    const roadmap = A1A10.filter((a) => a.tier === "roadmap");
    expect(roadmap.length).toBe(6);
    expect(roadmap.every((a) => a.route?.startsWith("app/"))).toBe(true);
    // A5 = p3（RM phase 3），其餘 roadmap = p4。A4 為 focus / asbuilt live page。
    expect(A1A10.find((a) => a.code === "A5")?.prov).toBe("p3");
    expect(roadmap.filter((a) => a.code !== "A5").every((a) => a.prov === "p4")).toBe(true);
    expect(A1A10.find((a) => a.code === "A4")).toMatchObject({
      tier: "focus",
      prov: "asbuilt",
      route: "a4",
    });
  });

  // ── P3-2 / P3-3 殼層：Agent suggested prompts（disabled 輸入）+ FlowBar + Tweaks ──
  it("P3-2/P3-3 EdgeConsole 殼層含 Agent prompts（disabled 輸入）+ FlowBar + Tweaks", () => {
    const html = renderToString(<EdgeConsole />);
    // P3-2：suggested prompts + 寫入限制 + disabled 輸入框（非可用的假輸入）。
    expect(html).toContain("SUGGESTED");
    expect(html).toContain("AI 僅能改 review / session layer");
    expect(html).toMatch(/<input[^>]*disabled/);
    // P3-3：FlowBar 5 步（預設語言=中 → 中文 biz 步驟標籤）+ 頂列 LangToggle（中/EN）+ Tweaks（scenario clean/warn）。
    expect(html).toContain("①"); // FlowBar step 1 標號
    expect(html).toContain("接收建模來源"); // 預設中文（biz）的步驟標籤（Intake）
    expect(html).toContain("紀錄回寫雲端"); // FlowBar 末步（Record 中文）
    expect(html).toContain("ec-langtoggle"); // 語言切換移至頂列（中/EN），取代舊「用語」操作員/技術鈕
    expect(html).toContain("clean"); // Tweaks scenario 按鈕
    expect(html).toContain("warn");
  });

  it("[R4] NAV 分組對齊 A.1.1 群組欄（路由表為準）", () => {
    const g = (k: string) => PAGES.find((p) => p.key === k)?.group;
    // A.1.1 rows 9–15：viewer/gpu/a6–a10 群組＝核心治理。
    ["viewer", "gpu", "a6", "a7", "a8", "a9", "a10"].forEach((k) => expect(g(k)).toBe("core"));
    // A.1.1 rows 17–19：sessions/instances/minio 群組＝OMNIVERSE RUNTIME。
    ["sessions", "instances", "minio"].forEach((k) => expect(g(k)).toBe("omniverse"));
    // A.1.1 row 20：#runtime 群組＝落地端控制台 / SYSTEM（取前者為 nav 歸屬）。
    expect(g("runtime")).toBe("coordinator");
  });

  it("完整產品操作台 shell 顯示 prototype 的四組資訊架構", () => {
    const html = renderToString(<EdgeConsole />);
    expect(html).toContain("工作台");
    expect(html).toContain("核心治理");
    expect(html).toContain("OMNIVERSE RUNTIME");
    expect(html).toContain("落地端控制台");
    // MD 合一（Task 7）：conv「IFC→USD 轉檔排程」＋ minio「MinIO 資料」兩獨立 nav 項合併為單一 MD 項。
    expect(html).toContain("模型資料與轉檔"); // MD nav 標籤（navText(minio) → NAV_LABEL.minio.biz）
    expect(html).toContain("Kit / GPU 機隊");
    expect(html).toContain('class="ec-key">MD<'); // no="MD"（原 minio no="M"）
    // conv（no=CV）/ intake（no=IN）獨立 nav 項已從 PAGES 移除，nav 不再渲染其鍵；HomePage 內文仍
    // 可能提及「IFC→USD 轉檔排程」字樣，故以 nav 鍵 no 精確守門（比照 L392 CO 守門），不用裸字串。
    expect(html).not.toContain('class="ec-key">CV<');
    expect(html).not.toContain('class="ec-key">IN<');
    expect(html).toContain("Chat USD Agent");
  });

  // ── co-console-runtime-merge §5.1 守門一（負向，打資料模型）：CO 獨立導覽項已從 PAGES 移除 ──
  // PAGES 是左欄渲染的唯一資料源（EdgeConsole.tsx:209 `PAGES.filter(...).map(...)`）；直接斷言
  // 資料模型零渲染歧義、零字串撞 page h1（不可用 `not.toContain("Coordinator Console")`——該字串
  // 同時在 CoordinatorPage h1）。此守門讓 Task 0 的「移除 CO nav」有機器可執行的迴歸防護：未來
  // 任何 PR 若把 coordinator 項加回 PAGES，本斷言會立即報錯。
  it("co-console-merge：CO 獨立導覽項已從 PAGES 移除（負向守門 · 資料模型 + 渲染 nav）", () => {
    // 資料模型守門：PAGES 不得再含 coordinator 項（落地端控制台群組只剩 conv/sessions/instances/minio）。
    expect(PAGES.some((p) => p.key === "coordinator")).toBe(false);
    // 渲染 nav 補強：預設 #home 渲染的左欄按鈕（`<span class="ec-key">{p.no}</span>` L211）不得出現
    // CO 編號（被移除 page 的 no="CO"）。NAV_GROUPS 的 coordinator 群組仍在故群組標題照常存活。
    const navHtml = renderToString(<EdgeConsole />);
    expect(navHtml).not.toContain('class="ec-key">CO<');
  });

  it("co-console-merge：#runtime route 承接 Coordinator runtime console，且 nav label 改為 Runtime 觀測值班台", () => {
    const prevHash = window.location.hash;
    try {
      window.location.hash = "#runtime";
      const html = renderToString(<EdgeConsole />);

      expect(html).toContain("Runtime 觀測值班台");
      expect(html).not.toContain("串流執行狀態");
      expect(html).toContain("Coordinator Console · C / Hybrid Runtime Orchestrator");
      expect(html).toContain("/api/runtime/status");
      expect(html).toContain("A Classic Dashboard");
      expect(html).toContain("D Terminal / Debug");
      expect(html).toContain("Classic Dashboard 是 operator 第一眼總覽");
      expect(html).toContain("Open primary URL 不等於 occupied");
      expect(html).not.toContain("Runtime Dashboard · 串流執行狀態");
    } finally {
      window.location.hash = prevHash;
    }
  });

  it("prototype 核心頁面可 render：A1 stepper、3D viewer、session、Kit/GPU（轉檔/MinIO 頁併入 ModelDataPage.test）", () => {
    const a1 = renderToString(<A1GovernanceWorkbenchPage />);
    expect(a1).toContain("選 IFC");
    expect(a1).toContain("選 IDS");
    expect(a1).toContain("執行檢核");
    expect(a1).toContain("A1 3D 高亮 Session");
    expect(a1).toContain("開 Issue");
    // Excel 匯出鈕（fmt=excel .xlsx）。
    expect(a1).toContain("匯出 Excel");
    // A1-W1：#a1 canonical route 自有 BCF 2.1 匯出鈕（data-testid=a1-step-bcf）；
    // 不再導引去 #issues（移除「BCF 匯出請至 Issues 頁」字樣）。
    expect(a1).toContain('data-testid="a1-step-bcf"');
    expect(a1).toContain("匯出 BCF 2.1");
    // BCF 鈕初始態（step=idle）需先建 Issue，故 disabled + 誠實 caption。
    expect(a1).toContain("需先建 Issue");
    // 舊導引字樣已移除（#a1 為 canonical，不再導引去 Issues 頁）。
    expect(a1).not.toContain("BCF 匯出請至 Issues 頁");
    expect(a1).toContain("rule_run_id");
    expect(a1).not.toContain('data-testid="a1-real-ifc-slice"');
    expect(a1).not.toContain('data-testid="real-ifc-demo-control"');
    expect(a1).toContain('data-testid="a1-source-picker"');
    expect(a1).toContain('data-testid="a1-localfs-select"'); // default executable source is local_fs
    expect(a1).toContain('data-testid="a1-source-minio"'); // MinIO source is available but not sent as ifc_source_path
    expect(a1).toContain('data-testid="a1-review-session-actions"');
    expect(a1).toContain('data-testid="a1-create-review-session"');
    expect(a1).toContain('data-testid="a1-bcf-review-panel"');
    expect(a1).not.toContain('data-testid="a1-step-path"'); // 手打路徑文字框已移除
    expect(a1).toContain('data-testid="a1-step-run"');
    expect(a1).toContain('data-testid="a1-step-issues"');
    expect(a1).toContain('data-testid="a1-step-export"');
    // A1 v2：rule-run 回到 direct CPU path；SSR 首幀尚未選 IFC，因此只顯示「先選定 IFC」的 disabled caption。
    // 真正的端點 path 與 createRuleRun 呼叫驗收在 A1ViewerEmbed.test.tsx「picked IFC enables run」測試。
    expect(a1).toContain("先選定 IFC 模型");

    const viewer = renderToString(<ViewerPresentationPage />);
    expect(viewer).toContain("3D Viewer 呈現");
    expect(viewer).toContain("openStage");
    expect(viewer).toContain("highlightPrimsRequest");
    expect(viewer).toContain("DataChannel");

    // [Task 9 MD 三頁合一] ConversionSchedulingPage 已移除；轉檔頁 smoke 由 ModelDataPage.test.tsx（頁殼）＋
    // GlobalConversionPane.test.tsx（conversion authority／/api/external/ifc-ready／coverage 抽屜）覆蓋。
    const sessions = renderToString(<SessionManagementPage />);
    expect(sessions).toContain("Session 管理");
    expect(sessions).toContain("first frame");
    expect(sessions).toContain("Reclaim stale spectator");

    const fleet = renderToString(<KitGpuFleetPage />);
    expect(fleet).toContain("Kit / GPU 機隊");
    expect(fleet).toContain("1 GPU = 1 Kit stream");
    expect(fleet).toContain("drain");

    // [Task 9 MD 三頁合一] MinioDataPage 已移除；MinIO 資料頁 smoke 由 ModelDataPage.test.tsx（頁殼＋Demo bucket
    // layout）＋ MinioTreePane.test.tsx（左欄樹）覆蓋；下方另有 ModelDataPage SSR proxy smoke。
  });

  // ── P4 Review Room（G）：A1 handoff 的專用 3D session attach 畫面 ──
  it("P4 Review Room 提供手動 attach fallback，且誠實標 A1 已可 inline attach viewer lease", () => {
    const html = renderToString(<ReviewRoomPage />);
    expect(html).toContain("Review Room 3D session attach");
    expect(html).toContain("手動啟動 / attach Kit session");
    // 真實 viewer 入口仍保留 coordinator /ui/open 旁路，但不代表自動 attach。
    expect(html).toContain("/ui/open");
    // 誠實標示：A1 頁面可 inline attach；Review Room 只作 fallback / 跨頁追蹤。
    expect(html).toContain("A1 頁面本身也能直接啟動 Kit / WebRTC viewer lease");
    expect(html).toContain("Review Room 只保留跨頁追蹤與手動操作");
    expect(html).toContain("A1 不自動啟動");
    expect(html).toContain("not_started");
    // 工具列誠實 provenance：section / snapshot 待建（p15），不假裝已實作。
    expect(html).toContain("後端待建 · P1.5");
    expect(html).not.toContain("99.1%");
  });

  // ── PR #179 finding 3 + 6：viewer 連結 a11y / lwv 驗證（初始空 = invalid）──
  it("P4 Review Room invalid（初始空）session：連結不渲染 href=#、不可聚焦（a11y）", () => {
    const html = renderToString(<ReviewRoomPage />);
    // finding 3：invalid 時連結不得留 href="#"（鍵盤 / 螢幕閱讀器啟用會跳 #）。
    expect(html).not.toContain('href="#"');
    // invalid 連結須 aria-disabled 且移出 tab 序（tabindex=-1），不是只靠 pointerEvents 的假禁用。
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
    // 初始空字串不自動 claim viewer lease，也不渲染 viewer host。
    const typed = renderToString(<ReviewRoomPage />);
    expect(typed).toContain("not_started");
    expect(typed).not.toContain("review-room-viewer-host");
  });

  // ── PR #179 finding 2：COORD /health 探活結果（含 down）為真實觀測 → 標 asbuilt，非 demo ──
  it("P2-1 Overview COORD /health Field 標 asbuilt（真實探活），不誤標示範資料", () => {
    const html = renderToString(<OverviewPage />);
    // COORD 健康欄位緊鄰 provenance；初始（探活中）標「已實作」(asbuilt)，不得是「示範資料」(demo)。
    const coordField = html.match(/COORD Coordinator :8004[\s\S]*?ec-prov[^>]*>[^<]*<\/span>/);
    expect(coordField).not.toBeNull();
    expect(coordField?.[0]).toContain("已實作"); // PROV_LABEL.asbuilt（真實探活結果）
    expect(coordField?.[0]).not.toContain("示範資料"); // 不誤標 demo
  });

  // ── PR #179 finding 1/4/5：Semantic Viewer 候選來自真實 ifc-ready 端點，caption / label 一致 ──
  it("P2-2 Semantic Viewer『列出真實 job』走 /api/external/ifc-ready（caption 與實際呼叫一致）", () => {
    const html = renderToString(<SemanticViewerPage />);
    // finding 4：按鈕 caption 與實際呼叫的端點一致（ifc-ready，非 runtime/status）。
    // PR #179 round-2 finding（codex :685）：候選改篩 expected_mapping_url 並可點選自動填入 mapping URL。
    expect(html).toContain("GET /api/external/ifc-ready（找帶 mapping 產出的 job）");
    // finding 5：label 與資料實體（ifc-ready job）一致，不再寫「真實 session 候選」。
    expect(html).toContain("列出真實 job");
    expect(html).not.toContain("列出真實 session");
  });

  // ── MD 三頁合一（Task 9）：接真 MinIO list proxy（GET /api/minio/objects）SSR smoke，改由 ModelDataPage 承接 ──
  it("ModelData（MinIO proxy）：loading 態 + /api/minio/objects 文案 + Demo bucket layout（usdc 仍 p1）", () => {
    const html = renderToString(<ModelDataPage />);
    // 載入態可見（renderToString 首幀無 fetch 結果 → loading=true）。
    expect(html).toContain("載入");
    // 誠實標記：真 S3 proxy 端點文案出現於 Panel sub / loading 文字。
    expect(html).toContain("/api/minio/objects");
    // Demo Panel 仍顯示 bucket 規約示意（bim-control 規約示意，非假資料）。
    expect(html).toContain("bim-control");
    // bucket layout 規約示意仍標 demo（規約示意非實況）。
    expect(html).toContain("示範資料"); // PROV_LABEL.demo
    // model.usdc 轉檔產物規約示意仍在 Demo Panel，p1 標記仍存在。
    expect(html).toContain("model.usdc");
    expect(html).toContain("後端待建 · P1"); // PROV_LABEL.p1（待產生 pending）
    // 唯讀 intake 來源視圖誠實字樣。
    expect(html).toContain("唯讀 intake 來源視圖");
    // 無願景假數字。
    expect(html).not.toContain("99.1%");
    // 舊 local file-server 文案已移除（Task 7 取代）。
    expect(html).not.toContain("local file-server");
  });

  it("A1 Rule Center 新增『從檔案庫選擇』三層選擇器（手動輸入保留）", () => {
    const html = renderToString(<IssuesRuleCenterPage />);
    // 檔案庫選擇器標題/說明可見。
    expect(html).toContain("從檔案庫選擇");
    // 三層選擇 select 存在（project / model / version）。
    expect(html).toContain("data-testid=\"a1-fs-project\"");
    expect(html).toContain("data-testid=\"a1-fs-model\"");
    expect(html).toContain("data-testid=\"a1-fs-version\"");
    // 既有手動輸入框與預設 fixture 仍在（向後相容 a1-real-ifc-slice E2E）。
    expect(html).toContain("fixture-bytes.ifc");
    expect(html).toContain("執行規則檢核");
    // live-run 記分板用獨立 data-testid 包裹（讓 E2E 能只斷言「真 run 後出現的區塊」，
    // 不被恆顯的 artifact-baseline / A1 workbench 記分板誤判通過）。renderToString 首幀
    // run=null → 此區塊不渲染，故 smoke 斷言「不存在」即可確認 gating 正確。
    expect(html).not.toContain("data-testid=\"a1-rulerun-scoreboard\"");
  });
});

// ── co-console-runtime-merge §5.1 守門四（D2-A′ 核心合約）：stream-config 不孤兒 ──
// spec §3.4 D2-A′ 要求 StreamConfigReader 由 CoordinatorGovernanceTabs
// 的 debug（Terminal / Debug）分頁直接 render。#runtime 已收斂到 CoordinatorPage，
// 舊 RuntimePage 入口已刪；唯有 debug 分頁掛 StreamConfigReader 才不孤兒。
// renderToString 預設只渲 classic 分頁（useState("classic")），到不了 debug；故用 createRoot + 點
// 「D Terminal / Debug」分頁鈕（本檔既有互動 pattern），實測 CoordinatorGovernanceTabs→debug→
// StreamConfigReader 這條真路徑含 stream-config 入口（非直測未 export 的 DebugTab，不擴大公開面）。
describe("co-console-merge §5.1#4：CoordinatorGovernanceTabs debug 分頁含 stream-config（不孤兒）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("點開 debug 分頁 → 渲染 StreamConfigReader（stream-config 入口，D2-A′ 不孤兒）", async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(<CoordinatorGovernanceTabs rt={null} busy={false} err={null} onRefresh={() => {}} />);
    });

    // 預設 classic 分頁尚未含 stream-config 入口（StreamConfigReader 只在 debug 分頁）。
    expect(container.innerHTML).not.toContain("stream-config");

    // 點「D Terminal / Debug」分頁鈕切到 debug。
    const debugTabBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
      (b) => b.textContent === "D Terminal / Debug",
    );
    expect(debugTabBtn, "應有 D Terminal / Debug 分頁鈕").not.toBeUndefined();
    await act(async () => { debugTabBtn!.click(); });

    // debug 分頁含 StreamConfigReader 提供的 stream-config 入口（GET …/stream-config）。
    const html = container.innerHTML;
    expect(html).toContain("stream-config");
    expect(html).toContain("/api/review-sessions/:id/stream-config");
    expect(html).toContain("review_session_id"); // StreamConfigReader 的輸入框 placeholder

    await act(async () => { root.unmount(); });
  });
});

// ── co-console-runtime-merge review fix：stream-config session id guard ──
// StreamConfigReader 對齊 ReviewRoomPage / coordinator /ui/open 的 session-id 格式：
// 只允許 lwv_ / review_session_ 前綴 + 英數底線。invalid input 應停用按鈕且不發 request。
describe("co-console-merge review fix：StreamConfigReader session-id 格式守門", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const setInputNative = (el: HTMLInputElement, value: string) => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    nativeValueSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("invalid id 停用讀取、不呼叫 streamConfig；valid review_session id 啟用並呼叫一次", async () => {
    const streamSpy = vi.spyOn(coordinatorClient, "streamConfig").mockResolvedValue({
      session_id: "review_session_x",
      status: "ready",
    });
    const root = createRoot(container);
    await act(async () => {
      root.render(<StreamConfigReader />);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="review_session_id"]')!;
    const readButton = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("讀取 stream-config") || button.textContent?.includes("Read stream-config"),
    )!;

    await act(async () => { setInputNative(input, "abc"); });
    expect(readButton().disabled).toBe(true);
    expect(container.innerHTML).toContain("session id 不符格式");
    await act(async () => { readButton().click(); });
    expect(streamSpy).not.toHaveBeenCalled();

    await act(async () => { setInputNative(input, "review_session_x"); });
    expect(readButton().disabled).toBe(false);
    await act(async () => {
      readButton().click();
      await Promise.resolve();
    });
    expect(streamSpy).toHaveBeenCalledTimes(1);
    expect(streamSpy).toHaveBeenCalledWith("review_session_x");

    await act(async () => { root.unmount(); });
  });
});

// ── minio-fileserver-source spec §7.3：client-render（真樹 + 互動）驗收 ──
// renderToString 只能驗 SSR 首幀（loading/空殼，run=null、tree=null），永遠到不了
// populated/error 態與 onChange data-binding。此處用 createRoot + act + vi.spyOn 補上
// 三態（loading 已由 SSR 涵蓋）與「A1 選定版本後填入 ifcPath」這條 spec §7.3 明文行為。
describe("MinioData + A1 檔案庫選擇器 client-render（spec §7.3：真樹 + 互動）", () => {
  // 含 270/機電/ver 竣工.ifc 的真實樹形狀（比照 governanceClient.test.ts fixture 與 spec 範例）。
  const VER_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工.ifc";
  // 第二版本：A2 base/target 各一組選擇器需可選到相異版本（base=v1、target=v2），
  // 才能驗證 base/target 真的獨立接線、各自帶出相異 model_version_id。
  const VER2_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工 v2.ifc";
  const tree: FilesTreeResponse = {
    root: "C:/Repos/active/iot/AI-BIM-governance/storage",
    source_kind: "local_fs",
    projects: [
      {
        project_id: "270",
        models: [
          {
            model_id: "機電",
            versions: [
              { name: "ver 竣工.ifc", path: VER_PATH, size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" },
              { name: "ver 竣工 v2.ifc", path: VER2_PATH, size_bytes: 22777, mtime: "2026-06-10T18:18:00+08:00" },
            ],
          },
        ],
      },
    ],
  };

  let container: HTMLDivElement;
  // React 18 act 環境旗標（消除「testing environment is not configured to support act」警告）。
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  // [Task 9 MD 三頁合一] MinioData 客端渲染三態（populated / error / empty）已遷移至
  // MinioTreePane.test.tsx（左欄檔案樹的權威測試）：populated=(a) 排序/badge + (b)(c) 選檔；
  // error/empty/retry=(d)(e)(f)（含 roleLabel「來源 IFC」+ bucket sub 斷言）。頁殼整合另見 ModelDataPage.test.tsx。

  // spec §7.3 核心：A1 選擇器選定 project→model→version 後，ifcPath input 值更新為該 version.path。
  // 這條對應 load-bearing handler onChange={(e)=>{ if(e.target.value) setIfcPath(e.target.value); }}（pages.tsx）。
  // 先確認手動 input 可用；逐層選取後 input.value 變成檔案庫選定的絕對路徑。
  it("A1 選 project→model→version → ifcPath input value 更新為 version.path（spec §7.3 data-binding）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<IssuesRuleCenterPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 fsTree 入 state、三層 select enable

    const projectSel = container.querySelector<HTMLSelectElement>('[data-testid="a1-fs-project"]');
    const modelSel = container.querySelector<HTMLSelectElement>('[data-testid="a1-fs-model"]');
    const versionSel = container.querySelector<HTMLSelectElement>('[data-testid="a1-fs-version"]');
    expect(projectSel).not.toBeNull();
    expect(modelSel).not.toBeNull();
    expect(versionSel).not.toBeNull();

    // ifcPath input = value 與兩個 select（idsPath input 有 placeholder）共存 → 取第一個 minWidth input。
    const ifcInput = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
        (el) => !el.placeholder,
      )!;
    // A1/Issue legacy manual path fallback is env-only; repo 不再硬寫 host absolute fixture。
    expect(ifcInput().disabled).toBe(false);
    // 載入後 project select 已 enable（disabled={!fsTree}）。
    expect(projectSel!.disabled).toBe(false);

    // 選 project=270 → model select enable 並列出「機電」。
    await act(async () => {
      projectSel!.value = "270";
      projectSel!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(modelSel!.disabled).toBe(false);

    // 選 model=機電 → version select enable 並列出「ver 竣工.ifc」(option value=絕對 path)。
    await act(async () => {
      modelSel!.value = "機電";
      modelSel!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(versionSel!.disabled).toBe(false);

    // 選 version → onChange 觸發 setIfcPath(e.target.value=version.path)：
    // 這是 spec §7.3 明文要求「A1 選擇器選定後 input 值更新」的 load-bearing 行為。
    await act(async () => {
      versionSel!.value = VER_PATH;
      versionSel!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // 斷言 data-binding 真的生效：ifcPath input value === 檔案庫選定的絕對路徑（非預設 fixture）。
    expect(ifcInput().value).toBe(VER_PATH);
    expect(ifcInput().value).not.toContain("fixture-bytes.ifc");

    await act(async () => { root.unmount(); });
  });

  // A1 選擇器 graceful degradation：filesTree() reject → 顯示誠實「檔案庫不可用…可改用下方
  // 手動輸入路徑」（pages.tsx:597），且手動輸入框照常可用（不需要預填 fixture）。
  // SSR 首幀 fsErr=null 走 loading 文案，唯有 client-render 微任務跑完（catch→setFsErr）才到得了。
  it("A1 filesTree() reject → 選擇器標「檔案庫不可用」graceful degrade，手動輸入照常可用", async () => {
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("proxy 502"));
    const root = createRoot(container);
    await act(async () => { root.render(<IssuesRuleCenterPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 catch→setFsErr 入 state

    const html = container.innerHTML;
    // 誠實 graceful-degradation 文案（pages.tsx:597）：標不可用 + 指向手動輸入。
    expect(html).toContain("檔案庫不可用");
    expect(html).toContain("可改用下方手動輸入路徑");
    expect(html).toContain("proxy 502"); // 顯示原因，不吞錯
    // 已離開「載入檔案庫中…」（fsErr 已設）。
    expect(html).not.toContain("載入檔案庫中…（GET /api/governance/files/tree）");

    // 手動輸入框仍可用（graceful degrade 不擋手動流程）。
    const ifcInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (el) => !el.placeholder,
    )!;
    expect(ifcInput.disabled).toBe(false);
    // 仍可手動改路徑（驗證受控輸入未被 fsErr 凍結）。
    await act(async () => {
      ifcInput.value = "C:/manual/typed.ifc";
      ifcInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const after = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (el) => !el.placeholder,
    )!;
    expect(after.value).toBe("C:/manual/typed.ifc");

    await act(async () => { root.unmount(); });
  });

  // reviewer P2（Codex）：version <select> 須為「持值」受控元件——選定後不得跳回 placeholder；
  // 換 project/model 後 version 選擇與「由選擇器填入的 ifcPath」一併清空（避免殘留舊選擇
  // 被誤送出檢核）；手動輸入的路徑不受清理影響。
  it("A1 version select 持有選定值；換 project 清 selector 填入的 ifcPath、手動輸入不受影響", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<IssuesRuleCenterPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const ifcInput = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find((el) => !el.placeholder)!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    await pick("a1-fs-project", "270");
    await pick("a1-fs-model", "機電");
    await pick("a1-fs-version", VER_PATH);
    // 受控持值：選定後 select 顯示選中項，不再被 value="" 打回 placeholder。
    expect(sel("a1-fs-version").value).toBe(VER_PATH);
    expect(ifcInput().value).toBe(VER_PATH);

    // 換 project → version 重置、由選擇器填入的 ifcPath 清空（不殘留舊選擇）。
    await pick("a1-fs-project", "");
    expect(sel("a1-fs-version").value).toBe("");
    expect(ifcInput().value).toBe("");

    // 手動輸入的路徑不被換層清理：重選到 version 後手動覆寫，再換 model → 保留手動值。
    // 注意：受控 input 須經 native value setter 才會繞過 React value tracker 的 dedup、
    // 真正觸發 onChange 入 state（直接設 .value 會被 tracker 視為無變化而吞掉）。
    await pick("a1-fs-project", "270");
    await pick("a1-fs-model", "機電");
    await pick("a1-fs-version", VER_PATH);
    await act(async () => {
      const el = ifcInput();
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, "C:/manual/typed.ifc");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(ifcInput().value).toBe("C:/manual/typed.ifc"); // 手動值已真正入 state
    await pick("a1-fs-model", "");
    expect(ifcInput().value).toBe("C:/manual/typed.ifc"); // 換層清理不波及手動值

    await act(async () => { root.unmount(); });
  });

  // reviewer P2（Codex, round 2）：version 選回 placeholder（value=""）也要清「由選擇器
  // 填入的」ifcPath——只 reset selVersion 會讓 input 殘留舊選擇被誤送出；手動值不波及。
  it("A1 version 清回 placeholder → selector 填入的 ifcPath 清空、手動值保留", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<IssuesRuleCenterPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const ifcInput = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).find((el) => !el.placeholder)!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // 選定 version 後清回 placeholder → ifcPath 一併清空（不殘留舊選擇）。
    await pick("a1-fs-project", "270");
    await pick("a1-fs-model", "機電");
    await pick("a1-fs-version", VER_PATH);
    expect(ifcInput().value).toBe(VER_PATH);
    await pick("a1-fs-version", "");
    expect(sel("a1-fs-version").value).toBe("");
    expect(ifcInput().value).toBe("");

    // 手動覆寫後再清 placeholder → 手動值保留（清理只針對 selector 填入值）。
    await pick("a1-fs-version", VER_PATH);
    await act(async () => {
      const el = ifcInput();
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, "C:/manual/typed.ifc");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pick("a1-fs-version", "");
    expect(ifcInput().value).toBe("C:/manual/typed.ifc");

    await act(async () => { root.unmount(); });
  });

  // [Task 9 MD 三頁合一] MinioData error→retry→success 已遷移至 MinioTreePane.test.tsx (f)
  //（refreshCurrent 重打 getMinioFolder、roleLabel「來源 IFC」+ bucket sub 斷言一併保留）。

  // 同上（A1 檔案庫選擇器）：graceful degrade 之外提供「重試載入檔案庫」，成功後選擇器可用。
  it("A1 檔案庫不可用點「重試載入檔案庫」→ 重打 filesTree() → 選擇器 enable", async () => {
    const spy = vi
      .spyOn(governanceClient, "filesTree")
      .mockRejectedValueOnce(new Error("proxy 502"))
      .mockResolvedValueOnce(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<IssuesRuleCenterPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toContain("檔案庫不可用");

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a1-fs-retry"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(container.innerHTML).not.toContain("檔案庫不可用");
    const projectSel = container.querySelector<HTMLSelectElement>('[data-testid="a1-fs-project"]');
    expect(projectSel!.disabled).toBe(false); // fsTree 已載入 → 選擇器可用
    expect(spy).toHaveBeenCalledTimes(2);

    await act(async () => { root.unmount(); });
  });

  // A2 VersionDiffPage 雙組三層選擇器（複用 A1 模式）：選定 base 版本 → 填 base input
  // 並把 base_model_version_id（{project}/{model}/{version.name}）隨 createDiff 送出。
  it("A2 VersionDiffPage 選 base 版本 → 填 base input 並送 base_model_version_id", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2", status: "queued" });
    // getDiff 立刻回 succeeded 結束輪詢，避免測試卡在 setTimeout 迴圈。
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const baseInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    // 受控持值 + 填入 base input。
    expect(sel("a2-base-version").value).toBe(VER_PATH);
    expect(baseInput().value).toBe(VER_PATH);

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe(VER_PATH);
    expect(arg.base_model_version_id).toBe("270/機電/ver 竣工.ifc");

    await act(async () => { root.unmount(); });
  });

  // 對稱補上 target 側（需求明文：base 與 target「各一組」三層選擇器，model_version_id 兩側
  // 都「隨 createDiff 送出」）。選 base=v1、target=v2（fixture 第二版本），assert createDiff
  // 同時收到 base_model_version_id 與『相異的』target_model_version_id——若 target 選擇器
  // 沒接好 / 與 base 交叉接線 / 對 e.target.value 是 no-op，產不出這個相異的 target id，測試會紅。
  it("A2 VersionDiffPage 選 base+target 版本 → 兩側 model_version_id 皆隨 createDiff 送出", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2bt", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2bt",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const baseInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
    const targetInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-target-input"]')!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // base 選 v1（沿用第一個測試的 270/機電/ver 竣工.ifc）。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    // target 選 v2（同 project/model 下的第二版本），驗證 target 三層選擇器獨立於 base。
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", VER2_PATH);

    // 兩側受控持值 + 各自填入對應 input（base/target 不互相覆蓋）。
    expect(sel("a2-base-version").value).toBe(VER_PATH);
    expect(sel("a2-target-version").value).toBe(VER2_PATH);
    expect(baseInput().value).toBe(VER_PATH);
    expect(targetInput().value).toBe(VER2_PATH);

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe(VER_PATH);
    expect(arg.target_ifc_path).toBe(VER2_PATH);
    // 兩側 model_version_id 皆送出，且 target 相異於 base（證明 target 側真的接上、非沿用 base）。
    expect(arg.base_model_version_id).toBe("270/機電/ver 竣工.ifc");
    expect(arg.target_model_version_id).toBe("270/機電/ver 竣工 v2.ifc");

    await act(async () => { root.unmount(); });
  });

  // target 側手動覆寫路徑 input → 清掉 target_model_version_id（誠實：手填路徑無版本綁定語意），
  // 且不影響已選定的 base_model_version_id。對稱於 base 側既有行為。
  it("A2 target input 手動覆寫 → 清 target_model_version_id，base 綁定不受影響", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2ov", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2ov",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const targetInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-target-input"]')!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // base 走選擇器（保留版本綁定），target 先選版本再手動覆寫路徑（清綁定）。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", VER2_PATH);
    expect(targetInput().value).toBe(VER2_PATH);

    // 手動覆寫 target 路徑 → onChange 清 targetVerId + targetSel.version。
    // 注意：受控 input 須經 native value setter 才會繞過 React value tracker 的 dedup、
    // 真正觸發 onChange 入 state（直接設 .value 會被 tracker 視為無變化而吞掉）——沿用本檔
    // A1 既有手動覆寫測試（上方）同款 idiom。
    await act(async () => {
      const el = targetInput();
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, "C:/manual/typed-target.ifc");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(targetInput().value).toBe("C:/manual/typed-target.ifc"); // 手動值已真正入 state
    expect(sel("a2-target-version").value).toBe(""); // 覆寫後 target version select 回未選

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    const arg = createSpy.mock.calls[0][0];
    expect(arg.target_ifc_path).toBe("C:/manual/typed-target.ifc");
    // 手填路徑 → target_model_version_id 清空（undefined，維持現行為），但 base 綁定保留。
    expect(arg.target_model_version_id).toBeUndefined();
    expect(arg.base_model_version_id).toBe("270/機電/ver 竣工.ifc");

    await act(async () => { root.unmount(); });
  });

  // 對稱補上 base 側（需求明文：「手動覆寫 input 時清空對應 model_version_id」適用 base/target
  // 兩側）。base 先選版本再手動覆寫路徑（清 base 綁定）；target 走選擇器保留版本綁定 → assert
  // createDiff 收到 base_model_version_id=undefined 但 target_model_version_id 仍在。若 base input
  // onChange 沒清 baseVerId / baseSel.version，會殘留舊綁定隨 createDiff 送出，測試會紅。
  it("A2 base input 手動覆寫 → 清 base_model_version_id，target 綁定不受影響", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2bov", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2bov",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const baseInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // base 先選版本（建立綁定）再手動覆寫路徑（清綁定）；target 走選擇器保留版本綁定。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", VER2_PATH);
    expect(baseInput().value).toBe(VER_PATH);

    // 手動覆寫 base 路徑 → onChange 清 baseVerId + baseSel.version。
    // 注意：受控 input 須經 native value setter 才會繞過 React value tracker 的 dedup、
    // 真正觸發 onChange 入 state（直接設 .value 會被 tracker 視為無變化而吞掉）——沿用本檔
    // target 側手動覆寫測試（上方）同款 idiom。
    await act(async () => {
      const el = baseInput();
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, "C:/manual/typed-base.ifc");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(baseInput().value).toBe("C:/manual/typed-base.ifc"); // 手動值已真正入 state
    expect(sel("a2-base-version").value).toBe(""); // 覆寫後 base version select 回未選

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe("C:/manual/typed-base.ifc");
    // 手填路徑 → base_model_version_id 清空（undefined，維持現行為），但 target 綁定保留。
    expect(arg.base_model_version_id).toBeUndefined();
    expect(arg.target_model_version_id).toBe("270/機電/ver 竣工 v2.ifc");

    await act(async () => { root.unmount(); });
  });

  // reviewer（quality I1）：對稱補上 A1 既有「換 project 清 selector 填入值、手動值不波及」於 base 側。
  // A2 雙組選擇器最關鍵的非平凡邏輯是 clearBaseSelection（換 project/model select 的 onChange 直接
  // 呼叫；version select 選回 placeholder 時 onChange 的 else arm 也落到同函數）內的
  //   setBase((cur) => (cur === baseSel.version ? "" : cur))（target 對稱）——
  // 選定版本後再「換 project」必須清掉「由選擇器填入的」base 路徑與 base_model_version_id，
  // 但「手動輸入的」路徑不得被清（cur !== baseSel.version → 保留）。若此比較方向倒置 / off-by-one，
  // createDiff 會默默帶舊版本路徑送出而不被既有測試擋下，故獨立補此 A2 base-side 換層清空驗收。
  it("A2 base 選版本後換 project → 清 selector 填入的 base 路徑與 base_model_version_id、手動值不波及", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2bsw", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2bsw",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const baseInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
    const setInputNative = (el: HTMLInputElement, value: string) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // 選定 base 版本（建立 selector 填入值 + 綁定）。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    expect(baseInput().value).toBe(VER_PATH);

    // 換 project（選回 placeholder）→ selector 填入的 base 路徑與 version select 一併清空。
    await pick("a2-base-project", "");
    expect(sel("a2-base-version").value).toBe("");
    expect(baseInput().value).toBe("");

    // 換 model 同樣走 clearBaseSelection：重選版本後換 model → selector 填入值清空。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    expect(baseInput().value).toBe(VER_PATH);
    await pick("a2-base-model", "");
    expect(baseInput().value).toBe("");

    // 手動輸入的 base 路徑不被換層清理：重選版本後手動覆寫，再換 project → 保留手動值。
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", VER_PATH);
    await act(async () => { setInputNative(baseInput(), "C:/manual/typed-base.ifc"); });
    expect(baseInput().value).toBe("C:/manual/typed-base.ifc"); // 手動值已真正入 state
    await pick("a2-base-project", "");
    expect(baseInput().value).toBe("C:/manual/typed-base.ifc"); // 換層清理不波及手動值

    // 換層清空後送出 createDiff：base_model_version_id 已清（手動路徑無版本綁定語意）。
    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe("C:/manual/typed-base.ifc");
    expect(arg.base_model_version_id).toBeUndefined();

    await act(async () => { root.unmount(); });
  });

  // reviewer（quality I1）：target 側對稱版（clearTargetSelection 內
  //   setTarget((cur) => (cur === targetSel.version ? "" : cur))）。
  // 選定 target 版本後換 project/model → 清 selector 填入的 target 路徑與 target_model_version_id；
  // 手動輸入值不波及。驗證 base/target 換層清理各自獨立、無交叉接線。
  it("A2 target 選版本後換 project → 清 selector 填入的 target 路徑與 target_model_version_id、手動值不波及", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2tsw", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2tsw",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const sel = (tid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${tid}"]`)!;
    const targetInput = () => container.querySelector<HTMLInputElement>('[data-testid="a2-target-input"]')!;
    const setInputNative = (el: HTMLInputElement, value: string) => {
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const pick = async (tid: string, value: string) => {
      await act(async () => {
        sel(tid).value = value;
        sel(tid).dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    // 選定 target 版本（v2）→ selector 填入 target 路徑 + 綁定。
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", VER2_PATH);
    expect(targetInput().value).toBe(VER2_PATH);

    // 換 project → selector 填入的 target 路徑與 version select 一併清空。
    await pick("a2-target-project", "");
    expect(sel("a2-target-version").value).toBe("");
    expect(targetInput().value).toBe("");

    // 手動輸入的 target 路徑不被換層清理：重選版本後手動覆寫，再換 model → 保留手動值。
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", VER2_PATH);
    await act(async () => { setInputNative(targetInput(), "C:/manual/typed-target.ifc"); });
    expect(targetInput().value).toBe("C:/manual/typed-target.ifc");
    await pick("a2-target-model", "");
    expect(targetInput().value).toBe("C:/manual/typed-target.ifc"); // 換層清理不波及手動值

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    const arg = createSpy.mock.calls[0][0];
    expect(arg.target_ifc_path).toBe("C:/manual/typed-target.ifc");
    expect(arg.target_model_version_id).toBeUndefined();

    await act(async () => { root.unmount(); });
  });

  // A2 選擇器 graceful degradation（對稱於 A1 既有 fsErr 測試）：filesTree() reject → 顯示誠實
  // 「檔案庫不可用…可改用下方手動輸入路徑」（pages.tsx a2-fs-error）+ 重試鈕（a2-fs-retry），
  // 且 base/target 手動輸入框照常可用（保留預設 fixture、仍可編輯）。SSR 首幀 fsErr=null 走
  // loading 文案，唯有 client-render 微任務跑完（catch→setFsErr）才到得了此分支。
  it("A2 filesTree() reject → 選擇器標「檔案庫不可用」graceful degrade，base/target 手動輸入照常可用", async () => {
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("proxy 502"));
    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 catch→setFsErr 入 state

    const html = container.innerHTML;
    // 誠實 graceful-degradation 文案：標不可用 + 指向手動輸入。
    expect(html).toContain("檔案庫不可用");
    expect(html).toContain("可改用下方手動輸入路徑");
    expect(html).toContain("proxy 502"); // 顯示原因，不吞錯
    // 已離開「載入檔案庫中…」（fsErr 已設）。
    expect(html).not.toContain("載入檔案庫中…（GET /api/governance/files/tree）");

    // 使用者可觸發的重試鈕存在（不必整頁 reload）。
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a2-fs-retry"]');
    expect(retry).not.toBeNull();

    // base/target 手動輸入框仍可用（保留預設 fixture 路徑，graceful degrade 不擋手動流程）。
    const baseInput = container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
    const targetInput = container.querySelector<HTMLInputElement>('[data-testid="a2-target-input"]')!;
    expect(baseInput.disabled).toBe(false);
    expect(targetInput.disabled).toBe(false);
    expect(baseInput.value).toContain(".ifc"); // 預設 fixture 路徑（受控值未被 fsErr 凍結）
    // 仍可手動改 base 路徑（驗證受控輸入未被 fsErr 凍結）。
    await act(async () => {
      const el = container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!;
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(el, "C:/manual/typed.ifc");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!.value).toBe("C:/manual/typed.ifc");

    await act(async () => { root.unmount(); });
  });

  // reviewer（quality I2）：對稱於 A1 既有「重試載入檔案庫」完整流程（console.test.tsx A1 retry）。
  // 既有 A2 graceful-degrade 測試只驗重試鈕 render，未驗點擊後真的重新載入。spec §2 明文重試鈕
  // 是要求行為——須驗點 a2-fs-retry → filesTree() 第二次被呼叫並成功 → 雙組選擇器從 disabled
  // 恢復 enable（base/target project select disabled=false），不必整頁 reload。
  it("A2 檔案庫不可用點「重試載入檔案庫」→ 重打 filesTree() → base/target 選擇器 enable", async () => {
    const spy = vi
      .spyOn(governanceClient, "filesTree")
      .mockRejectedValueOnce(new Error("proxy 502"))
      .mockResolvedValueOnce(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toContain("檔案庫不可用");
    // 失敗態（fsTree 仍 null）→ base/target project select 皆 disabled（disabled={!fsTree}）。
    expect(container.querySelector<HTMLSelectElement>('[data-testid="a2-base-project"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('[data-testid="a2-target-project"]')!.disabled).toBe(true);

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a2-fs-retry"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    await act(async () => { await Promise.resolve(); });

    // 第二次 filesTree() 成功 → 離開 error 態、雙組選擇器恢復 enable。
    expect(container.innerHTML).not.toContain("檔案庫不可用");
    expect(container.querySelector<HTMLSelectElement>('[data-testid="a2-base-project"]')!.disabled).toBe(false);
    expect(container.querySelector<HTMLSelectElement>('[data-testid="a2-target-project"]')!.disabled).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2); // 真的重打了一次

    await act(async () => { root.unmount(); });
  });
});

describe("A1 step① MinIO 下拉（B2）", () => {
  it("getMinioObjects 回 source_ifc + parsed_usdc → A1 只列 source_ifc，文字框 a1-step-path 不再渲染", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("offline"));
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] });
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 2,
      objects: [
        { key: "松風庵/root/main/uuid1/model.ifc", etag: "e1", role: "source_ifc", idempotency_key: "mw_0000000000000011", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" },
        { key: "松風庵/root/main/uuid1/model.usdc", etag: "e2", role: "parsed_usdc", idempotency_key: "mw_0000000000000012", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" },
      ],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="a1-source-minio"]')!.click();
    });
    const select = container.querySelector('[data-testid="a1-minio-select"]') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    // 只列 source_ifc（1 個真選項 + 1 個 placeholder option）。
    expect(select!.querySelectorAll("option").length).toBe(2);
    expect(select!.textContent).toContain("松風庵");
    expect(select!.textContent).toContain("建築");
    expect(select!.textContent).not.toContain("model.usdc"); // parsed_usdc 不入下拉
    // 文字框 a1-step-path 已被下拉取代。
    expect(container.querySelector('[data-testid="a1-step-path"]')).toBeNull();
    await act(async () => { root.unmount(); });
    document.body.removeChild(container);
  });
});

// A2 VersionDiff 多專案 / 三層版本選擇器 client-render（spec §4.2/§6.2）。
// 上方 A2 既有測試的 fixture 只有單一 project（270）/單一 model（機電），無法證明
//   (1) project 下拉真的把「多個」project 都列出來（多專案可選）、
//   (2) version 下拉能顯示「巢狀三層」版本名（如 v1/japanese_villa.ifc，name 帶子目錄）。
// 此處用自帶含「松風庵/建築/v1/japanese_villa.ifc」的真實樹形狀（比照 storage 實際結構），
// client-render 驗證多專案選擇與三層版本名顯示——SSR 首幀 fsTree=null 永遠到不了 populated 態。
describe("A2 VersionDiff 檔案庫選擇器 client-render（spec §4.2/§6.2：base/target 三層 + model_version_id）", () => {
  const BASE_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 000001.ifc";
  const TARGET_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工.ifc";
  const VILLA_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/松風庵/建築/v1/japanese_villa.ifc";
  // VersionDiffPage target state 預設值（pages.tsx 初值）；target 未選版本時 createDiff 應沿用此值。
  const DEFAULT_TARGET_PATH = "C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\許良宇圖書館建築_2026 - 轉檔測試2.ifc";
  // 多專案 + 三層版本：270/機電（兩版）+ 松風庵/建築（一個三層 name 的版本）。
  const a2tree: FilesTreeResponse = {
    root: "C:/Repos/active/iot/AI-BIM-governance/storage",
    source_kind: "local_fs",
    projects: [
      {
        project_id: "270",
        models: [
          {
            model_id: "機電",
            versions: [
              { name: "ver 000001.ifc", path: BASE_PATH, size_bytes: 8155, mtime: "2026-06-10T17:00:00+08:00" },
              { name: "ver 竣工.ifc", path: TARGET_PATH, size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" },
            ],
          },
        ],
      },
      {
        project_id: "松風庵",
        models: [
          {
            model_id: "建築",
            versions: [
              { name: "v1/japanese_villa.ifc", path: VILLA_PATH, size_bytes: 12345, mtime: "2026-06-11T09:00:00+08:00" },
            ],
          },
        ],
      },
    ],
  };

  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const sel = (testid: string) => container.querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
  const inputByTestId = (testid: string) => container.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
  const pick = async (testid: string, value: string) => {
    await act(async () => {
      sel(testid).value = value;
      sel(testid).dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  // 受控 input 須經 native value setter 才繞過 React value tracker 的 dedup、真正觸發 onChange 入 state
  // （直接設 .value 會被 tracker 視為無變化吞掉）——沿用本檔既有手動覆寫測試同款 idiom。
  const setInputNative = (el: HTMLInputElement, value: string) => {
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    nativeValueSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // spec §4.2/§6.2 核心：base 走三層選定 270/機電/ver 000001.ifc、target 選 ver 竣工.ifc →
  // 受控 input 值更新，且 createDiff 同時收到兩側 path 與兩側 model_version_id（{project}/{model}/{version.name}）。
  // SSR 首幀 fsTree=null 到不了 populated 態，必走 client-render；getDiff 一次回 succeeded 結束輪詢。
  it("base 選 270/機電/ver 000001.ifc + target 選 ver 竣工.ifc → input 值更新且 createDiff 收到 model_version_id", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d1", status: "queued" });
    // getDiff 一次回 succeeded 結束輪詢（避免測試等 120 秒）。summary 形狀完整比照 DiffStatus.summary
    // （base_count/target_count/matched/counts/warnings 皆備），免 as never 斷言。
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d1",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 3, counts: { added: 2, removed: 0, moved: 0, property_changed: 1 }, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 filesTree microtask 入 state

    // base 三層
    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", BASE_PATH);
    // target 三層
    await pick("a2-target-project", "270");
    await pick("a2-target-model", "機電");
    await pick("a2-target-version", TARGET_PATH);

    // 受控 input 已被填入版本 path。
    expect(inputByTestId("a2-base-input").value).toBe(BASE_PATH);
    expect(inputByTestId("a2-target-input").value).toBe(TARGET_PATH);

    // Run Diff → createDiff 收到 base/target path + model_version_id（version 綁定 spec §4.2）。
    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        base_ifc_path: BASE_PATH,
        target_ifc_path: TARGET_PATH,
        base_model_version_id: "270/機電/ver 000001.ifc",
        target_model_version_id: "270/機電/ver 竣工.ifc",
      }),
    );

    await act(async () => { root.unmount(); });
  });

  // 多專案可選 + 三層版本名顯示（user-facing 證明）：base project 下拉含「松風庵」，
  // 選松風庵/建築後，version 下拉 option 含三層 name「v1/japanese_villa.ifc」。
  it("project 下拉含松風庵；選建築 → 版本下拉含三層 v1/japanese_villa.ifc（多專案 + 三層支援）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 filesTree microtask 入 state

    // base project 下拉同時列出 270 與 松風庵（多專案可選，非只第一個）。
    const projOptions = Array.from(sel("a2-base-project").options).map((o) => o.value);
    expect(projOptions).toContain("270");
    expect(projOptions).toContain("松風庵");
    // target project 下拉對稱含松風庵（base/target 同源 fsTree，皆可選多專案）。
    expect(Array.from(sel("a2-target-project").options).map((o) => o.value)).toContain("松風庵");

    // 選松風庵/建築 → version option 含三層 name（name 帶子目錄 v1/ 也能正確顯示與選取）。
    await pick("a2-base-project", "松風庵");
    await pick("a2-base-model", "建築");
    const verLabels = Array.from(sel("a2-base-version").options).map((o) => o.textContent);
    expect(verLabels).toContain("v1/japanese_villa.ifc");

    await act(async () => { root.unmount(); });
  });

  // 選定三層版本 → createDiff 收到三層 model_version_id（{project}/{model}/{三層 name}）。
  // 補強：上方既有 A2 測試只驗過「ver 竣工.ifc」這種 flat name 的 model_version_id；此處鎖定
  // 「v1/japanese_villa.ifc」這種帶子目錄的 name 也原樣帶入綁定，不被截斷 / 改寫。
  it("選松風庵/建築/v1/japanese_villa.ifc → createDiff 帶三層 base_model_version_id", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
    const createSpy = vi
      .spyOn(governanceClient, "createDiff")
      .mockResolvedValue({ diff_id: "d-a2villa", status: "queued" });
    // getDiff 一次回 succeeded 結束輪詢（避免測試等 120 秒迴圈）。
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-a2villa",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    await pick("a2-base-project", "松風庵");
    await pick("a2-base-model", "建築");
    await pick("a2-base-version", VILLA_PATH);
    // 受控 input 已被填入三層版本 path。
    expect(container.querySelector<HTMLInputElement>('[data-testid="a2-base-input"]')!.value).toBe(VILLA_PATH);

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe(VILLA_PATH);
    // 三層 name 原樣帶入 model_version_id（含子目錄段 v1/，不截斷）。
    expect(arg.base_model_version_id).toBe("松風庵/建築/v1/japanese_villa.ifc");
    // target 側未選版本 → 沿用元件預設 target state（pages.tsx VersionDiffPage 初值），
    // 鎖定 base/target 未被交叉接線：只動 base 不會污染 target_ifc_path。
    expect(arg.target_ifc_path).toBe(DEFAULT_TARGET_PATH);
    // target 未經三層選擇器 → 無版本綁定語意，model_version_id 應為空（undefined，
    // 對齊本檔其他同場景斷言；toBeFalsy 會放過 null/""/0，語意較弱故不用）。
    expect(arg.target_model_version_id).toBeUndefined();

    await act(async () => { root.unmount(); });
  });

  // spec §4.2/§6.2 graceful degradation：filesTree() reject → 選擇器標誠實「檔案庫不可用…
  // 可改用下方手動輸入路徑」（pages.tsx a2-fs-error）+ 顯示原因，base/target 手動輸入框照常可用。
  // SSR 首幀 fsErr=null 走 loading 文案，唯有 client-render 微任務跑完（catch→setFsErr）才到此分支。
  it("filesTree() reject → 選擇器標「檔案庫不可用」graceful degrade，手動輸入照常可用", async () => {
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("proxy 502"));
    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 catch→setFsErr 入 state

    const html = container.innerHTML;
    expect(html).toContain("檔案庫不可用");
    expect(html).toContain("可改用下方手動輸入路徑");
    expect(html).toContain("proxy 502"); // 顯示原因，不吞錯
    // 使用者可觸發的重試鈕存在（spec §6.2 要求「不必整頁 reload 的重試」；pages.tsx a2-fs-retry）。
    // 鎖住此鈕：若被誤刪或 testid 改名，graceful-degrade 合約應變紅。
    expect(container.querySelector('[data-testid="a2-fs-retry"]')).not.toBeNull();
    // base/target 手動輸入框照常可用（保留預設路徑、可編輯；對稱於舊 block）。
    const baseInput = inputByTestId("a2-base-input");
    expect(baseInput.disabled).toBe(false);
    expect(inputByTestId("a2-target-input").disabled).toBe(false);
    await act(async () => { setInputNative(inputByTestId("a2-base-input"), "C:/manual/base.ifc"); });
    expect(inputByTestId("a2-base-input").value).toBe("C:/manual/base.ifc");

    await act(async () => { root.unmount(); });
  });

  // spec §4.2 誠實鐵律：選定版本後手動覆寫 base input → 清空 base_model_version_id
  // （手填路徑無版本綁定語意）。若 base input onChange 沒清 baseVerId / baseSel.version，
  // 會殘留舊綁定隨 createDiff 送出，測試會紅。
  it("選定版本後手動覆寫 base input → 清空 base_model_version_id（誠實：手填路徑無版本綁定）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a2tree);
    const createSpy = vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d2", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d2",
      status: "succeeded",
      summary: { base_count: 0, target_count: 0, matched: 0, counts: {}, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    await pick("a2-base-project", "270");
    await pick("a2-base-model", "機電");
    await pick("a2-base-version", BASE_PATH);
    // 手動覆寫 base input → 版本綁定清空。
    await act(async () => { setInputNative(inputByTestId("a2-base-input"), "C:/manual/override.ifc"); });

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    // base_model_version_id 應為 undefined（手填路徑無綁定）。
    expect(createSpy).toHaveBeenCalledTimes(1);
    const arg = createSpy.mock.calls[0][0];
    expect(arg.base_ifc_path).toBe("C:/manual/override.ifc");
    expect(arg.base_model_version_id).toBeUndefined();
    // base 手動覆寫不得污染 target 側（target 未選版本：沿用預設路徑、無綁定）。
    expect(arg.target_ifc_path).toBe(DEFAULT_TARGET_PATH);
    expect(arg.target_model_version_id).toBeUndefined();

    await act(async () => { root.unmount(); });
  });
});

// [Task 9 MD 三頁合一] ConversionSchedulingPage：dispatch_error 欄位形狀 + 80 字截斷 迴歸守衛已遷移至
// GlobalConversionPane.test.tsx（同名 describe，佇列列 conv-job-failure-* 由 GlobalConversionPane 承接）。

// quality finding：A1GovernanceWorkbenchPage doRun 輪詢的 unmount / step-reset 守門 +
// makeIssues / doExport 失敗的 UI 回饋（誠實鐵律：操作失敗使用者必須看得到）。
// SSR renderToString 只驗首幀，永遠到不了「點 run → 輪詢中 unmount」與「建 Issue 失敗顯示錯誤」，
// 故用 createRoot + act + vi.spyOn 補上 client-render 互動驗收。
describe("A1GovernanceWorkbenchPage client-render（doRun 輪詢守門 + 動作失敗 UI 回饋）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  const A1_LOCAL_IFC_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/建築/model.ifc";
  const a1FilesTree: FilesTreeResponse = {
    root: "C:/Repos/active/iot/AI-BIM-governance/storage",
    source_kind: "local_fs",
    projects: [{
      project_id: "270",
      models: [{
        model_id: "建築",
        versions: [{ name: "model.ifc", path: A1_LOCAL_IFC_PATH, size_bytes: 12345, mtime: "2026-07-06T00:00:00+08:00" }],
      }],
    }],
  };
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  const fakeRunStatus = (status: RuleRunStatus["status"]): RuleRunStatus => ({
    rule_run_id: "rr_a1",
    status,
    score: 99,
    rule_set: "default",
    model_version_id: null,
    summary: { total: 10, passed: 9, failed: 1, errored: 0, target_summary: {}, warnings: [] },
  });

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    // A1 v2：治理檢核直接對已選 IFC 跑 createRuleRun；review session 只保留給 3D/Review Room handoff。
    // A1 3D 解耦後仍不 auto-select 第一個 active session，避免 handoff 指向錯模型。
    // 同步 mock elementMappingForSession：避免有 usd_prim_path:null 列的測試在 fake-timer 邊界內觸發真 mapping fetch 而 hang。
    // viewerOrigin 留空（browser_url_base:""）→ 不掛 EmbeddedViewer，斷言面不變；afterEach 的 vi.restoreAllMocks() 會還原。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({
      sessions: { count: 1, active_count: 1, participant_count: 0, items: [
        { session_id: "review_session_x", status: "active", project_id: "p1", model_version_id: "m1",
          participant_count: 0, expected_stage_url: "", expected_mapping_url: "", conversion_status: null,
          kit_instance_ids: [], created_at: "", updated_at: "", first_frame_at: null },
      ] },
      configured_endpoints: { viewer: { browser_url_base: "" } }, // viewerOrigin 留空 → 不掛 EmbeddedViewer，斷言面不變
    } as never);
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({ mock: false, summary: { fake_mapping_count: 0 }, items: [] });
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(a1FilesTree);
    // A1 step① 改 MinIO 下拉後，mount 會打 getMinioObjects()；回單一 source_ifc 物件讓 pickModel 能選到該 option。
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{ key: "松風庵/root/main/u1/model.ifc", etag: "e", role: "source_ifc", idempotency_key: "mw_0000000000000013", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    // R8：A1 mount 會打 getTestDataProjects()；預設 stub 空清單（不標），個別測試可覆寫。
    vi.spyOn(coordinatorClient, "getTestDataProjects").mockResolvedValue({ projects: [] });
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const clickByTestId = async (tid: string) => {
    const el = container.querySelector<HTMLButtonElement>(`[data-testid="${tid}"]`)!;
    await act(async () => { el.click(); });
  };

  // A1 v2 executable source is local_fs: pickModel selects the server-local path returned by filesTree(),
  // then locks it before running CPU rule-run. This is the regression guard against sending MinIO keys
  // as ifc_source_path.
  const pickModel = async (path = A1_LOCAL_IFC_PATH) => {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const sel = container.querySelector<HTMLSelectElement>('[data-testid="a1-localfs-select"]')!;
    await act(async () => { sel.value = path; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await clickByTestId("a1-step-pick");
  };

  it("[R8 測試資料標記] local_fs 選項對 config 清單內專案加〔測試資料〕；MinIO 選項不標", async () => {
    (coordinatorClient.getTestDataProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: ["270"] });
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const sel = container.querySelector<HTMLSelectElement>('[data-testid="a1-localfs-select"]')!;
    const optionTexts = Array.from(sel.options).map((o) => o.textContent ?? "");
    expect(optionTexts.some((s) => s.includes("〔測試資料〕") && s.includes("270"))).toBe(true);
    // MinIO＝真實資料監控來源，不標測試資料（R8）。
    expect(container.innerHTML.split("a1-minio-select")[1]?.includes("〔測試資料〕") ?? false).toBe(false);
  });

  it("[IDS picker] A1 IDS 欄位預設顯示 sample IDS path，開啟資料夾後沿用目前目錄填入檔名", async () => {
    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });

    const idsInput = container.querySelector<HTMLInputElement>('[data-testid="a1-ids-path"]')!;
    expect(idsInput.value).toBe("rules/sample-fire-rating.ids");

    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    await clickByTestId("a1-ids-open-folder");
    expect(inputClickSpy).toHaveBeenCalledTimes(1);

    const fileInput = container.querySelector<HTMLInputElement>('[data-testid="a1-ids-file-input"]')!;
    Object.defineProperty(fileInput, "files", {
      value: [new File(["<ids />"], "custom-check.ids", { type: "application/xml" })],
      configurable: true,
    });
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(idsInput.value).toBe("rules/custom-check.ids");

    await act(async () => { root.unmount(); });
  });

  // 取「選取模型」→「執行規則檢核」後進入輪詢；getRuleRun 永遠回 running（loop 不自然結束），
  // 故 loop 卡在 setTimeout(1000)。unmount 後再推進假時鐘，loop 必須因 alive 守門中斷、
  // 不再發出任何 getRuleRun 請求（資源洩漏修復的可觀測證據）。
  it("[finding#1] doRun 輪詢中 unmount → 迴圈停止，不再發 getRuleRun（unmount 守門）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("running"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });

    // 鎖定模型路徑（idle→picked）後執行規則檢核（picked→running，啟動輪詢）。
    await pickModel();
    await clickByTestId("a1-step-run");
    // 跑完 createRuleRun microtask + 第一次 getRuleRun（iteration 0）。
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const callsBeforeUnmount = getSpy.mock.calls.length;
    expect(callsBeforeUnmount).toBeGreaterThanOrEqual(1); // 輪詢確實已啟動

    // 輪詢中 unmount（使用者切頁）。
    await act(async () => { root.unmount(); });
    // 推進 10 秒假時鐘 + flush microtasks：若無守門，loop 會再發出多次 getRuleRun。
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    // unmount 後 getRuleRun 呼叫數不得再增加（迴圈已中斷，無資源洩漏）。
    expect(getSpy.mock.calls.length).toBe(callsBeforeUnmount);
  });

  // 輪詢中使用者按「選取模型」重置 step（running→picked）：reducer 守門已防髒資料寫入，
  // 但 loop 仍會繼續發 getRuleRun。step 離開 running 後 loop 必須中斷、不再發請求。
  it("[finding#1] doRun 輪詢中 PICK_FILE 重置 step → 迴圈停止，不再發 getRuleRun（step 守門）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("running"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const callsBeforeReset = getSpy.mock.calls.length;
    expect(callsBeforeReset).toBeGreaterThanOrEqual(1);

    // 使用者中途按「選取模型」→ dispatch PICK_FILE → step running→picked。
    await clickByTestId("a1-step-pick");
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    // step 已離開 running，舊輪詢迴圈必須中斷，不再發 getRuleRun。
    expect(getSpy.mock.calls.length).toBe(callsBeforeReset);

    await act(async () => { root.unmount(); });
  });

  // makeIssues（建 Issue）失敗時誠實顯示錯誤：後端離線/丟例外 → 頁面出現 ec-warn-note 提示
  // （含錯誤原因），按鈕恢復可用。對齊 doRun 失敗的 runError 同款 UI 回饋（誠實鐵律）。
  it("[finding#2] makeIssues 失敗 → 顯示 ec-warn-note 錯誤提示（不再靜默）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "error", status: "fail", message: "naming rule failed" },
    ]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockRejectedValue(new Error("governance 502"));

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    // 輪詢一次即 succeeded → 結束 loop 並進 scored。
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 進 scored 後「建 Issue」鈕應可用；點擊 → issuesFromRuleRun reject。
    const issuesBtn = container.querySelector<HTMLButtonElement>('[data-testid="a1-step-issues"]')!;
    expect(issuesBtn.disabled).toBe(false);
    await clickByTestId("a1-step-issues");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 誠實 UI 回饋：出現 ec-warn-note 且含錯誤原因（不再靜默）。
    const warn = container.querySelector('[data-testid="a1-action-error"]');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain("governance 502");
    expect(warn!.className).toContain("ec-warn-note");
    // 按鈕恢復可用（操作可重試）。
    expect(container.querySelector<HTMLButtonElement>('[data-testid="a1-step-issues"]')!.disabled).toBe(false);

    await act(async () => { root.unmount(); });
  });

  // doExport（匯出 Excel）失敗時同樣誠實顯示錯誤：fetch 丟例外 → ec-warn-note 提示。
  // 補：成功的 makeIssues 之後動作須清掉上次的錯誤提示（不殘留陳舊紅錯）。
  it("[finding#2] doExport 失敗 → 顯示 ec-warn-note；下次成功動作清除舊錯誤", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "error", status: "fail", message: "naming rule failed" },
    ]);
    // 第一次匯出：fetch 丟例外（後端離線）。
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const issuesSpy = vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 2, issue_ids: ["i1", "i2"] });
    vi.spyOn(governanceClient, "getIssue").mockImplementation(async (id: string): Promise<IssueRow> => ({
      id,
      kind: "issue",
      title: `issue ${id}`,
      status: "open",
      severity: "medium",
      ifc_guid: `guid-${id}`,
      usd_prim_path: null,
      source_type: "rule_result",
    }));

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 匯出 Excel（status===succeeded → 鈕 enable）→ fetch reject → 顯示錯誤。
    const exportBtn = container.querySelector<HTMLButtonElement>('[data-testid="a1-step-export"]')!;
    expect(exportBtn.disabled).toBe(false);
    await clickByTestId("a1-step-export");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const warn = container.querySelector('[data-testid="a1-action-error"]');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain("network down");
    expect(fetchSpy).toHaveBeenCalled();

    // 下次成功動作（建 Issue 成功）清除舊錯誤提示（不殘留陳舊紅錯）。
    await clickByTestId("a1-step-issues");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(issuesSpy).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="a1-action-error"]')).toBeNull();

    await act(async () => { root.unmount(); });
  });

  // [Critical] doRun 失敗（RUN_FAIL）→ running-error 子態：spec §5「允許重試」。
  // 對應 quality finding：先前「可重試」文案顯示但 run 鈕因 step===running 被 disabled、
  // 且 plain RUN 在 running 是 no-op，導致使用者點不到/點了沒反應。修法是 running-error 子態
  // 把 run 鈕 enable，點擊走 RUN_RETRY 真重試。此測試走完整路徑：失敗 → 鈕仍可點 → 重試成功 → scored。
  it("[Critical] doRun 失敗 → run 鈕在 running-error 子態仍可點 → 重試成功 → scored 記分板出現", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    // 第一輪輪詢回 failed（→ RUN_FAIL），重試後第二輪回 succeeded（→ RUN_DONE → scored）。
    const getSpy = vi
      .spyOn(governanceClient, "getRuleRun")
      .mockResolvedValueOnce(fakeRunStatus("failed"))
      .mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    // 第一輪輪詢即 failed → 結束 loop → dispatch RUN_FAIL → running-error 子態。
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 誠實 UI：出現「可重試」紅字提示，且帶錯誤原因（rule-run failed）。
    const warnNote = Array.from(container.querySelectorAll(".ec-warn-note")).find((n) =>
      n.textContent?.includes("可重試"),
    );
    expect(warnNote, "RUN_FAIL 後應出現『可重試』提示").not.toBeUndefined();
    expect(warnNote!.textContent).toContain("rule-run failed");

    // 核心：run 鈕在 running-error 子態必須仍可點（修復前因 step===running 被 disabled，點不到）。
    const runBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-run"]')!;
    expect(runBtn().disabled, "running-error 子態 run 鈕必須 enable 才能重試（修復前為 disabled）").toBe(false);

    const callsAfterFail = getSpy.mock.calls.length;
    // 點「重試」→ 走 RUN_RETRY 真重試（修復前 dispatch plain RUN 在 running 是 no-op，輪詢不會重啟）。
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // 重試真的重啟了輪詢（getRuleRun 再被呼叫），證明不是 no-op。
    expect(getSpy.mock.calls.length, "重試應重啟輪詢（非 no-op）").toBeGreaterThan(callsAfterFail);

    // 第二輪 succeeded → 進 scored；step 欄顯示 scored、記分板區塊出現、紅錯提示清除。
    const stepField = Array.from(container.querySelectorAll(".ec-field")).find((f) =>
      f.querySelector(".ec-k")?.textContent === "step",
    );
    expect(stepField?.querySelector(".ec-v")?.textContent).toContain("scored");
    expect(container.querySelector('[data-testid="a1-rulerun-scoreboard"]')).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll(".ec-warn-note")).some((n) => n.textContent?.includes("可重試")),
      "重試成功後『可重試』提示應清除",
    ).toBe(false);

    await act(async () => { root.unmount(); });
  });

  // [qr-t2-pollgen-race] createRuleRun await 視窗內按「選取模型」(PICK_FILE → step running→picked
  // → pollGen 遞增)應中止後續輪詢。修復前 doRun 在 await createRuleRun 之後「重新捕捉」myGen，
  // 把已遞增的新 gen 抓進來，守門永遠通過、舊輪詢 getRuleRun 仍照打(資源洩漏)。
  // 此測試在 createRuleRun pending 時觸發 PICK_FILE，解析後 getRuleRun 不得被呼叫。
  it("[qr-t2-pollgen-race] createRuleRun await 期間 PICK_FILE → 取消生效，getRuleRun 不再發（不重捕 gen）", async () => {
    // 受控 deferred：createRuleRun 在我們手動 resolve 前保持 pending，模擬「await 視窗」。
    let resolveCreate!: (v: { rule_run_id: string; status: "queued" }) => void;
    const createPending = new Promise<{ rule_run_id: string; status: "queued" }>((res) => { resolveCreate = res; });
    vi.spyOn(governanceClient, "createRuleRun").mockReturnValue(createPending);
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("running"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });

    // idle→picked→running（doRun 啟動，卡在 await createRuleRun，輪詢尚未開始）。
    await pickModel();
    await clickByTestId("a1-step-run");
    expect(getSpy.mock.calls.length).toBe(0); // createRuleRun 未解析前不該有 getRuleRun

    // 關鍵：createRuleRun 仍 pending 時使用者按「選取模型」→ PICK_FILE → step running→picked
    // → pollGen 遞增（取消本輪輪詢）。
    await clickByTestId("a1-step-pick");

    // 解析 createRuleRun + 推進假時鐘：守門應在 await 之後立即攔截，輪詢永不啟動。
    resolveCreate({ rule_run_id: "rr_a1", status: "queued" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });

    expect(getSpy.mock.calls.length, "createRuleRun await 內取消後不得再發 getRuleRun").toBe(0);

    await act(async () => { root.unmount(); });
  });

  // [qr-t2-terminal-status-whitelist] 後端 JSON 可能回型別 union 外的 terminal status（errored/cancelled）。
  // 修復前 break 條件只認 succeeded/failed，遇 errored 會空轉 60 次（60s 假時鐘）才結束。
  // 改成 in-progress 白名單（!queued && !running）後，任何 terminal status 即時中斷 → RUN_FAIL。
  it("[qr-t2-terminal-status-whitelist] getRuleRun 回 errored（union 外 terminal）→ 立即中斷一次即 RUN_FAIL，不空轉", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    // 強制回傳型別 union 外的 terminal status。cast 繞過 TS 因為這正是「後端回了型別沒涵蓋的值」情境。
    const erroredStatus = { ...fakeRunStatus("running"), status: "errored" } as unknown as RuleRunStatus;
    const getSpy = vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(erroredStatus);
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    // 第一輪即 errored → 白名單條件 break；不得 setTimeout 等下一輪。
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // getRuleRun 只應被呼叫一次（即時中斷，非空轉 60 次）。
    expect(getSpy.mock.calls.length, "errored 應即時中斷，getRuleRun 只呼叫一次").toBe(1);

    // status !== succeeded → 走 RUN_FAIL 分支 → running-error 子態「可重試」提示。
    const warnNote = Array.from(container.querySelectorAll(".ec-warn-note")).find((n) =>
      n.textContent?.includes("可重試"),
    );
    expect(warnNote, "errored 應進 running-error 子態並顯示『可重試』").not.toBeUndefined();
    expect(warnNote!.textContent).toContain("rule-run errored");

    // 再推進 10 秒：確認沒有後續輪詢（已 break，loop 結束）。
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(getSpy.mock.calls.length, "break 後不應再發 getRuleRun").toBe(1);

    await act(async () => { root.unmount(); });
  });

  // [Important-2] a1-step-export 的 disabled 必須與 a1-step-issues 對齊 state-machine 語意
  // （step ∈ {scored,issued,delivered} 才 enable），不得只看 state.run 的快照欄位。
  // 重跑時存在一個 running 子態：RUN 清 run=null（export 暫 disabled），但下一輪 getRuleRun
  // 回 succeeded → RUN_PROGRESS 把 state.run 寫成 status=succeeded，而 step 仍 running（RUN_PROGRESS
  // 不改 step）。修復前 export disabled={!runId || run?.status!=="succeeded"} 在此瞬間會誤解除
  // disabled，允許在 running 子態觸發匯出。此測試把元件凍結在該窗口（getResults 永不 resolve，
  // 卡在 RUN_PROGRESS-succeeded 與 RUN_DONE 之間），斷言 export 仍 disabled、issues 同步 disabled。
  it("[Important-2] 重跑 running 子態存在 succeeded 快照時，匯出鈕仍 disabled（與建 Issue 對齊 step 語意）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    // 第一輪輪詢回 succeeded → 進 scored（export enable）。重跑後第二輪也回 succeeded，
    // 但 getResults 第二次永不 resolve → 元件凍結在 running 子態且 state.run.status=succeeded。
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    let getResultsCalls = 0;
    vi.spyOn(governanceClient, "getResults").mockImplementation(() => {
      getResultsCalls += 1;
      // 第一次（首跑 RUN_DONE）正常 resolve 進 scored；第二次（重跑）永不 resolve，凍結在 running。
      return getResultsCalls === 1 ? Promise.resolve([]) : new Promise<RuleResultRow[]>(() => {});
    });

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 首跑完成 → scored：export 與 issues 皆 enable（前置條件，確認鈕在 scored 真的可用）。
    const exportBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-export"]')!;
    const issuesBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="a1-step-issues"]')!;
    expect(exportBtn().disabled, "scored 態 export 應 enable").toBe(false);
    expect(issuesBtn().disabled, "scored 態 issues 應 enable").toBe(false);

    // 重跑：RUN 清 run=null → 下一輪 getRuleRun 回 succeeded → RUN_PROGRESS 寫 state.run.status=succeeded，
    // step 仍 running（getResults 第二次 hang，RUN_DONE 不觸發）。元件凍結在「running + succeeded 快照」窗口。
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 凍結窗口斷言：step 仍 running（尚未 RUN_DONE），但 state.run.status === "succeeded"。
    const stepField = Array.from(container.querySelectorAll(".ec-field")).find((f) =>
      f.querySelector(".ec-k")?.textContent === "step",
    );
    expect(stepField?.querySelector(".ec-v")?.textContent, "應凍結在 running 子態").toContain("running");

    // 核心斷言（修復前 export 在此瞬間被誤解除 disabled）：running 子態 export 必須 disabled，
    // 且與 issues 同步 disabled（兩個下游交付鈕共用 state-machine 語意）。
    expect(exportBtn().disabled, "running 子態（含 succeeded 快照）export 必須 disabled").toBe(true);
    expect(issuesBtn().disabled, "running 子態 issues 必須 disabled").toBe(true);

    await act(async () => { root.unmount(); });
  });

  // [Important-1] doExport 觸發下載的錨點必須在 .click() 當下掛載於 document（appendChild→click→removeChild）。
  // Firefox（Gecko）與部分 Edge 對「未掛載 DOM 的 <a>」觸發下載不可靠 → 匯出靜默失敗、EXPORT_OK 永不 dispatch、
  // UI 卡 scored 且無錯誤回饋（違誠實鐵律）。此測試攔截 HTMLAnchorElement.prototype.click，在點擊當下記錄
  // document.body.contains(該錨點)：修復前錨點 detached → contains=false（RED）；修復後 appendChild 已掛載 → true。
  it("[Important-1] doExport 下載錨點在 .click() 當下已掛載於 document（跨瀏覽器安全，避免 Gecko 靜默失敗）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([
      { ifc_guid: "g1", usd_prim_path: null, rule_code: "naming", severity: "error", status: "fail", message: "naming rule failed" },
    ]);
    // 匯出成功路徑：fetch 回 ok + 真實 Blob；URL.createObjectURL/revokeObjectURL 在 jsdom 不存在 → 補 stub。
    // 用 mockImplementation 每次回「全新」Response：Response body 只能讀一次，共用同一實例會在第二次
    // res.blob() 觸發「Body has already been read」。
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Blob(["xlsx-bytes"]), { status: 200 }),
    );
    const urlCtor = globalThis.URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    urlCtor.createObjectURL = vi.fn(() => "blob:rr_a1");
    urlCtor.revokeObjectURL = vi.fn(() => {});

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // scored → 匯出鈕 enable（前置條件）。先確認再安裝 click 攔截，避免攔截影響 pick/run 按鈕點擊。
    expect(container.querySelector<HTMLButtonElement>('[data-testid="a1-step-export"]')!.disabled).toBe(false);

    // 攔截錨點 click：點擊當下記錄該錨點是否已在 document.body 內（這是 Gecko 下載可靠的前提）。
    // 注意：click() 由 HTMLElement.prototype 提供（HTMLAnchorElement 未自有此方法），須 spy 父原型才攔得到；
    // 對非下載錨點一律 call-through 原生實作，確保匯出按鈕自身的 .click() 仍正常派發 onClick。
    let attachedAtClick: boolean | null = null;
    const realClick = HTMLElement.prototype.click;
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(function (this: HTMLElement) {
        if (this instanceof HTMLAnchorElement && (this.getAttribute("download") ?? "").includes("rule-run")) {
          attachedAtClick = document.body.contains(this);
          return; // 下載錨點不實際導航（jsdom 無下載），只記錄掛載狀態
        }
        realClick.call(this); // 其餘元素（含匯出按鈕）走原生 click → 正常觸發 onClick
      });

    // 點擊匯出 → doExport 成功路徑（fetch ok → 建錨點 → click）。
    await clickByTestId("a1-step-export");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 只統計下載錨點的 click（call-through 的按鈕點擊不計入語意）。
    expect(attachedAtClick, "doExport 應觸發下載錨點 .click() 並記錄掛載狀態").not.toBeNull();
    expect(clickSpy).toHaveBeenCalled();
    // 核心：點擊當下錨點必須已掛載（修復前 detached → false → Gecko/Edge 靜默失敗）。
    expect(attachedAtClick, "下載錨點 .click() 當下必須已 appendChild 至 document.body").toBe(true);
    // 收尾：錨點不得殘留在 document（removeChild 已清理）。
    const leftover = Array.from(document.body.querySelectorAll("a")).filter((a) =>
      (a.getAttribute("download") ?? "").includes("rule-run"),
    );
    expect(leftover.length, "click 後下載錨點應自 document 移除（removeChild）").toBe(0);

    await act(async () => { root.unmount(); });
  });

  // Fix-F1：未建 Issue 時 BCF 鈕應 disabled（issuesCreated=false）。
  // scored→EXPORT_OK→delivered 不走 CREATE_ISSUES_OK → issuesCreated 仍 false → BCF disabled。
  it("[F1] scored 未建 Issue 直接匯出 Excel → delivered 後 BCF 鈕仍 disabled（issuesCreated=false）", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Blob(["xlsx-bytes"]), { status: 200 }),
    );
    const urlCtor = globalThis.URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    urlCtor.createObjectURL = vi.fn(() => "blob:rr_a1");
    urlCtor.revokeObjectURL = vi.fn(() => {});
    // 攔截錨點 .click() 避免 jsdom 導航問題（沿用 Important-1 idiom）。
    const realClick = HTMLElement.prototype.click;
    vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLAnchorElement && this.getAttribute("download")) return;
      realClick.call(this);
    });

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // scored：匯出 Excel（不建 Issue）→ EXPORT_OK → delivered。
    await clickByTestId("a1-step-export");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // delivered 但 issuesCreated=false → BCF 鈕必須 disabled（誠實：無 Issue 不可匯 BCF）。
    const bcfBtn = container.querySelector<HTMLButtonElement>('[data-testid="a1-step-bcf"]')!;
    expect(bcfBtn, "BCF 鈕應存在").not.toBeNull();
    expect(bcfBtn.disabled, "[F1] 未建 Issue 的 delivered 態 BCF 必須 disabled").toBe(true);
    // caption 也應誠實說明原因。
    expect(bcfBtn.title || bcfBtn.getAttribute("title") || container.innerHTML).toContain("需先建 Issue");

    await act(async () => { root.unmount(); });
  });

  // Fix-F4：BCF click 成功路徑 dispatch BCF_EXPORT_OK → 顯示 a1-bcf-exported-artifact。
  it("[F4] BCF click 成功 → dispatch BCF_EXPORT_OK → 顯示 a1-bcf-exported-artifact", async () => {
    vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_a1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue(fakeRunStatus("succeeded"));
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);
    vi.spyOn(governanceClient, "issuesFromRuleRun").mockResolvedValue({ created: 2, issue_ids: ["i1", "i2"] });
    vi.spyOn(governanceClient, "getIssue").mockImplementation(async (id: string): Promise<IssueRow> => ({
      id,
      kind: "issue",
      title: `issue ${id}`,
      status: "open",
      severity: "medium",
      ifc_guid: `guid-${id}`,
      usd_prim_path: null,
      source_type: "rule_result",
    }));
    // BCF fetch 成功。
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Blob(["bcf-bytes"]), { status: 200 }),
    );
    const urlCtor = globalThis.URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    urlCtor.createObjectURL = vi.fn(() => "blob:bcf");
    urlCtor.revokeObjectURL = vi.fn(() => {});
    const realClick = HTMLElement.prototype.click;
    vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLAnchorElement && this.getAttribute("download")) return;
      realClick.call(this);
    });

    const root = createRoot(container);
    await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
    await pickModel();
    await clickByTestId("a1-step-run");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // 建 Issue → issuesCreated=true → BCF enable。
    await clickByTestId("a1-step-issues");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const bcfBtn = container.querySelector<HTMLButtonElement>('[data-testid="a1-step-bcf"]')!;
    expect(bcfBtn.disabled, "建 Issue 後 BCF 應 enable").toBe(false);

    // 點 BCF → 成功 → bcfExported=true → 出現 a1-bcf-exported-artifact。
    await act(async () => { bcfBtn.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // 等 finally setBcfBusy(false) + dispatch BCF_EXPORT_OK 入 state。
    await act(async () => { await Promise.resolve(); });

    const artifact = container.querySelector('[data-testid="a1-bcf-exported-artifact"]');
    expect(artifact, "[F4] BCF 成功後應出現 a1-bcf-exported-artifact").not.toBeNull();

    await act(async () => { root.unmount(); });
  });
});

// Fix-F5：VersionDiffPage ifc_type=null 列渲染「—」（誠實 marker）。
describe("VersionDiffPage F5：ifc_type=null 渲染 '—' marker", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("[F5] ifc_type=null 的 diff 列渲染 '—'（不顯示空 cell）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("stub"));
    vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d-f5", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-f5",
      status: "succeeded",
      summary: { base_count: 1, target_count: 0, matched: 0, counts: { removed: 1 }, warnings: [] },
    });
    // old row：ifc_type=null（migration 留 NULL），確認 UI 顯示「—」而非空 cell。
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([
      { change_type: "removed", ifc_guid: "g-null-type", ifc_type: null, change_summary: "元素已移除" },
    ]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); }); // fsTree reject

    // Run Diff（用預設路徑，只看 ifc_type render 結果）。
    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    // 等 getDiff（succeeded）+ getDiffItems settle。
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const html = container.innerHTML;
    // ifc_type=null → 應顯示「—」（不留空 <td></td>）。
    expect(html, "[F5] ifc_type=null 應渲染 '—'").toContain("—");
    // 確認是那列的 ifc_guid 存在（只是驗正確列被 render 出來）。
    expect(html).toContain("g-null-type");

    await act(async () => { root.unmount(); });
  });
});

// [Important-2] FailureRuleRow「載入更多」去重/鎖（spec §5）：React 中 setLoading(true) 在同一 event
// handler 內非同步可見（須等下一 render），同 tick 雙擊「載入更多」時 loading 閉包值未刷新，兩個
// loadPage(rows.length) 並行執行、各自 [...prev, ...res.items] append → 重複行。修復前同步 loading guard
// 失效，getFailures 被呼叫 3 次（1 初始 + 2 並行 load-more）；修復後本地 loadingRef 同步擋掉第二次 → 共 2 次。
describe("FailureRuleRow 載入更多去重/鎖（spec §5：同 tick 雙擊不得並行 fetch）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  // 受控 deferred 工廠：每次 getFailures 回一個我們手動 resolve 的 promise，模擬「fetch 尚未回來」窗口，
  // 讓同 tick 第二次點擊在第一次 in-flight 時發生（這正是並行競速的觸發條件）。
  function makeDeferred() {
    let resolve!: (v: { rule_run_id: string; rule_code: string | null; limit: number; offset: number; total: number; items: unknown[] }) => void;
    const promise = new Promise<{ rule_run_id: string; rule_code: string | null; limit: number; offset: number; total: number; items: unknown[] }>((r) => { resolve = r; });
    return { promise, resolve };
  }

  it("[Important-2] 同 tick 雙擊『載入更多』→ getFailures 不得並行重複呼叫（去重/鎖）", async () => {
    // total=120、每頁 50：初始載入後 canLoadMore，且足以再點兩次。
    const page = (offset: number) => ({
      rule_run_id: "rr_a1",
      rule_code: "DOOR-FIRERATING-REQUIRED",
      limit: 50,
      offset,
      total: 120,
      items: Array.from({ length: 50 }, (_, i) => ({
        ifc_guid: `g-${offset + i}`,
        ifc_name: `door-${offset + i}`,
        ifc_type: "IfcDoor",
        storey: "1F",
        severity: "error",
        rule_code: "DOOR-FIRERATING-REQUIRED",
        message: "missing FireRating",
        usd_prim_path: null,
      })),
    });

    const deferreds: ReturnType<typeof makeDeferred>[] = [];
    const getSpy = vi.spyOn(governanceClient, "getFailures").mockImplementation((_id, _rule, _limit, offset) => {
      const d = makeDeferred();
      deferreds.push(d);
      // 立刻記住該 promise 對應的 offset，待測試手動 resolve。
      (d as unknown as { offset: number }).offset = offset ?? 0;
      return d.promise as unknown as ReturnType<typeof governanceClient.getFailures>;
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(<FailureRuleRow runId="rr_a1" ruleCode="DOOR-FIRERATING-REQUIRED" count={120} />);
    });

    // 展開 → 觸發初始 loadPage(0)（in-flight，deferred 未 resolve）。
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="a1-fail-toggle-DOOR-FIRERATING-REQUIRED"]')!;
    await act(async () => { toggle.click(); });
    // 解析初始頁 → rows=50、total=120 → 出現「載入更多」。
    await act(async () => { deferreds[0].resolve(page(0)); await Promise.resolve(); });
    expect(getSpy.mock.calls.length, "初始展開應呼叫一次 getFailures(offset=0)").toBe(1);

    const moreBtn = () => container.querySelector<HTMLButtonElement>('[data-testid="a1-fail-more-DOOR-FIRERATING-REQUIRED"]');
    expect(moreBtn(), "rows<total 時應出現載入更多").not.toBeNull();

    // 核心：同一個 act tick（同 event 批次、render 尚未 flush）內連點兩次「載入更多」。
    // 修復前：loading 閉包值未刷新、setLoading 非同步 → 第二次 guard 失效 → 並行第二次 getFailures（共 3 次）。
    // 修復後：本地同步 loadingRef 立即擋掉第二次 → 仍只 1 次 load-more（共 2 次）。
    const btn = moreBtn()!;
    await act(async () => {
      btn.click();
      btn.click();
    });

    expect(
      getSpy.mock.calls.length,
      "同 tick 雙擊載入更多只能觸發一次 getFailures（去重/鎖），不得並行重複",
    ).toBe(2);

    // 收尾：resolve 尚未完成的 load-more deferred，避免懸掛。
    await act(async () => {
      for (const d of deferreds.slice(1)) d.resolve(page((d as unknown as { offset: number }).offset));
      await Promise.resolve();
    });

    await act(async () => { root.unmount(); });
  });

  // A2-W1：三色碼驗收——diff 跑完有 items 時，表格列依 change_type 帶正確 CSS class。
  // added→ec-diff-add（綠）、removed→ec-diff-del（紅）、moved/property_changed→ec-diff-mod（黃）。
  // 色碼旁同時保留 change_type 文字（色盲可及）。
  it("A2-W1 三色碼：diff 跑完 items 依 change_type 帶正確 CSS class（色盲可及）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] });
    vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d-color", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-color",
      status: "succeeded",
      summary: { base_count: 3, target_count: 3, matched: 1, counts: { added: 1, removed: 1, moved: 1 }, warnings: [] },
    });
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue([
      { change_type: "added",   ifc_guid: "guid-a", ifc_type: "IfcBeam",  change_summary: "新增" },
      { change_type: "removed", ifc_guid: "guid-r", ifc_type: "IfcWall",  change_summary: "移除" },
      { change_type: "moved",   ifc_guid: "guid-m", ifc_type: "IfcColumn", change_summary: "位移" },
      { change_type: "property_changed", ifc_guid: "guid-p", ifc_type: "IfcDoor", change_summary: "屬性改" },
    ]);
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    // 觸發 Run Diff。
    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); }); // flush 第二次微任務（getDiffItems）

    const html = container.innerHTML;

    // 三色 class 必須存在於 HTML。
    expect(html).toContain("ec-diff-add");
    expect(html).toContain("ec-diff-del");
    expect(html).toContain("ec-diff-mod");

    // 色碼旁仍保留 change_type 文字（色盲可及，不靠顏色單一通道）。
    expect(html).toContain("added");
    expect(html).toContain("removed");
    expect(html).toContain("moved");
    expect(html).toContain("property_changed");

    // 各列 class 與 change_type 一致（parsing DOM 精確查：查第一個 <td> 完整文字，避免子字串誤命中）。
    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const byType = (ct: string) => rows.find((r) => r.querySelector("td")?.textContent === ct);
    expect(byType("added")?.className).toContain("ec-diff-add");
    expect(byType("removed")?.className).toContain("ec-diff-del");
    expect(byType("moved")?.className).toContain("ec-diff-mod");
    expect(byType("property_changed")?.className).toContain("ec-diff-mod");

    await act(async () => { root.unmount(); });
  });

  // A2-W1：截斷提示——items.length>40 時顯示「顯示前 40 筆，共 N 筆」。
  it("A2-W1 截斷提示：items>40 顯示「顯示前 40 筆，共 N 筆」", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] });
    vi.spyOn(governanceClient, "createDiff").mockResolvedValue({ diff_id: "d-trunc", status: "queued" });
    vi.spyOn(governanceClient, "getDiff").mockResolvedValue({
      diff_id: "d-trunc",
      status: "succeeded",
      summary: { base_count: 50, target_count: 50, matched: 0, counts: { added: 50 }, warnings: [] },
    });
    // 51 筆 added（超過 40）。
    vi.spyOn(governanceClient, "getDiffItems").mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        change_type: "added",
        ifc_guid: `guid-${i}`,
        ifc_type: "IfcWall",
        change_summary: `${i}`,
      })),
    );
    vi.spyOn(governanceClient, "diffIssueImpact").mockRejectedValue(new Error("選配"));

    const root = createRoot(container);
    await act(async () => { root.render(<VersionDiffPage />); });
    await act(async () => { await Promise.resolve(); });

    const runBtn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Run Diff") || b.textContent?.includes("比對中"),
    )!;
    await act(async () => { runBtn.click(); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const html = container.innerHTML;
    // 截斷提示存在。
    expect(html).toContain("顯示前 40 筆");
    expect(html).toContain("51");
    // 表格只有 40 列（.slice(0,40)）。
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(40);

    await act(async () => { root.unmount(); });
  });
});
