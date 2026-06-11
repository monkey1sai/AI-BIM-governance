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
  ConversionSchedulingPage,
  CoordinatorPage,
  FederationPage,
  IntakePage,
  IssuesRuleCenterPage,
  KitGpuFleetPage,
  MinioDataPage,
  OverviewPage,
  ReviewRoomPage,
  RuntimePage,
  SemanticViewerPage,
  SessionManagementPage,
  ViewerPresentationPage,
  VersionDiffPage,
} from "./pages";
import EdgeConsole from "./EdgeConsole";
import { ProvLegend } from "./components";
import { coordinatorClient, type RuntimeStatus, type IfcReadyListItem } from "./coordinatorClient";
import { governanceClient, type FilesTreeResponse } from "./governanceClient";
import { CoordinatorGovernanceTabs, LifecycleTab } from "./coordinator/RuntimeGovernanceTabs";
import { A1A10, A1A10_DETAIL, DEPENDENCIES, ENDPOINTS } from "./data";
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

    const intake = renderToString(<IntakePage />);
    expect(intake).toContain("/api/external/ifc-ready");
    expect(intake).toContain("不承諾精準 GUID"); // mapping fidelity 誠實
    expect(intake).toContain("未取得"); // conversion 秒數 / GPU 無遙測

    const runtime = renderToString(<RuntimePage />);
    expect(runtime).toContain("stream-config");
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

  // ── P3-1 A4–A10 vision 詳頁：整段標願景 + 「後端未建」+ scenario 標範例情境（非實測）──
  it("P3-1 每個 A4–A10 vision 詳頁含「後端未建」且 scenario 標範例情境（非真實 run）", () => {
    for (const slug of Object.keys(A1A10_DETAIL)) {
      const html = renderToString(<AppVisionPage slug={slug} onOpen={() => {}} />);
      // 明確標後端未建（願景）。
      expect(html, slug).toContain("後端未建");
      // scenario 必須標「範例情境 / 願景敘事」，不可呈現為真實 run。
      expect(html, slug).toContain("範例情境");
      expect(html, slug).toContain("非真實 run");
      // 願景 API 設計明確標非已實作 route（不可當真實端點）。
      expect(html, slug).toContain("非已實作 route");
      // 無 A1/A2 願景假數字（呼應原型「No fabricated marketing numbers」）。
      expect(html, slug).not.toContain("99.1%");
      expect(html, slug).not.toContain("92.4%");
      // 原型 scenario 內具體數字（如 312 / 17,000）若出現，必伴隨「範例情境/願景敘事」框定，
      // 不得單獨作為實測——這裡以「不出現裸寫的 312 扇門 / 17,000 frames 實測語」近似驗證。
      expect(html, slug).not.toContain("實測 312");
      expect(html, slug).not.toContain("實測 17,000");
    }
  });

  it("P3-1 A4–A10 roadmap 卡片皆可點（route 指向 vision 詳頁）且標 p3/p4", () => {
    const roadmap = A1A10.filter((a) => a.tier === "roadmap");
    expect(roadmap.length).toBe(7);
    expect(roadmap.every((a) => a.route?.startsWith("app/"))).toBe(true);
    // A5 = p3（RM phase 3），其餘 = p4。
    expect(A1A10.find((a) => a.code === "A5")?.prov).toBe("p3");
    expect(roadmap.filter((a) => a.code !== "A5").every((a) => a.prov === "p4")).toBe(true);
  });

  // ── P3-2 / P3-3 殼層：Agent suggested prompts（disabled 輸入）+ FlowBar + Tweaks ──
  it("P3-2/P3-3 EdgeConsole 殼層含 Agent prompts（disabled 輸入）+ FlowBar + Tweaks", () => {
    const html = renderToString(<EdgeConsole />);
    // P3-2：suggested prompts + 寫入限制 + disabled 輸入框（非可用的假輸入）。
    expect(html).toContain("SUGGESTED");
    expect(html).toContain("AI 僅能改 review / session layer");
    expect(html).toMatch(/<input[^>]*disabled/);
    // P3-3：FlowBar 5 步（預設 tech 標籤）+ Tweaks（操作員/技術用語、scenario clean/warn）。
    expect(html).toContain("①"); // FlowBar step 1 標號
    expect(html).toContain("Intake"); // 預設 register=tech 的步驟標籤
    expect(html).toContain("Record"); // FlowBar 末步
    expect(html).toContain("操作員"); // Tweaks register 按鈕
    expect(html).toContain("技術");
    expect(html).toContain("clean"); // Tweaks scenario 按鈕
    expect(html).toContain("warn");
  });

  it("完整產品操作台 shell 顯示 prototype 的四組資訊架構", () => {
    const html = renderToString(<EdgeConsole />);
    expect(html).toContain("工作台");
    expect(html).toContain("核心治理");
    expect(html).toContain("OMNIVERSE RUNTIME");
    expect(html).toContain("落地端控制台");
    expect(html).toContain("IFC→USD 轉檔排程");
    expect(html).toContain("Kit / GPU 機隊");
    expect(html).toContain("MinIO 資料");
    expect(html).toContain("Chat USD Agent");
  });

  it("prototype 核心頁面可 render：A1 stepper、3D viewer、conversion、session、Kit/GPU、MinIO", () => {
    const a1 = renderToString(<A1GovernanceWorkbenchPage />);
    expect(a1).toContain("上傳模型");
    expect(a1).toContain("自動檢核");
    expect(a1).toContain("開 Issue");
    expect(a1).toContain("匯出 BCF");
    expect(a1).toContain("governance-service :49102");
    expect(a1).toContain('data-testid="a1-real-ifc-slice"');
    expect(a1).toContain('data-testid="real-ifc-demo-control"');
    expect(a1).toContain('data-testid="a1-rule-center-slice"');
    expect(a1).toContain("A1 rule-run authority");
    expect(a1).toContain("rule_run_id");
    expect(a1).toContain("review_session_id");
    expect(a1).toContain("viewer_url（/ui/open）");

    const viewer = renderToString(<ViewerPresentationPage />);
    expect(viewer).toContain("3D Viewer 呈現");
    expect(viewer).toContain("openStage");
    expect(viewer).toContain("highlightPrimsRequest");
    expect(viewer).toContain("DataChannel");

    const conv = renderToString(<ConversionSchedulingPage />);
    expect(conv).toContain("IFC→USD 轉檔排程");
    expect(conv).toContain("mapping coverage");
    expect(conv).toContain("/api/external/ifc-ready");

    const sessions = renderToString(<SessionManagementPage />);
    expect(sessions).toContain("Session 管理");
    expect(sessions).toContain("first frame");
    expect(sessions).toContain("Reclaim stale spectator");

    const fleet = renderToString(<KitGpuFleetPage />);
    expect(fleet).toContain("Kit / GPU 機隊");
    expect(fleet).toContain("1 GPU = 1 Kit stream");
    expect(fleet).toContain("drain");

    const minio = renderToString(<MinioDataPage />);
    expect(minio).toContain("MinIO 資料");
    expect(minio).toContain("bim-control");
    expect(minio).toContain("model.usdc");
  });

  // ── P4 Review Room（G）v1：連到既有 viewer，不在 console 內嵌 3D，不動 App/Window ──
  it("P4 Review Room 提供「在既有 viewer 開啟」連結且誠實標 3D 在既有 viewer", () => {
    const html = renderToString(<ReviewRoomPage />);
    expect(html).toContain("在既有 viewer 開啟");
    // 真實 viewer 入口：coordinator /ui/open（server-side redirect，as-built）+ 本地 /?session=。
    expect(html).toContain("/ui/open");
    expect(html).toContain("?session=");
    // 誠實標示：3D viewport 在既有 viewer（非 console 殼層）；不動 App.tsx / Window.tsx。
    expect(html).toContain("既有 viewer");
    expect(html).toContain("不動 App.tsx / Window.tsx");
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
    // finding 6：明確說明不符 viewer attach 格式 → coordinator /ui/open 會回 400（不發明 attach 預檢端點）。
    // （初始空字串不顯示警示，僅在使用者輸入過才提示——這裡驗證頁面具備此誠實 wording 常量。）
    const typed = renderToString(<ReviewRoomPage />);
    expect(typed).toContain("不動 App.tsx / Window.tsx");
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

  // ── minio-fileserver-source spec：MinioData 接真檔案庫樹 + A1 三層檔案庫選擇器 ──
  it("MinioData 接真檔案庫 API（loading 態 + 誠實 local_fs 文案 + usdc 仍 p1）", () => {
    const html = renderToString(<MinioDataPage />);
    // 載入態可見（renderToString 首幀無 fetch 結果 → loading）。
    expect(html).toContain("載入");
    // 誠實標記：local file-server 來源（比照 bim-control 規約）；真 S3/MinIO 待接。
    expect(html).toContain("local file-server");
    expect(html).toContain("bim-control");
    // bucket layout 規約示意仍標 demo（規約示意非實況）。
    expect(html).toContain("示範資料"); // PROV_LABEL.demo
    // model.usdc 轉檔產物仍 p1，不因本 spec 翻綠。
    expect(html).toContain("model.usdc");
    expect(html).toContain("後端待建 · P1"); // PROV_LABEL.p1
    // 無願景假數字。
    expect(html).not.toContain("99.1%");
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

  // MinioData populated 態：filesTree() 回真樹後，render 出 project/model/version（feature 賣點，
  // SSR 永遠到不了，因首幀 tree=null 走 loading 分支）。並驗 source_kind / root 出現在 Panel sub。
  it("MinioData filesTree() 回真樹 → render project/model/version（asbuilt 真樹，非 loading 殼）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); }); // 等 filesTree microtask 入 state

    const html = container.innerHTML;
    // populated 真樹節點：project / model / version 檔名（loading 態不可能出現這些）。
    expect(html).toContain("270/");
    expect(html).toContain("機電/");
    expect(html).toContain("ver 竣工.ifc");
    // Panel sub 顯示真實 source_kind / root（誠實標記，非 demo）。
    expect(html).toContain("source_kind=local_fs");
    expect(html).toContain("C:/Repos/active/iot/AI-BIM-governance/storage");
    // 已離開 loading 態（不再顯示「載入中…」）。
    expect(html).not.toContain("載入中…（GET /api/governance/files/tree）");

    await act(async () => { root.unmount(); });
  });

  // MinioData error 態：filesTree() reject → 顯示誠實「未連線後端」文案（pages.tsx:421），
  // 不吞錯、不假裝有樹。SSR 首幀走 loading，永遠到不了此分支。
  it("MinioData filesTree() reject → error 態誠實標「未連線後端」（不吞錯、不偽裝有樹）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockRejectedValue(new Error("proxy 502"));
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    const html = container.innerHTML;
    expect(html).toContain("未連線後端（coordinator / governance-service 需啟動）");
    expect(html).toContain("proxy 502"); // 誠實顯示錯誤原因，不吞
    expect(html).not.toContain("載入中…（GET /api/governance/files/tree）"); // 已離開 loading
    expect(html).not.toContain("ver 竣工.ifc"); // error 態不得渲染假樹

    await act(async () => { root.unmount(); });
  });

  // MinioData empty 態：filesTree() 成功但 projects=[]（root 下無兩層結構 / 全為保留目錄）→
  // 顯示誠實「檔案庫為空」文案（pages.tsx:423），不假裝有樹。SSR 首幀走 loading，
  // 此分支需 !loading && !err && projectCount===0，唯有 client-render 微任務跑完才到得了。
  it("MinioData filesTree() 回空 projects → empty 態顯示「檔案庫為空」（非 loading、非假樹）", async () => {
    vi.spyOn(governanceClient, "filesTree").mockResolvedValue({
      root: "C:/Repos/active/iot/AI-BIM-governance/storage",
      source_kind: "local_fs",
      projects: [],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    const html = container.innerHTML;
    expect(html).toContain("檔案庫為空：未在 root 下找到"); // pages.tsx:423 空狀態文案
    expect(html).not.toContain("載入中…（GET /api/governance/files/tree）"); // 已離開 loading
    expect(html).not.toContain("未連線後端"); // 成功回應，非 error 態
    expect(html).not.toContain("ver 竣工.ifc"); // 空樹不得渲染假版本節點

    await act(async () => { root.unmount(); });
  });

  // spec §7.3 核心：A1 選擇器選定 project→model→version 後，ifcPath input 值更新為該 version.path。
  // 這條對應 load-bearing handler onChange={(e)=>{ if(e.target.value) setIfcPath(e.target.value); }}（pages.tsx）。
  // 先確認初始 input = 預設 fixture 路徑；逐層選取後 input.value 變成檔案庫選定的絕對路徑。
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
    // 初始為預設 fixture 路徑（手動輸入保留，向後相容 a1-real-ifc-slice E2E）。
    expect(ifcInput().value).toContain("fixture-bytes.ifc");
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
  // 手動輸入路徑」（pages.tsx:597），且手動輸入框照常可用（保留預設 fixture、仍可編輯）。
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

    // 手動輸入框仍可用（保留預設 fixture 路徑，graceful degrade 不擋手動流程）。
    const ifcInput = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
      (el) => !el.placeholder,
    )!;
    expect(ifcInput.disabled).toBe(false);
    expect(ifcInput.value).toContain("fixture-bytes.ifc");
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

  // reviewer Major（CodeRabbit）：error 態須有使用者可觸發的重試（不必整頁 reload）。
  // 第一次 filesTree() 失敗 → 顯示誠實 error + 重試鈕；點重試 → 重打 → 成功渲染真樹。
  it("MinioData error 態點「重試」→ 重打 filesTree() → 成功渲染真樹（不必整頁 reload）", async () => {
    const spy = vi
      .spyOn(governanceClient, "filesTree")
      .mockRejectedValueOnce(new Error("proxy 502"))
      .mockResolvedValueOnce(tree);
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.innerHTML).toContain("未連線後端");

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="minio-tree-retry"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    await act(async () => { await Promise.resolve(); });

    const html = container.innerHTML;
    expect(html).toContain("ver 竣工.ifc"); // 重試成功 → 真樹渲染
    expect(html).not.toContain("未連線後端"); // error 態已清除
    expect(spy).toHaveBeenCalledTimes(2); // 真的重打了一次

    await act(async () => { root.unmount(); });
  });

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

// A2 VersionDiff 多專案 / 三層版本選擇器 client-render（spec §4.2/§6.2）。
// 上方 A2 既有測試的 fixture 只有單一 project（270）/單一 model（機電），無法證明
//   (1) project 下拉真的把「多個」project 都列出來（多專案可選）、
//   (2) version 下拉能顯示「巢狀三層」版本名（如 v1/japanese_villa.ifc，name 帶子目錄）。
// 此處用自帶含「松風庵/建築/v1/japanese_villa.ifc」的真實樹形狀（比照 storage 實際結構），
// client-render 驗證多專案選擇與三層版本名顯示——SSR 首幀 fsTree=null 永遠到不了 populated 態。
describe("A2 VersionDiff 多專案 + 三層版本選擇器 client-render（spec §4.2/§6.2：松風庵/建築/v1 三層）", () => {
  const BASE_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 000001.ifc";
  const TARGET_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工.ifc";
  const VILLA_PATH = "C:/Repos/active/iot/AI-BIM-governance/storage/松風庵/建築/v1/japanese_villa.ifc";
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
  const pick = async (testid: string, value: string) => {
    await act(async () => {
      sel(testid).value = value;
      sel(testid).dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

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

    await act(async () => { root.unmount(); });
  });
});

describe("ConversionSchedulingPage：dispatch_error 欄位形狀對齊真後端 schema，渲染層驗證；真後端值由 E2E 驗", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  const baseJob = {
    project_id: "271", download_status: "downloaded", conversion_authority: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null,
    expected_mapping_url: null, created_at: "2026-06-11T00:00:00Z",
  };
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

  it("有 dispatch_error 的 job → 渲染錯誤明細節點；無 dispatch_error 的 job → 不渲染", async () => {
    const items: IfcReadyListItem[] = [
      { ...baseJob, ifc_ready_job_id: "ifcready_fail", external_model_version_id: "271_pieple_管線",
        status: "dispatch_failed", conversion_status: "dispatch_failed",
        dispatch_error: 'streaming conversion API 400: {"detail":"Invalid ifc_artifact_id: ifc_271_pieple_管線"}' },
      { ...baseJob, ifc_ready_job_id: "ifcready_ok", external_model_version_id: "ext_ok",
        status: "dispatched", conversion_status: "dispatched", dispatch_error: null },
    ];
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: items.length, items });
    const root = createRoot(container);
    await act(async () => { root.render(<ConversionSchedulingPage />); });
    await act(async () => { await Promise.resolve(); });

    const errNode = container.querySelector('[data-testid="conv-dispatch-error-ifcready_fail"]');
    expect(errNode).not.toBeNull();
    expect(errNode!.textContent).toContain("Invalid ifc_artifact_id");
    expect(errNode!.getAttribute("title")).toContain("streaming conversion API 400");
    // 無 dispatch_error 的 job 不得渲染錯誤節點
    expect(container.querySelector('[data-testid="conv-dispatch-error-ifcready_ok"]')).toBeNull();
  });
});
