import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { CallbackOutbox, MetadataOnlyViolation } from "../src/services/callbackOutbox.js";

// F2 步驟⑩（AI-BIM 前後端設計文件）：Coordinator → 雲端 Outbox 摘要回拋
// （issue/檢核統計，metadata-only）。本檔驗兩條純加性 route：
//   1. GET  /api/callback-outbox/summary（瀏覽器可達、無 token）：redacted 投影，
//      絕不外洩 payload / target_url；limit 預設 50、上限 200、非法 400。
//   2. POST /api/review-sessions/:sessionId/issue-snapshot：server-side 查
//      governance（GOVERNANCE_API_BASE，與 routes/governanceProxy.ts 同源）後
//      enqueue `issue_snapshot`；404/400/502 誠實失敗，成功 202 {outbox_id}。
// 另驗 assertMetadataOnly 鐵律對 issue_snapshot 事件同樣生效。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"), "utf-8"),
) as { example: Record<string, unknown> };

const WEBHOOK_SECRET = "dev-webhook-secret";
const INTERNAL_TOKEN = "dev-internal-token";
const SUMMARY_FIELDS = [
  "attempts",
  "conversion_job_id",
  "correlation_id",
  "created_at",
  "delivered_at",
  "event",
  "last_error",
  "max_attempts",
  "outbox_id",
  "status",
];

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-outbox-summary-test-"));
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

/**
 * governance-service stub：GET /api/rule-runs/{id}（status + summary.failed）與
 * GET /api/issues?model_version_id=...（issues[].status）。記錄 URL 供 assert。
 */
async function startGovernanceStub(): Promise<{ baseUrl: string; urls: string[] }> {
  const urls: string[] = [];
  governanceStub = http.createServer((req, res) => {
    const url = req.url ?? "/";
    urls.push(`${req.method ?? "GET"} ${url}`);
    if (req.method === "GET" && url.startsWith("/api/rule-runs/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        rule_run_id: decodeURIComponent(url.slice("/api/rule-runs/".length)),
        status: "succeeded",
        summary: { total: 10, passed: 7, failed: 3, errored: 0 },
        model_version_id: "version_demo_001",
      }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/api/issues")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        issues: [
          { id: "iss_001", status: "open" },
          { id: "iss_002", status: "in_progress" },
          { id: "iss_003", status: "resolved" },
        ],
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls };
}

/** 走真實 intake + conversion-result 路徑 seed 一筆帶 payload/target_url 的 outbox entry。 */
async function seedConversionOutboxEntry(app: CoordinatorApp): Promise<string> {
  const intake = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": WEBHOOK_SECRET,
      "X-Correlation-Id": "corr_summary_001",
      "X-Idempotency-Key": "idem_summary_001",
    })
    .send({ ...structuredClone(IFC_CONTRACT.example) });
  expect(intake.status).toBe(202);
  const res = await request(app.app)
    .post("/api/internal/conversion-result")
    .set({ "X-Internal-Token": INTERNAL_TOKEN })
    .send({
      correlation_id: "corr_summary_001",
      conversion_job_id: "cj_summary_001",
      status: "ready",
      artifacts: { usdc_ref: "edge-local://t/mv/cj/model.usdc" },
      artifact_summary: { usdc_openable: true },
    });
  expect(res.status).toBe(202);
  return res.body.callback.outbox_id as string;
}

/** 顯式建一個 review session（不走 IFC intake），回 session_id。 */
async function seedSession(app: CoordinatorApp): Promise<string> {
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
  return created.body.session_id as string;
}

