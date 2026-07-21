// A4 semantic search workbench — deterministic filters via coordinator → governance.
// B-loop binding: ifc-ready job / review session resolve host IFC path server-side.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      case "a4_session_not_found":
        return t("找不到指定的 Review Session；請重新整理來源後再選擇。", "The requested Review Session was not found; refresh sources and choose again.");
      case "a4_session_source_unavailable":
        return t("此 session 的 IFC 來源暫時不可用；請檢查轉檔狀態後重試。", "This session's IFC source is unavailable; check conversion status and retry.");
      case "stale_session_artifact":
        return t("此 session 的模型 binding 已變更；請重新整理來源並重跑查詢。", "This session's model binding changed; refresh sources and rerun the query.");
      case "a4_lab_scope_not_enabled":
        return t("本機 lab table-search capability 尚未啟用。", "Local lab table-search capability is not enabled.");
      case "a4_authentic_lease_unavailable":
        return t("認證 lease 能力尚未由 C-M4 提供。", "Authenticated lease capability is not yet available from C-M4.");
      case "partial_fallback_unavailable":
        return t(
          "部分查詢確認已過期或 binding 已改變；原問句與模式已保留，請重新執行原查詢。",
          "Partial confirmation expired or its binding changed. The original query and mode are preserved; rerun the query.",
        );
      case "a4_proof_expired":
      case "a4_proof_unavailable":
        return t("此列 proof 已失效；草稿已保留，請重跑原查詢並重新選列。", "This row proof is unavailable. The draft is preserved; rerun the original query and select the row again.");
      case "a4_issue_not_eligible":
        return t("此列目前不符合 Issue 建立條件；請確認完整查詢、lease 與最新 binding。", "This row is not eligible for Issue creation; verify a complete query, lease, and current binding.");
      case "a4_authentication_unavailable":
      case "a4_trusted_context_unavailable":
        return t("A4 認證／可信 context 暫時不可用。", "A4 authentication or trusted context is unavailable.");
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

const A4_SESSION_ID_RE = /^review_session_[A-Za-z0-9_-]+$/;
const A4_SESSION_STORAGE_KEY = "aibim:a4-session-context";

function firstValidA4SessionId(candidates: unknown[]): string {
  const candidate = candidates.find(
    (value): value is string => typeof value === "string" && A4_SESSION_ID_RE.test(value),
  );
  return candidate ?? "";
}

function initialA4SessionId(): string {
  if (typeof window === "undefined") return "";
  const historyCandidate = (window.history.state as { a4SessionId?: unknown } | null)?.a4SessionId;
  let storedCandidate: string | null = null;
  try {
    storedCandidate = window.sessionStorage.getItem(A4_SESSION_STORAGE_KEY);
  } catch {
    // Storage is optional; history.state remains the first source.
  }
  return firstValidA4SessionId([historyCandidate, storedCandidate]);
}

export function normalizedLlmReadiness(
  status: ModelSearchLlmStatus | null,
  nowMs = Date.now(),
  receivedAtMs: number | null = null,
): string {
  if (!status) return "—";
  if (status.state !== "available" && status.state !== "unavailable") return status.state;
  const checkedAtMs = typeof status.checked_at === "string"
    ? Date.parse(status.checked_at)
    : Number.NaN;
  const observationIsFresh = (
    status.freshness === "fresh"
    && Number.isFinite(status.ttl_s)
    && status.ttl_s > 0
    && Number.isFinite(checkedAtMs)
    && receivedAtMs !== null
    && Number.isFinite(receivedAtMs)
    && receivedAtMs + status.ttl_s * 1000 > nowMs
    && status.check_source !== "config"
  );
  return observationIsFresh ? status.state : "unknown";
}

interface A4ResultContext {
  sourceMode: SourceMode;
  sessionId: string;
  jobId: string;
  query: string;
  interpretMode: ModelSearchInterpretMode;
}

interface A4IssueOutcome {
  rowKey: string;
  status: "created" | "replayed" | "failed";
  issueId?: string;
  message?: string;
}

