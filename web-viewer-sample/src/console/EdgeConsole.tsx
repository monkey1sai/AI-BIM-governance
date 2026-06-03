// AI-BIM Governance Edge Console 殼層：三欄 grid + 兩段式導覽 + ChatUSD 欄（可折疊）。
// 零依賴 hash 路由（不引入 react-router、不擾動既有 App ?session bootstrap）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { PAGES } from "./data";
import {
  AppsPage,
  CoordinatorPage,
  FederationPage,
  IntakePage,
  IssuesRuleCenterPage,
  OverviewPage,
  RuntimePage,
  SemanticViewerPage,
  StubPage,
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
  switch (page) {
    case "overview": return <OverviewPage />;
    case "issues": return <IssuesRuleCenterPage />;
    case "apps": return <AppsPage onOpen={go} />;
    case "version-diff": return <VersionDiffPage />;
    case "federation": return <FederationPage />;
    case "coordinator": return <CoordinatorPage />;
    case "intake": return <IntakePage />;
    case "runtime": return <RuntimePage />;
    case "review":
      return <StubPage title="Review Room · 審查室" note="USD over WebRTC live viewport + tool rail。highlight 走 Review-Room 主動拉 → client DataChannel，不復活 server-push。" items={[["openStage / focusPrim / selectPrims / clearHighlight", "viewer DataChannel as-built", "asbuilt"], ["highlightPrims（client→runtime）", "buildHighlightPrimsRequest", "asbuilt"], ["server→viewer push highlight / 多人廣播", "retired", "p15"], ["section / snapshot", "待建", "p15"]]} />;
    case "semantic": return <SemanticViewerPage />;
    default: return <OverviewPage />;
  }
}

export default function EdgeConsole() {
  const [page, go] = usePageHash();
  const [agentOpen, setAgentOpen] = useState(true);
  const gov = PAGES.filter((p) => p.plane === "governance");
  const omni = PAGES.filter((p) => p.plane === "omniverse");

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
            <span className="ec-key">{p.no}</span>{p.label}
          </button>
        ))}
        <div className="ec-group">OMNIVERSE RUNTIME · KIT/USD/GPU</div>
        {omni.map((p) => (
          <button key={p.key} className={page === p.key ? "active" : ""} onClick={() => go(p.key)}>
            <span className="ec-key">{p.no}</span>{p.label}
          </button>
        ))}
      </nav>

      <main className="ec-main">{renderBody(page, go)}</main>

      <aside className={`ec-agent ${agentOpen ? "" : "hidden"}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong>Chat USD Agent</strong>
          <span className="ec-prov ec-p15">ROADMAP · A9</span>
        </div>
        <p className="ec-note">A9 USD Code / ChatUSD Copilot 為 Phase 4 願景；後端未建置，互動僅示意。AI 僅能改 review / session layer，不寫回 source model。</p>
      </aside>

      <footer className="ec-foot">
        <span>governance-service :49102 · coordinator proxy</span>
        <span style={{ flex: 1 }} />
        <span>as-built MVP · 無假數字</span>
      </footer>
    </div>
  );
}
