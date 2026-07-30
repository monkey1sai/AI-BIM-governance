import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { createLogger, type StructLogger } from "../src/lib/structLog.js";
import { ConversionDispatchQueue } from "../src/services/conversionDispatchQueue.js";
import { createFakeObjectStore, type FakeObjectStore } from "./helpers/fakeObjectStore.js";

// IX-CV-04 Task 2.3b：spec §6.1 三條具名必要測試需在「無真 MinIO」下觀察 watcher 啟停。
// 舊版以 vi.mock 把整個 minioWatcher 模組換成 fake handle；MinioWatchSurface 深化後改走
// ObjectStorePort seam——啟停編排（busy 鎖、422 未配置、500 回滾、no-op 區分、audit）全部
// 經「真 surface」執行，只有 S3 存取換成 in-memory fake（tests/helpers/fakeObjectStore.ts）。
// 冷啟次數 = objectStoreFactory 呼叫數；停止 = fake store 的 destroyCalls。
// 誠實註：真 MinIO 連線端到端由 Task 7 gstack E2E 兜底；真 SDK list/presign 由
// minio-object-store.test.ts 覆蓋。
const createdStores: FakeObjectStore[] = [];
const storeFactory = vi.fn(() => {
  const store = createFakeObjectStore();
  createdStores.push(store);
  return store;
});
function resetStoreFactory(): void {
  storeFactory.mockClear();
  storeFactory.mockImplementation(() => {
    const store = createFakeObjectStore();
    createdStores.push(store);
    return store;
  });
  createdStores.length = 0;
}
function totalDestroyCalls(): number {
  return createdStores.reduce((sum, s) => sum + s.destroyCalls, 0);
}

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
});
function makeApp(overrides = {}, structLog?: StructLogger): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-toggle-test-"));
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      corsOrigins: ["http://127.0.0.1:5173"],
      conversionPollEnabled: false,
      ...overrides,
    },
    { minioWatchObjectStoreFactory: storeFactory, ...(structLog ? { structLog } : {}) },
  );
  return active;
}

/** 讀 audit-capable logger 寫出的 jsonl,回 event_type=audit 的 record 陣列（沿用 conversion-control-routes.test.ts）。 */
function readAuditRecords(logger: StructLogger): Array<Record<string, unknown>> {
  const text = fs.readFileSync(logger.currentFile(), "utf-8").trim();
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((rec) => rec.event_type === "audit");
}

// IX-CV-04：GET status 讀 runtime flag（初值 = env opt-in，之後可被 PUT /api/conversion/watch
// 覆寫）。此處鎖定 status 路由「讀 runtime flag 初值」這條回歸基線。
describe("GET /api/external/minio-watch/status — runtime flag 初值（IX-CV-04 回歸鎖）", () => {
  beforeEach(resetStoreFactory);

  it("env 未 opt-in（預設）→ runtime flag 初值=false → status enabled=false", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it("env opt-in（MINIO_WATCH_ENABLED=true）→ runtime flag 初值=true → status enabled=true", async () => {
    const app = makeApp({
      minioWatchEnabled: true,
      minioWatchEndpoint: "http://127.0.0.1:1",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchIntervalSeconds: 10,
      // 測試 seam：selfBaseUrl 設 loopback；fake store 空 bucket，tick 不打任何網路
      minioWatchSelfBaseUrl: "http://127.0.0.1:1",
      // loopback 守衛 pass path：allowlist 非空但含 127.0.0.1 → 不 fail-fast
      externalIntakeIpAllowlist: ["10.0.0.0/8", "127.0.0.1"],
    });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    // status 讀 runtime flag、不讀 config 靜態值；credentials 不得洩漏
    expect(res.body.secret_key).toBeUndefined();
    expect(res.body.access_key).toBeUndefined();
  });
});

// IX-CV-04 Task 3：GET status note 誠實區分「runtime 被關」vs「env 未開」。
describe("GET /api/external/minio-watch/status — note 誠實區分（IX-CV-04 Task 3）", () => {
  beforeEach(resetStoreFactory);

  function configuredOverrides() {
    return {
      minioWatchEndpoint: "http://127.0.0.1:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchSelfBaseUrl: "", // 不觸發 config-immediate 真啟動
    };
  }

  it("env=true 但 runtime 關閉 → GET status note 區分『operator 關閉』", async () => {
    const app = makeApp({ ...configuredOverrides(), minioWatchEnabled: true });
    await request(app.app).put("/api/conversion/watch").send({ enabled: false });
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.body.enabled).toBe(false);
    expect(String(res.body.note)).toContain("console 關閉");
  });

  it("關閉態 payload 形狀回歸：含 bucket/prefix/interval_seconds/note（不洩漏 credentials）", async () => {
    const app = makeApp();
    const res = await request(app.app).get("/api/external/minio-watch/status");
    expect(res.body).toHaveProperty("bucket");
    expect(res.body).toHaveProperty("prefix");
    expect(res.body).toHaveProperty("interval_seconds");
    expect(res.body).toHaveProperty("note");
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });
});

