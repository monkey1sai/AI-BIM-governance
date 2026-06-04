// web-viewer-sample/src/console/GovernanceOverlay.tsx
// A1–A10 治理 overlay 框架：疊在 primary viewer live 3D 右側。MVP 只接已有引擎 A2/A3/A4/A8；
// A5/A6/A9/A10 標願景 disabled（誠實，不假裝 ready）。所有治理動作在 live 3D 上；點 failed 構件
// 經 onHighlight（HighlightBridge）在 3D 標紅。本元件不自管 WebRTC（props 注入），守 console 邊界。
import "./governance/overlay.css";
import { Btn, Panel, ProvTag } from "./components";
import type { Prov } from "./data";
import type { FailedElement, HighlightResult } from "./governance/highlightBridge";
// DRY（E3 type consistency）：直接復用 govPanelState 的 union，不另立平行 OverlayPanelState。
import { GOV_PANEL_REASON_TEXT, type GovPanelState } from "./governance/govPanelState";

export interface GovernanceOverlayProps {
  panelState: GovPanelState;
  coverage: { coverageOk: boolean; degraded: boolean; ratio: number | null };
  failedElements: FailedElement[];
  onHighlight: (failed: FailedElement) => HighlightResult;
  onClearHighlight: () => void;
}

// MVP 接的已有引擎（design §5 權威對映）。
const MVP_ENGINES: { code: string; title: string; prov: Prov }[] = [
  { code: "A2", title: "轉檔 / 語意映射", prov: "asbuilt" },
  { code: "A3", title: "規則庫 / IDS 檢核", prov: "asbuilt" },
  { code: "A4", title: "完整性 / 治理分", prov: "asbuilt" },
  { code: "A8", title: "Issue / BCF", prov: "asbuilt" },
];
// MVP 不含的新引擎（Q3 各自獨立 OpenSpec change）→ 標願景 disabled。
const ROADMAP_ENGINES: { code: string; title: string; prov: Prov }[] = [
  { code: "A5", title: "碰撞 / 空間干涉", prov: "p3" },
  { code: "A6", title: "圖模一致", prov: "p4" },
  { code: "A9", title: "AI 搜尋 / 問答", prov: "p4" },
  { code: "A10", title: "報表 / 稽核 / 封存", prov: "p4" },
];

export function GovernanceOverlay(props: GovernanceOverlayProps) {
  const readOnly = !props.panelState.canOperate;
  const reason = props.panelState.disabledReason;
  return (
    <div className={`gov-overlay ${readOnly ? "gov-readonly" : ""}`} role="complementary" aria-label="A1–A10 治理 overlay">
      <div className="gov-overlay-h">
        <span className="gov-overlay-t">治理 · A1–A10</span>
        <ProvTag prov="asbuilt" />
      </div>
      {reason && <div className="gov-banner">{GOV_PANEL_REASON_TEXT[reason]}</div>}

      <Panel title="MVP 已接引擎" sub="A2 語意映射 · A3 規則/IDS · A4 治理分 · A8 Issue/BCF（design §5）" prov="asbuilt">
        {MVP_ENGINES.map((e) => (
          <div className="gov-engine" key={e.code}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <ProvTag prov={e.prov} />
          </div>
        ))}
      </Panel>

      <Panel title="後期願景 · 各自獨立 OpenSpec change" sub="A5/A6/A9/A10 後端未建（Q3）→ disabled，不假裝 ready" prov="asbuilt">
        {ROADMAP_ENGINES.map((e) => (
          <div className="gov-engine roadmap" key={e.code}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <Btn prov={e.prov} disabled caption="後端未建（願景），各自獨立 OpenSpec change">{e.title}</Btn>
          </div>
        ))}
      </Panel>
    </div>
  );
}
