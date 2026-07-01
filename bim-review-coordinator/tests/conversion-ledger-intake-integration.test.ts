// bim-review-coordinator/tests/conversion-ledger-intake-integration.test.ts
// Task 2 整合測試：POST /api/external/ifc-ready 成功後 GET /api/conversion/records 出現 queued 紀錄。
// 配對 Task 3 route（已實作）一起驗。
// 改動：使用 externalIntakeWebhookSecret / externalIntakeIpAllowlist（實際 config 欄位名）取代
//   plan 文件的 externalIfcReadyWebhookSecret / externalIfcReadyIpAllowlist（舊名）。
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;

function makeApp(): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-intake-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    // webhook secret + IP allowlist（使用實際 config 欄位名）
    externalIntakeWebhookSecret: "test-secret",
    externalIntakeIpAllowlist: [],
  });
  return active;
}

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
    root = null;
  }
});

// fallbackOnFetchError=true（ifcDownloadStrict 預設 false）→ 連線失敗視為 placeholder，
// intake 仍回 202，不需要真實 IFC source server。
const body = {
  event: "ifc_ready",
  tenant_id: "tenant_demo_001",
  project_id: "mv_1a2b3c4d",
  project_display_name: "松風庵",
  model_category: "機電",
  external_model_version_id: "000001",
  source_ifc: {
    ref: "http://127.0.0.1:9/bim-control/x/model.ifc",
    etag: "abc",
    filename: "model.ifc",
    format: "ifc",
  },
  requested_outputs: ["usdc"],
};

describe("intake → ledger", () => {
  it("intake 成功後 GET /api/conversion/records 出現 queued 紀錄", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set("X-Webhook-Secret", "test-secret")
      .set("X-Idempotency-Key", "mw_abc123def4567890")
      .set("X-Correlation-Id", "minio-watch-abc123de")
      .send(body);

    expect(res.status).toBeLessThan(400);

    const recs = await request(app.app).get("/api/conversion/records");
    expect(recs.status).toBe(200);

    const item = (recs.body.items as Array<{ idempotency_key: string; status: string; category: string; project_display_name: string }>)
      .find((r) => r.idempotency_key === "mw_abc123def4567890");

    expect(item).toBeTruthy();
    expect(item!.status).toBe("queued");
    expect(item!.category).toBe("機電");
    expect(item!.project_display_name).toBe("松風庵");
  });

  // 非 MinIO 來源（worker compat payload，無 project_display_name / model_category）
  // 進 conversionLedger 的 fallback 守衛。ConversionLedgerRecord 的 project_display_name /
  // category 型別是 string（非 nullable，conversionLedger.ts:18-19），無法存 null，
  // 故 fallback 有其必要；但 fallback 值必須鎖定為「project_id 字串 / 空字串」這個現狀，
  // 防止日後有人把 app.ts:1161-1162 的 `?? event.project_id` / `?? ""` 改成
  // `?? "unknown"` 之類破壞 GET /api/conversion/records 消費者契約而無法感知。
  // （對照 externalIfcReadyStore 走誠實 null，見 external-ifc-ready.test.ts 同名守衛。）
  it("非 MinIO 來源（worker compat）進 ledger：project_display_name fallback 成 project_id、category 成空字串", async () => {
    const app = makeApp();
    // worker compat：無 X-Idempotency-Key → idempotency_key 由 worker:project::version::task 派生。
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set("X-Webhook-Secret", "test-secret")
      .send({
        status: "ifc_ready",
        ifc_path: "http://127.0.0.1:9/storage/worker-model.ifc",
        project_id: "project_worker_ledger_oq1",
        version: "ver_worker_oq1",
        task_id: "task_worker_oq1",
      });

    expect(res.status).toBeLessThan(400);

    const recs = await request(app.app).get("/api/conversion/records");
    expect(recs.status).toBe(200);

    const item = (recs.body.items as Array<{ project_id: string; status: string; category: string; project_display_name: string }>)
      .find((r) => r.project_id === "project_worker_ledger_oq1");

    expect(item).toBeTruthy();
    expect(item!.status).toBe("queued");
    // fallback 現狀：project_display_name === project_id（非真實中文名，非空字串、非 "unknown"）。
    expect(item!.project_display_name).toBe("project_worker_ledger_oq1");
    // fallback 現狀：category === ""（空字串，非 null、非 "unknown"）。
    expect(item!.category).toBe("");
  });
});
