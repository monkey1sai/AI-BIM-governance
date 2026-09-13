import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { remediationCandidatesClient, type CandidatePage, type OriginalContext } from "./remediationCandidatesClient";
import { remediationClient, RemediationClientError, type RemediationCommand, type RemediationReceipt } from "./remediationClient";
import type { HistoryGroup, HistoryPage } from "./remediationHistoryClient";
import { RemediationHistoryPanel } from "./RemediationHistoryPanel";
import "./remediationConfirmation.css";

type Attempt = { command: Readonly<RemediationCommand>; state: "pending" | "uncertain" | "rejected" | "received";
  message?: string; receipt?: RemediationReceipt };
// In-page recovery only, never an authority/cache of permissions. Do not persist notes or actor data.
const attempts = new Map<string, Attempt>(), listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function warnBeforeLeaving(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
function publish(issueId: string, attempt?: Attempt) {
  if (attempt) attempts.set(issueId, attempt); else attempts.delete(issueId);
  window.removeEventListener("beforeunload", warnBeforeLeaving);
  if (Array.from(attempts.values()).some(a => a.state === "pending" || a.state === "uncertain")) {
    window.addEventListener("beforeunload", warnBeforeLeaving);
  }
  listeners.forEach(listener => listener());
}
const statuses = Object.assign(Object.create(null) as Record<string, string>, {
  open: "待處理", assigned: "已指派", in_progress: "處理中",
  resolved: "已解決", rejected: "已退回", reopened: "已重新開啟",
});
function denial(error: unknown): string | null {
  if (!(error instanceof RemediationClientError)) return null;
  const errors: Record<string, [number, string]> = {
    remediation_authorization_denied: [403, "您沒有權限確認這筆整改，請聯絡專案管理者。"],
    remediation_conflict: [409, "資料已更新，請重新載入並核對問題與修正版。"],
    remediation_evidence_invalid: [422, "整改證據不符合要求，請重新載入並選擇有效的檢核結果。"],
    remediation_authorization_unavailable: [503, "確認服務暫時無法使用，請稍後重新載入。"],
    remediation_persistence_unavailable: [503, "紀錄服務暫時無法使用，請稍後重新載入。"],
  };
  const known = errors[error.code];
  return known && known[0] === error.status ? known[1] : null;
}
function readError(error: unknown): string {
  const status = error !== null && typeof error === "object" && "status" in error ? error.status : 0;
  if (status === 403) return "您沒有權限查看整改證據，請聯絡專案管理者。";
  if (status === 503) return "證據服務暫時無法使用，請稍後重新載入。";
  return "無可用證據或資料不一致，請確認原始檢核與修正版後重新載入。";
}
function Group({ title, group }: { title: string; group: HistoryGroup }) {
  return <section aria-label={title}><h4>{title}</h4><p>模型版本：{group.model_version_id}</p><p>規則：{group.rule_code}</p>
    <p>通過 {group.members.filter(m => m.status === "pass").length} · 未通過 {group.members.filter(m => m.status === "fail").length}</p>
    <details><summary>診斷資料</summary><p>檢核紀錄：{group.run_id}</p><p>構件：{group.ifc_guid}</p><p>規則摘要：{group.rule_content_digest}</p></details>
  </section>;
}
async function send(issueId: string, command: Readonly<RemediationCommand>) {
  if (attempts.get(issueId)?.state === "pending") return;
  publish(issueId, { command, state: "pending" });
  try {
    // Do not abort POST on unmount: abort cannot roll back a server transaction.
    const receipt = await remediationClient.confirm(issueId, command);
    publish(issueId, { command, state: "received", receipt });
  } catch (error) {
    const message = denial(error);
    publish(issueId, { command, state: message ? "rejected" : "uncertain", message: message ?? undefined });
  }
}
type PanelProps = { issueId: string; originalRunId?: string; onIssueChanged?: (issue: HistoryPage["issue"]) => void };
function ConfirmationForm({ issueId, originalRunId, onIssueChanged }: PanelProps) {
  const [context, setContext] = useState<OriginalContext | null>(null), [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0), [page, setPage] = useState<CandidatePage | null>(null);
  const [selectedRun, setSelectedRun] = useState(""), [group, setGroup] = useState<HistoryGroup | null>(null);
  const [resultId, setResultId] = useState(""), [checked, setChecked] = useState(false), [note, setNote] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null), [pageError, setPageError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const snapshot = useCallback(() => attempts.get(issueId), [issueId]);
  const attempt = useSyncExternalStore(subscribe, snapshot);
  const locked = Boolean(attempt), busy = attempt?.state === "pending";
  useEffect(() => {
    let live = true; const controller = new AbortController();
    remediationCandidatesClient.loadOriginal(issueId, originalRunId, controller.signal).then(
      value => { if (live) setContext(value); }, e => { if (live) setError(readError(e)); });
    return () => { live = false; controller.abort(); };
  }, [issueId, originalRunId, refresh]);
  useEffect(() => {
    if (!context) return;
    let live = true; const controller = new AbortController();
    remediationCandidatesClient.list(context, offset, controller.signal).then(
      value => { if (live) setPage(value); }, e => { if (live) setPageError(readError(e)); });
    return () => { live = false; controller.abort(); };
  }, [context, offset, refresh]);
  useEffect(() => {
    if (!context || !selectedRun) return;
    let live = true; const controller = new AbortController();
    remediationCandidatesClient.select(context, selectedRun, controller.signal).then(
      value => { if (live) setGroup(value); }, e => { if (live) setSelectionError(readError(e)); });
    return () => { live = false; controller.abort(); };
  }, [context, selectedRun]);
  function resetSelection() { setSelectedRun(""); setGroup(null); setResultId(""); setChecked(false); setSelectionError(null); }
  function reload() {
    if (attempt?.state === "pending" || attempt?.state === "uncertain") return;
    publish(issueId); setContext(null); setError(null); setPage(null); setPageError(null);
    setOffset(0); resetSelection(); setNote(""); setRefresh(n => n + 1);
  }
  const canConfirm = !locked && context && group && checked && note.length <= 4000
    && ["open", "assigned", "in_progress", "reopened"].includes(context.issue.status)
    && group.members.some(m => m.id === resultId && m.status === "pass");
  function confirm() {
    if (!canConfirm || !context || !group || attempts.has(issueId)) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = "remediation:" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const command = Object.freeze({ expected_revision: context.issue.revision, revised_model_version_id: group.model_version_id,
      revised_run_id: group.run_id, revised_result_id: resultId, idempotency_key: key, note });
    void send(issueId, command);
  }
  return <section className="a1-remediation-confirmation" aria-label="整改確認" aria-busy={busy || (!context && !error)}>
    <header><div><h3>整改確認</h3><p>比對原版與修正版，核對後提交確認。</p></div>
      <button type="button" disabled={busy || attempt?.state === "uncertain"} onClick={reload}>重新載入並核對</button></header>
    {!context && !error && <p role="status">載入整改證據…</p>}
    {error && <p role="alert">{error}</p>}
    {context && <>
      {context.access?.actor_kind === "local_validation" && <p role="note">本地驗證模式：確認會記錄為本地驗證者，未連接公司正式身分權限。</p>}
      <p>讀取時狀態：{statuses[context.issue.status] ?? "狀態尚未確認"}</p>
      <div className="a1-remediation-confirmation__comparison">
        <Group title="原版" group={context.original}/>
        {group ? <Group title="修正版" group={group}/> : <section aria-label="修正版"><h4>修正版</h4><p>請選擇檢核紀錄與依據結果。</p></section>}
      </div>
      <fieldset disabled={locked}><legend>選擇修正版</legend>
        {!page && !pageError && <p role="status">載入修正版檢核…</p>}
        {pageError && <p role="alert">{pageError}</p>}
        {page && <>
          <label>修正版檢核<select aria-label="修正版檢核" value={selectedRun} onChange={e => { resetSelection(); setSelectedRun(e.target.value); }}>
            <option value="">請選擇檢核紀錄</option>{page.items.map((run, n) => <option key={run.id} value={run.id}>
              {run.version} · {run.finishedAt ? new Date(run.finishedAt).toLocaleString("zh-TW") : "時間未提供"} · 本頁第 {n + 1} 筆
            </option>)}</select></label>
          {!page.items.length && <p>本頁沒有可用的修正版檢核；可查看其他頁或重新載入。</p>}
          <nav aria-label="修正版檢核分頁"><button type="button" disabled={offset === 0} onClick={() => {
            resetSelection(); setPage(null); setPageError(null); setOffset(n => Math.max(0, n - 20));
          }}>上一頁</button><span>第 {Math.floor(offset / 20) + 1} 頁</span>
            <button type="button" disabled={page.nextOffset === null} onClick={() => {
              resetSelection(); setPage(null); setPageError(null); setOffset(page.nextOffset ?? offset);
            }}>下一頁</button></nav>
        </>}
        {selectedRun && !group && !selectionError && <p role="status">核對修正版證據…</p>}
        {selectionError && <p role="alert">{selectionError}</p>}
        {group && <label>依據結果<select aria-label="依據結果" value={resultId} onChange={e => { setResultId(e.target.value); setChecked(false); }}>
          <option value="">請選擇依據結果</option>{group.members.map((member, n) => <option key={member.id} value={member.id}>
            {member.rule_code} · 通過 · 結果 {n + 1}
          </option>)}</select></label>}
      </fieldset>
      <fieldset disabled={locked}><legend>人工核對</legend>
        <label className="a1-remediation-confirmation__check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>
          我已核對原版與修正版的構件及檢核結果</label>
        <label>整改說明<textarea aria-label="整改說明" maxLength={4000} rows={4} value={note} onChange={e => setNote(e.target.value)}/></label>
        <span>{note.length} / 4000</span>
      </fieldset>
      {!attempt && <p role="status">待確認。勾選核對不代表已取得權限，提交時仍由後端驗證。</p>}
      <button type="button" disabled={!canConfirm} onClick={confirm}>確認整改</button>
    </>}
    {busy && <p role="status">確認中，請勿重複提交。</p>}
    {attempt?.state === "uncertain" && <div role="alert"><p>結果尚未確認。請重試原確認；系統會沿用相同內容，不另建請求。</p>
      <p>離開或重新載入整個頁面會失去重試內容；重新進入時請先核對整改紀錄。</p>
      <button type="button" onClick={() => { void send(issueId, attempt.command); }}>重試原確認</button></div>}
    {attempt?.state === "rejected" && <p role="alert">{attempt.message}</p>}
    {attempt?.receipt && <>
      <p role="status">確認回應狀態：{statuses[attempt.receipt.issue.status] ?? "狀態尚未確認，請查看最新紀錄"}</p>
      <p>以下重新讀取目前狀態與歷史；歷史確認不代表問題目前已解決。</p>
      <RemediationHistoryPanel key={attempt.receipt.confirmation.id} issueId={issueId} onIssueChanged={onIssueChanged}/>
    </>}
  </section>;
}
export function RemediationConfirmationPanel(props: PanelProps) {
  // Force a fresh local form for every source identity, without dropping unresolved POST snapshots.
  return <ConfirmationForm key={JSON.stringify([props.issueId, props.originalRunId])} {...props}/>;
}
