/**
 * A1 治理 rule-run proxy — 瀏覽器 → coordinator :8004 → governance-service 127.0.0.1:49102（loopback）。
 *
 * 維持邊界：瀏覽器只打 :8004；governance-service 為內部 loopback 服務，不對瀏覽器直接暴露。
 * coordinator 僅做透傳（JSON 與 Excel 二進位），不解讀 / 不保存治理權威資料。
 */
import type { Express, Response } from "express";

const GOVERNANCE_API_BASE = process.env.GOVERNANCE_API_BASE ?? "http://127.0.0.1:49102";

async function forward(
  response: Response,
  method: string,
  path: string,
  body?: unknown,
  binary = false,
): Promise<void> {
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

export function registerGovernanceProxy(app: Express): void {
  app.post("/api/governance/rule-runs", (request, response) => {
    void forward(response, "POST", "/api/rule-runs", request.body);
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
}
