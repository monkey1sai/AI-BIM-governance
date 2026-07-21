// C2：usePolledResource — 統一前端輪詢生命週期的深 hook。
// 規格來源＝SharedStatusProvider.tsx 註解裡反覆踩過的坑（watchdog / gen-token / timer-leak / 孤兒迴圈），
// 全部內建於 hook、對呼叫者不可見。刻意「只做輪詢生命週期」：不做 cache/SWR/全域 store。
//
// 內建處理的坑（對應 SharedStatusProvider 原註解）：
//  1. effect-local `cancelled` 旗標（非共用 useRef）：effect 依賴變動重跑時，舊世代 in-flight poll 讀到
//     「自己那份」cancelled=true 提早返回；共用 ref 會被新世代撥回，復活孤兒迴圈（§12 單一輪詢）。
//  2. gen-token 丟棄 stale settle：只有現任 owner 能發佈結果／排下一輪；被 disown 的舊 poll 遲到 settle
//     一律丟棄，不得清 in-flight 標記、不得再排 timer（否則孤兒 setTimeout 鏈清不掉）。
//  3. 逾時 watchdog（timeoutMs，預設 2×intervalMs）：fetcher 卡死（socket wedge、accepted 不回應）時
//     await 永久懸置，settle 驅動的排程器就此死透——逾時計時器 abort＋disown＋記 error＋照常排下一輪，
//     單一卡死請求不再永久殺死輪詢（自癒）。逾時計時器在 settle 時必清，避免每輪殘留計時器洩漏。
//  4. 資料時效 watchdog（staleAfterMs，預設 2×intervalMs）：請求既不 resolve 也不 reject（背景分頁節流）
//     不會進 catch，成功殘影會被當新鮮資料呈現——時間基準獨立翻 status="stale"，不看 settle 與否。
//  5. unmount／依賴變動 cleanup：清 next-tick timer、逾時 timer、watchdog interval，abort in-flight
//     AbortController；cancelled 後絕不 setState。
//  6. 可選 backoff：連續失敗時下一輪延遲 intervalMs×factor^n（上限 backoffMaxMs），成功即重置。
import { useCallback, useEffect, useRef, useState } from "react";

export type PolledResourceStatus =
  | "idle"      // enabled=false（或尚未啟動）
  | "loading"   // 首次抓取中，尚無任何資料
  | "success"   // 最近一次 settle 成功且仍在時效內
  | "error"     // 最近一次 settle 失敗（含逾時）；data 保留上一次成功值，不擦除
  | "stale";    // 上次成功已超過 staleAfterMs 且無更新 settle（懸置/節流）→ 不得再當新鮮資料

export interface UsePolledResourceOptions {
  intervalMs: number;
  /** in-flight 逾時（watchdog）：超過即 abort＋disown 並照常排下一輪。預設 2×intervalMs。 */
  timeoutMs?: number;
  /** 資料時效：上次成功超齡即 status="stale"。預設 2×intervalMs。 */
  staleAfterMs?: number;
  /** false → 完全不輪詢（status="idle"），true 回復時重啟迴圈。預設 true。 */
  enabled?: boolean;
  /** false → 掛載後第一輪等滿 intervalMs 才發（等價裸 setInterval 的節奏，供「mount 已自抓一次」的頁面）。預設 true。 */
  immediate?: boolean;
  /** 連續失敗 backoff 倍率（>1 才生效）；延遲 = min(intervalMs×factor^連續失敗數, backoffMaxMs)。 */
  backoffFactor?: number;
  /** backoff 延遲上限。預設 10×intervalMs。 */
  backoffMaxMs?: number;
}

export interface PolledResource<T> {
  /** 最後一次成功結果；失敗/超齡不擦除（呼叫端依 status 決定是否當新鮮資料呈現）。 */
  data: T | null;
  /** 最後一次失敗原因；成功時清為 null。 */
  error: unknown;
  status: PolledResourceStatus;
  /** 最後一次成功 settle 的 epoch ms；尚無成功為 null。 */
  lastUpdatedAt: number | null;
  /** 立即刷新：disown/abort 任何 in-flight poll、清掉已排的下一輪，現在就發一輪並自此重新計時。 */
  refresh: () => void;
}

interface PolledState<T> {
  data: T | null;
  error: unknown;
  status: PolledResourceStatus;
  lastUpdatedAt: number | null;
}

