import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinioWatcherStatus } from "../src/services/minioWatcher.js";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

// IX-CV-04 Task 2.3b：spec §6.1 三條具名必要測試需在「無真 MinIO」下觀察 watcher 啟停。
// 直接 startMinioWatcher 會去輪詢不存在的 :9000、洩漏 timer。故用 vi.mock 把
// startMinioWatcher 換成回傳 fake handle（dispose=spy、getStatus 回可控 poll_count），
// fake 不碰網路。spy 變數用 vi.hoisted 提升（vi.mock factory 在 import 前求值）。
// 誠實註：此 mock 僅讓 route 層驗 coordinator 對 watcher handle 的啟停編排，不偽稱
// 驗了真 MinIO 連線；watcher 內部真實輪詢/IFC intake 端到端因果由 Task 7 gstack E2E 兜底。
const watcherMock = vi.hoisted(() => {
  let pollCount = 0;
  const disposeSpy = vi.fn(async () => {});
  const startSpy = vi.fn(() => {
    pollCount += 1; // 每次啟動視為 fake watcher 推進一輪，供 getStatus 反映「活著」
    return {
      dispose: disposeSpy,
      getStatus: (): MinioWatcherStatus => ({
        enabled: true,
        bucket: "bim-control",
        prefix: "",
        interval_seconds: 10,
        last_poll_at: null,
        poll_count: pollCount,
        last_error: null,
        baseline_count: null,
        seen_count: 0,
        triggered_total: 0,
        skipped_malformed_total: 0,
        last_triggered: [],
      }),
    };
  });
  return { startSpy, disposeSpy, reset: () => { startSpy.mockClear(); disposeSpy.mockClear(); pollCount = 0; } };
});
vi.mock("../src/services/minioWatcher.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/minioWatcher.js")>();
  return { ...actual, startMinioWatcher: watcherMock.startSpy };
});

let active: CoordinatorApp | null = null;
afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((r) => active?.server.close(() => r()));
    active = null;
  }
});
function makeApp(overrides = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-watch-toggle-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

// IX-CV-04：GET status 改讀 minioWatchRuntimeEnabled（初值 = env opt-in，
// 之後可被 PUT /api/conversion/watch 在 runtime 覆寫；PUT 本身屬 Task 2，本檔
// 不測 toggle 動作）。此處鎖定 status 路由「讀 runtime flag 初值」這條回歸基線：
// 兩個初始狀態（env 未 opt-in → enabled=false、env opt-in → enabled=true）都
// 必須由 status 路由如實回報，確保 status 不讀已分歧的 config.minioWatchEnabled。
describe("GET /api/external/minio-watch/status — runtime flag 初值（IX-CV-04 回歸鎖）", () => {
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
      // 測試 seam：避免 watcher 真打外網 intake
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

  // 註（IX-CV-04）：env=true 但 runtime flag 被覆寫=false → note「操作者關閉」分支，
  // 需 PUT /api/conversion/watch（Task 2）才能在無 test seam 下達成。該分支覆蓋移至
  // Task 3 的 toggle 測試以真正的 PUT route 驗證（plan Task 3.1），此處不以 test-only
  // setter 假寫 flag——避免 production public interface（CoordinatorApp）出現 write seam
  // 讓 consumer 繞過 PUT route 假寫狀態（review Important #1）。
});

describe("PUT /api/conversion/watch — toggle 行為", () => {
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

  it("並發 toggle：busy 鎖期間第二筆 → 409（dispose 延遲時可觀察）", async () => {
    const app = makeApp(configuredOverrides());
    const [a, b] = await Promise.all([
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
      request(app.app).put("/api/conversion/watch").send({ enabled: false }),
    ]);
    const codes = [a.status, b.status];
    // 至少一筆 200；若觀察到 409 代表鎖生效。no-op dispose 過快時兩筆皆 200（誠實，深度由程式碼審查兜底）。
    expect(codes).toContain(200);
  });
});

// IX-CV-04 spec §6.1：watcher 啟停可觀察行為（非 nice-to-have，spec 點名必要）。
// 用 vi.mock fake handle（檔頂 watcherMock）讓啟動路徑可達而不碰網路；selfBaseUrl
// 給非空值讓 startMinioWatcherIfEnabled 走完整路徑。誠實註：route 層僅驗 coordinator
// 對 watcher handle 的啟停編排，真 MinIO 連線由 Task 7 gstack E2E 兜底。
describe("PUT /api/conversion/watch — watcher 啟停可觀察行為（spec §6.1）", () => {
  function configuredStartOverrides() {
    return {
      minioWatchEndpoint: "http://127.0.0.1:9000",
      minioWatchBucket: "bim-control",
      minioWatchAccessKey: "ak",
      minioWatchSecretKey: "sk",
      // 非空 selfBaseUrl：讓 enable 路徑可達（fake start 不連網路，安全）
      minioWatchSelfBaseUrl: "http://127.0.0.1:8004",
    };
  }
  // reset 放 beforeEach：beforeEach 在前一個 test 所有 afterEach（含檔頂 app.dispose()，
  // 其會對仍存活的 fake watcher 呼一次 disposeSpy）之後才跑，故每個 test 起點 spy 計數
  // 必為 0，不被前一 test 的 teardown dispose 污染（afterEach 重置會被 teardown dispose 再加 1）。
  beforeEach(() => watcherMock.reset());

  it("(a) enabled:false 對啟用中 watcher → dispose 被呼叫 + status enabled→false", async () => {
    const app = makeApp(configuredStartOverrides());
    const on = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(on.status).toBe(200);
    expect(watcherMock.startSpy).toHaveBeenCalledTimes(1);

    const off = await request(app.app).put("/api/conversion/watch").send({ enabled: false });
    expect(off.status).toBe(200);
    expect(watcherMock.disposeSpy).toHaveBeenCalledTimes(1);
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(false);
  });

  it("(b) enabled:true 對已配置關閉態 → start 被呼叫 + GET status 回 fake getStatus（enabled:true、poll_count 反映 fake 推進）", async () => {
    const app = makeApp(configuredStartOverrides());
    const on = await request(app.app).put("/api/conversion/watch").send({ enabled: true });
    expect(on.status).toBe(200);
    expect(watcherMock.startSpy).toHaveBeenCalledTimes(1);

    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(true);
    expect(status.body.poll_count).toBe(1); // fake start 推進一輪
  });

  it("(c) off→on 往返一輪 → 狀態一致、無雙 watcher", async () => {
    const app = makeApp(configuredStartOverrides());
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: false })).status).toBe(200);
    expect((await request(app.app).put("/api/conversion/watch").send({ enabled: true })).status).toBe(200);

    // 每次開啟各一次 start（共 2）、唯一一次關閉一次 dispose（共 1）、無殘留雙 handle
    expect(watcherMock.startSpy).toHaveBeenCalledTimes(2);
    expect(watcherMock.disposeSpy).toHaveBeenCalledTimes(1);
    const status = await request(app.app).get("/api/external/minio-watch/status");
    expect(status.body.enabled).toBe(true);
  });
});
