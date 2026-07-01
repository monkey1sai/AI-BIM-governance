// bim-review-coordinator/tests/minio-objects-delimiter-route.test.ts
// TDD for /api/minio/objects?delimiter=/ → listMinioFolder（回 folders[]）。
// 不帶 delimiter → 舊 listMinioObjects 路徑（byte-identical，既有測試零改）。
import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;
let s3Stub: http.Server | null = null;
let s3Url = "";
let s3CallCount = 0;

// S3 stub 依呼叫順序回 pages（同 minio-folder-route.test.ts 模式）。
function startS3Stub(
  pages: Array<{ prefixes: string[]; keys: string[]; next?: string; status?: number }>,
): Promise<void> {
  let call = 0;
  s3CallCount = 0;
  s3Stub = http.createServer((_req, res) => {
    s3CallCount += 1;
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    if (page.status && page.status >= 400) {
      res.writeHead(page.status, { "content-type": "application/xml" });
      res.end(
        `<?xml version="1.0"?><Error><Code>InternalError</Code><Message>stub ${page.status}</Message></Error>`,
      );
      return;
    }
    const cps = page.prefixes
      .map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`)
      .join("");
    const contents = page.keys
      .map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`)
      .join("");
    const trunc = page.next
      ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${page.next}</NextContinuationToken>`
      : "<IsTruncated>false</IsTruncated>";
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${trunc}${cps}${contents}</ListBucketResult>`);
  });
  return new Promise((r) =>
    s3Stub!.listen(0, "127.0.0.1", () => {
      s3Url = `http://127.0.0.1:${(s3Stub!.address() as { port: number }).port}`;
      r();
    }),
  );
}

function makeApp(): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-delim-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    minioWatchEndpoint: s3Url,
    minioWatchBucket: "bim-control",
    minioWatchAccessKey: "minioadmin",
    minioWatchSecretKey: "minioadmin",
    minioWatchEnabled: false, // watcher 不啟動，只用 route
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
  if (s3Stub) {
    await new Promise<void>((r) => s3Stub!.close(() => { s3Stub = null; r(); }));
  }
});

