import { useEffect, useRef, useState, type ReactNode } from "react";
import { coordinatorClient } from "./coordinatorClient";
import { EMPTY_SHARED_STATUS, SharedStatusContext, type SharedSessionEntry, type SharedStatusSnapshot } from "./useSharedStatus";

const QUEUE_STATUSES = new Set(["detected", "queued", "converting"]);

// The single place in the repo that actually runs the 5000ms auto-poll of GET /api/runtime/status
// (spec §5.1). Existing pages keep their own mount-once fetch; only this provider polls on a timer.
export function SharedStatusProvider({ children, pollMs = 5000, value }: { children: ReactNode; pollMs?: number; value?: SharedStatusSnapshot }) {
  const [snapshot, setSnapshot] = useState<SharedStatusSnapshot>(value ?? EMPTY_SHARED_STATUS);
  const aliveRef = useRef(true);

  useEffect(() => {
    if (value) return undefined; // test-injected snapshot → do not poll
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const rt = await coordinatorClient.runtimeStatus();
        let conversionQueue: number | null = null;
        try {
          const recs = await coordinatorClient.getConversionRecords(100);
          conversionQueue = recs.items.filter((r) => QUEUE_STATUSES.has(r.status)).length;
        } catch {
          conversionQueue = null; // records unavailable → 未取得, do not guess
        }
        if (!aliveRef.current) return;
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
        if (!aliveRef.current) return;
        setSnapshot((prev) => ({ ...prev, health: "unknown", stale: true }));
      } finally {
        if (aliveRef.current) timer = setTimeout(() => { void poll(); }, pollMs);
      }
    };

    // Watchdog (spec §5.2: stale=true on「上次輪詢失敗 / 超過 2× 間隔」). The catch above only covers a
    // poll that *rejects*; a request that hangs without settling (background-tab throttling, wedged
    // socket — jsonGet has no AbortController/timeout) never enters the catch, so stale would stay
    // pinned at the last success (false) while the data quietly expires. §5.4 forbids presenting
    // last-known-good as fresh. This timer flips stale purely on elapsed time, independent of whether
    // any poll settled: if the last good snapshot is older than 2× the interval, it is no longer fresh.
    const watchdog = setInterval(() => {
      if (!aliveRef.current) return;
      setSnapshot((prev) => {
        if (prev.stale) return prev; // already stale → no re-render churn
        const lastOk = Date.parse(prev.updatedAt);
        if (!Number.isFinite(lastOk)) return prev; // no successful poll yet → nothing to age out
        return Date.now() - lastOk > 2 * pollMs ? { ...prev, stale: true } : prev;
      });
    }, pollMs);

    void poll();
    return () => { aliveRef.current = false; if (timer) clearTimeout(timer); clearInterval(watchdog); };
  }, [pollMs, value]);

  return <SharedStatusContext.Provider value={value ?? snapshot}>{children}</SharedStatusContext.Provider>;
}
