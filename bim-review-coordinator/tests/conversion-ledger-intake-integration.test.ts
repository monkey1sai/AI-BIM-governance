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
});
