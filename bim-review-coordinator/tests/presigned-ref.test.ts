import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

// 一筆帶 presigned 簽章的 source_ifc.ref：物件位址 + X-Amz-* query。
// 對外任何出口都必須剝掉簽章、只留 OBJECT_PATH。
const OBJECT_PATH = "http://192.168.20.234:9000/bim-control/proj/main/uuid/model.ifc";
const PRESIGNED_REF =
  OBJECT_PATH +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc&X-Amz-Date=20260624T000000Z" +
  "&X-Amz-Expires=3600&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host";

// 凍結契約 example（root tests/contracts/ifc_ready_payload.json）為 intake payload 基底，
// 只覆寫 source_ifc.ref 為 presigned，模擬真實 MinIO presigned URL 進 store。
const CONTRACT_EXAMPLE = JSON.parse(
  fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "contracts", "ifc_ready_payload.json"),
    "utf-8",
  ),
).example as Record<string, unknown>;

function startPresignApp(): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-presign-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
  });
  return active;
}

// 透過真實 POST /api/external/ifc-ready 落地一筆 job（download 走 dev fallback，
// ifcDownloadStrict 預設 false），回傳 jobId。source_ifc.ref 帶 presigned 簽章。
async function seedPresignedJob(app: CoordinatorApp): Promise<string> {
  const body = {
    ...structuredClone(CONTRACT_EXAMPLE),
    source_ifc: { ...(CONTRACT_EXAMPLE.source_ifc as Record<string, unknown>), ref: PRESIGNED_REF },
  };
  const created = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({
      "X-Webhook-Secret": "dev-webhook-secret",
      "X-Correlation-Id": "corr_presign_001",
      "X-Idempotency-Key": "idem_presign_001",
    })
    .send(body);
  expect(created.status).toBe(202);
  return created.body.ifc_ready_job_id as string;
}

describe("誠實守衛：對外 ifc-ready response 不含 presigned 簽章", () => {
  it("GET /api/external/ifc-ready 列表（含真實 presigned job）body 不含 X-Amz-Signature、含物件位址", async () => {
    const app = startPresignApp();
    await seedPresignedJob(app);
    const res = await request(app.app).get("/api/external/ifc-ready");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
    expect(res.body.items[0].source_ifc_ref).toBe(OBJECT_PATH);
  });

  it("GET /api/external/ifc-ready/:jobId（單筆）source_ifc_ref 被遮蔽", async () => {
    const app = startPresignApp();
    const jobId = await seedPresignedJob(app);
    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
    expect(res.body.source_ifc_ref).toBe(OBJECT_PATH);
  });

  it("GET /api/external/ifc-ready/:jobId/shadow 的 shadow_metadata.source_ifc_ref 被遮蔽", async () => {
    const app = startPresignApp();
    const jobId = await seedPresignedJob(app);
    const res = await request(app.app).get(`/api/external/ifc-ready/${jobId}/shadow`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
    expect(res.body.shadow_metadata.source_ifc_ref).toBe(OBJECT_PATH);
  });

  // POST /api/local-web-view/sessions 是 spec §2 列出的第四個瀏覽器可見出口
  // （app.ts artifact_resolution.source_ifc_ref）。fixture 預設 ref 不含簽章，
  // GET 路徑的測試無法守住此 POST：用真實 presigned job 直接打 POST，
  // 確保拔掉 maskPresignedRef 會被偵測到（regression guard）。
  it("POST /api/local-web-view/sessions 的 artifact_resolution.source_ifc_ref 被遮蔽", async () => {
    const app = startPresignApp();
    const jobId = await seedPresignedJob(app);
    const res = await request(app.app)
      .post("/api/local-web-view/sessions")
      .set({ Authorization: "Bearer dev_user_presign" })
      .send({ ifc_ready_job_id: jobId });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain("X-Amz-Signature");
    expect(res.body.artifact_resolution.source_ifc_ref).toBe(OBJECT_PATH);
  });
});
