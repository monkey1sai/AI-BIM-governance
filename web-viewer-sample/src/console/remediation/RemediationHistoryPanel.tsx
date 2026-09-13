import { useEffect, useState } from "react";
import { remediationHistoryClient, type HistoryGroup, type HistoryPage } from "./remediationHistoryClient";
import "./remediationHistory.css";
import { ReopenRemediation } from "./ReopenRemediation";

const statuses: Record<string, string> = { open: "待處理", assigned: "已指派", in_progress: "處理中",
  resolved: "已解決", rejected: "已退回", reopened: "已重新開啟" };
function EvidenceGroup({ title, value }: { title: string; value: HistoryGroup }) {
  return <section className="a1-remediation-history__evidence" aria-label={title}>
    <h4>{title}</h4><p>模型版本：{value.model_version_id}</p><p>規則：{value.rule_code}</p>
    <p>通過 {value.members.filter(m => m.status === "pass").length} · 未通過 {value.members.filter(m => m.status === "fail").length} · 評估失敗 {value.members.filter(m => m.status === "error").length}</p>
    <details><summary>診斷資料</summary><dl><dt>檢核紀錄</dt><dd>{value.run_id}</dd>
      <dt>構件</dt><dd>{value.ifc_guid}</dd><dt>規則摘要</dt><dd>{value.rule_content_digest}</dd>
      <dt>依據結果</dt><dd>{value.anchor_id}</dd></dl></details>
  </section>;
}
function errorText(error: unknown): string {
  const status = error !== null && typeof error === "object" && "status" in error ? error.status : 0;
  if (status === 403) return "您沒有權限查看這筆整改紀錄，請聯絡專案管理者。";
  if (status === 404) return "找不到這筆問題的整改紀錄，請重新選擇問題。";
  if (status === 503) return "整改紀錄服務暫時無法使用，請稍後重新整理。";
  return "整改紀錄讀取失敗，請重新整理。";
}
export function RemediationHistoryPanel({ issueId, onIssueChanged }: { issueId: string; onIssueChanged?: (issue: HistoryPage["issue"]) => void }) {
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ issueId: string; offset: number; refresh: number; page?: HistoryPage; error?: string } | null>(null);
  // Render-time identity guard also prevents one stale render before effect cleanup.
  const current = result?.issueId === issueId && result.offset === offset && result.refresh === refresh ? result : null;
  const loading = !current, page = current?.page;
  useEffect(() => { if (page) onIssueChanged?.(page.issue); }, [page, onIssueChanged]);
  useEffect(() => {
    const controller = new AbortController(); let live = true;
    remediationHistoryClient.read(issueId, offset, controller.signal).then(
      page => { if (live) setResult({ issueId, offset, refresh, page }); },
      error => { if (live) setResult({ issueId, offset, refresh, error: errorText(error) }); },
    );
    return () => { live = false; controller.abort(); };
  }, [issueId, offset, refresh]);
  return <section className="a1-remediation-history" aria-label="整改紀錄" aria-busy={loading}>
    <header><div><h3>整改紀錄</h3><p>歷史確認不代表問題目前已解決。</p></div>
      <button type="button" disabled={loading} onClick={() => { setOffset(0); setRefresh(n => n + 1); }}>重新整理</button></header>
    {loading && <p role="status">載入整改紀錄…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {page && <>
      {page.access?.actor_kind === "local_validation" && <p role="note">本地驗證模式：操作會記錄為本地驗證者，未連接公司正式身分權限。</p>}
      <p>目前狀態：<strong data-current-status={page.issue.status}>{statuses[page.issue.status]}</strong></p>
      {page.items.length === 0 && <p>尚無整改確認紀錄。</p>}
      {page.items.map(item => <article key={item.id}>
        <h4>整改確認 · {new Date(item.created_at).toLocaleString("zh-TW")}</h4>
        <p>確認者：{item.principal_ref}</p>
        {item.actor_kind === "local_validation" && <p>這筆確認來自本地驗證。</p>}
        <div className="a1-remediation-history__comparison"><EvidenceGroup title="原版" value={item.original}/><EvidenceGroup title="修正版" value={item.revised}/></div>
        <p className="a1-remediation-history__note">{item.note || "未附說明"}</p>
      </article>)}
      <ReopenRemediation key={`${issueId}:${page.issue.revision}`} issue={page.issue} onChanged={() => { setOffset(0); setRefresh(n => n + 1); }}/>
      <nav aria-label="整改紀錄分頁"><button type="button" disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 20))}>上一頁</button>
        <span>共 {page.total} 筆 · 第 {Math.floor(offset / 20) + 1} 頁</span>
        <button type="button" disabled={page.next_offset === null} onClick={() => setOffset(page.next_offset ?? offset)}>下一頁</button></nav>
    </>}
    <p className="a1-remediation-history__hint">分頁期間資料可能更新；重新整理會從第一頁開始。</p>
  </section>;
}
