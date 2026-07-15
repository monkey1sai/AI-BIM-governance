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
  MONO, SHOW_CONCEPT_APPS, getL, apps, appEn, alerts, badgeTone, chipBox,
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
    <div className="hv-accent-border" data-uc={uc} onClick={() => nav(hash)} style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
      <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".1em", color: "#5a7089", textTransform: "uppercase" }}>{label}</span>
      <span data-uc={uc ? uc + "-val" : undefined} style={valColor ? { fontSize: 26, fontWeight: 700, fontFamily: MONO, color: valColor } : { fontSize: 26, fontWeight: 700, fontFamily: MONO }}>{val}</span>
      <span style={{ fontSize: 11, color: "#8aa0b8" }}>{sub}</span>
    </div>
  );

  const launcherApps = apps.filter((a) => SHOW_CONCEPT_APPS || a.tone === "live");

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ---- 標題列 ---- */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{L.home_title}</span>
        <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "#5a7089" }}>2026-07-14 · Demo Project – A1 Tower</span>
      </div>
      {/* ---- KPI 卡 ×4 ---- */}
      <div data-prov="fixture" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {kpi("#conv", L.kpi_conv, String(conv.filter((c) => c.st === "running").length), <>990_model.ifc 62% · <span style={{ color: "#e8615c" }}>1 失敗</span></>, undefined, "kpi-conv")}
        {kpi("#conv", L.kpi_sess, String(sessions.length), "editor lease 1 · spectator 1", undefined, "kpi-sess")}
        {kpi("#issues", L.kpi_issue, String(issues.length + 10), L.kpi_issue_sub, "#e8615c", "kpi-issue")}
        {kpi("#runtime", L.kpi_outbox, String(outbox.filter((o) => o.st === "待送").length), "metadata-only callback", "#e6b23e", "kpi-outbox")}
      </div>
      {/* ---- 資料生產線快照 + 警示/事件 ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12 }}>
        <div data-prov="fixture" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.pipe_snap}</span>
            <span data-uc="enter-pipeline" onClick={() => nav("#conv")} style={{ marginLeft: "auto", fontSize: 11, color: "#41c7e8", cursor: "pointer" }}>{L.enter} →</span>
          </div>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {pipeSnap.map((p) => (
              <div key={p.step} style={{ flex: 1, display: "flex", alignItems: "center", gap: 0, minWidth: 0 }}>
                <div className="hv-accent-border-strong" onClick={() => nav("#conv")} style={{ flex: 1, background: "#0a1220", border: "1px solid rgba(120,160,210,.14)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3, cursor: "pointer" }}>
                  <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".08em", color: "#5a8db0" }}>{p.step}</span>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}><span style={{ fontSize: 19, fontWeight: 700, fontFamily: MONO }}>{p.n}</span><span style={{ fontSize: 11, color: "#8aa0b8" }}>{p.label}</span></div>
                </div>
                {p.arrow ? <span style={{ color: "#3d5570", padding: "0 6px", fontFamily: MONO }}>→</span> : null}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#5a7089" }}>
            <span style={{ fontFamily: MONO, fontSize: "9.5px", letterSpacing: ".08em", textTransform: "uppercase" }}>F1</span>
            <span>{L.f1_desc}</span>
          </div>
        </div>
        <div data-prov="fixture" style={{ ...chipBox, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.alerts}</span>
          {alerts.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: a.c, flex: "none" }} />
              <span style={{ flex: 1, fontSize: 12, color: "#b9c9da" }}>{zh ? a.msgZh : a.msgEn}</span>
              <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "#4d6076" }}>{a.t}</span>
            </div>
          ))}
        </div>
      </div>
      {/* ---- 應用啟動器 ---- */}
      <div data-prov="fixture" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{L.launcher}</span>
          <span style={{ fontSize: 11, color: "#5a7089" }}>A1–A4 live · A5–A10 Concept Preview</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          {launcherApps.map((a) => (
            <div
              key={a.code}
              className="hv-card"
              onClick={() => nav(a.hash)}
              style={a.tone === "live"
                ? { background: "#0e1621", border: "1px solid rgba(120,160,210,.16)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s" }
                : { background: "#0e1621", border: "1px solid rgba(120,160,210,.09)", borderRadius: 12, padding: "13px 14px", display: "flex", flexDirection: "column", gap: 5, cursor: "pointer", transition: "all .15s", opacity: 0.75 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, color: "#5a8db0" }}>{a.code}</span>
                <span style={badgeTone(a.tone)}>{a.badge}</span>
              </div>
              <span style={{ fontSize: "12.5px", fontWeight: 500, color: "#dbe6f3" }}>{zh ? a.labelZh : a.labelEn}</span>
              <span style={{ fontSize: 10, color: "#5a7089" }}>{appEn[a.code]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
