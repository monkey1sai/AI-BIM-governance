import { useState } from "react";
import { coordinatorUrl } from "../coordinatorClient";
import type { HistoryPage } from "./remediationHistoryClient";

export function ReopenRemediation({ issue, onChanged }: { issue: HistoryPage["issue"]; onChanged: () => void }) {
  const [checked, setChecked] = useState(false), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  if (!["resolved", "rejected"].includes(issue.status)) return null;
  async function reopen() {
    if (!checked || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(coordinatorUrl(`/api/governance/issues/${encodeURIComponent(issue.id)}/reopen-remediation`), {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "Content-Type": "application/json", "X-A1-Intent": "reopen" },
        body: JSON.stringify({ expected_revision: issue.revision, note }), signal: AbortSignal.timeout(15000),
      });
      if (response.status === 403) { setMessage("您沒有權限重新開啟這筆問題。"); return; }
      if (response.status === 409) { setMessage("問題狀態已更新，請重新整理後核對。"); return; }
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (value?.issue?.id !== issue.id || value.issue.status !== "reopened" || value.issue.revision !== issue.revision + 1) throw new Error();
      onChanged();
    } catch {
      setMessage("重新開啟的結果尚未確認。請重新整理並核對目前狀態，避免重複操作。");
    } finally { setBusy(false); setChecked(false); }
  }
  return <fieldset disabled={busy} aria-label="重新開啟問題">
    <legend>重新開啟問題</legend>
    <p>保留歷史整改證據；再次確認需新的修訂檢核證據。</p>
    <label>重開說明<textarea aria-label="重開說明" maxLength={4000} value={note} onChange={e => setNote(e.target.value)}/></label>
    <label><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)}/>我已核對並要重新開啟這筆問題</label>
    <button type="button" disabled={!checked || busy} onClick={() => { void reopen(); }}>重新開啟問題</button>
    {busy && <p role="status">重新開啟中…</p>}{message && <p role="alert">{message}</p>}
  </fieldset>;
}
