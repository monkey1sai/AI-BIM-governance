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

    const poll = async () => {
      try {
        const rt = await coordinatorClient.runtimeStatus();
        let conversionQueue: number | null = null;
        try {
          const recs = await coordinatorClient.getConversionRecords(100);
          // Important #1: /api/conversion/records 有 limit（後端 parseListLimit 上限 100）。recs.count 是 slice
          // 前的總筆數、recs.items 是被截斷的回傳窗；count > items.length 即截斷，佇列狀態紀錄可能落在窗外，
          // 對截斷子集算數字會靜默低報真實佇列深度（操作員會把低估值當真）。比照 pages.tsx ledgerChipStatus 的
          // recordsIncomplete 模式：截斷時退 null（未取得），不臆測（誠實鐵律 / §5.4）。
          conversionQueue = recs.count > recs.items.length
            ? null // 截斷窗：可能有佇列紀錄落在回傳窗外 → 未取得，不用截斷子集低報
            : recs.items.filter((r) => QUEUE_STATUSES.has(r.status)).length;
        } catch {
          conversionQueue = null; // records unavailable → 未取得, do not guess
        }
        if (cancelled) return;
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
        if (cancelled) return;
        setSnapshot((prev) => ({ ...prev, health: "unknown", stale: true }));
      } finally {
        if (!cancelled) timer = setTimeout(() => { void poll(); }, pollMs);
      }
    };

    // Watchdog (spec §5.2: stale=true on「上次輪詢失敗 / 超過 2× 間隔」). The catch above only covers a
    // poll that *rejects*; a request that hangs without settling (background-tab throttling, wedged
    // socket — jsonGet has no AbortController/timeout) never enters the catch, so stale would stay
    // pinned at the last success (false) while the data quietly expires. §5.4 forbids presenting
    // last-known-good as fresh. This timer flips stale purely on elapsed time, independent of whether
    // any poll settled: if the last good snapshot is older than 2× the interval, it is no longer fresh.
    const watchdog = setInterval(() => {
      if (cancelled) return;
      setSnapshot((prev) => {
        if (prev.stale) return prev; // already stale → no re-render churn
        const lastOk = Date.parse(prev.updatedAt);
        if (!Number.isFinite(lastOk)) return prev; // no successful poll yet → nothing to age out
        return Date.now() - lastOk > 2 * pollMs ? { ...prev, stale: true } : prev;
      });
    }, pollMs);

    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); clearInterval(watchdog); };
  }, [pollMs, value]);

  return <SharedStatusContext.Provider value={value ?? snapshot}>{children}</SharedStatusContext.Provider>;
}
