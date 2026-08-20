// bim-review-coordinator/tests/lineage/object-store-governed.test.ts
// L3b（issue #666 / rvt-ifc-usdc-lineage task 3.1 前置）：ObjectStorePort 的三個 governed
// 加性方法——headObjectVersioned／getObjectBytes／streamSha256——的真 S3 adapter 契約測試。
// 手法比照 tests/minio-object-store.test.ts 與 tests/minio-head-etag.test.ts：本地 HTTP/XML
// stub + 真 SDK，鎖住 versionId 透傳、404→null／throw 的分界、5xx 一律 propagate、位元組
// 上限硬邊界，以及「串流摘要不整檔載入記憶體」。fake adapter 的 parity 一併在檔尾綁定。
import http from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GET_OBJECT_MAX_BYTES,
  ObjectTooLargeError,
  createS3ObjectStore,
  type ObjectStorePort,
} from "../../src/services/minioObjectStore.js";
import { createFakeObjectStore } from "../helpers/fakeObjectStore.js";

let stub: http.Server | null = null;
let stubUrl = "";
let store: ObjectStorePort | null = null;
const seen: Array<{ method: string; url: string }> = [];

type StubHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

async function startStub(handler: StubHandler): Promise<void> {
  seen.length = 0;
  stub = http.createServer((req, res) => {
    seen.push({ method: req.method ?? "", url: req.url ?? "" });
    // 部分案例的 client 依設計會提早中止（超上限即 abort）；stub 端的寫入失敗不是測試失敗。
    req.on("error", () => undefined);
    res.on("error", () => undefined);
    Promise.resolve(handler(req, res)).catch(() => undefined);
  });
  await new Promise<void>((r) => stub!.listen(0, "127.0.0.1", () => r()));
  const addr = stub!.address();
  if (!addr || typeof addr === "string") throw new Error("stub bind failed");
  stubUrl = `http://127.0.0.1:${addr.port}`;
}

afterEach(async () => {
  if (store) {
    await store.destroy();
    store = null;
  }
  if (stub) {
    stub.closeAllConnections?.();
    await new Promise<void>((r) => stub!.close(() => r()));
    stub = null;
  }
});

function makeStore(): ObjectStorePort {
  store = createS3ObjectStore({
    endpoint: stubUrl,
    bucket: "bim-control",
    accessKey: "ak",
    secretKey: "sk",
  });
  return store;
}

/** 取第一個請求的 query（versionId 透傳斷言用；5xx 案例會有 SDK 重試的多次請求）。 */
function firstQuery(): URLSearchParams {
  return new URL(seen[0]?.url ?? "/", "http://x").searchParams;
}

/** 依 backpressure 逐塊寫出（write callback 回來才寫下一塊）。 */
async function writeChunks(res: http.ServerResponse, chunks: Iterable<Uint8Array>): Promise<void> {
  for (const c of chunks) {
    await new Promise<void>((resolve, reject) => {
      res.write(c, (err) => (err ? reject(err) : resolve()));
    });
  }
  res.end();
}

const S3_NO_SUCH_KEY =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>';
const S3_INTERNAL_ERROR =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code><Message>We encountered an internal error.</Message></Error>';

