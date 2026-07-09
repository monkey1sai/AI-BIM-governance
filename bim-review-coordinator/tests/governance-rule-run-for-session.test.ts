import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import type { Response as SupertestResponse } from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// unified-console-mvp:`POST /api/governance/rule-runs/for-session/:sessionId`。
// 瀏覽器只有 session_id（不知 server-side IFC path）；coordinator 從自己的
// SessionStore + ExternalIfcReadyStore 解析出 host-side IFC 路徑，再透傳給
// governance-service `POST /api/rule-runs`。誠實：無法解析回 404；governance
// 不可達回 502；絕不偽造 path / 成功。

const CORRELATION = "corr_gov_session_001";
const IDEMPOTENCY = "idem_gov_session_001";

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-gov-session-test-"));
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
    corsOrigins: ["http://127.0.0.1:5173"],
    // streaming/poll 不啟用,避免背景 timer 干擾
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

function joinHostPathForTest(root: string, ...parts: string[]): string {
  const sep = /[\\]/.test(root) ? "\\" : "/";
  const tail = parts.map((part) => part.replace(/[\\/]+/g, sep)).join(sep);
  return root.replace(/[\\/]+$/, "") + sep + tail;
}

/**
 * governance-service `POST /api/rule-runs` stub。記錄收到的 body 供 assert
 * forward payload；回 202 {rule_run_id, status}（與真實服務同形狀）。
 */
async function startGovernanceStub(): Promise<{ baseUrl: string; bodies: Array<Record<string, unknown>>; urls: string[] }> {
  const bodies: Array<Record<string, unknown>> = [];
  const urls: string[] = [];
  governanceStub = http.createServer((req, res) => {
    urls.push(`${req.method ?? "GET"} ${req.url ?? "/"}`);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/rule-runs") {
        bodies.push(JSON.parse(body || "{}"));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ rule_run_id: "rr_stub_001", status: "queued" }));
        return;
      }
      if (req.method === "GET" && (req.url ?? "").startsWith("/api/rule-runs")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ limit: 5, offset: 0, total: 0, items: [] }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
    });
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, bodies, urls };
}

/**
 * 透過真實 intake 路徑落地一個 IFC-ready job 並讓 coordinator 自動建 session：
 * 1. POST /api/external/ifc-ready（http source → strict 下載到 shared volume，
 *    寫入 host_local_path），完成後 enqueue 派工。
 * 2. dispatcher 把 job dispatch 到 streaming stub（拿到 conversion_job_id）。
 * 3. POST /api/internal/conversions/<id>/ingest 餵 ready result → coordinator
 *    autoCreateOrActivateSession + recordReviewSession（job.review_session_id 連回）。
 * 回傳 { sessionId, hostLocalPath, ifcReadyJobId }。
 */
