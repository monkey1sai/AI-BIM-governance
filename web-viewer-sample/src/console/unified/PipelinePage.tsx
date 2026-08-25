// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Pipeline 頁（模型資料與轉檔生產線）
// unified-console-runtime-truth slice 1（tasks 1.5）：五段（進件／轉檔／Session／3D handoff／回拋）＋治理／報表列綁
// coordinator :8004 既有端點（共用 poller）。outbox 只用 GET /api/callback-outbox/summary（redacted 投影，不打 /api/internal/*）。
// RVT 段固定標示外部產製／已退役（PR #63）、無 RVT 轉檔按鈕。
// 「觸發轉檔」：瀏覽器授權（D2＝T4 operator token）於 slice 2（tasks §4.2／§2.4）落地前為 disabled＋原因（data-prov="p1"）。
// 3D handoff 為 anchor（target=_blank）指向 /ui/open?session=<id>：不內嵌 iframe、不自動 claim。
// 版面沿用設計原型；導覽一律 window.location.hash 賦值。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties, ReactNode } from "react";
import { useLang } from "../i18n";
import { coordinatorClient } from "../coordinatorClient";
import type { MinioWatchStatus } from "../coordinatorClient";
import { MONO, chipBox, getL, innerBox } from "./fixtures";
import { useConsoleData } from "./ConsoleDataProvider";
import type { EndpointKey } from "./coordinatorStatusStore";
import {
  activeSessions, cell, cellSub, cellText, conversionCounts, lastUpdatedText, openIssueCount, outboxPending, stateColor,
} from "./runtimeTruth";
import type { Cell } from "./runtimeTruth";

const PIPELINE_KEYS: readonly EndpointKey[] = [
  "ifcReady", "minioFolder", "minioWatch", "conversionRecords", "runtimeStatus", "kitInstance", "outboxSummary", "issues", "ruleRuns",
];

