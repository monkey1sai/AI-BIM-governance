import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, narrowConversionStatus, CONVERSION_LIFECYCLE_STATUS_VALUES, type TriggerConversionResponse } from "./coordinatorClient";

describe("coordinatorClient conversion control", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("conversionPrioritize 打 POST .../prioritize 帶 reason，回 JSON", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_x", status: "queued_for_conversion", queue_position: 1 }), { status: 200 }),
    );
    const r = await coordinatorClient.conversionPrioritize("ifcready_x", "urgent");
    expect(r.status).toBe("queued_for_conversion");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/conversion/jobs/ifcready_x/prioritize");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(String((call[1] as RequestInit).body)).toContain("urgent");
  });

  it("conversionRetry 非 2xx 時 throw", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "nope" }), { status: 409, statusText: "Conflict" }));
    await expect(coordinatorClient.conversionRetry("ifcready_x")).rejects.toThrow();
  });

  it("conversionRetry 409 失敗把後端 detail 帶進錯誤訊息（鎖住 jsonPost errorDetail；與 conversionWatchToggle/sessionClose 對稱）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "nope" }), { status: 409, statusText: "Conflict" }),
    );
    await expect(coordinatorClient.conversionRetry("ifcready_x")).rejects.toThrow(/nope/);
  });

  it("conversionWatchToggle 發 PUT /api/conversion/watch，body 含 enabled/reason", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: (init as RequestInit)?.method, body: (init as RequestInit)?.body as string });
      return new Response(JSON.stringify({ enabled: false, note: "ok" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const res = await coordinatorClient.conversionWatchToggle(false, "smoke");
    expect(res.enabled).toBe(false);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/api/conversion/watch");
    expect(JSON.parse(calls[0].body!)).toEqual({ enabled: false, reason: "smoke" });
    spy.mockRestore();
  });

  it("conversionWatchToggle enabled:true 路徑回 200，body 含 enabled:true/reason", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), method: (init as RequestInit)?.method, body: (init as RequestInit)?.body as string });
      return new Response(JSON.stringify({ enabled: true, bucket: "ifc-ready", note: "watch on" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const res = await coordinatorClient.conversionWatchToggle(true, "operator-enable");
    expect(res.enabled).toBe(true);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("/api/conversion/watch");
    expect(JSON.parse(calls[0].body!)).toEqual({ enabled: true, reason: "operator-enable" });
    spy.mockRestore();
  });

  it("conversionWatchToggle 非 2xx 時 throw（對齊 conversionRetry 錯誤路徑）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "loopback not in allowlist" }), { status: 422, statusText: "Unprocessable Entity" }),
    );
    await expect(coordinatorClient.conversionWatchToggle(true, "operator-enable")).rejects.toThrow();
  });

  it("conversionWatchToggle 422 失敗把後端 detail 帶進錯誤訊息（誠實鐵律：不吞 not-configured 提示）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "MinIO watch not configured (endpoint/bucket/credentials missing); cannot enable." }),
        { status: 422, statusText: "Unprocessable Entity" },
      ),
    );
    await expect(coordinatorClient.conversionWatchToggle(true, "operator-enable")).rejects.toThrow(
      /MinIO watch not configured/,
    );
  });

  it("conversionWatchToggle 失敗 body 非 JSON 時退回原始 text，仍不丟 statusText 萃取錯誤", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream 502 plain text", { status: 502, statusText: "Bad Gateway" }),
    );
    await expect(coordinatorClient.conversionWatchToggle(true, "operator-enable")).rejects.toThrow(
      /upstream 502 plain text/,
    );
  });

  it("sessionClose 404 失敗把後端 detail 帶進錯誤訊息（誠實鐵律：不吞 session-not-found 提示）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "session not found" }), { status: 404, statusText: "Not Found" }),
    );
    await expect(coordinatorClient.sessionClose("review_session_missing", "operator terminate")).rejects.toThrow(
      /session not found/,
    );
  });

  it("sessionClose 400 失敗把後端 detail 帶進錯誤訊息（sessionId 不合法）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "invalid session id" }), { status: 400, statusText: "Bad Request" }),
    );
    await expect(coordinatorClient.sessionClose("../bad", "operator terminate")).rejects.toThrow(
      /invalid session id/,
    );
  });

  it("sessionClose POSTs to /close with reason body and encodes session id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ session_id: "review_session_abc", status: "closed" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const res = await coordinatorClient.sessionClose("review_session_abc", "operator terminate");
    expect(res.status).toBe("closed");
    expect(calls[0].url).toContain("/api/review-sessions/review_session_abc/close");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ reason: "operator terminate" });
  });

  it("sessionClose 省略 reason 參數時 POST body 為 {} 且不含 final_events（spec §4.2 optional reason / 強制結束無協作終結事件）", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ session_id: "review_session_abc", status: "closed" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    // 注意：此條走「省略 reason 參數」（sessionClose("id")）→ jsonPost 收 { reason: undefined }
    //   → JSON.stringify 丟棄 undefined 屬性 → wire body 為 {}。
    //   真實 UI 路徑（pages.tsx runTerminate）走 sessionClose(id, reason)，reason 來自 IntentDialog
    //   reasonRef.current?.value ?? ""，使用者未填時為空字串 "" → wire body 為 {"reason":""}，見下一條。
    const res = await coordinatorClient.sessionClose("review_session_abc");
    expect(res.status).toBe("closed");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({});
    expect("final_events" in body).toBe(false);
  });

  it("sessionClose 帶空字串 reason（使用者未填）時 POST body 為 {\"reason\":\"\"}（真實 UI 路徑 wire 契約）", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ session_id: "review_session_abc", status: "closed" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    // 真實 UI 路徑：pages.tsx runTerminate 走 sessionClose(sessionId, reason)，reason 來自
    //   IntentDialog reasonRef.current?.value ?? ""；使用者未填時 reason === ""。
    //   sessionClose("id", "") → jsonPost 收 { reason: "" }（"" 非 undefined，JSON.stringify 保留）
    //   → wire body 為 {"reason":""}（不是上一條的 {}）。
    const res = await coordinatorClient.sessionClose("review_session_abc", "");
    expect(res.status).toBe("closed");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ reason: "" });
    // 後端 app.ts:909 rawReason.trim().slice(0,500) || undefined 會把 "" 轉成 undefined →
    //   auditFields = {}（app.ts:912），cooperative close payload 不退化（runtime 正確，
    //   wire 帶 {"reason":""} 與後端把它視同無 reason 兩者並存無衝突）。
    expect("final_events" in body).toBe(false);
  });

  // Task 5：getConversionRecords / getMinioObjects 基本 wire 契約測試
  it("getConversionRecords 打 GET /api/conversion/records?limit=50（預設 limit）並回 { count, items }", async () => {
    const mockItems = [
      {
        idempotency_key: "mw_abc123def4567890",
        project_id: "mv_1a2b3c4d",
        project_display_name: "松風庵",
        category: "機電",
        external_model_version_id: "000001",
        conversion_job_id: null,
        status: "queued",
        usdc_key: null,
        coverage_report: null,
        detected_at: "2026-06-23T01:00:00.000Z",
        updated_at: "2026-06-23T01:00:00.000Z",
      },
    ];
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ count: 1, items: mockItems }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await coordinatorClient.getConversionRecords();
    expect(r.count).toBe(1);
    expect(r.items[0].status).toBe("queued");
    expect(r.items[0].project_display_name).toBe("松風庵");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/conversion/records?limit=50");
    expect((call[1] as RequestInit).method).toBeUndefined(); // GET 不帶 method（fetch 預設 GET）
  });

  it("getConversionRecords 帶自訂 limit 時 URL 含 limit=N", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ count: 0, items: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    await coordinatorClient.getConversionRecords(10);
    const calls = (vi.mocked(globalThis.fetch)).mock.calls;
    expect(String(calls[0][0])).toContain("/api/conversion/records?limit=10");
  });

  it("getMinioObjects 不帶 prefix 時打 /api/minio/objects（無 ?prefix= query string）", async () => {
    const mockObjects = [
      {
        key: "松風庵/root/main/000001/model.ifc",
        etag: "abc123",
        role: "source_ifc",
        project_id: "mv_1a2b3c4d",
        project_display_name: "松風庵",
        category: "main",
        version: "000001",
      },
    ];
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bucket: "bim-control", count: 1, objects: mockObjects }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await coordinatorClient.getMinioObjects();
    expect(r.bucket).toBe("bim-control");
    expect(r.count).toBe(1);
    expect(r.objects[0].role).toBe("source_ifc");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/minio/objects");
    expect(String(call[0])).not.toContain("?prefix=");
  });

  it("getMinioObjects 帶 prefix 時 URL 含 encodeURIComponent(prefix)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ bucket: "bim-control", count: 0, objects: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await coordinatorClient.getMinioObjects("松風庵/root/");
    const calls = (vi.mocked(globalThis.fetch)).mock.calls;
    expect(String(calls[0][0])).toContain(`?prefix=${encodeURIComponent("松風庵/root/")}`);
  });

  it("getConversionRecords 非 2xx 時 throw（與 listIfcReady 錯誤路徑對稱）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "server error" }), { status: 500, statusText: "Internal Server Error" }),
    );
    await expect(coordinatorClient.getConversionRecords()).rejects.toThrow();
  });

  it("getMinioObjects 502 時 throw（MinIO 無法連線情境）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "minio_list_failed", detail: "ECONNREFUSED" }), {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    await expect(coordinatorClient.getMinioObjects()).rejects.toThrow();
  });

  // Task 6：getMinioFolder 測試（mine，KEEP）；conversionTrigger 測試已移除（方向1：觸發交給 main triggerConversion）
  it("getMinioFolder 打 GET /api/minio/objects?delimiter=/ 並回 { folders, objects, prefix, bucket, count }", async () => {
    // 真實 wire shape（後端 MinioFolderNode[]，spec §2.5 第 5 點 has_source_ifc badge）：
    // folders 每個元素 = { prefix, has_source_ifc }，非純字串陣列。
    const mockFolders = [
      { prefix: "松風庵/root/", has_source_ifc: true },
      { prefix: "洲際好宅/", has_source_ifc: false },
    ];
    // role='other' 物件後端仍無條件計算 idempotency_key（minioClient.ts:133），故為 string 非 null。
    const mockObjects = [
      {
        key: "annotations/readme.txt",
        etag: "xyz789",
        role: "other",
        project_id: null,
        project_display_name: null,
        category: null,
        version: null,
        idempotency_key: "mw_0011223344556677",
      },
    ];
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ bucket: "bim-control", prefix: "", count: 2, folders: mockFolders, objects: mockObjects }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await coordinatorClient.getMinioFolder();
    expect(r.bucket).toBe("bim-control");
    // prefix 傳遞契約錨點（無 prefix 參數呼叫時後端回 rawPrefix，預設 config.minioWatchPrefix=""）。
    expect(r.prefix).toBe("");
    expect(r.folders).toEqual([
      { prefix: "松風庵/root/", has_source_ifc: true },
      { prefix: "洲際好宅/", has_source_ifc: false },
    ]);
    // 對齊真實後端：folders 元素是物件、可安全做字串操作（folder.prefix.endsWith('/')）。
    expect(r.folders[0].prefix.endsWith("/")).toBe(true);
    expect(r.folders[0].has_source_ifc).toBe(true);
    expect(r.objects[0].role).toBe("other");
    // role='other' 後端仍回 string idempotency_key（非 null）。
    expect(r.objects[0].idempotency_key).toBe("mw_0011223344556677");
    const call = spy.mock.calls[0];
    const url = String(call[0]);
    expect(url).toContain("/api/minio/objects");
    expect(url).toContain("delimiter=%2F");
    // 不帶 prefix 時不帶 prefix= query
    expect(url).not.toContain("prefix=");
  });

  it("getMinioFolder 帶 prefix 時 URL 同時含 prefix= 和 delimiter=/", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ bucket: "bim-control", prefix: "松風庵/", count: 0, folders: [], objects: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await coordinatorClient.getMinioFolder("松風庵/");
    const calls = (vi.mocked(globalThis.fetch)).mock.calls;
    const url = String(calls[0][0]);
    expect(url).toContain(`prefix=${encodeURIComponent("松風庵/")}`);
    expect(url).toContain("delimiter=%2F");
  });

  it("getMinioFolder 502 時 throw（MinIO 無法連線情境；AC-honesty：error 顯原因可重試，與 getMinioObjects 502 對稱）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "minio_list_failed", detail: "ECONNREFUSED" }), {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );
    await expect(coordinatorClient.getMinioFolder()).rejects.toThrow();
  });

  it("getMinioFolder MinIO 未設定時 folders 為 []（後端 early-return 補 folders，消費端 r.folders.map 不 crash）", async () => {
    // 後端 /api/minio/objects 未設定分支（app.ts）現補 folders: [] 與已設定分支 listMinioFolder shape 對齊。
    // 鎖此契約：getMinioFolder 收到未設定回應時 folders 為陣列（非 undefined），UI 可安全 .map()，
    // 防 finding「未設定 + delimiter=/ 缺 folders → 消費端 TypeError crash」regression。
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ bucket: null, prefix: "", folders: [], count: 0, objects: [], note: "MinIO watch 未設定（未取得）" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const r = await coordinatorClient.getMinioFolder();
    expect(r.bucket).toBeNull();
    expect(Array.isArray(r.folders)).toBe(true);
    expect(r.folders).toEqual([]);
    // 直接驗 UI 端 .map() 不 throw（finding：消費端對 folders crash 風險）。
    expect(() => r.folders.map((f) => f.prefix)).not.toThrow();
  });

});

