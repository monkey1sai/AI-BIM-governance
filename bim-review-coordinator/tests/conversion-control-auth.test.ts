import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// unified-console-runtime-truth slice 2 task 4.2（owner D2 裁決 T4）：四條 conversion 控制路由
// 「IP allowlist 通過 或 operator token 通過」。supertest 走 loopback：allowlist 設成排除 loopback 的
// 網段即模擬「LAN 瀏覽器」；預設 allowlist（含 loopback）即模擬 watcher self-POST／本機 operator。
// 本檔的 app 沒有 MinIO／streaming 設定，故「授權通過」的觀測值是各路由授權之後的第一個判定：
//   prioritize／retry 對不存在 job → 404；watch enabled:true → 422（未配置）；trigger → 503（MinIO 未設定）。
// 這些碼「不是 403／429」，即證明授權已通過且其後行為逐字沿用既有路徑。

const LAN_ONLY_ALLOWLIST = ["10.0.0.0/8"];
const OPERATOR_TOKEN = "operator-secret-s2";
const IP_REJECTED_BODY = { detail: "caller ip not in allowlist" };
const TOKEN_INVALID_BODY = { detail: "operator token invalid (x-operator-token)" };
const RATE_LIMITED_BODY = { detail: "operator token rate limit exceeded (10 requests per minute per source ip)" };

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-control-auth-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

interface RouteCase {
  name: string;
  send: (app: CoordinatorApp, headers: Record<string, string>) => request.Test;
  /** 授權通過後、本 harness 下的第一個判定碼（非 403／429）。 */
  authorizedStatus: number;
}

const ROUTES: RouteCase[] = [
  {
    name: "POST /api/conversion/jobs/:id/prioritize",
    send: (app, headers) => request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set(headers).send({}),
    authorizedStatus: 404,
  },
  {
    name: "POST /api/conversion/jobs/:id/retry",
    send: (app, headers) => request(app.app).post("/api/conversion/jobs/ifcready_nope/retry").set(headers).send({}),
    authorizedStatus: 404,
  },
  {
    name: "PUT /api/conversion/watch",
    send: (app, headers) => request(app.app).put("/api/conversion/watch").set(headers).send({ enabled: true }),
    authorizedStatus: 422,
  },
  {
    name: "POST /api/conversion/trigger",
    send: (app, headers) => request(app.app).post("/api/conversion/trigger").set(headers).send({ key: "proj/main/uuid/model.ifc" }),
    authorizedStatus: 503,
  },
];

for (const route of ROUTES) {
  describe(`${route.name} — T4 per-route 授權`, () => {
    it("無憑證且非 allowlist → 403 逐字 body（與變更前相同）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, {});
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    });

    it("token 路徑未啟用（devAuthToken 仍為預設 dev-token）：即使帶 dev-token 也 403 逐字（fail-closed）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
      expect(app.config.devAuthToken).toBe("dev-token");
      const res = await route.send(app, { "x-operator-token": "dev-token" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    });

    it("錯誤 token → 403 operator token invalid", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-operator-token": "not-the-token" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(TOKEN_INVALID_BODY);
    });

    it("正確 x-operator-token → 授權通過（落到既有下一判定，非 403／429）", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-operator-token": OPERATOR_TOKEN });
      expect(res.status).toBe(route.authorizedStatus);
    });

    it("相容 x-dev-token → 授權通過", async () => {
      const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
      const res = await route.send(app, { "x-dev-token": OPERATOR_TOKEN });
      expect(res.status).toBe(route.authorizedStatus);
    });

    it("allowlist 路徑（預設含 loopback）無 token → 逐字沿用既有行為", async () => {
      const app = makeApp();
      const res = await route.send(app, {});
      expect(res.status).toBe(route.authorizedStatus);
    });
  });
}

describe("token 路徑速率限制（每來源 IP 每分鐘 10 次，只對 token 路徑）", () => {
  it("第 11 次 token 路徑請求 → 429 + Retry-After；錯誤 token 的嘗試也計入", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
    for (let i = 0; i < 9; i += 1) {
      const ok = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", OPERATOR_TOKEN).send({});
      expect(ok.status).toBe(404);
    }
    const wrong = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", "nope").send({});
    expect(wrong.status).toBe(403);
    const limited = await request(app.app).post("/api/conversion/jobs/ifcready_nope/retry").set("x-operator-token", OPERATOR_TOKEN).send({});
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual(RATE_LIMITED_BODY);
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("allowlist 路徑不計速率：loopback 連打 15 次一律通過（無 429）", async () => {
    const app = makeApp();
    for (let i = 0; i < 15; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(404);
    }
  });

  it("非 allowlist 且無 token header 的請求不計入 token 路徑速率（仍 403 逐字），之後正確 token 仍可用", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST, devAuthToken: OPERATOR_TOKEN });
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(403);
      expect(res.body).toEqual(IP_REJECTED_BODY);
    }
    const ok = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").set("x-operator-token", OPERATOR_TOKEN).send({});
    expect(ok.status).toBe(404);
  });
});

describe("空 allowlist（未啟用 IP 守門）語意不變", () => {
  it("空 allowlist → 一律放行（不看 token、不計速率）", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: [] });
    for (let i = 0; i < 12; i += 1) {
      const res = await request(app.app).post("/api/conversion/jobs/ifcready_nope/prioritize").send({});
      expect(res.status).toBe(404);
    }
  });
});
