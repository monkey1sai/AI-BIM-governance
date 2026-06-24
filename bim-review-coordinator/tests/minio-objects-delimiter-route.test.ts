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

// S3 stub 依呼叫順序回 pages（同 minio-folder-route.test.ts 模式）。
function startS3Stub(
  pages: Array<{ prefixes: string[]; keys: string[]; next?: string; status?: number }>,
): Promise<void> {
  let call = 0;
  s3Stub = http.createServer((_req, res) => {
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

  it("帶 delimiter=/ 且 probe 回 5xx → 回 502（probe 失敗不靜默捏造 has_source_ifc=false）", async () => {
    await startS3Stub([
      { prefixes: ["proj-a/"], keys: [] },
      { prefixes: [], keys: [], status: 503 }, // probe proj-a/ 失敗
    ]);
    const res = await request(makeApp().app).get("/api/minio/objects?delimiter=/");
    expect(res.status).toBe(502);
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

  it("未設定 MinIO → 帶 delimiter 仍誠實回 count=0 + note（不 500，plan §Task2 line 351）", async () => {
    // 不設 minioWatchEndpoint/Bucket → handler 開頭 early-return（app.ts:1207-1215），
    // 帶不帶 delimiter 都走同一段誠實回 count:0 + note，絕不 500/捏造 folders。
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
    expect(res.body).not.toHaveProperty("folders"); // 未設定不臆測 folders
  });
});
