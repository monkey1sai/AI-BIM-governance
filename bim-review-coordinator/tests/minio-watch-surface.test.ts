import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { idempotencyKeyFor } from "../src/services/minioWatcher.js";
import {
  createMinioWatchSurface,
  type MinioWatchSurface,
  type MinioWatchSurfaceOptions,
} from "../src/services/minioWatchSurface.js";
import { createS3ObjectStore, type ObjectStorePort } from "../src/services/minioObjectStore.js";
import { createFakeObjectStore } from "./helpers/fakeObjectStore.js";
import type { MinioWatcherStatus } from "../src/services/minioWatcher.js";

// 本檔取代舊 minio-watcher-loop.test.ts：watcher loop 語意改經 MinioWatchSurface.pollNow()
// 確定性驅動——pollNow resolve 時該輪 list／intake POST／counters 已全部落定，斷言一律同步。
// 舊檔的「觀測契約」（counters eventually-consistent、必須 waitFor 不可同步讀）在此介面
// 形狀下結構性不存在，僅存的 waitFor 活在檔尾 liveness describe（驗 auto 排程本身）與
// hang-dispose 測試（等 stub 收到請求，非輪詢計數器）。
// S3 分頁/XML 解析屬真 adapter，移至 minio-object-store.test.ts。

let intakeStub: http.Server | null = null;
let s3Stub: http.Server | null = null;
let surface: MinioWatchSurface | null = null;

