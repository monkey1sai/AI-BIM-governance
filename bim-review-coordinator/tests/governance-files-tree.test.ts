import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// GET /api/governance/files/tree：coordinator 逐 endpoint 白名單透傳 governance-service
// GET /api/files/tree（瀏覽器只打 :8004，不直連 governance loopback）。誠實：governance
// 不可達回 502（forward helper 既有行為），不偽造資料。

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-files-tree-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    storageRoot: path.join(root, "storage"),
    storageHostRoot: path.join(root, "storage"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

async function startGovernanceTreeStub(): Promise<{ baseUrl: string; urls: string[] }> {
  const urls: string[] = [];
  const tree = {
    root: "C:/Repos/active/iot/AI-BIM-governance/storage",
    source_kind: "local_fs",
    projects: [
      {
        project_id: "270",
        models: [
          { model_id: "機電", versions: [{ name: "ver 竣工.ifc", path: "C:/x/ver 竣工.ifc", size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" }] },
        ],
      },
    ],
  };
  governanceStub = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/files/tree") {
      urls.push(req.url);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(tree));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
}

describe("GET /api/governance/files/tree", () => {
  it("透傳 governance-service /api/files/tree 並回原樣樹 JSON", async () => {
    const gov = await startGovernanceTreeStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app).get("/api/governance/files/tree");

    expect(res.status).toBe(200);
    expect(res.body.source_kind).toBe("local_fs");
    expect(res.body.projects[0].project_id).toBe("270");
    expect(res.body.projects[0].models[0].versions[0].name).toBe("ver 竣工.ifc");
    expect(gov.urls).toEqual(["/api/files/tree"]);
  });

  it("governance-service 不可達 → 502（誠實，不偽造）", async () => {
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const app = makeApp();
    const res = await request(app.app).get("/api/governance/files/tree");
    expect(res.status).toBe(502);
    expect(typeof res.body.detail).toBe("string");
  });
});
