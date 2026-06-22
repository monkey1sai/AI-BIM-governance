import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startMinioWatcher, type MinioWatcherStatus } from "../src/services/minioWatcher.js";

let s3Stub: http.Server | null = null;
let intakeStub: http.Server | null = null;
// getStatus 回完整 MinioWatcherStatus（具名型別，無 index signature）；tsconfig include tests/
// 故須與 MinioWatcherHandle 的回傳對齊，不可用 Record<string, unknown>（嚴格模式不可賦值）。
let watcher: { dispose: () => Promise<void>; getStatus: () => MinioWatcherStatus } | null = null;

afterEach(async () => {
  if (watcher) { await watcher.dispose(); watcher = null; }
  for (const s of [s3Stub, intakeStub]) {
    if (!s) continue;
    // hanging stub（startHangingS3Stub / startHangingIntakeStub）保留一個永不結束的請求
    // socket；http.Server.close() 只在所有連線關閉後才回 callback，故先強制斷開既有連線
    // （Node 18.2+ closeAllConnections）再 close，避免 teardown 卡到 hook timeout。
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  s3Stub = null; intakeStub = null;
});

interface S3Obj { key: string; etag: string; }

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(state: { objs: S3Obj[] }): Promise<string> {
  s3Stub = http.createServer((req, res) => {
    // ListObjectsV2: GET /{bucket}?list-type=2... → 回 XML。GetObject presign 不真打（presigner 只簽 URL）。
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(state.objs));
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function startIntakeStub(received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>): Promise<string> {
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body: JSON.parse(body || "{}"), headers: req.headers });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_ready_job_id: `ifcready_stub_${received.length}`, idempotent_replay: false }));
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// 回 2xx 但 body 非 JSON（如 nginx/HTML 錯誤頁、502 代理頁），用以驗 triggerIntake 對
// 無效 JSON 的防守：triggered_total 不得 +1（否則計數誇大為「成功觸發」與 last_triggered
// 的 error 狀態不一致），且須記入 last_triggered.error。
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

