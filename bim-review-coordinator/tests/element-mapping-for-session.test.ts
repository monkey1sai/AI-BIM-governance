import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// console-mapping-proxy:`GET /api/governance/element-mapping/for-session/:sessionId`。
// 瀏覽器只持有 session_id（守邊界:viewer 不直連 :49101）；coordinator 以 session artifact
// binding 的 mapping_url 為白名單，取 path 後經 conversionApiBase server-side 抓取原樣回傳。
// 多 binding 由 viewer 以 ?url= 指定（防選錯 + 防任意 URL SSRF）。誠實:非法 400 / 解析失敗
// 404 / conversion 不可達 502。

let active: CoordinatorApp | null = null;
const activeServers: http.Server[] = [];

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  for (const s of activeServers.splice(0)) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-mapping-proxy-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    storageRoot: path.join(root, "storage"),
    storageHostRoot: path.join(root, "storage"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

/**
 * conversion artifact stub：對任何 `/artifacts/<jobId>/element_mapping.json` 回 element_mapping，
 * 並把 jobId 編入 usd_prim_path 供 assert 究竟回了哪一個 binding 的 mapping。
 */
async function startConversionStub(): Promise<{ base: string; mappingUrlFor: (jobId: string) => string }> {
  const server = http.createServer((req, res) => {
    const match = req.method === "GET" && /^\/artifacts\/([^/]+)\/element_mapping\.json$/.exec(req.url ?? "");
    if (match) {
      const jobId = match[1];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          mock: false,
          mapping_fidelity: "sidecar_ordinal",
          summary: { mapped_count: 1, fake_mapping_count: 0 },
          items: [{ ifc_guid: "0BZIXiwbv8_vlULWlwQSKx", usd_prim_path: `/model/${jobId}/Mesh`, ifc_type: "IfcDoor" }],
        }),
      );
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  // mapping_url 用與 conversionApiBase 不同的 host，驗證 route 只取 path 後改打 conversionApiBase。
  return {
    base: `http://127.0.0.1:${address.port}`,
    mappingUrlFor: (jobId: string) => `http://artifact-host.invalid:49101/artifacts/${jobId}/element_mapping.json`,
  };
}

async function createSession(app: CoordinatorApp, mappingUrls: Array<string | null>): Promise<string> {
  const created = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: "project_demo_001",
      model_version_id: "version_demo_001",
      artifact_bindings: mappingUrls.map((mappingUrl, index) => ({
        artifact_group_id: "ag_demo",
        artifact_id: `artifact_usdc_demo_${index}`,
        artifact_role: "derived",
        url: `http://artifact-host.invalid:49101/artifacts/job_${index}/model.usdc`,
        mapping_url: mappingUrl,
        load_order: index,
        ready_status: "ready",
      })),
    });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}

describe("GET /api/governance/element-mapping/for-session/:sessionId", () => {
  it("無 ?url：解析第一個 binding 的 mapping_url，經 conversionApiBase 取回原樣 element_mapping", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const sessionId = await createSession(app, [stub.mappingUrlFor("job_primary")]);

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(false);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].usd_prim_path).toBe("/model/job_primary/Mesh");
  });

  it("?url 指定 session 綁定的第二個 binding → 回該 binding 的 mapping（多 binding 選對）", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const first = stub.mappingUrlFor("job_first");
    const second = stub.mappingUrlFor("job_second");
    const sessionId = await createSession(app, [first, second]);

    const res = await request(app.app)
      .get(`/api/governance/element-mapping/for-session/${sessionId}`)
      .query({ url: second });

    expect(res.status).toBe(200);
    expect(res.body.items[0].usd_prim_path).toBe("/model/job_second/Mesh");
  });

  it("?url 非 session 綁定 → 404（白名單，不 proxy 任意 URL）", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const sessionId = await createSession(app, [stub.mappingUrlFor("job_bound")]);

    const res = await request(app.app)
      .get(`/api/governance/element-mapping/for-session/${sessionId}`)
      .query({ url: "http://evil.example/artifacts/attacker/element_mapping.json" });

    expect(res.status).toBe(404);
  });

  it("?url 為 protocol-relative（//host/..）→ 不在白名單 → 404（防 SSRF）", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const sessionId = await createSession(app, [stub.mappingUrlFor("job_bound")]);

    const res = await request(app.app)
      .get(`/api/governance/element-mapping/for-session/${sessionId}`)
      .query({ url: "//evil.example/artifacts/attacker/element_mapping.json" });

    expect(res.status).toBe(404);
  });

  it("session 不存在 → 404", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });

    const res = await request(app.app).get(
      `/api/governance/element-mapping/for-session/review_session_does_not_exist`,
    );

    expect(res.status).toBe(404);
    expect(typeof res.body.detail).toBe("string");
  });

  it("session 存在但所有 artifact binding 皆無 mapping_url → 404", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const sessionId = await createSession(app, [null]);

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(404);
  });

  it("非法 session id 格式 → 400", async () => {
    const app = makeApp();
    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/..%2Fetc`);
    expect(res.status).toBe(400);
  });

  it("conversion artifact 服務不可達 → 502（誠實，不偽造空對映）", async () => {
    const app = makeApp({ conversionApiBase: "http://127.0.0.1:1" });
    const sessionId = await createSession(app, [
      "http://artifact-host.invalid:49101/artifacts/job_x/element_mapping.json",
    ]);

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(502);
  });
});
