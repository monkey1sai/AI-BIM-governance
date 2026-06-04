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

// W1：A3 rule-run 執行狀態（誠實：running→「執行中…」、error→訊息、succeeded→score+counts）。
export interface RuleCheckState {
  status: "idle" | "running" | "succeeded" | "failed" | "error";
  score?: number | null;
  total?: number;
  failed?: number;
  error?: string;
}

// W3：A8 從 rule-run 開 issue 的結果（誠實：created 筆數 / 錯誤訊息，不假裝成功）。
export interface IssueCreateState {
  status: "idle" | "creating" | "created" | "error";
  created?: number;
  error?: string;
}

export interface GovernanceOverlayProps {
  panelState: GovPanelState;
  // R7：widen 以帶 warnOnly（coverage ∈ [0.9,1.0) 時 measure-first 警示，非 fallback 降級）。
  coverage: { coverageOk: boolean; degraded: boolean; ratio: number | null; warnOnly?: boolean };
  failedElements: FailedElement[];
  onHighlight: (failed: FailedElement) => HighlightResult;
  onClearHighlight: () => void;
  // W1：A3 rule-run。onRunRuleCheck 由 Window 注入（起 run + 輪詢 + 餵 govFailedElements）。
  onRunRuleCheck?: () => void;
  ruleCheck?: RuleCheckState;
  // W2：Kit 非同步回傳的標示確認（key=ifc_guid）。到達後覆寫「已送出」為確認文案。
  highlightConfirm?: Record<string, string>;
  // W3：A8 issue / BCF。onCreateIssues 由 Window 注入；bcfUrl 為直連下載 anchor（不捏造）。
  onCreateIssues?: () => void;
  issueCreate?: IssueCreateState;
  bcfUrl?: string;
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

// 每列穩定 key：rule_code + ifc_guid。同一 ifc_guid 可能有多筆不同 rule_code 的失敗，
// 只用 ifc_guid 當 key 會碰撞（React key 重複 + lastResult 互相覆蓋）。
const rowKey = (f: FailedElement) => `${f.rule_code ?? "norule"}::${f.ifc_guid}`;

export function GovernanceOverlay(props: GovernanceOverlayProps) {
  const readOnly = !props.panelState.canOperate;
  const reason = props.panelState.disabledReason;
  const [lastResult, setLastResult] = useState<Record<string, string>>({});
  const coveragePct = props.coverage.ratio === null ? null : Math.round(props.coverage.ratio * 100);

  // W1：A3 rule-run 狀態文案（誠實）。
  const rc = props.ruleCheck;
  const ruleCheckText = (() => {
    if (!rc || rc.status === "idle") return null;
    if (rc.status === "running") return "執行中…（建立 rule-run 後輪詢狀態）";
    if (rc.status === "error") return `規則檢核失敗：${rc.error ?? "未知錯誤"}`;
    if (rc.status === "failed") return "rule-run 後端回報 failed（檢核未成功完成）";
    // succeeded
    const score = rc.score === null || rc.score === undefined ? "—" : rc.score;
    return `完成：治理分 ${score}，total=${rc.total ?? "?"}、failed=${rc.failed ?? "?"}`;
  })();
  const ruleCheckSucceeded = rc?.status === "succeeded";

  // W3：A8 issue 建立狀態文案（誠實）。
  const ic = props.issueCreate;
  const issueCreateText = (() => {
    if (!ic || ic.status === "idle") return null;
    if (ic.status === "creating") return "建立中…（issues/from-rule-run）";
    if (ic.status === "error") return `開立 issue 失敗：${ic.error ?? "未知錯誤"}`;
    return `已從 rule-run 開 ${ic.created ?? 0} 筆 issue`;
  })();

  const handleHighlight = (failed: FailedElement) => {
    // 防禦縱深：!canOperate（spectator / 未就緒）時不觸發治理動作；按鈕已 disabled，這是第二道保險（對齊 spec「spectator SHALL NOT 觸發」）。
    if (!props.panelState.canOperate) return;
    const res = props.onHighlight(failed);
    setLastResult((prev) => ({
      ...prev,
      // W2 誠實：成功只代表「請求已送出」（client→DataChannel），Kit 是否真的選到該構件需非同步確認，
      // 由 props.highlightConfirm[ifc_guid] 到達後覆寫此文案。不在送出當下假稱「已標示」。
      [rowKey(failed)]: res.ok
        ? "已送出 3D 標示請求（client→DataChannel，待 Kit 確認）"
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
      {reason && <div className="gov-banner" data-testid="gov-readonly-banner">{GOV_PANEL_REASON_TEXT[reason]}</div>}

      <Panel title="MVP 已接引擎" sub="A2 語意映射 · A3 規則/IDS · A4 治理分 · A8 Issue/BCF（design §5）" prov="asbuilt">
        {MVP_ENGINES.map((e) => (
          <div className="gov-engine" key={e.code}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <ProvTag prov={e.prov} />
          </div>
        ))}
      </Panel>

      {/* W1：A3 規則 / IDS 檢核 —— 由當前 review session 起 rule-run，輪詢後把 failed 構件餵入下方清單。 */}
      <Panel
        title="A3 規則 / IDS 檢核 · 從本 session 起跑"
        sub="POST /api/governance/rule-runs/for-session/:sessionId（coordinator 端解析 server IFC 路徑）"
        prov="asbuilt"
        actions={
          <Btn
            caption="POST rule-runs/for-session/:sessionId（client 主動拉）"
            data-testid="gov-run-rulecheck"
            disabled={!props.panelState.canOperate || !props.onRunRuleCheck || rc?.status === "running"}
            onClick={() => props.onRunRuleCheck?.()}
          >
            {rc?.status === "running" ? "檢核中…" : "執行規則檢核"}
          </Btn>
        }
      >
        {ruleCheckText ? (
          <Field k="rule-run 狀態" v={ruleCheckText} prov="asbuilt" />
        ) : (
          <p className="ec-note">尚未起跑規則檢核（按右上「執行規則檢核」；需 primary viewer + 已建立 session）。</p>
        )}
      </Panel>

      <Panel
        title="治理失敗構件 · 在 live 3D 標示"
        sub="點 failed 構件 → HighlightBridge 經 DataChannel 在 3D 標紅（client 主動拉，非 server-push）"
        prov="asbuilt"
        actions={<Btn caption="clearHighlightRequest（client 主動拉）" data-testid="gov-clear" disabled={!props.panelState.canOperate} onClick={() => props.onClearHighlight()}>清除 3D 標示</Btn>}
      >
        {props.coverage.degraded && (
          <div className="gov-banner" data-testid="gov-coverage-degraded">
            coverage {coveragePct === null ? "未知" : `${coveragePct}%`}（&lt; 100%）：部分未對映構件
            <strong> 無法在 3D 標示</strong>，依既有 spec 誠實降級，不捏造 prim path。
          </div>
        )}
        {!props.coverage.degraded && coveragePct !== null && (
          <Metric value={`${coveragePct}%`} label="mapping coverage" />
        )}
        {/* R7：coverage ∈ [0.9,1.0) → 非 degraded 但低於 MVP 鎖定 1.0，measure-first 誠實警示（非 fallback 降級）。 */}
        {!props.coverage.degraded && props.coverage.warnOnly && props.coverage.ratio !== null && (
          <p className="ec-warn-note" data-testid="gov-coverage-warn">
            coverage &lt;100%（未達 MVP 鎖定 1.0；measure-first 警示，非 fallback 降級）
          </p>
        )}
        {props.failedElements.length === 0 ? (
          <p className="ec-note">目前無治理失敗構件（或尚未跑檢核）。</p>
        ) : (
          <table className="ec-table">
            <thead><tr><th>rule_code</th><th>severity</th><th>ifc_guid</th><th /></tr></thead>
            <tbody>
              {props.failedElements.slice(0, 50).map((f) => (
                <tr key={rowKey(f)} data-testid="gov-failed-row">
                  <td>{f.rule_code ?? "—"}</td>
                  <td>{f.severity}</td>
                  <td>{f.ifc_guid}</td>
                  <td>
                    <Btn caption="highlightPrimsRequest（client 主動拉）" data-testid="gov-highlight" disabled={!props.panelState.canOperate} onClick={() => handleHighlight(f)}>
                      在 3D 標示
                    </Btn>
                    {/* W2：Kit 非同步確認（highlightConfirm[ifc_guid]）優先；未到達則顯示「已送出」即時回饋。 */}
                    {(props.highlightConfirm?.[f.ifc_guid] ?? lastResult[rowKey(f)]) && (
                      <span className="ec-note" data-testid="gov-highlight-status" style={{ marginLeft: 6 }}>
                        {props.highlightConfirm?.[f.ifc_guid] ?? lastResult[rowKey(f)]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Field k="3D 著色機制" v="client highlightPrimsRequest 經 viewer DataChannel；不復活 2026-05-21 退役 server-push" prov="asbuilt" />
      </Panel>

      {/* W3：A8 Issue / BCF —— 從本次 rule-run 開 issue（須先 succeeded）；BCF 為直連下載（不捏造）。 */}
      <Panel
        title="A8 Issue / BCF · 從本次 rule-run"
        sub="POST /api/governance/issues/from-rule-run/:runId · BCF GET /api/governance/bcf/export"
        prov="asbuilt"
        actions={
          <Btn
            caption="POST issues/from-rule-run/:runId（須 rule-run succeeded）"
            data-testid="gov-a8-issue"
            disabled={!props.panelState.canOperate || !ruleCheckSucceeded || !props.onCreateIssues}
            onClick={() => props.onCreateIssues?.()}
          >
            {ic?.status === "creating" ? "開立中…" : "從 rule-run 開 issue"}
          </Btn>
        }
      >
        {issueCreateText && <Field k="issue 建立" v={issueCreateText} prov="asbuilt" />}
        {props.bcfUrl ? (
          <a className="ec-btn" data-testid="gov-a8-bcf" href={props.bcfUrl} target="_blank" rel="noreferrer">
            下載 BCF 2.1
            <span className="ec-cap">GET /api/governance/bcf/export（直連下載）</span>
          </a>
        ) : (
          <p className="ec-note" data-testid="gov-a8-bcf-missing">尚無 model version，無法產生 BCF 下載連結（誠實，不捏造 URL）。</p>
        )}
        <Field k="開 issue 前置" v="須先成功跑完 A3 規則檢核（succeeded），否則按鈕 disabled" prov="asbuilt" />
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
