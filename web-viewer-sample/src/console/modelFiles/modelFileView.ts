// 模型檔案清單的純函式（契約 §5.1 顯示名稱、§5.3 清理候選、§4.4 移除條件）。無 React、無 I/O。
// 在途判定不在前端重算：server 的 409 record_in_flight 是權威，前端只擋能確定的情況。
import type { ClosedReviewSessionItem, ConversionRecord, RuntimeSessionSummary } from "../coordinatorClient";
import { t } from "../i18n";
import { isMinioKey, shortVersion } from "../sessionIdentity";

export { isMinioKey };
export type RecordSession = ConversionRecord["sessions"][number];

export function keyShortCode(key: string): string { return key.length <= 12 ? key : `…${key.slice(-8)}`; }

export interface ModelFileLabel { title: string; subtitle: string }
type LabelSource = Pick<ConversionRecord, "idempotency_key" | "project_display_name" | "project_id" | "category" | "external_model_version_id" | "source_ifc_filename">;

/**
 * owner 2026-09-30：MinIO 紀錄主標籤＝專案·種類·版本；其他紀錄檔名優先；查無檔名不猜。
 * 副標一律以鍵短碼結尾（Ruling R18）：同專案·種類·版本重派出的新鍵才分得出來。
 */
export function modelFileLabel(record: LabelSource): ModelFileLabel {
  const project = record.project_display_name || record.project_id;
  const version = `${t("版本", "version")} ${shortVersion(record.external_model_version_id)}`;
  const code = keyShortCode(record.idempotency_key);
  if (isMinioKey(record.idempotency_key)) {
    return {
      title: `${project} · ${record.category || t("種類未取得", "category unavailable")} · ${version}`,
      subtitle: `${record.source_ifc_filename || t("來源未知", "source unknown")} · ${code}`,
    };
  }
  return { title: record.source_ifc_filename || `${t("來源未知", "source unknown")} ${code}`, subtitle: `${project} · ${version} · ${code}` };
}

const ACTIVE = new Set<RecordSession["status"]>(["created", "active", "closing"]);
export function activeSessions(record: Pick<ConversionRecord, "sessions">): RecordSession[] { return record.sessions.filter((s) => ACTIVE.has(s.status)); }
export function closedSessionCount(record: Pick<ConversionRecord, "sessions">): number { return record.sessions.filter((s) => s.status === "closed" || s.status === "failed").length; }
/** 可開啟＝created／active；closing 仍佔用紀錄（計入進行中、擋移除），但已不能開啟。 */
export function openableSessions(record: Pick<ConversionRecord, "sessions">): RecordSession[] { return record.sessions.filter((s) => s.status === "created" || s.status === "active"); }
/**
 * sessions[] 已由 server 依 created_at 降冪。先取 link 為 ready_model 的可開啟 session（open_existing 只接受與
 * ready bundle 相符者，Ruling R14），再退回任一可開啟者；closing 永不回傳。
 */
export function preferredOpenTarget(record: Pick<ConversionRecord, "sessions">): RecordSession | null {
  const openable = openableSessions(record);
  return openable.find((s) => s.link === "ready_model") ?? openable[0] ?? null;
}

export type RowRemoval = { allowed: true } | { allowed: false; reason: string };
export function removalState(record: Pick<ConversionRecord, "sessions" | "status">): RowRemoval {
  const active = activeSessions(record);
  if (active.length > 0) {
    const ids = active.map((s) => s.session_id).join("、");
    return { allowed: false, reason: t(`被 ${active.length} 筆進行中審查佔用：${ids}`, `In use by ${active.length} active review(s): ${ids}`) };
  }
  if (record.status === "removed") return { allowed: false, reason: t("已移除", "already removed") };
  return { allowed: true };
}

export function unregisteredSources<T extends { filename: string }>(sources: readonly T[], records: readonly Pick<ConversionRecord, "source_ifc_filename">[]): T[] {
  const known = new Set(records.map((r) => r.source_ifc_filename).filter((name): name is string => Boolean(name)));
  return sources.filter((s) => !known.has(s.filename));
}

export interface CleanupInput { now: number; days: number; live: readonly RuntimeSessionSummary[]; closed: readonly ClosedReviewSessionItem[]; records: readonly ConversionRecord[] }
export interface CleanupCandidates { cutoffIso: string; closedSessions: Array<Pick<ClosedReviewSessionItem, "session_id" | "status" | "updated_at" | "source_ifc_filename">>; staleActive: RuntimeSessionSummary[]; records: ConversionRecord[] }

/** §5.3 三組候選：已關閉／失敗、無人連線的舊 active、無進行中 session 的舊紀錄。 */
export function cleanupCandidates(input: CleanupInput): CleanupCandidates {
  const cutoff = input.now - input.days * 86_400_000;
  const older = (iso: string) => { const ms = Date.parse(iso); return Number.isFinite(ms) && ms < cutoff; };
  const closedSessions: CleanupCandidates["closedSessions"] = [
    ...input.closed.filter((s) => s.status === "closed" && older(s.updated_at)),
    ...input.live.filter((s) => s.status === "failed" && older(s.updated_at))
      .map((s) => ({ session_id: s.session_id, status: s.status, updated_at: s.updated_at, source_ifc_filename: s.origin?.source_ifc_filename ?? null })),
  ];
  const staleActive = input.live.filter((s) => (s.status === "created" || s.status === "active") && older(s.updated_at)
    && s.viewer_leases.length === 0 && s.primary_viewer_lease_id === null);
  const records = input.records.filter((r) => r.status !== "removed" && older(r.updated_at) && activeSessions(r).length === 0);
  return { cutoffIso: new Date(cutoff).toISOString(), closedSessions, staleActive, records };
}
