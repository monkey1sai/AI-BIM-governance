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
  CoordinatorPage,
  FederationPage,
  GpuReviewRoomPage,
  HomePage,
  IssuesRuleCenterPage,
  KitGpuFleetPage,
  OverviewPage,
  ReportsPage,
  ReviewRoomPage,
  SemanticViewerPage,
  SessionManagementPage,
  SpecPage,
  ViewerPresentationPage,
  VersionDiffPage,
} from "./pages";
import { A4SemanticSearchPage } from "./A4SemanticSearchPage";
// MD 三頁合一（Task 6/7/9）：#minio 改由單一 ModelDataPage 承接（原 ConversionSchedulingPage / IntakePage /
// MinioDataPage 三頁合併）。舊三頁本體已於 Task 9 自 pages.tsx 移除。
import { ModelDataPage } from "./modelData/ModelDataPage";
// operator-tool 路由保留：#/kit、#/demo-control 原由 OperatorConsole 服務；換 EdgeConsole 後仍可達（非 silently 砍）。
import { KitConsolePage } from "./KitConsolePage";
import { RealIfcConsolePage } from "./RealIfcConsolePage";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { SharedStatusRail } from "./SharedStatusRail";
import type { AxisKey } from "./handoff";

function usePageHash(): [string, (k: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?console\/?/, "").replace(/^#\/?/, "").split("?")[0] || "home";
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

// URL 重寫式 alias（spec §5，repo 第一個）：舊 #conv / #intake deep link 一律重導到合一後的 #minio。
// 只能在 useEffect 內做（renderToString 純渲染不觸發 → SSR 不導航，避免 hydration 前搶跑）；
// window.location.replace 不留 history 污染，並保留原 hash 的 query（如 job_id）供接收端重驗。
function AliasRedirect({ to }: { to: string }) {
  useEffect(() => {
    const raw = window.location.hash;
    const q = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
    window.location.replace(`#${to}${q}`); // replace：不留 history 污染
  }, [to]);
  return null;
}

function renderBody(page: string, go: (k: string) => void) {
  // app/<slug> → vision 詳頁；#app/ai-search 舊 deep link 轉到 live #a4。
  if (page === "app/ai-search") return <AliasRedirect to="a4" />;
  if (page.startsWith("app/")) return <AppVisionPage slug={page.slice(4)} onOpen={go} />;
  switch (page) {
    case "home": return <HomePage onOpen={go} />;
    case "a1": return <A1GovernanceWorkbenchPage />;
    case "a2": return <VersionDiffPage />;
    case "a3": return <FederationPage />;
    case "a4": return <A4SemanticSearchPage />;
    case "a5": return <AppVisionPage slug="iot-fm" onOpen={go} />;
    case "a6": return <AppVisionPage slug="4d-5d" onOpen={go} />;
    case "a7": return <AppVisionPage slug="reality-capture" onOpen={go} />;
    case "a8": return <AppVisionPage slug="synthetic-data" onOpen={go} />;
    case "a9": return <AppVisionPage slug="robot-sim" onOpen={go} />;
    case "a10": return <AppVisionPage slug="ai-decision" onOpen={go} />;
    case "viewer": return <ViewerPresentationPage />;
    case "gpu": return <GpuReviewRoomPage />;
    // MD 合一（Task 7）：舊 #conv（轉檔排程）/ #intake（進件）deep link 重導到 #minio；#minio 掛 ModelDataPage。
    case "conv": case "intake": return <AliasRedirect to="minio" />;
    case "sessions": return <SessionManagementPage />;
    case "instances": return <KitGpuFleetPage />;
    case "minio": return <ModelDataPage />;
    case "reports": return <ReportsPage />;
    case "admin": return <AdminPage />;
    case "spec": return <SpecPage />;
    case "overview": return <OverviewPage />;
    case "issues": return <IssuesRuleCenterPage />;
    case "apps": return <AppsPage onOpen={go} />;
    case "version-diff": return <VersionDiffPage />;
    case "federation": return <FederationPage />;
    case "coordinator": return <CoordinatorPage />;
    case "runtime": return <CoordinatorPage />;
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
  a4: { tech: "A4 Semantic Search", biz: "語意查詢與證據" },
  a5: { tech: "A5 IoT/FM", biz: "IoT / FM 數位分身" },
  a6: { tech: "A6 4D/5D", biz: "4D / 5D 施工模擬" },
  a7: { tech: "A7 Reality Capture", biz: "Reality Capture 比對" },
  a8: { tech: "A8 Synthetic Data", biz: "Synthetic Data" },
  a9: { tech: "A9 Robot Inspection", biz: "機器人 / 自主巡檢" },
  a10: { tech: "A10 AI Decision", biz: "其他應用 / AI 決策" },
  viewer: { tech: "3D Viewer", biz: "3D Viewer 呈現" },
  gpu: { tech: "GPU Review Room", biz: "GPU 審查室" },
  conv: { tech: "Conversion Queue", biz: "IFC→USD 轉檔排程" },
  sessions: { tech: "Session ATC", biz: "Session 管理" },
  instances: { tech: "Kit/GPU Fleet", biz: "Kit / GPU 機隊" },
  minio: { tech: "Model Data & Conversion", biz: "模型資料與轉檔" },
  reports: { tech: "Reports", biz: "報表中心" },
  admin: { tech: "Admin", biz: "系統管理" },
  spec: { tech: "Design Spec", biz: "設計規格說明" },
  overview: { tech: "Overview", biz: "總覽" },
  coordinator: { tech: "Coordinator Console", biz: "審查控制台" },
  intake: { tech: "Model Intake", biz: "建模接收與轉換" },
  issues: { tech: "Issues · Rule Center", biz: "問題與語意驗收" },
  apps: { tech: "Applications · A1–A10", biz: "應用導引 · A1–A10" },
  runtime: { tech: "Runtime Console", biz: "Runtime 觀測值班台" },
  review: { tech: "Review Room", biz: "審查室" },
  semantic: { tech: "Semantic Viewer", biz: "語意檢核" },
};

const COPILOT_PROMPTS: Record<string, string[]> = {
  home: ["這個專案現在卡在哪？", "幫我列今天最該處理的 3 件事", "v07 送審前還缺什麼？"],
  a1: ["找出所有 FireDoor 但 FireRating 為空的構件", "把 Critical issue 的構件高亮為紅色", "列出 Mapping coverage < 95% 的子系統"],
  a2: ["v07 比 v06 改了什麼？", "哪些變更會影響成本？", "上一版的 issue 修掉了嗎？"],
  a4: ["三樓所有沒填防火時效的防火門", "體積最大的 10 個房間", "屬於 L2 但分類碼空白的構件"],
  a5: ["現在哪個區域溫度異常？", "列出逾期未處理的維保工單", "B1 機房本月用電趨勢"],
  sessions: ["哪個 session 有 viewer 收不到 frame？", "把閒置超過 15 分鐘的 session 回收", "S-270 現在幾個人在看？"],
  instances: ["哪台 GPU 還能接新 session？", "把新審查排到最閒的節點", "edge-gpu-02 的 VRAM 還夠嗎？"],
  // MD 合一（Task 7）：原 conv（轉檔佇列）三條 prompts 併入 minio 陣列，刪 conv key（#conv 已 alias 至 #minio）。
  minio: ["270 專案有幾個模型？", "哪些模型還沒轉成 USD？", "model.ifc 最大的是哪一個？", "哪些轉檔任務卡住或失敗了？", "把 988 的模型插隊優先轉", "列出 coverage < 95% 的任務"],
};

// FlowBar（P3-3）：5 步操作員心智模型 Intake→Convert→Meeting→Mark→Record。
// state 為各步真實落地狀態（asbuilt / p15）；非資料宣稱，純流程示意。
const FLOW: { n: string; tech: string; biz: string; state: Prov; page: string }[] = [
  { n: "①", tech: "Intake", biz: "接收建模來源", state: "asbuilt", page: "minio" },
  { n: "②", tech: "Convert", biz: "自動轉換 3D", state: "asbuilt", page: "minio" },
  { n: "③", tech: "Meeting", biz: "建立審查會議", state: "asbuilt", page: "runtime" },
  { n: "④", tech: "Mark", biz: "標記問題位置", state: "p15", page: "review" },
  { n: "⑤", tech: "Record", biz: "紀錄回寫雲端", state: "asbuilt", page: "runtime" },
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
  // Tweaks（P3-3）：scenario=clean/warn（UI 偏好；真實頁一律用 live API）。語言由頂列 LangToggle 控制（中=biz 中文 / EN=tech 英文）。
  const [scenario, setScenario] = useState<"clean" | "warn">("clean");
  // 亮/暗主題（DS .theme-docs；persist localStorage，預設暗色——操作員 console 暗色為主）。
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem("aibim:ec-theme") === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => { try { localStorage.setItem("aibim:ec-theme", theme); } catch { /* ignore */ } }, [theme]);
  const lang = useLang();
  // 語言完全決定 nav / FlowBar 標籤：中=biz 中文、EN=tech 英文（已移除與 register 的耦合）。
  const navText = (key: string, fallback: string) => {
    const reg = lang === "en" ? "tech" : "biz";
    return NAV_LABEL[key] ? NAV_LABEL[key][reg] : fallback;
  };
  const flowActive = page.startsWith("app/") ? "apps" : page;
  const prompts = COPILOT_PROMPTS[flowActive] ?? COPILOT_PROMPTS.home;
  // 七軸共享狀態列（spec §5.3）：把目前頁面對映到 AxisKey，供 SharedStatusRail 高亮脈絡；
  // #gpu/#review（Review Room 兩個入口）沒有自己的 AxisKey，歸類到 runtime（RT 供應 ready 狀態）；
  // 其餘非七軸頁（home/a2/admin…）預設回 a1（治理優先頁），不新增第八個 axis。
  const AXIS_SET: readonly AxisKey[] = ["a1", "conv", "sessions", "instances", "minio", "intake", "runtime"];
  // MD 合一（Task 7）：#conv / #intake 已 alias 至 #minio，其 axis 脈絡歸到 minio（合一後的模型資料與轉檔頁）。
  // AXIS_SET 陣列與 AxisKey 七軸型別不變；僅以 effectivePage 決定高亮的軸。
  const effectivePage = page === "conv" || page === "intake" ? "minio" : page;
  const railAxis: AxisKey = (AXIS_SET as readonly string[]).includes(effectivePage) ? (effectivePage as AxisKey)
    : effectivePage === "gpu" || effectivePage === "review" ? "runtime" : "a1";

  return (
    <SharedStatusProvider>
    <div className={`ec-root ${agentOpen ? "" : "ec-agent-collapsed"} ${theme === "light" ? "theme-light" : ""}`}>
      <header className="ec-top">
        <span className="ec-brand"><span className="ec-brand-mark">BG</span>AI · BIM Governance</span>
        <span className="ec-sub">EDGE CONSOLE · COORDINATOR 8004</span>
        <span className="ec-spacer" />
        <div className="ec-chips">
          <span className="ec-prov ec-asbuilt">COORD :8004</span>
          <span className="ec-prov ec-asbuilt">GOV :49102</span>
          <span className="ec-prov ec-demo">GPU · 依 session 派發</span>
        </div>
        <span className="ec-langtoggle" role="group" aria-label="切換語言 / Language">
          <button className={lang === "zh" ? "on" : ""} aria-pressed={lang === "zh"} onClick={() => setLang("zh")}>中</button>
          <button className={lang === "en" ? "on" : ""} aria-pressed={lang === "en"} onClick={() => setLang("en")}>EN</button>
        </span>
        <button className="ec-btn" onClick={() => setTheme((th) => (th === "light" ? "dark" : "light"))} title="切換亮 / 暗主題 / Theme" aria-label="切換亮暗主題">{theme === "light" ? "☾ 暗" : "☀ 亮"}</button>
        <button className="ec-btn" onClick={() => setAgentOpen((v) => !v)}>{agentOpen ? "⟩ Agent" : "⟨ Agent"}</button>
      </header>

      <nav className="ec-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="ec-nav-group" data-group={group.key}>
            <div className="ec-group">
              <span className="ec-group-t"><span className={`ec-gdot ${group.dot}`} />{group.title}</span>
              <span>{group.sub}</span>
            </div>
            {PAGES.filter((p) => p.group === group.key).map((p) => (
              <button key={p.key} className={page === p.key ? "active" : ""} data-plane={p.plane} title={navText(p.key, p.label)} onClick={() => go(p.key)}>
                <span className="ec-key">{p.no}</span>
                <span>{navText(p.key, p.label)}</span>
                {p.badge && <span className={`ec-nav-badge ${p.badgeTone ?? ""}`}>{p.badge}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="ec-nav-boundary">{t("雲地邊界 · Governance host-native (0 GPU) ↔ Omniverse Runtime (GPU)", "Cloud–edge boundary · Governance host-native (0 GPU) ↔ Omniverse Runtime (GPU)")}</div>
      </nav>

      <main className="ec-main">
        <div className="ec-mainhead">
          <FlowBar active={flowActive} register={lang === "en" ? "tech" : "biz"} go={go} />
          <SharedStatusRail activeAxis={railAxis} />
          <span className="ec-spacer" />
          {/* Tweaks（P3-3）：scenario clean/warn（UI 偏好，不改真實資料）。語言切換移至頂列 LangToggle（中/EN）。 */}
          <div className="ec-tweaks">
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
          <span className="ec-prov ec-p4">ROADMAP · A10</span>
        </div>
        <p className="ec-note">{t("A10 USD Code / ChatUSD Copilot 為 Phase 4 願景；本欄先顯示 page-aware prompts 與 tool trace 版型，狀態改動需人工確認與 audit。", "A10 USD Code / ChatUSD Copilot is a Phase 4 vision; this rail previews page-aware prompts and tool-trace layout. State changes require human confirmation and audit.")}</p>
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
          <input placeholder={t("ChatUSD 助理 · 後端待建（A10 · Phase 4）", "ChatUSD assistant · backend not built (A10 · Phase 4)")} disabled />
        </div>
      </aside>

      <footer className="ec-foot">
        <span>governance-service :49102 · coordinator proxy</span>
        <span style={{ flex: 1 }} />
        <span>{t("as-built MVP · 無假數字", "as-built MVP · no fake data")}</span>
      </footer>
    </div>
    </SharedStatusProvider>
  );
}
