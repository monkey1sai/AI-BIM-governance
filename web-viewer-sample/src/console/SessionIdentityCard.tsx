// session 身分三行（spec §2.2）：主標／識別列／狀態列。樣式只用 --ab-* token 與 .ec-prov chip。
// 檔名用 SessionIdentityCard 而非 SessionIdentity：Windows 檔案系統大小寫不分，"./SessionIdentity" 會解析到
// sessionIdentity.ts（純函式模組）而找不到元件 export。
import type { RuntimeSessionSummary } from "./coordinatorClient";
import { t } from "./i18n";
import { formatCreated, sessionOriginLabel, sessionStatusLabel, sessionTitle } from "./sessionIdentity";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function SessionIdentity({ session, compact = false, now }: { session: RuntimeSessionSummary; compact?: boolean; now?: number }) {
  const statusClass = session.status === "active" ? "ec-prov ec-asbuilt" : session.status === "created" ? "ec-prov ec-artifact" : "ec-prov ec-p4";
  return (
    <div data-testid="session-identity" style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span data-testid="session-identity-title" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--ab-text)", wordBreak: "break-word" }}>{sessionTitle(session)}</span>
      {!compact && (
        <span data-testid="session-id" style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dimmer)", wordBreak: "break-all" }}>{session.session_id}</span>
      )}
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--ab-text-dim)" }}>
        <span data-testid="session-origin" className="ec-prov ec-artifact">{sessionOriginLabel(session)}</span>
        <span data-testid="session-created">{formatCreated(session.created_at, now)}</span>
        <span data-testid="session-status" className={statusClass}>{sessionStatusLabel(session.status)}</span>
        <span>{t("參與", "participants")} {session.participant_count}</span>
      </span>
    </div>
  );
}
