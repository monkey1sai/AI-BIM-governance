import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import { createLogger, type StructLogger } from "../src/lib/structLog.js";
import { CallbackOutbox } from "../src/services/callbackOutbox.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { EventLog } from "../src/services/eventLog.js";
import { ExternalIfcReadyStore } from "../src/services/externalIfcReadyStore.js";
import { SessionStore } from "../src/services/sessionStore.js";
import type {
  ExternalIfcReadyEvent,
  IfcReadyTerminalObserverSnapshot,
} from "../src/types.js";

// coordinator-auto-poll-streaming-conversion §5 unit cover:
// - dispatch 後 in-process polling 自動 ingest ready / failed
// - poller 重複 dispatch 不雙起
// - manual ingest endpoint 觸發 cancel auto poller(no double ingest)
// - max attempts 達到 → poll_timeout 走 failed-equivalent ingest
// - conversionPollEnabled:false fixture 不啟 poller

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(TEST_DIR, "..", "..", "tests", "contracts", "ifc_ready_payload.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as {
  example: Record<string, unknown>;
};

const WEBHOOK_SECRET = "dev-webhook-secret";

let active: CoordinatorApp | null = null;
let activeStub: http.Server | null = null;

afterEach(async () => {
  if (active) await active.dispose();
  if (activeStub) {
    await new Promise<void>((resolve) => activeStub?.close(() => resolve()));
    activeStub = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

interface StubBehavior {
  /** 順序回的 /result body;最後一個 entry 用完後重複。 */
  resultSequence: Array<Record<string, unknown>>;
  resultStatus?: number;
  dispatchStatus?: string;
}

async function startStreamingStub(behavior: StubBehavior): Promise<{
  baseUrl: string;
  dispatchCount: { value: number };
  resultCount: { value: number };
}> {
  const dispatchCount = { value: 0 };
  const resultCount = { value: 0 };
  activeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        dispatchCount.value += 1;
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          conversion_job_id: "stream_conv_auto_poll_test",
          status: behavior.dispatchStatus ?? "queued",
          correlation_id: (JSON.parse(body) as { correlation_id?: string }).correlation_id ?? "corr_auto_001",
          authority: "bim-streaming-server",
        }));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/conversions/")) {
        const idx = Math.min(resultCount.value, behavior.resultSequence.length - 1);
        resultCount.value += 1;
        const payload = behavior.resultSequence[idx];
        res.writeHead(behavior.resultStatus ?? 200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "not found" }));
    });
  });
  await new Promise<void>((resolve) => {
    activeStub?.listen(0, "127.0.0.1", () => resolve());
  });
  const address = activeStub.address();
  if (!address || typeof address === "string") {
    throw new Error("stub did not bind");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, dispatchCount, resultCount };
}

function readyResultPayload(correlationId: string): Record<string, unknown> {
  return {
    conversion_job_id: "stream_conv_auto_poll_test",
    status: "succeeded",
    ready: true,
    correlation_id: correlationId,
    model: { status: "ready", url: "http://127.0.0.1:49101/artifacts/x/model.usdc" },
    artifacts: {
      model_usdc: { url: "http://127.0.0.1:49101/artifacts/x/model.usdc" },
      element_mapping: { url: "http://127.0.0.1:49101/artifacts/x/element_mapping.json" },
      metadata: { url: "http://127.0.0.1:49101/artifacts/x/metadata.json" },
    },
  };
}

function failedResultPayload(correlationId: string): Record<string, unknown> {
  return {
    conversion_job_id: "stream_conv_auto_poll_test",
    status: "failed",
    ready: false,
    correlation_id: correlationId,
    model: { status: "failed" },
    error: { code: "fixture_failed", message: "fixture says failed" },
  };
}

function queuedResultPayload(correlationId: string): Record<string, unknown> {
  return {
    conversion_job_id: "stream_conv_auto_poll_test",
    status: "queued",
    ready: false,
    correlation_id: correlationId,
    model: { status: "queued" },
  };
}