describe("GET /api/callback-outbox/summary（redacted 投影，無 token）", () => {
  it("回傳 redacted 欄位；絕不含 payload / target_url / 任何 URL", async () => {
    // callback_url（契約 example 的 https://company-cloud.example/...）會落在
    // entry.target_url + payload；summary 必須兩者皆排除。
    const app = makeApp({ cloudCallbackBaseUrl: "" });
    const outboxId = await seedConversionOutboxEntry(app);

    const res = await request(app.app).get("/api/callback-outbox/summary");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(50);
    expect(res.body.total).toBe(1);
    expect(res.body.entries).toHaveLength(1);
    const entry = res.body.entries[0];
    expect(entry.outbox_id).toBe(outboxId);
    expect(entry.event).toBe("conversion_result_ready");
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(0);
    expect(entry.max_attempts).toBeGreaterThan(0);
    expect(entry.correlation_id).toBe("corr_summary_001");
    expect(entry.conversion_job_id).toBe("cj_summary_001");
    // 欄位集合精確等於 redacted 投影（payload / target_url / evidence 不在其中）。
    expect(Object.keys(entry).sort()).toEqual(SUMMARY_FIELDS);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/"payload"|"target_url"|"evidence"/);
    expect(raw).not.toMatch(/https?:\/\/|edge-local:\/\/|company-cloud/);
  });

  it("limit 生效：3 筆取 2（newest-first），total 仍回全量", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const sessionId = await seedSession(app);
    for (let i = 0; i < 3; i += 1) {
      const res = await request(app.app)
        .post(`/api/review-sessions/${sessionId}/issue-snapshot`)
        .send({ rule_run_id: `rr_limit_${i}` });
      expect(res.status).toBe(202);
    }

    const res = await request(app.app).get("/api/callback-outbox/summary").query({ limit: "2" });

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.total).toBe(3);
    expect(res.body.entries).toHaveLength(2);
  });

  it.each(["0", "201", "abc", "-1", "1.5"])("非法 limit=%s → 400", async (bad) => {
    const app = makeApp();
    const res = await request(app.app).get("/api/callback-outbox/summary").query({ limit: bad });
    expect(res.status).toBe(400);
    expect(typeof res.body.detail).toBe("string");
  });
});

