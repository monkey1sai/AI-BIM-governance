// A4 semantic search workbench — deterministic filters via coordinator → governance.
// B-loop binding: ifc-ready job / review session resolve host IFC path server-side.
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel } from "./components";
import {
  A4GovernanceError,
  governanceClient,
  type ModelSearchInterpretMode,
  type ModelSearchLlmStatus,
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
  "哪些四樓的門防火時效不到一小時？",
  "IfcDoor",
  "1F 門",
  "FireRating >= 60",
];

type SourceMode = "session" | "ifc_ready";

function a4RequestErrorCopy(error: unknown): string {
  if (error instanceof A4GovernanceError) {
    switch (error.code) {
      case "a4_authentication_required":
        return t("需要已登入的 A4 使用者身分。", "An authenticated A4 user identity is required.");
      case "a4_primary_authority_required":
        return t("需要此 session 的 active primary viewer 權限。", "An active primary viewer authority is required for this session.");
      case "a4_session_not_active":
        return t("此 Review Session 目前不是 active。", "This Review Session is not active.");
      case "a4_lab_scope_not_enabled":
        return t("本機 lab table-search capability 尚未啟用。", "Local lab table-search capability is not enabled.");
      case "a4_authentic_lease_unavailable":
        return t("認證 lease 能力尚未由 C-M4 提供。", "Authenticated lease capability is not yet available from C-M4.");
      case "governance_service_unavailable":
        return t("Governance 服務目前不可用，請稍後重試。", "The governance service is unavailable; retry shortly.");
      default:
        return t("A4 session 查詢暫時無法執行。", "The A4 session query cannot run at the moment.");
    }
  }
  return t("查詢服務目前不可用，請稍後重試。", "Search service is unavailable; retry shortly.");
}

function safeA4DiagnosticCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_]{1,96}$/i.test(value) ? value : "unknown";
}