function makeApp(
  streamingBase: string,
  overrides: Partial<CoordinatorConfig> = {},
  structLog?: StructLogger,
): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-auto-poll-test-"));
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      streamingConversionApiBase: streamingBase,
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: true,
      // 50ms tick → 半秒內 ~10 次 poll,test 跑完很快
      conversionPollIntervalSeconds: 0.05,
      conversionPollMaxAttempts: 20,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      ...overrides,
    },
    structLog ? { structLog } : undefined,
  );
  return active;
}

function dispatchPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(CONTRACT.example), ...overrides };
}

function authHeaders(correlationId: string, idempotencyKey: string): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": correlationId,
    "X-Idempotency-Key": idempotencyKey,
  };
}

function seedPendingTerminalObserver(
  root: string,
  suffix: string,
): {
  externalStorePath: string;
  outboxStorePath: string;
  sessionStoreDir: string;
  jobId: string;
  outboxId: string;
  snapshot: IfcReadyTerminalObserverSnapshot;
} {
  const externalStorePath = path.join(root, "coordinator", "external-ifc-ready.json");
  const outboxStorePath = path.join(root, "coordinator", "callback-outbox.json");
  const sessionStoreDir = path.join(root, "coordinator", "sessions");
  const correlationId = `corr_observer_restart_${suffix}`;
  const idempotencyKey = `idem_observer_restart_${suffix}`;
  const conversionJobId = `stream_conv_observer_restart_${suffix}`;
  const store = new ExternalIfcReadyStore(externalStorePath);
  const job = store.create(
    structuredClone(CONTRACT.example) as unknown as ExternalIfcReadyEvent,
    {
      correlationId,
      idempotencyKey,
      tenantId: "tenant_demo_001",
      projectId: "project_demo_001",
      externalModelVersionId: `ext_mv_observer_restart_${suffix}`,
    },
  );
  store.markDispatched(job.ifc_ready_job_id, conversionJobId, "succeeded");
  const artifacts = {
    usdc_ref: `edge-local://observer-restart/${suffix}/model.usdc`,
    element_mapping_ref: `edge-local://observer-restart/${suffix}/element_mapping.json`,
    manifest_ref: `edge-local://observer-restart/${suffix}/artifact_manifest.json`,
  };
  const outbox = new CallbackOutbox(
    5,
    async () => undefined,
    outboxStorePath,
  ).enqueue({
    event: "conversion_result_ready",
    targetUrl: null,
    correlationId,
    externalModelVersionId: `ext_mv_observer_restart_${suffix}`,
    conversionJobId,
    payload: {
      event: "conversion_result_ready",
      trace_id: job.ifc_ready_job_id,
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      external_model_version_id: `ext_mv_observer_restart_${suffix}`,
      conversion_job_id: conversionJobId,
      correlation_id: correlationId,
      status: "ready",
      artifacts,
      artifact_summary: { coverage_status: "pass" },
    },
  });
  const snapshot: IfcReadyTerminalObserverSnapshot = {
    status: "ready",
    report_status: "ready",
    conversion_job_id: conversionJobId,
    artifacts,
    artifact_summary: { coverage_status: "pass" },
    quality_summary: {
      conversion_job_id: conversionJobId,
      coverage_status: "pass",
      semantic_mapping_fidelity: "guid_exact",
      mapping_has_ifc_type: true,
      mapping_has_ifc_name: true,
    },
  };
  store.recordConversionOutcome(
    job.ifc_ready_job_id,
    "ready",
    outbox.outbox_id,
    artifacts.manifest_ref,
    null,
    snapshot,
  );
  return {
    externalStorePath,
    outboxStorePath,
    sessionStoreDir,
    jobId: job.ifc_ready_job_id,
    outboxId: outbox.outbox_id,
    snapshot,
  };
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe("coordinator auto-poll streaming conversion", () => {
  it("auto-poll anomaly records retain the IFC-ready root trace", async () => {
    const stub = await startStreamingStub({
      resultSequence: [{ detail: "temporarily unavailable" }],
      resultStatus: 503,
    });
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-auto-poll-log-"));
    const structLog = createLogger("coordinator", {
      logRoot,
      runId: "run_auto_poll_root_trace",
      skipEnvSnapshot: true,
    });
    const app = makeApp(
      stub.baseUrl,
      { conversionPollMaxAttempts: 1 },
      structLog,
    );

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_trace_001", "idem_ap_trace_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const ifcReadyJobId = submit.body.ifc_ready_job_id as string;

    await waitFor(() => {
      if (!fs.existsSync(structLog.currentFile())) return false;
      return fs.readFileSync(structLog.currentFile(), "utf-8").includes("auto-poll fetch error");
    });
    const records = fs
      .readFileSync(structLog.currentFile(), "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.component === "autoPoll");

    expect(records).not.toHaveLength(0);
    expect(records.every((record) => record.trace_id === ifcReadyJobId)).toBe(true);
    expect(records.some((record) => record.trace_id === "stream_conv_stream_conv_auto_poll_test")).toBe(false);
  });

  it("poller 達 max attempts → 以 durable job correlation 落 failed/outbox，不留下無人恢復的 dispatched job", async () => {
    const stub = await startStreamingStub({
      resultSequence: [queuedResultPayload("corr_ap_timeout_001")],
    });
    const app = makeApp(stub.baseUrl, { conversionPollMaxAttempts: 1 });

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_timeout_001", "idem_ap_timeout_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const jobId = submit.body.ifc_ready_job_id as string;

    await waitFor(async () => {
      const detail = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return detail.body.conversion_status === "failed";
    });
    const persisted = app.externalIfcReadyStore.get(jobId);
    expect(persisted?.conversion_failure).toBe("poll_timeout");
    expect(persisted?.callback_outbox_id).toBeTruthy();
  });

  it("dispatch 成功後 poller 自動 fetch 直到 ready,自動 ingest 出 viewer_url + callback", async () => {
    const stub = await startStreamingStub({
      resultSequence: [
        queuedResultPayload("corr_ap_ready_001"),
        queuedResultPayload("corr_ap_ready_001"),
        readyResultPayload("corr_ap_ready_001"),
      ],
    });
    const app = makeApp(stub.baseUrl);

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_ready_001", "idem_ap_ready_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const jobId = submit.body.ifc_ready_job_id as string;
    expect(jobId).toMatch(/^ifcready_/);
    // coordinator-serial-conversion-dispatch-queue:dispatch 改為 async worker,
    // POST 立即回應後 worker 才 tick → 呼叫 streaming stub。等 dispatchCount=1。
    await waitFor(() => stub.dispatchCount.value === 1);

    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.viewer_url != null;
    });

    const final = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(final.body.conversion_status).toBe("ready");
    expect(final.body.viewer_url).toMatch(/\/ui\/open\?session=/);
    expect(final.body.web_view_session_id).toMatch(/^review_session_/);
  });

  it("lifecycle 到 ready 時 usdc_role 仍為 pending（spec §6.3/AC8 禁假 parsed USDC 誠實守衛）", async () => {
    // spec §6.3/AC8 + app.ts:2656-2657：真實轉檔完成時 conversion_status→ready 會令
    // conversion_lifecycle_status→ready,但 job 端無 usdc_key,usdc_role MUST 維持 pending
    //（禁 lifecycle 假報 parsed USDC）。這是 spec「誠實守衛測試 MUST 斷言此不變量」點名的核心
    // 情境——external-ifc-ready.test.ts 的「無假 ready」測試只等到 dispatched（lifecycle=converting）
    // 結構上到不了 ready,故此紅線於本檔（唯一能真正 poll 到 ready 的 stub）鎖住。Phase 1 usdc_role
    // 為硬編常數,此測試在 Phase 2（usdc_role 改依 usdc_key 動態判斷）落地前先守住 ready 態不報 parsed。
    const stub = await startStreamingStub({
      resultSequence: [
        queuedResultPayload("corr_ap_honest_ready"),
        readyResultPayload("corr_ap_honest_ready"),
      ],
    });
    const app = makeApp(stub.baseUrl);

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_honest_ready", "idem_ap_honest_ready"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const jobId = submit.body.ifc_ready_job_id as string;

    // 等 poller 自動 ingest 到 conversion_status=ready（deriveLifecycleStatus → ready）。
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.conversion_status === "ready";
    });

    // detail 端點：lifecycle=ready,但 usdc_role 仍 pending（禁假 parsed USDC）。
    const detail = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(detail.body.conversion_status).toBe("ready");
    expect(detail.body.conversion_lifecycle_status).toBe("ready");
    expect(detail.body.usdc_role).toBe("pending"); // 核心不變量：ready 態禁報 parsed_usdc
    expect(detail.body.data_volatility).toBe("in_memory_volatile");

    // 列表端點（summarizeIfcReadyJob 出口）同樣鎖此不變量。
    const listed = await request(app.app).get("/api/external/ifc-ready");
    const item = (listed.body.items as Array<Record<string, unknown>>).find(
      (j) => j.ifc_ready_job_id === jobId,
    );
    expect(item).toBeDefined();
    expect(item?.conversion_lifecycle_status).toBe("ready");
    expect(item?.usdc_role).toBe("pending");
  });

  it("dispatch 後 poller 拿到 failed → 自動 ingest 為 failed,不產 viewer_url", async () => {
    const stub = await startStreamingStub({
      resultSequence: [
        queuedResultPayload("corr_ap_failed_001"),
        failedResultPayload("corr_ap_failed_001"),
      ],
    });
    const app = makeApp(stub.baseUrl);

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_failed_001", "idem_ap_failed_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const jobId = submit.body.ifc_ready_job_id as string;

    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.conversion_status === "failed";
    });
    const final = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(final.body.viewer_url).toBeNull();
  });

  it("conversion 權威回報 failed → 兩出口誠實投影 failure_stage='conversion'(quality Important #1;非漏報 null/null)", async () => {
    // Important #1 修復回歸鎖:recordConversionOutcome 設 conversion_status='failed' 時,
    // 舊 deriveFailure 只看 download/dispatch → 對已終局失敗的 job 回 null/null(讀起來像「無失敗」),
    // 且 conversion_lifecycle_status 同時仍算 converting,兩者疊加對一個終局失敗 job 說「還在轉檔、無失敗」。
    // 修復後 deriveFailure 新增 conversion 分支,且 report.reason 存回 job.conversion_failure,兩出口誠實投影。
    const stub = await startStreamingStub({
      resultSequence: [
        queuedResultPayload("corr_ap_conv_fail_001"),
        failedResultPayload("corr_ap_conv_fail_001"),
      ],
    });
    const app = makeApp(stub.baseUrl);

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_conv_fail_001", "idem_ap_conv_fail_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);
    const jobId = submit.body.ifc_ready_job_id as string;

    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.conversion_status === "failed";
    });

    // detail 端點:conversion 失敗 → failure_stage='conversion'、failure_reason 有值(非 null)。
    const detail = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(detail.body.conversion_status).toBe("failed");
    expect(detail.body.failure_stage).toBe("conversion");
    expect(detail.body.failure_reason).toBeTruthy();
    expect(detail.body.recovery_action).toBe("retrigger_required");
    // F5（list/detail 對稱）：conversion_failure 為 internal-only,對外一律經 deriveFailure 投影
    // humanized failure_reason/failure_stage,不直接外吐 raw 欄位。sanitizeJobForExternal（detail/
    // intake/replay）已剝除,列表 whitelist 本就不含 → 兩出口形狀一致,不得洩漏 conversion_failure。
    expect(detail.body).not.toHaveProperty("conversion_failure");
    // 列表端點(summarizeIfcReadyJob 出口)鏡射同一投影(list/detail 對稱)。
    const listed = await request(app.app).get("/api/external/ifc-ready");
    const item = (listed.body.items as Array<Record<string, unknown>>).find(
      (j) => j.ifc_ready_job_id === jobId,
    );
    expect(item).toBeDefined();
    expect(item?.failure_stage).toBe("conversion");
    expect(item?.failure_reason).toBeTruthy();
    expect(item?.recovery_action).toBe("retrigger_required");
    expect(item).not.toHaveProperty("conversion_failure");
  });

  it("重複 idempotent dispatch 不雙起 poller(stub /result 不被雙倍呼叫)", async () => {
    const stub = await startStreamingStub({
      resultSequence: [
        queuedResultPayload("corr_ap_dup_001"),
        readyResultPayload("corr_ap_dup_001"),
      ],
    });
    const app = makeApp(stub.baseUrl);

    const first = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_dup_001", "idem_ap_dup_001"))
      .send(dispatchPayload());
    expect(first.status).toBe(202);
    const second = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_dup_001", "idem_ap_dup_001"))
      .send(dispatchPayload());
    expect([200, 202]).toContain(second.status);
    expect(second.body.idempotent_replay).toBe(true);
    // 第二次 dispatch 走 idempotent replay,但 streaming-server 仍可能被 createConversionJob 打一次(因為 reuse 仍 markDispatched
    // 跑同條 path);關鍵是 poller 不該 double 起。等 ready 後檢查 stub.resultCount 不會超過合理範圍(< 2 倍 maxAttempts)
    const jobId = first.body.ifc_ready_job_id as string;
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.viewer_url != null;
    });
    // 同一 conversion_job_id 只應對 stub /result 發出個位數請求(<= 5,粗略 budget)
    expect(stub.resultCount.value).toBeLessThanOrEqual(5);
  });

  it("manual /api/internal/conversions/<id>/ingest 觸發後 cancel auto poller(no double ingest)", async () => {
    const stub = await startStreamingStub({
      resultSequence: [
        readyResultPayload("corr_ap_manual_001"),
      ],
    });
    const app = makeApp(stub.baseUrl, {
      // 拉長 interval,確保 manual endpoint 比 auto poller 先 ingest
      conversionPollIntervalSeconds: 1,
    });

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_manual_001", "idem_ap_manual_001"))
      .send(dispatchPayload());
    const jobId = submit.body.ifc_ready_job_id as string;

    // coordinator-serial-conversion-dispatch-queue:等 async dispatch worker
    // 完成 + schedule poller,然後才 trigger manual ingest 以驗證 cancel
    // poller(否則 manual 在 poller 還未 schedule 前 fire,cancel 是 no-op,
    // 後續 poller 仍 fire → 雙 ingest)。
    await waitFor(async () => {
      const r = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
      return r.body.status === "dispatched";
    });

    const manual = await request(app.app)
      .post(`/api/internal/conversions/stream_conv_auto_poll_test/ingest`)
      .set("X-Internal-Token", "dev-internal-token")
      .send({});
    expect(manual.status).toBe(202);

    // wait 1.5s,若 auto poller 沒 cancel 會雙 ingest
    await new Promise((r) => setTimeout(r, 1500));

    const final = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(final.body.conversion_status).toBe("ready");
    // stub /result 應該只被打過一次(manual endpoint 1 次,poller 被 cancel)
    expect(stub.resultCount.value).toBe(1);
  });

  it("coordinator recreate → restored dispatched job 自動恢復 poller，不重派工", async () => {
    const stub = await startStreamingStub({
      resultSequence: [readyResultPayload("corr_ap_restart_001")],
      // Authority idempotent replay may already be terminal before coordinator
      // gets its first poll. Durable outbox evidence owns completion.
      dispatchStatus: "succeeded",
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-auto-poll-restart-"));
    const externalStorePath = path.join(root, "coordinator", "external-ifc-ready.json");
    const ledgerStorePath = path.join(root, "coordinator", "conversion-ledger.json");
    const outboxStorePath = path.join(root, "coordinator", "callback-outbox.json");
    const previousExternalStorePath = process.env.EXTERNAL_IFC_READY_STORE_PATH;
    const commonConfig: Partial<CoordinatorConfig> = {
      sessionStoreDir: path.join(root, "coordinator", "sessions"),
      eventLogDir: path.join(root, "coordinator", "events"),
      callbackOutboxStorePath: outboxStorePath,
      conversionLedgerStorePath: ledgerStorePath,
      streamingConversionApiBase: stub.baseUrl,
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: true,
      conversionPollMaxAttempts: 20,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
    };

    process.env.EXTERNAL_IFC_READY_STORE_PATH = externalStorePath;
    try {
      active = createCoordinatorApp({
        ...commonConfig,
        // app A 不應在 dispose 前 poll；只留下 persisted dispatched job。
        conversionPollIntervalSeconds: 10,
      });
      const submit = await request(active.app)
        .post("/api/external/ifc-ready")
        .set(authHeaders("corr_ap_restart_001", "idem_ap_restart_001"))
        .send(dispatchPayload());
      expect(submit.status).toBe(202);
      const jobId = submit.body.ifc_ready_job_id as string;
      await waitFor(async () => {
        const detail = await request(active!.app).get(`/api/external/ifc-ready/${jobId}`);
        return detail.body.status === "dispatched";
      });
      expect(new ExternalIfcReadyStore(externalStorePath).get(jobId)?.conversion_status)
        .toBe("succeeded");
      expect(stub.dispatchCount.value).toBe(1);

      const first = active;
      active = null;
      await first.dispose();
      first.io.close();

      // Simulate a process crash after outbox.persist() but before
      // recordConversionOutcome() links callback_outbox_id onto the durable job.
      const crashWindowJob = new ExternalIfcReadyStore(externalStorePath).get(jobId)!;
      const seededOutbox = new CallbackOutbox(
        5,
        async () => undefined,
        outboxStorePath,
      ).enqueue({
        event: "conversion_result_ready",
        targetUrl: crashWindowJob.callback_url ?? null,
        correlationId: crashWindowJob.correlation_id,
        externalModelVersionId: crashWindowJob.external_model_version_id,
        conversionJobId: crashWindowJob.conversion_job_id,
        payload: {
          event: "conversion_result_ready",
          trace_id: crashWindowJob.ifc_ready_job_id,
          tenant_id: crashWindowJob.tenant_id,
          project_id: crashWindowJob.project_id,
          external_model_version_id: crashWindowJob.external_model_version_id,
          conversion_job_id: crashWindowJob.conversion_job_id,
          correlation_id: crashWindowJob.correlation_id,
          status: "ready",
        },
      });

      active = createCoordinatorApp({
        ...commonConfig,
        conversionPollIntervalSeconds: 0.05,
      });
      await waitFor(async () => {
        const detail = await request(active!.app).get(`/api/external/ifc-ready/${jobId}`);
        return detail.body.conversion_status === "ready";
      }, 3000);

      expect(stub.dispatchCount.value).toBe(1);
      expect(stub.resultCount.value).toBe(1);
      const restoredJob = new ExternalIfcReadyStore(externalStorePath).get(jobId);
      expect(restoredJob?.callback_outbox_id).toBe(seededOutbox.outbox_id);
      expect(new CallbackOutbox(5, async () => undefined, outboxStorePath).list())
        .toHaveLength(1);
      const ledger = new ConversionLedger(ledgerStorePath).get("idem_ap_restart_001");
      expect(ledger?.status).toBe("ready");
      expect(ledger?.conversion_job_id).toBe("stream_conv_auto_poll_test");
      const restoredOutbox = await request(active.app)
        .get(`/api/internal/callback-outbox/${restoredJob!.callback_outbox_id}`)
        .set("X-Internal-Token", "dev-internal-token");
      expect(restoredOutbox.status).toBe(200);
      expect(restoredOutbox.body.status).toBe("pending");

      const second = active;
      active = null;
      await second.dispose();
      second.io.close();
      active = createCoordinatorApp({
        ...commonConfig,
        conversionPollIntervalSeconds: 0.05,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      // terminal store 已有 outbox/ready outcome；第三個 process 不得再啟 poller 或重複 ingest。
      expect(stub.dispatchCount.value).toBe(1);
      expect(stub.resultCount.value).toBe(1);
      expect(new ExternalIfcReadyStore(externalStorePath).get(jobId)?.callback_outbox_id)
        .toBe(restoredJob?.callback_outbox_id);
    } finally {
      if (previousExternalStorePath === undefined) {
        delete process.env.EXTERNAL_IFC_READY_STORE_PATH;
      } else {
        process.env.EXTERNAL_IFC_READY_STORE_PATH = previousExternalStorePath;
      }
    }
  });

  it("callback link 後 observer 前重啟 → durable snapshot 恢復 session/viewer 且只執行一次", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-observer-restart-"));
    const seeded = seedPendingTerminalObserver(root, "callback_linked");
    const previousExternalStorePath = process.env.EXTERNAL_IFC_READY_STORE_PATH;
    const config: Partial<CoordinatorConfig> = {
      sessionStoreDir: seeded.sessionStoreDir,
      eventLogDir: path.join(root, "coordinator", "events"),
      callbackOutboxStorePath: seeded.outboxStorePath,
      conversionLedgerStorePath: path.join(root, "coordinator", "conversion-ledger.json"),
      conversionPollEnabled: false,
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
    };

    process.env.EXTERNAL_IFC_READY_STORE_PATH = seeded.externalStorePath;
    try {
      active = createCoordinatorApp(config);
      const recovered = new ExternalIfcReadyStore(seeded.externalStorePath).get(seeded.jobId);
      expect(recovered?.callback_outbox_id).toBe(seeded.outboxId);
      expect(recovered?.terminal_observer_snapshot).toBeNull();
      expect(recovered?.terminal_observer_completed_at).toBeTruthy();
      expect(recovered?.review_session_id).toMatch(/^review_session_/);
      expect(recovered?.viewer_url).toContain("/ui/open?session=");
      expect(active.store.list()).toHaveLength(1);
      expect(active.store.list()[0]?.quality_metrics_summary).toMatchObject({
        semantic_mapping_fidelity: "guid_exact",
        mapping_has_ifc_type: true,
        mapping_has_ifc_name: true,
      });
      const detail = await request(active.app).get(`/api/external/ifc-ready/${seeded.jobId}`);
      expect(detail.body).not.toHaveProperty("terminal_observer_snapshot");
      expect(detail.body).not.toHaveProperty("terminal_observer_completed_at");

      const first = active;
      active = null;
      await first.dispose();
      first.io.close();
      active = createCoordinatorApp(config);
      expect(active.store.list()).toHaveLength(1);
      expect(new CallbackOutbox(5, async () => undefined, seeded.outboxStorePath).list())
        .toHaveLength(1);
    } finally {
      if (previousExternalStorePath === undefined) {
        delete process.env.EXTERNAL_IFC_READY_STORE_PATH;
      } else {
        process.env.EXTERNAL_IFC_READY_STORE_PATH = previousExternalStorePath;
      }
    }
  });

  it.each([
    ["session create 後、任何 lifecycle event 前", false],
    ["sessionCreated 後、sessionActive 前", true],
  ])("%s 重啟 → 補齊 audit、重用 trace 且不建 duplicate session", async (_label, seedCreatedEvent) => {
    const suffix = seedCreatedEvent ? "session_created" : "no_events";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `bim-coord-session-backlink-${suffix}-`));
    const seeded = seedPendingTerminalObserver(root, suffix);
    const previousExternalStorePath = process.env.EXTERNAL_IFC_READY_STORE_PATH;
    const eventLogDir = path.join(root, "coordinator", "events");
    const persistedAt = new Date().toISOString();
    const persistedSession = new SessionStore(seeded.sessionStoreDir).create({
      trace_id: seeded.jobId,
      tenant_id: "tenant_demo_001",
      project_id: "project_demo_001",
      model_version_id: `ext_mv_observer_restart_${suffix}`,
      created_by: "observer-crash-window-fixture",
      kit_instance: {
        instance_id: "kit_observer_restart_001",
        provider: "local_fixed",
        status: "ready",
        stream_server: "127.0.0.1",
        signaling_port: 49100,
        media_server: "127.0.0.1",
        media_port: 47998,
      },
      kit_instance_bindings: [{
        kit_instance_id: "kit_observer_restart_001",
        provider: "local_fixed",
        tenant_id: "tenant_demo_001",
        assigned_artifact_ids: ["auto_usdc_observer_restart"],
        status: "ready",
        stream_config: {
          signalingServer: "127.0.0.1",
          signalingPort: 49100,
          mediaServer: "127.0.0.1",
          mediaPort: 47998,
        },
        started_at: persistedAt,
        last_heartbeat_at: persistedAt,
        released_at: null,
        gpu_profile: {
          profile: "fixture",
          capacity_slot: "fixture-0",
        },
      }],
      quality_metrics_summary: seeded.snapshot.quality_summary,
    });
    const eventLog = new EventLog(eventLogDir);
    if (seedCreatedEvent) {
      eventLog.append(persistedSession.session_id, "sessionCreated", {
        project_id: persistedSession.project_id,
        model_version_id: persistedSession.model_version_id,
        review_request_id: persistedSession.review_request_id,
      });
    }

    process.env.EXTERNAL_IFC_READY_STORE_PATH = seeded.externalStorePath;
    try {
      active = createCoordinatorApp({
        sessionStoreDir: seeded.sessionStoreDir,
        eventLogDir,
        callbackOutboxStorePath: seeded.outboxStorePath,
        conversionLedgerStorePath: path.join(root, "coordinator", "conversion-ledger.json"),
        conversionPollEnabled: false,
        streamingConversionApiBase: "http://127.0.0.1:1",
        corsOrigins: ["http://127.0.0.1:5173"],
        storageRoot: path.join(root, "storage"),
        storageHostRoot: path.join(root, "storage"),
      });
      const sessions = active.store.list();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.session_id).toBe(persistedSession.session_id);
      const recovered = new ExternalIfcReadyStore(seeded.externalStorePath).get(seeded.jobId);
      expect(recovered?.review_session_id).toBe(persistedSession.session_id);
      expect(recovered?.web_view_session_id).toBe(persistedSession.session_id);
      expect(recovered?.terminal_observer_completed_at).toBeTruthy();
      const lifecycleTypes = eventLog.listLifecycle(persistedSession.session_id).map((event) => event.type);
      expect(lifecycleTypes).toEqual(["sessionCreated", "sessionActive"]);
    } finally {
      if (previousExternalStorePath === undefined) {
        delete process.env.EXTERNAL_IFC_READY_STORE_PATH;
      } else {
        process.env.EXTERNAL_IFC_READY_STORE_PATH = previousExternalStorePath;
      }
    }
  });

  it("conversionPollEnabled:false fixture 不啟 poller", async () => {
    const stub = await startStreamingStub({
      resultSequence: [readyResultPayload("corr_ap_disabled_001")],
    });
    const app = makeApp(stub.baseUrl, { conversionPollEnabled: false });

    const submit = await request(app.app)
      .post("/api/external/ifc-ready")
      .set(authHeaders("corr_ap_disabled_001", "idem_ap_disabled_001"))
      .send(dispatchPayload());
    expect(submit.status).toBe(202);

    // 等 500ms,poller 不啟 → stub /result 不該被呼叫
    await new Promise((r) => setTimeout(r, 500));
    expect(stub.resultCount.value).toBe(0);

    const final = await request(app.app).get(`/api/external/ifc-ready/${submit.body.ifc_ready_job_id}`);
    expect(final.body.conversion_status).toBe("queued");
    expect(final.body.viewer_url).toBeNull();
  });
});
