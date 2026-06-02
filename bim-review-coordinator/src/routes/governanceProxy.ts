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
}
