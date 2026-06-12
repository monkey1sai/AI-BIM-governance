import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { startMinioWatcher, type MinioWatcherHandle } from "../src/services/minioWatcher.js";

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;
let watcher: MinioWatcherHandle | null = null;

afterEach(async () => {
  if (watcher) {
    await watcher.dispose();
    watcher = null;
  }
  if (active) {
    active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (s3Stub) {
    await new Promise<void>((r) => s3Stub?.close(() => r()));
    s3Stub = null;
  }
});

interface S3Obj { key: string; etag: string; }

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(state: { objs: S3Obj[] }): Promise<string> {
  s3Stub = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(state.objs));
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 bind");
  return `http://127.0.0.1:${a.port}`;
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("server bind");
  return a.port;
}

// 12s 上限（vitest testTimeout 為 20s）：full-suite 並行飽和事件迴圈時，watcher 的
// setTimeout tick 與 loopback intake fetch round-trip 可能被推遲；給足窗避免 false-negative。
async function waitFor(check: () => Promise<boolean> | boolean, ms = 12000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitFor timeout");
}

describe("minioWatcher → 真 coordinator intake 整合", () => {
  it("baseline 後新增物件 → watcher 自動建立 ifc-ready job（store 可見）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);

    // 真 coordinator：listen(0) → 取得實際 port。app 自帶 watcher 關閉（minioWatchEnabled:false），
    // 由本測試以 startMinioWatcher 直接構造一支 watcher 指向此 port 的 loopback intake。
    // 為何不走 app 自啟 watcher：production config 對 minioWatchIntervalSeconds 設下限 10s
    // （config.ts 防忙迴圈夾值，即使 override 也夾），會讓 intake 鏈在測試窗內等不到第二輪 tick。
    // 直接構造同一支 startMinioWatcher（app.ts 掛載的也是它）可用 0.05s tick 快速驗
    // 「watcher loop → 真 intake → 真 store」鏈，不觸碰 production config；app 自啟與
    // status route 由 minio-watch-status-route.test.ts 覆蓋。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-intake-self-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      // streaming 不可達 → dispatch_failed，但 intake job 仍建立（驗 intake 鏈足夠）
      streamingConversionApiBase: "http://127.0.0.1:1",
      // non-strict：watcher 的 presigned ref 指向 s3 stub（GET 會失敗，但本測試只驗 intake 進 store）
      ifcDownloadStrict: false,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      minioWatchEnabled: false,
    });
    const port = await listenOnRandomPort(active.server);

    watcher = startMinioWatcher({
      endpoint: s3Base,
      bucket: "bim-control",
      prefix: "",
      accessKey: "ak",
      secretKey: "sk",
      keySuffix: "/model.ifc",
      // 0.2s tick：bypass config 10s 下限保持整合測試快；不取更小（如 50ms）是因為
      // full-suite 並行飽和時，過密 tick 會堆疊重疊的 setTimeout callback 加劇事件迴圈
      // 飢餓，反而讓 watcher 觸發更晚。0.2s 在 isolation 仍 <1s 完成。
      intervalSeconds: 0.2,
      selfBaseUrl: `http://127.0.0.1:${port}`, // 指向真 coordinator loopback intake
      webhookSecret: "dev-webhook-secret",
      tenantId: "tenant_demo_001",
      structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
    });

    // 等 baseline 完成（首輪只登 baseline 不觸發）
    await waitFor(() => watcher!.getStatus().baseline_count === 1);

    // 新增物件 → watcher 下一輪觸發 intake（真 coordinator 真 store）
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });

    // job 進 store：GET /api/external/ifc-ready 出現 project_id=988
    await waitFor(async () => {
      const r = await request(active!.app).get("/api/external/ifc-ready?limit=50");
      return (r.body.items as Array<{ project_id: string }>).some((j) => j.project_id === "988");
    });

    const list = await request(active!.app).get("/api/external/ifc-ready?limit=50");
    const job = (list.body.items as Array<{ project_id: string; external_model_version_id: string }>).find(
      (j) => j.project_id === "988",
    );
    expect(job).toBeTruthy();
    expect(job!.external_model_version_id).toBe("zzz");
    expect(port).toBeGreaterThan(0);

    // triggered_total 必須用 waitFor 而非同步斷言：coordinator 在 store.create 之後、
    // fetch 回應之前即把 job 寫入 store，故上面「job 進 store」可能先於 watcher 的
    // triggerIntake() await fetch 完成後才執行的 triggered_total += 1。同步讀會偶發見 0。
    await waitFor(() => watcher!.getStatus().triggered_total === 1);
  });

  it("同物件再觸發（模擬重啟重掃）→ idempotent_replay，不建第二筆 job", async () => {
    // 直接對 intake POST 兩次同 idempotency key（等價 watcher 重啟後重掃同物件）
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-idem-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      streamingConversionApiBase: "http://127.0.0.1:1",
      ifcDownloadStrict: false,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      minioWatchEnabled: false, // 本 case 不用 watcher loop，直接驗 intake 去重
    });

    // 用與 watcher 相同的確定性 idempotency key（mw_<hash16>）POST 兩次
    const { idempotencyKeyFor, correlationIdFor } = await import("../src/services/minioWatcher.js");
    const idem = idempotencyKeyFor("bim-control", "899/xxx/model.ifc", "e1");
    const corr = correlationIdFor("bim-control", "899/xxx/model.ifc", "e1");
    const body = {
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "899",
      external_model_version_id: "xxx",
      source_ifc: { ref: "http://127.0.0.1:1/x.ifc", etag: "e1", filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc"],
    };
    const headers = { "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": corr, "X-Idempotency-Key": idem };

    const first = await request(active.app).post("/api/external/ifc-ready").set(headers).send(body);
    expect(first.status).toBe(202);
    const firstJobId = first.body.ifc_ready_job_id as string;

    const second = await request(active.app).post("/api/external/ifc-ready").set(headers).send(body);
    expect([200, 202]).toContain(second.status);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.ifc_ready_job_id).toBe(firstJobId); // 同一 job，不新建
  });
});
