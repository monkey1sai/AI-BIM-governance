import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, narrowConversionStatus } from "./coordinatorClient";

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

  // Task 6：getMinioFolder / conversionTrigger 測試
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

  it("conversionTrigger POST 帶 x-dev-token header，回 { status, idempotency_key }", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(
        JSON.stringify({ status: "queued", idempotency_key: "mw_abc123def4567890" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const r = await coordinatorClient.conversionTrigger("松風庵/root/main/000001/model.ifc", "manual-retry");
    expect(r.status).toBe("queued");
    expect(r.idempotency_key).toBe("mw_abc123def4567890");
    expect(calls[0].url).toContain("/api/conversion/trigger");
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.key).toBe("松風庵/root/main/000001/model.ifc");
    expect(body.reason).toBe("manual-retry");
    // 必須帶 x-dev-token header，且值須等於 dev 預設 token（後端 isKitMutationAuthorized 做嚴格
    // 相等 token === devToken，devToken 預設 "dev-token"，前端 DEV_AUTH_TOKEN fallback 亦為 "dev-token"）。
    // 用值相等而非 toBeTruthy：token 被改壞成 " "/"undefined" 等字面串時 toBeTruthy 仍通過、無法守 auth 合約。
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["x-dev-token"]).toBe("dev-token");
  });

  it("conversionTrigger 非 2xx 時 throw 並帶後端 detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "key not valid or insufficient segments" }), {
        status: 422,
        statusText: "Unprocessable Entity",
      }),
    );
    await expect(
      coordinatorClient.conversionTrigger("bad/key"),
    ).rejects.toThrow(/key not valid/);
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