// intake 對同一 idempotency key 永遠回同一 ifc_ready_job_id 且 idempotent_replay=true
// （等價真 coordinator store 的去重）。用以驗「重啟新 watcher 實例重掃同 key 同 etag →
// 仍 triggered（202 idempotent_replay 計觸發）且 job_id 與首次相同（同一筆 job）」。
async function startIdempotentReplayIntakeStub(
  received: Array<{ idemKey: string }>,
): Promise<string> {
  const jobByIdem = new Map<string, string>();
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const idemKey = String(req.headers["x-idempotency-key"] ?? "");
      received.push({ idemKey });
      let jobId = jobByIdem.get(idemKey);
      const replay = jobId !== undefined;
      if (jobId === undefined) {
        jobId = `ifcready_replaystub_${jobByIdem.size + 1}`;
        jobByIdem.set(idemKey, jobId);
      }
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_ready_job_id: jobId, idempotent_replay: replay }));
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// intake 收到請求但**永不回應**（socket 掛住），模擬 app 因負載/死鎖長時間不回
// /api/external/ifc-ready。用以驗 triggerIntake 的 fetch 有 AbortSignal.timeout 保護：
// 逾時後須記入 last_triggered.error 並讓 tick() 完成、下一輪照常排程（loop 不凍結）。
async function startHangingIntakeStub(received: Array<{ at: number }>): Promise<string> {
  intakeStub = http.createServer((req) => {
    received.push({ at: Date.now() });
    req.resume(); // 收完 body 但永不 res.end → 請求懸而不決
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

// S3 ListObjectsV2 收到請求但**永不回應**（socket 掛住），用以驗 dispose() 在 in-flight
// tick 的 SDK 請求進行中被呼叫時，先 await 當前 tick settle（帶 2s 上限）再 client.destroy()，
// 不產生 unhandled rejection。
async function startHangingS3Stub(received: Array<{ at: number }>): Promise<string> {
  s3Stub = http.createServer((req) => {
    received.push({ at: Date.now() });
    req.resume(); // 收完 query 但永不 res.end → list 請求懸而不決
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 hang stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

function makeWatcher(
  s3Base: string,
  selfBase: string,
  _state: { objs: S3Obj[] },
  extra: Partial<Parameters<typeof startMinioWatcher>[0]> = {},
) {
  return startMinioWatcher({
    endpoint: s3Base,
    bucket: "bim-control",
    prefix: "",
    accessKey: "ak",
    secretKey: "sk",
    keySuffix: "/model.ifc",
    intervalSeconds: 0.05, // 50ms tick → test 快
    selfBaseUrl: selfBase,
    webhookSecret: "dev-webhook-secret",
    tenantId: "tenant_demo_001",
    structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
    ...extra,
  });
}

describe("minioWatcher loop", () => {
  it("ListObjectsV2 分頁：IsTruncated=true → 帶 continuation-token 取次頁，兩頁物件皆入 baseline", async () => {
    // 鎖 minioWatcher 的 continuation 迴圈（其餘測試 stub 皆單頁，此分支否則永不執行）。
    const tokenRequests: string[] = [];
    s3Stub = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const token = url.searchParams.get("continuation-token");
      tokenRequests.push(token ?? "(first)");
      res.writeHead(200, { "Content-Type": "application/xml" });
      if (!token) {
        res.end('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>true</IsTruncated><NextContinuationToken>tok2</NextContinuationToken><Contents><Key>899/main/p1/model.ifc</Key><ETag>&quot;pe1&quot;</ETag><Size>10</Size></Contents></ListBucketResult>');
      } else {
        res.end('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated><Contents><Key>900/main/p2/model.ifc</Key><ETag>&quot;pe2&quot;</ETag><Size>10</Size></Contents></ListBucketResult>');
      }
    });
    await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
    const a = s3Stub!.address();
    if (!a || typeof a === "string") throw new Error("s3 stub bind");
    const s3Base = `http://127.0.0.1:${a.port}`;
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    watcher = makeWatcher(s3Base, selfBase, { objs: [] });

    // 兩頁皆入 baseline = continuation 真的走到第二頁。
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 2);
    expect(tokenRequests).toContain("(first)");
    expect(tokenRequests).toContain("tok2");
  });

  it("首輪 baseline 不觸發（seen=N、triggered=0）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }, { key: "900/main/yyy/model.ifc", etag: "e2" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 2);
    // baseline 後再等幾輪，確認不觸發
    await new Promise((r) => setTimeout(r, 300));
    const st = watcher!.getStatus();
    expect(st.baseline_count).toBe(2);
    expect(st.seen_count).toBe(2);
    expect(st.triggered_total).toBe(0);
    expect(received.length).toBe(0);
  });

  it("第二輪新增物件 → 觸發一筆 intake，payload 與 header 正確", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    // 新增物件 → 下一輪應觸發
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);

    const { body, headers } = received[0];
    expect(body.event).toBe("ifc_ready");
    expect(body.tenant_id).toBe("tenant_demo_001"); // 來自 options.tenantId（makeWatcher 預設）
    expect(body.project_id).toBe("988");
    expect(body.project_display_name).toBe("988"); // 專案原名（英數→原樣；中文則保留中文，見 derive 單元測試）
    expect(body.model_category).toBe("main"); // 種類＝倒數第二層
    expect(body.external_model_version_id).toBe("zzz");
    expect((body.source_ifc as Record<string, unknown>).ref).toContain("988/main/zzz/model.ifc"); // presigned GET URL
    expect((body.source_ifc as Record<string, unknown>).ref).toMatch(/X-Amz-Signature=/); // 含簽章參數
    expect((body.source_ifc as Record<string, unknown>).etag).toBe("e9");
    expect(headers["x-webhook-secret"]).toBe("dev-webhook-secret");
    expect(String(headers["x-idempotency-key"])).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(String(headers["x-correlation-id"])).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("同物件後續輪不再觸發（seen 命中，triggered 維持 1）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);
    await new Promise((r) => setTimeout(r, 300)); // 多跑幾輪
    expect(received.length).toBe(1);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("層級不符 key → skipped_malformed 計數，不觸發", async () => {
    const state = { objs: [{ key: "899/main/seed/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    // 首輪即 baseline，但 malformed 不入 baseline 觸發域；改在新增 malformed 後驗 skip
    await waitFor(() => (watcher!.getStatus().last_poll_at as string | null) !== null);
    // 新規則：去 suffix 後僅 1 段 → 未湊齊三段 → malformed（不可再用 4 段，4 段在新規則為合法）。
    state.objs.push({ key: "also-bad/model.ifc", etag: "e2" });
    await waitFor(() => (watcher!.getStatus().skipped_malformed_total as number) >= 1);
    expect(received.length).toBe(0);
  });

  it("[t1] body.tenant_id 來自 options.tenantId（非硬編碼）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    // 部署切 tenant：watcher intake 必須帶入此 tenant，而非寫死 tenant_demo_001。
    watcher = makeWatcher(s3Base, selfBase, state, { tenantId: "tenant_acme_042" });

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);
    expect(received[0].body.tenant_id).toBe("tenant_acme_042");
  });

  it("[t4] status.poll_count 每輪 tick 完成後單調遞增（取代時間戳比較）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    // 首輪（baseline）跑完即 poll_count>=1
    await waitFor(() => (watcher!.getStatus().poll_count as number) >= 1);
    const c1 = watcher!.getStatus().poll_count as number;
    // 不依賴時鐘解析度：等到 poll_count 嚴格大於 c1（同毫秒也不會 false-negative）。
    await waitFor(() => (watcher!.getStatus().poll_count as number) > c1);
    expect(watcher!.getStatus().poll_count as number).toBeGreaterThan(c1);
  });

  it("[t3] selfBaseUrl 非 loopback host → startMinioWatcher fast-fail（SSRF 防護）", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received); // 啟一個 stub 但不會被打到
    void selfBase;
    expect(() =>
      makeWatcher("http://127.0.0.1:9000", "http://evil.example.com:8004", { objs: [] }),
    ).toThrow(/loopback|127\.0\.0\.1|localhost/i);
    // 也擋非 http scheme（避免 file:// / https 對外）
    expect(() =>
      makeWatcher("http://127.0.0.1:9000", "https://127.0.0.1:8004", { objs: [] }),
    ).toThrow(/http:|scheme|protocol/i);
  });

  it("[t2] dispose() 在 in-flight tick 的 SDK 請求進行中被呼叫 → await tick settle 後再 destroy，無 unhandled rejection", async () => {
    const s3Received: Array<{ at: number }> = [];
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startHangingS3Stub(s3Received);

    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => { unhandled.push(err); };
    process.on("unhandledRejection", onUnhandled);
    try {
      // 短 intervalSeconds → 首輪 tick 立刻發出 list（client.send），但 stub 永不回 → tick 卡在 await。
      watcher = makeWatcher(s3Base, selfBase, { objs: [] });
      // 等 S3 stub 確實收到 list 請求（=tick 的 client.send 已在途）。
      await waitFor(() => s3Received.length >= 1);

      // dispose 須為 async：set stopped → await 當前 tickPromise settle（2s 上限 race）→ destroy。
      const disposeResult = (watcher as { dispose: () => unknown }).dispose();
      expect(disposeResult).toBeInstanceOf(Promise);
      await disposeResult;
      watcher = null;

      // 給事件圈幾拍讓任何潛在的 client.destroy() 中斷例外有機會冒出來。
      await new Promise((r) => setTimeout(r, 100));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("list 失敗 → 記 last_error，不 crash，下輪重試", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    // s3 指向不可達 port → list 失敗
    watcher = startMinioWatcher({
      endpoint: "http://127.0.0.1:1",
      bucket: "bim-control", prefix: "", accessKey: "ak", secretKey: "sk",
      keySuffix: "/model.ifc", intervalSeconds: 0.05, selfBaseUrl: selfBase,
      webhookSecret: "dev-webhook-secret", tenantId: "tenant_demo_001",
      structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
    });
    await waitFor(() => (watcher!.getStatus().last_error as string | null) !== null);
    expect(String(watcher!.getStatus().last_error)).toBeTruthy();
    expect(received.length).toBe(0);
  });

  it("intake 回 2xx 但非 JSON body → triggered_total 不 +1，last_triggered 記錯誤（計數與狀態一致）", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startNonJsonIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    // intake 確實收到 POST（202），但回 HTML；watcher 不得把它計為成功觸發。
    // 自癒語意下失敗物件每輪重試 → received 會持續累積，不可斷言恰好 1 筆（exact 會 flaky）。
    await waitFor(() => received.length >= 1);
    await waitFor(() => watcher!.getStatus().last_triggered.length >= 1);

    const st = watcher!.getStatus();
    expect(st.triggered_total).toBe(0); // 非 JSON → 不算成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBeNull();
    expect(st.last_triggered[0]?.error).toBeTruthy(); // 記錯誤，與計數一致（非「成功但帶錯誤」）
    expect(st.last_error).toBeNull(); // 單一物件失敗不污染整輪 last_error
  });

  it("intake 長時間不回應 → fetch 逾時不凍結 loop，記 last_triggered.error 後續輪續跑", async () => {
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ at: number }> = [];
    const selfBase = await startHangingIntakeStub(received);
    const s3Base = await startS3Stub(state);
    // intakeTimeoutMs 放寬至 600ms（原 150ms 在 CI 高負載下 flaky：fetch 建立/排程的
    // 抖動可能逼近逾時窗）。若無 AbortSignal 保護則 fetch 永不 resolve、tick 卡死、
    // 後續輪不再排程 → 下方 poll_count 推進的斷言會 timeout。
    watcher = makeWatcher(s3Base, selfBase, state, { intakeTimeoutMs: 600 });

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });

    // intake 確實收到請求（但永不回） → 逾時後須記入 last_triggered.error
    await waitFor(() => received.length >= 1);
    await waitFor(() => watcher!.getStatus().last_triggered.length >= 1, 5000);

    const st = watcher!.getStatus();
    expect(st.triggered_total).toBe(0); // 逾時 → 不算成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBeNull();
    expect(st.last_triggered[0]?.error).toBeTruthy(); // AbortError 入 error，與其他網路失敗對等
    expect(st.last_error).toBeNull(); // 單一物件逾時不污染整輪 last_error

    // loop 未凍結：tick finally 仍排下一輪 → poll_count 會在逾時後繼續推進
    // （改用單調計數，不依賴 last_poll_at 時間戳的毫秒解析度，消除同毫秒 false-negative）。
    const pollCountAfterTrigger = watcher!.getStatus().poll_count as number;
    await waitFor(() => (watcher!.getStatus().poll_count as number) > pollCountAfterTrigger, 5000);
  });

  it("intake 暫時性失敗（5xx）→ 物件不標 seen、下輪重試，成功後鎖定不再重送（自癒）", async () => {
    // Codex review P1 修復鎖定：舊行為在 triggerIntake 前就 seen.set，一次 5xx/網路失敗會讓
    // 該物件之後每輪都命中 prev===etag 永不重試（與「漏抓自癒」宣稱矛盾）。
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
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
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });

    // 第一輪觸發吃到 500 → 不標 seen；下一輪重試吃到 202 → triggered_total=1。
    await waitFor(() => watcher!.getStatus().triggered_total === 1, 5000);
    expect(received.length).toBeGreaterThanOrEqual(2); // 至少一次失敗 + 一次成功 = 確實重試過
    expect(received[0].status).toBe(500);
    expect(received[received.length - 1].status).toBe(202);
    const st = watcher!.getStatus();
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBe("ifcready_retry_ok");
    expect(st.last_triggered[0]?.error).toBeNull();

    // 成功後 seen 鎖定：再跑幾輪不得重送（received 長度穩定）。
    const lenAfterSuccess = received.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBe(lenAfterSuccess);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("replay 回 download_status=failed 的既有 job → 不計觸發、誠實記錯誤、停止無效重試", async () => {
    // Codex review P1（failed-replay）鎖定：首次 POST 建了 job 但同步下載失敗（502，job 留存），
    // 重試命中同 idempotency key 拿到 200 replay（不重下載）。watcher 不得把它計成成功觸發
    // 後靜默結束，也不得無限重試（replay 永遠不會自癒）；須記入 last_triggered 帶 job_id+error。
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
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
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });

    // 第一輪 502（fail_transient 重試）→ 第二輪 200 replay failed（skip_permanent 停止）。
    await waitFor(() => received.length >= 2, 5000);
    await waitFor(() => {
      const lt = watcher!.getStatus().last_triggered;
      return lt.length >= 1 && lt[0]?.error !== null && lt[0]?.job_id === "ifcready_dlfail";
    }, 5000);

    const st = watcher!.getStatus();
    expect(st.triggered_total).toBe(0); // failed-job replay 不得計成功觸發
    expect(st.last_triggered[0]?.key).toBe("988/main/zzz/model.ifc");
    expect(st.last_triggered[0]?.job_id).toBe("ifcready_dlfail"); // 失敗綁 job_id（#/conv 可追）
    expect(String(st.last_triggered[0]?.error)).toContain("download_status=failed");

    // 停止無效重試：seen 已標，received 不再增長。
    const lenAfterReplay = received.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBe(lenAfterReplay);
  });

  it("keySuffix 不以 '/' 開頭 → startMinioWatcher fast-fail（防全物件靜默 skip）", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    expect(() =>
      makeWatcher("http://127.0.0.1:9000", selfBase, { objs: [] }, { keySuffix: "model.ifc" }),
    ).toThrow(/keySuffix.*'\/'|boundary-aligned/);
    expect(() =>
      makeWatcher("http://127.0.0.1:9000", selfBase, { objs: [] }, { keySuffix: "" }),
    ).toThrow(/keySuffix/);
  });

  it("重啟（新 watcher 實例、同 store）重掃同 key 同 etag → idempotent_replay 仍計觸發且 job_id 相同", async () => {
    // 起手只有既有 baseline 物件 899（保證新 watcher baseline 非空、語意明確）。
    const state = { objs: [{ key: "899/main/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ idemKey: string }> = [];
    const selfBase = await startIdempotentReplayIntakeStub(received);
    const s3Base = await startS3Stub(state);

    // 第一個 watcher：baseline 後新增 988 → 觸發一次（store 首見此 idempotency key → 建 job）。
    watcher = makeWatcher(s3Base, selfBase, state);
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);
    const firstStatus = watcher!.getStatus();
    expect(firstStatus.triggered_total).toBe(1);
    const firstJobId = firstStatus.last_triggered[0]?.job_id;
    expect(firstJobId).toBeTruthy();

    // 模擬重啟：dispose 舊 watcher（清掉 in-memory seen）。為讓新實例「重新看見」988 為
    // 增量（而非吞進新 baseline 永不觸發），先移除 988 → 新 watcher baseline 不含它，再加回
    // 同 key 同 etag。新 watcher 對它發 intake，store 以確定性 idempotency key 去重回 replay。
    // 必須 await：dispose 為 async（await in-flight tick settle）。若不等就改 state.objs
    // 並建新 watcher，舊 watcher 50ms 輪詢的 in-flight tick 可能在 state 變更後才打到
    // stub，多發一筆 intake 讓 received 累積到第 3 筆，打亂下方「恰好 2 筆」斷言而 flaky。
    await watcher.dispose();
    state.objs = [{ key: "899/main/xxx/model.ifc", etag: "e1" }];
    watcher = makeWatcher(s3Base, selfBase, state);
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/main/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 2);
    await waitFor(() => watcher!.getStatus().triggered_total >= 1);

    const secondStatus = watcher!.getStatus();
    // 兩次同一 idempotency key（重啟後 bucket/key/etag 不變 → idempotencyKeyFor 確定性）。
    expect(received[1].idemKey).toBe(received[0].idemKey);
    expect(received[1].idemKey).toMatch(/^mw_[0-9a-f]{16}$/);
    // 202 idempotent_replay 仍計觸發（誠實統計，與既有 comment 一致）。
    expect(secondStatus.triggered_total).toBe(1);
    // 同一筆 job：store 回相同 ifc_ready_job_id，未建第二筆 job。
    expect(secondStatus.last_triggered[0]?.job_id).toBe(firstJobId);
  });
});
