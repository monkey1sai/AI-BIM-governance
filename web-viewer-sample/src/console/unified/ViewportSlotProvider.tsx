// UnifiedConsole — ViewportSlotProvider：viewportSlot.ts 契約的 state 持有者（純 context state，不碰 DOM、不發請求）。
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ReviewSessionViewerPaneBatchGate } from "../ReviewSessionViewerPane";
import { ViewportSlotContext } from "./viewportSlot";
import type { ViewportPublication, ViewportSlotApi } from "./viewportSlot";

export function ViewportSlotProvider({ children }: { children: ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [publication, setPublication] = useState<ViewportPublication | null>(null);
  const [activeSessionId, setActiveSessionIdState] = useState("");
  const [gate, setGateState] = useState<ReviewSessionViewerPaneBatchGate | null>(null);

  const registerSlot = useCallback((el: HTMLElement | null) => { setSlotEl(el); }, []);
  const setActiveSessionId = useCallback((sessionId: string) => {
    setActiveSessionIdState(sessionId.trim());
  }, []);
  const setGate = useCallback((next: ReviewSessionViewerPaneBatchGate | null) => {
    setGateState((prev) => (prev && next && prev.canSend === next.canSend && prev.reason === next.reason ? prev : next));
  }, []);
  const publish = useCallback((next: ViewportPublication | null) => {
    setPublication(next);
    // 播種共用 session：頁面帶來非空 session 即採用；頁面離場不清空（保住跨 dock 的 lease）。
    if (next && next.handoff.sessionId.trim()) setActiveSessionIdState(next.handoff.sessionId.trim());
    if (!next) setGateState(null);
  }, []);

  const value = useMemo<ViewportSlotApi>(() => ({
    registerSlot, slotEl, publish, publication, activeSessionId, setActiveSessionId, gate, setGate,
  }), [registerSlot, slotEl, publish, publication, activeSessionId, setActiveSessionId, gate, setGate]);

  return <ViewportSlotContext.Provider value={value}>{children}</ViewportSlotContext.Provider>;
}
