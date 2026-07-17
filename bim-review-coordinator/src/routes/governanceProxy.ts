/**
 * A1 治理 rule-run proxy — 瀏覽器 → coordinator :8004 → governance-service 127.0.0.1:49102（loopback）。
 *
 * 維持邊界：瀏覽器只打 :8004；governance-service 為內部 loopback 服務，不對瀏覽器直接暴露。
 * coordinator 僅做透傳（JSON 與 Excel 二進位），不解讀 / 不保存治理權威資料。
 */
import type { Express, Request, Response } from "express";
import type { ArtifactHealthSnapshot } from "../types.js";

const DEFAULT_GOVERNANCE_API_BASE = "http://127.0.0.1:49102";
const allowedIdsBasenamePattern = /^[A-Za-z0-9_.-]+\.ids$/;

// 每次請求讀取(而非 import 時固定),讓 deploy / 測試能以 GOVERNANCE_API_BASE
// 覆寫指向 stub。預設仍是 governance-service loopback 127.0.0.1:49102。
function governanceApiBase(): string {
  return process.env.GOVERNANCE_API_BASE ?? DEFAULT_GOVERNANCE_API_BASE;
}

function isLoopbackGovernanceBase(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && (host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

/**
 * unified-console-mvp 用的 browser-visible id → server-side IFC 路徑解析結果。
 * 由 `app.ts` 注入的 resolver 從 coordinator 自己的 SessionStore +
 * ExternalIfcReadyStore 解析（瀏覽器只持有 session_id / ifc_ready_job_id，
 * 不知 server-side IFC path）。coordinator 只解析 + 透傳，**不**自行跑
 * rule-run、不宣告為 IFC 資料權威。
 */
export interface RuleRunSourceContext {
  /** governance-service host 視角可讀的 IFC 來源絕對路徑（job.host_local_path）。 */
  ifc_source_path: string;
  /** 解析出的 model version（session.model_version_id 或 job.external_model_version_id）。 */
  model_version_id?: string | null;
  /** 對應的 ifc-ready job（供 log / 回顯；非必要）。 */
  ifc_ready_job_id?: string | null;
  /** 可持久保存於 rule-run 的來源 lineage；不得包含 host path / presigned URL / secret。 */
  source_metadata?: RuleRunSourceMetadata | null;
}

export interface RuleRunSourceMetadata {
  source_kind: "minio_ifc_ready";
  ifc_ready_job_id: string;
  idempotency_key: string;
  project_id: string;
  project_display_name?: string | null;
  model_category?: string | null;
  model_version_id?: string | null;
  source_ifc_etag?: string | null;
  review_session_id?: string | null;
  conversion_job_id?: string | null;
  conversion_status?: string | null;
}

export type RuleRunSessionContext = RuleRunSourceContext;

export type RuleRunSessionResolution =
  | { ok: true; context: RuleRunSourceContext }
  | {
      ok: false;
      error_code: "stale_session_artifact";
      detail: "source_ifc_missing";
      artifact_health: ArtifactHealthSnapshot;
    }
  // 誠實失敗：session 不存在 / 無法解析出 host-side IFC 路徑。reason 供回顯，
  // 永不偽造 path 或成功。
  | { ok: false; reason: string };

/** A4 session search is authorized from server-owned identity and state only. */
export interface A4SearchSessionContext extends RuleRunSourceContext {
  review_session_id: string;
  principal_ref: string;
  auth_scope: "production" | "lab";
  primary_lease_capability: "verified" | "lab_unverified";
  primary_artifact_id: string | null;
  mapping_provenance: "server_resolved" | "unavailable";
  active_binding_revision: string | null;
}

export type A4SearchResolutionFailure = {
  ok: false;
  status: 401 | 403 | 404 | 409 | 503;
  error_code: string;
  detail: string;
};

export type A4SearchSessionResolution =
  | { ok: true; context: A4SearchSessionContext }
  | A4SearchResolutionFailure;

/**
 * This resolver is the only authorization boundary for an ifc-ready A4
 * search.  A job id is an identifier, never a browser capability.
 */
export interface A4SearchIfcReadyContext {
  ifc_source_path: string;
  model_version_id: string | null | undefined;
}

export type A4SearchIfcReadyResolution =
  | { ok: true; context: A4SearchIfcReadyContext }
  | A4SearchResolutionFailure;

export interface GovernanceProxyDeps {
  /**
   * 從 session_id 解析 server-side IFC 路徑。回傳 ok=false 時 route 回 404。
   * 注意：sessionId 已先經 `isSafeSessionId` 驗證（route 內），resolver 不需重驗格式。
   */
  resolveRuleRunSessionContext?: (sessionId: string) => RuleRunSessionResolution;
  /**
   * 從 ifc_ready_job_id 解析 server-side IFC 路徑。用於 MinIO watcher 已下載
   * source IFC、但尚未建立 Review Room session 時的 A1 CPU rule-run。
   */
  resolveRuleRunIfcReadyContext?: (ifcReadyJobId: string) => RuleRunSessionResolution;
  /** session_id 格式驗證（reuse SessionStore.isSafeSessionId），避免 path 注入。 */
  isSafeSessionId?: (sessionId: string) => boolean;
  /** ifc_ready_job_id 格式驗證（reuse app.ts isSafeIfcReadyJobId），避免 path 注入。 */
  isSafeIfcReadyJobId?: (ifcReadyJobId: string) => boolean;
  /** Coordinator-owned authentication + A4 session context resolver. */
  resolveA4SearchSessionContext?: (
    sessionId: string,
    headers: Record<string, string | undefined>,
  ) => A4SearchSessionResolution;
  /** Authenticated, tenant-scoped server-side resolution for A4 ifc-ready search. */
  resolveA4SearchIfcReadyContext?: (
    ifcReadyJobId: string,
    headers: Record<string, string | undefined>,
  ) => A4SearchIfcReadyResolution;
  /** Shared coordinator→governance token for the trusted A4 context endpoint. */
  a4InternalContextToken?: string;
}

function redactServerPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:(?:\\\\|\\|\/)[^"'\r\n<>]*/g, "[server-path]")
    .replace(/\/(?:workspace|storage|data|mnt|home|tmp|var|Users)\/[^"'\s<>]*/g, "[server-path]");
}

function normalizeIdsPath(value: unknown): { ok: true; value?: string } | { ok: false; detail: string } {
  if (value === undefined || value === null || value === "") return { ok: true };
  if (typeof value !== "string") {
    return { ok: false, detail: "ids_path must be a rule basename under rules/." };
  }
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) return { ok: true };
  if (raw.includes(":") || raw.startsWith("/") || raw.startsWith("//") || raw.includes("..")) {
    return { ok: false, detail: "ids_path must be a rule basename under rules/." };
  }
  const parts = raw.split("/").filter(Boolean);
  const basename = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === "rules" ? parts[1] : "";
  if (!allowedIdsBasenamePattern.test(basename)) {
    return { ok: false, detail: "ids_path must be a rule basename under rules/." };
  }
  return { ok: true, value: `rules/${basename}` };
}

function sanitizeRuleRunBody(body: unknown): { ok: true; body: unknown } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: true, body };
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  delete copy.source_metadata;
  const ids = normalizeIdsPath(copy.ids_path);
  if (!ids.ok) return { ok: false, detail: ids.detail };
  if (ids.value) {
    copy.ids_path = ids.value;
  } else {
    delete copy.ids_path;
  }
  return { ok: true, body: copy };
}

async function forward(
  response: Response,
  method: string,
  path: string,
  body?: unknown,
  binary = false,
  safeUnavailable = false,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const GOVERNANCE_API_BASE = governanceApiBase();
  try {
    const upstream = await fetch(`${GOVERNANCE_API_BASE}${path}`, {
      method,
      // The only calls with extra headers carry the coordinator-only A4
      // context token.  A redirect must never be allowed to take that token
      // to a second host or route.
      redirect: extraHeaders ? "error" : "follow",
      headers: body === undefined && !extraHeaders
        ? undefined
        : { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(extraHeaders ?? {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    response.status(upstream.status);
    const contentType = upstream.headers.get("content-type");
    if (binary) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      if (contentType) response.setHeader("Content-Type", contentType);
      const disposition = upstream.headers.get("content-disposition");
      if (disposition) response.setHeader("Content-Disposition", disposition);
      response.send(buffer);
    } else {
      const text = await upstream.text();
      response.setHeader("Content-Type", contentType ?? "application/json");
      response.send(redactServerPaths(text));
    }
  } catch (error) {
    // 誠實：後端未啟動時回 502，不假裝成功。
    if (safeUnavailable) {
      response.status(502).json({ error_code: "governance_service_unavailable", detail: "governance service unavailable" });
      return;
    }
    response.status(502).json({
      detail: `governance-service unreachable at ${GOVERNANCE_API_BASE}`,
      error: String(error),
    });
  }
}

function requestHeaders(request: Request): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    normalized[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return normalized;
}

function a4InternalContextToken(deps: GovernanceProxyDeps): string | undefined {
  const candidate = deps.a4InternalContextToken ?? process.env.A4_INTERNAL_CONTEXT_TOKEN;
  const normalized = candidate?.trim();
  return normalized || undefined;
}

function queryString(originalUrl: string, fallback = ""): string {
  const idx = originalUrl.indexOf("?");
  return idx >= 0 ? originalUrl.slice(idx) : fallback;
}

type A4SearchControls = {
  query: string;
  limit?: number;
  interpret_mode?: "deterministic" | "semantic" | "auto";
  retry_of_query_id?: string;
};

type A4PartialConfirmationControls = {
  partial_fallback_id: string;
};

type A4IssueDraftControls = {
  evidence_proof: string;
  title: string;
  description?: string;
  severity?: "low" | "medium" | "high" | "critical";
  assignee?: string;
};

function sanitizeA4SearchControls(body: unknown): { ok: true; value: A4SearchControls } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "A4 search body must be an object." };
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set(["query", "limit", "interpret_mode", "retry_of_query_id"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, detail: "A4 search body contains unsupported controls." };
  }
  if (typeof input.query !== "string" || !input.query.trim() || input.query.trim().length > 4000) {
    return { ok: false, detail: "query is required." };
  }
  const value: A4SearchControls = { query: input.query.trim() };
  if (input.limit !== undefined) {
    if (typeof input.limit !== "number" || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
      return { ok: false, detail: "limit must be an integer from 1 to 1000." };
    }
    value.limit = input.limit;
  }
  if (input.interpret_mode !== undefined) {
    if (input.interpret_mode !== "deterministic" && input.interpret_mode !== "semantic" && input.interpret_mode !== "auto") {
      return { ok: false, detail: "interpret_mode is invalid." };
    }
    value.interpret_mode = input.interpret_mode;
  }
  if (input.retry_of_query_id !== undefined) {
    if (typeof input.retry_of_query_id !== "string" || !/^a4q_[A-Za-z0-9_-]{12,64}$/.test(input.retry_of_query_id)) {
      return { ok: false, detail: "retry_of_query_id is invalid." };
    }
    value.retry_of_query_id = input.retry_of_query_id;
  }
  return { ok: true, value };
}

function sanitizeA4PartialConfirmationControls(
  body: unknown,
): { ok: true; value: A4PartialConfirmationControls } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "A4 partial confirmation body must be an object." };
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !("partial_fallback_id" in input)) {
    return { ok: false, detail: "A4 partial confirmation accepts only partial_fallback_id." };
  }
  if (typeof input.partial_fallback_id !== "string" || !/^a4pf_[A-Za-z0-9_-]{12,96}$/.test(input.partial_fallback_id)) {
    return { ok: false, detail: "partial_fallback_id is invalid." };
  }
  return { ok: true, value: { partial_fallback_id: input.partial_fallback_id } };
}