describe("PUT /api/conversion/watch — toggle 行為", () => {
  beforeEach(resetStoreFactory);

  function configuredOverrides() {
    return {
      minioWatchEndpoint: "http://127.0.0.1:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchSelfBaseUrl: "", // 不觸發 config-immediate 真啟動，避免測試連真 MinIO
    };
  }

  it("body 缺 boolean enabled → 400", async () => {
    const app = makeApp(configuredOverrides());
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: "yes" });
    expect(res.status).toBe(400);
  });

  it("enabled:true 但未配置 MinIO 連線 → 422 誠實拒絕", async () => {
    const app = makeApp(); // 無連線參數
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(res.status).toBe(422);
    expect(String(res.body.detail)).toContain("not configured");
  });

  // review Important #2：422 早返後 busy 鎖必釋放（surface setEnabled 的 finally 保證）。
  // 只斷言 422 本身無法偵測鎖洩漏退化；422 後立刻再打一筆 PUT，斷言它不是 409。
  it("422 後 busy 鎖必釋放：下一筆 PUT 不得 409", async () => {
    const app = makeApp(); // 無連線參數 → enabled:true 走 422
    const first = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(first.status).toBe(422);
    const second = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(second.status).not.toBe(409);
    expect(second.status).toBe(422); // 仍未配置 → 再次誠實 422，證明鎖已釋放、請求被正常處理
  });

  it("caller ip 不在 allowlist → 403", async () => {
    const app = makeApp({ ...configuredOverrides(), externalIntakeIpAllowlist: ["10.0.0.1"] });
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: false });
    expect(res.status).toBe(403);
  });

  it("enabled:false 對無 watcher → 200 no-op，GET status enabled=false", async () => {
    const app = makeApp(configuredOverrides());
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: false, reason: "smoke" });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(false);
  });

  // CR-B busy 鎖回歸鎖：spec §6.1「dispose 延遲時並發 PUT 第二筆 409」。先 enable 建一個
  // 真 run，把 fake store 的 destroy 延遲 50ms 撐開鎖窗口，並發送兩筆 enabled:false：
  // 第一筆進入 dispose await 期間 busy 仍為 true，第二筆撞鎖 → 409。
  it("並發 toggle：busy 鎖期間第二筆 → 409（dispose 延遲撐開鎖窗口）", async () => {
    // 非空 selfBaseUrl：讓 enabled:true 走完整冷啟路徑，建立可被 dispose 的真 run
    const app = makeApp({ ...configuredOverrides(), minioWatchSelfBaseUrl: "http://127.0.0.1:8004" });
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);
    expect(createdStores.length).toBe(1);
    createdStores[0].destroyDelayMs = 50; // dispose 延遲：撐開 busy 鎖窗口
    const [a, b] = await Promise.all([
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
    ]);
    const codes = [a.status, b.status];
    // 一筆 200（拿到鎖、跑 dispose）、一筆 409（鎖期間被拒）——精確證偽 CR-B 鎖回歸
    expect(codes).toContain(200);
    expect(codes).toContain(409);
  });
});

