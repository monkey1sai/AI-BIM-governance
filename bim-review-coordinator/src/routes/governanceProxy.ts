/**
 * A1 治理 rule-run proxy — 瀏覽器 → coordinator :8004 → governance-service 127.0.0.1:49102（loopback）。
 *
 * 維持邊界：瀏覽器只打 :8004；governance-service 為內部 loopback 服務，不對瀏覽器直接暴露。
 * coordinator 僅做透傳（JSON 與 Excel 二進位），不解讀 / 不保存治理權威資料。
 */
import type { Express, Response } from "express";
import type { ArtifactHealthSnapshot } from "../types.js";

const DEFAULT_GOVERNANCE_API_BASE = "http://127.0.0.1:49102";
const allowedIdsBasenamePattern = /^[A-Za-z0-9_.-]+\.ids$/;

// 每次請求讀取(而非 import 時固定),讓 deploy / 測試能以 GOVERNANCE_API_BASE
// 覆寫指向 stub。預設仍是 governance-service loopback 127.0.0.1:49102。
function governanceApiBase(): string {
  return process.env.GOVERNANCE_API_BASE ?? DEFAULT_GOVERNANCE_API_BASE;
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
): Promise<void> {
  const GOVERNANCE_API_BASE = governanceApiBase();
  try {
    const upstream = await fetch(`${GOVERNANCE_API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
    response.status(502).json({
      detail: `governance-service unreachable at ${GOVERNANCE_API_BASE}`,
      error: String(error),
    });
  }
}

function queryString(originalUrl: string, fallback = ""): string {
  const idx = originalUrl.indexOf("?");
  return idx >= 0 ? originalUrl.slice(idx) : fallback;
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
    void forward(response, "GET", "/api/search/llm-status");
  });

  app.post("/api/governance/search/model", (request, response) => {
    void forward(response, "POST", "/api/search/model", request.body);
  });

  app.post("/api/governance/search/model/for-session/:sessionId", (request, response) => {
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
    const override = (request.body ?? {}) as {
      query?: unknown;
      limit?: unknown;
      element_mapping_path?: unknown;
      interpret_mode?: unknown;
    };
    if (typeof override.query !== "string" || !override.query.trim()) {
      response.status(400).json({ detail: "query is required." });
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
      query: override.query.trim(),
      model_version_id: resolution.context.model_version_id ?? null,
    };
    if (typeof override.limit === "number") body.limit = override.limit;
    if (typeof override.element_mapping_path === "string" && override.element_mapping_path) {
      body.element_mapping_path = override.element_mapping_path;
    }
    if (
      override.interpret_mode === "deterministic"
      || override.interpret_mode === "semantic"
      || override.interpret_mode === "auto"
    ) {
      body.interpret_mode = override.interpret_mode;
    }
    void forward(response, "POST", "/api/search/model", body);
  });

  app.post("/api/governance/search/model/for-ifc-ready/:jobId", (request, response) => {
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
    const override = (request.body ?? {}) as {
      query?: unknown;
      limit?: unknown;
      element_mapping_path?: unknown;
      interpret_mode?: unknown;
    };
    if (typeof override.query !== "string" || !override.query.trim()) {
      response.status(400).json({ detail: "query is required." });
      return;
    }
    const body: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
      query: override.query.trim(),
      model_version_id: resolution.context.model_version_id ?? null,
    };
    if (typeof override.limit === "number") body.limit = override.limit;
    if (typeof override.element_mapping_path === "string" && override.element_mapping_path) {
      body.element_mapping_path = override.element_mapping_path;
    }
    if (
      override.interpret_mode === "deterministic"
      || override.interpret_mode === "semantic"
      || override.interpret_mode === "auto"
    ) {
      body.interpret_mode = override.interpret_mode;
    }
    void forward(response, "POST", "/api/search/model", body);
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