function sanitizeA4IssueDraftControls(
  body: unknown,
): { ok: true; value: A4IssueDraftControls } | { ok: false; detail: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "A4 Issue body must be an object." };
  }
  const input = body as Record<string, unknown>;
  const allowed = new Set(["evidence_proof", "title", "description", "severity", "assignee"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, detail: "A4 Issue body contains unsupported controls." };
  }
  if (
    typeof input.evidence_proof !== "string"
    || !/^a4p\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{16,96}\.[0-9a-f]{64}$/.test(input.evidence_proof)
  ) {
    return { ok: false, detail: "evidence_proof is invalid." };
  }
  if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 240) {
    return { ok: false, detail: "title is required." };
  }
  const value: A4IssueDraftControls = { evidence_proof: input.evidence_proof, title: input.title.trim() };
  if (input.description !== undefined) {
    if (typeof input.description !== "string" || input.description.length > 4000) {
      return { ok: false, detail: "description is invalid." };
    }
    value.description = input.description;
  }
  if (input.severity !== undefined) {
    if (!["low", "medium", "high", "critical"].includes(String(input.severity))) {
      return { ok: false, detail: "severity is invalid." };
    }
    value.severity = input.severity as A4IssueDraftControls["severity"];
  }
  if (input.assignee !== undefined) {
    if (typeof input.assignee !== "string" || input.assignee.length > 160) {
      return { ok: false, detail: "assignee is invalid." };
    }
    value.assignee = input.assignee;
  }
  return { ok: true, value };
}

