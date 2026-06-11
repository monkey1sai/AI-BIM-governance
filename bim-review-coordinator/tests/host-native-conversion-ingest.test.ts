import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { sanitizeArtifactIdPart } from "../src/services/streamingConversionClient.js";
import type { CoordinatorConfig } from "../src/config.js";

// introduce-host-native-conversion-authority-service / conversion-webhook-lifecycle
// (ADDED): coordinator 主動拉 host-native `GET /api/conversions/{id}/result`，
// 映射成既有 report 形狀 → 同一條 metadata-only callback outbox 路徑。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const IFC_CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json"),
    "utf-8",
  ),
) as { example: Record<string, unknown> };

const INTERNAL_TOKEN = "dev-internal-token";
const CORRELATION = "corr_cbk_001";

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (stub) {
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
  }
});

function startStreamingStub(resultPayload: Record<string, unknown>): Promise<string> {
  return new Promise((resolve) => {
    stub = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversion_job_id: "stream_conv_test_001",
            status: "queued",
            authority: "bim-streaming-server",
            correlation_id: CORRELATION,
          }),
        );
        return;
      }
      if (
        req.method === "GET" &&
        req.url === "/api/conversions/stream_conv_test_001/result"
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(resultPayload));
        return;
      }
      res.writeHead(404).end("{}");
    });
    stub.listen(0, "127.0.0.1", () => {
      const port = (stub!.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function makeApp(streamingBase: string, overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-hnci-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: streamingBase,
    callbackOutboxMaxAttempts: 2,
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

async function seedIfcReadyJob(app: CoordinatorApp): Promise<void> {
  await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": CORRELATION,
      "X-Idempotency-Key": "idem_cbk_001",
    })
    .send({ ...structuredClone(IFC_CONTRACT.example) });
}

const READY_RESULT = {
  conversion_job_id: "stream_conv_test_001",
  authority: "bim-streaming-server",
  status: "succeeded",
  ready: true,
  correlation_id: CORRELATION,
  model: { status: "ready", format: "usdc", url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc" },
  artifacts: {
    model_usdc: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/model.usdc" },
    element_mapping: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/element_mapping.json" },
    entity_index: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/entity_index.json" },
    metadata: { url: "http://127.0.0.1:49101/artifacts/stream_conv_test_001/metadata.json" },
  },
  quality_metrics: { coverage_status: "pass" },
};

const FAILED_RESULT = {
  conversion_job_id: "stream_conv_test_001",
  authority: "bim-streaming-server",
  status: "failed",
  ready: false,
  correlation_id: CORRELATION,
  model: { status: "failed", format: "usdc", url: null },
  artifacts: {},
  error: { code: "converter_unavailable", message: "converter prerequisites missing" },
};

describe("host-native conversion result ingest (pull)", () => {
  it("ready result enqueues a metadata-only conversion_result_ready callback", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("ready");
    expect(res.body.callback.event).toBe("conversion_result_ready");
    const payloadText = JSON.stringify(res.body.callback.payload);
    // metadata refs only — no large file bodies.
    expect(res.body.callback.payload.artifacts.usdc_ref).toContain("model.usdc");
    expect(payloadText).not.toContain("PXR-USDC");
    expect(res.body.ifc_ready_job.conversion_status).toBe("ready");
  });

  it("failed result enqueues conversion_failed with reason", async () => {
    const base = await startStreamingStub(FAILED_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("failed");
    expect(res.body.callback.event).toBe("conversion_failed");
    expect(res.body.callback.payload.reason).toContain("converter prerequisites missing");
  });

  it("rejects internal route without internal token", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .send({});

    expect(res.status).toBe(401);
  });

  // coordinator-forward-quality-metrics-summary:三個 scenario verifying ingest
  // 把 quality_metrics 萃取進 session.quality_metrics_summary,並從
  // stream-config response forward 給 viewer / `/ui`。
  it("ingest forwards C1 semantic mapping fidelity into stream-config quality_metrics_summary", async () => {
    const READY_WITH_SEMANTIC = {
      ...READY_RESULT,
      original_filename: "270_demo_model.ifc",
      artifact_group_id: "ag_demo_270",
      quality_metrics: {
        source_ifc_entity_count: 4889,
        sidecar_carrier_count: 4889,
        materialization_strategy: "ifcopenshell_openusd_fallback",
        coverage_ratio: 1.0,
        coverage_status: "pass",
        semantic_mapping_fidelity: "ifc_class_grouped_with_name",
        mapping_has_ifc_type: true,
        mapping_has_ifc_name: true,
        phase_timings: { conversion_total: { duration_seconds: 73.5 } },
      },
    };
    const base = await startStreamingStub(READY_WITH_SEMANTIC);
    const app = makeApp(base);
    await seedIfcReadyJob(app);
    const ingest = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});
    expect(ingest.status).toBe(202);
    const sessionId = ingest.body.session?.session_id as string;
    expect(sessionId).toMatch(/^review_session_/);

    const sc = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    expect(sc.status).toBe(200);
    const summary = sc.body.quality_metrics_summary;
    expect(summary).toBeTruthy();
    expect(summary.semantic_mapping_fidelity).toBe("ifc_class_grouped_with_name");
    expect(summary.mapping_has_ifc_type).toBe(true);
    expect(summary.mapping_has_ifc_name).toBe(true);
    expect(summary.materialization_strategy).toBe("ifcopenshell_openusd_fallback");
    expect(summary.source_ifc_entity_count).toBe(4889);
    expect(summary.coverage_ratio).toBe(1.0);
    expect(summary.coverage_status).toBe("pass");
    expect(summary.conversion_duration_seconds).toBe(73.5);
    expect(summary.fixture_name).toBe("270_demo_model.ifc");
    expect(summary.artifact_group_id).toBe("ag_demo_270");
    expect(summary.conversion_job_id).toBe("stream_conv_test_001");
  });

  it("ingest with quality_metrics partial only forwards existing keys (null elsewhere)", async () => {
    const READY_PARTIAL = {
      ...READY_RESULT,
      quality_metrics: {
        materialization_strategy: "sidecar",
        coverage_status: "warn",
      },
    };
    const base = await startStreamingStub(READY_PARTIAL);
    const app = makeApp(base);
    await seedIfcReadyJob(app);
    const ingest = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});
    const sessionId = ingest.body.session?.session_id as string;
    const sc = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    const summary = sc.body.quality_metrics_summary;
    expect(summary).toBeTruthy();
    expect(summary.materialization_strategy).toBe("sidecar");
    expect(summary.coverage_status).toBe("warn");
    // missing keys 必須是 null 不是 undefined(schema stable)
    expect(summary.semantic_mapping_fidelity).toBeNull();
    expect(summary.mapping_has_ifc_type).toBeNull();
    expect(summary.mapping_has_ifc_name).toBeNull();
    expect(summary.source_ifc_entity_count).toBeNull();
    expect(summary.conversion_duration_seconds).toBeNull();
  });

  it("ingest with no quality_metrics keeps stream-config quality_metrics_summary null (backward compat)", async () => {
    const { quality_metrics: _omit, ...resultWithoutQuality } = READY_RESULT;
    const base = await startStreamingStub(resultWithoutQuality);
    const app = makeApp(base);
    await seedIfcReadyJob(app);
    const ingest = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});
    const sessionId = ingest.body.session?.session_id as string;
    const sc = await request(app.app).get(`/api/review-sessions/${sessionId}/stream-config`);
    expect(sc.body.quality_metrics_summary).toBeNull();
  });

  it("non-terminal (queued/running) result is not coerced to failed", async () => {
    const base = await startStreamingStub({
      conversion_job_id: "stream_conv_test_001",
      authority: "bim-streaming-server",
      status: "running",
      ready: false,
      correlation_id: CORRELATION,
      model: { status: "converting", format: "usdc", url: null },
      artifacts: {},
    });
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    // must NOT enqueue a premature conversion_failed callback
    expect(res.status).toBe(409);
    expect(res.body.conversion_status).toBe("converting");
  });
});

