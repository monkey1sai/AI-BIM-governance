// bim-review-coordinator/tests/minio-folder-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { listMinioFolder, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
// S3 ListObjectsV2 with Delimiter='/'：回 CommonPrefixes（資料夾）+ Contents（當層直屬檔）。
// 支援分頁：第一頁 IsTruncated=true + NextContinuationToken，第二頁 false。
// 重要：本 stub 依「呼叫順序」回 pages（call N → pages[N]），超出則重複最後一頁。
//   listMinioFolder 會先做頂層 Delimiter list（call 1），再對每個 CommonPrefix 依序 probe has_source_ifc
//   （call 2,3,...）。故 pages 順序＝[頂層 list, probe folder#1, probe folder#2, ...]，須與 prefixSet 順序對齊。
function startS3Stub(pages: Array<{ prefixes: string[]; keys: string[]; next?: string }>): Promise<void> {
  let call = 0;
  stub = http.createServer((_req, res) => {
    const page = pages[Math.min(call, pages.length - 1)]; call += 1;
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
afterEach(() => new Promise<void>((r) => stub ? stub.close(() => { stub = null; r(); }) : r()));

describe("listMinioFolder", () => {
  it("回 folders=CommonPrefixes（{prefix,has_source_ifc}）、objects=當層直屬檔，folders 不含被 roll-up 的子物件", async () => {
    await startS3Stub([{ prefixes: ["洲際好宅/", "東勢區許良宇紀念圖書館/"], keys: ["annotations/a.json"] }]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders.map((f) => f.prefix)).toEqual(["洲際好宅/", "東勢區許良宇紀念圖書館/"]);
    expect(res.objects).toHaveLength(1);
    expect(res.objects[0].key).toBe("annotations/a.json");
    expect(res.objects[0].role).toBe("other");
  });

  it("資料夾 has_source_ifc：對每個 CommonPrefix 再 probe 一次，子層有 .ifc → true、無 → false（spec §2.5 第 5 點）", async () => {
    // 第一頁＝頂層 list（2 個 folder，無直屬檔）；後兩頁＝對各 folder 的 probe list（has_source_ifc）。
    // stub 依呼叫順序回頁：probe「proj-with-ifc/」回含 model.ifc、probe「proj-empty/」回無 .ifc。
    await startS3Stub([
      { prefixes: ["proj-with-ifc/", "proj-empty/"], keys: [] }, // 頂層 Delimiter list
      { prefixes: [], keys: ["proj-with-ifc/root/main/000001/model.ifc"] }, // probe proj-with-ifc/
      { prefixes: [], keys: ["proj-empty/annotations/a.json"] },             // probe proj-empty/
    ]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    const byPrefix = Object.fromEntries(res.folders.map((f) => [f.prefix, f.has_source_ifc]));
    expect(byPrefix["proj-with-ifc/"]).toBe(true);
    expect(byPrefix["proj-empty/"]).toBe(false);
  });

  it("超 1000 子前綴/物件不截斷：IsTruncated=true → 帶 continuation 取次頁，兩頁 folders 合併", async () => {
    await startS3Stub([
      { prefixes: ["A/"], keys: [], next: "tok2" },
      { prefixes: ["B/"], keys: [] },
      // 後續為 A/、B/ 的 has_source_ifc probe（回無 .ifc 即可，本測試只驗合併）。
      { prefixes: [], keys: [] },
      { prefixes: [], keys: [] },
    ]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "", "/");
    expect(res.folders.map((f) => f.prefix)).toEqual(["A/", "B/"]);
  });

  it(".ifc 物件附 idempotency_key（給前端 chip lookup）＋ 葉層三段 badge", async () => {
    await startS3Stub([{ prefixes: [], keys: ["東勢區許良宇紀念圖書館/root/main/000001/model.ifc"] }]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const res = await listMinioFolder(client, "bim-control", "東勢區許良宇紀念圖書館/root/main/000001/", "/");
    const ifc = res.objects.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.idempotency_key).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(ifc?.category).toBe("main");
    expect(ifc?.version).toBe("000001");
  });
});