describe("ObjectStorePort.headObjectVersioned（真 S3 adapter）", () => {
  it("命中：回去引號 etag／size／versionId，且 versionId 以 query 透傳給 HeadObject", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, {
        etag: '"abc123"',
        "content-length": "1234",
        "x-amz-version-id": "v-server-9",
      });
      res.end();
    });
    const head = await makeStore().headObjectVersioned("p/root/main/000001/manifest.json", "v-req-2");
    expect(head).toEqual({ etag: "abc123", sizeBytes: 1234, versionId: "v-server-9" });
    expect(seen[0]?.method).toBe("HEAD");
    expect(firstQuery().get("versionId")).toBe("v-req-2"); // 透傳，不吞
  });

  it("省略 versionId → 請求不帶 versionId query（讀當前版本）", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { etag: '"e1"', "content-length": "7" });
      res.end();
    });
    const head = await makeStore().headObjectVersioned("p/root/main/000001/manifest.json");
    expect(head).toEqual({ etag: "e1", sizeBytes: 7, versionId: null });
    expect(firstQuery().has("versionId")).toBe(false);
  });

  it("未開版本控管：x-amz-version-id 字面 \"null\" → versionId 收成 null（不當成可引用版本）", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { etag: '"e1"', "content-length": "7", "x-amz-version-id": "null" });
      res.end();
    });
    const head = await makeStore().headObjectVersioned("p/root/main/000001/manifest.json");
    expect(head?.versionId).toBeNull();
  });

  it("物件／版本不存在（404）→ null", async () => {
    await startStub((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const head = await makeStore().headObjectVersioned("p/root/main/999999/manifest.json", "v-gone");
    expect(head).toBeNull();
  });

  it("憑證錯（403）→ rethrow（不退化成 null，否則上游權限錯被謊報成 artifact_not_found）", async () => {
    await startStub((_req, res) => {
      res.writeHead(403);
      res.end();
    });
    await expect(
      makeStore().headObjectVersioned("p/root/main/000001/manifest.json"),
    ).rejects.toBeTruthy();
  });

  it("上游 5xx（500）→ rethrow（不退化成 null）", async () => {
    await startStub((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await expect(
      makeStore().headObjectVersioned("p/root/main/000001/manifest.json"),
    ).rejects.toBeTruthy();
  });
});

describe("ObjectStorePort.getObjectBytes（真 S3 adapter）", () => {
  it("命中：回完整位元組，且 versionId 以 query 透傳給 GetObject", async () => {
    const payload = Buffer.from(JSON.stringify({ schema: "source_bundle_manifest", artifacts: 2 }));
    await startStub((_req, res) => {
      res.writeHead(200, { "content-length": String(payload.byteLength) });
      res.end(payload);
    });
    const bytes = await makeStore().getObjectBytes("p/root/main/000001/manifest.json", "v-req-3");
    expect(Buffer.compare(bytes, payload)).toBe(0);
    expect(seen[0]?.method).toBe("GET");
    expect(firstQuery().get("versionId")).toBe("v-req-3");
  });

  it("物件不存在（404）→ throw（回傳型別不含 null，不以空 Buffer 冒充「沒有」）", async () => {
    await startStub((_req, res) => {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end(S3_NO_SUCH_KEY);
    });
    await expect(makeStore().getObjectBytes("p/root/main/999999/manifest.json")).rejects.toBeTruthy();
  });

  it("上游 5xx（500）→ propagate", async () => {
    await startStub((_req, res) => {
      res.writeHead(500, { "content-type": "application/xml" });
      res.end(S3_INTERNAL_ERROR);
    });
    await expect(makeStore().getObjectBytes("p/root/main/000001/manifest.json")).rejects.toBeTruthy();
  });

  it("Content-Length 宣告超過 maxBytes → ObjectTooLargeError（不下載 body 就早退）", async () => {
    await startStub((_req, res) => {
      // 只送 header（flushHeaders 才會真的把 header 推上 socket）：呼叫端應在讀 body 前就拒絕。
      res.writeHead(200, { "content-length": "4096" });
      res.flushHeaders();
    });
    const err = await makeStore()
      .getObjectBytes("p/root/main/000001/manifest.json", undefined, 1024)
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectTooLargeError);
    expect((err as ObjectTooLargeError).maxBytes).toBe(1024);
    expect((err as ObjectTooLargeError).observedBytes).toBe(4096);
  });

  it("無 Content-Length（chunked）但實際超過 maxBytes → 讀取途中即 ObjectTooLargeError", async () => {
    const chunk = Buffer.alloc(512, 0x41);
    await startStub(async (_req, res) => {
      res.writeHead(200); // 刻意不宣告 content-length → 硬邊界只能靠逐 chunk 累計
      await writeChunks(res, [chunk, chunk, chunk, chunk]);
    });
    const err = await makeStore()
      .getObjectBytes("p/root/main/000001/manifest.json", undefined, 1024)
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectTooLargeError);
    expect((err as ObjectTooLargeError).observedBytes).toBeGreaterThan(1024);
  });

  it("未指定 maxBytes → 套用 DEFAULT_GET_OBJECT_MAX_BYTES（32 MiB）作為預設硬上限", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { "content-length": String(DEFAULT_GET_OBJECT_MAX_BYTES + 1) });
      res.flushHeaders(); // 只送 header，不送 body：預設上限應在下載前就擋下
    });
    const err = await makeStore()
      .getObjectBytes("p/root/main/000001/huge.bin")
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ObjectTooLargeError);
    expect((err as ObjectTooLargeError).maxBytes).toBe(DEFAULT_GET_OBJECT_MAX_BYTES);
  });
});