// IX-CV-04 spec §6.1：watcher 啟停可觀察行為（spec 點名必要）。fake object store 讓啟動
// 路徑完整可達而不碰網路；selfBaseUrl 給非空值讓冷啟路徑立即可走。
describe("PUT /api/conversion/watch — watcher 啟停可觀察行為（spec §6.1）", () => {
  function configuredStartOverrides() {
    return {
      minioWatchEndpoint: "http://127.0.0.1:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      // 非空 selfBaseUrl：讓 enable 路徑可達（fake store 空 bucket，不連網路，安全）
      minioWatchSelfBaseUrl: "http://127.0.0.1:8004",
    };
  }
  beforeEach(resetStoreFactory);

  it("(a) enabled:false 對啟用中 watcher → object store destroy 被呼叫 + status enabled→false", async () => {
    const app = makeApp(configuredStartOverrides());
    const on = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(on.status).toBe(200);
    expect(storeFactory).toHaveBeenCalledTimes(1);

    const off = await request(app.app).put("/api/conversion/watch").send({ enabled: false });
    expect(off.status).toBe(200);
    expect(totalDestroyCalls()).toBe(1);
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(false);
  });

  it("(b) enabled:true 對已配置關閉態 → 冷啟一次 + GET status 回 running 投影（enabled:true、poll_count 反映真 tick）", async () => {
    const app = makeApp(configuredStartOverrides());
    const on = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(on.status).toBe(200);
    expect(storeFactory).toHaveBeenCalledTimes(1);

    // pollNow 確定性收斂首輪（fake store 空 bucket，tick 純 list）後讀 status。
    await app.minioWatchSurface.pollNow();
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(true);
    expect(status.body.poll_count).toBeGreaterThanOrEqual(1); // 真 tick 推進
  });

  it("(c) off→on 往返一輪 → 狀態一致、無雙 watcher", async () => {
    const app = makeApp(configuredStartOverrides());
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: false })).status).toBe(200);
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);

    // 每次開啟各一次冷啟（共 2）、唯一一次關閉一次 destroy（共 1）、無殘留雙 run
    expect(storeFactory).toHaveBeenCalledTimes(2);
    expect(totalDestroyCalls()).toBe(1);
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(true);
  });

  it("shutdown 先等待 watcher intake settle，再 drain conversion pipeline", async () => {
    const order: string[] = [];
    storeFactory.mockImplementationOnce(() => {
      const store = createFakeObjectStore();
      const originalDestroy = store.destroy.bind(store);
      store.destroy = async () => {
        order.push("watcher");
        await originalDestroy();
      };
      createdStores.push(store);
      return store;
    });
    const drainSpy = vi
      .spyOn(ConversionDispatchQueue.prototype, "drain")
      .mockImplementation(() => {
        order.push("pipeline");
        return [];
      });
    const app = makeApp({
      ...configuredStartOverrides(),
      minioWatchEnabled: true,
      externalIntakeIpAllowlist: ["127.0.0.1"],
    });

    try {
      await app.dispose();
    } finally {
      drainSpy.mockRestore();
    }

    expect(order).toEqual(["watcher", "pipeline"]);
  });

  // watcher 冷啟失敗（任一守衛/資源失敗，含 allowlist 缺 loopback 的 throw 路徑——經
  // supertest loopback caller 該路徑結構性不可達，故以 factory throw 等價觸發）→
  // 500 誠實訊息 + runtime flag 回滾（surface 內部保證，不留半開狀態）。
  it("(d) watcher start throw → 500 誠實訊息 + runtime flag 回滾（GET status enabled=false，不留半開狀態）", async () => {
    const app = makeApp(configuredStartOverrides());
    storeFactory.mockImplementationOnce(() => {
      throw new Error("EXTERNAL_INTAKE_IP_ALLOWLIST 不含 loopback（127.0.0.1/::1）");
    });
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(res.status).toBe(500);
    expect(String(res.body.detail)).toContain("Failed to start watcher");
    // 回滾驗證：runtime flag 被設回 false → GET status enabled=false（無半開狀態）
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(false);
    // 未殘留 run：destroy 不應被呼叫（store 從未成功建立）
    expect(totalDestroyCalls()).toBe(0);
  });
});

