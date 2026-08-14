import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { CallbackOutbox } from "../src/services/callbackOutbox.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { idempotencyKeyFor, type MinioWatcherStatus } from "../src/services/minioWatcher.js";

// review Important #2：production 接線整合測試。
//
// 既有測試的覆蓋缺口：
// - conversion-watch-toggle.test.ts 用 fake object store，驗啟停編排但不驗 isLedgered 邏輯。
// - minio-watch-surface.test.ts 直接建構 surface，繞過 app.ts 的 isLedgered closure
//   接線層，不驗 closure 是否指向正確的 conversionLedger 實例。
//
// 本檔走「真 listening server + 真 S3 stub + 真 ConversionLedger（落地檔）+ 真
// /api/external/ifc-ready route」的端到端路徑，精確鎖死「app.ts 的 isLedgered closure 確實
// 指向 production 的 conversionLedger 實例」這條接線。驅動方式：`app.minioWatchSurface.pollNow()`
// （@internal 測試 accessor）——pollNow resolve 時該輪 list／intake／counters 已全部落定，
// 斷言一律同步。舊版「ledger 落檔嚴格先於 triggered_total 遞增」的觀測競態（需輪詢計數器）
// 在 pollNow 介面下結構性不存在；production interval floor（10s）也不再需要 env 降檔 seam。
//
// 誠實註：S3 list 由本地 stub 提供（非真 MinIO），presign 由 SDK 本地簽不真打；intake 走
// coordinator 自身 /api/external/ifc-ready（真 route）但 IFC 下載以 fallback 樁化（見 config
// ifcDownloadStrict=false）。真 MinIO 連線端到端由 Task 7 gstack E2E 兜底。

interface S3Obj { key: string; etag: string; }

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
  if (s3Stub) {
    s3Stub.closeAllConnections?.();
    await new Promise<void>((r) => s3Stub?.close(() => r()));
    s3Stub = null;
  }
});

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
  if (!a || typeof a === "string") throw new Error("s3 stub bind");
  return `http://127.0.0.1:${a.port}`;
}

/** 真 listening server（觸發 server.on("listening") → surface.startIfEnabled 的 production 接線路徑）。 */
async function listenOnLoopback(app: CoordinatorApp): Promise<number> {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  const a = app.server.address();
  if (!a || typeof a === "string") throw new Error("coordinator bind");
  return a.port;
}

/** 經真 status route（production 回 surface.status()）讀 live watcher 狀態，不用 test seam。 */
async function fetchWatcherStatus(app: CoordinatorApp): Promise<Partial<MinioWatcherStatus>> {
  const res = await request(app.app).get("/api/external/minio-watch/status");
  return res.body as Partial<MinioWatcherStatus>;
}

