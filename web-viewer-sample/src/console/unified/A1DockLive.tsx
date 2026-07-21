// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — A1Dock live 增強區塊（C3 slice 1）
// 只在 WorkspacePage /health probe 成功（liveBackend=true）時由 A1Dock 掛載；
// 離線/超時/例外時完全不渲染（fixture 殼維持像素零變化鐵則，design gate 的
// 離線預設擷取不受影響）。
// 資料誠實（R3）：本區塊打真 API（governanceClient → coordinator :8004 proxy），
// 一律標 data-prov="asbuilt"；失敗顯錯、空就空，不偽造。fixture 區塊維持
// data-prov="fixture" 不變。
// rule-run 邏輯走共用 hook useRuleRun（a1Machine reducer + pollGen 輪詢）；
// 來源沿用 library://（local_fs 檔案庫）邏輯三段，真 IFC path 由 coordinator
// server-side 解析（邊界 B1），不新增任何後端端點（R2）。
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { governanceClient, LIBRARY_IFC_PREFIX, parseLibraryIfcPath } from "../governanceClient";
import type { FileProjectRow, RuleRunHistoryItem } from "../governanceClient";
import { useRuleRun } from "../hooks/useRuleRun";
import { MONO, label9 } from "./fixtures";

const liveRoot: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgba(120,160,210,.14)", paddingTop: 10 };
const rowBox: CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "var(--ab-inset)", border: "1px solid rgba(120,160,210,.12)", borderRadius: 8, padding: "6px 9px" };
const noteStyle: CSSProperties = { fontSize: 10, color: "var(--ab-text-dim)" };
const warnStyle: CSSProperties = { fontSize: 10, color: "var(--ab-danger)", wordBreak: "break-all" };
const selectStyle: CSSProperties = { background: "var(--ab-inset)", color: "var(--ab-text)", border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, padding: "6px 8px", fontSize: 11, fontFamily: "inherit", minWidth: 0, width: "100%" };
const runBtn = (enabled: boolean): CSSProperties => ({
  textAlign: "center", fontSize: "11.5px", borderRadius: 8, padding: 7,
  cursor: enabled ? "pointer" : "not-allowed",
  color: enabled ? "var(--ab-accent-text)" : "var(--ab-text-dimmer)",
  border: `1px solid ${enabled ? "rgba(65,199,232,.3)" : "rgba(120,160,210,.14)"}`,
});

/** local_fs 檔案庫版本 → 唯一邏輯鍵 {projectId}/{modelId}/{version.name}（＝library:// 尾段）。
    不能用 version.path：proxy 對瀏覽器遮蔽成 "[server-path]"（全部選項同值）。 */
function flattenLibraryOptions(projects: FileProjectRow[]): { key: string; label: string }[] {
  return projects.flatMap((project) =>
    project.models.flatMap((model) =>
      model.versions.map((version) => ({
        key: `${project.project_id}/${model.model_id}/${version.name}`,
        label: `${project.project_id} · ${model.model_id} · ${version.name}`,
      })),
    ),
  );
}

