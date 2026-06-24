// bim-review-coordinator/tests/minio-objects-route.test.ts
import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { listMinioObjects, createMinioS3Client } from "../src/services/minioClient.js";

let stub: http.Server | null = null; let stubUrl = "";
function startS3Stub(keys: string[]): Promise<void> {
  stub = http.createServer((_req, res) => {
    const contents = keys.map((k) => `<Contents><Key>${k}</Key><ETag>"e"</ETag></Contents>`).join("");
    res.writeHead(200, { "content-type": "application/xml" });
    res.end(`<?xml version="1.0"?><ListBucketResult>${contents}</ListBucketResult>`);
  });
  return new Promise((r) => stub!.listen(0, "127.0.0.1", () => {
    stubUrl = `http://127.0.0.1:${(stub!.address() as { port: number }).port}`; r();
  }));
}
afterEach(() => new Promise<void>((r) => stub ? stub.close(() => { stub = null; r(); }) : r()));

describe("listMinioObjects", () => {
  it("判角色：.ifc=source_ifc、.usdc=parsed_usdc，解析 project/category/version", async () => {
    await startS3Stub(["松風庵/root/main/000001/model.ifc", "松風庵/root/main/000001/model.usdc"]);
    const client = createMinioS3Client({ endpoint: stubUrl, accessKey: "x", secretKey: "y" });
    const objs = await listMinioObjects(client, "bim-control", "", "/model.ifc");
    const ifc = objs.find((o) => o.key.endsWith(".ifc"));
    expect(ifc?.role).toBe("source_ifc");
    expect(ifc?.category).toBe("main");        // 倒數二段
    expect(ifc?.version).toBe("000001");       // 末段
    expect(objs.find((o) => o.key.endsWith(".usdc"))?.role).toBe("parsed_usdc");
  });
});