describe("POST /api/review-sessions/:sessionId/issue-snapshot", () => {
  it("session 不存在 → 404，且不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/review-sessions/review_session_does_not_exist/issue-snapshot")
      .send({ rule_run_id: "rr_snap_001" });

    expect(res.status).toBe(404);
    expect(gov.urls).toHaveLength(0);
  });

  it("無效 session id 格式 → 400", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/review-sessions/..%2Fetc/issue-snapshot")
      .send({ rule_run_id: "rr_snap_001" });
    expect(res.status).toBe(400);
  });

  it("body 缺 rule_run_id → 400（zod），且不打 governance、不入列", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const sessionId = await seedSession(app);

    const res = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/issue-snapshot`)
      .send({});

    expect(res.status).toBe(400);
    expect(gov.urls).toHaveLength(0);
    const summary = await request(app.app).get("/api/callback-outbox/summary");
    expect(summary.body.total).toBe(0);
  });

  it("governance 不可達 → 502 {error:'governance_unreachable'}，不入列", async () => {
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const app = makeApp();
    const sessionId = await seedSession(app);

    const res = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/issue-snapshot`)
      .send({ rule_run_id: "rr_snap_001", model_version_id: "version_demo_001" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "governance_unreachable" });
    const summary = await request(app.app).get("/api/callback-outbox/summary");
    expect(summary.body.total).toBe(0);
  });

  it("成功 → 202 {outbox_id}；outbox 有 metadata-only issue_snapshot（統計正確、零 URL/bytes）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const sessionId = await seedSession(app);

    const res = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/issue-snapshot`)
      .send({ rule_run_id: "rr_snap_001", model_version_id: "version_demo_001" });

    expect(res.status).toBe(202);
    expect(typeof res.body.outbox_id).toBe("string");
    // coordinator server-side 查了 rule-run + issues 兩條 governance API。
    expect(gov.urls).toEqual([
      "GET /api/rule-runs/rr_snap_001",
      "GET /api/issues?model_version_id=version_demo_001",
    ]);

    const entry = (
      await request(app.app)
        .get(`/api/internal/callback-outbox/${res.body.outbox_id}`)
        .set({ "X-Internal-Token": INTERNAL_TOKEN })
    ).body;
    expect(entry.event).toBe("issue_snapshot");
    expect(entry.status).toBe("pending");
    expect(entry.correlation_id).toBe(sessionId);
    expect(entry.conversion_job_id).toBeNull();
    expect(entry.payload).toMatchObject({
      event: "issue_snapshot",
      session_id: sessionId,
      rule_run_id: "rr_snap_001",
      model_version_id: "version_demo_001",
      rule_run_status: "succeeded",
      failed_count: 3,
      issue_total: 3,
      issue_open: 2, // open + in_progress；resolved 為終局不計
    });
    expect(typeof entry.payload.snapshot_at).toBe("string");
    // 金額零 secret / URL / bytes 入 payload。
    expect(JSON.stringify(entry.payload)).not.toMatch(/https?:\/\/|X-Amz|PXR-USDC|content_base64/i);

    // 瀏覽器摘要面看得到這筆事件，但仍無 payload / target_url。
    const summary = await request(app.app).get("/api/callback-outbox/summary");
    expect(summary.body.entries[0]).toMatchObject({ event: "issue_snapshot", correlation_id: sessionId });
    expect(JSON.stringify(summary.body)).not.toMatch(/"payload"|"target_url"/);
  });

  it("未給 model_version_id → 只查 rule-run；issue_total/issue_open 誠實回 null", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();
    const sessionId = await seedSession(app);

    const res = await request(app.app)
      .post(`/api/review-sessions/${sessionId}/issue-snapshot`)
      .send({ rule_run_id: "rr_snap_002" });

    expect(res.status).toBe(202);
    expect(gov.urls).toEqual(["GET /api/rule-runs/rr_snap_002"]);
    const entry = (
      await request(app.app)
        .get(`/api/internal/callback-outbox/${res.body.outbox_id}`)
        .set({ "X-Internal-Token": INTERNAL_TOKEN })
    ).body;
    expect(entry.payload.issue_total).toBeNull();
    expect(entry.payload.issue_open).toBeNull();
    expect(entry.payload.rule_run_status).toBe("succeeded");
    expect(entry.payload.failed_count).toBe(3);
    // model_version_id fallback 到 session 的 metadata 值。
    expect(entry.payload.model_version_id).toBe("version_demo_001");
  });
});

describe("assertMetadataOnly 對 issue_snapshot 生效（雲地分離鐵律）", () => {
  it("forbidden key（content_base64）→ enqueue 丟 MetadataOnlyViolation", () => {
    const outbox = new CallbackOutbox(2, async () => undefined, null);
    expect(() =>
      outbox.enqueue({
        event: "issue_snapshot",
        targetUrl: null,
        correlationId: "review_session_meta_001",
        externalModelVersionId: "version_demo_001",
        conversionJobId: null,
        payload: { rule_run_id: "rr_x", content_base64: "AAAA" },
      }),
    ).toThrow(MetadataOnlyViolation);
  });

  it("內嵌模型本體（PXR-USDC 大字串）→ 丟 MetadataOnlyViolation；純統計 metadata 通過", () => {
    const outbox = new CallbackOutbox(2, async () => undefined, null);
    expect(() =>
      outbox.enqueue({
        event: "issue_snapshot",
        targetUrl: null,
        correlationId: "review_session_meta_002",
        externalModelVersionId: "version_demo_001",
        conversionJobId: null,
        payload: { rule_run_id: "rr_x", blob: `PXR-USDC${"A".repeat(5000)}` },
      }),
    ).toThrow(MetadataOnlyViolation);

    const entry = outbox.enqueue({
      event: "issue_snapshot",
      targetUrl: null,
      correlationId: "review_session_meta_003",
      externalModelVersionId: "version_demo_001",
      conversionJobId: null,
      payload: {
        event: "issue_snapshot",
        rule_run_id: "rr_x",
        rule_run_status: "succeeded",
        failed_count: 3,
        issue_total: 3,
        issue_open: 2,
        snapshot_at: new Date().toISOString(),
      },
    });
    expect(entry.event).toBe("issue_snapshot");
    expect(entry.status).toBe("pending");
  });
});
