/**
 * A1 治理 rule-run proxy — 瀏覽器 → coordinator :8004 → governance-service 127.0.0.1:49102（loopback）。
 *
 * 維持邊界：瀏覽器只打 :8004；governance-service 為內部 loopback 服務，不對瀏覽器直接暴露。
 * coordinator 僅做透傳（JSON 與 Excel 二進位），不解讀 / 不保存治理權威資料。
 */
import type { Express, Response } from "express";

const DEFAULT_GOVERNANCE_API_BASE = "http://127.0.0.1:49102";

// 每次請求讀取(而非 import 時固定),讓 deploy / 測試能以 GOVERNANCE_API_BASE
// 覆寫指向 stub。預設仍是 governance-service loopback 127.0.0.1:49102。
function governanceApiBase(): string {
  return process.env.GOVERNANCE_API_BASE ?? DEFAULT_GOVERNANCE_API_BASE;
}

/**
 * unified-console-mvp:`POST /api/governance/rule-runs/for-session/:sessionId`
 * 用的 session → server-side IFC 路徑解析結果。由 `app.ts` 注入的 resolver
 * 從 coordinator 自己的 SessionStore + ExternalIfcReadyStore 解析（瀏覽器只持有
 * session_id，不知 server-side IFC path）。coordinator 只解析 + 透傳，**不**
 * 自行跑 rule-run、不宣告為 IFC 資料權威。
 */
export interface RuleRunSessionContext {
  /** governance-service host 視角可讀的 IFC 來源絕對路徑（job.host_local_path）。 */
  ifc_source_path: string;
  /** 解析出的 model version（session.model_version_id）。 */
  model_version_id?: string | null;
  /** 對應的 ifc-ready job（供 log / 回顯；非必要）。 */
  ifc_ready_job_id?: string | null;
}

export type RuleRunSessionResolution =
  | { ok: true; context: RuleRunSessionContext }
  // 誠實失敗：session 不存在 / 無法解析出 host-side IFC 路徑。reason 供回顯，
  // 永不偽造 path 或成功。
  | { ok: false; reason: string };

export interface GovernanceProxyDeps {
  /**
   * 從 session_id 解析 server-side IFC 路徑。回傳 ok=false 時 route 回 404。
   * 注意：sessionId 已先經 `isSafeSessionId` 驗證（route 內），resolver 不需重驗格式。
   */
  resolveRuleRunSessionContext?: (sessionId: string) => RuleRunSessionResolution;
  /** session_id 格式驗證（reuse SessionStore.isSafeSessionId），避免 path 注入。 */
  isSafeSessionId?: (sessionId: string) => boolean;
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
      response.send(text);
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

export function registerGovernanceProxy(app: Express, deps: GovernanceProxyDeps = {}): void {
  app.post("/api/governance/rule-runs", (request, response) => {
    void forward(response, "POST", "/api/rule-runs", request.body);
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
      response.status(404).json({ detail: resolution.reason });
      return;
    }
    const overrideBody = (request.body ?? {}) as { ids_path?: unknown; rule_set?: unknown };
    const forwardBody: Record<string, unknown> = {
      ifc_source_path: resolution.context.ifc_source_path,
    };
    if (resolution.context.model_version_id) {
      forwardBody.model_version_id = resolution.context.model_version_id;
    }
    if (typeof overrideBody.ids_path === "string" && overrideBody.ids_path.trim().length > 0) {
      forwardBody.ids_path = overrideBody.ids_path;
    }
    if (typeof overrideBody.rule_set === "string" && overrideBody.rule_set.trim().length > 0) {
      forwardBody.rule_set = overrideBody.rule_set;
    }
    void forward(response, "POST", "/api/rule-runs", forwardBody);
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
      response.status(404).json({ detail: resolution.reason });
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
      response.status(404).json({ detail: resolution.reason });
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
  app.get("/api/governance/rule-runs/:runId/export", (request, response) => {
    void forward(
      response,
      "GET",
      `/api/rule-runs/${encodeURIComponent(request.params.runId)}/export${queryString(request.originalUrl, "?fmt=excel")}`,
      undefined,
      true,
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
