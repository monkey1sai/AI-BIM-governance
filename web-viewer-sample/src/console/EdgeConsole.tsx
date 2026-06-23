// AI-BIM Governance Edge Console 殼層：三欄 grid + 兩段式導覽 + ChatUSD 欄（可折疊）
// + FlowBar（Intake→Convert→Meeting→Mark→Record）+ Tweaks（操作員/技術用語、scenario）。
// 零依賴 hash 路由（不引入 react-router、不擾動既有 App ?session bootstrap）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { NAV_GROUPS, PAGES, Prov } from "./data";
import { t, useLang, setLang } from "./i18n";
import {
  A1GovernanceWorkbenchPage,
  AdminPage,
  AppsPage,
  AppVisionPage,
  ConversionSchedulingPage,
  CoordinatorPage,
  FederationPage,
  GpuReviewRoomPage,
  HomePage,
  IntakePage,
  IssuesRuleCenterPage,
  KitGpuFleetPage,
  MinioDataPage,
  OverviewPage,
  ReportsPage,
  ReviewRoomPage,
  RuntimePage,
  SemanticViewerPage,
  SessionManagementPage,
  SpecPage,
  ViewerPresentationPage,
  VersionDiffPage,
} from "./pages";
// operator-tool 路由保留：#/kit、#/demo-control 原由 OperatorConsole 服務；換 EdgeConsole 後仍可達（非 silently 砍）。
import { KitConsolePage } from "./KitConsolePage";
import { RealIfcConsolePage } from "./RealIfcConsolePage";