// review Important #1：spec §4.1 要求 toggle 寫 audit {action,enabled,actor,reason,at}，未限定僅
// 成功。失敗嘗試（422 未配置仍啟動／500 啟動失敗）也須留 audit trail 供事後追查。
describe("PUT /api/conversion/watch — 失敗路徑也寫 audit（review Important #1）", () => {
  function configuredStartOverrides() {
    return {
      minioWatchEndpoint: "http://127.0.0.1:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      minioWatchSelfBaseUrl: "http://127.0.0.1:8004",
    };
  }
  beforeEach(resetStoreFactory);

  it("422 未配置仍嘗試啟動 → 寫一筆 warn audit（target 標 rejected-not-configured，reason 保留）", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-audit-422-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260617_120000_w422aa", skipEnvSnapshot: true });
    const app = makeApp({}, logger); // 無連線參數 → configured() 為 false
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true, reason: "operator probe" });
    expect(res.status).toBe(422);

    const audits = readAuditRecords(logger);
    const rec = audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:enable:rejected-not-configured");
    expect(rec).toBeDefined();
    expect(rec!.level).toBe("warn");
    const data = rec!.data as Record<string, unknown>;
    expect(data.action).toBe("conversion.watch.toggle");
    expect(data.actor).toBe("local-operator");
    expect(data.reason).toBe("operator probe");
  });

  it("500 watcher 啟動失敗 → 寫一筆 warn audit（target 標 failed-start，reason 含錯誤訊息）", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-audit-500-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260617_120000_w500bb", skipEnvSnapshot: true });
    const app = makeApp(configuredStartOverrides(), logger);
    storeFactory.mockImplementationOnce(() => {
      throw new Error("simulated watcher boot failure");
    });
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true, reason: "retry boot" });
    expect(res.status).toBe(500);

    const audits = readAuditRecords(logger);
    const rec = audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:enable:failed-start");
    expect(rec).toBeDefined();
    expect(rec!.level).toBe("warn");
    const data = rec!.data as Record<string, unknown>;
    expect(data.action).toBe("conversion.watch.toggle");
    expect(data.actor).toBe("local-operator");
    // reason 同時保留操作者理由與失敗訊息,供事後追查
    expect(String(data.reason)).toContain("retry boot");
    expect(String(data.reason)).toContain("simulated watcher boot failure");
  });

  // 成功 toggle（200 OK）必須寫一筆 info audit，含獨立 `enabled: boolean` 欄位（spec §4.1）。
  it("成功 enable（200）→ 寫一筆 info audit（target=watch:enable + enabled=true，spec §4.1）", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-audit-ok-on-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260617_120000_wokon", skipEnvSnapshot: true });
    const app = makeApp(configuredStartOverrides(), logger);
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: true, reason: "operator enable" });
    expect(res.status).toBe(200);

    const audits = readAuditRecords(logger);
    const rec = audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:enable");
    expect(rec).toBeDefined();
    expect(rec!.level).toBe("info");
    const data = rec!.data as Record<string, unknown>;
    expect(data.action).toBe("conversion.watch.toggle");
    expect(data.actor).toBe("local-operator");
    expect(data.reason).toBe("operator enable");
    // spec §4.1：獨立 enabled 欄位（不僅靠 target 字串編碼方向）
    expect(data.enabled).toBe(true);
  });

  // P5 對抗複驗 task1-important2：對「已啟用」watcher 再 enable 是 no-op（guard 早返、
  // 不起第二個 run）；audit 須與真冷啟區分 → target=watch:enable:noop。同時鎖 idempotency。
  it("double-enable（對已啟用 watcher 再 enable）→ 無第二 watcher（冷啟仍 1 次）+ audit target=watch:enable:noop", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-audit-noop-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260617_120000_wnoop", skipEnvSnapshot: true });
    const app = makeApp(configuredStartOverrides(), logger);
    // 第一筆 enable：真冷啟（target=watch:enable）
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true, reason: "first enable" })).status).toBe(200);
    expect(storeFactory).toHaveBeenCalledTimes(1);
    // 第二筆 enable：watcher 已在跑 → guard 早返、不起第二個 run
    const second = await request(app.app).put("/api/conversion/watch").send({ enabled: true, reason: "redundant enable" });
    expect(second.status).toBe(200);
    expect(storeFactory).toHaveBeenCalledTimes(1); // 仍 1：idempotent，無雙 watcher
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(true); // 狀態冪等仍 enabled

    const audits = readAuditRecords(logger);
    // 第二筆（no-op）須標 watch:enable:noop，稽核可辨非真啟動
    const noopRec = audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:enable:noop");
    expect(noopRec).toBeDefined();
    expect(noopRec!.level).toBe("info");
    const noopData = noopRec!.data as Record<string, unknown>;
    expect(noopData.enabled).toBe(true);
    expect(noopData.reason).toBe("redundant enable");
    // 第一筆仍是真 watch:enable（非 noop）→ 兩者可區分
    expect(audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:enable")).toBeDefined();
  });

  it("成功 disable（200）→ 寫一筆 info audit（target=watch:disable + enabled=false，spec §4.1）", async () => {
    const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-audit-ok-off-"));
    const logger = createLogger("coordinator", { logRoot, runId: "run_20260617_120000_wokoff", skipEnvSnapshot: true });
    const app = makeApp(configuredStartOverrides(), logger);
    // 先 enable 建 run，再 disable 取成功 disable audit（含 dispose 路徑）
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);
    const res = await request(app.app).put("/api/conversion/watch").send({ enabled: false, reason: "operator disable" });
    expect(res.status).toBe(200);

    const audits = readAuditRecords(logger);
    const rec = audits.find((r) => (r.data as Record<string, unknown>)?.target === "watch:disable");
    expect(rec).toBeDefined();
    expect(rec!.level).toBe("info");
    const data = rec!.data as Record<string, unknown>;
    expect(data.action).toBe("conversion.watch.toggle");
    expect(data.reason).toBe("operator disable");
    expect(data.enabled).toBe(false);
  });
});
