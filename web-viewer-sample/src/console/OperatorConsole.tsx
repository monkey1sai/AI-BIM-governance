/* eslint-disable react-refresh/only-export-components */
// web-viewer-sample/src/console/OperatorConsole.tsx
// 統一治理控制台 operator 殼層（非 viewer overlay）。CH-E：六個獨立 operator 頁
//   #/coordinator · #/intake · #/runtime · #/review · #/kit · #/demo-control
// 沿用既有零依賴 hash 路由。SHALL NOT 混入 A1–A10 治理 overlay（A1–A10 只疊在 primary viewer）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { CoordinatorPage, RuntimePage, ReviewRoomPage } from "./pages";
import { IntakeSelectPage } from "./IntakeSelectPage";
import { KitConsolePage } from "./KitConsolePage";
import { RealIfcConsolePage } from "./RealIfcConsolePage";

export type OperatorPage = "coordinator" | "intake" | "runtime" | "review" | "kit" | "demo-control";

const PAGE_KEYS: readonly OperatorPage[] = ["coordinator", "intake", "runtime", "review", "kit", "demo-control"];

// 純函式（從 window.location.hash 解出當前頁）→ named export 便於單元測試。
// 認得 #key / #/key / #/console/key / #console/key（含 CH-E 的 #/kit、#/demo-control）；未知 → coordinator。
// 註：hashchange 監聽與 nav 點擊互動（go()）無法在無 @testing-library 環境單測，由 browser E2E 覆蓋。
export function readPage(): OperatorPage {
  const h = window.location.hash
    .replace(/^#\/?console\/?/, "") // #/console/ 或 #console/ 前綴
    .replace(/^#\/?/, "")          // 餘下的 #/ 或 # 前綴
    .split("?")[0];
  return (PAGE_KEYS as readonly string[]).includes(h) ? (h as OperatorPage) : "coordinator";
}

// 純 body（便於測試，不依賴 window.location）。
export function OperatorBody({ page }: { page: OperatorPage }) {
  if (page === "intake") return <IntakeSelectPage />;
  if (page === "runtime") return <RuntimePage />;
  if (page === "review") return <ReviewRoomPage />;
  if (page === "kit") return <KitConsolePage />;
  if (page === "demo-control") return <RealIfcConsolePage />;
  return <CoordinatorPage />;
}

const NAV: { key: OperatorPage; label: string }[] = [
  { key: "coordinator", label: "Coordinator 控制台" },
  { key: "intake", label: "模型進件（A1）" },
  { key: "demo-control", label: "真實 IFC 進件" },
  { key: "review", label: "Review Room（G）" },
  { key: "runtime", label: "Runtime 狀態" },
  { key: "kit", label: "Kit 模型台" },
];

export default function OperatorConsole() {
  const [page, setPage] = useState<OperatorPage>(readPage);
  useEffect(() => {
    const on = () => setPage(readPage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // CH-E：hash 採 #/<key>（與 spec 的 #/kit、#/demo-control 一致；readPage 同時相容舊 #/console/<key>）。
  const go = (k: OperatorPage) => { window.location.hash = `/${k}`; setPage(k); };

  return (
    <div className="ec-root">
      <header className="ec-top">
        <span className="ec-brand">AI · BIM Governance</span>
        <span className="ec-sub">OPERATOR CONSOLE · COORDINATOR 8004</span>
      </header>
      <nav className="ec-nav">
        <div className="ec-group">OPERATOR</div>
        {NAV.map((n) => (
          <button key={n.key} data-testid={`op-nav-${n.key}`} className={page === n.key ? "active" : ""} onClick={() => go(n.key)}>{n.label}</button>
        ))}
      </nav>
      <main className="ec-main" data-testid="op-page"><OperatorBody page={page} /></main>
      <footer className="ec-foot"><span>operator 頁不含 A1–A10 治理 overlay · 治理只疊在 primary viewer</span></footer>
    </div>
  );
}