afterEach(async () => {
  if (surface) { await surface.dispose(); surface = null; }
  for (const s of [intakeStub, s3Stub]) {
    if (!s) continue;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  intakeStub = null;
  s3Stub = null;
});

async function startIntakeStub(
  received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>,
): Promise<string> {
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body: JSON.parse(body || "{}") as Record<string, unknown>, headers: req.headers });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_ready_job_id: `ifcready_stub_${received.length}`, idempotent_replay: false }));
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// 回 2xx 但 body 非 JSON（如 nginx/HTML 錯誤頁）：triggered_total 不得 +1，記 last_triggered.error。
async function startNonJsonIntakeStub(received: Array<{ headers: http.IncomingHttpHeaders }>): Promise<string> {
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers });
      res.writeHead(202, { "Content-Type": "text/html" });
      res.end("<html><body>202 but not json</body></html>");
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// intake 收到請求但永不回應（socket 掛住）：驗 AbortSignal.timeout 保護（loop 不凍結）。
async function startHangingIntakeStub(received: Array<{ at: number }>): Promise<string> {
  intakeStub = http.createServer((req) => {
    received.push({ at: Date.now() });
    req.resume();
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// §3.4：把「既有已落帳」表達為持久 ledger 命中（真實 idkey 同源計算）。
function ledgeredFor(
  bucket: string,
  entries: Array<{ key: string; etag: string }>,
): (idkey: string) => boolean {
  const set = new Set(entries.map((e) => idempotencyKeyFor(bucket, e.key, e.etag)));
  return (idkey: string) => set.has(idkey);
}

const noopLog = { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) };

type SurfaceExtra = Partial<MinioWatchSurfaceOptions["config"]> & {
  isLedgered?: (idkey: string) => boolean;
  onObjectObserved?: MinioWatchSurfaceOptions["onObjectObserved"];
  store?: ObjectStorePort;
};

/**
 * 建構並啟動 surface。預設 intervalSeconds=3600：首輪 tick 由 startIfEnabled 直接上鏈，
 * 之後的 auto tick 在一小時外——測試窗內只有 pollNow 驅動的輪，序列完全確定。
 */
function makeSurface(store: ObjectStorePort, selfBase: string, extra: SurfaceExtra = {}): MinioWatchSurface {
  const { isLedgered, onObjectObserved, store: _ignored, ...cfg } = extra;
  const s = createMinioWatchSurface({
    config: {
      enabled: true,
      endpoint: "http://127.0.0.1:9000", // fake store 下不使用；真 adapter 測試另行覆寫
      bucket: "bim-control",
      prefix: "",
      accessKey: "ak",
      secretKey: "sk",
      keySuffix: "/model.ifc",
      intervalSeconds: 3600,
      selfBaseUrl: selfBase,
      tenantId: "tenant_demo_001",
      ...cfg,
    },
    webhookSecret: "dev-webhook-secret",
    isLedgered: isLedgered ?? (() => false),
    onObjectObserved,
    resolveSelfBaseUrl: () => selfBase,
    assertIntakeReachable: () => {},
    objectStoreFactory: () => store,
    structLog: noopLog,
  });
  surface = s;
  s.startIfEnabled();
  return s;
}

function runningStatus(s: MinioWatchSurface): MinioWatcherStatus {
  const st = s.status();
  if (!("poll_count" in st)) throw new Error(`watcher not running: ${JSON.stringify(st)}`);
  return st;
}

describe("MinioWatchSurface（pollNow 確定性驅動）", () => {
  it("[autoenroll] 首輪即觸發 ledger 無紀錄物件（移除 baseline 不觸發特例）", async () => {
    const store = createFakeObjectStore([
      { key: "899/main/xxx/model.ifc", etag: "e1" },
      { key: "900/main/yyy/model.ifc", etag: "e2" },
    ]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, { isLedgered: () => false });

    // pollNow 排在首輪之後 → resolve 時首輪（觸發兩筆）與本輪（全 skip_seen）皆已落定，同步斷言。
    const second = await s.pollNow();
    const st = runningStatus(s);
    expect(st.baseline_count).toBe(2); // 診斷欄位仍填（首輪 model.ifc 數），不再 gate 觸發
    expect(st.triggered_total).toBe(2);
    expect(received.length).toBe(2);
    expect(second.outcomes.map((o) => o.outcome)).toEqual(["skip_seen", "skip_seen"]);
    // 觸發後 seen 鎖定：再跑一輪不重送。
    await s.pollNow();
    expect(received.length).toBe(2);
    expect(runningStatus(s).triggered_total).toBe(2);
  });

  it("[autoenroll] 首輪已落帳物件 → 不觸發（ledger 命中 skip）", async () => {
    const store = createFakeObjectStore([
      { key: "899/main/xxx/model.ifc", etag: "e1" },
      { key: "900/main/yyy/model.ifc", etag: "e2" },
    ]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, { isLedgered: () => true });

    await s.pollNow(); // 首輪＋本輪皆已落定
    const st = runningStatus(s);
    expect(st.baseline_count).toBe(2);
    expect(st.triggered_total).toBe(0);
    expect(received.length).toBe(0);
  });

  it("onObjectObserved 對每個新 (key, etag) 只通知一次，供 folder cache dirty invalidation 使用", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const observed: Array<{ key: string; etag: string; idempotency_key: string; at: string }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, {
      isLedgered: () => true,
      onObjectObserved: (event) => observed.push(event),
    });

    await s.pollNow();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toEqual(expect.objectContaining({
      key: "899/main/xxx/model.ifc",
      etag: "e1",
      idempotency_key: idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1"),
    }));
    await s.pollNow();
    expect(observed).toHaveLength(1); // 同 (key, etag) 不重複通知

    store.objs[0] = { ...store.objs[0], etag: "e2" };
    await s.pollNow();
    expect(observed).toHaveLength(2); // etag 變 → 視為新觀測
    expect(observed[1]).toEqual(expect.objectContaining({
      key: "899/main/xxx/model.ifc",
      etag: "e2",
      idempotency_key: idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e2"),
    }));
    expect(received).toHaveLength(0);
  });

  it("第二輪新增物件 → 觸發一筆 intake，payload 與 header 正確", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    // 既有 899 已落帳 → 不觸發；received[0] 確定是新增的 988。
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    expect(runningStatus(s).baseline_count).toBe(1);
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    const summary = await s.pollNow();
    expect(summary.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("triggered");

    const { body, headers } = received[0];
    expect(body.event).toBe("ifc_ready");
    expect(body.tenant_id).toBe("tenant_demo_001"); // 來自 config.tenantId（makeSurface 預設）
    expect(body.project_id).toBe("988");
    expect(body.project_display_name).toBe("988"); // 專案原名（英數→原樣；中文保留，見 derive 單元測試）
    expect(body.model_category).toBe("main"); // 種類＝倒數第二層
    expect(body.external_model_version_id).toBe("zzz");
    expect((body.source_ifc as Record<string, unknown>).ref).toContain("988/main/zzz/model.ifc"); // presigned GET URL
    expect((body.source_ifc as Record<string, unknown>).ref).toMatch(/X-Amz-Signature=/); // 含簽章參數
    expect((body.source_ifc as Record<string, unknown>).etag).toBe("e9");
    expect(headers["x-webhook-secret"]).toBe("dev-webhook-secret");
    expect(String(headers["x-idempotency-key"])).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(String(headers["x-correlation-id"])).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    // pollNow 後 counters 已落定——同步斷言即可（舊檔此處需 waitFor 的競態類別已不存在）。
    expect(runningStatus(s).triggered_total).toBe(1);
  });

  it("同物件後續輪不再觸發（seen 命中，triggered 維持 1）", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });
    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await s.pollNow();
    expect(received.length).toBe(1);
    expect(runningStatus(s).triggered_total).toBe(1);
    // 多跑兩輪：seen 命中不再觸發。
    const extra1 = await s.pollNow();
    const extra2 = await s.pollNow();
    expect(extra1.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("skip_seen");
    expect(extra2.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("skip_seen");
    expect(received.length).toBe(1);
    expect(runningStatus(s).triggered_total).toBe(1);
  });

  it("層級不符 key → skipped_malformed 計數，不觸發", async () => {
    const store = createFakeObjectStore([
      { key: "899/main/seed/model.ifc", etag: "e1" },
      { key: "also-bad/model.ifc", etag: "e2" },
    ]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    // seed 899/main/seed 是合法三段；視為已落帳，聚焦「malformed key 被 skip、零 intake、
    // baseline_count 只算可解析 key」。
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/seed/model.ifc", etag: "e1" }]),
    });
    const summary = await s.pollNow();
    const st = runningStatus(s);
    // 首輪（auto）已把 malformed key 記為 skip_permanent 並標 seen（只計數一次）；
    // pollNow 這輪看到的是 skip_seen——確定性下可精確斷言「恰好 1、不逐輪灌水」。
    expect(st.skipped_malformed_total).toBe(1);
    expect(st.baseline_count).toBe(1);
    expect(received.length).toBe(0);
    expect(summary.outcomes.find((o) => o.key === "also-bad/model.ifc")?.outcome).toBe("skip_seen");
    await s.pollNow();
    expect(runningStatus(s).skipped_malformed_total).toBe(1);
  });

  it("[t1] body.tenant_id 來自 config.tenantId（非硬編碼）", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, {
      tenantId: "tenant_acme_042",
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await s.pollNow();
    expect(received.length).toBe(1);
    expect(received[0].body.tenant_id).toBe("tenant_acme_042");
  });

  it("[t3] selfBaseUrl 非 loopback host → startIfEnabled fast-fail（SSRF 防護）", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received); // 啟一個 stub 但不會被打到
    void selfBase;
    const makeUnstarted = (selfBaseUrl: string): MinioWatchSurface =>
      createMinioWatchSurface({
        config: {
          enabled: true, endpoint: "http://127.0.0.1:9000", bucket: "bim-control", prefix: "",
          accessKey: "ak", secretKey: "sk", keySuffix: "/model.ifc", intervalSeconds: 3600,
          selfBaseUrl, tenantId: "tenant_demo_001",
        },
        webhookSecret: "dev-webhook-secret",
        isLedgered: () => false,
        resolveSelfBaseUrl: () => selfBaseUrl,
        assertIntakeReachable: () => {},
        objectStoreFactory: () => createFakeObjectStore(),
        structLog: noopLog,
      });
    expect(() => makeUnstarted("http://evil.example.com:8004").startIfEnabled()).toThrow(/loopback|127\.0\.0\.1|localhost/i);
    // 也擋非 http scheme（避免 file:// / https 對外）
    expect(() => makeUnstarted("https://127.0.0.1:8004").startIfEnabled()).toThrow(/http:|scheme|protocol/i);
  });

  it("keySuffix 不以 '/' 開頭 → startIfEnabled fast-fail（防全物件靜默 skip）", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const makeWithSuffix = (keySuffix: string): MinioWatchSurface =>
      createMinioWatchSurface({
        config: {
          enabled: true, endpoint: "http://127.0.0.1:9000", bucket: "bim-control", prefix: "",
          accessKey: "ak", secretKey: "sk", keySuffix, intervalSeconds: 3600,
          selfBaseUrl: selfBase, tenantId: "tenant_demo_001",
        },
        webhookSecret: "dev-webhook-secret",
        isLedgered: () => false,
        resolveSelfBaseUrl: () => selfBase,
        assertIntakeReachable: () => {},
        objectStoreFactory: () => createFakeObjectStore(),
        structLog: noopLog,
      });
    expect(() => makeWithSuffix("model.ifc").startIfEnabled()).toThrow(/keySuffix.*'\/'|boundary-aligned/);
    expect(() => makeWithSuffix("").startIfEnabled()).toThrow(/keySuffix/);
  });

  it("list 失敗 → 記 last_error 與 summary.error，不 crash，物件零觸發", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    store.failListWith = new Error("connect ECONNREFUSED 127.0.0.1:1");
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase);
    const summary = await s.pollNow();
    expect(summary.error).toContain("ECONNREFUSED");
    expect(String(runningStatus(s).last_error)).toContain("ECONNREFUSED");
    expect(received.length).toBe(0);
    // 失敗後恢復：清除故障 → 下一輪照常觸發（loop 未死）。
    store.failListWith = null;
    await s.pollNow();
    expect(runningStatus(s).last_error).toBeNull();
    expect(received.length).toBe(1);
  });

  it("intake 回 2xx 但非 JSON body → triggered_total 不 +1，last_triggered 記錯誤（計數與狀態一致）", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startNonJsonIntakeStub(received);
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    const summary = await s.pollNow();
    expect(received.length).toBe(1); // intake 確實收到 POST（202 HTML）
    expect(summary.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("fail_transient");

    const st = runningStatus(s);
    expect(st.triggered_total).toBe(0); // 非 JSON → 不算成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBeNull();
    expect(st.last_triggered[0]?.error).toBeTruthy(); // 記錯誤，與計數一致
    expect(st.last_error).toBeNull(); // 單一物件失敗不污染整輪 last_error
  });

  it("intake 長時間不回應 → fetch 逾時不凍結 loop，記 last_triggered.error 後續輪續跑", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ at: number }> = [];
    const selfBase = await startHangingIntakeStub(received);
    const s = makeSurface(store, selfBase, {
      intakeTimeoutMs: 600,
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    // pollNow await 涵蓋 600ms 逾時窗——resolve 即逾時已處理完畢。
    const summary = await s.pollNow();
    expect(received.length).toBe(1); // intake 確實收到請求（但永不回）
    expect(summary.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("fail_transient");

    const st = runningStatus(s);
    expect(st.triggered_total).toBe(0); // 逾時 → 不算成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBeNull();
    expect(st.last_triggered[0]?.error).toBeTruthy(); // AbortError 入 error，與其他網路失敗對等
    expect(st.last_error).toBeNull();

    // loop 未凍結：下一輪照常可跑（fail_transient 未標 seen → 再次嘗試、再次逾時）。
    const next = await s.pollNow();
    expect(next.ran).toBe(true);
    expect(runningStatus(s).poll_count).toBeGreaterThanOrEqual(3);
  });

  it("intake 暫時性失敗（5xx）→ 物件不標 seen、下輪重試，成功後鎖定不再重送（自癒）", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ status: number }> = [];
    let failRemaining = 1; // 第一筆回 500，之後回 202 成功
    intakeStub = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (failRemaining > 0) {
          failRemaining -= 1;
          received.push({ status: 500 });
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "transient" }));
          return;
        }
        received.push({ status: 202 });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ifc_ready_job_id: "ifcready_retry_ok", idempotent_replay: false }));
      });
    });
    await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
    const a = intakeStub!.address();
    if (!a || typeof a === "string") throw new Error("intake stub bind");
    const selfBase = `http://127.0.0.1:${a.port}`;
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });

    // 第一輪觸發吃到 500 → fail_transient 不標 seen。
    const first = await s.pollNow();
    expect(first.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("fail_transient");
    // 下一輪重試吃到 202 → triggered。
    const second = await s.pollNow();
    expect(second.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("triggered");
    expect(received.map((r) => r.status)).toEqual([500, 202]); // 確實重試過
    const st = runningStatus(s);
    expect(st.triggered_total).toBe(1);
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBe("ifcready_retry_ok");
    expect(st.last_triggered[0]?.error).toBeNull();

    // 成功後 seen 鎖定：再跑一輪不得重送。
    await s.pollNow();
    expect(received.length).toBe(2);
    expect(runningStatus(s).triggered_total).toBe(1);
  });

  it("replay 回 download_status=failed 的既有 job → 不計觸發、誠實記錯誤、停止無效重試", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ status: number }> = [];
    let posts = 0;
    intakeStub = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        posts += 1;
        if (posts === 1) {
          // 模擬真 intake：job 已建、同步下載失敗 → 502 + download_status=failed
          received.push({ status: 502 });
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "IFC download failed", ifc_ready_job_id: "ifcready_dlfail", download_status: "failed" }));
          return;
        }
        // 之後同 idempotency key → 200 idempotent replay of 已失敗 job（不重下載）
        received.push({ status: 200 });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ifc_ready_job_id: "ifcready_dlfail", download_status: "failed", idempotent_replay: true }));
      });
    });
    await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
    const a = intakeStub!.address();
    if (!a || typeof a === "string") throw new Error("intake stub bind");
    const selfBase = `http://127.0.0.1:${a.port}`;
    const s = makeSurface(store, selfBase, {
      isLedgered: ledgeredFor("bim-control", [{ key: "899/main/xxx/model.ifc", etag: "e1" }]),
    });

    await s.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });

    // 第一輪 502（fail_transient 重試）→ 第二輪 200 replay failed（skip_permanent 停止）。
    const first = await s.pollNow();
    expect(first.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("fail_transient");
    const second = await s.pollNow();
    expect(second.outcomes.find((o) => o.key === "988/main/zzz/model.ifc")?.outcome).toBe("skip_permanent");

    const st = runningStatus(s);
    expect(st.triggered_total).toBe(0); // failed-job replay 不得計成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBe("ifcready_dlfail"); // 失敗綁 job_id（#/conv 可追）
    expect(String(st.last_triggered[0]?.error)).toContain("download_status=failed");

    // 停止無效重試：seen 已標，再跑一輪 received 不再增長。
    await s.pollNow();
    expect(received.length).toBe(2);
  });

  it("[autoenroll] 重啟（新 surface 實例）重掃同 key 同 etag：持久 ledger 命中 → 不重觸發（重啟不風暴）", async () => {
    // dedup 權威 = watcher 在 POST 前先查持久 ledger 水印。以共享 Set 模擬持久 ledger：
    // intake stub 每收一筆 POST 即把 idemKey 寫入 set（＝intake 落帳），isLedgered 讀此 set。
    const sharedLedger = new Set<string>();
    sharedLedger.add(idempotencyKeyFor("bim-control", "899/main/xxx/model.ifc", "e1"));
    const ledgered = (idkey: string): boolean => sharedLedger.has(idkey);

    const received: Array<{ idemKey: string }> = [];
    intakeStub = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const idemKey = String(req.headers["x-idempotency-key"] ?? "");
        received.push({ idemKey });
        sharedLedger.add(idemKey); // intake 成功即落帳，下一個 surface 實例查得到
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ifc_ready_job_id: `ifcready_${received.length}`, idempotent_replay: false }));
      });
    });
    await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
    const a = intakeStub!.address();
    if (!a || typeof a === "string") throw new Error("intake stub bind");
    const selfBase = `http://127.0.0.1:${a.port}`;

    // 第一個 surface：baseline(899 已落帳) 後新增 988（ledger 無紀錄）→ 觸發一次並落帳。
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const s1 = makeSurface(store, selfBase, { isLedgered: ledgered });
    await s1.pollNow();
    store.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await s1.pollNow();
    expect(runningStatus(s1).triggered_total).toBe(1);
    const expectedIdem = received[0].idemKey;
    expect(expectedIdem).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(sharedLedger.has(idempotencyKeyFor("bim-control", "988/main/zzz/model.ifc", "e9"))).toBe(true);

    // 模擬重啟：dispose 舊 surface（清 in-memory seen），新 surface 用「同一份持久 ledger」。
    // bucket 內容不變（899 + 988 皆仍在）＝真實重啟情境，新 surface baseline_count=2。
    await s1.dispose();
    const s2 = makeSurface(store, selfBase, { isLedgered: ledgered });
    const rescan = await s2.pollNow(); // 首輪＋本輪皆已落定
    expect(runningStatus(s2).baseline_count).toBe(2);
    expect(runningStatus(s2).poll_count).toBeGreaterThanOrEqual(2); // 確實跑過 ≥2 輪
    // 重啟後 899 與 988 皆已落帳 → 全部 skip，不再 POST（重啟不風暴）。
    expect(rescan.outcomes.every((o) => o.outcome === "skip_seen" || o.outcome === "skip_ledgered")).toBe(true);
    expect(received.length).toBe(1); // 重啟未產生第二筆 intake
    expect(received[0].idemKey).toBe(expectedIdem);
    expect(runningStatus(s2).triggered_total).toBe(0);
  });

  it("pollNow 對未啟用/未啟動 surface 誠實回 ran=false（不偽稱跑過一輪）", async () => {
    const store = createFakeObjectStore();
    const notStarted = createMinioWatchSurface({
      config: {
        enabled: false, endpoint: "", bucket: "", prefix: "", accessKey: "", secretKey: "",
        keySuffix: "/model.ifc", intervalSeconds: 3600, selfBaseUrl: "", tenantId: "t",
      },
      webhookSecret: "s",
      isLedgered: () => false,
      resolveSelfBaseUrl: () => "http://127.0.0.1:1",
      assertIntakeReachable: () => {},
      objectStoreFactory: () => store,
      structLog: noopLog,
    });
    expect((await notStarted.pollNow()).ran).toBe(false);
    expect((await notStarted.pollNow()).reason).toBe("disabled");
  });
});

