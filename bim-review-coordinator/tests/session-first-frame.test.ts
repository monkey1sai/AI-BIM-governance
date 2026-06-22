import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

let active: CoordinatorApp | null = null;

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

// 比照 sessions.test.ts 的 makeApp：mkdtempSync 配置 sessionStoreDir/eventLogDir/...，
// afterEach 關掉 app.io / app.server。
function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-first-frame-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

// 照抄 sessions.test.ts 建真 session 的 payload（POST /api/review-sessions）。
async function createSession(app: CoordinatorApp): Promise<{ session_id: string }> {
  const created = await request(app.app)
    .post("/api/review-sessions")
    .send({
      project_id: "project_demo_001",
      model_version_id: "version_demo_001",
      created_by: "dev_user_001",
      artifact_bindings: [
        {
          artifact_group_id: "ag_version_demo_001",
          artifact_id: "auto_usdc_stream_conv_status_001",
          artifact_role: "derived",
          url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/model.usdc",
          mapping_url: "http://127.0.0.1:49101/artifacts/stream_conv_status_001/element_mapping.json",
          load_order: 0,
          ready_status: "ready",
          conversion_authority: "bim-streaming-server",
          conversion_job_id: "stream_conv_status_001",
          conversion_status: "ready",
        },
      ],
    });
  // create route 回 200（response.json(session)，app.ts:546），非 201；
  // 此 helper 只需取得有效 session_id 供 first-frame 測試使用。
  expect(created.status).toBe(200);
  expect(typeof created.body.session_id).toBe("string");
  return { session_id: created.body.session_id as string };
}

describe("POST /api/review-sessions/:sessionId/first-frame", () => {
  it("safe-id 不合法回 400", async () => {
    const app = makeApp();
    const res = await request(app.app).post("/api/review-sessions/not%20safe/first-frame").send({});
    expect(res.status).toBe(400);
  });

  it("session 不存在回 404", async () => {
    const app = makeApp();
    const res = await request(app.app).post("/api/review-sessions/review_session_doesnotexist/first-frame").send({});
    expect(res.status).toBe(404);
  });

  it("首次回報寫入 first_frame_at + 記 firstFrameObserved event", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ endpoint_id: "kit_local_001" });
    expect(res.status).toBe(200);
    expect(typeof res.body.first_frame_at).toBe("string");
    const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
    expect(events.body.items.some((e: any) => e.type === "firstFrameObserved")).toBe(true);
    const stored = app.store.get(sid);
    expect(stored?.first_frame_at).toBe(res.body.first_frame_at);
  });

  it("冪等：第二次回報不覆寫時戳、不重複 append", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    const first = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
    const second = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
    expect(second.body.first_frame_at).toBe(first.body.first_frame_at);
    const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
    expect(events.body.items.filter((e: any) => e.type === "firstFrameObserved").length).toBe(1);
  });

  it("忽略 body.observed_at，用 coordinator 時戳（N3）", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ observed_at: "1999-01-01T00:00:00.000Z" });
    expect(res.body.first_frame_at).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("runtime/status.sessions[].items[] emit first_frame_at（型別鏈 M3）", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
    const rt = await request(app.app).get("/api/runtime/status");
    const item = rt.body.sessions.items.find((s: any) => s.session_id === sid);
    expect(item).toBeTruthy();
    expect(item.first_frame_at).toBeTruthy();
  });

  // P5 對抗複驗 Important #1：first-frame 缺 isSessionMutable 守門。closed/closing session 不可
  // 再 store.update + append firstFrameObserved 進 append-only audit ledger（與 append-event
  // app.ts:866、stage-binding 等 sibling mutation 路由一致）。race（browser close 與 viewer 首幀
  // 同時抵達）可產生不一致狀態，須回 409 拒絕。
  it("closed session 回 409、不寫 first_frame_at、不 append（Important #1）", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    await request(app.app).post(`/api/review-sessions/${sid}/close`).send({});
    const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ endpoint_id: "kit_local_001" });
    expect(res.status).toBe(409);
    expect(app.store.get(sid)?.first_frame_at).toBeFalsy();
    const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
    expect(events.body.items.some((e: any) => e.type === "firstFrameObserved")).toBe(false);
  });

  it("closing session 回 409（Important #1）", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    app.store.update(sid, { status: "closing" });
    const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({});
    expect(res.status).toBe(409);
  });

  // P5 對抗複驗 Important #2/#3：endpoint_id 來自 iframe postMessage 的 client 回報（LAN 無 RBAC，
  // 任何頁面可偽造），須與 resolveActor/parseReason 的 budget 截斷對齊，避免超長字串撐爆 / 污染
  // append-only audit JSONL。
  it("超長 endpoint_id 截斷後才寫入 event（Important #2/#3）", async () => {
    const app = makeApp();
    const sid = (await createSession(app)).session_id;
    const huge = "x".repeat(5000);
    const res = await request(app.app).post(`/api/review-sessions/${sid}/first-frame`).send({ endpoint_id: huge });
    expect(res.status).toBe(200);
    const events = await request(app.app).get(`/api/review-sessions/${sid}/events`);
    const ff = events.body.items.find((e: any) => e.type === "firstFrameObserved");
    expect(ff).toBeTruthy();
    expect(typeof ff.payload.endpoint_id).toBe("string");
    expect(ff.payload.endpoint_id.length).toBeLessThanOrEqual(100);
  });
});
