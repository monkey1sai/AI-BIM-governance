// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Home（總覽 · Mission Control）
// unified-console-runtime-truth slice 1（tasks 1.4）：四 KPI＋六 svc-dot 綁 coordinator :8004 既有端點（共用 poller）；
// 每值附 data-prov="asbuilt"＋data-state；offline 顯示 —／未連線；無遙測顯示未取得；永不以 0 佔位。
// 版面沿用設計原型（inline style 不改）；KPI 卡為 data-action="nav" 導向真頁；導覽設定／i18n／style helper 仍來自 ./fixtures。
// 應用啟動器的 A1–A4 badge 文字仍為 fixture（tasks §2.3 承接）；該區塊容器標 data-prov="demo"（canonical 七值，P5 c1），badge 文字本身尚未改綁真值。
// ═══════════════════════════════════════════════════════════════════════
import { useLang } from "../i18n";
import { MONO, SHOW_CONCEPT_APPS, getL, apps, appEn, badgeTone, chipBox } from "./fixtures";
import { useConsoleData } from "./consoleData";
import type { EndpointKey } from "./coordinatorStatusStore";
import { ServiceHealthList } from "./ServiceHealthList";
import {
  activeSessions, cell, cellSub, cellText, conversionCounts, lastUpdatedText, openIssueCount, outboxPending, stateColor,
} from "./runtimeTruth";
import type { DataState } from "./runtimeTruth";

const HOME_KEYS: readonly EndpointKey[] = ["runtimeStatus", "ifcReady", "conversionRecords", "issues", "outboxSummary", "ruleRuns", "kitHealth", "minioWatch"];

export function HomePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(HOME_KEYS);

  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- 真值投影（design §3.3）---- */
  const conv = cell(snap.conversionRecords, conversionCounts);
  const sess = cell(snap.runtimeStatus, (rt) => ({ active: activeSessions(rt), participants: rt.sessions.participant_count }));
  const issue = cell(snap.issues, openIssueCount);
  const outbox = cell(snap.outboxSummary, outboxPending);
  const intake = cell(snap.ifcReady, (r) => r.count);
  const updated = lastUpdatedText([snap.runtimeStatus, snap.conversionRecords, snap.issues, snap.outboxSummary]);

  /* ---- KPI 卡（版面 1:1 原型 kpi(actId,label,val,sub,valColor)；值／副標／data-state 為真值）---- */
  const kpi = (hash: string, label: string, uc: string, state: DataState, val: string, sub: string) => (
    <div className="hv-accent-border" data-uc={uc} data-action="nav" role="link" onClick={() => nav(hash)} style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{label}</span>
      <span data-uc={uc + "-val"} data-prov="asbuilt" data-state={state} style={{ fontSize: 26, fontWeight: 700, fontFamily: MONO, color: stateColor(state) }}>{val}</span>
      <span data-uc={uc + "-sub"} style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{sub}</span>
    </div>
  );

  /* ---- pipeSnap 4 步（① INTAKE → ② CONVERT → ③ SESSION → ⑤ OUTBOX；同一份真值）---- */
  const pipeSnap = [
    { step: "① INTAKE", uc: "snap-intake", state: intake.state, n: cellText(intake, L), label: "ifc-ready", arrow: true },
    { step: "② CONVERT", uc: "snap-convert", state: conv.state, n: cellText(conv, L, (c) => String(c.running)), label: zh ? "轉檔中" : "running", arrow: true },
    { step: "③ SESSION", uc: "snap-session", state: sess.state, n: cellText(sess, L, (s) => String(s.active)), label: zh ? "活躍" : "active", arrow: true },
    { step: "⑤ OUTBOX", uc: "snap-outbox", state: outbox.state, n: cellText(outbox, L, (o) => String(o.pending)), label: zh ? "待送" : "pending", arrow: false },
  ];

  const launcherApps = apps.filter((a) => SHOW_CONCEPT_APPS || a.tone === "live");

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ---- 標題列：最後更新（只有 live 才有時間；否則 —，gate 環境確定性）---- */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.home_title}</span>
        <span data-uc="last-updated" style={{ fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-dim)" }}>{`${L.last_updated} ${updated}`}</span>
      </div>
      {/* ---- KPI 卡 ×4（真值）---- */}
      <div data-prov="asbuilt" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {kpi("#conv", L.kpi_conv, "kpi-conv", conv.state, cellText(conv, L, (c) => String(c.running)), cellSub(conv, L, (c) => `ready ${c.ready} · failed ${c.failed}`))}
        {kpi("#sessions", L.kpi_sess, "kpi-sess", sess.state, cellText(sess, L, (s) => String(s.active)), cellSub(sess, L, (s) => `participants ${s.participants}`))}
        {kpi("#issues", L.kpi_issue, "kpi-issue", issue.state, cellText(issue, L), cellSub(issue, L, () => (zh ? "非 resolved／rejected" : "not resolved/rejected")))}
        {kpi("#minio", L.kpi_outbox, "kpi-outbox", outbox.state, cellText(outbox, L, (o) => String(o.pending)), cellSub(outbox, L, (o) => `attempts ${o.attempts}/${o.maxAttempts}`))}
      </div>
      {/* ---- 資料生產線快照 + 服務健康 ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12 }}>
        <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.pipe_snap}</span>
            <span data-uc="enter-pipeline" data-action="nav" role="link" onClick={() => nav("#pipeline")} style={{ marginLeft: "auto", fontSize: 11, color: "var(--ab-accent)", cursor: "pointer" }}>{L.enter} →</span>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {pipeSnap.map((p) => (
              <div key={p.step} style={{ flex: 1, display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
                <div className="hv-accent-border-strong" data-action="nav" role="link" onClick={() => nav("#pipeline")} style={{ flex: 1, background: "var(--ab-inset)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                  <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", color: "var(--ab-text-code)" }}>{p.step}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span data-uc={p.uc} data-prov="asbuilt" data-state={p.state} style={{ fontSize: 19, fontWeight: 700, fontFamily: MONO, color: stateColor(p.state) }}>{p.n}</span><span style={{ fontSize: 11, color: "var(--ab-text-muted)" }}>{p.label}</span></div>
                </div>
                {p.arrow ? <span style={{ color: "var(--ab-text-faint)", padding: "0 6px", fontFamily: MONO }}>→</span> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--ab-text-dim)" }}>
            <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".08em", textTransform: "uppercase" }}>F1</span>
            <span>{L.f1_desc}</span>
          </div>
        </div>
        <div data-prov="asbuilt" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.svc_health}</span>
          <ServiceHealthList snap={snap} zh={zh} />
        </div>
      </div>
      {/* ---- 應用啟動器（導覽設定；A1–A4 badge 文字仍為 fixture，tasks §2.3 承接）---- */}
      <div data-prov="demo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.launcher}</span>
          <span style={{ fontSize: 11, color: "var(--ab-text-dim)" }}>A1–A4 live · A5–A10 Concept Preview</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          {launcherApps.map((a) => (
            <div
              key={a.code}
              className="hv-card"
              onClick={() => nav(a.hash)}
              style={a.tone === "live"
                ? { background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.16)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s" }
                : { background: "var(--ab-surface)", border: "1px solid rgba(120,160,210,.09)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s", opacity: 0.75 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "var(--ab-text-code)" }}>{a.code}</span>
                <span style={badgeTone(a.tone)}>{a.badge}</span>
              </div>
              <span style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--ab-text)" }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={{ fontSize: 10, color: "var(--ab-text-dim)" }}>{appEn[a.code]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