// Task 6 chip-patch runtime guard：narrowConversionStatus 把 wire 寬 string 收斂成
// ConversionLedgerStatus；非法值回 null（誠實鐵律：chip-patch 不靜默設成壞狀態）。
describe("narrowConversionStatus", () => {
  it("合法 ConversionLedgerStatus 原樣回傳", () => {
    for (const s of ["detected", "queued", "converting", "ready", "failed"] as const) {
      expect(narrowConversionStatus(s)).toBe(s);
    }
  });

  it("非法 wire status（後端送非預期字串）回 null，呼叫端據以顯 unknown / 不 patch", () => {
    expect(narrowConversionStatus("dispatched")).toBeNull();
    expect(narrowConversionStatus("")).toBeNull();
    expect(narrowConversionStatus("QUEUED")).toBeNull(); // 大小寫敏感：非合法集合成員
    expect(narrowConversionStatus("undefined")).toBeNull();
  });
});

describe("coordinatorClient triggerConversion / getIfcReadyJob（PR#259，方向1 觸發交給 main）", () => {
  it("triggerConversion 打 POST /api/conversion/trigger 帶 key，202 回 ifc_ready_job_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_mw_abc", status: "queued_for_conversion", trigger_source: "manual" }), { status: 202 }),
    );
    const r = await coordinatorClient.triggerConversion("專案A/root/main/uuid/model.ifc");
    expect(r.ifc_ready_job_id).toBe("ifcready_mw_abc");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/conversion/trigger");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ key: "專案A/root/main/uuid/model.ifc" });
  });

  it("triggerConversion forceRetrigger 會送 force_retrigger=true", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_mw_retry", force_retrigger: true }), { status: 202 }),
    );
    await coordinatorClient.triggerConversion("專案A/root/main/uuid/model.ifc", { forceRetrigger: true });
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toEqual({
      key: "專案A/root/main/uuid/model.ifc",
      force_retrigger: true,
    });
  });

  it("triggerConversion 503（MinIO 未設定）throw 帶後端 detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "MinIO 未設定（endpoint/bucket/credentials 不齊全）" }), { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(coordinatorClient.triggerConversion("k")).rejects.toThrow(/MinIO 未設定/);
  });

  it("getIfcReadyJob 打 GET /api/external/ifc-ready/:jobId，回 conversion_lifecycle_status", async () => {
    // quality finding #2：此 mock 的 conversion_lifecycle_status 對應真實後端 detail 端點——
    // app.ts GET /api/external/ifc-ready/:jobId 已上 wire deriveLifecycleStatus(job)，
    // 後端回歸鎖在 bim-review-coordinator/tests/external-ifc-ready.test.ts「單筆 detail」測試。非虛構欄位。
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_mw_abc", status: "queued_for_conversion", conversion_lifecycle_status: "queued", download_status: "downloaded", conversion_status: null, review_session_id: null }), { status: 200 }),
    );
    const r = await coordinatorClient.getIfcReadyJob("ifcready_mw_abc");
    expect(r.conversion_lifecycle_status).toBe("queued");
    expect(String(spy.mock.calls[0][0])).toContain("/api/external/ifc-ready/ifcready_mw_abc");
  });

  it("getIfcReadyJob 404（job 不存在）throw 帶後端 detail（jsonGet errorDetail，與 jsonPost/jsonPut 對稱；A1 輪詢誠實顯示可操作提示）", async () => {
    // 修前 jsonGet 只 throw statusText → 操作員看到無意義「404 Not Found」；修後萃取後端 detail（誠實鐵律）。
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "ifc-ready job 不存在" }), { status: 404, statusText: "Not Found" }),
    );
    await expect(coordinatorClient.getIfcReadyJob("ifcready_missing")).rejects.toThrow(/ifc-ready job 不存在/);
  });

  it("getIfcReadyJob 失敗 body 非 JSON 時退回原始 text（errorDetail best-effort，不讓萃取錯誤遮蔽 HTTP 失敗）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream 502 plain", { status: 502, statusText: "Bad Gateway" }),
    );
    await expect(coordinatorClient.getIfcReadyJob("ifcready_x")).rejects.toThrow(/upstream 502 plain/);
  });

  it("ConversionLifecycleStatus 值集鎖定（鏡像後端 ConversionLedgerStatus；前端被悄改時 CI 攔，後端增值須人工同步此處）", () => {
    // 前後端無 shared schema；此測試鎖住前端值集，使任何前端遺漏/誤改在 CI 顯性失敗。
    expect([...CONVERSION_LIFECYCLE_STATUS_VALUES]).toEqual(["detected", "queued", "converting", "ready", "failed"]);
  });
});

