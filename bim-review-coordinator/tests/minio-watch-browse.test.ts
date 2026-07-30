// bim-review-coordinator/tests/minio-watch-browse.test.ts
// PR2 遷移：舊 minio-folder-route.test.ts（listMinioFolder/listMinioObjects 單元測試）與
// minio-objects-route.test.ts 併入本檔——view 建構（role/badge/'|' guard/probe）已收進
// MinioWatchSurface.browseFolder/browseFlat，S3 存取走真 adapter（stub 驅動）。
// 另補 SSE dirty fan-out × folder cache stale 的 surface 級覆蓋（先前零測試）。
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import {
  createMinioWatchSurface,
  type MinioWatchSurface,
} from "../src/services/minioWatchSurface.js";
import { createFakeObjectStore } from "./helpers/fakeObjectStore.js";

let stub: http.Server | null = null; let stubUrl = "";
let surface: MinioWatchSurface | null = null;

// S3 ListObjectsV2 stub（同舊 minio-folder-route.test.ts 模式）：依「呼叫順序」回 pages。
// browseFolder 會先做頂層 Delimiter list（call 1），再對每個 CommonPrefix 依序 probe
// has_source_ifc（call 2,3,...）——pages 順序＝[頂層 list, probe folder#1, probe folder#2, ...]。
// status?：模擬該頁回 5xx（MinIO 暫時故障 / 憑證錯）；AWS SDK 對 5xx 會 throw → propagate。
function startS3Stub(pages: Array<{ prefixes: string[]; keys: string[]; next?: string; status?: number }>): Promise<void> {
  let call = 0;
  stub = http.createServer((_req, res) => {
    const page = pages[Math.min(call, pages.length - 1)]; call += 1;
    if (page.status && page.status >= 400) {
      res.writeHead(page.status, { "content-type": "application/xml" });
      res.end(`<?xml version="1.0"?><Error><Code>InternalError</Code><Message>stub ${page.status}</Message></Error>`);
      return;
    }
    const cps = page.prefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
    const contents = page.keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e1"</ETag></Contents>`).join("");
    const trunc = page.next ? `<IsTruncated>true</IsTruncated><NextContinuationToken>${page.next}</NextContinuationToken>` : "<IsTruncated>false</IsTruncated>";
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${trunc}${cps}${contents}</ListBucketResult>`);
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}

afterEach(async () => {
  if (surface) { await surface.dispose(); surface = null; }
  if (stub) {
    stub.closeAllConnections?.();
    await new Promise<void>((r) => stub!.close(() => { stub = null; r(); }));
  }
});

const noopLog = { anomaly: () => {} };

/** browse 測試用 surface（watcher 關閉；browse 不依賴 watcher runtime flag）。 */
function makeBrowseSurface(warns?: Array<{ msg: string; key: unknown }>): MinioWatchSurface {
  surface = createMinioWatchSurface({
    config: {
      enabled: false, endpoint: stubUrl, bucket: "bim-control", prefix: "",
      accessKey: "x", secretKey: "y", keySuffix: "/model.ifc", intervalSeconds: 3600,
      selfBaseUrl: "", tenantId: "tenant_demo_001",
    },
    webhookSecret: "s",
    isLedgered: () => false,
    resolveSelfBaseUrl: () => "http://127.0.0.1:1",
    assertIntakeReachable: () => {},
    structLog: {
      anomaly: () => {},
      warn: (_op, msg, data) => warns?.push({ msg, key: data?.key }),
    },
  });
  return surface;
}

describe("MinioWatchSurface.browseFolder（原 listMinioFolder 契約）", () => {
  it("回 folders=CommonPrefixes（{prefix,has_source_ifc}）、objects=當層直屬檔，folders 不含被 roll-up 的子物件", async () => {
    await startS3Stub([{ prefixes: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], keys: ["annotations/a.json"] }]);
    const res = await makeBrowseSurface().browseFolder("", { forceRefresh: false });
    expect(res.folders.map((f) => f.prefix)).toEqual(["洲際好宅/", "東勢區許良宇紀念圖書館/"]);
    expect(res.objects).toHaveLength(1);
    expect(res.objects[0].key).toBe("annotations/a.json");
    expect(res.objects[0].role).toBe("other");
  });

  it("資料夾 has_source_ifc：對每個 CommonPrefix 再 probe 一次，子層有 .ifc → true、無 → false（spec §2.5 第 5 點）", async () => {
    await startS3Stub([
      { prefixes: ["proj-with-ifc/", "proj-empty/"], keys: [] }, // 頂層 Delimiter list
      { prefixes: [], keys: ["proj-with-ifc/root/main/000001/model.ifc"] }, // probe proj-with-ifc/
      { prefixes: [], keys: ["proj-empty/annotations/a.json"] },             // probe proj-empty/
    ]);
    const res = await makeBrowseSurface().browseFolder("", { forceRefresh: false });
    const byPrefix = Object.fromEntries(res.folders.map((f) => [f.prefix, f.has_source_ifc]));
    expect(byPrefix["proj-with-ifc/"]).toBe(true);
    expect(byPrefix["proj-empty/"]).toBe(false);
  });

  it("probe 失敗（MinIO 5xx）→ browseFolder 整體拋出，不靜默把 has_source_ifc 偽報為 false（誠實鐵律：不臆測）", async () => {
    await startS3Stub([
      { prefixes: ["proj-a/", "proj-b/"], keys: [] }, // 頂層 Delimiter list（成功）
      { prefixes: [], keys: [], status: 503 },        // probe proj-a/ → MinIO 暫時故障
    ]);
    await expect(makeBrowseSurface().browseFolder("", { forceRefresh: false })).rejects.toThrow();
  });

  it("超 1000 子前綴/物件不截斷：IsTruncated=true → 帶 continuation 取次頁，兩頁 folders 合併", async () => {
    await startS3Stub([
      { prefixes: ["A/"], keys: [], next: "tok2" },
      { prefixes: ["B/"], keys: [] },
      { prefixes: [], keys: [] }, // probe A/
      { prefixes: [], keys: [] }, // probe B/
    ]);
    const res = await makeBrowseSurface().browseFolder("", { forceRefresh: false });
    expect(res.folders.map((f) => f.prefix)).toEqual(["A/", "B/"]);
  });

  it("role='other' 物件不解析 badge（三路分流：非 .ifc/.usdc 直接 ok:false，欄位全 null）", async () => {
    await startS3Stub([{ prefixes: [], keys: ["proj/root/main/model.ifc.bak"] }]);
    const res = await makeBrowseSurface().browseFolder("", { forceRefresh: false });
    const other = res.objects.find((o) => o.key === "proj/root/main/model.ifc.bak");
    expect(other?.role).toBe("other");
    expect(other?.project_id).toBeNull();
    expect(other?.project_display_name).toBeNull();
    expect(other?.category).toBeNull();
    expect(other?.version).toBeNull();
    // idempotency_key 仍計算（供前端對帳），不受 badge 解析影響。
    expect(other?.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
  });

  it(".ifc 物件附 idempotency_key（給前端 chip lookup）＋ 葉層三段 badge", async () => {
    await startS3Stub([{ prefixes: [], keys: ["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"] }]);
    const res = await makeBrowseSurface().browseFolder("東勢區許良宇紀念圖書館/root/main/000001/", { forceRefresh: false });
    const ifc = res.objects.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(ifc?.category).toBe("main");
    expect(ifc?.version).toBe("000001");
  });

  it("key 含 '|' → 跳過該物件 + structLog warning（對齊 watcher idempotencyKeyFor precondition，q3-pipe-guard）", async () => {
    await startS3Stub([
      { prefixes: [], keys: ["proj|evil/root/main/000001/model.ifc", "proj-ok/root/main/000001/model.ifc"] },
    ]);
    const warns: Array<{ msg: string; key: unknown }> = [];
    const res = await makeBrowseSurface(warns).browseFolder("", { forceRefresh: false });
    // 含 '|' 的 key 不入回應；乾淨的 key 正常保留。
    expect(res.objects.map((o) => o.key)).toEqual(["proj-ok/root/main/000001/model.ifc"]);
    // warn 被呼叫且帶被跳過的 key（供運維追查）。
    expect(warns.some((w) => w.key === "proj|evil/root/main/000001/model.ifc")).toBe(true);
  });
});

describe("MinioWatchSurface.browseFlat（原 listMinioObjects 契約）", () => {
  it("判角色：.ifc=source_ifc、.usdc=parsed_usdc，解析 project/category/version", async () => {
    await startS3Stub([{ prefixes: [], keys: ["松風庵/root/main/000001/model.ifc", "松風庵/root/main/000001/model.usdc"] }]);
    const res = await makeBrowseSurface().browseFlat("");
    const ifc = res.objects.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.category).toBe("main");        // 倒數二段
    expect(ifc?.version).toBe("000001");       // 末段
    expect(res.objects.find((o) => o.key.endsWith(".usdc"))?.role).toBe("parsed_usdc");
  });

  it("key 含 '|' → 跳過 + warn（同 q3-pipe-guard 對齊 watcher precondition）", async () => {
    await startS3Stub([
      { prefixes: [], keys: ["a|b/root/main/000001/model.ifc", "clean/root/main/000001/model.ifc"] },
    ]);
    const warns: Array<{ msg: string; key: unknown }> = [];
    const res = await makeBrowseSurface(warns).browseFlat("");
    expect(res.objects.map((o) => o.key)).toEqual(["clean/root/main/000001/model.ifc"]);
    expect(warns.some((w) => w.key === "a|b/root/main/000001/model.ifc")).toBe(true);
  });
});

// SSE dirty fan-out × folder cache stale（先前零測試覆蓋；PR2 收進 surface 後補上）。
// watcher（fake object store）觀察到新物件 → (1) 訂閱端收到 minio.changed frame、
// (2) 對應 prefix 的 folder cache 標 stale → 下一次 browseFolder 不吃 cache（hit=false）。
describe("MinioWatchSurface dirty 事件 × folder cache", () => {
  it("watcher 觀察到新物件 → subscribeEvents 收到 minio.changed；cached folder 轉 stale 不再命中", async () => {
    const fake = createFakeObjectStore([]);
    surface = createMinioWatchSurface({
      config: {
        enabled: true, endpoint: "http://127.0.0.1:9000", bucket: "bim-control", prefix: "",
        accessKey: "x", secretKey: "y", keySuffix: "/model.ifc", intervalSeconds: 3600,
        selfBaseUrl: "http://127.0.0.1:1", tenantId: "tenant_demo_001",
      },
      webhookSecret: "s",
      isLedgered: () => true, // 只驗 dirty 通知，不真打 intake
      resolveSelfBaseUrl: () => "http://127.0.0.1:1",
      assertIntakeReachable: () => {},
      objectStoreFactory: () => fake,
      structLog: noopLog,
    });
    surface.startIfEnabled();
    await surface.pollNow(); // 首輪（空 bucket）落定

    // 先建 folder cache entry（空 listing）→ 第二次同 prefix 命中 cache。
    const first = await surface.browseFolder("proj-a/", { forceRefresh: false });
    expect(first.cache.hit).toBe(false);
    const second = await surface.browseFolder("proj-a/", { forceRefresh: false });
    expect(second.cache.hit).toBe(true);

    // 訂閱 dirty stream；watcher 觀察到 proj-a/ 下新物件。
    const frames: string[] = [];
    const unsubscribe = surface.subscribeEvents({ write: (chunk) => { frames.push(chunk); return true; }, end: () => {} });
    fake.objs.push({ key: "proj-a/root/main/000001/model.ifc", etag: "e9" });
    await surface.pollNow(); // 觀察落定（isLedgered=true → 只 observe 不 intake）

    // (1) minio.changed frame 送達且含受影響 prefix 與 reason。
    const changed = frames.find((f) => f.includes("minio.changed"));
    expect(changed).toBeTruthy();
    expect(changed).toContain("proj-a/");
    expect(changed).toContain("minio-watcher-observed-object");

    // (2) cache 已 stale → 下一次 browse 重新取，不吃 cache。新物件在更深層，
    // 於 proj-a/ 層以 Delimiter 語意 roll-up 成資料夾節點（含 has_source_ifc badge）。
    const third = await surface.browseFolder("proj-a/", { forceRefresh: false });
    expect(third.cache.hit).toBe(false);
    expect(third.folders).toEqual([{ prefix: "proj-a/root/", has_source_ifc: true }]);

    unsubscribe();
    // 退訂後不再收 frame。
    const framesAfter = frames.length;
    fake.objs.push({ key: "proj-b/root/main/000002/model.ifc", etag: "e10" });
    await surface.pollNow();
    expect(frames.length).toBe(framesAfter);
  });
});
