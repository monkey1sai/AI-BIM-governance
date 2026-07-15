// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 3D Workspace 右欄 dock 面板（A1/A2/A3/A4/Issues）
// 像素級移植正本：scratchpad/design-origin/app.js（ws 區段 dock content）
// 所有 inline style / 文案 byte-identical；互動為 fixture 語意（local state +
// toast 假 API 字串），不打任何 /api。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties, MouseEvent } from "react";
import { useUnifiedState } from "./UnifiedShell";
import {
  ACCENT, MONO, BTN, label9, sevTone, kindTone, memColors,
  ruleDefs, failDefs, diffDefs, fedMembers, a4Defs,
} from "./fixtures";
import type {
  Dict, DockKey, IssueItem, OutboxItem, RuleOn, SelItem,
} from "./fixtures";

/* ═══ workspace 本地 state（1:1 對應原型 state 的 ws 相關欄位）═══ */
export interface WsLocal {
  dock: DockKey;
  sel: SelItem | null;
  dcLog: string;
  a1Ran: boolean;
  a2Ran: boolean;
  a3Built: boolean;
  a4Ran: boolean;
  overlayOn: boolean;
  ruleOn: RuleOn;
  opened: Record<string, boolean>;
}

export interface DockProps {
  zh: boolean;
  L: Dict;
  ws: WsLocal;
  patch: (p: Partial<WsLocal>) => void;
}

/* ── 共用 style（逐字翻譯原型 template inline style）── */
const dockRoot: CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 12 };
const dockHead: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const dockTitle: CSSProperties = { fontSize: "13.5px", fontWeight: 700 };
const liveChip: CSSProperties = { fontFamily: MONO, fontSize: 9, color: "#4fd68a", background: "rgba(49,197,109,.1)", border: "1px solid rgba(49,197,109,.25)", borderRadius: 4, padding: "1px 6px" };

/** [color, "rgba(r,g,b" 前綴] → sev/kind chip（原型 `${t[1]},.1)` / `${t[1]},.3)`） */
function toneChip(t: readonly [string, string]): CSSProperties {
  return { flex: "none", fontSize: "9.5px", padding: "2px 7px", borderRadius: 4, color: t[0], background: `${t[1]},.1)`, border: `1px solid ${t[1]},.3)` };
}

/** 失敗列 / diff 列 / A4 列外框（sel 命中 → accent 邊框） */
function rowBox(selected: boolean): CSSProperties {
  return { display: "flex", alignItems: "center", gap: 9, background: "#0a1220", border: `1px solid ${selected ? "rgba(65,199,232,.5)" : "rgba(120,160,210,.12)"}`, borderRadius: 9, padding: "8px 10px", cursor: "pointer" };
}

const accentGhostBtn: CSSProperties = { flex: 1, textAlign: "center", fontSize: "11.5px", color: "#6fd6ee", border: "1px solid rgba(65,199,232,.3)", borderRadius: 8, padding: 7, cursor: "pointer" };
const plainGhostBtn: CSSProperties = { flex: 1, textAlign: "center", fontSize: "11.5px", color: "#8aa0b8", border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, padding: 7, cursor: "pointer" };