const col: CSSProperties = { ...chipBox, padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const navLink: CSSProperties = { fontSize: 11, color: "var(--ab-accent)", cursor: "pointer", textDecoration: "none" };
const disabledBtn: CSSProperties = { textAlign: "center", fontSize: 11, color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 7, padding: 6, cursor: "not-allowed", fontWeight: 700 };
const reasonText: CSSProperties = { fontSize: "9.5px", color: "var(--ab-text-dim)", lineHeight: 1.4 };
const handoffBtn: CSSProperties = { textAlign: "center", fontSize: "10.5px", color: "var(--ab-on-accent)", background: "linear-gradient(135deg,var(--ab-accent),var(--ab-accent-2))", borderRadius: 7, padding: 5, fontWeight: 700, textDecoration: "none" };

export function PipelinePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(PIPELINE_KEYS);
  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- 真值投影（design §3.3 pipeline 各列）---- */
  const ifcReady = cell(snap.ifcReady, (r) => r.count);
  // note＝MinIO 未設定（app.ts 未設定分支回 200＋note）→ 未取得，不是 0／0。
  const bucket = cell(snap.minioFolder, (f) => (f.note ? null : { folders: f.folders.length, withIfc: f.folders.filter((x) => x.has_source_ifc).length }));
  const watch = cell(snap.minioWatch, (w) => w);
  const conv = cell(snap.conversionRecords, conversionCounts);
  const sess = cell(snap.runtimeStatus, (rt) => ({ active: activeSessions(rt), items: rt.sessions.items }));
  const kit = cell(snap.kitInstance, (k) => `${k.instance_id} ${k.status}`);
  const outbox = cell(snap.outboxSummary, outboxPending);
  const issues = cell(snap.issues, openIssueCount);
  const ruleRuns = cell(snap.ruleRuns, (r) => r.total);
  const updated = lastUpdatedText([
    snap.ifcReady, snap.minioFolder, snap.minioWatch, snap.conversionRecords, snap.runtimeStatus, snap.kitInstance, snap.outboxSummary, snap.issues, snap.ruleRuns,
  ]);
  const watchText = (w: MinioWatchStatus) => (w.enabled
    ? `on · baseline ${w.baseline_count ?? L.unavailable} · seen ${w.seen_count ?? L.unavailable} · triggered ${w.triggered_total ?? L.unavailable}`
    : "off");

  /* colHead（1:1 對應原型 colHead(title, right)）*/
  const colHead = (title: string, right: ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-code)", textTransform: "uppercase" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-muted)" }}>{right}</span>
    </div>
  );
  /** 一列真值：主值（data-uc／data-prov／data-state）＋標籤 */
  const stat = <T,>(uc: string, c: Cell<T>, format: (v: T) => string, label: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span data-uc={uc} data-prov="asbuilt" data-state={c.state} style={{ fontFamily: MONO, fontSize: 19, fontWeight: 700, color: stateColor(c.state) }}>{cellText(c, L, format)}</span>
      <span style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{label}</span>
    </div>
  );
  const link = (uc: string, hash: string, label: string) => (
    <a data-uc={uc} data-action="nav" href={hash} onClick={(e) => { e.preventDefault(); nav(hash); }} className="hv-text" style={navLink}>{label}</a>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.pipe_title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, color: "var(--ab-text-code)" }}>
          <span style={{ color: "var(--ab-accent-text)" }}>{"① " + L.st_intake}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"② " + L.st_conv}</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>③ Session</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>④ 3D Handoff</span><span style={{ color: "var(--ab-text-faint)" }}>→</span>
          <span style={{ color: "var(--ab-accent-text)" }}>{"⑤ " + L.st_callback}</span>
        </div>
        <span data-uc="last-updated" style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dimmer)" }}>{`${L.last_updated} ${updated}`}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, alignItems: "start" }}>
        {/* ① 進件：ifc-ready 計數、bucket 資料夾／含 source IFC、MinIO watch 狀態 */}
        <div data-prov="asbuilt" style={col}>
          {colHead("① " + L.st_intake, link("to-minio", "#minio", zh ? "MinIO 物件 →" : "MinIO objects →"))}
          {stat("intake-ifc-ready-val", ifcReady, String, "ifc-ready")}
          {stat("intake-bucket-val", bucket, (b) => `${b.folders}／${b.withIfc}`, zh ? "資料夾／含 source IFC" : "folders / with source IFC")}
          <div style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>MinIO watch</span>
            <span data-uc="intake-watch-val" data-prov="asbuilt" data-state={watch.state} style={{ fontFamily: MONO, fontSize: 10, color: stateColor(watch.state) ?? "var(--ab-text)" }}>{cellText(watch, L, watchText)}</span>
          </div>
        </div>
        {/* ② 轉檔：ledger 三組計數、RVT 退役、觸發轉檔（disabled 附原因） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("② " + L.st_conv, link("to-conv", "#conv", zh ? "轉檔排程 →" : "queue →"))}
          {stat("conv-ready-val", conv, (c) => String(c.ready), "ready")}
          {stat("conv-running-val", conv, (c) => String(c.running), "running")}
          {stat("conv-failed-val", conv, (c) => String(c.failed), "failed")}
          <span
            data-uc="trigger-conv" role="button" aria-disabled="true" tabIndex={-1}
            data-action="disabled" data-prov="p1" aria-describedby="trigger-conv-reason"
            style={disabledBtn}
          >{L.trigger}</span>
          <span id="trigger-conv-reason" data-uc="trigger-conv-reason" style={reasonText}>{zh
            ? "需 allowlist 來源：瀏覽器授權（D2＝T4 operator token，tasks §4.2）落地前停用；請至 #minio 由 allowlist 來源觸發。"
            : "Requires an allowlisted origin: disabled until browser authorization (D2=T4 operator token, tasks §4.2) lands; trigger from #minio on an allowlisted host."}</span>
          <span data-uc="rvt-retired" data-prov="asbuilt" data-state="unavailable" style={reasonText}>{zh
            ? "RVT：外部產製／已退役（PR #63），不可由本站轉檔；source_rvt 存在與否未取得（/api/minio/objects 不揭露 rvt role）。"
            : "RVT: produced externally / retired (PR #63); not convertible here. source_rvt presence not observed (/api/minio/objects exposes no rvt role)."}</span>
        </div>
        {/* ③ Session：active 計數＋Kit instance */}
        <div data-prov="asbuilt" style={col}>
          {colHead("③ Review Sessions", link("to-sessions", "#sessions", zh ? "Session 管理 →" : "sessions →"))}
          {stat("sess-active-val", sess, (s) => String(s.active), zh ? "活躍" : "active")}
          <div style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>Kit instance</span>
            <span data-uc="kit-instance-val" data-prov="asbuilt" data-state={kit.state} style={{ fontFamily: MONO, fontSize: 11, color: stateColor(kit.state) ?? "var(--ab-text)" }}>{cellText(kit, L)}</span>
          </div>
        </div>
        {/* ④ 3D handoff：review session → /ui/open?session=<id> anchor（新分頁，非 iframe，不自動 claim） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("④ 3D Handoff", <span data-uc="handoff-count" data-state={sess.state}>{cellText(sess, L, (s) => String(s.items.length))}</span>)}
          {sess.state === "live" && sess.value !== null
            ? (sess.value.items.length === 0
              ? <span data-uc="handoff-none" style={{ fontSize: 11, color: "var(--ab-text-dimmer)", textAlign: "center", padding: "8px 0" }}>{zh ? "無可 handoff session" : "no session to hand off"}</span>
              : sess.value.items.map((s) => (
                <div key={s.session_id} style={{ ...innerBox, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-accent-text)", wordBreak: "break-all" }}>{s.session_id} · {s.status}</span>
                  <a data-uc="handoff-link" data-action="nav" href={coordinatorClient.openInViewerUrl(s.session_id)} target="_blank" rel="noopener noreferrer" className="hv-bright" style={handoffBtn}>{zh ? "開啟即時視圖（新分頁）" : "Open live view (new tab)"}</a>
                </div>
              )))
            : <span data-uc="handoff-state" data-state={sess.state} style={{ fontSize: 11, color: stateColor(sess.state), textAlign: "center", padding: "8px 0" }}>{cellSub(sess, L, () => "")}</span>}
        </div>
        {/* ⑤ 回拋：redacted 摘要（pending＋attempts） */}
        <div data-prov="asbuilt" style={col}>
          {colHead("⑤ Callback Outbox", <span style={{ fontFamily: MONO, fontSize: 9, color: "var(--ab-text-dimmer)" }}>GET /api/callback-outbox/summary</span>)}
          {stat("outbox-pending-val", outbox, (o) => String(o.pending), L.pending)}
          <span data-uc="outbox-attempts" style={{ fontSize: "9.5px", color: "var(--ab-text-dim)" }}>{cellSub(outbox, L, (o) => `attempts ${o.attempts}/${o.maxAttempts} · metadata-only`)}</span>
        </div>
      </div>
      {/* 治理／報表列 */}
      <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", alignItems: "center", gap: 24 }}>
        <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{zh ? "治理／報表" : "Governance / Reports"}</span>
        {stat("gov-rule-runs-val", ruleRuns, String, "rule-runs")}
        {stat("gov-open-issues-val", issues, String, zh ? "未結 issue" : "open issues")}
        <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
          {link("to-issues", "#issues", "Issues →")}
          {link("to-reports", "#reports", zh ? "報表 →" : "Reports →")}
        </span>
      </div>
    </div>
  );
}
