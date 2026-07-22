// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Home（總覽 · Mission Control）
// 像素級移植正本：scratchpad/design-origin/app.js（s.page === "home" 區段）
// 視覺標的：docs/plans/design-system-baseline/console.home.default/1440x900.png
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（hash 導覽），
// 不打任何 /api。fixture 資料一律 import 自 ./fixtures。
// ═══════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { useLang } from "../i18n";
import {
  SHOW_CONCEPT_APPS, getL, apps, appEn, alerts, badgeTone, chipBox,
} from "./fixtures";
import { useUnifiedState } from "./UnifiedShell";

export function HomePage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { intake, conv, sessions, outbox, issues } = useUnifiedState();

  const nav = (hash: string) => { window.location.hash = hash; };

  /* ---- pipeSnap 4 步（① INTAKE → ② CONVERT → ③ SESSION → ⑤ OUTBOX）---- */
  const pipeSnap = [
    { step: "① INTAKE", n: String(intake.length), label: zh ? "進件" : "intake", arrow: true },
    { step: "② CONVERT", n: String(conv.filter((c) => c.st === "running").length), label: zh ? "轉檔中" : "running", arrow: true },
    { step: "③ SESSION", n: String(sessions.length), label: zh ? "活躍" : "active", arrow: true },
    { step: "⑤ OUTBOX", n: String(outbox.filter((o) => o.st === "待送").length), label: zh ? "待送" : "pending", arrow: false },
  ];

  /* ---- KPI 卡產生器（1:1 對應原型 kpi(actId,label,val,sub,valColor)）----
     uc 參數僅掛 data-uc 定位屬性（design gate semantic contract 用），像素中性。 */
  const kpi = (hash: string, label: string, val: string, sub: ReactNode, valColor?: string, uc?: string) => (
    <div className="hv-accent-border" data-uc={uc} onClick={() => nav(hash)} style={{ ...chipBox, padding: "var(--ab-space-6)", display: "flex", flexDirection: "column", gap: "var(--ab-space-2)", cursor: "pointer" }}>
      <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", letterSpacing: "var(--ab-track-10)", color: "var(--ab-text-dim)", textTransform: "uppercase" }}>{label}</span>
      <span data-uc={uc ? uc + "-val" : undefined} style={valColor ? { fontSize: "var(--ab-fs-26)", fontWeight: "var(--ab-fw-700)", fontFamily: "var(--ab-mono)", color: valColor } : { fontSize: "var(--ab-fs-26)", fontWeight: "var(--ab-fw-700)", fontFamily: "var(--ab-mono)" }}>{val}</span>
      <span style={{ fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-muted)" }}>{sub}</span>
    </div>
  );

  const launcherApps = apps.filter((a) => SHOW_CONCEPT_APPS || a.tone === "live");

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--ab-space-7) var(--ab-space-8)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-18)" }}>
      {/* ---- 標題列 ---- */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--ab-space-5)" }}>
        <span style={{ fontSize: "var(--ab-fs-20)", fontWeight: "var(--ab-fw-700)" }}>{L.home_title}</span>
        <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text-dim)" }}>2026-07-14 · Demo Project – A1 Tower</span>
      </div>
      {/* ---- KPI 卡 ×4 ---- */}
      <div data-prov="fixture" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--ab-space-5)" }}>
        {kpi("#pipeline", L.kpi_conv, String(conv.filter((c) => c.st === "running").length), <>990_model.ifc 62% · <span style={{ color: "var(--ab-danger)" }}>1 失敗</span></>, undefined, "kpi-conv")}
        {kpi("#pipeline", L.kpi_sess, String(sessions.length), "editor lease 1 · spectator 1", undefined, "kpi-sess")}
        {kpi("#issues", L.kpi_issue, String(issues.length + 10), L.kpi_issue_sub, "var(--ab-danger)", "kpi-issue")}
        {kpi("#runtime", L.kpi_outbox, String(outbox.filter((o) => o.st === "待送").length), "metadata-only callback", "var(--ab-warn)", "kpi-outbox")}
      </div>
      {/* ---- 資料生產線快照 + 警示/事件 ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: "var(--ab-space-5)" }}>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-6)", display: "flex", flexDirection: "column", gap: "var(--ab-space-5)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
            <span style={{ fontSize: "var(--ab-fs-13-5)", fontWeight: "var(--ab-fw-700)" }}>{L.pipe_snap}</span>
            <span data-uc="enter-pipeline" onClick={() => nav("#pipeline")} style={{ marginLeft: "auto", fontSize: "var(--ab-fs-mono)", color: "var(--ab-accent)", cursor: "pointer" }}>{L.enter} →</span>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {pipeSnap.map((p) => (
              <div key={p.step} style={{ flex: 1, display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
                <div className="hv-accent-border-strong" onClick={() => nav("#pipeline")} style={{ flex: 1, background: "var(--ab-inset)", border: "var(--ab-space-px-1) solid var(--ab-border-mid)", borderRadius: "var(--ab-r-lg)", padding: "var(--ab-space-4) var(--ab-space-5)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-3)", cursor: "pointer" }}>
                  <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9)", letterSpacing: "var(--ab-track-08)", color: "var(--ab-text-code)" }}>{p.step}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "var(--ab-space-2)" }}><span style={{ fontSize: "var(--ab-fs-19)", fontWeight: "var(--ab-fw-700)", fontFamily: "var(--ab-mono)" }}>{p.n}</span><span style={{ fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-muted)" }}>{p.label}</span></div>
                </div>
                {p.arrow ? <span style={{ color: "var(--ab-text-faint)", padding: "0 var(--ab-space-2)", fontFamily: "var(--ab-mono)" }}>→</span> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: "var(--ab-space-3)", alignItems: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-dim)" }}>
            <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", letterSpacing: "var(--ab-track-08)", textTransform: "uppercase" }}>F1</span>
            <span>{L.f1_desc}</span>
          </div>
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: "var(--ab-space-6)", display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
          <span style={{ fontSize: "var(--ab-fs-13-5)", fontWeight: "var(--ab-fw-700)" }}>{L.alerts}</span>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-px-9)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "var(--ab-r-round)", background: a.c, flex: "none" }} />
              <span style={{ flex: 1, fontSize: "var(--ab-fs-xs)", color: "var(--ab-text-2)" }}>{zh ? a.msgZh : a.msgEn}</span>
              <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dimmer)" }}>{a.t}</span>
            </div>
          ))}
        </div>
      </div>
      {/* ---- 應用啟動器 ---- */}
      <div data-prov="fixture" style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-4)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--ab-space-4)" }}>
          <span style={{ fontSize: "var(--ab-fs-13-5)", fontWeight: "var(--ab-fw-700)" }}>{L.launcher}</span>
          <span style={{ fontSize: "var(--ab-fs-mono)", color: "var(--ab-text-dim)" }}>A1–A4 live · A5–A10 Concept Preview</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "var(--ab-space-4)" }}>
          {launcherApps.map((a) => (
            <div
              key={a.code}
              className="hv-card"
              onClick={() => nav(a.hash)}
              style={a.tone === "live"
                ? { background: "var(--ab-surface)", border: "var(--ab-space-px-1) solid var(--ab-border-strong)", borderRadius: "var(--ab-r-xl)", padding: "var(--ab-space-px-13) var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-5)", cursor: "pointer", transition: "all .15s" }
                : { background: "var(--ab-surface)", border: "var(--ab-space-px-1) solid var(--ab-border-faint)", borderRadius: "var(--ab-r-xl)", padding: "var(--ab-space-px-13) var(--ab-space-px-14)", display: "flex", flexDirection: "column", gap: "var(--ab-space-px-5)", cursor: "pointer", transition: "all .15s", opacity: 0.75 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-2)" }}>
                <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-mono)", fontWeight: "var(--ab-fw-600)", color: "var(--ab-text-code)" }}>{a.code}</span>
                <span style={badgeTone(a.tone)}>{a.badge}</span>
              </div>
              <span style={{ fontSize: "var(--ab-fs-12-5)", fontWeight: "var(--ab-fw-500)", color: "var(--ab-text)" }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={{ fontSize: "var(--ab-fs-10)", color: "var(--ab-text-dim)" }}>{appEn[a.code]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