function isA4IssueContextEligible(context: A4SearchSessionContext): boolean {
  return (
    context.auth_scope === "production"
    && context.primary_lease_capability === "verified"
    && context.mapping_provenance === "server_resolved"
    && typeof context.review_session_id === "string"
    && Boolean(context.review_session_id)
    && typeof context.principal_ref === "string"
    && Boolean(context.principal_ref)
    && typeof context.primary_artifact_id === "string"
    && Boolean(context.primary_artifact_id)
    && typeof context.active_binding_revision === "string"
    && Boolean(context.active_binding_revision)
    && typeof context.model_version_id === "string"
    && Boolean(context.model_version_id)
  );
}

function sendA4ResolutionFailure(response: Response, resolution: A4SearchResolutionFailure): void {
  response.status(resolution.status).json({ error_code: resolution.error_code, detail: resolution.detail });
}

function sendSessionResolutionFailure(
  response: Response,
  resolution: Extract<RuleRunSessionResolution, { ok: false }>,
): void {
  if ("reason" in resolution) {
    response.status(404).json({ detail: resolution.reason });
    return;
  }
  response.status(409).json({
    error_code: resolution.error_code,
    detail: resolution.detail,
    artifact_health: resolution.artifact_health,
  });
}

function forwardResolvedRuleRun(
  response: Response,
  context: RuleRunSourceContext,
  overrideBody: { ids_path?: unknown; rule_set?: unknown },
): void {
  const forwardBody: Record<string, unknown> = {
    ifc_source_path: context.ifc_source_path,
  };
  if (context.model_version_id) {
    forwardBody.model_version_id = context.model_version_id;
  }
  if (context.source_metadata) {
    forwardBody.source_metadata = context.source_metadata;
  }
  const ids = normalizeIdsPath(overrideBody.ids_path);
  if (!ids.ok) {
    response.status(400).json({ error_code: "invalid_ids_path", detail: ids.detail });
    return;
  }
  if (ids.value) {
    forwardBody.ids_path = ids.value;
  }
  if (typeof overrideBody.rule_set === "string" && overrideBody.rule_set.trim().length > 0) {
    forwardBody.rule_set = overrideBody.rule_set;
  }
  void forward(response, "POST", "/api/rule-runs", forwardBody);
}