describe("GET /api/minio/objects?delimiter=/", () => {
  it("帶 delimiter=/ 時回 folders[]（CommonPrefixes，含 has_source_ifc）+ objects（當層直屬檔）+ count（spec §2.1, AC-D2）", async () => {
    await startS3Stub([
      { prefixes: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], keys: ["annotations/a.json"] },
      // probe has_source_ifc：洲際好宅/ 子層含 model.ifc → true；東勢區…/ 無 .ifc → false。
      // route 整合層須斷言 has_source_ifc 真實值（plan §Task2 line 346），不只 map prefix 字串。
      { prefixes: [], keys: ["洲際好宅/root/main/000001/model.ifc"] },
      { prefixes: [], keys: ["東勢區許良宇紀念圖書館/annotations/a.json"] },
    ]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("folders");
    expect(Array.isArray(res.body.folders)).toBe(true);
    expect(res.body.folders.map((f: { prefix: string }) => f.prefix)).toEqual([
      "洲際好宅/",
      "東勢區許良宇紀念圖書館/",
    ]);
    // has_source_ifc 真實值（probe 結果），不可只看 prefix 字串。
    const byPrefix = Object.fromEntries(
      res.body.folders.map((f: { prefix: string; has_source_ifc: boolean }) => [
        f.prefix,
        f.has_source_ifc,
      ]),
    );
    expect(byPrefix["洲際好宅/"]).toBe(true); // probe 命中 model.ifc
    expect(byPrefix["東勢區許良宇紀念圖書館/"]).toBe(false); // probe 無 .ifc，誠實回 false
    expect(res.body.objects).toHaveLength(1);
    expect(res.body.objects[0].key).toBe("annotations/a.json");
    expect(res.body.count).toBe(1); // objects.length（誠實：非遞迴總數）
    expect(res.body.bucket).toBe("bim-control");
    // 誠實鐵律：永不回 presigned URL（folders/objects 皆無 url 欄）。
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });

  it("相同 prefix 第二次命中 coordinator cache，不重打 S3；refresh=1 會 bypass cache", async () => {
    await startS3Stub([
      { prefixes: [], keys: ["annotations/a.json"] },
      { prefixes: [], keys: ["annotations/b.json"] },
    ]);
    const app = makeApp().app;
    const first = await request(app).get("/api/minio/objects?delimiter=/");
    expect(first.status).toBe(200);
    expect(first.body.objects.map((o: { key: string }) => o.key)).toEqual(["annotations/a.json"]);
    expect(first.body.cache).toEqual(expect.objectContaining({ hit: false, stale: false }));
    expect(s3CallCount).toBe(1);

    const second = await request(app).get("/api/minio/objects?delimiter=/");
    expect(second.status).toBe(200);
    expect(second.body.objects.map((o: { key: string }) => o.key)).toEqual(["annotations/a.json"]);
    expect(second.body.cache).toEqual(expect.objectContaining({ hit: true, stale: false }));
    expect(s3CallCount).toBe(1);

    const refreshed = await request(app).get("/api/minio/objects?delimiter=/&refresh=1");
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.objects.map((o: { key: string }) => o.key)).toEqual(["annotations/b.json"]);
    expect(refreshed.body.cache).toEqual(expect.objectContaining({ hit: false, stale: false }));
    expect(s3CallCount).toBe(2);
  });

  it("帶 delimiter=/ 且 probe 回 5xx → 回 502（probe 失敗不靜默捏造 has_source_ifc=false）", async () => {
    await startS3Stub([
      { prefixes: ["proj-a/"], keys: [] },
      { prefixes: [], keys: [], status: 503 }, // probe proj-a/ 失敗
    ]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(502);
  });

  it("502 detail 不洩漏 endpoint/bucket/infra（AWS SDK 原文）：固定 sanitized 字串（q1-502-leak）", async () => {
    // 502 catch 同時服務 listMinioObjects（無 delimiter）與 listMinioFolder（有 delimiter）。
    // AWS SDK 拋出的 err.message 常含 endpoint host:port、bucket、內部錯誤碼，直接回 detail
    // 會把 infra 細節洩漏給瀏覽器。設計：detail 改固定 sanitized 字串，完整 err.message 只進 structLog。
    await startS3Stub([{ prefixes: [], keys: [], status: 503 }]);
    const app = makeApp().app;
    // 從 s3Url 取出 host:port 當「洩漏指紋」——sanitized detail 絕不可含此 endpoint 字串。
    const endpointHost = s3Url.replace(/^https?:\/\//, "");
    const withDelim = await request(app).get("/api/minio/objects?delimiter=/");
    expect(withDelim.status).toBe(502);
    expect(withDelim.body.detail).toBe("minio list failed");
    expect(JSON.stringify(withDelim.body)).not.toContain(endpointHost);

    // 不帶 delimiter（舊 listMinioObjects 路徑）同樣不得洩漏。
    const noDelim = await request(app).get("/api/minio/objects");
    expect(noDelim.status).toBe(502);
    expect(noDelim.body.detail).toBe("minio list failed");
    expect(JSON.stringify(noDelim.body)).not.toContain(endpointHost);
  });

  it("不帶 delimiter → 舊路徑，不回 folders 欄位（byte-identical 回應不受影響）", async () => {
    await startS3Stub([
      { prefixes: [], keys: ["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"] },
    ]);
    const res = await request(makeApp().app).get("/api/minio/objects");
    expect(res.status).toBe(200);
    // 舊路徑不含 folders 欄位
    expect(res.body).not.toHaveProperty("folders");
    expect(Array.isArray(res.body.objects)).toBe(true);
  });

  it("delimiter 非 / → 回 400 invalid_delimiter（白名單：spec §2.1 只定義 delimiter=/）", async () => {
    // 任意非空 delimiter（多字元、Windows 風格 %5c、控制字元）不可被轉送到 S3 SDK，
    // 否則部分值會讓 SDK 拋出非預期錯誤、在 502 detail 洩漏內部訊息，且讓前端控制
    // delimiter 語意超出 spec。白名單擋在轉送前，根本不建 S3 client。
    await startS3Stub([{ prefixes: [], keys: [] }]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=%5c");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_delimiter");
  });

  it("prefix 含 CR/LF → 回 400 invalid_prefix（擋 header injection，不轉送 S3 SDK）", async () => {
    // rawPrefix 直接取自 HTTP query，未驗證即傳 listMinioFolder/listMinioObjects → S3 SDK。
    // 嵌入 \r\n 的 prefix 可能在 SDK HTTP 請求中造成 header injection（AWS SDK 未必全濾）。
    // 守門擋在轉送前：偵測到 CR/LF 直接 400，根本不建 S3 client。帶不帶 delimiter 都要擋。
    await startS3Stub([{ prefixes: [], keys: [] }]);
    const app = makeApp().app;
    const withDelim = await request(app).get(
      `/api/minio/objects?delimiter=/&prefix=${encodeURIComponent("a/\r\nx")}`,
    );
    expect(withDelim.status).toBe(400);
    expect(withDelim.body.error).toBe("invalid_prefix");
    const noDelim = await request(app).get(
      `/api/minio/objects?prefix=${encodeURIComponent("a/\nx")}`,
    );
    expect(noDelim.status).toBe(400);
    expect(noDelim.body.error).toBe("invalid_prefix");
  });

  it("分頁（route 整合層）：頂層 list IsTruncated=true → 合併兩頁 folders 共 2 個", async () => {
    // unit 層（minio-folder-route.test.ts:72）已驗 listMinioFolder 本身能處理 IsTruncated；
    // 此 route 整合層補一個分頁 stub，防 regression 把 while-loop 收尾截斷而 route 不報錯。
    // 頁序：1=頂層 list(IsTruncated, +A/) → 2=次頁(A 收尾, +B/) → 3=probe A/ → 4=probe B/。
    await startS3Stub([
      { prefixes: ["A/"], keys: [], next: "tok2" },
      { prefixes: ["B/"], keys: [] },
      { prefixes: [], keys: [] }, // probe A/（無 .ifc）
      { prefixes: [], keys: [] }, // probe B/（無 .ifc）
    ]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.folders.map((f: { prefix: string }) => f.prefix)).toEqual(["A/", "B/"]);
  });

  it("已設定但當層 prefix 無物件 → folders=[] objects=[] count=0，note 非『未設定』誤導文案（empty-but-configured，spec AC-honesty / q2-empty-configured-test）", async () => {
    // MinIO 已設定（makeApp 帶 minioWatchEndpoint/Bucket），但當層 list 回空（無 CommonPrefixes、無 Contents）。
    // spec §5 AC-honesty：empty-but-configured 態與「未設定」empty 態形狀/文案必須分開——
    // 此態回 folders=[] objects=[] count=0，且不可帶「MinIO watch 未設定」那種誤導文案。
    await startS3Stub([{ prefixes: [], keys: [] }]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.folders).toEqual([]);
    expect(res.body.objects).toEqual([]);
    expect(res.body.count).toBe(0);
    // 已設定態若帶 note，絕不可是「未設定」文案（否則使用者誤判 MinIO 沒接好）。
    if (res.body.note != null) {
      expect(res.body.note).not.toContain("未設定");
    }
  });

  it("未設定 MinIO → 帶 delimiter 仍誠實回 count=0 + note + folders:[]（不 500；前端 getMinioFolder 消費端 folders 必為陣列，task#5 finding #1）", async () => {
    // 不設 minioWatchEndpoint/Bucket → handler 開頭 early-return（app.ts /api/minio/objects），
    // 帶不帶 delimiter 都走同一段誠實回 count:0 + note，絕不 500。
    // folders:[] 補欄（非捏造而是空陣列）：getMinioFolder 走 ?delimiter=/ 打此 route，前端
    // MinioFolderListing 型別 folders 為必填陣列；未設定分支若缺 folders 則消費端 r.folders.map() crash。
    // 空陣列與已設定分支 listMinioFolder shape 對齊，比缺欄位更誠實（取代舊「未設定不臆測 folders」設計）。
    root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-delim-unset-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "conversion-ledger.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      // 刻意不帶 minioWatchEndpoint / minioWatchBucket（未設定 MinIO）
    });
    const res = await request(active.app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.note).toBeTruthy();
    expect(res.body.folders).toEqual([]); // 未設定也回 folders:[]（消費端 .map 安全，task#5 finding #1）
  });
});
