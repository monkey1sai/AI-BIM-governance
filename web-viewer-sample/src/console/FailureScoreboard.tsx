import { useCallback, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn } from "./components";
import { FailureRow, governanceClient, RuleResultRow } from "./governanceClient";
// 失敗計數來自既有 getResults(id,"failed")；展開某規則才懶載入 getFailures（分頁、補 storey）。
const FAILURES_PAGE = 50;

function CopyGuidBtn({ guid }: { guid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ec-btn"
      style={{ padding: "1px 6px", fontSize: 11 }}
      title={t("複製 ifc_guid", "Copy ifc_guid")}
      onClick={() => {
        // navigator.clipboard 在非安全內容（http LAN）可能不存在 → 誠實降級，不假裝已複製。
        const clip = (navigator as { clipboard?: { writeText: (t: string) => Promise<void> } }).clipboard;
        if (!clip) return;
        void clip.writeText(guid).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? t("已複製", "Copied") : t("複製", "Copy")}
    </button>
  );
}
// export 供單元測試直接掛載驗收「同 tick 雙擊載入更多不得並行 fetch」（去重/鎖 spec §5）；
// 非頁面公開 API，僅 FailureScoreboard 內部使用。
export function FailureRuleRow({ runId, ruleCode, count }: { runId: string; ruleCode: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FailureRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 去重/鎖(spec §5)同步守門：setLoading(true) 在同一 event handler 內非同步可見(須等下一 render)，
  // 同 tick 雙擊「載入更多」時 loading 閉包值未刷新 → 兩個 loadPage(rows.length) 並行各自 append，
  // 產生重複行。loadingRef 為 mutable ref，set/clear 同步生效，能在第二次呼叫頂部立即攔截 in-flight 請求。
  const loadingRef = useRef(false);

  const loadPage = useCallback(async (offset: number) => {
    if (loadingRef.current) return; // 已有 in-flight loadPage → 同步擋掉並行的第二次呼叫(避免重複行)
    loadingRef.current = true;
    setLoading(true); setErr(null);
    try {
      const res = await governanceClient.getFailures(runId, ruleCode, FAILURES_PAGE, offset);
      setTotal(res.total);
      setRows((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
    } catch (e) {
      setErr(String(e));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [runId, ruleCode]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      // 去重/鎖(spec §5):loading 中再次 toggle(快速 close→open)時 rows 仍為 0、total 仍 null,
      // 沒有 !loading 會再觸發一次 loadPage(0),兩個並行 fetch 競速 setRows 造成閃爍/重複更新。
      if (next && rows.length === 0 && total === null && !loading) void loadPage(0);
      return next;
    });
  }, [rows.length, total, loading, loadPage]);

  const canLoadMore = total !== null && rows.length < total;

  return (
    <div className="ec-card" data-testid={`a1-fail-rule-${ruleCode}`} style={{ marginTop: 8 }}>
      <button
        type="button"
        className="ec-btn"
        data-testid={`a1-fail-toggle-${ruleCode}`}
        style={{ width: "100%", justifyContent: "space-between", display: "flex" }}
        onClick={toggle}
      >
        <span><strong>{ruleCode}</strong> · {count} {t("筆失敗", "failures")}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {err && <p className="ec-warn-note">{t("載入失敗構件失敗：", "Failed to load failed elements: ")}{err}</p>}
          {rows.length > 0 && (
            <table className="ec-table">
              <thead><tr><th>ifc_guid</th><th>ifc_name</th><th>ifc_type</th><th>storey</th><th></th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ifc_guid ?? "null"}-${i}`}>
                    <td><code>{r.ifc_guid ?? <span className="ec-warn-note">null</span>}</code></td>
                    <td>{r.ifc_name ?? "—"}</td>
                    <td>{r.ifc_type ?? "—"}</td>
                    <td>{r.storey ?? "—"}</td>
                    <td>{r.ifc_guid ? <CopyGuidBtn guid={r.ifc_guid} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {loading && <span className="ec-s">{t("載入中…（GET /api/governance/rule-runs/:id/failures）", "Loading… (GET /api/governance/rule-runs/:id/failures)")}</span>}
          {!loading && canLoadMore && (
            <Btn data-testid={`a1-fail-more-${ruleCode}`} caption={`${t("已載 ", "loaded ")}${rows.length}/${total}`} onClick={() => { void loadPage(rows.length); }}>
              {t("載入更多", "Load more")}
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

// 把 getResults(id,"failed") 的扁平列依 rule_code 聚合成「規則 → 失敗數」；全過規則不在此列（不可展開）。
export function FailureScoreboard({ runId, failed }: { runId: string; failed: RuleResultRow[] }) {
  const counts = new Map<string, number>();
  for (const r of failed) counts.set(r.rule_code, (counts.get(r.rule_code) ?? 0) + 1);
  const rules = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (rules.length === 0) return null;
  return (
    <div data-testid="a1-failures-by-rule" style={{ marginTop: 12 }}>
      <p className="ec-note" style={{ marginBottom: 4 }}>
        {t("失敗規則（點擊展開命中構件，懶載入分頁，補樓層、GUID 可複製）：", "Failed rules (click to expand matched elements; lazy-loaded paging, storey backfill, copyable GUID):")}
      </p>
      {rules.map(([code, count]) => (
        // key 含 runId:重跑同一規則 code 但換 runId 時,React 須建新 instance,
        // 否則沿用舊 instance 的 local state(已載入的 rows/total)會殘留上一輪的 GUID/storey。
        <FailureRuleRow key={`${runId}:${code}`} runId={runId} ruleCode={code} count={count} />
      ))}
    </div>
  );
}
