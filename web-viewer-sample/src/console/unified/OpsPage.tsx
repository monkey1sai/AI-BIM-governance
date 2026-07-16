// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Ops 頁（Runtime / Kit · GPU 營運）
// 像素級移植正本：scratchpad/design-origin/app.js「═══ OPS ═══」區段
// 視覺標的：docs/plans/design-system-baseline/runtime.ops.default/1440x900.png
// 所有 inline style / 文案 byte-identical；GPU/Kit 固定值照原型抄寫並以
// data-prov="fixture" 誠實標記。互動為 fixture 語意（toast 假 API 字串），
// 不打任何 /api。須在 UnifiedShell（UnifiedStateProvider）內渲染。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";
import { useLang } from "../i18n";
import { MONO, chipBox, getL, services } from "./fixtures";
import { useUnifiedState } from "./UnifiedShell";

/* 1:1 對應原型 gpuBar(label, pct, fill, text) 產生器 */
function gpuBar(label: string, pct: string, fill: string, text: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "#8aa0b8", width: 70 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(120,160,210,.12)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct, background: fill }} />
      </div>
      <span style={{ fontFamily: MONO, fontSize: "10.5px", color: "#dbe6f3" }}>{text}</span>
    </div>
  );
}

const cardBase: CSSProperties = { ...chipBox, padding: 16, display: "flex", flexDirection: "column" };

export function OpsPage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { toast } = useUnifiedState();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{L.ops_title}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {/* ── Kit Instance ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Kit Instance</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#4fd68a", background: "rgba(49,197,109,.08)", border: "1px solid rgba(49,197,109,.22)", borderRadius: 4, padding: "1px 6px" }}>running</span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: "10.5px", color: "#8aa0b8", display: "flex", flexDirection: "column", gap: 4 }}>
            <span>usd_viewer.kit · RTX renderer</span>
            <span>stage: /Review/A1_Tower_fed.usd</span>
            <span>signaling :49100 · media :47998</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span
              className="hv-accent-bg"
              data-uc="open-stage"
              style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#6fd6ee", border: "1px solid rgba(65,199,232,.3)", borderRadius: 7, padding: 6, cursor: "pointer" }}
              onClick={() => toast("POST /api/kit/instances/current/open → stage loading")}
            >open stage</span>
            <span
              className="hv-danger-bg"
              style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#e8615c", border: "1px solid rgba(232,97,92,.3)", borderRadius: 7, padding: 6, cursor: "pointer" }}
              onClick={() => toast("POST /api/kit/instances/current/close → ✓")}
            >close</span>
          </div>
        </div>
        {/* ── GPU Fleet ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>GPU Fleet</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {gpuBar("GPU 0", "82%", "linear-gradient(90deg,#31c56d,#41c7e8)", "82%")}
            {gpuBar("GPU 1", "24%", "linear-gradient(90deg,#31c56d,#41c7e8)", "24%")}
            {gpuBar("VRAM", "61%", "linear-gradient(90deg,#e6b23e,#e8615c)", "14.6/24 GB")}
          </div>
          <span style={{ fontFamily: MONO, fontSize: "9.5px", color: "#4d6076" }}>kit-manager-api :8010 · /api/kit/* proxy</span>
        </div>
        {/* ── 服務健康 ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{L.svc_health}</span>
          {services.map((sv) => (
            <div key={sv.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span data-uc="svc-dot" data-ok={sv.ok ? "true" : "false"} style={{ width: 7, height: 7, borderRadius: "50%", background: sv.ok ? "#31c56d" : "#e8615c", flex: "none" }} />
              <span style={{ fontSize: "11.5px", color: "#b9c9da", flex: 1 }}>{sv.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a7089" }}>{sv.port}</span>
            </div>
          ))}
        </div>
      </div>
      {/* ── structLog · 最近事件 ── */}
      <div data-prov="fixture" style={{ ...cardBase, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{`structLog · ${L.recent}`}</span>
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "9.5px", color: "#4d6076" }}>GET /api/internal/structLog/health ✓</span>
        </div>
        <div style={{ fontFamily: MONO, fontSize: "10.5px", color: "#5a7089", display: "flex", flexDirection: "column", gap: 4 }}>
          <span><span style={{ color: "#4fd68a" }}>INFO</span> 10:53:43 review-session S-240601 first-frame 1840ms</span>
          <span><span style={{ color: "#4fd68a" }}>INFO</span> 10:53:12 viewer-lease claim lease_8812 role=editor</span>
          <span><span style={{ color: "#e6b23e" }}>WARN</span> 10:41:02 callback-outbox retry ×2 OB-201</span>
          <span><span style={{ color: "#4fd68a" }}>INFO</span> 10:20:19 conversion cj_0117 done → ingest quality-metrics</span>
        </div>
      </div>
    </div>
  );
}

export default OpsPage;
