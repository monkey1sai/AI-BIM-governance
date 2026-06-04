// web-viewer-sample/src/console/GovernanceOverlay.tsx
// A1–A10 治理 overlay 框架：疊在 primary viewer live 3D 右側。MVP 只接已有引擎 A2/A3/A4/A8；
// A5/A6/A9/A10 標願景 disabled（誠實，不假裝 ready）。所有治理動作在 live 3D 上；點 failed 構件
// 經 onHighlight（HighlightBridge）在 3D 標紅。本元件不自管 WebRTC（props 注入），守 console 邊界。
import { useState } from "react";
import "./governance/overlay.css";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
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
  const [lastResult, setLastResult] = useState<Record<string, string>>({});
  const coveragePct = props.coverage.ratio === null ? null : Math.round(props.coverage.ratio * 100);

  const handleHighlight = (failed: FailedElement) => {
    const res = props.onHighlight(failed);
    setLastResult((prev) => ({
      ...prev,
      [failed.ifc_guid]: res.ok
        ? `已在 3D 標示：${res.primPath}`
        : res.reason === "unmapped"
          ? "無法在 3D 標示（未對映 usd_prim_path）"
          : "等待 viewer 連線（DataChannel 未就緒）",
    }));
  };

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

      <Panel
        title="治理失敗構件 · 在 live 3D 標示"
        sub="點 failed 構件 → HighlightBridge 經 DataChannel 在 3D 標紅（client 主動拉，非 server-push）"
        prov="asbuilt"
      >
        {props.coverage.degraded && (
          <div className="gov-banner">
            coverage {coveragePct === null ? "未知" : `${coveragePct}%`}（&lt; 100%）：部分未對映構件
            <strong> 無法在 3D 標示</strong>，依既有 spec 誠實降級，不捏造 prim path。
          </div>
        )}
        {!props.coverage.degraded && coveragePct !== null && (
          <Metric value={`${coveragePct}%`} label="mapping coverage" />
        )}
        {props.failedElements.length === 0 ? (
          <p className="ec-note">目前無治理失敗構件（或尚未跑檢核）。</p>
        ) : (
          <table className="ec-table">
            <thead><tr><th>rule_code</th><th>severity</th><th>ifc_guid</th><th /></tr></thead>
            <tbody>
              {props.failedElements.slice(0, 50).map((f) => (
                <tr key={f.ifc_guid}>
                  <td>{f.rule_code ?? "—"}</td>
                  <td>{f.severity}</td>
                  <td>{f.ifc_guid}</td>
                  <td>
                    <Btn caption="highlightPrimsRequest（client 主動拉）" disabled={!props.panelState.canOperate} onClick={() => handleHighlight(f)}>
                      在 3D 標示
                    </Btn>
                    {lastResult[f.ifc_guid] && <span className="ec-note" style={{ marginLeft: 6 }}>{lastResult[f.ifc_guid]}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field k="3D 著色機制" v="client highlightPrimsRequest 經 viewer DataChannel；不復活 2026-05-21 退役 server-push" prov="asbuilt" />
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
