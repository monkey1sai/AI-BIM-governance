// bim-review-coordinator/tests/manual-intake.test.ts
//
// triggerManualIntake = 「一鍵觸發轉檔」鈕背後的 server-side 行為（spec §3.3）。
// findings c1/c2/c3 修復後語意：不再自寫 detected 紀錄，而是走「手動 webhook intake 等效路徑」
// —— 構 ifc_ready body、帶 X-Webhook-Secret / X-Correlation-Id（correlationIdFor）/
// X-Idempotency-Key（idempotencyKeyFor），loopback POST {selfBaseUrl}/api/external/ifc-ready，
// 由既有下載/sanitize/dispatch/callback 鏈處理；ledger 由 intake 端落 queued（非此函式寫 detected）。
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { triggerManualIntake } from "../src/services/manualIntake.js";
import { idempotencyKeyFor, correlationIdFor } from "../src/services/minioWatcher.js";

// S3 stub：presign GET 不真打（presigner 只簽 URL，不送請求），故 stub 只需在 list/head 時回應；
// 但本檔 triggerManualIntake 只 presign（不 list/head），因此 S3 endpoint 給合法 URL 即可。
let s3Stub: http.Server | null = null;
let s3Url = "";
// intake stub：模擬 coordinator 的 /api/external/ifc-ready，記錄收到的 header / body / 路徑，
// 回 202（成功）或 502（下載失敗）讓 triggerManualIntake 誠實反映 dispatch 結果。
let intakeStub: http.Server | null = null;
let intakeUrl = "";
let intakeReceived: Array<{
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}> = [];

function startS3Stub(): Promise<void> {
  s3Stub = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`);
  });
  return new Promise((r) => s3Stub!.listen(0, "127.0.0.1", () => {
    s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`; r();
  }));
}

// 起一個假 intake 端點。respond=202 表示成功（intake 鏈回 queued），502 表示下載失敗。
function startIntakeStub(respond: { status: number; body: Record<string, unknown> }): Promise<void> {
  intakeStub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      intakeReceived.push({
        path: (req.url ?? "").split("?")[0],
        headers: req.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      res.writeHead(respond.status, { "content-type": "application/json" });
      res.end(JSON.stringify(respond.body));
    });
  });
  return new Promise((r) => intakeStub!.listen(0, "127.0.0.1", () => {
    intakeUrl = `http://127.0.0.1:${(intakeStub!.address() as { port: number }).port}`; r();
  }));
}

afterEach(async () => {
  if (s3Stub) await new Promise<void>((r) => s3Stub!.close(() => { s3Stub = null; r(); }));
  if (intakeStub) await new Promise<void>((r) => intakeStub!.close(() => { intakeStub = null; r(); }));
  intakeReceived = [];
});

const cfg = () => ({
  endpoint: s3Url,
  bucket: "bim-control",
  accessKey: "ak",
  secretKey: "sk",
  keySuffix: "/model.ifc",
  selfBaseUrl: intakeUrl,
  webhookSecret: "test-webhook-secret",
  tenantId: "tenant_demo_001",
});

describe("triggerManualIntake（走 webhook intake 等效路徑，findings c1/c2/c3）", () => {
  const KEY = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";

  it("合法 key → POST 到 /api/external/ifc-ready，帶 webhook secret + 確定性 idempotency/correlation header + ifc_ready body", async () => {
    await startS3Stub();
    await startIntakeStub({ status: 202, body: { ifc_ready_job_id: "ifcready_x", status: "queued_for_conversion" } });
    const r = await triggerManualIntake(KEY, '"e1"', cfg(), "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(true);

    // 真的打到 intake 端點（非自寫 ledger 的 dead-end）。
    expect(intakeReceived).toHaveLength(1);
    const got = intakeReceived[0];
    expect(got.path).toBe("/api/external/ifc-ready");
    // header 須與 watcher.triggerIntake 對齊：確定性 idempotency/correlation + webhook secret。
    expect(got.headers["x-webhook-secret"]).toBe("test-webhook-secret");
    expect(got.headers["x-idempotency-key"]).toBe(idempotencyKeyFor("bim-control", KEY, '"e1"'));
    expect(got.headers["x-correlation-id"]).toBe(correlationIdFor("bim-control", KEY, '"e1"'));
    // body 是 ifc_ready webhook 形狀，欄位由 deriveIntakeFromKey 導出。
    expect(got.body.event).toBe("ifc_ready");
    expect(got.body.tenant_id).toBe("tenant_demo_001");
    expect(got.body.model_category).toBe("main");           // 倒數第二段
    expect(got.body.external_model_version_id).toBe("000001"); // 末段
    expect(got.body.project_display_name).toBe("東勢區許良宇紀念圖書館"); // 首段原值
    const src = got.body.source_ifc as Record<string, unknown>;
    expect(src.format).toBe("ifc");
    expect(typeof src.ref).toBe("string");                  // presigned GET URL
    expect(String(src.ref)).toContain("X-Amz-Signature");   // 真 presigned
  });

  it("回傳的 idempotency_key === idempotencyKeyFor（呼叫端可直接 patch chip），不外洩 presigned URL", async () => {
    await startS3Stub();
    await startIntakeStub({ status: 202, body: { ifc_ready_job_id: "ifcready_x", status: "queued_for_conversion" } });
    const r = await triggerManualIntake(KEY, '"e1"', cfg(), "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.idempotency_key).toBe(idempotencyKeyFor("bim-control", KEY, '"e1"'));
      // 誠實鐵律：結果不得回傳 presigned 簽章。
      expect(JSON.stringify(r)).not.toContain("X-Amz-Signature");
    }
  });

  it("key 含 .. → ok:false（deriveIntakeFromKey 拒），且不 POST intake", async () => {
    await startS3Stub();
    await startIntakeStub({ status: 202, body: {} });
    const r = await triggerManualIntake("../../etc/model.ifc", '"e1"', cfg(), "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(false);
    expect(intakeReceived).toHaveLength(0); // 不合法 key 不去打 intake
  });

  it("intake 回 502 下載失敗 → ok:false（誠實反映 dispatch 結果，不謊報成功）", async () => {
    await startS3Stub();
    await startIntakeStub({ status: 502, body: { detail: "IFC download failed", download_status: "failed" } });
    const r = await triggerManualIntake(KEY, '"e1"', cfg(), "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(false);
    expect(intakeReceived).toHaveLength(1); // 有真打 intake，但回失敗
  });

  it("presign 失敗（endpoint 非法 URL）→ ok:false（reason 含 presign failed），不 POST intake", async () => {
    await startIntakeStub({ status: 202, body: {} });
    const badCfg = { ...cfg(), endpoint: "not a url" };
    const r = await triggerManualIntake(KEY, '"e1"', badCfg, "2026-06-24T00:00:00Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("presign failed");
    expect(intakeReceived).toHaveLength(0); // presign 階段就失敗，不應送出 intake
  });
});
