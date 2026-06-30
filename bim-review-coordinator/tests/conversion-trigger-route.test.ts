// bim-review-coordinator/tests/conversion-trigger-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "node:http";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null; let root: string | null = null;
let s3Stub: http.Server | null = null; let s3Url = "";
let intakeReceived: Array<{ headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
// S3 stub：HeadObject（route 取單一 key etag）→ 命中回 ETag header、缺則 404；
// ListObjectsV2（watcher / 其他 list 路徑）→ 回 XML。presign GET 不真打（presigner 只簽 URL）。
function startS3Stub(keys: string[]): Promise<void> {
  s3Stub = http.createServer((req, res) => {
    if (req.method === "HEAD") {
      // forcePathStyle：HEAD /{bucket}/{key}；key 內 '/' 為路徑分隔保留，中文段 URL 編碼。
      const reqPath = decodeURIComponent((req.url ?? "").split("?")[0]);
      const objKey = reqPath.replace(/^\/[^/]+\//, ""); // 去掉 /{bucket}/ 前綴
      if (keys.includes(objKey)) {
        res.writeHead(200, { etag: '"e1"' });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
  });
  return new Promise((r) => s3Stub!.listen(0, "127.0.0.1", () => {
    s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`; r();
  }));
}
function makeApp() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-trigger-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    devAuthToken: "test-dev-token",
    minioWatchEndpoint: s3Url, minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak", minioWatchSecretKey: "sk",
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
  if (s3Stub) await new Promise<void>((r) => s3Stub!.close(() => { s3Stub = null; r(); }));
  intakeReceived = [];
});

describe("POST /api/conversion/trigger", () => {
  it("無 x-dev-token → 401/403（拒匿名寫入）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    expect([401, 403]).toContain(res.status);
  });

  it("key 含 .. → 400（防路徑穿越，deriveIntakeFromKey 拒）", async () => {
    await startS3Stub(["a/b/c/model.ifc"]);
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "../../etc/model.ifc" });
    expect(res.status).toBe(400);
  });

  it("合法 key + 有 token → 回 { status, idempotency_key }（由非空 etag 衍生），不外洩 presigned URL", async () => {
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    // 後端對該 key list 取 etag（stub 回 "e1"）→ idempotency_key 應 === idempotencyKeyFor(bucket,key,'"e1"')。
    // 驗 idempotency_key 不是 mw_hash('')（空 etag 的退化值），確保 etag 真的被帶入。
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const expected = idempotencyKeyFor("bim-control", key, '"e1"');
    const emptyEtagKey = idempotencyKeyFor("bim-control", key, "");
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(res.body.idempotency_key).toBe(expected);          // etag 確實參與 hash
    expect(res.body.idempotency_key).not.toBe(emptyEtagKey);  // 非空 etag 退化值
    expect(res.body.status).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });

  it("觸發後 ledger 有對應紀錄（GET /api/conversion/records 可見同 idempotency_key）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const app = makeApp().app;
    const trig = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    const recs = await request(app).get("/api/conversion/records");
    expect(recs.body.items.some((r: { idempotency_key: string }) => r.idempotency_key === trig.body.idempotency_key)).toBe(true);
  });

  it("合法 key 但 bucket 內找不到該物件 → 404（不退化成空 etag 偷偷落帳）", async () => {
    // stub 只回別的 key；請求的 key 規約合法（過 deriveIntakeFromKey）但 bucket 內無此物件。
    // plan §3.3 route 模板要求 !match || !match.etag → 404，而非退化 etag='' 後寫 ledger。
    const presentKey = "甲案/root/main/000001/model.ifc";
    const missingKey = "東勢區許良宇紀念圖書館/root/main/999999/model.ifc";
    await startS3Stub([presentKey]);
    const app = makeApp().app;
    const res = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key: missingKey });
    expect(res.status).toBe(404);
    // 誠實鐵律：404 不可留半截 ledger record（空 etag 退化值不得入帳）。
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const recs = await request(app).get("/api/conversion/records");
    const degraded = idempotencyKeyFor("bim-control", missingKey, "");
    expect(recs.body.items.some((r: { idempotency_key: string }) => r.idempotency_key === degraded)).toBe(false);
  });

  it("S3 list / 上游失敗 → 502（非 client error 400、非 unhandled 500）", async () => {
    // 合法 key（過 deriveIntakeFromKey）+ 有 token，但 S3 list 回 HTTP 500 → route 須以 try/catch
    // 收斂成 502（上游/連線錯誤）。plan §3.3 route 模板用 502 表達上游失敗；現況缺 catch 會讓
    // async reject 變成 Express 預設 500（或 400 混淆）。此測試鎖 502，與 400(client) 清楚區分。
    s3Stub = http.createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0"?><Error><Code>InternalError</Code></Error>`);
    });
    await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => {
      s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`; r();
    }));
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    const res = await request(makeApp().app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(502);
    // finding #1 sibling：502 回應只給 sanitized 固定 detail，不洩漏上游 SDK 錯誤原文。
    expect(res.body.detail).toBe("minio list failed");
    expect(JSON.stringify(res.body)).not.toMatch(/InternalError|<Error>|stack/i);
  });
});
