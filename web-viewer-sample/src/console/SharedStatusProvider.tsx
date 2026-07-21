import { useCallback, useMemo, type ReactNode } from "react";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { EMPTY_SHARED_STATUS, SharedStatusContext, type SharedSessionEntry, type SharedStatusSnapshot } from "./useSharedStatus";
import { usePolledResource } from "./usePolledResource";

const QUEUE_STATUSES = new Set(["detected", "queued", "converting"]);

// 一輪輪詢取回的中間結果：主要資料 rt 必須成功；次要資料 conversionQueue 可誠實降級為 null（未取得）。
interface SharedPollResult {
  rt: RuntimeStatus;
  conversionQueue: number | null;
}

// The single place in the repo that actually runs the 5000ms auto-poll of GET /api/runtime/status
// (spec §5.1). Existing pages keep their own mount-once fetch; only this provider polls on a timer.
//
// C2：輪詢生命週期（effect-local cancel 旗標、gen-token 丟棄 stale settle、逾時 watchdog 自癒、
// 資料時效 watchdog、unmount 清理）全部下沉到 usePolledResource——本檔 2026-07 之前版本註解裡踩過的
// 每個坑（孤兒迴圈 §12、wedged socket 殺死迴圈、stale 冒充新鮮 §5.4、計時器洩漏）現在由 hook 內建處理，
// 並鎖在 usePolledResource.test.tsx；本檔只剩「抓什麼」與「怎麼映射成 SharedStatusSnapshot」。
export function SharedStatusProvider({ children, pollMs = 5000, value }: { children: ReactNode; pollMs?: number; value?: SharedStatusSnapshot }) {
  const fetchShared = useCallback(async (signal: AbortSignal): Promise<SharedPollResult> => {
    const rt = await coordinatorClient.runtimeStatus();
    if (signal.aborted) return { rt, conversionQueue: null }; // 已被 disown：結果會被丟棄，不必再抓次要資料
    let conversionQueue: number | null = null;
    try {
      // reviewer P2（Codex，已核實）：getConversionRecords 是次要/optional 資料源；jsonGet 無
      // AbortController/timeout，若它卡住會拖住這一輪已成功拿到的 rt 遲遲無法發佈，直到 hook 的逾時
      // watchdog（2×pollMs）才把 rt 一起丟掉重跑——白白浪費已成功的主要資料。本地加一個 pollMs 上限的
      // race，讓次要資料卡住時最多延遲 pollMs 就誠實降級為未取得（null），不阻塞主要 rt 資料的發佈；
      // 輸掉 race 的原請求仍在背景跑，附一個 no-op catch 吞掉它遲到的 rejection，避免 unhandled rejection。
      const recsPromise = coordinatorClient.getConversionRecords(100);
      recsPromise.catch(() => {});
      let raceTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const recs = await Promise.race([
          recsPromise,
          new Promise<never>((_, reject) => {
            raceTimer = setTimeout(() => reject(new Error("conversion records fetch exceeded pollMs budget")), pollMs);
          }),
        ]);
        // Important #1: /api/conversion/records 有 limit（後端 parseListLimit 上限 100）。recs.count 是 slice
        // 前的總筆數、recs.items 是被截斷的回傳窗；count > items.length 即截斷，佇列狀態紀錄可能落在窗外，
        // 對截斷子集算數字會靜默低報真實佇列深度（操作員會把低估值當真）。比照 pages.tsx ledgerChipStatus 的
        // recordsIncomplete 模式：截斷時退 null（未取得），不臆測（誠實鐵律 / §5.4）。
        conversionQueue = recs.count > recs.items.length
          ? null // 截斷窗：可能有佇列紀錄落在回傳窗外 → 未取得，不用截斷子集低報
          : recs.items.filter((r) => QUEUE_STATUSES.has(r.status)).length;
      } finally {
        // quality（self-review）：race 贏家若是 recsPromise，這個 timer 仍是 pending，必須手動清掉，
        // 否則每輪 poll 都留一個不會被清除的 timer，累積成計時器洩漏（vi.getTimerCount() 迴歸測試會抓到）。
        clearTimeout(raceTimer);
      }
    } catch {
      conversionQueue = null; // records unavailable or timed out → 未取得, do not guess
    }
    return { rt, conversionQueue };
  }, [pollMs]);

  // value（test-injected snapshot）→ enabled:false 完全不輪詢（原 `if (value) return undefined` 語意）。
  // timeoutMs / staleAfterMs 用 hook 預設 2×pollMs，等同原 watchdog 的「超過 2× 間隔」規格（§5.2）。
  const polled = usePolledResource<SharedPollResult>(fetchShared, {
    intervalMs: pollMs,
    enabled: !value,
  });

  const snapshot = useMemo<SharedStatusSnapshot>(() => {
    if (!polled.data) return EMPTY_SHARED_STATUS; // 尚無任何成功輪詢（含首輪失敗）：EMPTY 本身即 stale+unknown
    const { rt, conversionQueue } = polled.data;
    // §5.4：只有「最近一次 settle 成功且仍在時效內」（status==="success"）才能當新鮮資料呈現。
    // error（下一輪失敗）與 stale（懸置/節流超齡，hook 的時效 watchdog 翻的）都保留上一份數字但
    // 誠實標 stale=true、health 退 unknown——絕不把 last-known-good 冒充新鮮綠燈（§5.2/§5.4）。
    const fresh = polled.status === "success";
    const sessionsById: Record<string, SharedSessionEntry> = {};
    for (const s of rt.sessions.items) {
      sessionsById[s.session_id] = {
        session_id: s.session_id,
        status: s.status,
        participants: s.participant_count,
        conversion: s.conversion_status,
        stage_matched: null, // designed null (§5.2)
      };
    }
    return {
      activeSessions: rt.sessions.active_count,
      sessionsById,
      gpuNodesTotal: null, // OQ3
      gpuNodesBusy: null,
      health: fresh ? (rt.service.status === "ok" ? "ok" : "degraded") : "unknown",
      conversionQueue,
      updatedAt: polled.lastUpdatedAt == null ? "" : new Date(polled.lastUpdatedAt).toISOString(),
      stale: !fresh,
    };
  }, [polled.data, polled.status, polled.lastUpdatedAt]);

  return <SharedStatusContext.Provider value={value ?? snapshot}>{children}</SharedStatusContext.Provider>;
}
