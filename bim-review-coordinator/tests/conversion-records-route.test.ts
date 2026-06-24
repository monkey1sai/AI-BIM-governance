// bim-review-coordinator/tests/conversion-records-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
function makeApp(ledgerRecords?: unknown[]) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-records-"));
  const ledgerPath = path.join(root, "conversion-ledger.json");
  if (ledgerRecords) {
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({ schema_version: "conversion-ledger/v1", records: ledgerRecords }, null, 2),
      "utf-8",
    );
  }
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: ledgerPath,
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});

describe("GET /api/conversion/records", () => {
  it("空 ledger 回 count=0 items=[]", async () => {
    const res = await request(makeApp().app).get("/api/conversion/records");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, items: [] });
  });

  it("limit 截斷 + detected_at desc 排序：?limit=1 回最新那筆，count=2", async () => {
    const older = {
      idempotency_key: "mw_aaaa0000bbbb0001",
      correlation_id: "minio-watch-aa000001",
      project_id: "proj_older",
      project_display_name: "舊模型",
      category: "建築",
      external_model_version_id: "v1",
      object_key: null,
      bucket: null,
      conversion_job_id: null,
      status: "queued",
      coverage_report: null,
      usdc_key: null,
      detected_at: "2026-06-23T01:00:00.000Z",
      updated_at: "2026-06-23T01:00:00.000Z",
    };
    const newer = {
      idempotency_key: "mw_aaaa0000bbbb0002",
      correlation_id: "minio-watch-aa000002",
      project_id: "proj_newer",
      project_display_name: "新模型",
      category: "結構",
      external_model_version_id: "v2",
      object_key: null,
      bucket: null,
      conversion_job_id: null,
      status: "queued",
      coverage_report: null,
      usdc_key: null,
      detected_at: "2026-06-23T02:00:00.000Z",
      updated_at: "2026-06-23T02:00:00.000Z",
    };
    const res = await request(makeApp([older, newer]).app).get("/api/conversion/records?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].idempotency_key).toBe(newer.idempotency_key);
  });
});
