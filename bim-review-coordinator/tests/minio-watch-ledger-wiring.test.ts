import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { idempotencyKeyFor, type MinioWatcherStatus } from "../src/services/minioWatcher.js";

// review Important #2：production 接線整合測試。
//
// 既有測試的覆蓋缺口：
// - conversion-watch-toggle.test.ts 用 selfBaseUrl="http://127.0.0.1:1"，watcher 啟動但
//   所有 intake 因連不上 port 1 而 fail，只驗 status.enabled=true，無法驗 isLedgered 邏輯。
// - minio-watcher-loop.test.ts 直接 startMinioWatcher，繞過 app.ts 的 isLedgered closure
//   接線層，不驗 closure 是否指向正確的 conversionLedger 實例。
//
// 本檔走「真 listening server + 真 S3 stub + 真 ConversionLedger（落地檔）+ 真
// /api/external/ifc-ready route」的端到端路徑，精確鎖死「app.ts 的 isLedgered closure 確實
// 指向 production 的 conversionLedger 實例」這條接線。風險：若接線退化（closure 傳 undefined
// 而非指向真 ledger、或指錯 ledger 實例），watcher 會靜默回落或無法 skip 已落帳物件，但
// route 層 status 測試仍全綠——本檔以「首輪觸發 ledger 無紀錄物件、ledger 落帳後下輪 skip」
// 的可觀察行為作偵測。
//
// 誠實註：S3 list 由本地 stub 提供（非真 MinIO），presign 由 SDK 本地簽不真打；intake 走
// coordinator 自身 /api/external/ifc-ready（真 route）但 IFC 下載以 fallback 樁化（見 config
// ifcDownloadStrict=false）。真 MinIO 連線端到端由 Task 7 gstack E2E 兜底。

interface S3Obj { key: string; etag: string; }

let active: CoordinatorApp | null = null;
let s3Stub: http.Server | null = null;

// production 對 minioWatchIntervalSeconds 有硬下限（loadConfig default floor=10s，防忙迴圈連打
// MinIO），唯一降檔入口為 MINIO_WATCH_INTERVAL_FLOOR_SECONDS（設計給 E2E spawn coordinator 用）。
// 本檔走完整 app config 路徑（非 minio-watcher-loop.test.ts 的直接 startMinioWatcher），故須用此
// 既有降檔 seam 把 floor 降到 1s，watcher 才會每秒 tick 讓「跑過多輪仍 skip」可在合理 timeout 觀察。
let savedFloorEnv: string | undefined;
beforeEach(() => {
  savedFloorEnv = process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS;
  process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = "1";
});

afterEach(async () => {
  if (savedFloorEnv === undefined) delete process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS;
  else process.env.MINIO_WATCH_INTERVAL_FLOOR_SECONDS = savedFloorEnv;
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

async function waitFor(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

/** 真 listening server（觸發 server.on("listening") → startMinioWatcherIfEnabled 的 production 接線路徑）。 */
async function listenOnLoopback(app: CoordinatorApp): Promise<number> {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  const a = app.server.address();
  if (!a || typeof a === "string") throw new Error("coordinator bind");
  return a.port;
}

/** 經真 status route（production 回 minioWatcher.getStatus()）讀 live watcher 狀態，不用 test seam。 */
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
      // 1s tick：受 loadConfig floor 夾值（beforeEach 已把 MINIO_WATCH_INTERVAL_FLOOR_SECONDS 降到 1）。
      minioWatchIntervalSeconds: 1,
      // selfBaseUrl 留空：走 production 預設（http://127.0.0.1:${實際 listen port}），
      // 由 server.on("listening") 路徑啟動 watcher（不是測試 seam 立即啟動路徑）。
      minioWatchSelfBaseUrl: "",
      // loopback 守衛 pass：watcher 自打 loopback intake，allowlist 含 127.0.0.1。
      externalIntakeIpAllowlist: ["127.0.0.1", "::1"],
      externalIntakeWebhookSecret: "dev-webhook-secret",
      // 真 ConversionLedger 落地檔（production 由此 config 自建 ledger 實例）。
      conversionLedgerStorePath: ledgerStorePath,
      // intake 同步下載：strict=false（default）→ fallbackOnFetchError=!strict=true，下載失敗時
      // 樁化不真打外部 IFC（測試聚焦接線，非真實下載）。
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

    // ledger 起手為空 → 首輪即把既有 model.ifc 當「無紀錄」auto-enroll 觸發（移除 baseline 特例）。
    // intake 成功會把 mw_<hash16> upsert 進真 ledger，故以「ledger 出現該 idkey 紀錄」作可觀察證據——
    // 這唯有當 watcher 的 isLedgered closure 與 intake 寫入打到「同一個」conversionLedger 實例時才成立。
    const idkey = idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1");
    await waitFor(() => {
      const ledger = new ConversionLedger(ledgerStorePath);
      return ledger.get(idkey) !== null;
    });

    const persisted = new ConversionLedger(ledgerStorePath).get(idkey);
    expect(persisted).not.toBeNull();
    expect(persisted!.idempotency_key).toBe(idkey);
    expect(persisted!.project_id).toBe("899");
    // watcher status（經真 status route）反映確有觸發（triggered_total≥1，非 legacy baseline 吸收的 0）。
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

    // 等 watcher 確實跑過至少 2 輪 tick（poll_count≥2），證明 loop 活著且已對該物件查過 ledger 多輪。
    // 1s tick → 給足 8s（首輪 setTimeout(0)、次輪 ~1s 後）。
    await waitFor(async () => ((await fetchWatcherStatus(active!)).poll_count ?? 0) >= 2, 8000);
    // ledger 命中 → 全程 skip：triggered_total 維持 0（若接線退化成繞過 ledger 盲觸發，這裡會 ≥1）。
    const status = await fetchWatcherStatus(active);
    expect(status.triggered_total).toBe(0);
    expect(status.baseline_count).toBe(1); // 診斷欄位仍填（首輪 model.ifc 數）
  });
});
