// m2a-coverage-report:本檔含 Task 2 的 isSafeConversionJobId helper 單元測試，
// 以及 Task 3 的 route-level 測試（GET /api/conversions/:id/quality-metrics 的
// 200/400/404/502/null 守門）。route 測試沿用 host-native-conversion-ingest.test.ts
// 的真實 HTTP stub server 注入機制（streamingConversionClient 是 createCoordinatorApp
// 內部 closure，無法 vi.spyOn 攔截，必須經 streamingConversionApiBase 餵真 stub）。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { isSafeConversionJobId } from "../src/app.js";

describe("isSafeConversionJobId", () => {
  it("接受真實 conversion job id", () => {
    expect(isSafeConversionJobId("stream_conv_20260616_abcd1234")).toBe(true);
  });
  it("擋路徑穿越 / 空值 / 斜線", () => {
    expect(isSafeConversionJobId("../etc/passwd")).toBe(false);
    expect(isSafeConversionJobId("a/b")).toBe(false);
    expect(isSafeConversionJobId("")).toBe(false);
  });
  it("不誤用 session pattern（review_session_ 非必要）", () => {
    expect(isSafeConversionJobId("stream_conv_x")).toBe(true);
  });
  it("擋非 string 執行期值（鎖 typeof 守門，防日後被當多餘清掉）", () => {
    // TypeScript 簽名是 string,但 route param 等執行期路徑可能流入 null/undefined;
    // 這兩條鎖住 line 58 的 `typeof value === "string"` 守門,移除它本測試即失敗。
    expect(isSafeConversionJobId(null as unknown as string)).toBe(false);
    expect(isSafeConversionJobId(undefined as unknown as string)).toBe(false);
  });
});

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;
afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (stub) {
    await new Promise<void>((r) => stub?.close(() => r()));
    stub = null;
  }
});

// 動態比對 /api/conversions/<任意 id>/result；status 預設 200,可傳 404 模擬 authority not-found。
function startStub(resultPayload: Record<string, unknown>, status = 200): Promise<string> {
  return new Promise((resolve) => {
    stub = http.createServer((req, res) => {
      if (req.method === "GET" && /^\/api\/conversions\/[^/]+\/result$/.test(req.url ?? "")) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(status === 200 ? JSON.stringify(resultPayload) : "{}");
        return;
      }
      res.writeHead(404).end("{}");
    });
    stub.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(stub!.address() as AddressInfo).port}`));
  });
}

function makeApp(streamingBase: string): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-cqm-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: streamingBase,
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  return active;
}

// fetchConversionResult 回傳形狀含 usdc_ref / element_mapping_ref（streamingConversionClient.ts:339-340）
// + raw（含 quality_metrics）。stub 回的 result payload 比照 host-native-conversion-ingest.test.ts
// 的 READY_RESULT（artifacts.model_usdc.url / artifacts.element_mapping.url / quality_metrics），
// 讓 fetchConversionResult 正確映射;buildQualityMetricsSummary 從 raw.quality_metrics 取
// coverage_ratio / mapped_count / unmapped_count。
describe("GET /api/conversions/:id/quality-metrics route", () => {
  const READY = {
    conversion_job_id: "stream_conv_route_001",
    authority: "bim-streaming-server",
    status: "succeeded",
    ready: true,
    model: { status: "ready", format: "usdc", url: "http://x/model.usdc" },
    artifacts: {
      model_usdc: { url: "http://x/model.usdc" },
      element_mapping: { url: "http://x/element_mapping.json" },
    },
    quality_metrics: {
      source_ifc_entity_count: 1000,
      mapped_count: 988,
      unmapped_count: 12,
      coverage_ratio: 0.988,
      coverage_status: "warn",
      materialization_strategy: "sidecar",
    },
  };

  it("1) 成功 → 200 + summary（含 mapped/unmapped）+ usdc_url/mapping_url", async () => {
    const base = await startStub(READY);
    const app = makeApp(base);
    const res = await request(app.app).get("/api/conversions/stream_conv_route_001/quality-metrics");
    expect(res.status).toBe(200);
    expect(res.body.quality_metrics_summary.coverage_ratio).toBe(0.988);
    expect(res.body.quality_metrics_summary.mapped_count).toBe(988);
    expect(res.body.quality_metrics_summary.unmapped_count).toBe(12);
    expect(res.body.usdc_url).toContain("model.usdc");
    expect(res.body.mapping_url).toContain("element_mapping.json");
  });

  it("2) result 無 quality_metrics → 200 + summary === null（誠實非錯誤）", async () => {
    const { quality_metrics: _omit, ...withoutQm } = READY;
    const base = await startStub(withoutQm);
    const app = makeApp(base);
    const res = await request(app.app).get("/api/conversions/stream_conv_route_001/quality-metrics");
    expect(res.status).toBe(200);
    expect(res.body.quality_metrics_summary).toBeNull();
  });

  it("3) 非法 id（單段含非法字元）→ 400，body 無 coverage 數字", async () => {
    const base = await startStub(READY);
    const app = makeApp(base);
    // 單段但含非法字元（空白）→ 命中 route param 但 isSafeConversionJobId 擋下回 400。
    const res = await request(app.app).get("/api/conversions/bad%20id/quality-metrics");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/coverage_ratio/);
  });

  it("4) authority 404 → 404，body 無 coverage 數字", async () => {
    const base = await startStub({}, 404); // stub 對 result 回 404 → fetchConversionResult throw "API 404"
    const app = makeApp(base);
    const res = await request(app.app).get("/api/conversions/stream_conv_route_001/quality-metrics");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/coverage_ratio/);
  });

  it("5) authority 連不上 → 502，body 無 coverage 數字", async () => {
    const app = makeApp("http://127.0.0.1:1"); // 沒人聽的 port → fetch throw 連線錯誤
    const res = await request(app.app).get("/api/conversions/stream_conv_route_001/quality-metrics");
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/coverage_ratio/);
  });

  it("6) 同值鎖 → route 出的 coverage_ratio 等於 stub 餵入的 quality_metrics 值", async () => {
    const base = await startStub(READY);
    const app = makeApp(base);
    const res = await request(app.app).get("/api/conversions/stream_conv_route_001/quality-metrics");
    // 與 stream-config 同一真相源：route 不得改值。
    expect(res.body.quality_metrics_summary.coverage_ratio).toBe(READY.quality_metrics.coverage_ratio);
  });
});