async function seedSessionWithDownloadedIfc(
  app: CoordinatorApp,
  streamingBase: string,
  ifcSourceUrl: string,
): Promise<{ sessionId: string; hostLocalPath: string; ifcReadyJobId: string }> {
  const intake = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": CORRELATION,
      "X-Idempotency-Key": IDEMPOTENCY,
    })
    .send({
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      project_display_name: "松風庵",
      model_category: "建築",
      external_model_version_id: "version_demo_001",
      external_conversion_task_id: "task_demo_001",
      source_ifc: { ref: ifcSourceUrl, etag: "etag_demo_001", filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc", "element_mapping"],
    });
  expect(intake.status).toBe(202);
  const ifcReadyJobId = intake.body.ifc_ready_job_id as string;

  // 等 dispatcher 把 job 推進 dispatched（拿到 conversion_job_id）。
  let conversionJobId: string | null = null;
  for (let i = 0; i < 300; i += 1) {
    const job = await request(app.app).get(`/api/external/ifc-ready/${ifcReadyJobId}`);
    if (job.body?.status === "dispatched" && job.body?.conversion_job_id) {
      conversionJobId = job.body.conversion_job_id as string;
      break;
    }
    if (job.body?.status === "dispatch_failed") {
      throw new Error(`dispatch failed: ${job.body?.dispatch_error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!conversionJobId) throw new Error("job did not reach dispatched");

  const ingest = await request(app.app)
    .post(`/api/internal/conversions/${conversionJobId}/ingest`)
    .set({ "X-Internal-Token": "dev-internal-token" })
    .send({});
  expect(ingest.status).toBe(202);
  const sessionId = ingest.body?.session?.session_id as string;
  expect(sessionId).toMatch(/^review_session_/);

  const finalJob = await request(app.app).get(`/api/external/ifc-ready/${ifcReadyJobId}`);
  expect(finalJob.body).not.toHaveProperty("local_path");
  expect(finalJob.body).not.toHaveProperty("host_local_path");
  const hostLocalPath = path.join(app.config.storageHostRoot, "ifc-cache", ifcReadyJobId, "source.ifc");
  expect(fs.existsSync(hostLocalPath)).toBe(true);
  return { sessionId, hostLocalPath, ifcReadyJobId };
}

async function seedDownloadedIfcWithoutSession(
  app: CoordinatorApp,
  ifcSourceUrl: string,
): Promise<{ localPath: string; hostLocalPath: string; ifcReadyJobId: string }> {
  const intake = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": "corr_gov_ifc_ready_direct_001",
      "X-Idempotency-Key": "idem_gov_ifc_ready_direct_001",
    })
    .send({
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      project_display_name: "松風庵",
      model_category: "建築",
      external_model_version_id: "version_demo_001",
      external_conversion_task_id: "task_demo_001",
      source_ifc: { ref: ifcSourceUrl, etag: "etag_demo_001", filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc", "element_mapping"],
    });
  expect(intake.status).toBe(202);
  expect(intake.body.review_session_id ?? null).toBeNull();
  const ifcReadyJobId = intake.body.ifc_ready_job_id as string;
  const localPath = path.join(app.config.storageRoot, "ifc-cache", ifcReadyJobId, "source.ifc");
  const hostLocalPath = joinHostPathForTest(app.config.storageHostRoot, "ifc-cache", ifcReadyJobId, "source.ifc");
  expect(fs.existsSync(localPath)).toBe(true);
  if (app.config.storageRoot === app.config.storageHostRoot) {
    expect(fs.existsSync(hostLocalPath)).toBe(true);
  }
  return { localPath, hostLocalPath, ifcReadyJobId };
}

async function seedFailedDownloadIfcWithoutSession(app: CoordinatorApp): Promise<{ ifcReadyJobId: string }> {
  const intake = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": "corr_gov_ifc_ready_failed_001",
      "X-Idempotency-Key": "idem_gov_ifc_ready_failed_001",
    })
    .send({
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      external_model_version_id: "version_demo_001",
      external_conversion_task_id: "task_demo_failed_001",
      source_ifc: { ref: "http://127.0.0.1:1/missing.ifc", etag: "etag_demo_failed_001", filename: "missing.ifc", format: "ifc" },
      requested_outputs: ["usdc", "element_mapping"],
    });
  expect(intake.status).toBe(502);
  expect(intake.body.download_status).toBe("failed");
  return { ifcReadyJobId: intake.body.ifc_ready_job_id as string };
}

/** streaming stub：接受 dispatch + 回 ready result（含 usdc + element_mapping）。 */
async function startStreamingStub(): Promise<string> {
  const ready = {
    conversion_job_id: "stream_conv_gov_001",
    authority: "bim-streaming-server",
    status: "succeeded",
    ready: true,
    correlation_id: CORRELATION,
    model: { status: "ready", format: "usdc", url: "http://127.0.0.1:49101/artifacts/stream_conv_gov_001/model.usdc" },
    artifacts: {
      model_usdc: { url: "http://127.0.0.1:49101/artifacts/stream_conv_gov_001/model.usdc" },
      element_mapping: { url: "http://127.0.0.1:49101/artifacts/stream_conv_gov_001/element_mapping.json" },
    },
  };
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_gov_001", status: "queued", authority: "bim-streaming-server", correlation_id: CORRELATION }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/conversions/stream_conv_gov_001/result") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ready));
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  // 掛到 governanceStub teardown 之外:用單獨 close。為簡化,複用 activeStreamingServers。
  activeStreamingServers.push(server);
  return `http://127.0.0.1:${address.port}`;
}

const activeStreamingServers: http.Server[] = [];
afterEach(async () => {
  for (const s of activeStreamingServers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function expectStaleSourceIfcResponse(res: SupertestResponse, staleReason = "source_ifc_missing"): void {
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({
    error_code: "stale_session_artifact",
    detail: "source_ifc_missing",
    artifact_health: {
      source_ifc_exists: false,
      stale_reason: staleReason,
      source: "edge_health_probe",
    },
  });
  expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
}

/** IFC source stub：回 200 + 少量 bytes，讓 strict 下載真實落地 host_local_path。 */
async function startIfcSourceStub(): Promise<string> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    res.end(Buffer.from("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  activeStreamingServers.push(server);
  return `http://127.0.0.1:${address.port}/edge/source.ifc`;
}

describe("POST /api/governance/rule-runs/for-session/:sessionId", () => {
  it("rule-run history query forwards filters to governance-service without interpreting payload", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .get("/api/governance/rule-runs")
      .query({
        project_id: "project_demo_001",
        model_category: "建築",
        model_version_id: "version_demo_001",
        ifc_ready_job_id: "ifcready_001",
        limit: "5",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ limit: 5, offset: 0, total: 0, items: [] });
    expect(gov.urls.some((url) =>
      url.startsWith("GET /api/rule-runs?")
      && url.includes("project_id=project_demo_001")
      && url.includes("model_category=%E5%BB%BA%E7%AF%89")
      && url.includes("model_version_id=version_demo_001")
      && url.includes("ifc_ready_job_id=ifcready_001")
      && url.includes("limit=5"),
    )).toBe(true);
    expect(gov.bodies).toHaveLength(0);
  });

  it("direct rule-run proxy strips browser-supplied source_metadata so lineage is coordinator-injected only", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance/rule-runs")
      .send({
        ifc_source_path: "C:/trusted/server/model.ifc",
        source_metadata: {
          project_id: "forged_project",
          host_local_path: "C:/secret/source.ifc",
          source_ifc_ref: "http://signed.example.invalid/source.ifc?X-Amz-Signature=secret",
        },
      });

    expect(res.status).toBe(202);
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0]).toMatchObject({ ifc_source_path: "C:/trusted/server/model.ifc" });
    expect(gov.bodies[0]).not.toHaveProperty("source_metadata");
  });

  it("解析 session 的 host-side IFC 路徑並透傳給 governance-service，回 {rule_run_id, status}", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId, hostLocalPath, ifcReadyJobId } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/${sessionId}`)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ rule_run_id: "rr_stub_001", status: "queued" });
    // forward payload 必須帶解析出的 host-side IFC 路徑 + model_version_id。
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0].ifc_source_path).toBe(hostLocalPath);
    expect(gov.bodies[0].model_version_id).toBe("version_demo_001");
    expect(gov.bodies[0]).toMatchObject({
      source_metadata: {
        source_kind: "minio_ifc_ready",
        ifc_ready_job_id: ifcReadyJobId,
        idempotency_key: IDEMPOTENCY,
        project_id: "project_demo_001",
        project_display_name: "松風庵",
        model_category: "建築",
        model_version_id: "version_demo_001",
        source_ifc_etag: "etag_demo_001",
        review_session_id: sessionId,
      },
    });
  });

  it("已下載 session 的 source IFC 被刪除 → 409 stale_session_artifact，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);
    fs.rmSync(hostLocalPath);

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/${sessionId}`)
      .send({});

    expectStaleSourceIfcResponse(res);
    expect(gov.bodies).toHaveLength(0);
  });

  it("storageHostRoot may diverge from edgeRuntimeDataRoot without falsely staling rule-runs", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const edgeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gov-session-edge-root-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gov-session-storage-root-"));
    const app = makeApp({
      edgeRuntimeDataRoot: edgeRoot,
      storageHostRoot: storageRoot,
      storageRoot,
      streamingConversionApiBase: streamingBase,
      ifcDownloadStrict: true,
    });

    try {
      const { sessionId } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

      const res = await request(app.app)
        .post(`/api/governance/rule-runs/for-session/${sessionId}`)
        .send({});

      expect(res.status).toBe(202);
      expect(gov.bodies).toHaveLength(1);
    } finally {
      fs.rmSync(edgeRoot, { recursive: true, force: true });
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("storage root resolves outside edge runtime root → 409 stale_session_artifact，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gov-session-storage-escape-"));
    const relativeSourcePath = path.relative(app.config.storageHostRoot, hostLocalPath);
    const escapedSourcePath = path.join(outsideRoot, relativeSourcePath);
    fs.rmSync(app.config.storageHostRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(escapedSourcePath), { recursive: true });
    fs.writeFileSync(escapedSourcePath, "outside", "utf-8");
    try {
      fs.symlinkSync(outsideRoot, app.config.storageHostRoot, process.platform === "win32" ? "junction" : "dir");
    } catch {
      fs.rmSync(outsideRoot, { recursive: true, force: true });
      return;
    }

    try {
      const res = await request(app.app)
        .post(`/api/governance/rule-runs/for-session/${sessionId}`)
        .send({});

      expectStaleSourceIfcResponse(res, "edge_storage_root_escape");
      expect(gov.bodies).toHaveLength(0);
    } finally {
      fs.rmSync(app.config.storageHostRoot, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("override body 的 rule_set / ids_path 會被一併透傳", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/${sessionId}`)
      .send({ rule_set: "fire-egress", ids_path: "/host/ids/fire.ids" });

    expect(res.status).toBe(202);
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0].rule_set).toBe("fire-egress");
    expect(gov.bodies[0].ids_path).toBe("/host/ids/fire.ids");
  });

  it("session 不存在 → 404 with detail，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/review_session_does_not_exist`)
      .send({});

    expect(res.status).toBe(404);
    expect(typeof res.body.detail).toBe("string");
    expect(gov.bodies).toHaveLength(0);
  });

  it("session 存在但無法解析出 IFC 路徑（未經 intake 下載）→ 404，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    // 直接用顯式 create session（不走 IFC-ready intake，因此沒有 host_local_path）。
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_demo",
            artifact_id: "artifact_usdc_demo",
            artifact_role: "derived",
            url: "http://127.0.0.1:49101/artifacts/x/model.usdc",
            mapping_url: "http://127.0.0.1:49101/artifacts/x/element_mapping.json",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });
    expect(created.status).toBe(200);
    const sessionId = created.body.session_id as string;

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/${sessionId}`)
      .send({});

    expect(res.status).toBe(404);
    expect(typeof res.body.detail).toBe("string");
    expect(gov.bodies).toHaveLength(0);
  });

  it("無效 session id 格式 → 400", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/..%2Fetc`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("governance-service 不可達 → 502（誠實，不偽造成功）", async () => {
    // 指向一個沒有監聽的 port。
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-session/${sessionId}`)
      .send({});

    expect(res.status).toBe(502);
    expect(typeof res.body.detail).toBe("string");
  });
});

describe("POST /api/governance/rule-runs/for-ifc-ready/:jobId", () => {
  it("無效 ifc-ready job id 格式 → 400，且不打 governance-service", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance/rule-runs/for-ifc-ready/..%2Fetc")
      .send({});

    expect(res.status).toBe(400);
    expect(gov.bodies).toHaveLength(0);
  });

  it("解析 downloaded ifc-ready job 的 host-side IFC 路徑並透傳給 governance-service，不需要 review session", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ ifcDownloadStrict: true });

    const { ifcReadyJobId, hostLocalPath } = await seedDownloadedIfcWithoutSession(app, ifcSourceUrl);

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
      .send({ ids_path: "/rules/fire.ids" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ rule_run_id: "rr_stub_001", status: "queued" });
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0]).toMatchObject({
      ifc_source_path: hostLocalPath,
      model_version_id: "version_demo_001",
      ids_path: "/rules/fire.ids",
      source_metadata: {
        source_kind: "minio_ifc_ready",
        ifc_ready_job_id: ifcReadyJobId,
        idempotency_key: "idem_gov_ifc_ready_direct_001",
        project_id: "project_demo_001",
        project_display_name: "松風庵",
        model_category: "建築",
        model_version_id: "version_demo_001",
        source_ifc_etag: "etag_demo_001",
      },
    });
    expect(gov.bodies[0].source_metadata).toHaveProperty("conversion_status");
    expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
  });

  it("dockerized coordinator 用 mounted local_path 驗 source IFC，但仍轉送 host_local_path 給 governance-service", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({
      ifcDownloadStrict: true,
      storageHostRoot: "D:\\Users\\deploy\\AI-bim-geo-data\\storage",
    });

    const { ifcReadyJobId, localPath, hostLocalPath } = await seedDownloadedIfcWithoutSession(app, ifcSourceUrl);
    expect(fs.existsSync(localPath)).toBe(true);
    expect(fs.existsSync(hostLocalPath)).toBe(false);

    const detail = await request(app.app).get(`/api/external/ifc-ready/${ifcReadyJobId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.artifact_health).toMatchObject({
      source_ifc_exists: true,
      stale_reason: null,
    });

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
      .send({});

    expect(res.status).toBe(202);
    expect(gov.bodies).toHaveLength(1);
    expect(gov.bodies[0].ifc_source_path).toBe(hostLocalPath);
    expect(gov.bodies[0].ifc_source_path).not.toBe(localPath);
  });

  it("download failed job → 404，且不打 governance-service、不外洩 host path", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp({ ifcDownloadStrict: true });

    const { ifcReadyJobId } = await seedFailedDownloadIfcWithoutSession(app);
    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.detail).toMatch(/not been downloaded/i);
    expect(gov.bodies).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
  });

  it("downloaded no-session job 的 source IFC 被刪除 → 409 stale_session_artifact，且不打 governance-service、不外洩 host path", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ ifcDownloadStrict: true });

    const { ifcReadyJobId, hostLocalPath } = await seedDownloadedIfcWithoutSession(app, ifcSourceUrl);
    fs.rmSync(hostLocalPath, { force: true });

    const res = await request(app.app)
      .post(`/api/governance/rule-runs/for-ifc-ready/${ifcReadyJobId}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error_code: "stale_session_artifact",
      detail: "source_ifc_missing",
      artifact_health: {
        source_ifc_exists: false,
        stale_reason: "source_ifc_missing",
      },
    });
    expect(gov.bodies).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toMatch(/local_path|host_local_path|edge_relative_path|public_url/);
  });
});

// CH-H2:GET /api/governance/elements/for-session/:sessionId/:guid。
// coordinator 解析 session→host IFC 路徑後 forward governance-service GET /api/elements/semantics
// （帶 ifc_source_path + ifc_guid）；server IFC 絕對路徑不外洩瀏覽器。誠實：400/404/502。
async function startGovernanceElementsStub(): Promise<{ baseUrl: string; urls: string[] }> {
  const urls: string[] = [];
  governanceStub = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").startsWith("/api/elements/semantics")) {
      urls.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_guid: "G1", ifc_type: "IfcDoor", psets: {}, spatial: [], classification: null }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
}

describe("GET /api/governance/elements/for-session/:sessionId/:guid", () => {
  const GUID = "3$xKPHQlD10AG1nzmJabuU";

  it("解析 session host-side IFC 路徑並 forward 至 governance /api/elements/semantics（帶 ifc_source_path + ifc_guid）", async () => {
    const gov = await startGovernanceElementsStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

    const res = await request(app.app).get(
      `/api/governance/elements/for-session/${sessionId}/${encodeURIComponent(GUID)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.ifc_type).toBe("IfcDoor");
    // forward URL 必須帶解析出的 host-side IFC 路徑 + guid（瀏覽器從未傳 path）。
    expect(gov.urls).toHaveLength(1);
    expect(gov.urls[0]).toContain(`ifc_source_path=${encodeURIComponent(hostLocalPath)}`);
    expect(gov.urls[0]).toContain(`ifc_guid=${encodeURIComponent(GUID)}`);
  });

  it("已下載 session 的 source IFC 被刪除 → 409 stale_session_artifact，且不打 governance", async () => {
    const gov = await startGovernanceElementsStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });

    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);
    fs.rmSync(hostLocalPath);

    const res = await request(app.app).get(
      `/api/governance/elements/for-session/${sessionId}/${encodeURIComponent(GUID)}`,
    );

    expectStaleSourceIfcResponse(res);
    expect(gov.urls).toHaveLength(0);
  });

  it("session 不存在 → 404，且不打 governance", async () => {
    const gov = await startGovernanceElementsStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const res = await request(app.app).get(
      `/api/governance/elements/for-session/review_session_does_not_exist/${encodeURIComponent(GUID)}`,
    );
    expect(res.status).toBe(404);
    expect(gov.urls).toHaveLength(0);
  });

  it("無效 session id 格式 → 400", async () => {
    const app = makeApp();
    const res = await request(app.app).get(`/api/governance/elements/for-session/..%2Fetc/${encodeURIComponent(GUID)}`);
    expect(res.status).toBe(400);
  });

  it("過長 ifc_guid → 400（擋注入/異常）", async () => {
    const gov = await startGovernanceElementsStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });
    const { sessionId } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);
    const res = await request(app.app).get(
      `/api/governance/elements/for-session/${sessionId}/${"x".repeat(65)}`,
    );
    expect(res.status).toBe(400);
    expect(gov.urls).toHaveLength(0);
  });
});

