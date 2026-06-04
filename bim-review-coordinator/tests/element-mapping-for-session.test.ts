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
// 瀏覽器只持有 session_id（守邊界:viewer 不直連 :49101）；coordinator 解析該 session
// artifact binding 的 mapping_url，取 path 後經 conversionApiBase server-side 抓取原樣回傳。
// 誠實:sessionId 非法 → 400；session/mapping 無法解析 → 404；conversion 不可達 → 502。

const MAPPING_DOC = {
  mock: false,
  mapping_fidelity: "sidecar_ordinal",
  summary: { mapped_count: 2, fake_mapping_count: 0 },
  items: [
    { ifc_guid: "0BZIXiwbv8_vlULWlwQSKx", usd_prim_path: "/model/a/Mesh", ifc_type: "IfcDoor" },
    { ifc_guid: "3$xKPHQlD10AG1nzmJabuU", usd_prim_path: "/model/b/Mesh", ifc_type: "IfcDoor" },
  ],
};

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

/** conversion artifact stub：在 element_mapping path 上回 MAPPING_DOC。 */
async function startConversionStub(): Promise<{ base: string; mappingUrl: string }> {
  const mappingPath = "/artifacts/stream_conv_demo/element_mapping.json";
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === mappingPath) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MAPPING_DOC));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  // mapping_url 用一個與 conversionApiBase 不同的 host，驗證 route 只取 path 後改打 conversionApiBase。
  return { base, mappingUrl: `http://artifact-host.invalid:49101${mappingPath}` };
}

async function createSessionWithMapping(app: CoordinatorApp, mappingUrl: string): Promise<string> {
  const created = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: "project_demo_001",
      model_version_id: "version_demo_001",
      artifact_bindings: [
        {
          artifact_group_id: "ag_demo",
          artifact_id: "artifact_usdc_demo",
          artifact_role: "derived",
          url: "http://artifact-host.invalid:49101/artifacts/stream_conv_demo/model.usdc",
          mapping_url: mappingUrl,
          load_order: 0,
          ready_status: "ready",
        },
      ],
    });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}

describe("GET /api/governance/element-mapping/for-session/:sessionId", () => {
  it("解析 session 的 mapping_url 並經 conversionApiBase 取回原樣 element_mapping JSON", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const sessionId = await createSessionWithMapping(app, stub.mappingUrl);

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.mock).toBe(false);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].usd_prim_path).toBe("/model/a/Mesh");
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

  it("session 存在但 artifact binding 無 mapping_url → 404", async () => {
    const stub = await startConversionStub();
    const app = makeApp({ conversionApiBase: stub.base });
    const created = await request(app.app)
      .post("/api/review-sessions")
      .send({
        project_id: "project_demo_001",
        model_version_id: "version_demo_001",
        artifact_bindings: [
          {
            artifact_group_id: "ag_demo",
            artifact_id: "artifact_usdc_demo",
            artifact_role: "derived",
            url: "http://artifact-host.invalid:49101/artifacts/stream_conv_demo/model.usdc",
            load_order: 0,
            ready_status: "ready",
          },
        ],
      });
    expect(created.status).toBe(200);
    const sessionId = created.body.session_id as string;

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(404);
  });

  it("非法 session id 格式 → 400", async () => {
    const app = makeApp();
    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/..%2Fetc`);
    expect(res.status).toBe(400);
  });

  it("conversion artifact 服務不可達 → 502（誠實，不偽造空對映）", async () => {
    // 指向沒有監聽的 port。
    const app = makeApp({ conversionApiBase: "http://127.0.0.1:1" });
    const sessionId = await createSessionWithMapping(
      app,
      "http://artifact-host.invalid:49101/artifacts/stream_conv_demo/element_mapping.json",
    );

    const res = await request(app.app).get(`/api/governance/element-mapping/for-session/${sessionId}`);

    expect(res.status).toBe(502);
  });
});
