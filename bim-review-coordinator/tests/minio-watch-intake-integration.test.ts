import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { idempotencyKeyFor, correlationIdFor, type MinioWatcherStatus } from "../src/services/minioWatcher.js";
import {
  createMinioWatchSurface,
  type MinioWatchSurface,
} from "../src/services/minioWatchSurface.js";

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;
let watchSurface: MinioWatchSurface | null = null;

afterEach(async () => {
  if (watchSurface) {
    await watchSurface.dispose();
    watchSurface = null;
  }
  if (active) {
    // dispose() 回 Promise（內部 await watch surface 的 in-flight tick settle 後才 destroy
    // object store）；fire-and-forget 會在特定負載下於 server.close() 之前非同步嘗試
    // destroy → unhandled rejection / 競態。對齊 auto-poll-conversion.test.ts 的 await。
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (s3Stub) {
    // surface 以 keep-alive 對 s3Stub 發 ListObjectsV2；dispose 後 socket pool 內仍可能
    // 殘留 keep-alive 連線。先強制斷連再 close，避免 afterEach 卡到 hook timeout。
    s3Stub.closeAllConnections?.();
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

describe("MinioWatchSurface → 真 coordinator intake 整合", () => {
  it("ledger 去重模式：新增（未入帳）物件 → watcher 自動建立 ifc-ready job（store 可見）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);

    // 真 coordinator：listen(0) → 取得實際 port。app 自帶 watcher 關閉（minioWatchEnabled:false），
    // 本測試直接構造 MinioWatchSurface（app.ts 掛載的同一個 deep module）指向此 port 的
    // loopback intake，用 pollNow() 確定性驅動——不依賴計時器，也不受 production config
    // 對 intervalSeconds 的 10s 下限影響。app 自啟與 status route 由
    // minio-watch-status-route.test.ts / minio-watch-ledger-wiring.test.ts 覆蓋。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-intake-self-"));
    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      // streaming 不可達 → dispatch_failed，但 intake job 仍建立（驗 intake 鏈足夠）
      streamingConversionApiBase: "http://127.0.0.1:1",
      // non-strict：surface 的 presigned ref 指向 s3Stub；s3Stub 對 GET 亦回 200 XML（bytes 非真實
      // IFC），下載可完成 → download_status 抵達 downloaded。
      ifcDownloadStrict: false,
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "storage"),
      minioWatchEnabled: false,
    });
    const port = await listenOnRandomPort(active.server);

    // §3.4 production ledger-dedup 路徑：注入 isLedgered 模擬「初始 899 先前已轉檔入帳、
    // 新增的 988 為未入帳新上傳」。首輪 899 命中 ledger→skip；後續輪新增 988→觸發。
    const ledgered899 = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");

    watchSurface = createMinioWatchSurface({
      config: {
        enabled: true,
        endpoint: s3Base,
        bucket: "bim-control",
        prefix: "",
        accessKey: "ak",
        secretKey: "sk",
        keySuffix: "/model.ifc",
        intervalSeconds: 3600, // 測試窗內只有 pollNow 驅動的輪
        selfBaseUrl: `http://127.0.0.1:${port}`, // 指向真 coordinator loopback intake
        tenantId: "tenant_demo_001",
      },
      webhookSecret: "dev-webhook-secret",
      isLedgered: (idkey) => idkey === ledgered899,
      resolveSelfBaseUrl: () => `http://127.0.0.1:${port}`,
      assertIntakeReachable: () => {},
      // 不注入 objectStoreFactory → 走真 S3 adapter（真 SDK list + 真 presign 簽章），
      // 端到端覆蓋「presigned ref → intake → 真下載」鏈。
      structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) },
    });
    watchSurface.startIfEnabled();

    // 首輪（899 ledger 命中 skip）＋確認輪皆落定。
    await watchSurface.pollNow();
    const statusAfterBaseline = watchSurface.status() as MinioWatcherStatus;
    expect(statusAfterBaseline.baseline_count).toBe(1);

    // 新增物件 → 下一輪觸發 intake（真 coordinator 真 store）。pollNow resolve 時 intake
    // 回應已解析完畢——而 intake route 在回應前完成同步下載，故 download_status 已達終態。
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    const summary = await watchSurface.pollNow();
    expect(summary.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("triggered");

    interface IfcReadyListJob {
      project_id: string;
      external_model_version_id: string;
      download_status: string | null;
      source_ifc_ref: string | null;
      source_ifc_etag: string | null;
    }
    const list = await request(active.app).get("/api/external/ifc-ready?limit=50");
    const job = (list.body.items as IfcReadyListJob[]).find((j) => j.project_id === "988");
    expect(job).toBeTruthy();
    expect(job!.external_model_version_id).toBe("zzz");
    expect(job!.download_status).toBe("downloaded");
    // 對外 API（summarizeIfcReadyJob）已套 maskPresignedRef（P0 誠實守衛）：
    // 瀏覽器可見出口不得外洩 SigV4 簽章；仍須含物件位址，證 surface 正確自 key 推導 ref
    // 並端到端透傳到 store。
    expect(job!.source_ifc_ref).not.toMatch(/X-Amz-Signature=/);
    expect(job!.source_ifc_ref).toContain("988/main/zzz/model.ifc");
    // etag 由 surface 自 ListObjectsV2 帶入並落到 store（端到端透傳，非預設值）。
    expect(job!.source_ifc_etag).toBe("e9");

    // watcher 端 last_triggered 記錄此 key 成功（job_id 有值、error 為 null）。pollNow 後
    // counters 已落定——同步斷言（舊檔在此需要三段 waitFor 的競態類別已不存在）。
    const st = watchSurface.status() as MinioWatcherStatus;
    expect(st.triggered_total).toBe(1);
    const triggered = st.last_triggered.find((t) => t.key === "988/main/zzz/model.ifc");
    expect(triggered).toBeTruthy();
    expect(triggered!.error).toBeNull();
    expect(triggered!.job_id).toBeTruthy();
  });

  it("同物件再觸發（模擬重啟重掃）→ idempotent_replay，不建第二筆 job", async () => {
    // 直接對 intake POST 兩次同 idempotency key（等價 watcher 重啟後重掃同物件）。
    // 不啟 S3 stub：本 case 不跑 watcher loop（minioWatchEnabled:false），source_ifc.ref 直接硬編
    // http://127.0.0.1:1/x.ifc，不經 ListObjectsV2／presigned GET。
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
    expect(firstJobId).toBeTruthy();

    const second = await request(active.app).post("/api/external/ifc-ready").set(headers).send(body);
    expect([200, 202]).toContain(second.status);
    expect(second.body.idempotent_replay).toBe(true);
    expect(second.body.ifc_ready_job_id).toBe(firstJobId); // 同一 job，不新建
  });
});
