// A4 semantic search workbench — deterministic filters via coordinator → governance.
// B-loop binding: ifc-ready job / review session resolve host IFC path server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel } from "./components";
import {
  governanceClient,
  type ModelSearchResponse,
  type ModelSearchResultRow,
} from "./governanceClient";
import {
  coordinatorClient,
  type IfcReadyListItem,
  type RuntimeSessionSummary,
} from "./coordinatorClient";

const EXAMPLE_QUERIES = [
  "找 4F 防火門且 FireRating < 60",
  "IfcDoor",
  "1F 門",
  "FireRating >= 60",
];

type SourceMode = "session" | "ifc_ready" | "path";

export function A4SemanticSearchPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [sourceMode, setSourceMode] = useState<SourceMode>("ifc_ready");
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [jobId, setJobId] = useState("");
  const [path, setPath] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<ModelSearchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issueMsg, setIssueMsg] = useState<string | null>(null);
  const [issueBusy, setIssueBusy] = useState(false);

  const refreshSources = useCallback(async () => {
    setLoadErr(null);
    try {
      const [rt, ready] = await Promise.all([
        coordinatorClient.runtimeStatus().catch(() => null),
        coordinatorClient.listIfcReady().catch(() => null),
      ]);
      const sessionList = rt?.sessions?.items ?? [];
      setSessions(sessionList);
      if (!sessionId && sessionList[0]?.session_id) {
        setSessionId(sessionList[0].session_id);
      }
      const items = ready?.items ?? [];
      setJobs(items);
      if (!jobId) {
        const preferred =
          items.find((j) => j.conversion_status === "ready" || j.status === "ready") ?? items[0];
        if (preferred?.ifc_ready_job_id) setJobId(preferred.ifc_ready_job_id);
      }
    } catch (e) {
      setLoadErr(String(e));
    }
  }, [jobId, sessionId]);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  const interpreted = result?.interpreted_filters;
  const rows = result?.results ?? [];
  const matchedCount = result?.stats?.matched ?? 0;

  const canRun = useMemo(() => {
    if (!query.trim()) return false;
    if (sourceMode === "session") return Boolean(sessionId);
    if (sourceMode === "ifc_ready") return Boolean(jobId);
    return Boolean(path.trim());
  }, [query, sourceMode, sessionId, jobId, path]);

  async function onRun() {
    setBusy(true);
    setRunErr(null);
    setIssueMsg(null);
    setResult(null);
    setSelected(new Set());
    try {
      let res: ModelSearchResponse;
      if (sourceMode === "session") {
        res = await governanceClient.searchModelForSession(sessionId, { query: query.trim() });
      } else if (sourceMode === "ifc_ready") {
        res = await governanceClient.searchModelForIfcReady(jobId, { query: query.trim() });
      } else {
        res = await governanceClient.searchModel({
          ifc_source_path: path.trim(),
          query: query.trim(),
        });
      }
      setResult(res);
      if (res.status === "uninterpreted") {
        setRunErr(t("無法解譯問句 — 請用範例語法改寫", "Query not interpreted — rewrite using example grammar"));
      } else if ((res.results?.length ?? 0) === 0) {
        setRunErr(t("0 筆結果 — 放寬條件或確認模型內容", "0 results — broaden filters or check model content"));
      }
    } catch (e) {
      setRunErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleRow(guid: string | null) {
    if (!guid) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  function selectAllMatched() {
    setSelected(new Set(rows.map((r) => r.ifc_guid).filter(Boolean) as string[]));
  }

  async function onCreateIssues() {
    const targets = rows.filter((r) => r.ifc_guid && selected.has(r.ifc_guid));
    if (!targets.length) {
      setIssueMsg(t("請先勾選結果列", "Select result rows first"));
      return;
    }
    setIssueBusy(true);
    setIssueMsg(null);
    try {
      const created: string[] = [];
      for (const row of targets) {
        const issue = await governanceClient.createIssue({
          title: `[A4] ${row.name || row.ifc_class || row.ifc_guid}`,
          description: [
            "source=A4",
            `query=${result?.interpreted_filters?.raw_query ?? query}`,
            `evidence=${(row.evidence_refs || []).join("; ")}`,
            "bcf_gate=unavailable_until_provenance_bridge",
          ].join("\n"),
          severity: "medium",
          ifc_guid: row.ifc_guid,
          usd_prim_path: row.usd_prim_path,
          model_version_id: result?.model_version_id ?? undefined,
        });
        created.push(issue.id);
      }
      setIssueMsg(
        t(
          `已建立 ${created.length} 筆 Issue（source_type=manual；A4 尚無 BCF provenance bridge）`,
          `Created ${created.length} issue(s) (source_type=manual; no A4 BCF provenance bridge yet)`,
        ),
      );
    } catch (e) {
      setIssueMsg(String(e));
    } finally {
      setIssueBusy(false);
    }
  }

  return (
    <div className="ec-page" data-testid="a4-semantic-search-page">
      <h1 className="ec-h1">
        {t("A4 語意查詢與證據", "A4 Semantic query & evidence")}
        <span className="ec-prov ec-asbuilt" style={{ marginLeft: 8 }}>asbuilt · PARTIAL</span>
      </h1>
      <p className="ec-lead">
        {t(
          "可解釋過濾查詢（非 LLM 聊天）。B 閉環：session / ifc-ready → coordinator 解析 host IFC → :8004 /api/governance/search/* → governance POST /api/search/model。結果表為真實 API 回傳，非示意假數。",
          "Explainable filter search (not LLM chat). B-loop: session / ifc-ready → coordinator resolves host IFC → :8004 /api/governance/search/* → governance POST /api/search/model. Result table shows real API payload, not demo numbers.",
        )}
      </p>

      <div className="ec-grid-2" style={{ gap: 12 }}>
        <Panel title={t("查詢編排", "Query composer")} sub="POST /api/governance/search/model/*" prov="asbuilt">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {EXAMPLE_QUERIES.map((q) => (
              <Btn key={q} data-testid={`a4-example-${q.slice(0, 12)}`} onClick={() => setQuery(q)}>
                {q}
              </Btn>
            ))}
          </div>
          <label className="ec-field">
            <span>{t("問句 / 條件", "Query / filters")}</span>
            <textarea
              data-testid="a4-query-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              style={{ width: "100%" }}
            />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {(["ifc_ready", "session", "path"] as SourceMode[]).map((m) => (
              <Btn
                key={m}
                data-testid={`a4-source-${m}`}
                onClick={() => setSourceMode(m)}
                className={sourceMode === m ? "ec-btn-primary" : undefined}
              >
                {m}
              </Btn>
            ))}
            <Btn data-testid="a4-refresh-sources" onClick={() => void refreshSources()}>
              {t("重新整理來源", "Refresh sources")}
            </Btn>
          </div>
          {sourceMode === "session" && (
            <label className="ec-field" style={{ display: "block", marginTop: 8 }}>
              <span>session_id</span>
              <select data-testid="a4-session-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">{t("— 選擇 session —", "— select session —")}</option>
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>{s.session_id}</option>
                ))}
              </select>
            </label>
          )}
          {sourceMode === "ifc_ready" && (
            <label className="ec-field" style={{ display: "block", marginTop: 8 }}>
              <span>ifc_ready_job_id</span>
              <select data-testid="a4-job-select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">{t("— 選擇 ifc-ready job —", "— select ifc-ready job —")}</option>
                {jobs.map((j) => (
                  <option key={j.ifc_ready_job_id} value={j.ifc_ready_job_id}>
                    {j.ifc_ready_job_id} · {j.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sourceMode === "path" && (
            <label className="ec-field" style={{ display: "block", marginTop: 8 }}>
              <span>{t("host ifc_source_path（dev / 本機）", "host ifc_source_path (dev / local)")}</span>
              <input
                data-testid="a4-path-input"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="C:\\…\\a4_fire_doors.ifc"
                style={{ width: "100%" }}
              />
            </label>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Btn data-testid="a4-run" disabled={!canRun || busy} onClick={() => void onRun()}>
              {busy ? t("執行中…", "Running…") : t("執行查詢", "Run query")}
            </Btn>
          </div>
          {loadErr && <p className="ec-err" data-testid="a4-load-err">{loadErr}</p>}
          {runErr && <p className="ec-warn" data-testid="a4-run-err">{runErr}</p>}
        </Panel>

        <Panel title={t("解譯與統計", "Interpretation & stats")} sub="interpreted_filters" prov="asbuilt">
          {!result && <p className="ec-muted">{t("尚未執行", "Not run yet")}</p>}
          {result && (
            <>
              <Field k="status" v={result.status} prov="asbuilt" />
              <Field k="model_version_id" v={result.model_version_id ?? "—"} prov="asbuilt" />
              <Field
                k="interpretable"
                v={String(interpreted?.interpretable ?? false)}
                prov="asbuilt"
              />
              <Field
                k="ifc_classes"
                v={(interpreted?.ifc_classes ?? []).join(", ") || "—"}
                prov="asbuilt"
              />
              <Field
                k="storey_tokens"
                v={(interpreted?.storey_tokens ?? []).join(", ") || "—"}
                prov="asbuilt"
              />
              <Field
                k="property_filters"
                v={
                  (interpreted?.property_filters ?? [])
                    .map((p) => `${p.name}${p.op}${p.value}`)
                    .join(", ") || "—"
                }
                prov="asbuilt"
              />
              <Field
                k="confidence"
                v={
                  interpreted?.confidence == null
                    ? t("未定義（不可解譯）", "undefined (uninterpreted)")
                    : `${interpreted.confidence} (${interpreted.confidence_basis ?? "—"})`
                }
                prov="asbuilt"
              />
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <Metric label="matched" value={String(matchedCount)} />
                <Metric label="scanned" value={String(result.stats?.scanned ?? 0)} />
                <Metric label="unmapped" value={String(result.stats?.unmapped ?? 0)} />
              </div>
              {result.next_step && (
                <p className="ec-muted" data-testid="a4-next-step">next_step: {result.next_step}</p>
              )}
            </>
          )}
        </Panel>
      </div>

      <Panel
        title={t("真實查詢結果", "Real search results")}
        sub={
          result
            ? `status=${result.status} · matched=${matchedCount} · scanned=${result.stats?.scanned ?? 0}`
            : t("執行後顯示 governance 真實 JSON 結果", "Shows real governance JSON after run")
        }
        prov="asbuilt"
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <Btn data-testid="a4-select-all" disabled={!rows.length} onClick={selectAllMatched}>
            {t("全選匹配", "Select all matches")}
          </Btn>
          <Btn data-testid="a4-create-issues" disabled={!selected.size || issueBusy} onClick={() => void onCreateIssues()}>
            {issueBusy ? t("建立中…", "Creating…") : t(`批次建 Issue（${selected.size}）`, `Batch create issues (${selected.size})`)}
          </Btn>
        </div>
        {issueMsg && <p className="ec-muted" data-testid="a4-issue-msg">{issueMsg}</p>}
        <div className="ec-table-wrap">
          <table className="ec-table" data-testid="a4-results-table">
            <thead>
              <tr>
                <th />
                <th>guid</th>
                <th>class</th>
                <th>name</th>
                <th>storey</th>
                <th>prim</th>
                <th>evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="ec-muted">{t("無列", "No rows")}</td>
                </tr>
              )}
              {rows.map((row: ModelSearchResultRow) => {
                const guid = row.ifc_guid ?? "";
                return (
                  <tr key={guid || `${row.name}-${row.storey}`}>
                    <td>
                      <input
                        type="checkbox"
                        data-testid={`a4-row-check-${guid}`}
                        checked={Boolean(guid && selected.has(guid))}
                        disabled={!guid}
                        onChange={() => toggleRow(row.ifc_guid)}
                      />
                    </td>
                    <td className="mono">{row.ifc_guid ?? "—"}</td>
                    <td>{row.ifc_class}</td>
                    <td>{row.name ?? "—"}</td>
                    <td>{row.storey ?? "—"}</td>
                    <td className="mono">
                      {row.usd_prim_path ?? (
                        <span className="ec-muted">{row.highlight_eligible ? "—" : "unmapped"}</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {(row.evidence_refs || []).join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ec-muted" style={{ marginTop: 8 }}>
          {t(
            "3D 高亮：有 session + mapping 時請至 Review Room / viewer 以 client highlight 對 prim；本頁不偽造 GPU first frame。",
            "3D highlight: with session + mapping, use Review Room / viewer client highlight; this page does not fake GPU first frame.",
          )}
        </p>
      </Panel>
    </div>
  );
}
