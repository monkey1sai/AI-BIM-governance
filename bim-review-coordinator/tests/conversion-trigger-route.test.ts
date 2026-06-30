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
// makeApp：建 app 並真正 listen（loopback port）——/api/conversion/trigger 內部會自打
// 本進程的 /api/external/ifc-ready（webhook intake 等效路徑，findings c1/c2/c3），故需可達 socket。
// selfBaseUrl 由 route 從 server.address() 即時算出，listen 後即為真實 port。
function makeApp(ledgerSeed?: unknown[]): Promise<CoordinatorApp> {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-trigger-"));
  const ledgerPath = path.join(root, "conversion-ledger.json");
  // c2：預先植入 ledger 紀錄（如 status=failed）以驗「對 failed 列觸發 → 真 re-dispatch 推進」。
  if (ledgerSeed) {
    fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: "conversion-ledger/v1", records: ledgerSeed }), "utf-8");
  }
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: ledgerPath,
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false,
    devAuthToken: "test-dev-token",
    minioWatchEndpoint: s3Url, minioWatchBucket: "bim-control",
    minioWatchAccessKey: "ak", minioWatchSecretKey: "sk",
  });
  return new Promise((resolve) => active!.server.listen(0, "127.0.0.1", () => resolve(active!)));
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
    const res = await request((await makeApp()).app).post("/api/conversion/trigger")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    expect([401, 403]).toContain(res.status);
  });

  it("key 含 .. → 400（防路徑穿越，deriveIntakeFromKey 拒）", async () => {
    await startS3Stub(["a/b/c/model.ifc"]);
    const res = await request((await makeApp()).app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "../../etc/model.ifc" });
    expect(res.status).toBe(400);
  });

  it("400 invalid_key 的 detail 不回顯用戶輸入 key（finding #1：避免 user-controlled echo / 資訊洩漏）", async () => {
    // derived.reason 內含原始 key（deriveIntakeFromKey 失敗訊息把 key 帶進字串）。
    // 此 key 屬 request.body 用戶控制輸入，不得直接 echo 進 response（與 502 catch 的 sanitized
    // 固定 detail 對稱）。改回固定規約說明，完整 reason 只進 structLog。
    const traversalKey = "../../etc/passwd/model.ifc";
    const res = await request((await makeApp()).app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: traversalKey });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_key");
    // 整個 response body（含 detail）不得含原始 key 任一可辨識片段。
    expect(JSON.stringify(res.body)).not.toContain("passwd");
    expect(JSON.stringify(res.body)).not.toContain("../");
    expect(res.body.detail).toBeTruthy(); // 仍給固定的規約提示，不是空字串
  });

  it("合法 key + 有 token → 回 { status, idempotency_key }（由非空 etag 衍生），不外洩 presigned URL", async () => {
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    // 後端對該 key list 取 etag（stub 回 "e1"）→ idempotency_key 應 === idempotencyKeyFor(bucket,key,'"e1"')。
    // 驗 idempotency_key 不是 mw_hash('')（空 etag 的退化值），確保 etag 真的被帶入。
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const expected = idempotencyKeyFor("bim-control", key, '"e1"');
    const emptyEtagKey = idempotencyKeyFor("bim-control", key, "");
    const res = await request((await makeApp()).app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(res.body.idempotency_key).toBe(expected);          // etag 確實參與 hash
    expect(res.body.idempotency_key).not.toBe(emptyEtagKey);  // 非空 etag 退化值
    expect(res.body.status).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });

  it("同 key 二次觸發 → 皆回 200 同 idempotency_key 且 ledger 僅一筆（finding #3：idempotent re-trigger，spec §3.3 AC7）", async () => {
    // 二次觸發都走 webhook intake 等效路徑（POST /api/external/ifc-ready）；同 key 同 etag → 同
    // idempotency_key → intake 端對既有 job 回 idempotent_replay，不重複建 job、ledger 不增筆。
    // 此測試鎖住「二次觸發後 records 僅一筆」防去重退化（重複 dispatch / 多筆 ledger）。
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    const app = (await makeApp()).app;
    const first = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    const second = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotency_key).toBe(first.body.idempotency_key); // 同鍵（冪等核心）
    // status 為 intake 端回的「既有 job 當前狀態」：二次觸發是 idempotent_replay，不重建 job，但
    // job 自身可能已被 dispatch worker 推進（測試環境無 streaming-server → dispatch_failed）。故只驗
    // 誠實回了當前狀態字串，不鎖死值相等（那是舊「靜態 detected」模型的假設，與真 async 進度矛盾）。
    expect(typeof second.body.status).toBe("string");
    expect(second.body.status).toBeTruthy();
    const recs = await request(app).get("/api/conversion/records");
    const matching = recs.body.items.filter(
      (r: { idempotency_key: string }) => r.idempotency_key === first.body.idempotency_key,
    );
    expect(matching).toHaveLength(1); // 二次觸發不增筆（同鍵 intake replay 命中既有 job）
  });

  it("觸發後 ledger 有對應紀錄（GET /api/conversion/records 可見同 idempotency_key）", async () => {
    await startS3Stub(["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"]);
    const app = (await makeApp()).app;
    const trig = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token")
      .send({ key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc" });
    const recs = await request(app).get("/api/conversion/records");
    expect(recs.body.items.some((r: { idempotency_key: string }) => r.idempotency_key === trig.body.idempotency_key)).toBe(true);
  });

  // ── findings c1/c2/c3：手動觸發走 webhook intake 等效路徑，真 dispatch（非 detected dead-end） ──

  it("[c1] 合法 key 觸發後 ledger 推進到 queued（真走 ifc-ready dispatch 鏈，非自寫 detected dead-end）", async () => {
    // 舊行為：triggerManualIntake 只 conversionLedger.upsert({status:'detected'})，無 consumer 推進 →
    // 永久 dead-end。修復後：POST /api/external/ifc-ready → 下載/enqueue/dispatch → intake 端落 queued。
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    const app = (await makeApp()).app;
    const res = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    const recs = await request(app).get("/api/conversion/records");
    const rec = recs.body.items.find((r: { idempotency_key: string }) => r.idempotency_key === res.body.idempotency_key);
    expect(rec).toBeTruthy();
    // 真 dispatch 的證明：ledger 落到 queued（intake 端寫），不是停在 detected。
    expect(rec.status).toBe("queued");
    expect(rec.status).not.toBe("detected");
    // 也應產生一筆真實 ifc-ready job（dispatch 鏈確實跑過）。
    const jobs = await request(app).get("/api/external/ifc-ready");
    expect(jobs.body.count).toBeGreaterThanOrEqual(1);
  });

  it("[c2] 對 status=failed 的 ledger 列觸發 → 真 re-dispatch 推進至 queued（非僅覆寫文字、非假進度）", async () => {
    // 預植一筆 failed 紀錄（idempotency_key = 該 key+etag 的確定性值）。舊行為會無條件覆寫成
    // detected 但無 re-dispatch（假進度）。修復後觸發真走 ifc-ready → 同 idempotency_key 推進到 queued。
    const key = "東勢區許良宇紀念圖書館/root/main/000001/model.ifc";
    await startS3Stub([key]);
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const idkey = idempotencyKeyFor("bim-control", key, '"e1"');
    const app = (await makeApp([{
      idempotency_key: idkey, correlation_id: null,
      project_id: "東勢區許良宇紀念圖書館", project_display_name: "東勢區許良宇紀念圖書館",
      category: "main", external_model_version_id: "000001",
      object_key: key, bucket: "bim-control", conversion_job_id: null,
      status: "failed", coverage_report: null, usdc_key: null,
      detected_at: "2026-06-23T00:00:00Z", updated_at: "2026-06-23T00:00:00Z",
    }])).app;
    // 觸發前確認確實是 failed（baseline）。
    const before = await request(app).get("/api/conversion/records");
    expect(before.body.items.find((r: { idempotency_key: string }) => r.idempotency_key === idkey).status).toBe("failed");
    const res = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toBe(idkey); // 同一筆（非新增）
    const after = await request(app).get("/api/conversion/records");
    const rec = after.body.items.find((r: { idempotency_key: string }) => r.idempotency_key === idkey);
    // 真 re-dispatch 的證明：failed → queued（由 intake 鏈推進），且仍只一筆。
    expect(rec.status).toBe("queued");
    expect(after.body.items.filter((r: { idempotency_key: string }) => r.idempotency_key === idkey)).toHaveLength(1);
  });

  it("[c3] 手動觸發 untracked 物件 → 該物件真的被 dispatch（watcher idempotency_key 落 queued，非寫 detected 後卡死）", async () => {
    // 防 watermark poisoning：手動觸發前 ledger 無此物件紀錄。觸發後該物件以「watcher 會算出的同一
    // idempotency_key」真正進入 dispatch（ledger queued + 真 ifc-ready job），故 watcher 之後命中 ledger
    // 的 skip 是合法的（已有真 job），而非舊行為「寫 detected 抑制 watcher、卻無人推進」的卡死。
    const key = "東勢區許良宇紀念圖書館/root/main/000002/model.ifc";
    await startS3Stub([key]);
    const { idempotencyKeyFor } = await import("../src/services/minioWatcher.js");
    const idkey = idempotencyKeyFor("bim-control", key, '"e1"');
    const app = (await makeApp()).app;
    // untracked 前置：ledger 無此 idempotency_key。
    const before = await request(app).get("/api/conversion/records");
    expect(before.body.items.some((r: { idempotency_key: string }) => r.idempotency_key === idkey)).toBe(false);
    const res = await request(app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(200);
    expect(res.body.idempotency_key).toBe(idkey); // 與 watcher 同源 key
    const after = await request(app).get("/api/conversion/records");
    const rec = after.body.items.find((r: { idempotency_key: string }) => r.idempotency_key === idkey);
    expect(rec).toBeTruthy();
    expect(rec.status).toBe("queued"); // 真 dispatch，非 detected 卡死
    const jobs = await request(app).get("/api/external/ifc-ready");
    expect(jobs.body.count).toBeGreaterThanOrEqual(1); // 真有 job 被建立
  });

  it("合法 key 但 bucket 內找不到該物件 → 404（不退化成空 etag 偷偷落帳）", async () => {
    // stub 只回別的 key；請求的 key 規約合法（過 deriveIntakeFromKey）但 bucket 內無此物件。
    // plan §3.3 route 模板要求 !match || !match.etag → 404，而非退化 etag='' 後寫 ledger。
    const presentKey = "甲案/root/main/000001/model.ifc";
    const missingKey = "東勢區許良宇紀念圖書館/root/main/999999/model.ifc";
    await startS3Stub([presentKey]);
    const app = (await makeApp()).app;
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
    const res = await request((await makeApp()).app).post("/api/conversion/trigger")
      .set("x-dev-token", "test-dev-token").send({ key });
    expect(res.status).toBe(502);
    // finding #1 sibling：502 回應只給 sanitized 固定 detail，不洩漏上游 SDK 錯誤原文。
    expect(res.body.detail).toBe("minio list failed");
    expect(JSON.stringify(res.body)).not.toMatch(/InternalError|<Error>|stack/i);
  });
});