function usePageHash(): [string, (k: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?console\/?/, "").replace(/^#\/?/, "") || "home";
  const [page, setPage] = useState(read);
  useEffect(() => {
    const on = () => setPage(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (k: string) => {
    window.location.hash = k;
    setPage(k);
  };
  return [page, go];
}

function renderBody(page: string, go: (k: string) => void) {
  // app/<slug> → A4–A10 vision 詳頁（P3-1）。
  if (page.startsWith("app/")) return <AppVisionPage slug={page.slice(4)} onOpen={go} />;
  switch (page) {
    case "home": return <HomePage onOpen={go} />;
    case "a1": return <A1GovernanceWorkbenchPage />;
    case "a2": return <VersionDiffPage />;
    case "a3": return <FederationPage />;
    case "a4": return <AppVisionPage slug="ai-search" onOpen={go} />;
    case "a5": return <AppVisionPage slug="iot-fm" onOpen={go} />;
    case "a6": return <AppVisionPage slug="4d-5d" onOpen={go} />;
    case "a7": return <AppVisionPage slug="reality-capture" onOpen={go} />;
    case "a8": return <AppVisionPage slug="synthetic-data" onOpen={go} />;
    case "a9": return <AppVisionPage slug="usd-copilot" onOpen={go} />;
    case "a10": return <AppVisionPage slug="robot-sim" onOpen={go} />;
    case "viewer": return <ViewerPresentationPage />;
    case "gpu": return <GpuReviewRoomPage />;
    case "conv": return <ConversionSchedulingPage />;
    case "sessions": return <SessionManagementPage />;
    case "instances": return <KitGpuFleetPage />;
    case "minio": return <MinioDataPage />;
    case "reports": return <ReportsPage />;
    case "admin": return <AdminPage />;
    case "spec": return <SpecPage />;
    case "overview": return <OverviewPage />;
    case "issues": return <IssuesRuleCenterPage />;
    case "apps": return <AppsPage onOpen={go} />;
    case "version-diff": return <VersionDiffPage />;
    case "federation": return <FederationPage />;
    case "coordinator": return <CoordinatorPage />;
    case "intake": return <IntakePage />;
    case "runtime": return <RuntimePage />;
    case "review": return <ReviewRoomPage />;
    case "semantic": return <SemanticViewerPage />;
    case "kit": return <KitConsolePage />;
    case "demo-control": return <RealIfcConsolePage />;
    default: return <HomePage onOpen={go} />;
  }
}

// 用語對照（操作員 biz ↔ 技術 tech）。register=biz 顯示業務語、tech 顯示技術語。
const NAV_LABEL: Record<string, { tech: string; biz: string }> = {
  home: { tech: "Today", biz: "今天要做什麼" },
  a1: { tech: "A1 Governance", biz: "治理與模型檢核" },
  a2: { tech: "A2 Version Diff", biz: "版本差異與責任" },
  a3: { tech: "A3 Federation", biz: "跨專業疊合" },
  a4: { tech: "A4 Semantic Search", biz: "語意搜尋問答" },
  a5: { tech: "A5 IoT/FM", biz: "IoT / FM 數位分身" },
  a6: { tech: "A6 4D/5D", biz: "4D / 5D 施工模擬" },
  a7: { tech: "A7 Reality Capture", biz: "Reality Capture 比對" },
  a8: { tech: "A8 Synthetic Data", biz: "Synthetic Data" },
  a9: { tech: "A9 ChatUSD", biz: "設計 / 審查 Copilot" },
  a10: { tech: "A10 Robot Sim", biz: "機器人 / 巡檢模擬" },
  viewer: { tech: "3D Viewer", biz: "3D Viewer 呈現" },
  gpu: { tech: "GPU Review Room", biz: "GPU 審查室" },
  conv: { tech: "Conversion Queue", biz: "IFC→USD 轉檔排程" },
  sessions: { tech: "Session ATC", biz: "Session 管理" },
  instances: { tech: "Kit/GPU Fleet", biz: "Kit / GPU 機隊" },
  minio: { tech: "MinIO Data", biz: "MinIO 資料" },
  reports: { tech: "Reports", biz: "報表中心" },
  admin: { tech: "Admin", biz: "系統管理" },
  spec: { tech: "Design Spec", biz: "設計規格說明" },
  overview: { tech: "Overview", biz: "總覽" },
  coordinator: { tech: "Coordinator Console", biz: "審查控制台" },
  intake: { tech: "Model Intake", biz: "建模接收與轉換" },
  issues: { tech: "Issues · Rule Center", biz: "問題與語意驗收" },
  apps: { tech: "Applications · A1–A10", biz: "應用導引 · A1–A10" },
  runtime: { tech: "Runtime Dashboard", biz: "串流執行狀態" },
  review: { tech: "Review Room", biz: "審查室" },
  semantic: { tech: "Semantic Viewer", biz: "語意檢核" },
};

const COPILOT_PROMPTS: Record<string, string[]> = {
  home: ["這個專案現在卡在哪？", "幫我列今天最該處理的 3 件事", "v07 送審前還缺什麼？"],
  a1: ["找出所有 FireDoor 但 FireRating 為空的構件", "把 Critical issue 的構件高亮為紅色", "列出 Mapping coverage < 95% 的子系統"],
  a2: ["v07 比 v06 改了什麼？", "哪些變更會影響成本？", "上一版的 issue 修掉了嗎？"],
  a4: ["三樓所有沒填防火時效的防火門", "體積最大的 10 個房間", "屬於 L2 但分類碼空白的構件"],
  a5: ["現在哪個區域溫度異常？", "列出逾期未處理的維保工單", "B1 機房本月用電趨勢"],
  conv: ["哪些轉檔任務卡住或失敗了？", "把 988 的模型插隊優先轉", "列出 coverage < 95% 的任務"],
  sessions: ["哪個 session 有 viewer 收不到 frame？", "把閒置超過 15 分鐘的 session 回收", "S-270 現在幾個人在看？"],
  instances: ["哪台 GPU 還能接新 session？", "把新審查排到最閒的節點", "edge-gpu-02 的 VRAM 還夠嗎？"],
  minio: ["270 專案有幾個模型？", "哪些模型還沒轉成 USD？", "model.ifc 最大的是哪一個？"],
};

// FlowBar（P3-3）：5 步操作員心智模型 Intake→Convert→Meeting→Mark→Record。
// state 為各步真實落地狀態（asbuilt / p15）；非資料宣稱，純流程示意。
const FLOW: { n: string; tech: string; biz: string; state: Prov; page: string }[] = [
  { n: "①", tech: "Intake", biz: "接收建模來源", state: "asbuilt", page: "intake" },
  { n: "②", tech: "Convert", biz: "自動轉換 3D", state: "asbuilt", page: "intake" },
  { n: "③", tech: "Meeting", biz: "建立審查會議", state: "asbuilt", page: "coordinator" },
  { n: "④", tech: "Mark", biz: "標記問題位置", state: "p15", page: "review" },
  { n: "⑤", tech: "Record", biz: "紀錄回寫雲端", state: "asbuilt", page: "coordinator" },
];

function FlowBar({ active, register, go }: { active: string; register: "tech" | "biz"; go: (k: string) => void }) {
  return (
    <div className="ec-flow">
      {FLOW.map((f, i) => (
        <span key={f.tech} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            className={`ec-flow-step ${active === f.page ? "active" : ""} ${f.state === "p15" ? "p15" : ""}`}
            onClick={() => go(f.page)}
            title={f.state === "p15" ? "Mark（3D 高亮）為 P1.5 待建" : "as-built"}
          >
            <span className="ec-flow-n">{f.n}</span>{register === "biz" ? f.biz : f.tech}
          </button>
          {i < FLOW.length - 1 && <span className="ec-flow-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

export default function EdgeConsole() {
  const [page, go] = usePageHash();
  const [agentOpen, setAgentOpen] = useState(true);
  // Tweaks（P3-3）：register=操作員/技術用語；scenario=clean/warn（UI 偏好；真實頁一律用 live API）。
  const [register, setRegister] = useState<"tech" | "biz">("tech");
  const [scenario, setScenario] = useState<"clean" | "warn">("clean");
  // 亮/暗主題（DS .theme-docs；persist localStorage，預設暗色——操作員 console 暗色為主）。
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("aibim:ec-theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => { try { localStorage.setItem("aibim:ec-theme", theme); } catch { /* ignore */ } }, [theme]);
  const lang = useLang();
  // EN 時 nav / FlowBar 複用既有「技術」英文標籤（register/lang 雙軸不打架）。
  const navText = (key: string, fallback: string) => {
    const reg = lang === "en" ? "tech" : register;
    return NAV_LABEL[key] ? NAV_LABEL[key][reg] : fallback;
  };
  const flowActive = page.startsWith("app/") ? "apps" : page;
  const prompts = COPILOT_PROMPTS[flowActive] ?? COPILOT_PROMPTS.home;

  return (
    <div className={`ec-root ${agentOpen ? "" : "ec-agent-collapsed"} ${theme === "light" ? "theme-light" : ""}`}>
      <header className="ec-top">
        <span className="ec-brand">AI · BIM Governance</span>
        <span className="ec-sub">EDGE CONSOLE · COORDINATOR 8004</span>
        <span className="ec-spacer" />
        <div className="ec-chips">
          <span className="ec-prov ec-asbuilt">COORD :8004</span>
          <span className="ec-prov ec-asbuilt">GOV :49102</span>
          <span className="ec-prov ec-demo">GPU · 依 session 派發</span>
        </div>
        <button className="ec-btn" onClick={() => setLang(lang === "en" ? "zh" : "en")} title="切換語言 / Language" aria-label="切換語言 Language">{lang === "en" ? "中" : "EN"}</button>
        <button className="ec-btn" onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} title="切換亮 / 暗主題 / Theme" aria-label="切換亮暗主題">{theme === "light" ? "☾ 暗" : "☀ 亮"}</button>
        <button className="ec-btn" onClick={() => setAgentOpen((v) => !v)}>{agentOpen ? "⟩ Agent" : "⟨ Agent"}</button>
      </header>

      <nav className="ec-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.key}>
            <div className="ec-group">{group.title}<span>{group.sub}</span></div>
            {PAGES.filter((p) => p.group === group.key).map((p) => (
              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={p.label} onClick={() => go(p.key)}>
                <span className="ec-key">{p.no}</span>
                <span>{navText(p.key, p.label)}</span>
                {p.badge && <span className="ec-nav-badge">{p.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <main className="ec-main">
        <div className="ec-mainhead">
          <FlowBar active={flowActive} register={lang === "en" ? "tech" : register} go={go} />
          <span className="ec-spacer" />
          {/* Tweaks（P3-3）：操作員/技術用語切換、scenario clean/warn（UI 偏好，不改真實資料）。 */}
          <div className="ec-tweaks">
            <span className="ec-tw-group">
              <span className="ec-tw-lab">{t("用語", "Register")}</span>
              <button className={register === "biz" ? "on" : ""} onClick={() => setRegister("biz")}>{t("操作員", "Operator")}</button>
              <button className={register === "tech" ? "on" : ""} onClick={() => setRegister("tech")}>{t("技術", "Tech")}</button>
            </span>
            <span className="ec-tw-group">
              <span className="ec-tw-lab">{t("情境", "Scenario")}</span>
              <button className={scenario === "clean" ? "on" : ""} onClick={() => setScenario("clean")} title="UI 偏好；真實頁一律以 live API 為準">clean</button>
              <button className={scenario === "warn" ? "on" : ""} onClick={() => setScenario("warn")} title="UI 偏好；真實頁一律以 live API 為準">warn</button>
            </span>
          </div>
        </div>
        {renderBody(page, go)}
      </main>

      <aside className={`ec-agent ${agentOpen ? "" : "hidden"}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Chat USD Agent</strong>
          <span className="ec-prov ec-p4">ROADMAP · A9</span>
        </div>
        <p className="ec-note">{t("A9 USD Code / ChatUSD Copilot 為 Phase 4 願景；本欄先顯示 page-aware prompts 與 tool trace 版型，狀態改動需人工確認與 audit。", "A9 USD Code / ChatUSD Copilot is a Phase 4 vision; this rail previews page-aware prompts and tool-trace layout. State changes require human confirmation and audit.")}</p>
        <div className="ec-prompts">
          <b>{t("SUGGESTED · USD-AWARE（PREVIEW · 後端未建）", "SUGGESTED · USD-AWARE (PREVIEW · backend not built)")}</b>
          {prompts.map((prompt) => <div className="ec-prompt" key={prompt}>{prompt}</div>)}
        </div>
        <div className="ec-toolcall">
          <div><span className="ec-dot g" /> kit_mcp.search_prims <span className="ec-s">preview</span></div>
          <p className="ec-note">{t("tool trace 僅作透明化版型；真正 MCP/NeMo 執行尚未接入。", "Tool trace is a transparency layout only; real MCP/NeMo execution is not yet wired.")}</p>
        </div>
        <p className="ec-warn-note">{t("寫入限制（規格）：AI 僅能改 review / session layer，不寫回 source model。", "Write constraint (spec): AI may only modify the review / session layer, never the source model.")}</p>
        <div className="ec-agent-input">
          <span>›</span>
          <input placeholder={t("ChatUSD 助理 · 後端待建（A9 · Phase 4）", "ChatUSD assistant · backend not built (A9 · Phase 4)")} disabled />
        </div>
      </aside>

      <footer className="ec-foot">
        <span>governance-service :49102 · coordinator proxy</span>
        <span style={{ flex: 1 }} />
        <span>{t("as-built MVP · 無假數字", "as-built MVP · no fake data")}</span>
      </footer>
    </div>
  );
}
