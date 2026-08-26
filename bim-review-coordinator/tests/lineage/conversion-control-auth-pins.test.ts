import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../../src/app.js";
import type { CoordinatorConfig } from "../../src/config.js";

// unified-console-runtime-truth slice 2 task 4.3：釘樁。T4 per-route wrapper 只包四條 /api/conversion/*
// 控制路由;本檔證明 (a) lineage legacy-unmanaged preview/confirm(經 deps 注入 rejectIfIpNotAllowed)
// 與 (b) /api/external/ifc-ready webhook 面的授權回應在變更前後逐字相同,且 operator token 對這些路由
// 「沒有任何效果」。本檔必須在 app.ts 改動前先跑綠(baseline),改動後再跑綠(釘樁成立)。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(TEST_DIR, "..", "..", "..", "tests", "contracts", "ifc_ready_payload.json");
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as { example: Record<string, unknown> };

const WEBHOOK_SECRET = "dev-webhook-secret";
const OPERATOR_TOKEN = "operator-secret-for-pins";
const LAN_ONLY_ALLOWLIST = ["10.0.0.0/8"];
const IP_REJECTED_BODY = { detail: "caller ip not in allowlist" };
const PREVIEW_PATH = "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy";
const CONFIRM_PATH = "/api/lineage/legacy-unmanaged/confirm";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (!active) return;
  await active.dispose();
  active.io.close();
  await new Promise<void>((resolve) => active?.server.close(() => resolve()));
  active = null;
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-coord-auth-pins-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    streamingConversionApiBase: "http://127.0.0.1:1",
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    externalIntakeWebhookSecret: WEBHOOK_SECRET,
    devAuthToken: OPERATOR_TOKEN,
    ...overrides,
  });
  return active;
}

function webhookHeaders(suffix: string): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": `corr_pin_${suffix}`,
    "X-Idempotency-Key": `idem_pin_${suffix}`,
  };
}

describe("釘樁：lineage legacy-unmanaged 路由（deps 注入 rejectIfIpNotAllowed）", () => {
  it("preview：IP 不在 allowlist → 403 逐字 body；帶 operator token 仍 403 同 body", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const bare = await request(app.app).get(PREVIEW_PATH);
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual(IP_REJECTED_BODY);
    const withToken = await request(app.app).get(PREVIEW_PATH).set("x-operator-token", OPERATOR_TOKEN);
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(IP_REJECTED_BODY);
  });

  it("confirm：IP 不在 allowlist → 403 逐字 body；帶 operator token 仍 403 同 body", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const body = { grouping_key: "tenant-a/legacy" };
    const bare = await request(app.app).post(CONFIRM_PATH).send(body);
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual(IP_REJECTED_BODY);
    const withToken = await request(app.app).post(CONFIRM_PATH).set("x-operator-token", OPERATOR_TOKEN).send(body);
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(IP_REJECTED_BODY);
  });

  it("preview/confirm：loopback 在預設 allowlist → 通過 IP 守門，落到 grouping_key 驗證 400（allow 路徑釘樁）", async () => {
    const app = makeApp();
    const preview = await request(app.app).get("/api/lineage/legacy-unmanaged/preview");
    expect(preview.status).toBe(400);
    expect(preview.body).toEqual({ error: "invalid_grouping_key" });
    const confirm = await request(app.app).post(CONFIRM_PATH).send({});
    expect(confirm.status).toBe(400);
    expect(confirm.body).toEqual({ error: "invalid_grouping_key" });
  });
});

describe("釘樁：/api/external/ifc-ready webhook 面授權", () => {
  it("IP 不在 allowlist → 403 `caller ip not in allowlist: <ip>`；operator token 不解鎖 webhook 面", async () => {
    const app = makeApp({ externalIntakeIpAllowlist: LAN_ONLY_ALLOWLIST });
    const bare = await request(app.app).post("/api/external/ifc-ready").set(webhookHeaders("1")).send(structuredClone(CONTRACT.example));
    expect(bare.status).toBe(403);
    expect(bare.body).toEqual({ detail: expect.stringMatching(/^caller ip not in allowlist: (127\.0\.0\.1|::1)$/) });
    const withToken = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ ...webhookHeaders("2"), "x-operator-token": OPERATOR_TOKEN })
      .send(structuredClone(CONTRACT.example));
    expect(withToken.status).toBe(403);
    expect(withToken.body).toEqual(bare.body);
  });

  it("loopback 允許但缺 X-Webhook-Secret → 401 逐字 body（secret 面不受 operator token 影響）", async () => {
    const app = makeApp();
    const res = await request(app.app)
      .post("/api/external/ifc-ready")
      .set({ "X-Correlation-Id": "corr_pin_3", "X-Idempotency-Key": "idem_pin_3", "x-operator-token": OPERATOR_TOKEN })
      .send(structuredClone(CONTRACT.example));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ detail: "missing X-Webhook-Secret or X-Webhook-Signature" });
  });
});