export function A1DockLive({ zh }: { zh: boolean }) {
  const { state, dispatch, runId, run } = useRuleRun();
  const [history, setHistory] = useState<RuleRunHistoryItem[] | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [tree, setTree] = useState<FileProjectRow[] | null>(null);
  const [treeErr, setTreeErr] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");

  // 近期 rule-runs（GET /api/governance/rule-runs?limit=5）；失敗顯錯不偽造。
  useEffect(() => {
    let alive = true;
    governanceClient.listRuleRuns({ limit: 5 })
      .then((res) => { if (alive) { setHistory(res.items); setHistoryErr(null); } })
      .catch((e) => { if (alive) { setHistory([]); setHistoryErr(String(e)); } });
    return () => { alive = false; };
  }, [historyTick]);

  // local_fs 檔案庫（GET /api/governance/files/tree）供觸發一次 rule-run 的來源選擇。
  useEffect(() => {
    let alive = true;
    governanceClient.filesTree()
      .then((res) => { if (alive) { setTree(res.projects); setTreeErr(null); } })
      .catch((e) => { if (alive) { setTree([]); setTreeErr(String(e)); } });
    return () => { alive = false; };
  }, []);

  const options = useMemo(() => flattenLibraryOptions(tree ?? []), [tree]);
  // 健康 running（輪詢中）disabled 防雙擊；running-error 子態放行走 RUN_RETRY（spec §5）。
  const canRun = state.step !== "idle" && Boolean(state.ifcPath) && !(state.step === "running" && !state.runError);

  const doRun = async () => {
    if (!canRun) return;
    const ref = parseLibraryIfcPath(state.ifcPath);
    if (!ref) return; // ifcPath 只由合法 library:// 選項組出；防禦性守門
    const outcome = await run({ kind: "for-library", request: ref });
    // 有終態證據（成功或帶 status 的失敗）才 refresh 近期清單（證據型更新）。
    if (outcome.kind === "succeeded" || (outcome.kind === "failed" && outcome.run !== null)) {
      setHistoryTick((value) => value + 1);
    }
  };

  return (
    <div data-testid="a1dock-live" data-prov="asbuilt" style={liveRoot}>
      <span style={label9}>{zh ? "LIVE 後端 · 治理檢核" : "LIVE backend · rule runs"}</span>

      {/* ── 觸發一次 rule-run（library:// 來源；coordinator 解析 server-local path）── */}
      <select
        data-testid="a1dock-live-select"
        style={selectStyle}
        disabled={tree === null || Boolean(treeErr)}
        value={selectedKey}
        onChange={(e) => {
          const nextKey = e.target.value;
          setSelectedKey(nextKey);
          // 換檔即重置狀態機（PICK_FILE；空值回 idle）——舊 run 結果對新檔無意義。
          dispatch({
            type: "PICK_FILE",
            ifcPath: nextKey ? `${LIBRARY_IFC_PREFIX}${nextKey}` : "",
            modelVersionId: nextKey,
          });
        }}
      >
        <option value="">
          {treeErr
            ? (zh ? "（檔案庫不可用）" : "(file library unavailable)")
            : tree === null
              ? (zh ? "載入檔案庫…" : "Loading file library…")
              : options.length === 0
                ? (zh ? "（無 local_fs IFC）" : "(no local_fs IFC)")
                : (zh ? "— 選擇 IFC 檔案 —" : "— select an IFC —")}
        </option>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      {treeErr ? <span data-testid="a1dock-live-tree-error" style={warnStyle}>{treeErr}</span> : null}
      <span
        data-testid="a1dock-live-run"
        role="button"
        aria-disabled={canRun ? "false" : "true"}
        style={runBtn(canRun)}
        onClick={() => { void doRun(); }}
      >
        {state.step === "running" && !state.runError
          ? (zh ? "檢核中…" : "Validating…")
          : state.runError
            ? (zh ? "重試檢核" : "Retry validation")
            : (zh ? "執行規則檢核（真 API）" : "Run rule validation (real API)")}
      </span>
      {state.runError && state.error ? (
        <span data-testid="a1dock-live-run-error" style={warnStyle}>{zh ? "檢核失敗（可重試）：" : "Validation failed (retryable): "}{state.error}</span>
      ) : null}

      {/* ── 結果摘要（證據型：RUN_DONE 後才有 summary）── */}
      {state.run ? (
        <div data-testid="a1dock-live-summary" style={{ ...rowBox, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-2)", wordBreak: "break-all" }}>{runId ?? "—"} · {state.run.status}</span>
          <span style={noteStyle}>
            score {state.run.score ?? "—"} · passed {state.run.summary?.passed ?? "—"} · failed {state.run.summary?.failed ?? "—"}
          </span>
          {state.failed.slice(0, 3).map((row, i) => (
            <span key={`${row.rule_code}-${row.ifc_guid ?? i}`} style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-danger)", wordBreak: "break-all" }}>
              {row.rule_code} · {row.ifc_guid ?? "—"}
            </span>
          ))}
        </div>
      ) : null}

      {/* ── 近期 rule-runs（真資料；空就空）── */}
      <span style={label9}>{zh ? "近期 rule-runs" : "Recent rule runs"}</span>
      {historyErr ? <span data-testid="a1dock-live-history-error" style={warnStyle}>{historyErr}</span> : null}
      {history === null && !historyErr ? <span style={noteStyle}>{zh ? "載入中…" : "Loading…"}</span> : null}
      {history !== null && !historyErr && history.length === 0 ? (
        <span data-testid="a1dock-live-history-empty" style={noteStyle}>{zh ? "尚無 rule-run 紀錄。" : "No rule runs yet."}</span>
      ) : null}
      {history !== null && history.length > 0 ? (
        <div data-testid="a1dock-live-history" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {history.map((item) => (
            <div key={item.rule_run_id} style={rowBox}>
              <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-2)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.rule_run_id}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: item.status === "succeeded" ? "var(--ab-ok-text)" : item.status === "failed" ? "var(--ab-danger)" : "var(--ab-text-muted)" }}>{item.status}</span>
              <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dim)" }}>{item.score ?? "—"}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