export function registerGovernanceProxy(app: Express, deps: GovernanceProxyDeps = {}): void {
  // A1 file-library browse proxy（唯讀 local file-server tree，透傳 governance-service /api/files/tree）。
  // 瀏覽器只打 :8004；樹 JSON 原樣透傳，coordinator 不解讀 / 不保存。
  app.get("/api/governance/files/tree", (_request, response) => {
    void forward(response, "GET", "/api/files/tree");
  });

  app.post("/api/governance/rule-runs", (request, response) => {
    const body = (request.body && typeof request.body === "object" && !Array.isArray(request.body))
      ? { ...(request.body as Record<string, unknown>) }
      : request.body;
    const sanitized = sanitizeRuleRunBody(body);
    if (!sanitized.ok) {
      response.status(400).json({ error_code: "invalid_ids_path", detail: sanitized.detail });
      return;
    }
    void forward(response, "POST", "/api/rule-runs", sanitized.body);
  });

  app.get("/api/governance/rule-runs", (request, response) => {
    void forward(response, "GET", `/api/rule-runs${queryString(request.originalUrl)}`);
  });

  // unified-console-mvp:瀏覽器只持有 session_id（不知 server-side IFC path）。
  // coordinator 從自己的 SessionStore + ExternalIfcReadyStore 解析出 host-side
  // IFC 路徑（+ model_version_id），再透傳給 governance-service POST /api/rule-runs。
  // 邊界：coordinator 只解析 + 透傳，不跑 rule-run、不是新的資料權威。
  // 誠實：404（session / IFC 路徑無法解析）、502（governance 不可達，由 forward 處理）；
  // 絕不偽造 path 或成功。可選 override body { ids_path?, rule_set? }。
  app.post("/api/governance/rule-runs/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveRuleRunSessionContext) {
      // 未注入 resolver（理論上不會發生；app.ts 一律注入）。誠實回 501，不偽造成功。
      response.status(501).json({ detail: "session→IFC resolution is not configured." });
      return;
    }
    const resolution = deps.resolveRuleRunSessionContext(sessionId);
    if (!resolution.ok) {
      sendSessionResolutionFailure(response, resolution);
      return;
    }
    const overrideBody = (request.body ?? {}) as { ids_path?: unknown; rule_set?: unknown };
    forwardResolvedRuleRun(response, resolution.context, overrideBody);
  });

  // MinIO watcher 已下載 source IFC 但尚未建立 Review Room session 時，A1 仍可
  // 透過 ifc_ready_job_id 要求 coordinator 在 server side 解析 host IFC path，並排入
  // governance-service CPU rule-run queue。
  // 瀏覽器不接觸 host_local_path，也不把 MinIO key 當 ifc_source_path。
  // 這不是 IFC 下載 / IFC->USD 轉檔排程 API；未被 watcher 偵測到的 MinIO object
  // 應走 coordinator conversion trigger / external ifc-ready intake。
  //
  // Security boundary: this follows the existing operator-console inventory
  // model (/api/external/ifc-ready and /api/minio/objects are browser-visible).
  // ifc_ready_job_id is not an authorization token. Do not expose this route as
  // a multi-tenant endpoint until real user/tenant auth is enforced at the
  // coordinator boundary.
  app.post("/api/governance/rule-runs/for-ifc-ready/:jobId", (request, response) => {
    const jobId = request.params.jobId;
    const isSafe = deps.isSafeIfcReadyJobId ?? (() => true);
    if (!isSafe(jobId)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    if (!deps.resolveRuleRunIfcReadyContext) {
      response.status(501).json({ detail: "ifc-ready IFC resolution is not configured." });
      return;
    }
    const resolution = deps.resolveRuleRunIfcReadyContext(jobId);
    if (!resolution.ok) {
      sendSessionResolutionFailure(response, resolution);
      return;
    }
    const overrideBody = (request.body ?? {}) as { ids_path?: unknown; rule_set?: unknown };
    forwardResolvedRuleRun(response, resolution.context, overrideBody);
  });

  // CH-H2:per-element 語意 for-session proxy（範本面板②IFC語意/⑥空間 的前端資料來源）。
  // 瀏覽器只持 session_id + ifc_guid，不知 server-side IFC path；coordinator 沿用同一 resolver
  // 解析 session→host IFC 路徑後 forward governance-service GET /api/elements/semantics。
  // 邊界：coordinator 只解析+透傳，server IFC 絕對路徑不外洩到瀏覽器（與 rule-runs/for-session 一致）。
  // 誠實：400（session/guid 不合法）、404（無法解析 IFC 路徑）、502（governance 不可達）。
  app.get("/api/governance/elements/for-session/:sessionId/:guid", (request, response) => {
    const sessionId = request.params.sessionId;
    const guid = request.params.guid;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    // ifc_guid 基本守門（IFC GlobalId 為 22 字元 base64[0-9A-Za-z_$]；放寬到 64 容錯，擋過長/注入）。
    if (typeof guid !== "string" || guid.length === 0 || guid.length > 64) {
      response.status(400).json({ detail: "Invalid ifc_guid." });
      return;
    }
    if (!deps.resolveRuleRunSessionContext) {
      response.status(501).json({ detail: "session→IFC resolution is not configured." });
      return;
    }
    const resolution = deps.resolveRuleRunSessionContext(sessionId);
    if (!resolution.ok) {
      sendSessionResolutionFailure(response, resolution);
      return;
    }
    const qs =
      `?ifc_source_path=${encodeURIComponent(resolution.context.ifc_source_path)}` +
      `&ifc_guid=${encodeURIComponent(guid)}`;
    void forward(response, "GET", `/api/elements/semantics${qs}`);
  });

  // CH-H2 ③：空間巢狀樹 for-session proxy（範本面板③ IfcProject>Site>Building>Storey + 類別計數）。
  // 同 elements/for-session：coordinator resolve session→host IFC 路徑後 forward governance GET /api/spatial-tree。
  app.get("/api/governance/spatial-tree/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveRuleRunSessionContext) {
      response.status(501).json({ detail: "session→IFC resolution is not configured." });
      return;
    }
    const resolution = deps.resolveRuleRunSessionContext(sessionId);
    if (!resolution.ok) {
      sendSessionResolutionFailure(response, resolution);
      return;
    }
    void forward(
      response,
      "GET",
      `/api/spatial-tree?ifc_source_path=${encodeURIComponent(resolution.context.ifc_source_path)}`,
    );
  });

  app.get("/api/governance/rule-runs/:runId", (request, response) => {
    void forward(response, "GET", `/api/rule-runs/${encodeURIComponent(request.params.runId)}`);
  });
  app.get("/api/governance/rule-runs/:runId/results", (request, response) => {
    void forward(
      response,
      "GET",
      `/api/rule-runs/${encodeURIComponent(request.params.runId)}/results${queryString(request.originalUrl)}`,
    );
  });
  // A1 §4.2 失敗構件抽屜：按規則分組 + 分頁 + 樓層 enrichment 透傳（形狀比照 /results，
  // 複用泛用 forward + queryString plumbing；coordinator 不解讀 payload）。
  app.get("/api/governance/rule-runs/:runId/failures", (request, response) => {
    void forward(
      response,
      "GET",
      `/api/rule-runs/${encodeURIComponent(request.params.runId)}/failures${queryString(request.originalUrl)}`,
    );
  });
  app.get("/api/governance/rule-runs/:runId/export", (request, response) => {
    void forward(
      response,
      "GET",
      `/api/rule-runs/${encodeURIComponent(request.params.runId)}/export${queryString(request.originalUrl, "?fmt=excel")}`,
      undefined,
      true,
    );
  });

  // A4 semantic search — browser holds session / ifc-ready id only; coordinator
  // resolves host IFC path and forwards POST /api/search/model
  // (deterministic grammar and/or Ornith vLLM structured filters).
  app.get("/api/governance/search/llm-status", (_request, response) => {
    void forward(response, "GET", "/api/search/llm-status", undefined, false, true);
  });

  app.post("/api/governance/search/model/for-session/:sessionId/partial-confirmation", (request, response) => {
    const sessionId = request.params.sessionId;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveA4SearchSessionContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 session authorization is unavailable." });
      return;
    }
    const resolution = deps.resolveA4SearchSessionContext(sessionId, requestHeaders(request));
    if (!resolution.ok) {
      sendA4ResolutionFailure(response, resolution);
      return;
    }
    const controls = sanitizeA4PartialConfirmationControls(request.body);
    if (!controls.ok) {
      response.status(400).json({ error_code: "invalid_a4_partial_confirmation", detail: controls.detail });
      return;
    }
    const internalToken = a4InternalContextToken(deps);
    if (!internalToken || !isLoopbackGovernanceBase(governanceApiBase())) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 trusted context transport is unavailable." });
      return;
    }
    const body: Record<string, unknown> = {
      partial_fallback_id: controls.value.partial_fallback_id,
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: resolution.context.review_session_id,
        principal_ref: resolution.context.principal_ref,
        primary_artifact_id: resolution.context.primary_artifact_id,
        active_binding_revision: resolution.context.active_binding_revision,
        model_version_id: resolution.context.model_version_id ?? null,
        auth_scope: resolution.context.auth_scope,
        mapping_provenance: resolution.context.mapping_provenance,
        primary_lease_capability: resolution.context.primary_lease_capability,
      },
    };
    void forward(
      response,
      "POST",
      "/api/internal/a4/search/model/confirm-partial",
      body,
      false,
      true,
      { "X-A4-Internal-Token": internalToken },
    );
  });

  app.post("/api/governance/search/model/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveA4SearchSessionContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 session authorization is unavailable." });
      return;
    }
    const resolution = deps.resolveA4SearchSessionContext(sessionId, requestHeaders(request));
    if (!resolution.ok) {
      sendA4ResolutionFailure(response, resolution);
      return;
    }
    const controls = sanitizeA4SearchControls(request.body);
    if (!controls.ok) {
      response.status(400).json({ error_code: "invalid_a4_search_controls", detail: controls.detail });
      return;
    }
    const internalToken = a4InternalContextToken(deps);
    if (!internalToken) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 trusted context transport is unavailable." });
      return;
    }
    if (!isLoopbackGovernanceBase(governanceApiBase())) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 internal governance transport is unavailable." });
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
      model_version_id: resolution.context.model_version_id ?? null,
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: resolution.context.review_session_id,
        principal_ref: resolution.context.principal_ref,
        primary_artifact_id: resolution.context.primary_artifact_id,
        active_binding_revision: resolution.context.active_binding_revision,
        model_version_id: resolution.context.model_version_id ?? null,
        auth_scope: resolution.context.auth_scope,
        mapping_provenance: resolution.context.mapping_provenance,
        primary_lease_capability: resolution.context.primary_lease_capability,
      },
      ...controls.value,
    };
    void forward(
      response,
      "POST",
      "/api/internal/a4/search/model",
      body,
      false,
      true,
      { "X-A4-Internal-Token": internalToken },
    );
  });

  // A4 Issue mutation stays session-scoped.  The browser sends only an opaque
  // proof and editable draft; fresh principal/artifact/binding authority is
  // resolved again by the coordinator immediately before forwarding.
  app.post("/api/governance/issues/from-a4-search/for-session/:sessionId", (request, response) => {
    const sessionId = request.params.sessionId;
    const isSafe = deps.isSafeSessionId ?? (() => true);
    if (!isSafe(sessionId)) {
      response.status(400).json({ detail: "Invalid review session id." });
      return;
    }
    if (!deps.resolveA4SearchSessionContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 session authorization is unavailable." });
      return;
    }
    const resolution = deps.resolveA4SearchSessionContext(sessionId, requestHeaders(request));
    if (!resolution.ok) {
      sendA4ResolutionFailure(response, resolution);
      return;
    }
    if (!isA4IssueContextEligible(resolution.context)) {
      response.status(409).json({ error_code: "a4_issue_not_eligible", detail: "A4 Issue authority is unavailable for this session." });
      return;
    }
    const controls = sanitizeA4IssueDraftControls(request.body);
    if (!controls.ok) {
      response.status(400).json({ error_code: "invalid_a4_issue_controls", detail: controls.detail });
      return;
    }
    const internalToken = a4InternalContextToken(deps);
    if (!internalToken || !isLoopbackGovernanceBase(governanceApiBase())) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 trusted context transport is unavailable." });
      return;
    }
    const body: Record<string, unknown> = {
      ...controls.value,
      a4_trusted_context: {
        scope: "session_table_only",
        review_session_id: resolution.context.review_session_id,
        principal_ref: resolution.context.principal_ref,
        primary_artifact_id: resolution.context.primary_artifact_id,
        active_binding_revision: resolution.context.active_binding_revision,
        model_version_id: resolution.context.model_version_id,
        auth_scope: resolution.context.auth_scope,
        mapping_provenance: resolution.context.mapping_provenance,
        primary_lease_capability: resolution.context.primary_lease_capability,
      },
    };
    void forward(
      response,
      "POST",
      "/api/internal/a4/issues",
      body,
      false,
      true,
      { "X-A4-Internal-Token": internalToken },
    );
  });

  app.post("/api/governance/search/model/for-ifc-ready/:jobId", (request, response) => {
    const jobId = request.params.jobId;
    const isSafe = deps.isSafeIfcReadyJobId ?? (() => true);
    if (!isSafe(jobId)) {
      response.status(400).json({ detail: "Invalid ifc-ready job id." });
      return;
    }
    if (!deps.resolveA4SearchIfcReadyContext) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 ifc-ready authorization is unavailable." });
      return;
    }
    const resolution = deps.resolveA4SearchIfcReadyContext(jobId, requestHeaders(request));
    if (!resolution.ok) {
      sendA4ResolutionFailure(response, resolution);
      return;
    }
    const controls = sanitizeA4SearchControls(request.body);
    if (!controls.ok) {
      response.status(400).json({ error_code: "invalid_a4_search_controls", detail: controls.detail });
      return;
    }
    const internalToken = a4InternalContextToken(deps);
    if (!internalToken) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 trusted context transport is unavailable." });
      return;
    }
    if (!isLoopbackGovernanceBase(governanceApiBase())) {
      response.status(503).json({ error_code: "a4_trusted_context_unavailable", detail: "A4 internal governance transport is unavailable." });
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
      model_version_id: resolution.context.model_version_id ?? null,
      a4_trusted_context: { scope: "ifc_ready_table_only" },
      ...controls.value,
    };
    // Ifc-ready has no active viewer authority.  It remains compatibility
    // table-only because governance cannot mint proof/Issue/3D eligibility.
    void forward(
      response,
      "POST",
      "/api/internal/a4/search/model",
      body,
      false,
      true,
      { "X-A4-Internal-Token": internalToken },
    );
  });

  // A2 model-version diff proxy（透傳 governance-service /api/diffs*）。
  app.post("/api/governance/diffs", (request, response) => {
    void forward(response, "POST", "/api/diffs", request.body);
  });
  app.get("/api/governance/diffs/:diffId", (request, response) => {
    void forward(response, "GET", `/api/diffs/${encodeURIComponent(request.params.diffId)}`);
  });
  app.get("/api/governance/diffs/:diffId/items", (request, response) => {
    void forward(
      response,
      "GET",
      `/api/diffs/${encodeURIComponent(request.params.diffId)}/items${queryString(request.originalUrl)}`,
    );
  });
  app.post("/api/governance/diffs/:diffId/apply-overlay", (request, response) => {
    void forward(response, "POST", `/api/diffs/${encodeURIComponent(request.params.diffId)}/apply-overlay`, request.body);
  });
  app.get("/api/governance/diffs/:diffId/issue-impact", (request, response) => {
    void forward(response, "GET", `/api/diffs/${encodeURIComponent(request.params.diffId)}/issue-impact`);
  });

  // A3 cross-discipline federation proxy（透傳 governance-service /api/federated-sets*）。
  app.post("/api/governance/federated-sets", (request, response) => {
    void forward(response, "POST", "/api/federated-sets", request.body);
  });
  app.get("/api/governance/federated-sets/:setId", (request, response) => {
    void forward(response, "GET", `/api/federated-sets/${encodeURIComponent(request.params.setId)}`);
  });
  app.post("/api/governance/federated-sets/:setId/members", (request, response) => {
    void forward(response, "POST", `/api/federated-sets/${encodeURIComponent(request.params.setId)}/members`, request.body);
  });
  app.post("/api/governance/federated-sets/:setId/validate-coords", (request, response) => {
    void forward(response, "POST", `/api/federated-sets/${encodeURIComponent(request.params.setId)}/validate-coords`, request.body);
  });
  app.post("/api/governance/federated-sets/:setId/build", (request, response) => {
    void forward(response, "POST", `/api/federated-sets/${encodeURIComponent(request.params.setId)}/build`, request.body);
  });
  app.get("/api/governance/federated-sets/:setId/review-room", (request, response) => {
    void forward(response, "GET", `/api/federated-sets/${encodeURIComponent(request.params.setId)}/review-room`);
  });

  // Issue tracking proxy（透傳 governance-service /api/issues*）。
  // 注意：HTTP 請求/回應透傳，issue 權威在 governance-service；非復活 2026-05-21 退役的
  // socket collaboration server-push（getReviewIssues / createAnnotation 等）。
  app.post("/api/governance/issues", (request, response) => {
    void forward(response, "POST", "/api/issues", request.body);
  });
  app.get("/api/governance/issues", (request, response) => {
    void forward(response, "GET", `/api/issues${queryString(request.originalUrl)}`);
  });
  app.get("/api/governance/issues/:issueId", (request, response) => {
    void forward(response, "GET", `/api/issues/${encodeURIComponent(request.params.issueId)}`);
  });
  app.post("/api/governance/issues/:issueId/transition", (request, response) => {
    void forward(response, "POST", `/api/issues/${encodeURIComponent(request.params.issueId)}/transition`, request.body);
  });
  app.post("/api/governance/issues/from-rule-run/:runId", (request, response) => {
    void forward(response, "POST", `/api/issues/from-rule-run/${encodeURIComponent(request.params.runId)}`, request.body);
  });
  app.post("/api/governance/issues/from-diff/:diffId", (request, response) => {
    void forward(response, "POST", `/api/issues/from-diff/${encodeURIComponent(request.params.diffId)}${queryString(request.originalUrl)}`, request.body);
  });

  // BCF 匯出 proxy（issue → BCF 2.1 .bcfzip，二進位透傳）。
  app.get("/api/governance/bcf/export", (request, response) => {
    void forward(response, "GET", `/api/bcf/export${queryString(request.originalUrl)}`, undefined, true);
  });
}