// backfill-coordinator-webhook-and-auto-session §2-§3：conversion-ready 自動建
// review session（B 方案 re-home：_bim-control runtime 退役後的 session 觸發
// 責任接 coordinator 自身的 conversion-ready ingestion）。
// 規格權威：openspec/specs/review-session-request-lifecycle/spec.md
// §"Coordinator session is bound back to the request"（含 4 scenarios）+
// openspec/specs/conversion-webhook-lifecycle/spec.md
// §"Terminal conversion-ready ingestion triggers local review session handoff"
// （含 3 scenarios）。
describe("conversion-ready auto-session handoff", () => {
  it("ready ingestion 自動建立綁 USDC + Kit binding 的 session（spec: auto-creates a review session under retired _bim-control）", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    // session 物件附在 ingest response（與 callback outbox 並行、狀態獨立）
    expect(res.body.session).toBeTruthy();
    expect(res.body.session.session_id).toMatch(/^review_session_/);
    expect(res.body.session.status).toBe("active");
    expect(res.body.session.usdc_artifact_id).toContain("auto_usdc_");
    expect(res.body.session.model_version_id).toBe("ext_mv_demo_001");
    // Kit binding 已被分配（control-plane 接線）
    expect(res.body.session.kit_instance_bindings).toHaveLength(1);
    expect(res.body.session.kit_instance_bindings[0].assigned_artifact_ids).toContain(res.body.session.usdc_artifact_id);
    // session 可被 viewer 透過 GET /api/review-sessions/{id} 查到
    const getRes = await request(app.app).get(`/api/review-sessions/${res.body.session.session_id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.session_id).toBe(res.body.session.session_id);
  });

  it("duplicate ready ingestion 不建重複 active session（spec: Duplicate conversion-ready does not create duplicate sessions）", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const first = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});
    const second = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.session.session_id).toBe(first.body.session.session_id);
    // session_replay 標記為 true（idempotent re-entry）
    expect(second.body.session_replay).toBe(true);
  });

  it("failed ingestion 不建可串流 session（spec: Non-ready conversion does not create a streamable session + Failed conversion creates no local session）", async () => {
    const base = await startStreamingStub(FAILED_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("failed");
    // 不得建可串流 session
    expect(res.body.session).toBeNull();
    // callback outbox 仍記 failed（兩者狀態獨立分類）
    expect(res.body.callback.event).toBe("conversion_failed");
  });

  it("pending cloud callback 不阻塞 local session handoff（spec: Pending cloud callback does not block local session handoff）", async () => {
    // 不設 cloudCallbackBaseUrl → callback 仍入 outbox（默認 pending；本測試
    // 不啟動 delivery loop，故 outbox status 一直 pending）；本 assert 關注的是
    // session handoff 與 callback enqueue 狀態獨立分類，session 不被 callback
    // 狀態阻塞、且 session_id 不會被混入 callback payload。
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    // session handoff 成功（不被 outbox 狀態阻塞）
    expect(res.body.session).toBeTruthy();
    expect(res.body.session.status).toBe("active");
    // callback 仍入 outbox（狀態獨立分類；status 為 pending 直至 delivery loop 跑）
    expect(res.body.callback.event).toBe("conversion_result_ready");
    expect(res.body.callback.status).toBe("pending");
    // session_id 不被誤標進 callback 為「雲端 callback 成功」
    expect(res.body.callback.payload.session_id).toBeUndefined();
  });

  it("auto-creation 不啟動 Kit 進程、不開 USD stage、不渲染（spec: Coordinator-triggered creation stays control-plane only）", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    // session 寫了 metadata；但只是 metadata（不發 Kit 進程 spawn / USD open
    // / render 指令）。斷言方式：session.kit_instance / kit_instance_bindings
    // 是 metadata schema，而非「executed」狀態；不存在 process_id / render
    // _started_at 之類的 runtime 欄位。
    expect(res.body.session.kit_instance).toBeTruthy();
    expect(res.body.session.kit_instance).not.toHaveProperty("process_id");
    expect(res.body.session.kit_instance).not.toHaveProperty("render_started_at");
    expect(res.body.session.kit_instance_bindings[0]).not.toHaveProperty("process_id");
    expect(res.body.session.kit_instance_bindings[0]).not.toHaveProperty("usd_stage_opened_at");
  });

  it("lifecycle audit event 仍與 explicit /api/review-sessions caller 路徑等價（Risk mitigation）", async () => {
    const base = await startStreamingStub(READY_RESULT);
    const app = makeApp(base);
    await seedIfcReadyJob(app);

    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    const sessionId = res.body.session.session_id;
    const lifecycleRes = await request(app.app).get(`/api/review-sessions/${sessionId}/lifecycle-events`);
    expect(lifecycleRes.status).toBe(200);
    const types = (lifecycleRes.body.items as Array<{ type: string }>).map((it) => it.type);
    expect(types).toContain("sessionCreated");
    expect(types).toContain("sessionActive");
  });
});

// cr1（對抗複驗 high regression — 本 fix 引入）：conversion authority 對 correlation_id
// 跑 _safe_id，回傳的是 **sanitize 後** correlation_id（worker 派生含冒號者會被改寫）。
// coordinator 的 ingestConversionReport → getByCorrelation 過去只以「原始」correlation_id
// 建索引 → 凡 correlation 被 sanitize 改寫，結果回拋必 404 閉環斷裂。
// 端到端對帳測試：worker 派生（冒號 correlation）案例 dispatch 後，模擬 conversion result
// callback 以 sanitize 後 correlation_id 回拋 → 必須命中原 job（非 404）、狀態正確推進。
describe("conversion result reconciliation with sanitized correlation_id (cr1)", () => {
  // worker compat normalize 派生的含冒號 correlation_id（app.ts normalizeIntakePayload）。
  const RAW_CORRELATION = "worker:899::xxx::task_recon_001";
  const SANITIZED_CORRELATION = sanitizeArtifactIdPart(RAW_CORRELATION);

  it("worker 派生冒號 correlation：result 以 sanitize 後 correlation 回拋 → 命中原 job（非 404）", async () => {
    // 前置 sanity：sanitize 確實改寫了原始值（否則本測試無法證明雙鍵命中）。
    expect(SANITIZED_CORRELATION).not.toBe(RAW_CORRELATION);
    expect(SANITIZED_CORRELATION).toMatch(/^[A-Za-z0-9_.-]+$/);

    // streaming result 回拋 sanitize 後 correlation_id（= 真 conversion_authority 行為）。
    const readyResultSanitizedCorr = {
      ...READY_RESULT,
      correlation_id: SANITIZED_CORRELATION,
    };
    const base = await startStreamingStub(readyResultSanitizedCorr);
    const app = makeApp(base);

    // seed：以含冒號的 raw correlation 建立 ifc-ready job（worker 派生形狀）。
    await request(app.app)
      .post("/api/external/ifc-ready")
      .set({
        "X-Webhook-Secret": "dev-webhook-secret",
        "X-Correlation-Id": RAW_CORRELATION,
        "X-Idempotency-Key": "idem_recon_001",
      })
      .send({ ...structuredClone(IFC_CONTRACT.example) });

    // ingest：result.correlation_id = sanitize 後值 → 必須仍命中原 job（非 404）。
    const res = await request(app.app)
      .post("/api/internal/conversions/stream_conv_test_001/ingest")
      .set({ "X-Internal-Token": INTERNAL_TOKEN })
      .send({});

    expect(res.status).toBe(202);
    expect(res.body.conversion_status).toBe("ready");
    // 命中的是原 job（external_model_version_id 來自 contract example，未被改寫）。
    expect(res.body.ifc_ready_job.conversion_status).toBe("ready");
    expect(res.body.callback.event).toBe("conversion_result_ready");
  });
});
