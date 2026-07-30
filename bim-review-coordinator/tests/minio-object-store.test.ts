import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createS3ObjectStore } from "../src/services/minioObjectStore.js";

// 真 S3 adapter 的 implementation 測試（ObjectStorePort seam 的 production 側）：
// 分頁 continuation 與 presign 簽章屬 SDK 行為，fake adapter 不重演，於此以
// 本地 XML stub + 真 SDK 直接鎖定。watcher 語意測試在 minio-watch-surface.test.ts。

let s3Stub: http.Server | null = null;

afterEach(async () => {
  if (s3Stub) {
    s3Stub.closeAllConnections?.();
    await new Promise<void>((r) => s3Stub!.close(() => r()));
    s3Stub = null;
  }
});

describe("createS3ObjectStore", () => {
  it("ListObjectsV2 分頁：IsTruncated=true → 帶 continuation-token 取次頁，兩頁物件皆回傳", async () => {
    const tokenRequests: string[] = [];
    s3Stub = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const token = url.searchParams.get("continuation-token");
      tokenRequests.push(token ?? "(first)");
      res.writeHead(200, { "Content-Type": "application/xml" });
      if (!token) {
        res.end('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>true</IsTruncated><NextContinuationToken>tok2</NextContinuationToken><Contents><Key>899/main/p1/model.ifc</Key><ETag>&quot;pe1&quot;</ETag><Size>10</Size></Contents></ListBucketResult>');
      } else {
        res.end('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated><Contents><Key>900/main/p2/model.ifc</Key><ETag>&quot;pe2&quot;</ETag><Size>10</Size></Contents></ListBucketResult>');
      }
    });
    await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
    const a = s3Stub!.address();
    if (!a || typeof a === "string") throw new Error("s3 stub bind");
    const store = createS3ObjectStore({
      endpoint: `http://127.0.0.1:${a.port}`,
      bucket: "bim-control",
      accessKey: "ak",
      secretKey: "sk",
    });
    try {
      const objs = await store.listObjects("");
      expect(objs.map((o) => o.key)).toEqual(["899/main/p1/model.ifc", "900/main/p2/model.ifc"]);
      // etag 保留 ListObjectsV2 原始值（含外層引號）；去引號由呼叫端（derive/stripEtagQuotes）處理。
      expect(objs.map((o) => o.etag)).toEqual(['"pe1"', '"pe2"']);
      expect(tokenRequests).toContain("(first)");
      expect(tokenRequests).toContain("tok2");
    } finally {
      await store.destroy();
    }
  });

  it("presign：本地簽出含 X-Amz-Signature 的 GET URL（不打網路）", async () => {
    const store = createS3ObjectStore({
      endpoint: "http://127.0.0.1:9000",
      bucket: "bim-control",
      accessKey: "ak",
      secretKey: "sk",
    });
    try {
      const url = await store.presign("899/main/xxx/model.ifc", 3600);
      expect(url).toContain("899/main/xxx/model.ifc");
      expect(url).toMatch(/X-Amz-Signature=/);
    } finally {
      await store.destroy();
    }
  });
});