export function usePolledResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: UsePolledResourceOptions,
): PolledResource<T> {
  const { intervalMs, enabled = true, immediate = true } = opts;
  const timeoutMs = opts.timeoutMs ?? 2 * intervalMs;
  const staleAfterMs = opts.staleAfterMs ?? 2 * intervalMs;
  const backoffFactor = opts.backoffFactor ?? 1;
  const backoffMaxMs = opts.backoffMaxMs ?? 10 * intervalMs;

  const [state, setState] = useState<PolledState<T>>({
    data: null,
    error: null,
    status: enabled ? "loading" : "idle",
    lastUpdatedAt: null,
  });

  // fetcher 走 ref：inline arrow 每 render 換 identity 不得摧毀迴圈重建（依賴風暴是各頁手寫輪詢的
  // 常見坑之一）。宣告在主 effect 之前，確保同一次 commit 先更新 ref 再啟動迴圈。
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  // refresh 對外恆定 identity；實作由現任 effect 世代掛載、cleanup 時卸回 no-op（unmount 後呼叫安全）。
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => { refreshRef.current(); }, []);

  useEffect(() => {
    if (!enabled) {
      // 停用：不清 data（呼叫端可能還要顯示最後值），但 status 誠實退 idle，不冒充新鮮。
      setState((prev) => (prev.status === "idle" ? prev : { ...prev, status: "idle" }));
      return undefined;
    }
    // 坑 #1：effect-local cancel 旗標——每個 effect 世代擁有自己的 `cancelled`（見檔頭）。
    let cancelled = false;
    // 坑 #2：owner token。只有 gen 相符的 poll 是現任 owner；disown（逾時/refresh）即 gen+1。
    let gen = 0;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let consecutiveErrors = 0;

    const clearTimeoutTimer = () => {
      if (timeoutTimer != null) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    };
    const clearNextTimer = () => {
      if (nextTimer != null) { clearTimeout(nextTimer); nextTimer = null; }
    };
    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      clearNextTimer();
      nextTimer = setTimeout(() => { nextTimer = null; void poll(gen); }, delayMs);
    };
    const delayAfterError = () =>
      backoffFactor > 1
        ? Math.min(intervalMs * Math.pow(backoffFactor, consecutiveErrors), backoffMaxMs)
        : intervalMs;

    const poll = async (myGen: number) => {
      if (cancelled || myGen !== gen) return;
      const myController = new AbortController();
      controller = myController;
      // 坑 #3：逾時 watchdog。settle 驅動的排程器唯一的死穴是「永不 settle」；這顆計時器保證迴圈自癒。
      clearTimeoutTimer();
      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        if (cancelled || myGen !== gen) return;
        gen += 1;            // disown：卡死 poll 之後遲到的 settle 一律丟棄
        myController.abort();
        consecutiveErrors += 1;
        setState((prev) => ({
          ...prev,
          error: new Error(`usePolledResource: fetch exceeded timeoutMs=${timeoutMs}`),
          status: "error",
        }));
        scheduleNext(delayAfterError()); // 單一卡死請求不得永久殺死輪詢
      }, timeoutMs);

      let result: T;
      try {
        result = await fetcherRef.current(myController.signal);
      } catch (e) {
        // 被 disown（unmount / 逾時 / refresh 接管）的舊 poll：不 setState、不清他人計時器、不排程。
        if (cancelled || myGen !== gen) return;
        clearTimeoutTimer();
        consecutiveErrors += 1;
        setState((prev) => ({ ...prev, error: e, status: "error" }));
        scheduleNext(delayAfterError());
        return;
      }
      if (cancelled || myGen !== gen) return; // 坑 #2：stale 成功也丟棄——不發佈、不排程
      clearTimeoutTimer();
      consecutiveErrors = 0;
      setState({ data: result, error: null, status: "success", lastUpdatedAt: Date.now() });
      scheduleNext(intervalMs);
    };

    // 坑 #4：資料時效 watchdog。純看時間翻 stale，不依賴任何 poll settle（懸置請求不進 catch）。
    const watchdog = setInterval(() => {
      if (cancelled) return;
      setState((prev) => {
        if (prev.status !== "success" || prev.lastUpdatedAt == null) return prev; // 已非新鮮 → 不重複翻動
        return Date.now() - prev.lastUpdatedAt > staleAfterMs ? { ...prev, status: "stale" } : prev;
      });
    }, intervalMs);

    refreshRef.current = () => {
      if (cancelled) return;
      gen += 1;                 // disown 任何 in-flight poll
      clearTimeoutTimer();
      clearNextTimer();
      if (controller) controller.abort();
      void poll(gen);           // 立即發一輪；成功後自此重新計 intervalMs
    };

    setState((prev) =>
      prev.data == null && prev.status !== "loading" ? { ...prev, status: "loading", error: null } : prev,
    );
    gen = 1;
    if (immediate) void poll(gen);
    else scheduleNext(intervalMs);

    return () => {
      // 坑 #5：cleanup 清光三種計時器並 abort in-flight；cancelled=true 保證其後絕無 setState。
      cancelled = true;
      refreshRef.current = () => {};
      clearNextTimer();
      clearTimeoutTimer();
      clearInterval(watchdog);
      if (controller) controller.abort();
    };
  }, [enabled, immediate, intervalMs, timeoutMs, staleAfterMs, backoffFactor, backoffMaxMs]);

  return { data: state.data, error: state.error, status: state.status, lastUpdatedAt: state.lastUpdatedAt, refresh };
}
