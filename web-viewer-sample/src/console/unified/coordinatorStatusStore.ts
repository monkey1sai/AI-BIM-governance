// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 共用 poller store（unified-console-runtime-truth design §3.1）
// 十一個 coordinator :8004 端點各自一條輪詢迴圈：預設 10 秒節奏、同端點同時最多一個 in-flight、
// 連續失敗指數退避（10s×2^n，上限 60s）、document.hidden 時不發請求；頁面「訂閱」而非各自 fetch。
// 沿用既有 coordinatorClient（不新增 HTTP client／依賴）；vitest 於 coordinatorClient 層 spy 注入 mock。
// 狀態語意（design §3.2）：live＝最近一次 2xx；offline＝502／503／504／網路錯誤／逾時，或尚未收到任何回應；
// error＝其他非 2xx（誠實顯示狀態碼）。「unavailable（200 但欄位缺席／截斷）」由消費端 pick 判定（runtimeTruth.ts）。
// 模組層單例（非 hook）：跨頁／殼層共享同一條迴圈，才能做到同端點單一 in-flight。
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useSyncExternalStore } from "react";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import type {
  CallbackOutboxSummary, ConversionRecord, IfcReadyListItem, KitHealth, KitInstanceState,
  MinioFolderListing, MinioWatchStatus, RuntimeStatus,
  SessionIdlePolicy,
} from "../coordinatorClient";
import type { IssueRow, RuleRunHistoryResponse } from "../governanceClient";

export type TransportState = "live" | "offline" | "error";

export interface EndpointData {
  runtimeStatus: RuntimeStatus;
  ifcReady: { count: number; items: IfcReadyListItem[] };
  conversionRecords: { count: number; items: ConversionRecord[] };
  outboxSummary: CallbackOutboxSummary;
  issues: { issues: IssueRow[] };
  ruleRuns: RuleRunHistoryResponse;
  minioWatch: MinioWatchStatus;
  minioFolder: MinioFolderListing;
  kitHealth: KitHealth;
  kitInstance: KitInstanceState;
  sessionIdlePolicy: SessionIdlePolicy;
}
export type EndpointKey = keyof EndpointData;
export const ENDPOINT_KEYS: readonly EndpointKey[] = [
  "runtimeStatus", "ifcReady", "conversionRecords", "outboxSummary", "issues",
  "ruleRuns", "minioWatch", "minioFolder", "kitHealth", "kitInstance", "sessionIdlePolicy",
];

export interface EndpointSlice<T> {
  /** 最近一次成功 payload；之後失敗不擦除，但消費端只在 state==="live" 時讀值。 */
  data: T | null;
  state: TransportState;
  httpStatus: number | null;
  message: string | null;
  lastUpdatedAt: number | null;
}
export type CoordinatorStatusSnapshot = { [K in EndpointKey]: EndpointSlice<EndpointData[K]> };

export const POLL_INTERVAL_MS = 10_000;
export const BACKOFF_MAX_MS = 60_000;

export type EndpointFetchers = { [K in EndpointKey]: () => Promise<EndpointData[K]> };

/** production 唯一的 fetcher 組：每個都在呼叫時才讀 coordinatorClient 屬性，vi.spyOn 得以攔截。 */
export const liveFetchers: EndpointFetchers = {
  runtimeStatus: () => coordinatorClient.runtimeStatus(),
  ifcReady: () => coordinatorClient.listIfcReady(20),
  conversionRecords: () => coordinatorClient.getConversionRecords(100),
  outboxSummary: () => coordinatorClient.getCallbackOutboxSummary(200),
  issues: () => coordinatorClient.governanceIssues(),
  ruleRuns: () => coordinatorClient.governanceRuleRuns(5),
  minioWatch: () => coordinatorClient.minioWatchStatus(),
  minioFolder: () => coordinatorClient.getMinioFolder(),
  kitHealth: () => coordinatorClient.kitHealth(),
  kitInstance: () => coordinatorClient.kitInstanceCurrent(),
  sessionIdlePolicy: () => coordinatorClient.getSessionIdlePolicy(),
};

const OFFLINE_HTTP: ReadonlySet<number> = new Set([502, 503, 504]);

export function classifyFailure(error: unknown): { state: TransportState; httpStatus: number | null; message: string } {
  if (error instanceof CoordinatorHttpError) {
    return { state: OFFLINE_HTTP.has(error.status) ? "offline" : "error", httpStatus: error.status, message: error.message };
  }
  return { state: "offline", httpStatus: null, message: error instanceof Error ? error.message : String(error) };
}

function emptySlice<T>(): EndpointSlice<T> {
  return { data: null, state: "offline", httpStatus: null, message: null, lastUpdatedAt: null };
}
export function emptySnapshot(): CoordinatorStatusSnapshot {
  return {
    runtimeStatus: emptySlice(), ifcReady: emptySlice(), conversionRecords: emptySlice(), outboxSummary: emptySlice(),
    issues: emptySlice(), ruleRuns: emptySlice(), minioWatch: emptySlice(), minioFolder: emptySlice(),
    kitHealth: emptySlice(), kitInstance: emptySlice(), sessionIdlePolicy: emptySlice(),
  };
}

interface Loop { refs: number; inFlight: boolean; timer: ReturnType<typeof setTimeout> | null; consecutiveErrors: number; }

export interface CoordinatorStatusStoreOptions {
  intervalMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  isHidden?: () => boolean;
}

