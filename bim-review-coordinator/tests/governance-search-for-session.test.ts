/**
 * A4 search proxy smoke: forward /api/governance/search/model* to governance-service.
 */
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { createCoordinatorApp } from "../src/app.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const activeServers: http.Server[] = [];

function makeApp(overrides: Record<string, unknown> = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coord-a4-"));
  return createCoordinatorApp({
    sessionStoreDir: path.join(tmp, "sessions"),
    eventLogDir: path.join(tmp, "events"),
    callbackOutboxPath: path.join(tmp, "outbox.json"),
    externalIfcReadyStorePath: path.join(tmp, "ifc-ready.json"),
    ifcCacheDir: path.join(tmp, "ifc-cache"),
    authMode: "none",
    ...overrides,
  } as never);
}

async function startGovernanceStub() {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      urls.push(`${req.method} ${req.url}`);
      let body: Record<string, unknown> = {};
      if (chunks.length) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      bodies.push(body);
      if (req.method === "POST" && req.url === "/api/search/model") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            interpreted_filters: { raw_query: body.query, interpretable: true },
            results: [],
            stats: { total: 0, matched: 0, unmapped: 0, scanned: 0 },
            evidence_refs: [],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls, bodies };
}

afterEach(async () => {
  while (activeServers.length) {
    const s = activeServers.pop();
    await new Promise<void>((resolve) => s?.close(() => resolve()));
  }
  delete process.env.GOVERNANCE_API_BASE;
});

describe("A4 governance search proxy", () => {
  it("POST /api/governance/search/model forwards to governance /api/search/model", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance/search/model")
      .send({ ifc_source_path: "C:/models/demo.ifc", query: "IfcDoor", limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(gov.urls).toContain("POST /api/search/model");
    expect(gov.bodies[0]).toMatchObject({
      ifc_source_path: "C:/models/demo.ifc",
      query: "IfcDoor",
      limit: 10,
    });
  });

  it("for-session rejects empty query with 400 when session id format is valid", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/governance/search/model/for-session/review_session_deadbeef12")
      .send({});
    // Missing query → 400; if session validation runs first may still 400/404.
    expect([400, 404]).toContain(res.status);
    expect(gov.bodies).toHaveLength(0);
  });

  it("for-ifc-ready rejects invalid job id", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/governance/search/model/for-ifc-ready/../etc/passwd")
      .send({ query: "IfcDoor" });
    expect([400, 404]).toContain(res.status);
    expect(gov.bodies).toHaveLength(0);
  });
});