/* ═══ A1 治理檢核 ═══ */
export function A1Dock({ zh, L, ws, patch }: DockProps) {
  const u = useUnifiedState();
  return (
    <div data-prov="fixture" style={dockRoot}>
      <div style={dockHead}><span style={dockTitle}>A1 {L.a1}</span><span style={liveChip}>LIVE</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label9}>{L.file}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#0a1220", border: "1px solid rgba(120,160,210,.14)", borderRadius: 8, padding: "8px 10px" }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: "#b9c9da" }}>A1_Tower_v12.ifc</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#4fd68a" }}>✓ mapping 98%</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label9}>{L.rules}</span>
        {ruleDefs.map((r) => (
          <div key={r.k} className="hv-bg-soft" onClick={() => patch({ ruleOn: { ...ws.ruleOn, [r.k]: !ws.ruleOn[r.k] } })} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer" }}>
            <span style={{ width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flex: "none", ...(ws.ruleOn[r.k] ? { background: ACCENT, color: "#04121a", fontWeight: 700 } : { border: "1px solid rgba(120,160,210,.3)" }) }}>{ws.ruleOn[r.k] ? "✓" : ""}</span>
            <span style={{ fontSize: 12, color: "#b9c9da", flex: 1 }}>{zh ? r.labelZh : r.labelEn}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "#4d6076" }}>{r.code}</span>
          </div>
        ))}
      </div>
      <div className="hv-bright" style={BTN} onClick={() => { patch({ a1Ran: true, dcLog: "highlightPrimsRequest → ack ✓ (18 prims)" }); u.toast("POST /api/rule-runs → 202 · run #88 " + (zh ? "完成:失敗 18" : "done: 18 failures")); }}>{ws.a1Ran ? L.rerun : L.run}</div>
      {ws.a1Ran ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label9}>rule-run #88 · {L.fails} 18</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#e8615c", background: "rgba(232,97,92,.1)", border: "1px solid rgba(232,97,92,.3)", borderRadius: 4, padding: "1px 6px" }}>嚴重 18</span>
            <span style={{ fontSize: 10, color: "#e6b23e", background: "rgba(230,178,62,.1)", border: "1px solid rgba(230,178,62,.3)", borderRadius: 4, padding: "1px 6px" }}>高 32</span>
          </div>
          {failDefs.map((f) => {
            const el = zh ? f.elZh : f.elEn;
            const rule = zh ? f.ruleZh : f.ruleEn;
            const sev = zh ? f.sevZh : f.sevEn;
            const t = sevTone[sev];
            const opened = ws.opened[f.id];
            const open = (e: MouseEvent<HTMLSpanElement>) => {
              e.stopPropagation();
              if (ws.opened[f.id]) return;
              const id = u.issueSeq;
              patch({ opened: { ...ws.opened, [f.id]: true } });
              u.patch({
                issues: [{ id: "ISS-" + id, title: el + " · " + rule, st: "open", src: "rule-run #88" }, ...u.issues],
                issueSeq: id + 1,
              });
              u.toast(`POST /api/issues/from-rule-run/88 → 201 · ISS-${id}`);
            };
            return (
              <div key={f.id} className="hv-accent-border-strong" onClick={() => patch({ sel: { name: el, path: f.path }, dcLog: `highlightPrimsRequest → ack ✓ ${f.path}` })} style={rowBox(ws.sel !== null && ws.sel.path === f.path)}>
                <span style={toneChip(t)}>{sev}</span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: "11.5px", color: "#dbe6f3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{el}</span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: "#5a7089" }}>{rule}</span>
                </div>
                <span className="hv-bright-more" onClick={open} style={{ flex: "none", fontSize: 10, padding: "3px 9px", borderRadius: 6, cursor: "pointer", ...(opened ? { color: "#4fd68a", border: "1px solid rgba(49,197,109,.3)" } : { color: "#04121a", background: ACCENT, fontWeight: 700 }) }}>{opened ? "✓" : (zh ? "開單" : "issue")}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <span className="hv-accent-bg" onClick={() => u.toast("GET /api/bcf/export → bcf_2.1_export.zip (" + u.issues.length + " topics)")} style={accentGhostBtn}>{L.bcf}</span>
            <span className="hv-text" onClick={() => patch({ sel: null, dcLog: "clearHighlightRequest → ✓" })} style={plainGhostBtn}>{L.clear}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══ A2 版本 Diff ═══ */
export function A2Dock({ zh, L, ws, patch }: DockProps) {
  const u = useUnifiedState();
  const verBox: CSSProperties = { flex: 1, background: "#0a1220", border: "1px solid rgba(120,160,210,.14)", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", gap: 6 };
  return (
    <div data-prov="fixture" style={dockRoot}>
      <div style={dockHead}><span style={dockTitle}>A2 {L.a2}</span><span style={liveChip}>LIVE</span></div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={verBox}><span style={{ fontFamily: MONO, fontSize: 11 }}>v12</span><span style={{ fontSize: 10, color: "#5a7089" }}>2026-06-01</span><span style={{ marginLeft: "auto", color: "#5a7089", fontSize: 10 }}>▾</span></div>
        <span style={{ fontFamily: MONO, color: "#5a7089", fontSize: 11 }}>vs</span>
        <div style={verBox}><span style={{ fontFamily: MONO, fontSize: 11 }}>v15</span><span style={{ fontSize: 10, color: "#5a7089" }}>2026-07-01</span><span style={{ marginLeft: "auto", color: "#5a7089", fontSize: 10 }}>▾</span></div>
      </div>
      <div className="hv-bright" style={BTN} onClick={() => { patch({ a2Ran: true }); u.toast("POST /api/diffs → 202 · diff v12→v15 " + (zh ? "完成" : "done")); }}>{ws.a2Ran ? L.rerun : (zh ? "計算差異" : "Compute diff")}</div>
      {ws.a2Ran ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#6fd6ee", background: "rgba(65,199,232,.08)", border: "1px solid rgba(65,199,232,.25)", borderRadius: 7, padding: 5 }}>■ {L.added} 12</span>
            <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#e8615c", background: "rgba(232,97,92,.08)", border: "1px solid rgba(232,97,92,.25)", borderRadius: 7, padding: 5 }}>■ {L.removed} 4</span>
            <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#e6b23e", background: "rgba(230,178,62,.08)", border: "1px solid rgba(230,178,62,.25)", borderRadius: 7, padding: 5 }}>■ {L.modified} 28</span>
          </div>
          {diffDefs.map((d, i) => {
            const el = zh ? d.elZh : d.elEn;
            const kind = zh ? d.kindZh : d.kindEn;
            const t = kindTone[d.tone];
            return (
              <div key={d.detail} className="hv-accent-border-strong" onClick={() => patch({ sel: { name: el, path: "/World/diff/" + i }, dcLog: `focusPrimResult ✓ (${el})` })} style={rowBox(ws.sel !== null && ws.sel.path === "/World/diff/" + i)}>
                <span style={toneChip(t)}>{kind}</span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: "11.5px", color: "#dbe6f3" }}>{el}</span>
                  <span style={{ fontFamily: MONO, fontSize: 9, color: "#5a7089" }}>{d.detail}</span>
                </div>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <span className="hv-accent-bg" onClick={() => { patch({ overlayOn: true, dcLog: "apply-overlay → highlightPrimsRequest ✓ (44 prims)" }); u.toast("POST /api/diffs/d_031/apply-overlay → ✓"); }} style={accentGhostBtn}>{L.overlay}</span>
            <span className="hv-text" onClick={() => { u.patch({ issues: [{ id: "ISS-" + u.issueSeq, title: "B-3F-12 樑位移 +42mm(v12→v15)", st: "open", src: "diff v12→v15" }, ...u.issues], issueSeq: u.issueSeq + 1 }); u.toast("POST /api/issues/from-diff/d_031 → 201"); }} style={plainGhostBtn}>{L.fromdiff}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══ A3 Federation ═══ */
export function A3Dock({ zh, L, ws, patch }: DockProps) {
  const u = useUnifiedState();
  const checkChip: CSSProperties = { flex: 1, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#4fd68a", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.22)", borderRadius: 7, padding: "6px 9px" };
  return (
    <div data-prov="fixture" style={dockRoot}>
      <div style={dockHead}><span style={dockTitle}>A3 Federation</span><span style={liveChip}>LIVE</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label9}>SubLayer {L.order}</span>
        {fedMembers.map((m) => (
          <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0a1220", border: "1px solid rgba(120,160,210,.12)", borderRadius: 8, padding: "7px 9px" }}>
            <span style={{ color: "#3d5570", cursor: "grab", fontSize: 11 }}>⠿</span>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: memColors[m.name] }} />
            <span style={{ fontSize: "11.5px", color: "#dbe6f3", width: 52 }}>{m.name}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, color: "#5a7089", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.path}</span>
            <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "#4d6076" }}>{m.ver}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <span style={checkChip}>✓ Coordinate Check OK</span>
        <span style={checkChip}>✓ {L.unit} m · CRS 一致</span>
      </div>
      <div className="hv-bright" style={BTN} onClick={() => { patch({ a3Built: true }); u.toast("POST /api/federated-sets/FS-01/build → Federated USD ✓"); }}>{ws.a3Built ? (zh ? "重新建置" : "Rebuild") : "Build Federated USD"}</div>
      {ws.a3Built ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#0a1220", border: "1px solid rgba(49,197,109,.25)", borderRadius: 10, padding: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "#4fd68a", textTransform: "uppercase" }}>Federated Stage ✓</span>
          <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "#b9c9da" }}>/Review/A1_Tower_fed.usd</span>
          <span style={{ fontSize: "10.5px", color: "#5a7089" }}>5 members · 12.48M tris · flatten off</span>
          <span className="hv-bright" onClick={() => { patch({ dock: "a1" }); u.toast("GET /api/federated-sets/FS-01/review-room → S-240601"); }} style={{ textAlign: "center", fontSize: "11.5px", color: "#04121a", background: `linear-gradient(135deg,${ACCENT},#2f7bf6)`, borderRadius: 8, padding: 7, cursor: "pointer", fontWeight: 700 }}>Open in Review Room →</span>
        </div>
      ) : null}
    </div>
  );
}

/* ═══ A4 語意查詢 ═══ */
export function A4Dock({ zh, L, ws, patch }: DockProps) {
  const u = useUnifiedState();
  return (
    <div data-prov="fixture" style={dockRoot}>
      <div style={dockHead}><span style={dockTitle}>A4 {L.a4}</span><span style={liveChip}>LIVE</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label9}>{L.nlq}</span>
        <div style={{ background: "#0a1220", border: "1px solid rgba(65,199,232,.3)", borderRadius: 9, padding: "10px 12px", fontSize: 12, color: "#dbe6f3", lineHeight: 1.5 }}>找出 4F 所有防火門並標示未符合規範者<span style={{ display: "inline-block", width: 1, height: 13, background: "#41c7e8", marginLeft: 2, animation: "pulse 1.2s infinite", verticalAlign: "-2px" }} /></div>
      </div>
      <div className="hv-bright" style={BTN} onClick={() => { patch({ a4Ran: true }); u.toast("POST /api/search/model → 12 hits · " + (zh ? "信心度 0.86" : "confidence 0.86")); }}>{ws.a4Ran ? L.rerun : (zh ? "執行查詢" : "Run query")}</div>
      {ws.a4Ran ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={label9}>{L.results} · 12 IfcDoor</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#e8615c" }}>不符合 5</span><span style={{ fontSize: 10, color: "#4fd68a" }}>符合 7</span>
          </div>
          {a4Defs.map((q) => (
            <div key={q.el} className="hv-accent-border-strong" onClick={() => patch({ sel: { name: "IfcDoor " + q.el, path: "/World/A1_Tower/4F/Doors/" + q.el }, dcLog: `highlightPrimsRequest → ack ✓ (${q.el})` })} style={rowBox(ws.sel !== null && ws.sel.name === "IfcDoor " + q.el)}>
              <span style={{ flex: "none", fontSize: "9.5px", padding: "2px 7px", borderRadius: 4, ...(q.ok ? { color: "#4fd68a", background: "rgba(49,197,109,.1)", border: "1px solid rgba(49,197,109,.3)" } : { color: "#e8615c", background: "rgba(232,97,92,.1)", border: "1px solid rgba(232,97,92,.3)" }) }}>{q.ok ? (zh ? "符合" : "pass") : (zh ? "不符合" : "fail")}</span>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontSize: "11.5px", color: "#dbe6f3" }}>{q.el}</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: "#5a7089" }}>{q.pset}</span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#8aa0b8" }}>{q.conf}</span>
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, background: "#0a1220", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: 10 }}>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: ".1em", color: "#9d8cff", textTransform: "uppercase" }}>Evidence Trace</span>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px" }}><span style={{ color: "#8aa0b8" }}>規範條文 · 建築技術規則 76 條</span><span style={{ color: "#4fd68a" }}>Matched</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px" }}><span style={{ color: "#8aa0b8" }}>Pset_DoorCommon.FireRating</span><span style={{ color: "#4fd68a" }}>Matched</span></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ═══ Issues / BCF ═══ */
export function IssuesDock({ L }: DockProps) {
  const u = useUnifiedState();
  const stTone: Record<string, readonly [string, string]> = { open: ["#e8615c", "rgba(232,97,92"], "in-review": ["#e6b23e", "rgba(230,178,62"] };
  return (
    <div data-prov="fixture" style={dockRoot}>
      <div style={dockHead}><span style={dockTitle}>Issues / BCF</span><span style={{ fontFamily: MONO, fontSize: 10, color: "#8aa0b8" }}>{u.issues.length + 10} open</span></div>
      {u.issues.map((i: IssueItem) => {
        const t = stTone[i.st] ?? stTone.open;
        return (
          <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 5, background: "#0a1220", border: "1px solid rgba(120,160,210,.12)", borderRadius: 9, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "#5a8db0" }}>{i.id}</span>
              <span style={{ fontSize: 9, fontFamily: MONO, padding: "1px 6px", borderRadius: 4, color: t[0], background: `${t[1]},.1)`, border: `1px solid ${t[1]},.3)` }}>{i.st}</span>
              <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9, color: "#4d6076" }}>{i.src}</span>
            </div>
            <span style={{ fontSize: 12, color: "#dbe6f3" }}>{i.title}</span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8 }}>
        <span className="hv-bright" onClick={() => u.toast("GET /api/bcf/export → bcf_2.1_export.zip (" + u.issues.length + " topics)")} style={{ flex: 1, textAlign: "center", fontSize: "11.5px", color: "#04121a", background: `linear-gradient(135deg,${ACCENT},#2f7bf6)`, borderRadius: 8, padding: 8, cursor: "pointer", fontWeight: 700 }}>{L.bcf}</span>
        <span className="hv-text" onClick={() => { u.patch({ outbox: u.outbox.map((o): OutboxItem => ({ ...o, st: "已送" })) }); u.toast("POST /api/internal/callback-outbox/deliver → ✓ metadata-only"); }} style={{ flex: 1, textAlign: "center", fontSize: "11.5px", color: "#8aa0b8", border: "1px solid rgba(120,160,210,.16)", borderRadius: 8, padding: 8, cursor: "pointer" }}>{L.outbox}</span>
      </div>
    </div>
  );
}
