import { useEffect, useState, type ReactNode } from "react";
import { coordinatorClient } from "./coordinatorClient";
import { EMPTY_SHARED_STATUS, SharedStatusContext, type SharedSessionEntry, type SharedStatusSnapshot } from "./useSharedStatus";

const QUEUE_STATUSES = new Set(["detected", "queued", "converting"]);

// The single place in the repo that actually runs the 5000ms auto-poll of GET /api/runtime/status
// (spec §5.1). Existing pages keep their own mount-once fetch; only this provider polls on a timer.
export function SharedStatusProvider({ children, pollMs = 5000, value }: { children: ReactNode; pollMs?: number; value?: SharedStatusSnapshot }) {
  const [snapshot, setSnapshot] = useState<SharedStatusSnapshot>(value ?? EMPTY_SHARED_STATUS);

  useEffect(() => {
    if (value) return undefined; // test-injected snapshot → do not poll
    // Important #2: effect-local cancel flag (NOT a shared useRef). Each effect generation owns its own
    // `cancelled`; when pollMs/value change mid-flight and this effect re-runs, a stale in-flight poll from
    // the previous generation checks ITS OWN cancelled=true and returns early. A shared ref would be reset
    // to true by the new generation, resurrecting an orphan poll loop the new cleanup can never clear
    // (spec §12: SharedStatusProvider builds a single poll loop — no duplicate /api/runtime/status calls).
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Liveness / self-heal: jsonGet has no AbortController/timeout, so a wedged socket (accepted, never
    // answers, not refused) suspends the await below forever — poll()'s finally, the ONLY next-tick
    // scheduler, then never runs and the whole loop dies until a manual reload, even after the backend
    // recovers. The watchdog revives it. `pollGen` tags each poll so a revived-then-late-settling stale poll
    // is disowned (gen mismatch → drop, no duplicate loop per §12); `inFlightSince` is when the current
    // owner began its request (0 = between polls) so the watchdog tells a genuinely wedged poll from a
    // healthy idle gap.
    let pollGen = 0;
    let inFlightSince = 0;

    const poll = async (gen: number) => {
      inFlightSince = Date.now();
      try {
        const rt = await coordinatorClient.runtimeStatus();
        let conversionQueue: number | null = null;
        try {
          // reviewer P2（Codex，已核實）：getConversionRecords 是次要/optional 資料源；jsonGet 無
          // AbortController/timeout，若它卡住會拖住這一輪已成功拿到的 rt 遲遲無法發佈，直到外層 watchdog
          // （2×pollMs）才把 rt 一起丟掉重跑——白白浪費已成功的主要資料。本地加一個 pollMs 上限的 race，
          // 讓次要資料卡住時最多延遲 pollMs 就誠實降級為未取得（null），不阻塞主要 rt 資料的發佈；輸掉
          // race 的原請求仍在背景跑，附一個 no-op catch 吞掉它遲到的 rejection，避免 unhandled rejection。
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
        if (cancelled || gen !== pollGen) return; // cancelled OR disowned by a watchdog restart → drop
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
        setSnapshot({
          activeSessions: rt.sessions.active_count,
          sessionsById,
          gpuNodesTotal: null, // OQ3
          gpuNodesBusy: null,
          health: rt.service.status === "ok" ? "ok" : "degraded",
          conversionQueue,
          updatedAt: new Date().toISOString(),
          stale: false,
        });
      } catch {
        if (cancelled || gen !== pollGen) return;
        setSnapshot((prev) => ({ ...prev, health: "unknown", stale: true }));
      } finally {
        // Only the current owner clears the in-flight marker and schedules the next tick. A disowned stale
        // poll must touch neither — else it would clobber the live poll's marker or spawn an orphan loop.
        if (gen === pollGen) {
          inFlightSince = 0;
          if (!cancelled) timer = setTimeout(() => { void poll(gen); }, pollMs);
        }
      }
    };

    // Watchdog (spec §5.2: stale=true on「上次輪詢失敗 / 超過 2× 間隔」). The catch above only covers a
    // poll that *rejects*; a request that hangs without settling (background-tab throttling, wedged
    // socket — jsonGet has no AbortController/timeout) never enters the catch, so stale would stay
    // pinned at the last success (false) while the data quietly expires. §5.4 forbids presenting
    // last-known-good as fresh. This timer flips stale purely on elapsed time, independent of whether
    // any poll settled: if the last good snapshot is older than 2× the interval, it is no longer fresh.
    // It also degrades health to "unknown" in the same update: §5.4 says health is only "ok" when the
    // backend *currently* reports ready, and aging out means we no longer have a fresh reading — a green
    // "ok" over stale data is exactly the "last-known-good as fresh" the spec forbids. This matches the
    // catch branch and EMPTY_SHARED_STATUS, which both pair stale=true with health="unknown".
    const watchdog = setInterval(() => {
      if (cancelled) return;
      setSnapshot((prev) => {
        if (prev.stale) return prev; // already stale → no re-render churn
        const lastOk = Date.parse(prev.updatedAt);
        if (!Number.isFinite(lastOk)) return prev; // no successful poll yet → nothing to age out
        return Date.now() - lastOk > 2 * pollMs ? { ...prev, health: "unknown", stale: true } : prev;
      });
      // Liveness backstop: if the owning poll has been awaiting its request for longer than 2× the interval
      // it is wedged (a healthy coordinator answers in ms, not seconds). Disown it (bump pollGen so its
      // eventual late settle is dropped) and start a fresh poll, so one hung request can no longer
      // permanently kill the loop — polling self-heals the moment the backend recovers.
      if (inFlightSince !== 0 && Date.now() - inFlightSince > 2 * pollMs) {
        pollGen += 1;
        inFlightSince = 0;
        void poll(pollGen);
      }
    }, pollMs);

    pollGen = 1;
    void poll(pollGen);
    return () => { cancelled = true; if (timer) clearTimeout(timer); clearInterval(watchdog); };
  }, [pollMs, value]);

  return <SharedStatusContext.Provider value={value ?? snapshot}>{children}</SharedStatusContext.Provider>;
}