// CH-H2 ③：GET /api/governance/spatial-tree/for-session/:sessionId（resolve host IFC 路徑 → forward GET /api/spatial-tree）。
async function startGovernanceSpatialStub(): Promise<{ baseUrl: string; urls: string[] }> {
  const urls: string[] = [];
  governanceStub = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url ?? "").startsWith("/api/spatial-tree")) {
      urls.push(req.url ?? "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ tree: { ifc_type: "IfcProject", name: "P", children: [], type_counts: {} } }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
}

describe("GET /api/governance/spatial-tree/for-session/:sessionId", () => {
  it("解析 session host IFC 路徑並 forward 至 governance /api/spatial-tree（帶 ifc_source_path）", async () => {
    const gov = await startGovernanceSpatialStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });
    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);

    const res = await request(app.app).get(`/api/governance/spatial-tree/for-session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body.tree.ifc_type).toBe("IfcProject");
    expect(gov.urls).toHaveLength(1);
    expect(gov.urls[0]).toContain(`ifc_source_path=${encodeURIComponent(hostLocalPath)}`);
  });

  it("已下載 session 的 source IFC 被刪除 → 409 stale_session_artifact，且不打 governance", async () => {
    const gov = await startGovernanceSpatialStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const streamingBase = await startStreamingStub();
    const ifcSourceUrl = await startIfcSourceStub();
    const app = makeApp({ streamingConversionApiBase: streamingBase, ifcDownloadStrict: true });
    const { sessionId, hostLocalPath } = await seedSessionWithDownloadedIfc(app, streamingBase, ifcSourceUrl);
    fs.rmSync(hostLocalPath);

    const res = await request(app.app).get(`/api/governance/spatial-tree/for-session/${sessionId}`);

    expectStaleSourceIfcResponse(res);
    expect(gov.urls).toHaveLength(0);
  });

  it("session 不存在 → 404，不打 governance", async () => {
    const gov = await startGovernanceSpatialStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const res = await request(app.app).get(`/api/governance/spatial-tree/for-session/review_session_nope`);
    expect(res.status).toBe(404);
    expect(gov.urls).toHaveLength(0);
  });

  it("無效 session id → 400", async () => {
    const app = makeApp();
    const res = await request(app.app).get(`/api/governance/spatial-tree/for-session/..%2Fetc`);
    expect(res.status).toBe(400);
  });
});
