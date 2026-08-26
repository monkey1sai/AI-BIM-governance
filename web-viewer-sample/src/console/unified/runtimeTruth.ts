// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 真值投影（unified-console-runtime-truth design §3.2／§3.3）
// 把共用 poller 的端點切片投影成畫面 cell：只有 live 才顯示數字；unavailable（200 但欄位缺席／回傳窗截斷）
// 顯示「未取得」；offline（502／503／504／網路錯誤／尚未回應）顯示「—」＋「未連線」；error（其他非 2xx）顯示狀態碼與訊息。
// 永不以 0 作佔位；截斷窗不對子集算數（對齊 SharedStatusProvider 的 recordsIncomplete 模式）。
// ═══════════════════════════════════════════════════════════════════════
import type { CallbackOutboxSummary, ConversionRecord, RuntimeStatus } from "../coordinatorClient";
import type { IssueRow } from "../governanceClient";
import type { EndpointSlice } from "./coordinatorStatusStore";

export type DataState = "live" | "unavailable" | "offline" | "error";
export type HealthState = "ok" | "degraded" | "unknown";

export interface Cell<T> {
  state: DataState;
  value: T | null;
  httpStatus: number | null;
  message: string | null;
}

export interface StateLabels { unavailable: string; offline: string; }

/** pick 回 null ＝ 200 但欄位缺席／不可信（截斷）→ unavailable。 */
export function cell<D, T>(slice: EndpointSlice<D>, pick: (data: D) => T | null): Cell<T> {
  if (slice.state !== "live" || slice.data === null) {
    return { state: slice.state === "live" ? "offline" : slice.state, value: null, httpStatus: slice.httpStatus, message: slice.message };
  }
  const value = pick(slice.data);
  return value === null
    ? { state: "unavailable", value: null, httpStatus: 200, message: null }
    : { state: "live", value, httpStatus: 200, message: null };
}

/** 主值文字：live→format(value)；unavailable→未取得；offline→—；error→狀態碼。 */
export function cellText<T>(c: Cell<T>, L: StateLabels, format: (value: T) => string = (v) => String(v)): string {
  if (c.state === "live" && c.value !== null) return format(c.value);
  if (c.state === "unavailable") return L.unavailable;
  if (c.state === "offline") return "—";
  return c.httpStatus === null ? "error" : String(c.httpStatus);
}

/** 副標：live→liveSub(value)；unavailable→未取得；offline→未連線；error→後端訊息。 */
export function cellSub<T>(c: Cell<T>, L: StateLabels, liveSub: (value: T) => string): string {
  if (c.state === "live" && c.value !== null) return liveSub(c.value);
  if (c.state === "unavailable") return L.unavailable;
  if (c.state === "offline") return L.offline;
  return c.message ?? "error";
}

/** 服務健康：live 且未 degraded→ok；error（可達但非 2xx）→degraded；offline／尚未回應→unknown。 */
export function healthOf<D>(slice: EndpointSlice<D>, degradedWhen: (data: D) => boolean = () => false): HealthState {
  if (slice.state === "live" && slice.data !== null) return degradedWhen(slice.data) ? "degraded" : "ok";
  if (slice.state === "error") return "degraded";
  return "unknown";
}

export const HEALTH_DOT: Record<HealthState, string> = {
  ok: "var(--ab-ok)", degraded: "var(--ab-danger)", unknown: "var(--ab-text-dimmer)",
};

/** 主值色：live 沿用元件預設（undefined）；offline 琥珀、error 紅、unavailable 淡。 */
export function stateColor(state: DataState): string | undefined {
  if (state === "offline") return "var(--ab-warn)";
  if (state === "error") return "var(--ab-danger)";
  if (state === "unavailable") return "var(--ab-text-dim)";
  return undefined;
}

/* ── 端點對映 pickers（design §3.3）── */

/** ledger 非終態＝進行中（對齊 SharedStatusProvider QUEUE_STATUSES）。 */
export const IN_PROGRESS_STATUSES: ReadonlySet<ConversionRecord["status"]> =
  new Set<ConversionRecord["status"]>(["detected", "queued", "converting"]);

export interface ConversionCounts { running: number; ready: number; failed: number; }
export function conversionCounts(r: { count: number; items: ConversionRecord[] }): ConversionCounts | null {
  if (r.count > r.items.length) return null;
  const c: ConversionCounts = { running: 0, ready: 0, failed: 0 };
  for (const it of r.items) {
    if (it.status === "ready") c.ready += 1;
    else if (it.status === "failed") c.failed += 1;
    else if (IN_PROGRESS_STATUSES.has(it.status)) c.running += 1;
  }
  return c;
}

export function activeSessions(rt: RuntimeStatus): number { return rt.sessions.active_count; }

/** 「未結」＝非 resolved／rejected（對齊 pages.tsx IssuesRuleCenterPage 的可 resolve 判斷）。 */
const RESOLVED_ISSUE_STATUSES: ReadonlySet<string> = new Set(["resolved", "rejected"]);
export function openIssueCount(res: { issues: IssueRow[] }): number {
  return res.issues.filter((i) => !RESOLVED_ISSUE_STATUSES.has(i.status)).length;
}

export interface OutboxPending { pending: number; attempts: number; maxAttempts: number; }
export function outboxPending(s: CallbackOutboxSummary): OutboxPending | null {
  if (s.total > s.entries.length) return null;
  const pending = s.entries.filter((e) => e.status === "pending");
  return {
    pending: pending.length,
    attempts: pending.reduce((m, e) => Math.max(m, e.attempts), 0),
    maxAttempts: pending.reduce((m, e) => Math.max(m, e.max_attempts), 0),
  };
}

/** 「最後更新」：所有 live 切片中最新的 lastUpdatedAt；沒有 live→"—"（gate 環境確定性，不含時間戳）。 */
export function lastUpdatedText(slices: ReadonlyArray<EndpointSlice<unknown>>): string {
  let latest: number | null = null;
  for (const s of slices) {
    if (s.state === "live" && s.lastUpdatedAt !== null) latest = latest === null ? s.lastUpdatedAt : Math.max(latest, s.lastUpdatedAt);
  }
  return latest === null ? "—" : new Date(latest).toLocaleTimeString("zh-TW", { hour12: false });
}
