import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// `POST /api/governance/diffs/for-ifc-ready`：A2 以 MinIO 來源模型做版本 diff。
//
// 為何存在：watcher 下載的 IFC 落在 storage/ifc-cache/<jobId>/source.ifc，而該目錄是
// governance 檔案庫（/api/files/tree）的保留目錄、明文排除，所以兩個 MinIO 模型永遠進不了
// A2 的檔案庫選單。此路由沿用 A1 for-ifc-ready 的同一個 resolver 在 server side 解析路徑。
//
// 邊界（與 rule-runs/for-ifc-ready 一致）：瀏覽器只送 ifc_ready_job_id，host IFC 絕對路徑
// 不外洩；MinIO key 不當 ifc path；無法解析回 404、governance 不可達回 502，不偽造成功。

let active: CoordinatorApp | null = null;
let governanceStub: http.Server | null = null;
let savedGovBase: string | undefined;
const stubs: http.Server[] = [];

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
  while (stubs.length > 0) {
    const server = stubs.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (savedGovBase === undefined) delete process.env.GOVERNANCE_API_BASE;
  else process.env.GOVERNANCE_API_BASE = savedGovBase;
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-gov-diff-test-"));
  const storageRoot = path.join(root, "storage");
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    edgeSiteId: "site_test_edge",
    edgeRuntimeDataRoot: root,
    artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
    storageRoot,
    storageHostRoot: storageRoot,
    conversionPollEnabled: false,
    ifcDownloadStrict: true,
    ...overrides,
  });
  return active;
}

function joinHostPathForTest(root: string, ...parts: string[]): string {
  const sep = /[\\]/.test(root) ? "\\" : "/";
  const tail = parts.map((part) => part.replace(/[\\/]+/g, sep)).join(sep);
  return root.replace(/[\\/]+$/, "") + sep + tail;
}

/** governance-service `POST /api/diffs` stub；記錄 body 供 assert forward payload。 */
async function startGovernanceStub(): Promise<{ baseUrl: string; bodies: Array<Record<string, unknown>> }> {
  const bodies: Array<Record<string, unknown>> = [];
  governanceStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString("utf8"); });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/diffs") {
        bodies.push(JSON.parse(body || "{}"));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ diff_id: "diff_stub_001", status: "queued" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
    });
  });
  await new Promise<void>((resolve) => governanceStub!.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub!.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, bodies };
}