describe("ObjectStorePort.streamSha256（真 S3 adapter）", () => {
  it("8 MiB 分 64 個網路 chunk 送達 → sha256 與實測 size 正確；versionId 透傳", async () => {
    const CHUNK = 128 * 1024;
    const COUNT = 64;
    const full = Buffer.alloc(CHUNK * COUNT);
    // 每塊填不同位元組：漏塊／錯序都會改變摘要。
    for (let c = 0; c < COUNT; c += 1) full.fill(c & 0xff, c * CHUNK, (c + 1) * CHUNK);
    const expected = createHash("sha256").update(full).digest("hex");

    await startStub(async (_req, res) => {
      res.writeHead(200, { "content-length": String(full.byteLength) });
      const parts: Uint8Array[] = [];
      for (let c = 0; c < COUNT; c += 1) parts.push(full.subarray(c * CHUNK, (c + 1) * CHUNK));
      await writeChunks(res, parts);
    });

    const digest = await makeStore().streamSha256("p/root/main/000001/model.ifc", "v-req-7");
    expect(digest.sha256).toBe(expected);
    expect(digest.sizeBytes).toBe(CHUNK * COUNT); // 實測位元組數，非轉述 Content-Length
    expect(firstQuery().get("versionId")).toBe("v-req-7");
  });

  it("物件大於 getObjectBytes 預設上限仍可摘要 → 證明未繞道整檔載入路徑", async () => {
    // 「過程未一次性持有全量 buffer」的等效機器證據：本物件比整檔路徑的硬上限還大 1 byte，
    // 任何「先 getObjectBytes／先 concat 再 hash」的實作都會在此拋 ObjectTooLargeError。
    const MIB = 1024 * 1024;
    const unit = Buffer.alloc(MIB, 0xa7);
    const tail = Buffer.from([0x5c]);
    const units = DEFAULT_GET_OBJECT_MAX_BYTES / MIB; // 32
    const h = createHash("sha256");
    for (let i = 0; i < units; i += 1) h.update(unit);
    h.update(tail);
    const expected = h.digest("hex");

    await startStub(async (_req, res) => {
      res.writeHead(200, { "content-length": String(DEFAULT_GET_OBJECT_MAX_BYTES + 1) });
      const parts: Uint8Array[] = [];
      for (let i = 0; i < units; i += 1) parts.push(unit);
      parts.push(tail);
      await writeChunks(res, parts);
    });

    const s = makeStore();
    const digest = await s.streamSha256("p/root/main/000001/big.rvt");
    expect(digest.sha256).toBe(expected);
    expect(digest.sizeBytes).toBe(DEFAULT_GET_OBJECT_MAX_BYTES + 1);
    // 同一個物件走整檔路徑則必須被上限擋下（兩條路徑的邊界確實不同）。
    await expect(s.getObjectBytes("p/root/main/000001/big.rvt")).rejects.toBeInstanceOf(
      ObjectTooLargeError,
    );
  });

  it("物件不存在（404）→ throw；上游 5xx（500）→ propagate", async () => {
    await startStub((_req, res) => {
      res.writeHead(404, { "content-type": "application/xml" });
      res.end(S3_NO_SUCH_KEY);
    });
    await expect(makeStore().streamSha256("p/root/main/999999/model.ifc")).rejects.toBeTruthy();
    await store!.destroy();
    store = null;
    await new Promise<void>((r) => stub!.close(() => r()));
    stub = null;

    await startStub((_req, res) => {
      res.writeHead(500, { "content-type": "application/xml" });
      res.end(S3_INTERNAL_ERROR);
    });
    await expect(makeStore().streamSha256("p/root/main/000001/model.ifc")).rejects.toBeTruthy();
  });
});

