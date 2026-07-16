import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// A3 一鍵鏈（F1 ⑧ 接手）：POST /api/review-sessions 帶 federated_set_id 時，
// coordinator server-side 向 governance 解析 review-room 真 federated_review.usda
// （governance proxy 對瀏覽器遮蔽絕對路徑，前端無法自組可供 Kit 載入的 binding url），
// 生成 derived+ready binding（load_order 0 ⇒ stream-config stage_composition.primary）。
// 失敗語意：governance 不可達=502、set 未 ready=409；未帶 federated_set_id 行為不變。

const STAGE_URL = "C:/gov-storage/federated/fed_demo123/federated_review.usda";

let active: CoordinatorApp | null = null;
let governanceStub: http.Server | null = null;
let savedGovBase: string | undefined;

beforeEach(() => {
  savedGovBase = process.env.GOVERNANCE_API_BASE;
});

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (governanceStub) {
    await new Promise<void>((resolve) => governanceStub?.close(() => resolve()));
    governanceStub = null;
  }
  if (savedGovBase === undefined) {
    delete process.env.GOVERNANCE_API_BASE;
  } else {
    process.env.GOVERNANCE_API_BASE = savedGovBase;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-fedset-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    edgeRuntimeDataRoot: root,
    storageRoot: path.join(root, "storage"),
    storageHostRoot: path.join(root, "storage"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    conversionPollEnabled: false,
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

/** governance stub：GET /api/federated-sets/:id/review-room（可注入 ready/stage_url）。 */
async function startGovernanceStub(room: { ready?: boolean; stage_url?: string | null } | { httpStatus: number }): Promise<{ baseUrl: string; urls: string[] }> {
  const urls: string[] = [];
  governanceStub = http.createServer((req, res) => {
    const url = req.url ?? "/";
    urls.push(`${req.method ?? "GET"} ${url}`);
    if (req.method === "GET" && /^\/api\/federated-sets\/[^/]+\/review-room$/.test(url)) {
      if ("httpStatus" in room) {
        res.writeHead(room.httpStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "stub error" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ set_id: "fed_demo123", ...room }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
}

const BASE_BODY = { project_id: "p-fed", model_version_id: "federated_fed_demo123" };

describe("POST /api/review-sessions federated_set_id（A3 server-side stage 解析）", () => {
  it("ready descriptor → 200 建立 session，stream-config primary 指真 federated_review.usda", async () => {
    const stub = await startGovernanceStub({ ready: true, stage_url: STAGE_URL });
    process.env.GOVERNANCE_API_BASE = stub.baseUrl;
    const app = makeApp();

    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({ ...BASE_BODY, federated_set_id: "fed_demo123" });
    expect(created.status).toBe(200);
    expect(stub.urls).toContain("GET /api/federated-sets/fed_demo123/review-room");
    const sessionId = created.body.session_id as string;
    expect(sessionId).toMatch(/^review_session_[a-z0-9]+$/);
    const bindings = created.body.artifact_bindings as Array<Record<string, unknown>>;
    const fed = bindings.find((b) => b.artifact_group_id === "fedset_fed_demo123");
    expect(fed).toBeTruthy();
    expect(fed?.artifact_role).toBe("derived");
    expect(fed?.ready_status).toBe("ready");
    expect(fed?.load_order).toBe(0);

    const streamConfig = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    expect(streamConfig.status).toBe(200);
    const primary = streamConfig.body?.stage_composition?.primary as { url?: string } | undefined;
    expect(primary?.url).toBe(STAGE_URL);
  });

  it("review-room ready!=true → 409 federated_set_not_ready、不建 session", async () => {
    const stub = await startGovernanceStub({ ready: false, stage_url: null });
    process.env.GOVERNANCE_API_BASE = stub.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/review-sessions")
      .send({ ...BASE_BODY, federated_set_id: "fed_demo123" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("federated_set_not_ready");
    const runtime = await request(app.app).get("/api/runtime/status");
    expect(runtime.body?.sessions?.count ?? 0).toBe(0);
  });

  it("governance 回非 2xx → 409（detail 帶 HTTP 狀態）；governance 不可達 → 502 governance_unreachable", async () => {
    const stub = await startGovernanceStub({ httpStatus: 500 });
    process.env.GOVERNANCE_API_BASE = stub.baseUrl;
    const app = makeApp();
    const res500 = await request(app.app)
      .post("/api/review-sessions")
      .send({ ...BASE_BODY, federated_set_id: "fed_demo123" });
    expect(res500.status).toBe(409);
    expect(String(res500.body.detail)).toContain("HTTP 500");

    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const resDown = await request(app.app)
      .post("/api/review-sessions")
      .send({ ...BASE_BODY, federated_set_id: "fed_demo123" });
    expect(resDown.status).toBe(502);
    expect(resDown.body.error).toBe("governance_unreachable");
  });

  it("未帶 federated_set_id → 既有行為不變（不打 governance）", async () => {
    const stub = await startGovernanceStub({ ready: true, stage_url: STAGE_URL });
    process.env.GOVERNANCE_API_BASE = stub.baseUrl;
    const app = makeApp();
    const res = await request(app.app).post("/api/review-sessions").send(BASE_BODY);
    expect(res.status).toBe(200);
    expect(stub.urls).toEqual([]);
  });
});