async function startIfcSourceStub(): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  stubs.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/edge/source.ifc`;
}

/** 種一個 watcher 已下載、無 review session 的 ifc-ready job（A2 diff 的兩側來源形狀）。 */
async function seedDownloadedIfc(
  app: CoordinatorApp,
  ifcSourceUrl: string,
  suffix: string,
  externalModelVersionId: string,
): Promise<{ ifcReadyJobId: string; hostLocalPath: string }> {
  const intake = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": `corr_gov_diff_${suffix}`,
      "X-Idempotency-Key": `idem_gov_diff_${suffix}`,
    })
    .send({
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      project_display_name: "松風庵",
      model_category: "建築",
      external_model_version_id: externalModelVersionId,
      external_conversion_task_id: `task_demo_${suffix}`,
      source_ifc: { ref: ifcSourceUrl, etag: `etag_demo_${suffix}`, filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc", "element_mapping"],
    });
  expect(intake.status).toBe(202);
  const ifcReadyJobId = intake.body.ifc_ready_job_id as string;
  expect(fs.existsSync(path.join(app.config.storageRoot, "ifc-cache", ifcReadyJobId, "source.ifc"))).toBe(true);
  return {
    ifcReadyJobId,
    hostLocalPath: joinHostPathForTest(app.config.storageHostRoot, "ifc-cache", ifcReadyJobId, "source.ifc"),
  };
}

describe("ifc-ready intake store 的持久性（split-brain 回歸鎖）", () => {
  it("coordinator 重啟後 job 仍在，且 data_volatility 誠實回報 persisted", async () => {
    const ifcSourceUrl = await startIfcSourceStub();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-gov-diff-restart-"));
    const shared: Partial<CoordinatorConfig> = {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      artifactHealthLedgerStorePath: path.join(root, "artifact-health-ledger.json"),
      edgeSiteId: "site_test_edge",
      edgeRuntimeDataRoot: root,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      conversionPollEnabled: false,
      ifcDownloadStrict: true,
    };

    const first = makeApp(shared);
    const seeded = await seedDownloadedIfc(first, ifcSourceUrl, "restart_001", "version_restart_001");
    // 模擬重啟：關掉這個 process 的 app，用同一份 config 重建（store 路徑相同）。
    first.io.close();
    await new Promise<void>((resolve) => first.server.close(() => resolve()));
    active = null;

    const second = makeApp(shared);
    const listed = await request(second.app).get("/api/external/ifc-ready?limit=100");
    expect(listed.status).toBe(200);
    const item = (listed.body.items as Array<Record<string, unknown>>)
      .find((row) => row.ifc_ready_job_id === seeded.ifcReadyJobId);
    // 修正前：intake store 為 volatile，重啟後這裡是 undefined，而 ledger/session 仍在
    // ——A1 便對所有既有 MinIO 物件回報「尚未找到 watcher 下載紀錄」。
    expect(item).toBeDefined();
    expect(item!.data_volatility).toBe("persisted");
  });
});

describe("POST /api/governance/diffs/for-ifc-ready", () => {
  it("兩側 ifc_ready_job_id 解成 host IFC path 後透傳 governance，瀏覽器不需知道路徑", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp();
    const base = await seedDownloadedIfc(app, ifcSourceUrl, "base_001", "version_base_001");
    const target = await seedDownloadedIfc(app, ifcSourceUrl, "target_001", "version_target_001");

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({
        base_ifc_ready_job_id: base.ifcReadyJobId,
        target_ifc_ready_job_id: target.ifcReadyJobId,
        include_geometry: true,
      });

    expect(res.status).toBe(202);
    expect(res.body.diff_id).toBe("diff_stub_001");
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0]).toMatchObject({
      base_ifc_path: base.hostLocalPath,
      target_ifc_path: target.hostLocalPath,
      base_model_version_id: "version_base_001",
      target_model_version_id: "version_target_001",
      include_geometry: true,
    });
  });

  it("include_geometry 預設 false（不因缺欄位就跑較重的 tessellation 比對）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp();
    const base = await seedDownloadedIfc(app, ifcSourceUrl, "base_002", "version_base_002");
    const target = await seedDownloadedIfc(app, ifcSourceUrl, "target_002", "version_target_002");

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({ base_ifc_ready_job_id: base.ifcReadyJobId, target_ifc_ready_job_id: target.ifcReadyJobId });

    expect(res.status).toBe(202);
    expect(gov.bodies[0]).toMatchObject({ include_geometry: false });
  });

  it("無效 job id 格式 → 400，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({ base_ifc_ready_job_id: "..%2Fetc", target_ifc_ready_job_id: "ifcready_1_2" });

    expect(res.status).toBe(400);
    expect(gov.bodies).toHaveLength(0);
  });

  it("base 與 target 相同 → 400（自比恆零差異，只會產生誤導的「無變更」報告）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp();
    const base = await seedDownloadedIfc(app, ifcSourceUrl, "base_003", "version_base_003");

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({ base_ifc_ready_job_id: base.ifcReadyJobId, target_ifc_ready_job_id: base.ifcReadyJobId });

    expect(res.status).toBe(400);
    expect(gov.bodies).toHaveLength(0);
  });

  it("任一側解析不到 → 404，且不打 governance（不拿另一側湊一個假 diff）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp();
    const base = await seedDownloadedIfc(app, ifcSourceUrl, "base_004", "version_base_004");

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({ base_ifc_ready_job_id: base.ifcReadyJobId, target_ifc_ready_job_id: "ifcready_0000000000000_deadbeef" });

    expect(res.status).toBe(404);
    expect(typeof res.body.detail).toBe("string");
    expect(gov.bodies).toHaveLength(0);
  });

  it("governance-service 不可達 → 502（誠實，不偽造 diff_id）", async () => {
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp();
    const base = await seedDownloadedIfc(app, ifcSourceUrl, "base_005", "version_base_005");
    const target = await seedDownloadedIfc(app, ifcSourceUrl, "target_005", "version_target_005");

    const res = await request(app.app)
      .post("/api/governance/diffs/for-ifc-ready")
      .send({ base_ifc_ready_job_id: base.ifcReadyJobId, target_ifc_ready_job_id: target.ifcReadyJobId });

    expect(res.status).toBe(502);
    expect(res.body.diff_id).toBeUndefined();
  });
});