describe("fake adapter（tests/helpers/fakeObjectStore）與真 adapter 的 governed parity", () => {
  const bytesV1 = Buffer.from("manifest-v1-payload");
  const bytesV2 = Buffer.from("manifest-v2-payload-longer");

  function seeded() {
    return createFakeObjectStore([
      { key: "p/a/manifest.json", etag: '"e-v1"', versionId: "v1", bytes: bytesV1 },
      { key: "p/a/manifest.json", etag: "e-v2", versionId: "v2", bytes: bytesV2 },
      { key: "p/a/no-bytes.json", etag: "e-nb" },
    ]);
  }

  it("headObjectVersioned：指定版本選版、省略版本取當前、未命中 null、etag 去引號", async () => {
    const fake = seeded();
    expect(await fake.headObjectVersioned("p/a/manifest.json", "v2")).toEqual({
      etag: "e-v2",
      sizeBytes: bytesV2.byteLength,
      versionId: "v2",
    });
    expect(await fake.headObjectVersioned("p/a/manifest.json")).toEqual({
      etag: "e-v1",
      sizeBytes: bytesV1.byteLength,
      versionId: "v1",
    });
    expect(await fake.headObjectVersioned("p/a/manifest.json", "v-missing")).toBeNull();
    // 未備 bytes → size 不明回 null，不以 0 冒充空物件。
    expect((await fake.headObjectVersioned("p/a/no-bytes.json"))?.sizeBytes).toBeNull();
  });

  it("上游錯誤（failObjectReadWith）三個方法一律 propagate，不謊報成 not_found", async () => {
    const fake = seeded();
    fake.failObjectReadWith = new Error("upstream credential failure");
    await expect(fake.headObjectVersioned("p/a/manifest.json", "v1")).rejects.toThrow(
      "upstream credential failure",
    );
    await expect(fake.getObjectBytes("p/a/manifest.json", "v1")).rejects.toThrow(
      "upstream credential failure",
    );
    await expect(fake.streamSha256("p/a/manifest.json", "v1")).rejects.toThrow(
      "upstream credential failure",
    );
  });

  it("getObjectBytes：選版取內容；超上限 ObjectTooLargeError；缺內容 throw（不回空 Buffer）", async () => {
    const fake = seeded();
    expect(Buffer.compare(await fake.getObjectBytes("p/a/manifest.json", "v2"), bytesV2)).toBe(0);
    await expect(
      fake.getObjectBytes("p/a/manifest.json", "v2", bytesV2.byteLength - 1),
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
    await expect(fake.getObjectBytes("p/a/no-bytes.json")).rejects.toBeTruthy();
  });

  it("streamSha256：摘要與真 adapter 對同一段位元組逐位元組一致", async () => {
    const fake = seeded();
    await startStub((_req, res) => {
      res.writeHead(200, { "content-length": String(bytesV2.byteLength) });
      res.end(bytesV2);
    });
    const real = await makeStore().streamSha256("p/a/manifest.json", "v2");
    const fakeDigest = await fake.streamSha256("p/a/manifest.json", "v2");
    expect(fakeDigest).toEqual(real);
    expect(fakeDigest.sha256).toBe(createHash("sha256").update(bytesV2).digest("hex"));
  });

  it("既有 6 方法不受擴充影響：帶 versionId／bytes 的 entry 仍走原本的 list／headEtag 語意", async () => {
    const fake = seeded();
    expect((await fake.listObjects("p/a/")).map((o) => o.key)).toEqual([
      "p/a/manifest.json",
      "p/a/manifest.json",
      "p/a/no-bytes.json",
    ]);
    expect(await fake.headEtag("p/a/manifest.json")).toBe("e-v1"); // 去引號、取第一筆
    expect(await fake.hasKeyWithSuffix("p/a/", ".json")).toBe(true);
    expect(await fake.presign("p/a/manifest.json", 60)).toMatch(/X-Amz-Signature=/);
  });
});