export function A4SemanticSearchPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [sourceMode, setSourceMode] = useState<SourceMode>("session");
  const [interpretMode, setInterpretMode] = useState<ModelSearchInterpretMode>("auto");
  const [llmStatus, setLlmStatus] = useState<ModelSearchLlmStatus | null>(null);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [jobId, setJobId] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<ModelSearchResponse | null>(null);
  const [selectedProof, setSelectedProof] = useState<string | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [issueAssignee, setIssueAssignee] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueMessage, setIssueMessage] = useState<string | null>(null);

  const refreshSources = useCallback(async () => {
    setLoadErr(null);
    const [runtime, ready, llm] = await Promise.allSettled([
      coordinatorClient.runtimeStatus(),
      coordinatorClient.listIfcReady(),
      governanceClient.searchLlmStatus(),
    ]);
    const sourceUnavailable = runtime.status === "rejected" || ready.status === "rejected";
    if (sourceUnavailable) {
      setLoadErr(t("部分來源狀態暫時無法取得。", "Some source status is temporarily unavailable."));
    }
    setLlmStatus(llm.status === "fulfilled" ? llm.value : null);

    const activeSessions = runtime.status === "fulfilled"
      ? (runtime.value.sessions?.items ?? []).filter((session) => session.status === "active")
      : [];
    setSessions(activeSessions);
    setSessionId((current) => (
      current && activeSessions.some((session) => session.session_id === current)
        ? current
        : activeSessions[0]?.session_id ?? ""
    ));

    const items = ready.status === "fulfilled" ? ready.value.items ?? [] : [];
    setJobs(items);
    setJobId((current) => {
      if (current && items.some((job) => job.ifc_ready_job_id === current)) return current;
      const preferred = items.find((job) => job.conversion_status === "ready" || job.status === "ready") ?? items[0];
      return preferred?.ifc_ready_job_id ?? "";
    });
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  const interpreted = result?.interpreted_filters;
  const rows = result?.results ?? [];
  const matchedCount = result?.stats?.matched ?? 0;
  const selectedIssueRow = useMemo(
    () => rows.find((row) => row.evidence_proof === selectedProof && row.issue_eligible === true) ?? null,
    [rows, selectedProof],
  );
  const canCreateIssue = (
    sourceMode === "session"
    && result?.issue_eligible === true
    && Boolean(sessionId)
    && Boolean(selectedIssueRow?.evidence_proof)
  );

  const canRun = useMemo(() => {
    if (!query.trim()) return false;
    if (sourceMode === "session") {
      return sessions.some((session) => session.session_id === sessionId && session.status === "active");
    }
    return Boolean(jobId);
  }, [query, sourceMode, sessionId, jobId, sessions]);

  async function onRun(retryOfQueryId?: string) {
    setBusy(true);
    setRunErr(null);
    setResult(null);
    setSelectedProof(null);
    setIssueMessage(null);
    try {
      let res: ModelSearchResponse;
      if (sourceMode === "session") {
        res = await governanceClient.searchModelForSession(sessionId, {
          query: query.trim(),
          interpret_mode: interpretMode,
          retry_of_query_id: retryOfQueryId,
        });
      } else {
        res = await governanceClient.searchModelForIfcReady(jobId, {
          query: query.trim(),
          interpret_mode: interpretMode,
          retry_of_query_id: retryOfQueryId,
        });
      }
      setResult(res);
      if (res.status === "uninterpreted") {
        setRunErr(t("無法解譯問句 — 請用範例語法改寫", "Query not interpreted — rewrite using example grammar"));
      } else if (res.status === "semantic_error") {
        const code = safeA4DiagnosticCode(res.error_code);
        setRunErr(
          t(
            `語意解譯未完成（${code}）— 可重試或改用 deterministic。`,
            `Semantic interpretation did not complete (${code}) — retry or use deterministic.`,
          ),
        );
      } else if (res.status === "partial_fallback_confirmation_required") {
        setRunErr(
          t(
            "此部分解譯尚未執行；請確認只使用顯示的已解析條件進行表格查詢。",
            "This partial interpretation did not run; confirm the displayed filters for a table-only query.",
          ),
        );
      } else if (res.status === "partial_fallback_requires_trusted_context") {
        setRunErr(
          t(
            "此部分解譯需要已驗證 session 的二階段確認，未執行 IFC 掃描。",
            "This partial interpretation requires authenticated session confirmation; no IFC scan ran.",
          ),
        );
      } else if (res.status === "search_resource_limit_exceeded") {
        setRunErr(
          t(
            "查詢超出伺服器資源上限，未回傳不完整列；請縮小條件或改用較小模型。",
            "The query exceeded a server resource limit; no incomplete rows were returned. Narrow the query or use a smaller model.",
          ),
        );
      } else if ((res.results?.length ?? 0) === 0) {
        setRunErr(t("0 筆結果 — 放寬條件或確認模型內容", "0 results — broaden filters or check model content"));
      }
    } catch (error) {
      setRunErr(a4RequestErrorCopy(error));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmPartial() {
    const partialFallbackId = result?.partial_fallback_id;
    if (
      sourceMode !== "session" ||
      !sessionId ||
      result?.status !== "partial_fallback_confirmation_required" ||
      result.partial_confirmation_available !== true ||
      !partialFallbackId
    ) {
      return;
    }
    setBusy(true);
    setRunErr(null);
    setSelectedProof(null);
    setIssueMessage(null);
    try {
      const res = await governanceClient.confirmModelSearchPartialForSession(sessionId, partialFallbackId);
      setResult(res);
      if (res.status === "search_resource_limit_exceeded") {
        setRunErr(
          t(
            "已確認的部分查詢超出伺服器資源上限，未回傳不完整列。",
            "The confirmed partial query exceeded a server resource limit; no incomplete rows were returned.",
          ),
        );
      }
    } catch (error) {
      setRunErr(a4RequestErrorCopy(error));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateIssue() {
    const evidenceProof = selectedIssueRow?.evidence_proof;
    if (!canCreateIssue || !evidenceProof || !issueTitle.trim()) return;
    setIssueBusy(true);
    setIssueMessage(null);
    try {
      const created = await governanceClient.createA4IssueForSession(sessionId, {
        evidence_proof: evidenceProof,
        title: issueTitle.trim(),
        description: issueDescription || undefined,
        severity: issueSeverity,
        assignee: issueAssignee || undefined,
      });
      setIssueMessage(
        created.replayed
          ? t(`已保留既有 A4 Issue：${created.issue.id}`, `Existing A4 Issue retained: ${created.issue.id}`)
          : t(`A4 Issue 已建立：${created.issue.id}`, `A4 Issue created: ${created.issue.id}`),
      );
    } catch (error) {
      if (error instanceof A4GovernanceError && error.code === "a4_proof_expired") {
        setIssueMessage(t("此列 proof 已過期；草稿已保留，請重新執行查詢。", "This row proof expired; the draft is preserved. Rerun the query."));
      } else {
        setIssueMessage(a4RequestErrorCopy(error));
      }
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
          "可解釋查詢：deterministic 文法 或 Ornith vLLM（OpenAI-compatible）→ JSON filters → IFC 掃描。Key 只在 governance env（ORNITH_API_KEY），永不進 git。結果表為真實 API 回傳。",
          "Explainable search: deterministic grammar or Ornith vLLM (OpenAI-compatible) → JSON filters → IFC scan. API key only in governance env (ORNITH_API_KEY), never in git. Results are real API payloads.",
        )}
      </p>
      <Panel title={t("語意模型（Ornith）", "Semantic model (Ornith)")} sub="GET /api/governance/search/llm-status" prov="asbuilt">
        <Field
          k="enabled"
          v={llmStatus ? String(llmStatus.enabled) : t("未取得", "not observed")}
          prov="asbuilt"
        />
        <Field k="model" v={llmStatus?.model ?? "—"} prov="asbuilt" />
        <Field k="state" v={llmStatus?.state ?? "—"} prov="asbuilt" />
        <Field k="transport_class" v={llmStatus?.transport_class ?? "—"} prov="asbuilt" />
        <Field k="freshness" v={llmStatus?.freshness ?? "—"} prov="asbuilt" />
        {llmStatus?.error_code && <Field k="error_code" v={safeA4DiagnosticCode(llmStatus.error_code)} prov="asbuilt" />}
        {!llmStatus?.configured && (
          <p className="ec-warn" data-testid="a4-llm-missing">
            {t(
              "未設定 ORNITH_API_KEY / A4_LLM_API_KEY → semantic 模式會失敗；可用 deterministic 或 auto（僅文法）。",
              "ORNITH_API_KEY / A4_LLM_API_KEY not set → semantic mode fails; use deterministic or auto (grammar only).",
            )}
          </p>
        )}
      </Panel>

      <div className="ec-grid-2" style={{ gap: 12 }}>
        <Panel title={t("查詢編排", "Query composer")} sub="server-resolved session / ifc-ready table search" prov="asbuilt">
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
            {(["session", "ifc_ready"] as SourceMode[]).map((m) => (
              <Btn
                key={m}
                data-testid={`a4-source-${m}`}
                onClick={() => setSourceMode(m)}
                primary={sourceMode === m}
              >
                {m}
              </Btn>
            ))}
            <Btn data-testid="a4-refresh-sources" onClick={() => void refreshSources()}>
              {t("重新整理來源", "Refresh sources")}
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
          {sourceMode === "session" && sessions.length === 0 && (
            <p className="ec-warn" data-testid="a4-session-unavailable">
              {t(
                "目前沒有可供 A4 使用的 active Review Session；請先建立並取得相符的 primary viewer authority。",
                "No active Review Session is available for A4; create one and obtain matching primary viewer authority first.",
              )}
            </p>
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
              <Field k="query_id" v={result.query_id ?? "—"} prov="asbuilt" />
              <Field k="search_scope" v={result.search_scope ?? "table_only"} prov="asbuilt" />
              <Field k="interpret_mode" v={String(result.interpret_mode ?? interpretMode)} prov="asbuilt" />
              <Field k="interpret_source" v={interpreted?.interpret_source ?? "—"} prov="asbuilt" />
              <Field k="model_version_id" v={result.model_version_id ?? "—"} prov="asbuilt" />
              <Field
                k="interpretable"
                v={String(interpreted?.interpretable ?? false)}
                prov="asbuilt"
              />
              <Field k="complete" v={String(interpreted?.complete ?? false)} prov="asbuilt" />
              <Field
                k="unresolved_terms"
                v={(interpreted?.unresolved_terms ?? []).join(", ") || "—"}
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
              {result.session_binding && (
                <>
                  <Field k="session_binding.review_session_id" v={result.session_binding.review_session_id ?? "—"} prov="asbuilt" />
                  <Field k="session_binding.mapping_provenance" v={result.session_binding.mapping_provenance ?? "—"} prov="asbuilt" />
                  <Field k="session_binding.lease_capability" v={result.session_binding.primary_lease_capability ?? "—"} prov="asbuilt" />
                </>
              )}
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <Metric label="matched" value={String(matchedCount)} />
                <Metric label="scanned" value={String(result.stats?.scanned ?? 0)} />
                <Metric label="unmapped" value={String(result.stats?.unmapped ?? 0)} />
              </div>
              {result.partial_execution_confirmed === true && (
                <p className="ec-warn" data-testid="a4-partial-confirmed">
                  {t(
                    "已確認部分條件：結果僅供查表，不能用於 Issue 或 3D 動作。",
                    "Partial filters were confirmed: results are table-only and cannot drive Issue or 3D actions.",
                  )}
                </p>
              )}
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
          <Btn
            data-testid="a4-retry"
            disabled={!result?.query_id || result.status !== "semantic_error" || result.retryable !== true || busy}
            onClick={() => {
              if (result?.status === "semantic_error" && result.retryable === true && result.query_id) {
                void onRun(result.query_id);
              }
            }}
          >
            {t("重試查詢", "Retry query")}
          </Btn>
          <Btn
            data-testid="a4-confirm-partial"
            disabled={
              busy ||
              sourceMode !== "session" ||
              result?.status !== "partial_fallback_confirmation_required" ||
              result.partial_confirmation_available !== true ||
              !result.partial_fallback_id
            }
            onClick={() => void onConfirmPartial()}
          >
            {t("確認部分查詢", "Confirm partial query")}
          </Btn>
        </div>
        {result?.issue_eligible !== true && (
          <p className="ec-warn" data-testid="a4-table-only">
            {t(
              "目前結果僅供表格檢視；A4 Issue 需要完整 session-bound proof 與認證 lease。3D 動作仍保持停用。",
              "Results are table-only. A4 Issue requires a complete session-bound proof and authenticated lease; 3D actions remain disabled.",
            )}
          </p>
        )}
        {result?.issue_eligible === true && sourceMode === "session" && (
          <section className="ec-panel" data-testid="a4-issue-draft" style={{ marginBottom: 10 }}>
            <h3 className="ec-h3">{t("建立 A4 Issue", "Create A4 Issue")}</h3>
            <p className="ec-muted">
              {t(
                "先選取一列，再以該列短效 proof 明確確認。3D 與 DataChannel 不會由此頁啟動。",
                "Select one row, then explicitly confirm with its short-lived proof. This page never starts 3D or DataChannel actions.",
              )}
            </p>
            <label className="ec-field">
              <span>{t("標題", "Title")}</span>
              <input data-testid="a4-issue-title" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
            </label>
            <label className="ec-field">
              <span>{t("說明", "Description")}</span>
              <textarea data-testid="a4-issue-description" value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} rows={2} />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label className="ec-field">
                <span>{t("嚴重度", "Severity")}</span>
                <select data-testid="a4-issue-severity" value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <label className="ec-field">
                <span>{t("指派", "Assignee")}</span>
                <input data-testid="a4-issue-assignee" value={issueAssignee} onChange={(event) => setIssueAssignee(event.target.value)} />
              </label>
            </div>
            <Btn
              data-testid="a4-confirm-issue"
              disabled={!canCreateIssue || !issueTitle.trim() || issueBusy}
              onClick={() => void onCreateIssue()}
            >
              {issueBusy ? t("建立中…", "Creating…") : t("確認建立 A4 Issue", "Confirm A4 Issue")}
            </Btn>
            {selectedIssueRow?.proof_expires_at && <p className="ec-muted">proof_expires_at: {selectedIssueRow.proof_expires_at}</p>}
            {issueMessage && <p className="ec-warn" data-testid="a4-issue-message">{issueMessage}</p>}
          </section>
        )}
        <div className="ec-table-wrap">
          <table className="ec-table" data-testid="a4-results-table">
            <thead>
              <tr>
                <th>{t("選取", "select")}</th>
                <th>guid</th>
                <th>class</th>
                <th>{t("查詢分類", "query status")}</th>
                <th>name</th>
                <th>storey</th>
                <th>prim</th>
                <th>evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="ec-muted">{t("無列", "No rows")}</td>
                </tr>
              )}
              {rows.map((row: ModelSearchResultRow) => {
                const guid = row.ifc_guid ?? "";
                const rowProofEnabled = sourceMode === "session" && result?.issue_eligible === true && row.issue_eligible === true && Boolean(row.evidence_proof);
                return (
                  <tr key={guid || `${row.name}-${row.storey}`}>
                    <td>
                      <input
                        type="radio"
                        name="a4-selected-row"
                        aria-label={`select ${guid || row.name || "row"}`}
                        data-testid={`a4-select-row-${guid || "unknown"}`}
                        checked={Boolean(row.evidence_proof && selectedProof === row.evidence_proof)}
                        disabled={!rowProofEnabled}
                        onChange={() => {
                          if (!row.evidence_proof) return;
                          setSelectedProof(row.evidence_proof);
                          setIssueTitle((current) => current || `${t("A4 查詢列", "A4 query row")}: ${row.name ?? guid}`);
                          setIssueMessage(null);
                        }}
                      />
                    </td>
                    <td className="mono">{row.ifc_guid ?? "—"}</td>
                    <td>{row.ifc_class}</td>
                    <td>{row.match_status === "matched_query"
                      ? t("符合查詢條件", "matched query")
                      : t("未符合查詢條件", "not matched query")}</td>
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
            "本頁不直接開啟 viewer 或 DataChannel。只有完整 proof 的 session 列可經明確確認建立 Issue；mapping observation 本身不構成 3D 權限。",
            "This page does not open a viewer or DataChannel. Only complete-proof session rows may create an Issue after explicit confirmation; mapping observation alone is not 3D authority.",
          )}
        </p>
      </Panel>
    </div>
  );
}
