// AI-BIM Governance Edge Console 殼層：三欄 grid + 兩段式導覽 + ChatUSD 欄（可折疊）
// + FlowBar（Intake→Convert→Meeting→Mark→Record）+ Tweaks（操作員/技術用語、scenario）。
// 零依賴 hash 路由（不引入 react-router、不擾動既有 App ?session bootstrap）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { PAGES, Prov } from "./data";
import {
  AppsPage,
  AppVisionPage,
  CoordinatorPage,
  FederationPage,
  IntakePage,
  IssuesRuleCenterPage,
  OverviewPage,
  ReviewRoomPage,
  RuntimePage,
  SemanticViewerPage,
  VersionDiffPage,
} from "./pages";

function usePageHash(): [string, (k: string) => void] {
  const read = () => window.location.hash.replace(/^#/, "") || "overview";
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
    default: return <OverviewPage />;
  }
}

// 用語對照（操作員 biz ↔ 技術 tech）。register=biz 顯示業務語、tech 顯示技術語。
const NAV_LABEL: Record<string, { tech: string; biz: string }> = {
  overview: { tech: "Overview", biz: "總覽" },
  coordinator: { tech: "Coordinator Console", biz: "審查控制台" },
  intake: { tech: "Model Intake", biz: "建模接收與轉換" },
  issues: { tech: "Issues · Rule Center", biz: "問題與語意驗收" },
  apps: { tech: "Applications · A1–A10", biz: "應用導引 · A1–A10" },
  runtime: { tech: "Runtime Dashboard", biz: "串流執行狀態" },
  review: { tech: "Review Room", biz: "審查室" },
  semantic: { tech: "Semantic Viewer", biz: "語意檢核" },
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
  const gov = PAGES.filter((p) => p.plane === "governance");
  const omni = PAGES.filter((p) => p.plane === "omniverse");
  const navText = (key: string, fallback: string) => (NAV_LABEL[key] ? NAV_LABEL[key][register] : fallback);
  const flowActive = page.startsWith("app/") ? "apps" : page;

  return (
    <div className={`ec-root ${agentOpen ? "" : "ec-agent-collapsed"}`}>
      <header className="ec-top">
        <span className="ec-brand">AI · BIM Governance</span>
        <span className="ec-sub">EDGE CONSOLE · COORDINATOR 8004</span>
        <span className="ec-spacer" />
        <div className="ec-chips">
          <span className="ec-prov ec-asbuilt">COORD :8004</span>
          <span className="ec-prov ec-asbuilt">GOV :49102</span>
          <span className="ec-prov ec-demo">GPU 未取得</span>
        </div>
        <button className="ec-btn" onClick={() => setAgentOpen((v) => !v)}>{agentOpen ? "⟩ Agent" : "⟨ Agent"}</button>
      </header>

      <nav className="ec-nav">
        <div className="ec-group">GOVERNANCE PLATFORM · 零 GPU</div>
        {gov.map((p) => (
          <button key={p.key} className={page === p.key ? "active" : ""} onClick={() => go(p.key)}>
            <span className="ec-key">{p.no}</span>{navText(p.key, p.label)}
          </button>
        ))}
        <div className="ec-group">OMNIVERSE RUNTIME · KIT/USD/GPU</div>
        {omni.map((p) => (
          <button key={p.key} className={page === p.key ? "active" : ""} onClick={() => go(p.key)}>
            <span className="ec-key">{p.no}</span>{navText(p.key, p.label)}
          </button>
        ))}
      </nav>

      <main className="ec-main">
        <div className="ec-mainhead">
          <FlowBar active={flowActive} register={register} go={go} />
          <span className="ec-spacer" />
          {/* Tweaks（P3-3）：操作員/技術用語切換、scenario clean/warn（UI 偏好，不改真實資料）。 */}
          <div className="ec-tweaks">
            <span className="ec-tw-group">
              <span className="ec-tw-lab">用語</span>
              <button className={register === "biz" ? "on" : ""} onClick={() => setRegister("biz")}>操作員</button>
              <button className={register === "tech" ? "on" : ""} onClick={() => setRegister("tech")}>技術</button>
            </span>
            <span className="ec-tw-group">
              <span className="ec-tw-lab">情境</span>
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
        <p className="ec-note">A9 USD Code / ChatUSD Copilot 為 Phase 4 願景；後端（usd-code microservice）未建置，互動僅示意。</p>
        {/* P3-2：suggested prompts（disabled，僅示意）+ 寫入限制聲明 + disabled 輸入框。 */}
        <div className="ec-prompts">
          <b>SUGGESTED · USD-AWARE（PREVIEW · 後端未建）</b>
          <div className="ec-prompt">找出所有沒有 FireRating 的防火門</div>
          <div className="ec-prompt">把語意未對映的構件標出來</div>
          <div className="ec-prompt">列出 coverage &lt; 95% 的子系統</div>
        </div>
        <p className="ec-warn-note">寫入限制（規格）：AI 僅能改 review / session layer，不寫回 source model。</p>
        <div className="ec-agent-input">
          <span>›</span>
          <input placeholder="ChatUSD 助理 · 後端待建（A9 · Phase 4）" disabled />
        </div>
      </aside>

      <footer className="ec-foot">
        <span>governance-service :49102 · coordinator proxy</span>
        <span style={{ flex: 1 }} />
        <span>as-built MVP · 無假數字</span>
      </footer>
    </div>
  );
}
