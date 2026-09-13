import { useEffect, useRef, useState, type RefObject } from "react";
import type { RuleResultRow } from "./governanceClient";
import { issueHighlightItems } from "./governance/issueHighlightItems";
import type { ReviewSessionViewerPaneBatchGate, ReviewSessionViewerPaneHandle } from "./ReviewSessionViewerPane";
import type { IssueViewAction } from "../viewer/core/issueViewExchange";
import { normalizeSeverity } from "./governance/highlightBridge";
import { FailureScoreboard } from "./FailureScoreboard";


export function A1IssueViewControls({ rows, runId, sessionId, paneRef, gate }: {
  rows: RuleResultRow[]; runId: string | null; sessionId: string;
  paneRef: RefObject<ReviewSessionViewerPaneHandle | null>; gate: ReviewSessionViewerPaneBatchGate | null;
}) {
  const [severity, setSeverity] = useState("all");
  const [rule, setRule] = useState("all");
  const [enabled, setEnabled] = useState(false);
  const [mayHaveOverlay, setMayHaveOverlay] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("尚未顯示問題高亮");
  const [renderer, setRenderer] = useState("unknown");
  const scope = `${sessionId}:${runId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  useEffect(() => {
    setSeverity("all"); setRule("all"); setEnabled(false); setPending(false);
    setStatus("檢核結果已更新；按「在模型中顯示問題」才會套用新結果。既有模型外觀保持不變。");
  }, [scope]);
  useEffect(() => { setMayHaveOverlay(false); setRenderer("unknown"); }, [sessionId]);
  const filterRows = (nextSeverity: string, nextRule: string) => rows.filter(row =>
    (nextSeverity === "all" || normalizeSeverity(row.severity) === nextSeverity)
    && (nextRule === "all" || row.rule_code === nextRule));
  const filtered = filterRows(severity, rule);
  const components = new Set(filtered.map(row => row.ifc_guid).filter(Boolean)).size;
  const unmapped = new Set(filtered.filter(row => !row.usd_prim_path).map(row => row.ifc_guid)).size;
  const canCommand = gate?.canSendViewerCommand ?? gate?.canSend ?? false;
  useEffect(() => {
    if (!canCommand) {
      setEnabled(false);
      if (mayHaveOverlay) setStatus("目前連線或 Stage 尚未確認；先前模型效果無法確認。恢復後請重新顯示或關閉高亮。");
    }
  }, [canCommand, mayHaveOverlay]);

  const send = async (action: IssueViewAction, nextRows = filtered, guid?: string) => {
    const pane = paneRef.current;
    if (!pane || pending) return;
    const input = issueHighlightItems(nextRows);
    const unmappedCount = new Set(nextRows.filter(row => !row.usd_prim_path || !row.ifc_guid).map(row => row.ifc_guid)).size;
    if (action === "highlight" && nextRows.length > 0 && input.length === 0) {
      setStatus("目前篩選的問題都無法在模型中定位；既有模型外觀保持不變。請查看問題明細。");
      return;
    }
    if (action === "highlight" && input.length > 4096) { setStatus("目前篩選超過 4096 個構件，請縮小篩選範圍。"); return; }
    const expectedScope = scope;
    setPending(true); setStatus("等待模型確認…");
    // A zero-result filter restores appearance but leaves the explicit display mode enabled.
    const command = action === "highlight" && input.length === 0 ? "clear" : action;
    if (action === "highlight") setMayHaveOverlay(true);
    const result = await pane.runIssueView(command, input, guid).catch(() => ({
      ok: false, reason: "viewer_unavailable", renderer_mode: undefined, applied_count: undefined,
    }));
    if (scopeRef.current !== expectedScope) return;
    setPending(false);
    if (!result.ok) {
      setStatus(`尚未確認模型效果；可重試或關閉問題高亮。${result.reason || "runtime_unconfirmed"}`);
      return;
    }
    if (action === "highlight") {
      setEnabled(true);
      setRenderer(result.renderer_mode || "unknown");
      setStatus(`問題高亮已套用：${result.applied_count ?? 0} 個模型構件。${unmappedCount > 0 ? `另有 ${unmappedCount} 個構件無法定位，請查看問題明細。` : ""}`);
    } else if (action === "clear") {
      setEnabled(false); setMayHaveOverlay(false); setStatus("問題高亮已關閉，原始外觀已恢復。");
    } else if (action === "focus") setStatus("已定位構件並加入選取框；問題顏色保持不變。");
    else setStatus("已清除選取；問題顏色與目前視角保持不變。");
  };
  const changeFilter = (nextSeverity: string, nextRule: string) => {
    setSeverity(nextSeverity); setRule(nextRule);
    if (enabled) void send("highlight", filterRows(nextSeverity, nextRule));
  };

  return <section aria-label="A1 模型問題顯示" data-testid="a1-issue-view-controls">
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBlock: 10 }}>
      <button type="button" data-testid="a1-show-issues" disabled={pending || !gate?.canSend || !runId || rows.length === 0}
        onClick={() => { void send("highlight"); }}>在模型中顯示問題</button>
      <button type="button" disabled={pending || !canCommand} onClick={() => { void send("clear_selection"); }}>清除選取</button>
      <button type="button" disabled={pending || !canCommand || !mayHaveOverlay} onClick={() => { void send("clear"); }}>關閉問題高亮</button>
    </div>
    <p className="ec-note">檢核與展開明細不改變模型；啟用高亮後，篩選會同步模型顏色。</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <label>嚴重度 <select aria-label="問題嚴重度" value={severity} disabled={pending}
        onChange={e => changeFilter(e.target.value, rule)}>
        <option value="all">全部</option><option value="error">錯誤／高風險</option>
        <option value="warning">警告／中風險</option><option value="low">低風險</option><option value="info">資訊</option>
      </select></label>
      <label>規則 <select aria-label="問題規則" value={rule} disabled={pending}
        onChange={e => changeFilter(severity, e.target.value)}>
        <option value="all">全部</option>{[...new Set(rows.map(row => row.rule_code))].sort().map(code => <option key={code} value={code}>{code}</option>)}
      </select></label>
    </div>
    <p data-testid="a1-issue-counts">{filtered.length} 筆問題・{components} 個構件・{unmapped} 個無法定位</p>
    <p aria-label="問題高亮圖例">🔴 錯誤／高風險 · 🟡 警告／中風險 · 🔵 低風險／資訊<br />同一構件以目前篩選中的最高嚴重度著色，保留全部問題明細。</p>
    <p role="status">{status}</p>
    {!canCommand && <p className="ec-note">{gate?.viewerCommandReason || gate?.reason || "請先建立並啟動 3D Session。"}</p>}
    <details><summary>檢視渲染證據</summary><p>Kit 回報的 renderer mode：{renderer}。材質 ACK 與 RTX 可見畫面須分別驗證。</p></details>
    {runId && filtered.length > 0 && <div aria-label="構件名稱、類別與樓層">
      <FailureScoreboard runId={runId} failed={filtered} />
    </div>}
    <div style={{ maxHeight: 360, overflow: "auto" }}>
      {filtered.map((row, index) => <details key={`${row.ifc_guid}:${row.rule_code}:${index}`}>
        <summary>{row.rule_code} · {row.severity} · {row.ifc_guid || "缺少構件 GUID"}</summary>
        <p>{row.message}</p>
        <p className="ec-note">{row.usd_prim_path || row.mapping_issue_code}</p>
        {!row.usd_prim_path && <p>此構件目前無法在模型中定位</p>}
        <button type="button" disabled={pending || !gate?.canSend || !row.usd_prim_path || !row.ifc_guid}
          onClick={() => { void send("focus", filtered, row.ifc_guid ?? undefined); }}>定位此構件</button>
      </details>)}
    </div>
  </section>;
}
