// web-viewer-sample/src/console/GovernanceOverlay.tsx
// 治理 overlay：疊在 primary viewer live 3D 右側。條目編號對齊權威 A1–A10（data.ts A1A10）。
// 已接：A1 管線／M4 映射／A4 語意查詢（#a4 live partial）；碰撞＝A3 clash（未開工）。
// 其餘願景項 disabled。3D 標示走 client highlight（非 server-push）。
import { useState } from "react";
import { t } from "./i18n";
import "./governance/overlay.css";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
import { A1A10, type Prov } from "./data";
import type { FailedElement, HighlightResult } from "./governance/highlightBridge";
import type { ArtifactBinding } from "../types/artifacts";
// DRY（E3 type consistency）：直接復用 govPanelState 的 union，不另立平行 OverlayPanelState。
import { GOV_PANEL_REASON_TEXT, type GovPanelState } from "./governance/govPanelState";

// CH-F：Stage / Artifact Binding 交易選擇（對映規格 StageArtifactBinding）。
export interface StageArtifactBinding {
  artifact_id: string;
  model_version_id: string;
  usdc_url?: string;
  role: "primary" | "secondary";
  load_order: number;
  ready: boolean;
}

export interface BindingApplyState {
  status: "idle" | "applying" | "applied" | "failed";
  reason?: string;
}

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
  /** overlay=右側 340px 疊層（模型分頁）；panel=全幅（問題分頁）。預設 overlay，不改既有行為。 */
  variant?: "overlay" | "panel";
  panelState: GovPanelState;
  // R7：widen 以帶 warnOnly（coverage ∈ [0.9,1.0) 時 measure-first 警示，非 fallback 降級）。
  coverage: { coverageOk: boolean; degraded: boolean; ratio: number | null; warnOnly?: boolean };
  failedElements: FailedElement[];
  onHighlight: (failed: FailedElement) => HighlightResult;
  onClearHighlight: () => void;
  // W1：A3 rule-run。onRunRuleCheck 由 Window 注入（起 run + 輪詢 + 餵 govFailedElements）。
  onRunRuleCheck?: () => void;
  ruleCheck?: RuleCheckState;
  // W2：Kit 非同步回傳的標示確認。到達後覆寫「已送出」為確認文案。
  // F1：key=rowKey（rule_code::ifc_guid），與每列 key 一致 —— 同一 ifc_guid 多筆不同 rule_code 各自獨立。
  highlightConfirm?: Record<string, string>;
  // W3：A8 issue / BCF。onCreateIssues 由 Window 注入；bcfUrl 為直連下載 anchor（不捏造）。
  onCreateIssues?: () => void;
  issueCreate?: IssueCreateState;
  bcfUrl?: string;
  // T2：viewport 點選後反查到的 ifc_guid（由 Window._reverseLookupGuid 設定）。非 null 才顯示，
  // 點選無對映時 Window 會設 null（誠實：不顯示假 guid）。
  selectedGuid?: string | null;
  // CH-F：Stage / Artifact Binding。bindingArtifacts = ready USDC（coordinator artifact_bindings 過濾 ready）。
  bindingArtifacts?: ArtifactBinding[];
  bindingActiveRevision?: string | null;
  bindingLastGoodRevision?: string | null;
  bindingApplyState?: BindingApplyState;
  onApplyBinding?: (selection: StageArtifactBinding[], revisionId: string) => void;
}