export class CoordinatorStatusStore {
  private snapshot: CoordinatorStatusSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly loops: Record<EndpointKey, Loop>;
  private readonly intervalMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly isHidden: () => boolean;
  private visibilityBound = false;

  constructor(private readonly fetchers: EndpointFetchers, opts: CoordinatorStatusStoreOptions = {}) {
    this.intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? BACKOFF_MAX_MS;
    this.now = opts.now ?? (() => Date.now());
    this.isHidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.hidden === true);
    const loops = {} as Record<EndpointKey, Loop>;
    for (const key of ENDPOINT_KEYS) loops[key] = { refs: 0, inFlight: false, timer: null, consecutiveErrors: 0 };
    this.loops = loops;
  }

  readonly getSnapshot = (): CoordinatorStatusSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 訂閱端點：第一個訂閱者立即發一輪，之後依節奏輪詢；已有訂閱者則共用同一條迴圈。 */
  retain(key: EndpointKey): void {
    const loop = this.loops[key];
    loop.refs += 1;
    if (loop.refs === 1) {
      this.bindVisibility();
      this.clearTimer(key);
      void this.poll(key);
    }
  }

  /** 最後一個訂閱者離開即停止排程（in-flight 請求自然結束後不再排下一輪）。 */
  release(key: EndpointKey): void {
    const loop = this.loops[key];
    loop.refs = Math.max(0, loop.refs - 1);
    if (loop.refs === 0) this.clearTimer(key);
  }

  refCount(key: EndpointKey): number { return this.loops[key].refs; }

  /** 測試用：清掉所有計時器、refCount 歸零、快照回初始（測試若漏 unmount，殘留元件下次 retain 會重新啟動迴圈）。 */
  reset(): void {
    for (const key of ENDPOINT_KEYS) {
      const loop = this.loops[key];
      this.clearTimer(key);
      loop.refs = 0;
      loop.inFlight = false;
      loop.consecutiveErrors = 0;
    }
    this.snapshot = emptySnapshot();
    this.emit();
  }

  /** 測試用：清掉所有計時器與 visibility 監聽。 */
  dispose(): void {
    for (const key of ENDPOINT_KEYS) { this.clearTimer(key); this.loops[key].refs = 0; }
    if (this.visibilityBound && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.visibilityBound = false;
    }
  }

  private readonly onVisibility = (): void => {
    if (this.isHidden()) return;
    for (const key of ENDPOINT_KEYS) {
      const loop = this.loops[key];
      if (loop.refs > 0 && !loop.inFlight) { this.clearTimer(key); void this.poll(key); }
    }
  };

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibility);
    this.visibilityBound = true;
  }

  private clearTimer(key: EndpointKey): void {
    const loop = this.loops[key];
    if (loop.timer !== null) { clearTimeout(loop.timer); loop.timer = null; }
  }

  private schedule(key: EndpointKey, delayMs: number): void {
    this.clearTimer(key);
    this.loops[key].timer = setTimeout(() => { this.loops[key].timer = null; void this.poll(key); }, delayMs);
  }

  private delayFor(loop: Loop): number {
    if (loop.consecutiveErrors === 0) return this.intervalMs;
    return Math.min(this.intervalMs * Math.pow(2, loop.consecutiveErrors), this.backoffMaxMs);
  }

  private async poll<K extends EndpointKey>(key: K): Promise<void> {
    const loop = this.loops[key];
    if (loop.refs === 0 || loop.inFlight) return; // 同端點單一 in-flight
    if (this.isHidden()) { this.schedule(key, this.intervalMs); return; } // hidden：不發請求，稍後再檢查
    loop.inFlight = true;
    try {
      const data = await this.fetchers[key]();
      loop.consecutiveErrors = 0;
      this.publish(key, { data, state: "live", httpStatus: 200, message: null, lastUpdatedAt: this.now() });
    } catch (error) {
      loop.consecutiveErrors += 1;
      const failure = classifyFailure(error);
      const prev = this.snapshot[key];
      this.publish(key, { data: prev.data, state: failure.state, httpStatus: failure.httpStatus, message: failure.message, lastUpdatedAt: prev.lastUpdatedAt });
    } finally {
      loop.inFlight = false;
      if (loop.refs > 0) this.schedule(key, this.delayFor(loop));
    }
  }

  private publish<K extends EndpointKey>(key: K, slice: EndpointSlice<EndpointData[K]>): void {
    this.snapshot = { ...this.snapshot, [key]: slice } as CoordinatorStatusSnapshot;
    this.emit();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}

/** production 單例：只注入 live fetchers（design §1.4：production 只注入 live store）。 */
export const coordinatorStatusStore = new CoordinatorStatusStore(liveFetchers);

/**
 * 訂閱指定端點並回傳整份快照。keys 必須是模組層常數陣列（identity 穩定），否則每次 render 都會 release/retain。
 * 第三參數（server snapshot）讓 renderToString（unified.test.tsx）不丟 getServerSnapshot 缺席錯誤；SSR 無 effect，不會發請求。
 */
export function useCoordinatorStatus(store: CoordinatorStatusStore, keys: readonly EndpointKey[]): CoordinatorStatusSnapshot {
  useEffect(() => {
    for (const key of keys) store.retain(key);
    return () => { for (const key of keys) store.release(key); };
  }, [store, keys]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