describe("app.ts isLedgered 接線整合測試（review Important #2）", () => {
  function watchOverrides(s3Base: string, ledgerStorePath: string) {
    return {
      // 真 watcher 連線參數，指向本地 S3 stub。
      minioWatchEnabled: true,
      minioWatchEndpoint: s3Base,
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchKeySuffix: "/model.ifc",
      // production 預設 interval（floor 10s）即可：輪次由 pollNow 確定性驅動，不靠計時器。
      // selfBaseUrl 留空：走 production 預設（http://127.0.0.1:${實際 listen port}），
      // 由 server.on("listening") 路徑啟動 watcher（不是測試 seam 立即啟動路徑）。
      minioWatchSelfBaseUrl: "",
      // loopback 守衛 pass：watcher 自打 loopback intake，allowlist 含 127.0.0.1。
      externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
      externalIntakeWebhookSecret: "dev-webhook-secret",
      // 真 ConversionLedger 落地檔（production 由此 config 自建 ledger 實例）。
      conversionLedgerStorePath: ledgerStorePath,
      // intake 同步下載：strict=false（default）→ 下載失敗時樁化不真打外部 IFC。
      ifcDownloadStrict: false,
      conversionPollEnabled: false,
    };
  }

  it("ledger 無紀錄物件 → 首輪由 production 接線觸發 intake（closure 確指向真 conversionLedger，非靜默回落）", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-wiring-trigger-"));
    const ledgerStorePath = path.join(root, "conversion-ledger.json");
    const state: { objs: S3Obj[] } = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);

    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      ...watchOverrides(s3Base, ledgerStorePath),
    });
    await listenOnLoopback(active);

    // ledger 起手為空 → 首輪即把既有 model.ifc 當「無紀錄」auto-enroll 觸發。pollNow 排在
    // listening 觸發的首輪之後 → resolve 時 intake 已完成、ledger 已由 intake 側 pipeline 寫入、
    // watcher 計數器已遞增——以下全部同步斷言。
    await active.minioWatchSurface.pollNow();

    // 「ledger 出現該 idkey 紀錄」唯有當 watcher 的 isLedgered closure 與 intake 寫入打到
    // 「同一個」conversionLedger 實例時才成立（接線退化 → 靜默回落或無法 skip，此處會抓到）。
    const idkey = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    const persisted = new ConversionLedger(ledgerStorePath).get(idkey);
    expect(persisted).not.toBeNull();
    expect(persisted!.idempotency_key).toBe(idkey);
    expect(persisted!.project_id).toBe("899");
    // watcher status（經真 status route）反映確有觸發。
    const status = await fetchWatcherStatus(active);
    expect(status.triggered_total).toBeGreaterThanOrEqual(1);
  });

  it("ledger 已有紀錄物件 → 接線 skip 不重觸發（closure 讀真 ledger 命中；證非繞過 ledger 的盲觸發）", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-wiring-skip-"));
    const ledgerStorePath = path.join(root, "conversion-ledger.json");
    const state: { objs: S3Obj[] } = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);

    // 預先把該物件落帳進持久 ledger（模擬重啟前已轉檔 / 已 auto-enroll）。production 起手會
    // 從這個 store 路徑 load → isLedgered closure 對此 idkey 回 true。
    const idkey = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    const seedLedger = new ConversionLedger(ledgerStorePath);
    seedLedger.upsert(
      {
        idempotency_key: idkey,
        correlation_id: null,
        project_id: "899",
        project_display_name: "899",
        category: "main",
        external_model_version_id: "xxx",
        conversion_job_id: null,
        status: "queued",
      },
      new Date().toISOString(),
    );

    active = createCoordinatorApp({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      ...watchOverrides(s3Base, ledgerStorePath),
    });
    await listenOnLoopback(active);

    // 確定性跑 ≥2 輪（listening 首輪 + 兩次 pollNow），證 loop 活著且對該物件查過 ledger 多輪。
    await active.minioWatchSurface.pollNow();
    await active.minioWatchSurface.pollNow();
    const status = await fetchWatcherStatus(active);
    expect(status.poll_count ?? 0).toBeGreaterThanOrEqual(2);
    // ledger 命中 → 全程 skip：triggered_total 維持 0（若接線退化成繞過 ledger 盲觸發，這裡會 ≥1）。
    expect(status.triggered_total).toBe(0);
    expect(status.baseline_count).toBe(1); // 診斷欄位仍填（首輪 model.ifc 數）
  });

  it("#531 recreate 存活：同持久路徑重啟後 ledger/outbox state 存活、watcher 不重複觸發", async () => {
    // 模擬 compose 掛載卷：ledger 與 outbox 同落 <卷>/coordinator/（compose.runtime-manager.yml
    // 的 /workspace/storage/coordinator/ 佈局）；container recreate＝process 換代、檔案留存。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-wiring-recreate-"));
    const coordinatorStateDir = path.join(root, "coordinator");
    const ledgerStorePath = path.join(coordinatorStateDir, "conversion-ledger.json");
    const outboxStorePath = path.join(coordinatorStateDir, "callback-outbox.json");
    const state: { objs: S3Obj[] } = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const s3Base = await startS3Stub(state);
    const appOptions = () => ({
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: outboxStorePath,
      corsOrigins: ["http://127.0.0.1:5173"],
      ...watchOverrides(s3Base, ledgerStorePath),
    });

    // 第一世代：首輪 intake 觸發 → ledger 落帳到持久檔。
    active = createCoordinatorApp(appOptions());
    await listenOnLoopback(active);
    await active.minioWatchSurface.pollNow();
    const firstGen = await fetchWatcherStatus(active);
    expect(firstGen.triggered_total).toBeGreaterThanOrEqual(1);
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;

    // 世代之間 seed 一筆 pending callback（模擬 recreate 當下尚未投遞的 outbox state）。
    const seeded = new CallbackOutbox(5, async () => {}, outboxStorePath).enqueue({
      event: "conversion_failed",
      targetUrl: null,
      correlationId: "corr-531-recreate",
      externalModelVersionId: "xxx",
      conversionJobId: null,
      payload: { note: "pre-recreate pending callback" },
    });

    // 第二世代（recreate）：同持久路徑重建 app。
    active = createCoordinatorApp(appOptions());
    await listenOnLoopback(active);
    await active.minioWatchSurface.pollNow();

    // 冪等水位存活：同一物件不得重複觸發、ledger 不得長出重複紀錄。
    const secondGen = await fetchWatcherStatus(active);
    expect(secondGen.triggered_total).toBe(0);
    const idkey = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    const persisted = new ConversionLedger(ledgerStorePath);
    expect(persisted.get(idkey)).not.toBeNull();
    expect(persisted.list()).toHaveLength(1);

    // outbox state 存活：seed 的 pending entry 在新 process 經真 route 可見。
    const summary = await request(active.app).get("/api/callback-outbox/summary");
    expect(summary.status).toBe(200);
    const survivor = (summary.body.entries as Array<{ outbox_id: string; status: string }>).find(
      (entry) => entry.outbox_id === seeded.outbox_id,
    );
    expect(survivor).toBeDefined();
    expect(survivor!.status).toBe("pending");
  });
});