// ── TriggerConversionResponse 型別契約斷言（compile-time only；由 `npx tsc --noEmit` 守門，
//    vitest 執行期為無副作用 no-op）。鎖住兩條契約避免日後被悄悄放寬（quality finding #1 / #2）──
//   #1 ifc_ready_job_id 必為 string（非 optional）：B1 後端（PR #259）202 永遠帶此欄；optional 會逼
//      Task 3 消費端做 undefined 守門（`!.` 砍掉型別安全網，或 `?? ""` 打 bogus URL → 404）。
//   #2 不得有 detail 欄位：jsonPost 在 !res.ok 時已 throw（後端 detail 經 errorDetail 注入 Error
//      message），success-path 的 detail 恆 undefined；留此欄會給「可讀回傳物件 detail」的錯誤合約
//      暗示。轉檔已排入 vs 冪等回傳既有的語意差異改由既有 trigger_source 表達。
{
  const probe: TriggerConversionResponse = { ifc_ready_job_id: "ifcready_x" };
  // #1：非 optional 才能把 ifc_ready_job_id 直接賦值給 string（optional 時為 string | undefined 不可賦值）。
  const jobId: string = probe.ifc_ready_job_id;
  void jobId;
  // @ts-expect-error #2：detail 欄位已移除，讀取應為型別錯誤（TS2339）。
  void probe.detail;
}
