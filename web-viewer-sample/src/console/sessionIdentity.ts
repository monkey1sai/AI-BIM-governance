// session 身分顯示（session-identity-display spec §2.1）：純函式、無 React、無 I/O。
// 所有 null 一律顯「未取得」類文字，不用 id 拼湊假名稱。
import type { ConversionRecord, RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shortVersion(v: string): string { return UUID_RE.test(v) ? v.slice(0, 8) : v; }
export function shortSessionId(id: string): string { return `…${id.slice(-6)}`; }

// origin 為 PR #856 新增欄位；對舊 coordinator（尚未部署）或本地合成的 summary 可能缺，缺＝未知，不炸畫面。
type OriginMaybe = RuntimeSessionSummary["origin"] | null | undefined;
const originOf = (s: { origin?: OriginMaybe }): OriginMaybe => s.origin ?? null;

export function sessionTitle(s: Pick<RuntimeSessionSummary, "project_id" | "model_version_id"> & { origin?: OriginMaybe }): string {
  const o = originOf(s);
  const project = o?.project_display_name || s.project_id;
  const category = o?.category || t("種類未取得", "category unavailable");
  return `${project} · ${category} · ${t("版本", "version")} ${shortVersion(s.model_version_id)}`;
}

export function sessionOriginLabel(s: { origin?: OriginMaybe }): string {
  const o = originOf(s);
  if (!o) return t("來源未取得", "origin unavailable");
  switch (o.kind) {
    case "auto_conversion_ready":
      if (o.intake_source === "minio_watch") return t("MinIO 自動", "MinIO auto");
      if (o.intake_source === "external") return t("外部進件自動", "external intake auto");
      return t("轉檔完成自動", "conversion-ready auto");
    case "console_request": return t("Console 建立", "created in console");
    case "recreated": return `${t("重建自", "recreated from")} ${o.recreated_from_session_id ? shortSessionId(o.recreated_from_session_id) : t("未取得", "unavailable")}`;
    default: return `${t("API 建立", "created via API")}（${o.created_by}）`;
  }
}

export function sessionStatusLabel(status: RuntimeSessionSummary["status"]): string {
  switch (status) {
    case "created": return t("尚未啟動", "not started");
    case "active": return t("進行中", "active");
    case "closing": return t("關閉中", "closing");
    case "closed": return t("已關閉", "closed");
    default: return t("失敗", "failed");
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthDay = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function formatCreated(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (!iso || Number.isNaN(ms)) return t("時間未取得", "time unavailable");
  const d = new Date(ms);
  const abs = `${monthDay(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (now - ms < -60_000) return `${abs} · ${t("時鐘不同步", "clock skew")}`; // created_at 在未來：不捏造「剛剛」
  const diffMin = Math.max(0, Math.round((now - ms) / 60_000));
  const rel = diffMin < 60 ? `${diffMin} ${t("分鐘前", "min ago")}`
    : diffMin < 60 * 24 ? `${Math.round(diffMin / 60)} ${t("小時前", "h ago")}`
      : `${Math.round(diffMin / (60 * 24))} ${t("天前", "d ago")}`;
  return `${abs} · ${rel}`;
}

export function sessionOptionLabel(s: RuntimeSessionSummary, now: number = Date.now()): string {
  return `${formatCreated(s.created_at, now)} · ${sessionOriginLabel(s)} · ${t("參與", "participants")} ${s.participant_count ?? "—"} · ${sessionStatusLabel(s.status)} · ${shortSessionId(s.session_id)}`;
}

export function modelOptionLabel(r: ConversionRecord): string {
  const filename = r.object_key ? r.object_key.split("/").pop() : "";
  const detected = Date.parse(r.detected_at);
  const detectedText = Number.isNaN(detected) ? t("時間未取得", "time unavailable") : monthDay(new Date(detected));
  const core = `${r.category || t("種類未取得", "category unavailable")} · ${t("版本", "version")} ${shortVersion(r.external_model_version_id)} · ${t("轉檔", "converted")} ${detectedText}`;
  return filename ? `${filename} · ${core}` : core;
}

export function sortByCreatedDesc<T extends { created_at: string }>(items: T[]): T[] {
  const ts = (x: T) => { const v = Date.parse(x.created_at); return Number.isNaN(v) ? -Infinity : v; };
  return items.slice().sort((a, b) => ts(b) - ts(a));
}