// 已接能力：A1 rule-run 產物、M4 映射、A4 語意查詢（console #a4；overlay 只列入口語意）。
const A4_APP = A1A10.find((a) => a.code === "A4");
const MVP_ENGINES: { id: string; code: string; title: string; prov: Prov }[] = [
  { id: "mapping", code: "M4", title: t("轉檔 / 語意映射（GUID⇔prim 連動基建）", "Conversion / semantic mapping (GUID⇔prim bridge)"), prov: "asbuilt" },
  { id: "rules", code: "A1", title: t("規則庫 / IDS 檢核", "Rule library / IDS check"), prov: "asbuilt" },
  { id: "score", code: "A1", title: t("完整性 / 治理分（rule-run 產物）", "Completeness / governance score (rule-run output)"), prov: "asbuilt" },
  { id: "issues", code: "A1", title: t("Issue / BCF（共同出海口）", "Issue / BCF (shared outlet)"), prov: "asbuilt" },
  {
    id: "search",
    code: "A4",
    title: A4_APP
      ? t(`${A4_APP.title}（#a4 live partial）`, `${A4_APP.en} (#a4 live partial)`)
      : t("語意查詢與證據（#a4）", "Semantic query & evidence (#a4)"),
    prov: "asbuilt",
  },
];
// 願景/待建：碰撞＝A3 clash 未開工；A4 已移出本表（避免 asbuilt 能力被 disabled 願景鈕誤導）。
const ROADMAP_ENGINES: { id: string; code: string; title: string; prov: Prov }[] = [
  { id: "clash", code: "A3", title: t("碰撞 / 空間干涉（clash·未開工，ifcclash 已選型）", "Clash / spatial interference (not started; ifcclash selected)"), prov: "p1" },
  { id: "dwg", code: "—", title: t("圖模一致（願景，未列權威 A1–A10）", "Drawing-model consistency (vision, not in authoritative A1–A10)"), prov: "p4" },
  { id: "audit", code: "—", title: t("報表 / 稽核 / 封存（願景，未列權威 A1–A10）", "Reporting / audit / archival (vision, not in authoritative A1–A10)"), prov: "p4" },
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
    if (rc.status === "running") return t("執行中…（建立 rule-run 後輪詢狀態）", "Running… (polling status after creating rule-run)");
    if (rc.status === "error") return t("規則檢核失敗：", "Rule check failed: ") + (rc.error ?? t("未知錯誤", "unknown error"));
    if (rc.status === "failed") return t("rule-run 後端回報 failed（檢核未成功完成）", "rule-run backend reported failed (check did not complete successfully)");
    // succeeded
    const score = rc.score === null || rc.score === undefined ? "—" : rc.score;
    return t("完成：治理分 ", "Done: governance score ") + `${score}` + t("，total=", ", total=") + `${rc.total ?? "?"}` + t("、failed=", ", failed=") + `${rc.failed ?? "?"}`;
  })();
  const ruleCheckSucceeded = rc?.status === "succeeded";

  // W3：A8 issue 建立狀態文案（誠實）。
  const ic = props.issueCreate;
  const issueCreateText = (() => {
    if (!ic || ic.status === "idle") return null;
    if (ic.status === "creating") return t("建立中…（issues/from-rule-run）", "Creating… (issues/from-rule-run)");
    if (ic.status === "error") return t("開立 issue 失敗：", "Failed to create issue: ") + (ic.error ?? t("未知錯誤", "unknown error"));
    return t("已從 rule-run 開 ", "Created ") + `${ic.created ?? 0}` + t(" 筆 issue", " issue(s) from rule-run");
  })();

  // T1：清除 3D 標示時一併清掉本地每列狀態文案（lastResult），避免殘留「已送出…」誤導。
  // props.highlightConfirm 由 Window 在 onClearHighlight 內 reset（govHighlightConfirm:{}），此處只負責本地 state。
  const handleClearHighlight = () => {
    if (!props.panelState.canOperate) return;
    props.onClearHighlight();
    setLastResult({});
  };

  const handleHighlight = (failed: FailedElement) => {
    // 防禦縱深：!canOperate（spectator / 未就緒）時不觸發治理動作；按鈕已 disabled，這是第二道保險（對齊 spec「spectator SHALL NOT 觸發」）。
    if (!props.panelState.canOperate) return;
    const res = props.onHighlight(failed);
    setLastResult((prev) => ({
      ...prev,
      // W2 誠實：成功只代表「請求已送出」（client→DataChannel），Kit 是否真的選到該構件需非同步確認，
      // 由 props.highlightConfirm[ifc_guid] 到達後覆寫此文案。不在送出當下假稱「已標示」。
      [rowKey(failed)]: res.ok
        ? t("已送出 3D 標示請求（client→DataChannel，待 Kit 確認）", "3D highlight request sent (client→DataChannel, awaiting Kit confirmation)")
        : res.reason === "unmapped"
          ? t("無法在 3D 標示（未對映 usd_prim_path）", "Cannot highlight in 3D (usd_prim_path not mapped)")
          : t("等待 viewer 連線（DataChannel 未就緒）", "Waiting for viewer connection (DataChannel not ready)"),
    }));
  };

  return (
    <div className={`gov-overlay ${props.variant === "panel" ? "gov-overlay--panel" : ""} ${readOnly ? "gov-readonly" : ""}`} role="complementary" aria-label={t("治理 overlay", "Governance overlay")} data-testid="gov-overlay">
      <div className="gov-overlay-h">
        <span className="gov-overlay-t">{t("治理 · 依 A1–A10 權威狀態", "Governance · per authoritative A1–A10 status")}</span>
        <ProvTag prov="asbuilt" />
      </div>
      {reason && <div className="gov-banner" data-testid="gov-readonly-banner">{GOV_PANEL_REASON_TEXT[reason]}</div>}

      <Panel title={t("已接能力", "Connected capabilities")} sub={t("語意映射（M4 連動）· 規則/IDS · 治理分 · Issue/BCF——均屬 A1 管線/連動基建（權威：data.ts A1A10／README §4）", "Semantic mapping (M4 bridge) · rules/IDS · governance score · Issue/BCF — all A1 pipeline / bridge infra (authority: data.ts A1A10 / README §4)")} prov="asbuilt">
        {MVP_ENGINES.map((e) => (
          <div className="gov-engine" key={e.id}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <ProvTag prov={e.prov} />
          </div>
        ))}
      </Panel>

      {/* W1：A3 規則 / IDS 檢核 —— 由當前 review session 起 rule-run，輪詢後把 failed 構件餵入下方清單。 */}
      <Panel
        title={t("A1 規則 / IDS 檢核 · 從本 session 起跑", "A1 rule / IDS check · launched from this session")}
        sub={t("POST /api/governance/rule-runs/for-session/:sessionId（coordinator 端解析 server IFC 路徑）", "POST /api/governance/rule-runs/for-session/:sessionId (coordinator resolves the server IFC path)")}
        prov="asbuilt"
        actions={
          <Btn
            caption={t("POST rule-runs/for-session/:sessionId（client 主動拉）", "POST rule-runs/for-session/:sessionId (client pull)")}
            data-testid="gov-run-rulecheck"
            disabled={!props.panelState.canOperate || !props.onRunRuleCheck || rc?.status === "running"}
            onClick={() => props.onRunRuleCheck?.()}
          >
            {rc?.status === "running" ? t("檢核中…", "Checking…") : t("執行規則檢核", "Run rule check")}
          </Btn>
        }
      >
        {ruleCheckText ? (
          <Field k={t("rule-run 狀態", "rule-run status")} v={ruleCheckText} prov="asbuilt" />
        ) : (
          <p className="ec-note">{t("尚未起跑規則檢核（按右上「執行規則檢核」；需 primary viewer + 已建立 session）。", "Rule check not started yet (press “Run rule check” top-right; requires primary viewer + an established session).")}</p>
        )}
      </Panel>

      {/* CH-F：Stage / Artifact Binding 主入口（primary 可操作；spectator 唯讀 disabled）。 */}
      <BindingComposer
        artifacts={props.bindingArtifacts ?? []}
        canOperate={props.panelState.canOperate}
        activeRevision={props.bindingActiveRevision ?? null}
        lastGoodRevision={props.bindingLastGoodRevision ?? null}
        applyState={props.bindingApplyState}
        onApply={props.onApplyBinding}
      />

      <Panel
        title={t("治理失敗構件 · 在 live 3D 標示", "Governance-failed elements · highlight in live 3D")}
        sub={t("點 failed 構件 → HighlightBridge 經 DataChannel 在 3D 標紅（client 主動拉，非 server-push）", "Click a failed element → HighlightBridge marks it red in 3D via DataChannel (client pull, not server-push)")}
        prov="asbuilt"
        actions={<Btn caption={t("clearHighlightRequest（client 主動拉）", "clearHighlightRequest (client pull)")} data-testid="gov-clear" disabled={!props.panelState.canOperate} onClick={handleClearHighlight}>{t("清除 3D 標示", "Clear 3D highlight")}</Btn>}
      >
        {props.coverage.degraded && (
          <div className="gov-banner" data-testid="gov-coverage-degraded">
            coverage {coveragePct === null ? t("未知", "unknown") : `${coveragePct}%`}{t("（", " (")}&lt; 100%{t("）：部分未對映構件", "): some unmapped elements")}
            <strong>{t(" 無法在 3D 標示", " cannot be highlighted in 3D")}</strong>{t("，依既有 spec 誠實降級，不捏造 prim path。", "; honestly degraded per existing spec, no fabricated prim path.")}
          </div>
        )}
        {!props.coverage.degraded && coveragePct !== null && (
          <Metric value={`${coveragePct}%`} label="mapping coverage" />
        )}
        {/* R7：coverage ∈ [0.9,1.0) → 非 degraded 但低於 MVP 鎖定 1.0，measure-first 誠實警示（非 fallback 降級）。 */}
        {!props.coverage.degraded && props.coverage.warnOnly && props.coverage.ratio !== null && (
          <p className="ec-warn-note" data-testid="gov-coverage-warn">
            coverage &lt;100%{t("（未達 MVP 鎖定 1.0；measure-first 警示，非 fallback 降級）", " (below the MVP-locked 1.0; measure-first warning, not a fallback degradation)")}
          </p>
        )}
        {/* T2：viewport 點選後反查到的 ifc_guid（誠實：只有非 null 才顯示；無對映時 Window 設 null → 不顯示假 guid）。 */}
        {props.selectedGuid ? (
          <p className="ec-note" data-testid="gov-selected-guid">{t("點選 3D 構件 → ifc_guid=", "Selected 3D element → ifc_guid=")}{props.selectedGuid}</p>
        ) : null}
        {props.failedElements.length === 0 ? (
          <p className="ec-note">{t("目前無治理失敗構件（或尚未跑檢核）。", "No governance-failed elements right now (or the check has not run yet).")}</p>
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
                    <Btn caption={t("highlightPrimsRequest（client 主動拉）", "highlightPrimsRequest (client pull)")} data-testid="gov-highlight" disabled={!props.panelState.canOperate} onClick={() => handleHighlight(f)}>
                      {t("在 3D 標示", "Highlight in 3D")}
                    </Btn>
                    {/* W2：Kit 非同步確認優先；未到達則顯示「已送出」即時回饋。
                        F1：以 rowKey（rule_code::ifc_guid）為 key，與 lastResult 一致 —— 同一 ifc_guid 多筆不同
                        rule_code 的列各自獨立確認，不互相覆蓋。 */}
                    {(props.highlightConfirm?.[rowKey(f)] ?? lastResult[rowKey(f)]) && (
                      <span className="ec-note" data-testid="gov-highlight-status" style={{ marginLeft: "var(--ab-space-2)" }}>
                        {props.highlightConfirm?.[rowKey(f)] ?? lastResult[rowKey(f)]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* T4：保留 50 列上限，但 >50 時誠實標註其餘未列出（不靜默截斷）。 */}
        {props.failedElements.length > 50 && (
          <p className="ec-note" data-testid="gov-failed-truncated">
            {t("顯示前 50 筆／共 ", "Showing first 50 of ")}{props.failedElements.length}{t(" 筆失敗構件（其餘未列出）", " failed elements (the rest are not listed)")}
          </p>
        )}
        <Field k={t("3D 著色機制", "3D coloring mechanism")} v={t("client highlightPrimsRequest 經 viewer DataChannel；不復活 2026-05-21 退役 server-push", "client highlightPrimsRequest via viewer DataChannel; does not revive the server-push retired on 2026-05-21")} prov="asbuilt" />
      </Panel>

      {/* W3：A8 Issue / BCF —— 從本次 rule-run 開 issue（須先 succeeded）；BCF 為直連下載（不捏造）。 */}
      <Panel
        // R9：顯示文字對齊權威（Issue/BCF＝A1 出海口）；data-testid="gov-a8-*" 為既有測試/E2E 契約，保留不改。
        title={t("A1 Issue / BCF · 從本次 rule-run", "A1 Issue / BCF · from this rule-run")}
        sub="POST /api/governance/issues/from-rule-run/:runId · BCF GET /api/governance/bcf/export"
        prov="asbuilt"
        actions={
          <Btn
            caption={t("POST issues/from-rule-run/:runId（須 rule-run succeeded）", "POST issues/from-rule-run/:runId (requires rule-run succeeded)")}
            data-testid="gov-a8-issue"
            // F2：creating 中與 created 後都 disabled（避免連點重複開 issue 集）；succeeded 文案見下方 issueCreateText。
            disabled={
              !props.panelState.canOperate ||
              !ruleCheckSucceeded ||
              !props.onCreateIssues ||
              ic?.status === "creating" ||
              ic?.status === "created"
            }
            onClick={() => props.onCreateIssues?.()}
          >
            {ic?.status === "creating" ? t("開立中…", "Creating…") : t("從 rule-run 開 issue", "Create issue from rule-run")}
          </Btn>
        }
      >
        {issueCreateText && <Field k={t("issue 建立", "issue creation")} v={issueCreateText} prov="asbuilt" />}
        {props.bcfUrl ? (
          <>
            <a className="ec-btn" data-testid="gov-a8-bcf" href={props.bcfUrl} target="_blank" rel="noreferrer">
              {t("下載 BCF 2.1", "Download BCF 2.1")}
              <span className="ec-cap">{t("GET /api/governance/bcf/export（直連下載）", "GET /api/governance/bcf/export (direct download)")}</span>
            </a>
            {/* T5：誠實標註 BCF 匯出範圍 —— bcfExportUrl 以 model_version_id 為範圍（該 model version 所有正式
                issue），非僅本次 rule-run；不誤導操作員以為是 run-scoped。後端端點無 run filter，不捏造。 */}
            <p className="ec-note" data-testid="gov-a8-bcf-scope">
              {t("BCF 匯出為本 model version 所有正式 issue（非僅本次 rule-run）", "BCF export covers all official issues for this model version (not just this rule-run)")}
            </p>
          </>
        ) : (
          <p className="ec-note" data-testid="gov-a8-bcf-missing">{t("尚無 model version，無法產生 BCF 下載連結（誠實，不捏造 URL）。", "No model version yet, cannot produce a BCF download link (honest, no fabricated URL).")}</p>
        )}
        <Field k={t("開 issue 前置", "issue prerequisite")} v={t("須先成功跑完 A3 規則檢核（succeeded），否則按鈕 disabled", "A3 rule check must complete successfully (succeeded) first, otherwise the button is disabled")} prov="asbuilt" />
      </Panel>

      <Panel title={t("願景 / 待建", "Vision / to build")} sub={t("碰撞屬 A3 clash（未開工）；A4 語意查詢已 live 於 #a4（上表 asbuilt）；其餘願景項 disabled", "Clash = A3 not started; A4 search is live at #a4 (asbuilt above); other vision items disabled")} prov="asbuilt">
        {ROADMAP_ENGINES.map((e) => (
          <div className="gov-engine roadmap" key={e.id}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <Btn prov={e.prov} disabled caption={t("後端未建（願景），各自獨立 OpenSpec change", "Backend not built (vision), each its own OpenSpec change")}>{e.title}</Btn>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// CH-F：Stage / Artifact Binding composer。選 1..N ready USDC、指定「恰好一個」primary、改 load_order、交易式套用。
// spectator（!canOperate）：控制可見但 disabled（aria 由 Btn/input disabled 帶出）+ apply 不送 mutating 指令（誠實鐵律）。
function BindingComposer(props: {
  artifacts: ArtifactBinding[];
  canOperate: boolean;
  activeRevision: string | null;
  lastGoodRevision: string | null;
  applyState?: BindingApplyState;
  onApply?: (selection: StageArtifactBinding[], revisionId: string) => void;
}) {
  const ready = props.artifacts.filter((a) => a.ready_status === "ready" && a.url);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [loadOrders, setLoadOrders] = useState<Record<string, number>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const orderOf = (a: ArtifactBinding) => loadOrders[a.artifact_id] ?? a.load_order ?? 0;

  const apply = () => {
    setLocalError(null);
    if (!props.canOperate) return; // 防禦縱深：spectator / 未就緒不送 mutating 指令
    const chosen = ready.filter((a) => selected[a.artifact_id]);
    if (chosen.length === 0) {
      setLocalError(t("請至少選 1 個 ready USDC artifact", "Please select at least 1 ready USDC artifact"));
      return;
    }
    if (!primaryId || !chosen.some((a) => a.artifact_id === primaryId)) {
      setLocalError(t("請在已選 artifact 中指定「恰好一個」primary", "Please designate exactly one primary among the selected artifacts"));
      return;
    }
    const selection: StageArtifactBinding[] = chosen
      .map((a) => ({
        artifact_id: a.artifact_id,
        model_version_id: a.model_version_id,
        usdc_url: a.url ?? undefined,
        role: (a.artifact_id === primaryId ? "primary" : "secondary") as "primary" | "secondary",
        load_order: orderOf(a),
        ready: true,
      }))
      .sort((x, y) => x.load_order - y.load_order);
    props.onApply?.(selection, `binding_rev_${Date.now()}`);
  };

  const applyText = (() => {
    const s = props.applyState;
    if (!s || s.status === "idle") return null;
    if (s.status === "applying") return t("套用中…（production: loadArtifactGroupRequest，等待 Kit openedStageResult；harness: deterministic ack）", "Applying… (production: loadArtifactGroupRequest, awaiting Kit openedStageResult; harness: deterministic ack)");
    if (s.status === "failed") return t("套用失敗：", "Apply failed: ") + (s.reason ?? t("未知", "unknown")) + t("（保留上次成功 binding，不偽宣告）", " (keeping last successful binding, no false claim)");
    return t("已套用（Kit 已確認 stage opened；harness 則為 deterministic ack）", "Applied (Kit confirmed stage opened; harness uses deterministic ack)");
  })();

  return (
    <Panel
      title={t("Stage / Artifact Binding（主入口）", "Stage / Artifact Binding (main entry)")}
      sub={t("選 1..N ready USDC → 指定唯一 primary → 調 load_order → 交易式套用 → 重組 stage（production: loadArtifactGroupRequest + stage_composition）", "Select 1..N ready USDC → designate a single primary → adjust load_order → apply transactionally → recompose stage (production: loadArtifactGroupRequest + stage_composition)")}
      prov="asbuilt"
      actions={
        <Btn
          caption={t("loadArtifactGroupRequest（client 主動拉；交易式套用 binding 並重組 stage；harness 使用 deterministic ack）", "loadArtifactGroupRequest (client pull; apply binding transactionally and recompose stage; harness uses deterministic ack)")}
          data-testid="binding-apply"
          disabled={!props.canOperate || props.applyState?.status === "applying"}
          onClick={apply}
        >
          {props.applyState?.status === "applying" ? t("套用中…", "Applying…") : t("套用 binding 並重組 stage", "Apply binding and recompose stage")}
        </Btn>
      }
    >
      {ready.length === 0 ? (
        <p className="ec-note" data-testid="binding-empty">{t("目前無 ready USDC artifact 可組（誠實：不假裝 ready）。", "No ready USDC artifact to compose right now (honest: not pretending ready).")}</p>
      ) : (
        <table className="ec-table" data-testid="binding-table">
          <thead>
            <tr><th>{t("選", "Select")}</th><th>primary</th><th>artifact</th><th>load_order</th><th>ready</th></tr>
          </thead>
          <tbody>
            {ready.map((a) => (
              <tr key={a.artifact_id} data-testid="binding-row">
                <td>
                  <input
                    type="checkbox"
                    data-testid={`binding-select-${a.artifact_id}`}
                    checked={!!selected[a.artifact_id]}
                    disabled={!props.canOperate}
                    aria-disabled={!props.canOperate}
                    onChange={() => setSelected((prev) => ({ ...prev, [a.artifact_id]: !prev[a.artifact_id] }))}
                  />
                </td>
                <td>
                  <input
                    type="radio"
                    name="binding-primary"
                    data-testid={`binding-primary-${a.artifact_id}`}
                    checked={primaryId === a.artifact_id}
                    disabled={!props.canOperate || !selected[a.artifact_id]}
                    aria-disabled={!props.canOperate}
                    onChange={() => setPrimaryId(a.artifact_id)}
                  />
                </td>
                <td>{a.display_name || a.artifact_id}</td>
                <td>
                  <input
                    type="number"
                    data-testid={`binding-loadorder-${a.artifact_id}`}
                    value={orderOf(a)}
                    disabled={!props.canOperate}
                    aria-disabled={!props.canOperate}
                    style={{ width: 56 }}
                    onChange={(e) => setLoadOrders((p) => ({ ...p, [a.artifact_id]: Number(e.target.value) }))}
                  />
                </td>
                <td>{a.ready_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {localError && <p className="ec-warn-note" data-testid="binding-error">{localError}</p>}
      {applyText && <Field k={t("binding 套用", "binding apply")} v={applyText} prov="asbuilt" />}
      <p className="ec-note" data-testid="binding-active-revision">active binding revision{t("：", ": ")}{props.activeRevision ?? t("（尚未套用）", "(not applied yet)")}</p>
      {props.lastGoodRevision && props.lastGoodRevision !== props.activeRevision && (
        <p className="ec-note" data-testid="binding-lastgood">last good binding revision{t("：", ": ")}{props.lastGoodRevision}</p>
      )}
    </Panel>
  );
}
