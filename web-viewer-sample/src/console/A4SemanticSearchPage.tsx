// A4 semantic search workbench — deterministic filters via coordinator → governance.
// B-loop binding: ifc-ready job / review session resolve host IFC path server-side.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel } from "./components";
import {
  governanceClient,
  type ModelSearchInterpretMode,
  type ModelSearchLlmStatus,
  type ModelSearchResponse,
  type ModelSearchResultRow,
} from "./governanceClient";
import {
  coordinatorClient,
  type IfcReadyListItem,
} from "./coordinatorClient";
import { getLocalDevUserCarrier } from "./localDevPrincipal";

const EXAMPLE_QUERIES = [
  "找 4F 防火門且 FireRating < 60",
  "哪些四樓的門防火時效不到一小時？",
  "IfcDoor",
  "1F 門",
  "FireRating >= 60",
];

const IFC_READY_SOURCE_LIMIT = 100;
const LLM_OPERATIONAL_CHECK_SOURCES = new Set([
  "query_observation",
  "bounded_probe",
  "last_query",
]);

export function A4SemanticSearchPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [interpretMode, setInterpretMode] = useState<ModelSearchInterpretMode>("auto");
  const [llmStatus, setLlmStatus] = useState<ModelSearchLlmStatus | null>(null);
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [jobId, setJobId] = useState("");
  const [sourceWindowTruncated, setSourceWindowTruncated] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<ModelSearchResponse | null>(null);
  const [llmReadinessExpired, setLlmReadinessExpired] = useState(false);
  const [llmReadinessExpiresAtMs, setLlmReadinessExpiresAtMs] = useState<number | null>(null);
  const llmStatusRequestIdRef = useRef(0);
  const sourceSelectionInitializedRef = useRef(false);

  const acceptLlmStatus = useCallback((nextStatus: ModelSearchLlmStatus) => {
    const expiresAtMs = nextStatus.freshness === "fresh" && nextStatus.ttl_s > 0
      ? performance.now() + nextStatus.ttl_s * 1000
      : null;
    setLlmStatus(nextStatus);
    setLlmReadinessExpired(false);
    setLlmReadinessExpiresAtMs(expiresAtMs);
  }, []);

  const refreshSources = useCallback(async () => {
    setSourcesLoading(true);
    setLoadErr(null);
    const llmStatusRequestId = ++llmStatusRequestIdRef.current;
    try {
      const [readyResult, llmResult] = await Promise.allSettled([
        coordinatorClient.listIfcReady(IFC_READY_SOURCE_LIMIT),
        governanceClient.searchLlmStatus(),
      ]);
      const failures: string[] = [];

      if (readyResult.status === "fulfilled") {
        setSourceWindowTruncated(readyResult.value.count > readyResult.value.items.length);
        const items = readyResult.value.items.filter((item) => item.download_status === "downloaded");
        setJobs(items);
        const preferred =
          items.find((j) => j.conversion_status === "ready" || j.status === "ready") ?? items[0];
        setJobId((current) => {
          if (items.some((item) => item.ifc_ready_job_id === current)) return current;
          if (!sourceSelectionInitializedRef.current && preferred) {
            sourceSelectionInitializedRef.current = true;
            return preferred.ifc_ready_job_id;
          }
          return "";
        });
      } else {
        setJobs([]);
        setJobId("");
        setSourceWindowTruncated(false);
        failures.push(t(
          "IFC-ready 來源清單載入失敗；請確認 coordinator 後重試。",
          "Failed to load IFC-ready sources. Check the coordinator and retry.",
        ));
      }

      if (llmStatusRequestId === llmStatusRequestIdRef.current) {
        if (llmResult.status === "fulfilled") {
          acceptLlmStatus(llmResult.value);
        } else {
          setLlmStatus(null);
          setLlmReadinessExpired(false);
          setLlmReadinessExpiresAtMs(null);
          failures.push(t(
            "LLM readiness 狀態載入失敗；semantic 不可宣稱可用。",
            "Failed to load LLM readiness. Semantic availability is not established.",
          ));
        }
      }

      if (failures.length) setLoadErr(failures.join(" "));
    } finally {
      setSourcesLoading(false);
    }
  }, [acceptLlmStatus]);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  useEffect(() => {
    if (llmReadinessExpiresAtMs == null) return undefined;
    const remainingMs = Math.max(0, llmReadinessExpiresAtMs - performance.now());
    if (remainingMs === 0) {
      setLlmReadinessExpired(true);
      return undefined;
    }
    const expiryTimer = window.setTimeout(() => {
      setLlmReadinessExpired(true);
    }, remainingMs);
    return () => window.clearTimeout(expiryTimer);
  }, [llmReadinessExpiresAtMs]);

  const refreshLlmStatusAfterRun = useCallback(async () => {
    const requestId = ++llmStatusRequestIdRef.current;
    setLlmReadinessExpired(true);
    setLlmReadinessExpiresAtMs(null);
    try {
      const nextStatus = await governanceClient.searchLlmStatus();
      if (requestId !== llmStatusRequestIdRef.current) return;
      acceptLlmStatus(nextStatus);
    } catch {
      // The search result remains authoritative; a status-only refresh failure
      // must not erase it, retain a stale readiness claim, or expose raw details.
      if (requestId === llmStatusRequestIdRef.current) setLlmReadinessExpired(true);
    }
  }, [acceptLlmStatus]);

  const interpreted = result?.interpreted_filters;
  const rows = result?.results ?? [];
  const matchedCount = result?.stats?.matched ?? 0;
  const displayedLlmState = llmReadinessExpired
    ? "unknown"
    : llmStatus?.state ?? t("未取得", "not observed");
  const displayedLlmFreshness = llmReadinessExpired
    ? "unknown"
    : llmStatus?.freshness ?? "unknown";
  const semanticReadinessEstablished = Boolean(
    llmStatus?.enabled === true
    && llmStatus.configured === true
    && llmStatus.state === "available"
    && llmStatus.freshness === "fresh"
    && LLM_OPERATIONAL_CHECK_SOURCES.has(llmStatus.check_source)
    && Boolean(llmStatus.checked_at)
    && llmStatus.ttl_s > 0
    && !llmReadinessExpired,
  );

  const canRun = useMemo(() => {
    return Boolean(query.trim() && jobId);
  }, [query, jobId]);

  async function onRun() {
    setBusy(true);
    setRunErr(null);
    setResult(null);
    try {
      const userToken = getLocalDevUserCarrier();
      const res: ModelSearchResponse = await governanceClient.searchModelForIfcReady(jobId, {
        query: query.trim(),
        interpret_mode: interpretMode,
      }, userToken);
      setResult(res);
      if (res.status === "uninterpreted") {
        setRunErr(t("無法解譯問句 — 請用範例語法改寫", "Query not interpreted — rewrite using example grammar"));
      } else if ((res.results?.length ?? 0) === 0) {
        setRunErr(t("0 筆結果 — 放寬條件或確認模型內容", "0 results — broaden filters or check model content"));
      }
    } catch (e) {
      setRunErr(String(e));
    } finally {
      if (interpretMode !== "deterministic") void refreshLlmStatusAfterRun();
      setBusy(false);
    }
  }

  const actionsUnavailableReason = t(
    "此 legacy 相容頁只提供查詢結果表；Issue 需 S4-C signed-proof route，3D 需 canonical handoff。未接通前兩者皆停用。",
    "This legacy compatibility page is table-only. Issues require the S4-C signed-proof route, and 3D requires the canonical handoff; both stay disabled until then.",
  );

  return (
    <div className="ec-page" data-testid="a4-semantic-search-page">
      <h1 className="ec-h1">
        {t("A4 語意查詢與證據", "A4 Semantic query & evidence")}
        <span className="ec-prov ec-asbuilt" style={{ marginLeft: 8 }}>asbuilt · PARTIAL</span>
      </h1>
      <p className="ec-lead">
        {t(
          "可解釋查詢：deterministic 文法 或 Ornith vLLM（OpenAI-compatible）→ JSON filters → IFC 掃描。Key 只在 governance env（ORNITH_API_KEY），永不進 git。結果表為真實 API 回傳。",
          "Explainable search: deterministic grammar or Ornith vLLM (OpenAI-compatible) → JSON filters → IFC scan. API key only in governance env (ORNITH_API_KEY), never in git. Results are real API payloads.",
        )}
      </p>
      <Panel title={t("語意模型（Ornith）", "Semantic model (Ornith)")} sub="GET /api/governance/search/llm-status" prov="asbuilt">
        <Field
          k="state"
          v={displayedLlmState}
          prov="asbuilt"
        />
        <Field k="configured_model" v={llmStatus?.model ?? "—"} prov="asbuilt" />
        <Field k="transport_class" v={llmStatus?.transport_class ?? "—"} prov="asbuilt" />
        <Field
          k="readiness_evidence"
          v={llmStatus ? `${llmStatus.check_source} · ${displayedLlmFreshness}` : "—"}
          prov="asbuilt"
        />
        {llmStatus?.error_code && <Field k="error_code" v={llmStatus.error_code} prov="asbuilt" />}
        {!semanticReadinessEstablished && (
          <p className="ec-warn" data-testid="a4-llm-missing">
            {t(
              "LLM live availability 尚未證實或證據已過期；semantic request 可能 fail closed，可用 deterministic，auto 只會依後端明示狀態降級。",
              "Live LLM availability is unproven or its evidence has expired. A semantic request may fail closed; deterministic remains available and auto degrades only when the backend says so.",
            )}
          </p>
        )}
      </Panel>

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
            <Btn data-testid="a4-source-ifc_ready" primary>
              ifc_ready
            </Btn>
            <Btn
              data-testid="a4-source-session"
              disabled
              caption={t(
                "legacy route 無法與 active primary viewer lease 共置；等待 canonical S4-D workspace",
                "The legacy route cannot co-locate an active primary viewer lease; awaiting the canonical S4-D workspace",
              )}
            >
              session
            </Btn>
            <Btn data-testid="a4-refresh-sources" disabled={sourcesLoading} onClick={() => void refreshSources()}>
              {sourcesLoading ? t("載入來源中…", "Loading sources…") : t("重新整理來源", "Refresh sources")}
            </Btn>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }} data-testid="a4-interpret-mode">
            <span className="ec-muted">{t("解譯模式", "Interpret mode")}:</span>
            {(["auto", "semantic", "deterministic"] as ModelSearchInterpretMode[]).map((m) => (
              <Btn
                key={m}
                data-testid={`a4-mode-${m}`}
                onClick={() => setInterpretMode(m)}
                primary={interpretMode === m}
              >
                {m}
              </Btn>
            ))}
          </div>
          <p className="ec-muted" style={{ marginTop: 6 }}>
            auto＝文法先、失敗再 Ornith；semantic＝強制 LLM；deterministic＝純文法。
          </p>
          <p className="ec-muted" data-testid="a4-auth-scope" style={{ marginTop: 6 }}>
            {t(
              "Auth：同一 Console runtime 的 ephemeral local_dev_lab carrier；production SSO 尚未綁定時由 server fail closed。",
              "Auth: an ephemeral local_dev_lab carrier shared by this Console runtime; the server fails closed until production SSO is bound.",
            )}
          </p>
          <label className="ec-field" style={{ display: "block", marginTop: 8 }}>
            <span>ifc_ready_job_id ({t("僅已下載", "downloaded only")})</span>
            <select data-testid="a4-job-select" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">{t("— 選擇 ifc-ready job —", "— select ifc-ready job —")}</option>
              {jobs.map((j) => (
                <option key={j.ifc_ready_job_id} value={j.ifc_ready_job_id}>
                  {j.ifc_ready_job_id} · {j.status}
                </option>
              ))}
            </select>
          </label>
          {sourceWindowTruncated && (
            <p className="ec-warn" data-testid="a4-source-truncated" style={{ marginTop: 8 }}>
              {t(
                `目前只檢查最新 ${IFC_READY_SOURCE_LIMIT} 筆 IFC-ready jobs；這不是完整集合，較舊的 downloaded job 可能未出現在清單。`,
                `Only the latest ${IFC_READY_SOURCE_LIMIT} IFC-ready jobs were checked. This is not a complete set, so an older downloaded job may be absent.`,
              )}
            </p>
          )}
          <p className="ec-note" data-testid="a4-source-scope-note" style={{ marginTop: 8 }}>
            {t(
              "ifc_ready_table_only：只顯示查詢結果，不具備 active viewer／Issue／3D authority；session flow 等 canonical S4-D workspace 共置 viewer lease 後才啟用。",
              "ifc_ready_table_only: results only; it has no active viewer, Issue, or 3D authority. Session flow stays disabled until the canonical S4-D workspace co-locates the viewer lease.",
            )}
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Btn data-testid="a4-run" disabled={!canRun || busy || sourcesLoading} onClick={() => void onRun()}>
              {busy ? t("執行中…", "Running…") : t("執行查詢", "Run query")}
            </Btn>
          </div>
          {sourcesLoading && (
            <p className="ec-muted" data-testid="a4-source-loading">
              {t("正在載入可用來源與 readiness…", "Loading available sources and readiness…")}
            </p>
          )}
          {loadErr && <p className="ec-err" data-testid="a4-load-err">{loadErr}</p>}
          {runErr && <p className="ec-warn" data-testid="a4-run-err">{runErr}</p>}
        </Panel>

        <Panel title={t("解譯與統計", "Interpretation & stats")} sub="interpreted_filters" prov="asbuilt">
          {!result && <p className="ec-muted">{t("尚未執行", "Not run yet")}</p>}
          {result && (
            <>
              <Field k="status" v={result.status} prov="asbuilt" />
              <Field k="interpret_mode" v={String(result.interpret_mode ?? interpretMode)} prov="asbuilt" />
              <Field k="search_scope" v={result.search_scope ?? "not_observed"} prov="asbuilt" />
              {/* UI capability scope and backend scan completeness are deliberately separate evidence fields. */}
              <Field k="completion_scope" v="table_only" prov="asbuilt" />
              <Field k="result_scan_scope" v={result.completion_scope ?? "not_observed"} prov="asbuilt" />
              <Field k="interpret_source" v={interpreted?.interpret_source ?? "—"} prov="asbuilt" />
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
          <Btn data-testid="a4-create-issues" disabled caption={actionsUnavailableReason}>
            {t("Issue 尚不可用", "Issue unavailable")}
          </Btn>
        </div>
        <p className="ec-note" data-testid="a4-actions-unavailable">
          {actionsUnavailableReason}
        </p>
        <div className="ec-table-wrap">
          <table className="ec-table" data-testid="a4-results-table">
            <thead>
              <tr>
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
                  <td colSpan={6} className="ec-muted">{t("無列", "No rows")}</td>
                </tr>
              )}
              {rows.map((row: ModelSearchResultRow) => {
                const guid = row.ifc_guid ?? "";
                return (
                  <tr key={guid || `${row.name}-${row.storey}`}>
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
            "3D：此 legacy table 不建立 handoff、不送 DataChannel，也不把 mapping 欄位視為 runtime authority。",
            "3D: this legacy table creates no handoff, sends no DataChannel message, and does not treat a mapping field as runtime authority.",
          )}
        </p>
      </Panel>
    </div>
  );
}
