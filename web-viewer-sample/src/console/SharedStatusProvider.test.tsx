import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { useSharedStatus, type SharedStatusSnapshot } from "./useSharedStatus";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

function rt(activeCount: number): RuntimeStatus {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-07-03T00:00:00Z" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
      kit: [],
    },
    sessions: { count: 1, active_count: activeCount, participant_count: 0, items: [
      { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 2, expected_stage_url: null, conversion_status: "ready", kit_instance_ids: [], created_at: "", updated_at: "" },
    ] },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
  };
}

describe("SharedStatusProvider", () => {
  let container: HTMLDivElement;
  let captured: SharedStatusSnapshot | null;
  let root: Root | null;
  function Probe() { captured = useSharedStatus(); return null; }

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container); captured = null; root = null;
  });
  afterEach(async () => {
    // Unmount BEFORE restoring mocks / real timers so the effect cleanup clears the watchdog interval +
    // next-poll setTimeout while the spies (and any fake timers) are still installed — otherwise the
    // 5000ms auto-poll (spec §5.1) leaks a live loop that would later hit the real coordinatorClient.
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); vi.useRealTimers();
  });

  it("polls runtimeStatus once per cycle and maps sessions + null GPU + designed-null stage_matched", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [
      { idempotency_key: "k1", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
      { idempotency_key: "k2", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
    ] });
    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(statusSpy).toHaveBeenCalledTimes(1); // single poll, not per-child
    expect(captured?.activeSessions).toBe(1);
    expect(captured?.sessionsById["review_session_a"].participants).toBe(2);
    expect(captured?.sessionsById["review_session_a"].stage_matched).toBeNull();
    expect(captured?.gpuNodesTotal).toBeNull();
    expect(captured?.gpuNodesBusy).toBeNull();
    expect(captured?.health).toBe("ok");
    expect(captured?.conversionQueue).toBe(1); // only status ∈ {detected,queued,converting}
    expect(captured?.stale).toBe(false);
  });

  it("marks stale + unknown health when the poll fails", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("ECONNREFUSED"));
    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });
    expect(captured?.stale).toBe(true);
    expect(captured?.health).toBe("unknown");
  });

  it("uses an injected value and does not poll (test seam)", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus");
    const fixture: SharedStatusSnapshot = { activeSessions: 5, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };
    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider value={fixture}><Probe /></SharedStatusProvider>); });
    expect(statusSpy).not.toHaveBeenCalled();
    expect(captured?.activeSessions).toBe(5);
  });

  it("keeps conversionQueue null when getConversionRecords fails though runtimeStatus succeeds (honest 未取得)", async () => {
    // Exercises the inner catch (records unavailable → do not guess): the runtimeStatus half must still
    // map, the outer poll must not crash into the failure branch, and conversionQueue must degrade to
    // null rather than a fabricated count. `conversionQueue === null` here is only reachable via that
    // catch (the success path always assigns a filtered number).
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockRejectedValue(new Error("records 503"));
    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(captured?.conversionQueue).toBeNull();
    expect(captured?.activeSessions).toBe(1); // runtimeStatus half still mapped
    expect(captured?.health).toBe("ok");      // did not fall through to the outer catch
    expect(captured?.stale).toBe(false);      // a successful runtime poll is still fresh
  });

  it("flips stale AND degrades health to unknown once the last good poll is older than 2× the interval, even if no poll rejects (watchdog §5.2/§5.4)", async () => {
    // A request that hangs without ever rejecting (background-tab throttling / wedged socket) never
    // enters the catch, so stale would stay pinned false and expired data would be shown as fresh
    // (violates §5.4). The time-based watchdog must flip stale independently of whether a poll settled.
    vi.useFakeTimers();
    const hang = new Promise<RuntimeStatus>(() => {}); // never resolves, never rejects
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValueOnce(rt(1)).mockReturnValue(hang);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });

    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider pollMs={1000}><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(captured?.stale).toBe(false); // first poll succeeded → last-known-good is fresh
    expect(captured?.health).toBe("ok");

    // Next cycle's request hangs; advance past 2× the interval with no poll ever settling.
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(captured?.stale).toBe(true);
    // §5.4: aging out must NOT keep vouching for the last-known-good health. Silence = unknown (grey),
    // never a fresh green "ok" — symmetric with the catch branch and EMPTY_SHARED_STATUS (both stale+unknown).
    expect(captured?.health).toBe("unknown");
  });

  it("keeps conversionQueue null when the ledger window is truncated (count > items.length) — no under-report (§5.4)", async () => {
    // 後端 GET /api/conversion/records 回 { count: 未截斷總筆數, items: slice(0,limit) }，limit 上限 100
    // (app.ts parseListLimit)。當 ledger 總筆數 > 回傳窗時，佇列狀態 (detected/queued/converting) 的紀錄可能
    // 落在截斷窗外——對截斷子集算數字會靜默低報真實佇列深度，操作員會把低估值當真 (違反誠實鐵律/§5.4)。
    // 比照 pages.tsx ledgerChipStatus 的 recordsIncomplete 模式：截斷時退 null (未取得)，不臆測。
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 150, items: [
      { idempotency_key: "k1", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
    ] });
    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(captured?.conversionQueue).toBeNull(); // 截斷窗 → 未取得，不用截斷子集算出被低估的數字
    expect(captured?.activeSessions).toBe(1);     // runtimeStatus half still mapped
    expect(captured?.health).toBe("ok");          // did not fall through to the outer catch
  });

  it("does not spawn an orphan poll loop when the effect re-runs while a poll is in-flight (single loop, §12)", async () => {
    // spec §12: SharedStatusProvider 只建立「一條」輪詢。aliveRef 若是跨 effect 世代共用的 useRef，當 pollMs/value
    // 在掛載中變動觸發 effect 重跑時，舊 effect 的 cleanup 撥 false、新 effect 立刻把「同一個」ref 撥回 true；此時
    // 舊 effect 卡在 await 的 poll resume 後誤讀到 true，會 setSnapshot 並在 finally 重新 setTimeout 排下一輪——
    // 這條孤兒鏈只存在舊 closure，新 cleanup 清不到，與正確迴圈並存重複打 API。effect-local `cancelled` 可杜絕。
    vi.useFakeTimers();
    let releaseFirst!: (v: RuntimeStatus) => void;
    const firstHang = new Promise<RuntimeStatus>((res) => { releaseFirst = res; });
    vi.spyOn(coordinatorClient, "runtimeStatus").mockReturnValueOnce(firstHang).mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });

    root = createRoot(container);
    // gen-1: first poll is now suspended awaiting the hung runtimeStatus.
    await act(async () => { root!.render(<SharedStatusProvider pollMs={1000}><Probe /></SharedStatusProvider>); });
    // Dependency (pollMs) changes mid-flight → gen-1 cleanup runs, gen-2 effect starts a fresh loop.
    await act(async () => { root!.render(<SharedStatusProvider pollMs={2000}><Probe /></SharedStatusProvider>); });
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

    const timersBefore = vi.getTimerCount(); // gen-2's poll setTimeout + watchdog setInterval

    // gen-1's hung poll settles AFTER its own cleanup already ran. A shared alive-ref (reset to true by
    // gen-2) makes the stale poll believe it is still live and schedule an orphan setTimeout — a second,
    // invisible loop gen-2's cleanup can never clear. An effect-local cancelled flag returns early instead.
    await act(async () => { releaseFirst(rt(1)); for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

    expect(vi.getTimerCount()).toBe(timersBefore); // no orphan timer spawned → still a single poll loop
  });

  it("revives the poll loop after a request wedges without ever settling — one hung poll must not kill polling forever (Important #1, §5.1)", async () => {
    // jsonGet has no AbortController/timeout, so a wedged socket (connection accepted, no response, not
    // refused) leaves `await coordinatorClient.runtimeStatus()` suspended forever. poll()'s finally — the
    // ONLY place that schedules the next tick — then never runs, so the whole 5000ms auto-poll dies until a
    // manual page reload, even after the backend fully recovers. The watchdog must detect the wedged poll,
    // disown it, and start a fresh one so the loop self-heals instead of freezing on the first hang.
    vi.useFakeTimers();
    const hang = new Promise<RuntimeStatus>(() => {}); // never resolves, never rejects
    // 三段鏈：①首輪成功(rt(1)) → ②下一輪 wedge(hang，永不 settle，觸發 watchdog 接管) → ③之後每輪都成功(rt(2))，
    // 讓 watchdog 重啟的 poll 真正拿到 fresh 資料。若只 mockReturnValue(hang) 永遠卡住，只能驗「持續重試」、驗不到
    // 「復活後 snapshot 回到健康」（見下方後半斷言）。rt(2) 的 active_count=2 有別於 rt(1)，可證明是新鮮資料非殘影。
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValueOnce(rt(1)).mockReturnValueOnce(hang).mockResolvedValue(rt(2));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });

    root = createRoot(container);
    await act(async () => { root!.render(<SharedStatusProvider pollMs={1000}><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(statusSpy).toHaveBeenCalledTimes(1); // first poll succeeded; the next tick is scheduled

    // Every poll from the 2nd on hangs forever. Advancing many intervals: a dead loop would freeze the spy
    // at 2 calls (the success + the single wedged request); a self-healing loop keeps issuing fresh requests.
    await act(async () => { await vi.advanceTimersByTimeAsync(1000 * 12); });
    expect(statusSpy.mock.calls.length).toBeGreaterThan(2);

    // Important #1 的另一半：光是「持續重試」還不夠——復活後 snapshot 必須真的回到健康，否則使用者永遠盯著
    // stale/unknown。上面 mock 第三段讓某次 watchdog 重啟的 poll 真正成功（rt(2)），再前進數個間隔後，後端已
    // 收到的 fresh 資料必須落進 snapshot：stale 退回 false、health 回 ok、且活躍 session 更新成新值（2，非上次
    // rt(1) 的殘影），把「復活後端已收到 fresh 資料」這半也鎖進回歸測試。
    await act(async () => { await vi.advanceTimersByTimeAsync(1000 * 4); });
    expect(captured?.stale).toBe(false);
    expect(captured?.health).toBe("ok");
    expect(captured?.activeSessions).toBe(2);
  });
});
