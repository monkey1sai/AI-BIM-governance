// bim-review-coordinator/tests/minio-head-etag.test.ts
// finding #2：headMinioObjectEtag 的「非 404 上游錯誤須 rethrow（不退化成 null）」回歸測試。
// 物件不存在（404/NotFound/NoSuchKey）→ null；憑證錯（403/Forbidden）等其他錯誤 → 向上 propagate。
// 若這條路徑被誤改成 return null，route 會把 502（上游失敗）謊報成 404（物件不存在），錯誤語意被謊報。
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { headMinioObjectEtag, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
// HeadObject stub：依注入的 status 回應。200 帶 etag header；403/404 回對應 S3 XML error。
// forcePathStyle → HEAD /{bucket}/{key}。
function startHeadStub(status: number, etag?: string): Promise<void> {
  stub = http.createServer((_req, res) => {
    if (status === 200) {
      res.writeHead(200, { etag: etag ?? '"e1"' });
      res.end();
      return;
    }
    // S3 對 HeadObject 失敗回 body 多為空（HEAD 無 body），SDK 依 httpStatusCode 推 error name
    //（404→NotFound、403→Forbidden）。此處只需正確 status code 即可驅動 SDK 分類。
    res.writeHead(status);
    res.end();
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}
afterEach(() => new Promise<void>((r) => stub ? stub.close(() => { stub = null; r(); }) : r()));

describe("headMinioObjectEtag", () => {
  it("命中（200）→ 回去引號 etag", async () => {
    await startHeadStub(200, '"abc123"');
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const etag = await headMinioObjectEtag(client, "bim-control", "p/root/main/000001/model.ifc");
    expect(etag).toBe("abc123"); // 引號已去
  });

  it("物件不存在（404）→ 回 null（收斂成 not_found，不 rethrow）", async () => {
    await startHeadStub(404);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const etag = await headMinioObjectEtag(client, "bim-control", "p/root/main/999999/model.ifc");
    expect(etag).toBeNull();
  });

  it("憑證錯（403 Forbidden）→ rethrow（不退化成 null；route 才能回 502 而非謊報 404）", async () => {
    await startHeadStub(403);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    // 必須拋出（reject），不可解析成 null；否則上游憑證/權限錯被謊報成「物件不存在」。
    await expect(
      headMinioObjectEtag(client, "bim-control", "p/root/main/000001/model.ifc"),
    ).rejects.toBeTruthy();
  });
});