// t2：dispose 在 in-flight tick 的真 SDK 請求進行中被呼叫 → await tick settle（2s 上限）後
// 才 destroy，無 unhandled rejection。此測試綁真 S3 adapter（S3Client destroy 語意是重點），
// 保留 stub 端事件的 waitFor（等 stub 收到請求＝tick 的 client.send 已在途；非輪詢計數器）。
describe("MinioWatchSurface × 真 S3 adapter：dispose 安全", () => {
  it("[t2] dispose() 在 in-flight SDK list 進行中 → await settle 後 destroy，無 unhandled rejection", async () => {
    const s3Received: Array<{ at: number }> = [];
    s3Stub = http.createServer((req) => {
      s3Received.push({ at: Date.now() });
      req.resume(); // 收完 query 但永不 res.end → list 請求懸而不決
    });
    await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
    const sa = s3Stub!.address();
    if (!sa || typeof sa === "string") throw new Error("s3 hang stub bind");
    const s3Base = `http://127.0.0.1:${sa.port}`;
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => { unhandled.push(err); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const s = makeSurface(
        createS3ObjectStore({ endpoint: s3Base, bucket: "bim-control", accessKey: "ak", secretKey: "sk" }),
        selfBase,
      );
      // 等 S3 stub 確實收到 list 請求（=首輪 tick 的 client.send 已在途）。
      const end = Date.now() + 3000;
      while (s3Received.length < 1 && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(s3Received.length).toBeGreaterThanOrEqual(1);

      await s.dispose(); // async：set stopped → await in-flight（2s cap）→ destroy
      surface = null;

      // 給事件圈幾拍讓任何潛在的 client.destroy() 中斷例外有機會冒出來。
      await new Promise((r) => setTimeout(r, 100));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

// 唯一保留真計時器的 liveness 覆蓋（2026-07-30 grilling 共識 Q6）：auto 排程本身也是行為
// ——setTimeout 鏈、首輪立即跑、list 失敗後仍續排（自癒）。pollNow 不會走排程路徑，故這裡
// 用小 interval + waitFor 驗「loop 自己會動」。其餘一切行為斷言都在上方確定性測試。
describe("MinioWatchSurface auto 排程 liveness（真計時器）", () => {
  async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("waitFor timeout");
  }

  it("poll_count 隨 auto tick 單調遞增；list 失敗輪之後仍續排下一輪（自癒）", async () => {
    const store = createFakeObjectStore([{ key: "899/main/xxx/model.ifc", etag: "e1" }]);
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s = makeSurface(store, selfBase, { intervalSeconds: 0.05, isLedgered: () => true });

    // auto 排程活著：poll_count 純靠計時器推進（本測試不呼叫 pollNow）。
    await waitFor(() => "poll_count" in s.status() && (s.status() as MinioWatcherStatus).poll_count >= 2);

    // list 失敗輪：finally 仍續排 → 恢復後 poll_count 繼續前進（loop 自癒，不凍結）。
    store.failListWith = new Error("transient list failure");
    await waitFor(() => (s.status() as MinioWatcherStatus).last_error !== null);
    store.failListWith = null;
    const c1 = (s.status() as MinioWatcherStatus).poll_count;
    await waitFor(() => (s.status() as MinioWatcherStatus).poll_count > c1);
    expect((s.status() as MinioWatcherStatus).last_error).toBeNull();
  });
});
