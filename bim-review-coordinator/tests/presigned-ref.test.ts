import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maskPresignedRef } from "../src/services/presignedRef.js";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

describe("maskPresignedRef", () => {
  it("剝除 presigned 簽章 query，只留物件位址", () => {
    const ref =
      "http://192.168.20.234:9000/bim-control/proj/main/uuid/model.ifc" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc&X-Amz-Date=20260624T000000Z" +
      "&X-Amz-Expires=3600&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host";
    expect(maskPresignedRef(ref)).toBe(
      "http://192.168.20.234:9000/bim-control/proj/main/uuid/model.ifc",
    );
  });

  it("非 presigned URL 原樣返回", () => {
    expect(maskPresignedRef("http://127.0.0.1:8004/api/dev/ifc-file/model.ifc")).toBe(
      "http://127.0.0.1:8004/api/dev/ifc-file/model.ifc",
    );
  });

  it("非 URL（etag 風格）原樣返回", () => {
    expect(maskPresignedRef("devstorage:model.ifc")).toBe("devstorage:model.ifc");
  });

  it("空字串原樣返回", () => {
    expect(maskPresignedRef("")).toBe("");
  });
});

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (!active) return;
  // 三步 teardown，與既有整合測試一致：dispose 先收斂 watcher/timer，再 io.close，最後 server.close。
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

describe("誠實守衛：對外 ifc-ready response 不含 presigned 簽章", () => {
  it("GET /api/external/ifc-ready 列表 body 不含 X-Amz-Signature", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-presign-test-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      streamingConversionApiBase: "http://127.0.0.1:1",
      corsOrigins: ["http://127.0.0.1:5173"],
    });
    const res = await request(active.app).get("/api/external/ifc-ready");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
  });
});
