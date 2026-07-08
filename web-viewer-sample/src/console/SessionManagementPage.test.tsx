import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManagementPage } from "./pages";
import { coordinatorClient, type RuntimeStatus, type RuntimeSessionSummary } from "./coordinatorClient";

// IX-SS-04 spec §6.2 DoD：per-row「結束 session」控制動作的互動單元測試。
// ConversionSchedulingPage 的控制動作（prioritize/retry）已有完整 vitest；本檔對
// SessionManagementPage 補上同 pattern 覆蓋：結束鈕僅 active 顯示、IntentDialog→confirm→
// sessionClose→load 重抓、失敗顯誠實錯誤不關 dialog、terminatingIds 灰列 + 60s 後移除（fake timer）。
describe("SessionManagementPage 結束 session 控制動作（IX-SS-04）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  const makeSession = (over: Partial<RuntimeSessionSummary>): RuntimeSessionSummary => ({
    session_id: "sess_x", status: "active", project_id: "270", model_version_id: "v1",
    participant_count: 1, expected_stage_url: null, conversion_status: null,
    kit_instance_ids: [], created_at: "2026-06-17T00:00:00Z", updated_at: "2026-06-17T00:00:00Z",
    ...over,
  });

  const makeStatus = (items: RuntimeSessionSummary[]): RuntimeStatus => ({
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-06-17T00:00:00Z" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
      kit: [],
    },
    sessions: { count: items.length, active_count: items.filter((s) => s.status === "active").length, participant_count: 0, items },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "demo", note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [], kit_media_ports: [] },
    },
  });

  // 規格指定的呼叫介面 rtWith(status)：單一 status 字串 → 單列 review_session_t1 的 RuntimeStatus。
  // 內部複用 makeSession / makeStatus，保留兩層 helper 的靈活度，同時對齊規格範例的 rtWith("active") 形式。
  const rtWith = (status: string): RuntimeStatus =>
    makeStatus([makeSession({ session_id: "review_session_t1", status, project_id: "271", model_version_id: "mv1", participant_count: 0 })]);

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  // 照抄 ConversionSchedulingPage.test.tsx 的 SSR + client render 雙模式：先以 renderToString
  // 做 server-side smoke（無 mock、無 useEffect），確認頁面骨架可在 SSR 安全渲染、含治理標題與
  // Controlled actions 區塊，不依賴 coordinator 連線；其餘 it 走 client render 跑 useEffect → load()。
  it("SSR renderToString smoke：頁面骨架可在 server 安全渲染（不需 coordinator）", () => {
    const html = renderToString(<SessionManagementPage />);
    expect(html).toContain("Session 管理");
    expect(html).toContain("Controlled actions");
  });

  // E2E selector 穩定性（quality finding #1）：「重新整理」鈕須帶明確 data-testid="sessions-refresh"，
  // 讓 sessions-terminate.spec.ts 以唯一 testid 選取，消除 getByRole(name:/.../).first() 的模糊性
  // （此頁刷新鈕無 loading 態，原本正則的「讀取中」半邊永不匹配且 .first() 易誤點他列同文字鈕）。
  it("刷新鈕帶 data-testid=\"sessions-refresh\"（E2E 唯一選取）", () => {
    const root = createRoot(container);
    act(() => { root.render(<SessionManagementPage />); });
    const refresh = container.querySelector('[data-testid="sessions-refresh"]');
    expect(refresh).not.toBeNull();
    expect(refresh?.tagName).toBe("BUTTON");
    expect(refresh?.textContent).toContain("重新整理");
  });

  // spec test 1（rtWith("active")）：active session 顯示結束鈕；對齊規格範例的
  // session-terminate-review_session_t1 斷言（單列、單一 status 的最小契約）。
  it("active session 顯示結束鈕（session-terminate-review_session_t1）", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-terminate-review_session_t1"]')).not.toBeNull();
    // active 列不灰
    expect(container.querySelector('[data-testid="session-row-review_session_t1"]')?.className ?? "").not.toContain("ec-row-muted");
  });

  it("active session 顯示三欄證據：first_frame / heartbeat(stale) / stage_match", async () => {
    const now = Date.now();
    const session = {
      ...makeSession({
        session_id: "review_session_t1",
        status: "active",
        first_frame_at: new Date(now - 60_000).toISOString(),
        primary_viewer_lease_id: "lease_1",
      }),
      viewer_leases: [{
        lease_id: "lease_1",
        session_id: "review_session_t1",
        viewer_id: "viewer_1",
        user_id: "user_1",
        display_name: null,
        role: "primary",
        status: "active",
        kit_instance_id: null,
        stream_config: null,
        client_nonce: null,
        claimed_at: new Date(now - 90_000).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
        last_heartbeat_at: new Date(now - 20_000).toISOString(),
        released_at: null,
        first_frame_at: new Date(now - 60_000).toISOString(),
        loaded_stage_url: "s",
        datachannel_ready: true,
        stage_match: true,
      }],
    } as RuntimeSessionSummary;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(makeStatus([session]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    const row = container.querySelector('[data-testid="session-row-review_session_t1"]')!;
    expect(row.querySelector('[data-testid="ev-first-frame"]')!.textContent).not.toContain("未取得");
    expect(row.querySelector('[data-testid="ev-heartbeat"]')!.textContent).toContain("stale");
    expect(row.querySelector('[data-testid="ev-stage"]')!.textContent).toContain("matched");
  });

  it("無 lease 的 session 三欄一律顯示「未取得」不畫 fail", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    const row = container.querySelector('[data-testid="session-row-review_session_t1"]')!;
    for (const id of ["ev-first-frame", "ev-heartbeat", "ev-stage"]) {
      expect(row.querySelector(`[data-testid="${id}"]`)!.textContent).toMatch(/未取得|not observed/);
    }
  });

  it("A1BridgeSupplyPanel 顯示繫結鏈且證據與列表同源", async () => {
    const now = Date.now();
    const session = {
      ...makeSession({
        session_id: "review_session_t1",
        status: "active",
        first_frame_at: new Date(now - 1000).toISOString(),
        primary_viewer_lease_id: "lease_1",
      }),
      viewer_leases: [{
        lease_id: "lease_1",
        session_id: "review_session_t1",
        viewer_id: "viewer_1",
        user_id: "user_1",
        display_name: null,
        role: "primary",
        status: "active",
        kit_instance_id: null,
        stream_config: null,
        client_nonce: null,
        claimed_at: new Date(now - 90_000).toISOString(),
        expires_at: new Date(now + 60_000).toISOString(),
        last_heartbeat_at: new Date(now).toISOString(),
        released_at: null,
        first_frame_at: new Date(now - 1000).toISOString(),
        loaded_stage_url: "s",
        datachannel_ready: true,
        stage_match: true,
      }],
    } as RuntimeSessionSummary;
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(makeStatus([session]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });
    const panel = container.querySelector('[data-testid="a1-bridge-supply"]')!;
    const line = panel.querySelector('[data-testid="supply-review_session_t1"]')!;
    expect(line.textContent).toContain("review_session_t1");
    expect(line.textContent).toContain("DataChannel ✓");
    expect(line.textContent).toContain("stage matched");
  });

  // spec §6.2 延伸：結束鈕僅 status==="active" 顯示；closing / closed 不顯且灰列（多列對照覆蓋）。
  it("結束鈕僅在 active session 顯示，closing / closed session 不顯", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(makeStatus([
      makeSession({ session_id: "sess_active", status: "active" }),
      makeSession({ session_id: "sess_closing", status: "closing" }),
      makeSession({ session_id: "sess_closed", status: "closed" }),
    ]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-terminate-sess_active"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-terminate-sess_closing"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-terminate-sess_closed"]')).toBeNull();
    // closing / closed 列仍渲染（被灰列，不被過濾掉）
    expect(container.querySelector('[data-testid="session-row-sess_closing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-row-sess_closed"]')).not.toBeNull();
    // spec §6.2：closed / closing 列為灰列（ec-row-muted），active 列不灰。
    expect(container.querySelector('[data-testid="session-row-sess_closed"]')?.className).toContain("ec-row-muted");
    expect(container.querySelector('[data-testid="session-row-sess_closing"]')?.className).toContain("ec-row-muted");
    expect(container.querySelector('[data-testid="session-row-sess_active"]')?.className ?? "").not.toContain("ec-row-muted");
  });

  // spec test 2（rtWith("closed")）：單一 closed session → 灰列、無假按鈕。
  it("closed session 不給結束鈕（灰列、無假按鈕）", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("closed"));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="session-terminate-review_session_t1"]')).toBeNull();
    expect(container.querySelector('[data-testid="session-row-review_session_t1"]')?.className).toContain("ec-row-muted");
  });

  // spec test 3（呼叫序）：點按開 IntentDialog；confirm 呼叫 sessionClose("review_session_t1", "")；
  // 成功後 load() 重抓（非樂觀，rtSpy 至少被呼叫兩次：初載 + 重抓）。對齊規格範例的 session ID。
  it("confirm 呼叫 sessionClose(review_session_t1, \"\") 後 load() 重抓（非樂觀，呼叫序）", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
    const closeSpy = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "review_session_t1", status: "closing" } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const btn = container.querySelector('[data-testid="session-terminate-review_session_t1"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    // IntentDialog 開啟，title 為「結束 session」
    const dialog = container.querySelector('[data-testid="intent-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("結束 session");

    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // 空 textarea（未輸入）→ reason 傳 ""（對照下一個「填入原因」測試，凸顯此處空字串
    // 是 DOM 預設值 defaultValue="" 而非 undefined；後端以 trim()||undefined 收斂為乾淨 payload）。
    expect(closeSpy).toHaveBeenCalledWith("review_session_t1", "");
    expect(statusSpy.mock.calls.length).toBeGreaterThanOrEqual(2); // 初次 load + 成功後 load
    // 成功後關 dialog（非樂觀，重抓真狀態）
    expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
  });

  // IMPORTANT-2：鎖定 reason pass-through。textarea 填入非空原因 → confirm →
  // sessionClose(id, reason) 必須收到該原文字串（textarea → onConfirm → sessionClose）。
  // 此測試與上一個空字串案例互為對照，明確說明空 case 是「未輸入」而非「刻意傳 undefined」。
  it("textarea 填入原因 → confirm → sessionClose 收到該 reason 字串（pass-through）", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(
      makeStatus([makeSession({ session_id: "sess_reason" })]));
    const closeSpy = vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "sess_reason", status: "closing" } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const btn = container.querySelector('[data-testid="session-terminate-sess_reason"]') as HTMLButtonElement;
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    // IntentDialog 用 uncontrolled textarea（ref）；直接設 DOM value 即可被 ref.current.value 讀到。
    const reason = container.querySelector('#intent-reason') as HTMLTextAreaElement;
    expect(reason).not.toBeNull();
    await act(async () => { reason.value = "operator forced close"; });

    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(closeSpy).toHaveBeenCalledWith("sess_reason", "operator forced close");
  });

  // spec §6.2：失敗 → actionErr 顯示、dialog 不關、狀態不變。
  it("sessionClose reject → dialog 維持開啟、顯誠實錯誤、不靜默關閉", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(
      makeStatus([makeSession({ session_id: "sess_fail" })]));
    vi.spyOn(coordinatorClient, "sessionClose").mockRejectedValue(new Error("/api/review-sessions/sess_fail/close -> 409 conflict"));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const btn = container.querySelector('[data-testid="session-terminate-sess_fail"]') as HTMLButtonElement;
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    // 失敗不關 dialog
    expect(container.querySelector('[data-testid="intent-dialog"]')).not.toBeNull();
    // 誠實錯誤顯示在 dialog 內 intent-action-error 節點
    const actionErrNode = container.querySelector('[data-testid="intent-action-error"]');
    expect(actionErrNode).not.toBeNull();
    expect(actionErrNode!.textContent).toContain("結束 session 失敗");
    expect(actionErrNode!.textContent).toContain("409");
    // 狀態不變：該列仍 active、結束鈕仍在（未被灰列）
    expect(container.querySelector('[data-testid="session-terminate-sess_fail"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-row-sess_fail"]')!.getAttribute("data-terminating")).toBeNull();
  });

  // spec §4.3 / §6.2：成功後該列轉灰（terminatingIds）+ 60s 後從 terminatingIds 移除（fake timer 驗）。
  // 注意：mount load() 與 sessionClose 都是 microtask（非 timer），故用 Promise.resolve() flush；
  // 只有「60s 解除灰列」用 advanceTimersByTime 明確推進，避免 runAllTimers 提前燒掉 60s timer。
  it("成功 close 後該列轉灰（結束中…），60s 後解除灰列（fake timer）", async () => {
    vi.useFakeTimers();
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(
      makeStatus([makeSession({ session_id: "sess_grey" })]));
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "sess_grey", status: "closing" } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const btn = container.querySelector('[data-testid="session-terminate-sess_grey"]') as HTMLButtonElement;
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); }); // sessionClose 成功 → markTerminating + load() 兩段 microtask

    // 灰列：row data-terminating="true" 且該列顯「結束中…」、結束鈕消失
    const row = container.querySelector('[data-testid="session-row-sess_grey"]')!;
    expect(row.getAttribute("data-terminating")).toBe("true");
    expect(row.textContent).toContain("結束中…");
    expect(container.querySelector('[data-testid="session-terminate-sess_grey"]')).toBeNull();

    // 推進 60s → terminatingIds 移除該 id，灰列解除
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await act(async () => { await Promise.resolve(); });
    const rowAfter = container.querySelector('[data-testid="session-row-sess_grey"]')!;
    expect(rowAfter.getAttribute("data-terminating")).toBeNull();
    expect(rowAfter.textContent).not.toContain("結束中…");
    // 解灰列後 className 不應再含 ec-row-muted（greyed=false：terminating 已清、mock status 仍 active）。
    // 補上此斷言鎖住 greyed 條件，避免日後誤改 greyed 邏輯時此回歸無法被測試抓到。
    expect(rowAfter.className ?? "").not.toContain("ec-row-muted");
  });

  // spec §7：unmount 清除所有 60s timer，避免 setState-after-unmount / leak。
  it("成功 close 後 60s 內 unmount → 不殘留 timer（clearTimeout 清乾淨）", async () => {
    vi.useFakeTimers();
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(
      makeStatus([makeSession({ session_id: "sess_unmount" })]));
    vi.spyOn(coordinatorClient, "sessionClose").mockResolvedValue({ session_id: "sess_unmount", status: "closing" } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    const btn = container.querySelector('[data-testid="session-terminate-sess_unmount"]') as HTMLButtonElement;
    await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirm = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); }); // markTerminating + load() 兩段 microtask

    // 灰列確立後 unmount，timer 應被清除（unmount cleanup clearTimeout）
    expect(container.querySelector('[data-testid="session-row-sess_unmount"]')!.getAttribute("data-terminating")).toBe("true");
    await act(async () => { root.unmount(); });
    // 推進時間不應再觸發任何 callback / setState（無待處理 timer）
    expect(vi.getTimerCount()).toBe(0);
  });

  // 失敗載入：未連線 coordinator → 顯誠實錯誤、不渲染 session 表。
  it("runtimeStatus reject → 顯誠實未連線錯誤、不渲染 active session 表", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("ECONNREFUSED"));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("未連線 coordinator");
    expect(container.querySelector('[data-testid^="session-terminate-"]')).toBeNull();
  });

  it("輪詢 response 亂序時丟棄舊 response，避免 stale runtime status 覆蓋新表格", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: RuntimeStatus) => void;
    let resolveSecond!: (value: RuntimeStatus) => void;
    const first = new Promise<RuntimeStatus>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<RuntimeStatus>((resolve) => { resolveSecond = resolve; });
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus")
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockResolvedValue(makeStatus([]));
    const root = createRoot(container);
    await act(async () => { root.render(<SessionManagementPage />); });
    expect(statusSpy).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(statusSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveSecond(makeStatus([makeSession({ session_id: "sess_newer", status: "active" })]));
      await second;
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="session-row-sess_newer"]')).not.toBeNull();

    await act(async () => {
      resolveFirst(makeStatus([makeSession({ session_id: "sess_stale", status: "active" })]));
      await first;
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="session-row-sess_newer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="session-row-sess_stale"]')).toBeNull();
  });
});