export function A4SemanticSearchPage() {
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [sourceMode, setSourceMode] = useState<SourceMode>("session");
  const [interpretMode, setInterpretMode] = useState<ModelSearchInterpretMode>("auto");
  const [llmStatus, setLlmStatus] = useState<ModelSearchLlmStatus | null>(null);
  const [llmStatusReceivedAtMs, setLlmStatusReceivedAtMs] = useState<number | null>(null);
  const [llmClockMs, setLlmClockMs] = useState(() => Date.now());
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [sessionId, setSessionId] = useState(initialA4SessionId);
  const [jobId, setJobId] = useState("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [result, setResult] = useState<ModelSearchResponse | null>(null);
  const [resultContext, setResultContext] = useState<A4ResultContext | null>(null);
  const [selectedProofs, setSelectedProofs] = useState<string[]>([]);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [issueAssignee, setIssueAssignee] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueMessage, setIssueMessage] = useState<string | null>(null);
  const [issueOutcomes, setIssueOutcomes] = useState<A4IssueOutcome[]>([]);
  const llmStatusRequestId = useRef(0);
  const sourceRequestId = useRef(0);

  const refreshLlmStatus = useCallback(async () => {
    const requestId = ++llmStatusRequestId.current;
    try {
      const status = await governanceClient.searchLlmStatus();
      if (requestId !== llmStatusRequestId.current) return;
      const receivedAtMs = Date.now();
      setLlmStatus(status);
      setLlmStatusReceivedAtMs(receivedAtMs);
      setLlmClockMs(receivedAtMs);
    } catch {
      if (requestId !== llmStatusRequestId.current) return;
      setLlmStatus(null);
      setLlmStatusReceivedAtMs(null);
      setLlmClockMs(Date.now());
    }
  }, []);

  const refreshSources = useCallback(async () => {
    const requestId = ++sourceRequestId.current;
    setLoadErr(null);
    const [runtime, ready] = await Promise.allSettled([
      coordinatorClient.runtimeStatus(),
      coordinatorClient.listIfcReady(),
      refreshLlmStatus(),
    ]);
    if (requestId !== sourceRequestId.current) return;
    const sourceUnavailable = runtime.status === "rejected" || ready.status === "rejected";
    if (sourceUnavailable) {
      setLoadErr(t("部分來源狀態暫時無法取得。", "Some source status is temporarily unavailable."));
    }

    const activeSessions = runtime.status === "fulfilled"
      ? (runtime.value.sessions?.items ?? []).filter((session) => session.status === "active")
      : [];
    setSessions(activeSessions);
    setSessionId((current) => (
      current || activeSessions[0]?.session_id || ""
    ));

    const items = ready.status === "fulfilled" ? ready.value.items ?? [] : [];
    setJobs(items);
    setJobId((current) => {
      if (current && items.some((job) => job.ifc_ready_job_id === current)) return current;
      const preferred = items.find((job) => job.conversion_status === "ready" || job.status === "ready") ?? items[0];
      return preferred?.ifc_ready_job_id ?? "";
    });
  }, [refreshLlmStatus]);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  useEffect(() => {
    setLlmClockMs(Date.now());
    if (
      llmStatus?.freshness !== "fresh"
      || !Number.isFinite(llmStatus.ttl_s)
      || llmStatus.ttl_s <= 0
      || typeof llmStatus.checked_at !== "string"
      || !Number.isFinite(Date.parse(llmStatus.checked_at))
      || llmStatus.check_source === "config"
      || llmStatusReceivedAtMs === null
    ) {
      return undefined;
    }
    const expiresAtMs = llmStatusReceivedAtMs + llmStatus.ttl_s * 1000;
    if (!Number.isFinite(expiresAtMs)) return undefined;
    const timer = window.setTimeout(
      () => setLlmClockMs(Date.now()),
      Math.max(0, expiresAtMs - Date.now()) + 1,
    );
    return () => window.clearTimeout(timer);
  }, [llmStatus, llmStatusReceivedAtMs]);

  const resultContextMatchesCurrent = Boolean(
    resultContext
    && resultContext.sourceMode === sourceMode
    && (
      sourceMode === "session"
        ? resultContext.sessionId === sessionId
        : resultContext.jobId === jobId
    )
    && resultContext.query === query.trim()
    && resultContext.interpretMode === interpretMode,
  );

  useEffect(() => {
    if (!resultContext || resultContextMatchesCurrent) return;
    setResult(null);
    setResultContext(null);
    setRunErr(null);
    setSelectedProofs([]);
    setIssueMessage(null);
    setIssueOutcomes([]);
    setIssueTitle("");
    setIssueDescription("");
    setIssueSeverity("medium");
    setIssueAssignee("");
  }, [resultContext, resultContextMatchesCurrent]);

  const interpreted = result?.interpreted_filters;
  const rows = result?.results ?? [];
  const matchedCount = result?.stats?.matched ?? 0;
  const selectedIssueRows = useMemo(
    () => rows.filter(
      (row) => row.issue_eligible === true
        && typeof row.evidence_proof === "string"
        && selectedProofs.includes(row.evidence_proof),
    ),
    [rows, selectedProofs],
  );
  const selectedSessionUnavailable = Boolean(
    sessionId && !sessions.some((session) => session.session_id === sessionId && session.status === "active"),
  );
  const canCreateIssue = (
    sourceMode === "session"
    && result?.issue_eligible === true
    && resultContextMatchesCurrent
    && resultContext?.sourceMode === "session"
    && result.session_binding?.review_session_id === resultContext.sessionId
    && Boolean(sessionId)
    && !selectedSessionUnavailable
    && selectedIssueRows.length > 0
  );
  const canConfirmPartial = Boolean(
    resultContextMatchesCurrent
    && resultContext?.sourceMode === "session"
    && !selectedSessionUnavailable
    && result?.status === "partial_fallback_confirmation_required"
    && result.partial_confirmation_available === true
    && result.partial_fallback_id,
  );
  const canRetryResult = Boolean(
    resultContextMatchesCurrent
    && !selectedSessionUnavailable
    && result?.query_id
    && result.retryable === true
    && (result.status === "semantic_error" || result.status === "partial_fallback_unavailable"),
  );

  const canRun = useMemo(() => {
    if (!query.trim()) return false;
    if (sourceMode === "session") {
      return sessions.some((session) => session.session_id === sessionId && session.status === "active");
    }
    return Boolean(jobId);
  }, [query, sourceMode, sessionId, jobId, sessions]);

  async function onRun(retryOfQueryId?: string, retryContext?: A4ResultContext) {
    const requestContext: A4ResultContext = retryContext ?? {
      sourceMode,
      sessionId,
      jobId,
      query: query.trim(),
      interpretMode,
    };
    setBusy(true);
    setRunErr(null);
    setResult(null);
    setResultContext(null);
    setSelectedProofs([]);
    setIssueMessage(null);
    setIssueOutcomes([]);
    try {
      let res: ModelSearchResponse;
      if (requestContext.sourceMode === "session") {
        res = await governanceClient.searchModelForSession(requestContext.sessionId, {
          query: requestContext.query,
          interpret_mode: requestContext.interpretMode,
          retry_of_query_id: retryOfQueryId,
        });
      } else {
        res = await governanceClient.searchModelForIfcReady(requestContext.jobId, {
          query: requestContext.query,
          interpret_mode: requestContext.interpretMode,
          retry_of_query_id: retryOfQueryId,
        });
      }
      setResult(res);
      setResultContext(requestContext);
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
      } else if (res.status === "partial_fallback_unavailable") {
        setRunErr(
          t(
            "部分查詢確認容量暫時不可用；原問句與模式已保留，請稍後重試原查詢。",
            "Partial confirmation capacity is temporarily unavailable. The original query and mode are preserved; retry the original query later.",
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
      void refreshLlmStatus();
    }
  }

  async function onConfirmPartial() {
    const partialFallbackId = result?.partial_fallback_id;
    if (
      !canConfirmPartial ||
      !resultContext ||
      !partialFallbackId
    ) {
      return;
    }
    setBusy(true);
    setRunErr(null);
    setSelectedProofs([]);
    setIssueMessage(null);
    setIssueOutcomes([]);
    try {
      const res = await governanceClient.confirmModelSearchPartialForSession(
        resultContext.sessionId,
        partialFallbackId,
      );
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
      if (error instanceof A4GovernanceError && error.code === "partial_fallback_unavailable") {
        setResult((current) => current ? {
          ...current,
          status: "partial_fallback_unavailable",
          retryable: true,
          partial_confirmation_available: false,
          partial_fallback_id: null,
          partial_fallback_expires_at: null,
          next_step: "rerun_original_query",
        } : current);
      }
      setRunErr(a4RequestErrorCopy(error));
    } finally {
      setBusy(false);
      void refreshLlmStatus();
    }
  }

  async function onCreateIssue() {
    if (!canCreateIssue || !issueTitle.trim()) return;
    const selectedRows = selectedIssueRows.slice();
    const draft = {
      title: issueTitle.trim(),
      description: issueDescription || undefined,
      severity: issueSeverity,
      assignee: issueAssignee || undefined,
    };
    setIssueBusy(true);
    setIssueMessage(null);
    setIssueOutcomes([]);
    const outcomes: A4IssueOutcome[] = [];
    for (const row of selectedRows) {
      const rowKey = row.ifc_guid || row.name || "unknown-row";
      try {
        const created = await governanceClient.createA4IssueForSession(resultContext!.sessionId, {
          evidence_proof: row.evidence_proof as string,
          ...draft,
        });
        outcomes.push({
          rowKey,
          status: created.replayed ? "replayed" : "created",
          issueId: created.issue.id,
        });
      } catch (error) {
        const message = error instanceof A4GovernanceError && error.code === "a4_proof_expired"
          ? t(
            "proof 已過期；此草稿已保留，請重新執行原查詢並重新核對。",
            "The proof expired. This draft is preserved; rerun the original query and review the row again.",
          )
          : a4RequestErrorCopy(error);
        outcomes.push({ rowKey, status: "failed", message });
      }
    }
    setIssueOutcomes(outcomes);
    const successful = outcomes.filter((outcome) => outcome.status !== "failed").length;
    const failed = outcomes.length - successful;
    setIssueMessage(
      failed === 0
        ? t(`已建立／保留 ${successful} 個 A4 Issue。`, `${successful} A4 Issue(s) created or retained.`)
        : t(
          `${successful} 列成功、${failed} 列失敗；失敗列草稿與復原指引已保留。`,
          `${successful} row(s) succeeded and ${failed} failed; failed-row draft and recovery guidance are preserved.`,
        ),
    );
    setIssueBusy(false);
  }

  const llmReadiness = normalizedLlmReadiness(
    llmStatus,
    llmClockMs,
    llmStatusReceivedAtMs,
  );
  const llmFreshness = (
    llmReadiness === "unknown" && llmStatus?.freshness === "fresh"
      ? "stale"
      : llmStatus?.freshness ?? "—"
  );
  const contextControlsDisabled = busy || issueBusy;

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
        <Field k="state" v={llmReadiness} prov="asbuilt" />
        <Field k="transport_class" v={llmStatus?.transport_class ?? "—"} prov="asbuilt" />
        <Field k="freshness" v={llmFreshness} prov="asbuilt" />
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
              <Btn
                key={q}
                data-testid={`a4-example-${q.slice(0, 12)}`}
                disabled={contextControlsDisabled}
                onClick={() => setQuery(q)}
              >
                {q}
              </Btn>
            ))}
          </div>
          <label className="ec-field">
            <span>{t("問句 / 條件", "Query / filters")}</span>
            <textarea
              data-testid="a4-query-input"
              value={query}
              disabled={contextControlsDisabled}
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
                disabled={contextControlsDisabled || m === "ifc_ready"}
                title={m === "ifc_ready"
                  ? t(
                    "此 build 未啟用可信的 ifc-ready table-only resolver。",
                    "This build has no trusted ifc-ready table-only resolver enabled.",
                  )
                  : undefined}
              >
                {m}
              </Btn>
            ))}
            <Btn
              data-testid="a4-refresh-sources"
              disabled={contextControlsDisabled}
              onClick={() => void refreshSources()}
            >
              {t("重新整理來源", "Refresh sources")}
            </Btn>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }} data-testid="a4-interpret-mode">
            <span className="ec-muted">{t("解譯模式", "Interpret mode")}:</span>
            {(["auto", "semantic", "deterministic"] as ModelSearchInterpretMode[]).map((m) => (
              <Btn
                key={m}
                data-testid={`a4-mode-${m}`}
                disabled={contextControlsDisabled}
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
              <select
                data-testid="a4-session-select"
                value={sessionId}
                disabled={contextControlsDisabled}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">{t("— 選擇 session —", "— select session —")}</option>
                {selectedSessionUnavailable && (
                  <option value={sessionId}>{sessionId} · {t("不可用", "unavailable")}</option>
                )}
                {sessions.map((s) => (
                  <option key={s.session_id} value={s.session_id}>{s.session_id}</option>
                ))}
              </select>
            </label>
          )}
          {sourceMode === "session" && (sessions.length === 0 || selectedSessionUnavailable) && (
            <p className="ec-warn" data-testid="a4-session-unavailable">
              {t(
                selectedSessionUnavailable
                  ? "指定的 Review Session 不可用或已失效；不會自動改用另一個 session。"
                  : "目前沒有可供 A4 使用的 active Review Session；請先建立並取得相符的 primary viewer authority。",
                selectedSessionUnavailable
                  ? "The requested Review Session is unavailable or inactive; A4 will not silently switch to another session."
                  : "No active Review Session is available for A4; create one and obtain matching primary viewer authority first.",
              )}
            </p>
          )}
          <p className="ec-muted" data-testid="a4-ifc-ready-unavailable">
            {t(
              "ifc-ready 相容查詢目前不可用；不會以攔截回應或本機 path fallback 取代可信 resolver。",
              "The ifc-ready compatibility query is unavailable; intercepted responses and local-path fallbacks are not trusted resolver substitutes.",
            )}
          </p>
          {sourceMode === "ifc_ready" && (
            <label className="ec-field" style={{ display: "block", marginTop: 8 }}>
              <span>ifc_ready_job_id</span>
              <select
                data-testid="a4-job-select"
                value={jobId}
                disabled={contextControlsDisabled}
                onChange={(e) => setJobId(e.target.value)}
              >
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
            <Btn data-testid="a4-run" disabled={!canRun || contextControlsDisabled} onClick={() => void onRun()}>
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
              <Field k="search_scope" v={result.search_scope ?? "—"} prov="asbuilt" />
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
            disabled={!canRetryResult || contextControlsDisabled}
            onClick={() => {
              if (canRetryResult && result?.query_id && resultContext) {
                void onRun(result.query_id, resultContext);
              }
            }}
          >
            {t("重試查詢", "Retry query")}
          </Btn>
          <Btn
            data-testid="a4-confirm-partial"
            disabled={contextControlsDisabled || !canConfirmPartial}
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
                "可選取一列或多列；每列以自己的短效 proof 獨立建立並顯示結果。3D 與 DataChannel 不會由此頁啟動。",
                "Select one or more rows. Each row is created independently with its own short-lived proof and outcome. This page never starts 3D or DataChannel actions.",
              )}
            </p>
            <label className="ec-field">
              <span>{t("標題", "Title")}</span>
              <input
                data-testid="a4-issue-title"
                value={issueTitle}
                disabled={issueBusy}
                onChange={(event) => setIssueTitle(event.target.value)}
              />
            </label>
            <label className="ec-field">
              <span>{t("說明", "Description")}</span>
              <textarea
                data-testid="a4-issue-description"
                value={issueDescription}
                disabled={issueBusy}
                onChange={(event) => setIssueDescription(event.target.value)}
                rows={2}
              />
            </label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label className="ec-field">
                <span>{t("嚴重度", "Severity")}</span>
                <select
                  data-testid="a4-issue-severity"
                  value={issueSeverity}
                  disabled={issueBusy}
                  onChange={(event) => setIssueSeverity(event.target.value as typeof issueSeverity)}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </label>
              <label className="ec-field">
                <span>{t("指派", "Assignee")}</span>
                <input
                  data-testid="a4-issue-assignee"
                  value={issueAssignee}
                  disabled={issueBusy}
                  onChange={(event) => setIssueAssignee(event.target.value)}
                />
              </label>
            </div>
            <Btn
              data-testid="a4-confirm-issue"
              disabled={!canCreateIssue || !issueTitle.trim() || issueBusy}
              onClick={() => void onCreateIssue()}
            >
              {issueBusy ? t("建立中…", "Creating…") : t("確認建立所選 A4 Issues", "Confirm selected A4 Issues")}
            </Btn>
            {selectedIssueRows.map((row) => (
              row.proof_expires_at
                ? <p className="ec-muted" key={row.evidence_proof}>proof_expires_at ({row.ifc_guid ?? row.name ?? "row"}): {row.proof_expires_at}</p>
                : null
            ))}
            {issueMessage && <p className="ec-warn" data-testid="a4-issue-message">{issueMessage}</p>}
            {issueOutcomes.length > 0 && (
              <ul data-testid="a4-issue-outcomes">
                {issueOutcomes.map((outcome) => (
                  <li key={outcome.rowKey} data-status={outcome.status}>
                    <span className="mono">{outcome.rowKey}</span>:{" "}
                    {outcome.status === "failed"
                      ? outcome.message
                      : `${outcome.status} · ${outcome.issueId}`}
                  </li>
                ))}
              </ul>
            )}
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
                const rowProofEnabled = sourceMode === "session"
                  && resultContextMatchesCurrent
                  && !selectedSessionUnavailable
                  && result?.issue_eligible === true
                  && row.issue_eligible === true
                  && Boolean(row.evidence_proof);
                return (
                  <tr key={guid || `${row.name}-${row.storey}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`select ${guid || row.name || "row"}`}
                        data-testid={`a4-select-row-${guid || "unknown"}`}
                        checked={Boolean(row.evidence_proof && selectedProofs.includes(row.evidence_proof))}
                        disabled={!rowProofEnabled || issueBusy}
                        onChange={() => {
                          if (!row.evidence_proof) return;
                          setSelectedProofs((current) => (
                            current.includes(row.evidence_proof as string)
                              ? current.filter((proof) => proof !== row.evidence_proof)
                              : [...current, row.evidence_proof as string]
                          ));
                          setIssueTitle((current) => current || `${t("A4 查詢列", "A4 query row")}: ${row.name ?? guid}`);
                          setIssueMessage(null);
                          setIssueOutcomes([]);
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
