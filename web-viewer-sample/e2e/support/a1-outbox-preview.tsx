// Test-only entry: not imported by main.tsx or included in the production build.
import React from "react";
import { createRoot } from "react-dom/client";
import { A1OutboxStatus } from "../../src/console/A1OutboxStatus";
import "../../src/index.css";
import "../../src/styles/demo-theme.css";
import "../../../docs/plans/ai-bim-governance.css";
import "../../src/console/legacy-console.css";
import reference from "../../../docs/plans/AI-BIM Console Hi-Fi.dc.html?raw";

const params = new URLSearchParams(location.search);
const surface = params.get("surface") === "reference" ? "reference" : "current";
const state = params.get("state");
const template = new DOMParser().parseFromString(reference, "text/html")
  .querySelector<HTMLTemplateElement>("#a1-delivery-state-reference")!;
const states = [...template.content.querySelectorAll<HTMLElement>("[data-receipt-state]")];
const style = document.createElement("style");
style.textContent = `html, body { display:block; min-height:100%; width:100%; background:var(--ab-bg); color:var(--ab-text); font-family:var(--ab-font); }
#root { width:100%; max-width:none; margin:0; padding:0; text-align:left; }
main { padding:24px; box-sizing:border-box; } h1 { font-size:24px; margin:0 0 8px; } h2 { font-size:16px; margin:0 0 12px; }
.gallery { display:grid; grid-template-columns:1fr 1fr; gap:16px; } iframe { width:100%; height:190px; border:1px solid var(--ab-border); border-radius:9px; background:var(--ab-panel); }
.child { padding:18px; } .fixture-note { color:var(--ab-text-muted); font-size:13px; margin-bottom:20px; }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(state ? <main className="child">
  {surface === "reference"
    ? <div dangerouslySetInnerHTML={{ __html: states.find(item => item.dataset.receiptState === state)!.outerHTML }} />
    : <><h2>{states.find(item => item.dataset.receiptState === state)!.querySelector("h2")!.textContent}</h2>
      <div className="ec-note"><A1OutboxStatus outboxId="cbk_design" sessionId="review_session_design" /></div></>}
</main> : <main>
  <h1>A1 摘要遞送狀態</h1>
  <p className="fixture-note">設計 fixture · 固定範例 ID／時間 · 重新查詢只讀摘要，不會重送。此畫面不代表真實雲端或 Kit 驗收。</p>
  <div className="gallery">{states.map(item => <iframe key={item.dataset.receiptState} title={item.dataset.receiptState}
    src={`?surface=${surface}&state=${item.dataset.receiptState}&capture=${encodeURIComponent(params.get("capture") ?? "manual")}`} />)}</div>
</main>);
