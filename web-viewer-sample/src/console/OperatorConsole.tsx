// web-viewer-sample/src/console/OperatorConsole.tsx
// 三個獨立 operator 頁（非 viewer overlay）：/console/coordinator|intake|runtime。
// 沿用既有零依賴 hash 路由。SHALL NOT 混入 A1–A10 治理 overlay（A1–A10 只疊在 primary viewer）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { CoordinatorPage, RuntimePage } from "./pages";
import { IntakeSelectPage } from "./IntakeSelectPage";

export type OperatorPage = "coordinator" | "intake" | "runtime";

function readPage(): OperatorPage {
  const h = window.location.hash.replace(/^#\/?console\/?/, "").replace(/^#/, "");
  if (h === "intake") return "intake";
  if (h === "runtime") return "runtime";
  return "coordinator";
}

// 純 body（便於測試，不依賴 window.location）。
export function OperatorBody({ page }: { page: OperatorPage }) {
  if (page === "intake") return <IntakeSelectPage />;
  if (page === "runtime") return <RuntimePage />;
  return <CoordinatorPage />;
}

const NAV: { key: OperatorPage; label: string }[] = [
  { key: "coordinator", label: "Coordinator 控制台" },
  { key: "intake", label: "模型進件（A1）" },
  { key: "runtime", label: "Runtime 狀態" },
];

export default function OperatorConsole() {
  const [page, setPage] = useState<OperatorPage>(readPage);
  useEffect(() => {
    const on = () => setPage(readPage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (k: OperatorPage) => { window.location.hash = `/console/${k}`; setPage(k); };

  return (
    <div className="ec-root">
      <header className="ec-top">
        <span className="ec-brand">AI · BIM Governance</span>
        <span className="ec-sub">OPERATOR CONSOLE · COORDINATOR 8004</span>
      </header>
      <nav className="ec-nav">
        <div className="ec-group">OPERATOR</div>
        {NAV.map((n) => (
          <button key={n.key} className={page === n.key ? "active" : ""} onClick={() => go(n.key)}>{n.label}</button>
        ))}
      </nav>
      <main className="ec-main"><OperatorBody page={page} /></main>
      <footer className="ec-foot"><span>operator 頁不含 A1–A10 治理 overlay · 治理只疊在 primary viewer</span></footer>
    </div>
  );
}
