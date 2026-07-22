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
import { chipBox, getL, services } from "./fixtures";
import { useUnifiedState } from "./UnifiedShell";

/* 1:1 對應原型 gpuBar(label, pct, fill, text) 產生器 */
function gpuBar(label: string, pct: string, fill: string, text: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
      <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text-muted)", width: 70 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: "var(--ab-r-px-3)", background: "var(--ab-border)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct, background: fill }} />
      </div>
      <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text)" }}>{text}</span>
    </div>
  );
}

const cardBase: CSSProperties = { ...chipBox, padding: "var(--ab-space-6)", display: "flex", flexDirection: "column" };

export function OpsPage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const { toast } = useUnifiedState();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--ab-space-7) var(--ab-space-8)", display: "flex", flexDirection: "column", gap: "var(--ab-space-6)" }}>
      <span style={{ fontSize: "var(--ab-fs-20)", fontWeight: "var(--ab-fw-700)" }}>{L.ops_title}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--ab-space-5)" }}>
        {/* ── Kit Instance ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: "var(--ab-space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
            <span style={{ fontSize: "var(--ab-fs-sm)", fontWeight: "var(--ab-fw-700)" }}>Kit Instance</span>
            <span style={{ marginLeft: "auto", fontSize: "var(--ab-fs-10)", color: "var(--ab-ok-text)", background: "var(--ab-ok-a08)", border: "var(--ab-space-px-1) solid var(--ab-ok-a22)", borderRadius: "var(--ab-r-xs)", padding: "var(--ab-space-px-1) var(--ab-space-2)" }}>running</span>
          </div>
          <div style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text-muted)", display: "flex", flexDirection: "column", gap: "var(--ab-space-1)" }}>
            <span>usd_viewer.kit · RTX renderer</span>
            <span>stage: /Review/A1_Tower_fed.usd</span>
            <span>signaling :49100 · media :47998</span>
          </div>
          <div style={{ display: "flex", gap: "var(--ab-space-3)" }}>
            <span
              className="hv-accent-bg"
              data-uc="open-stage"
              style={{ flex: 1, textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-accent-text)", border: "var(--ab-space-px-1) solid var(--ab-border-accent)", borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-2)", cursor: "pointer" }}
              onClick={() => toast("POST /api/kit/instances/current/open → stage loading")}
            >open stage</span>
            <span
              className="hv-danger-bg"
              style={{ flex: 1, textAlign: "center", fontSize: "var(--ab-fs-mono)", color: "var(--ab-danger)", border: "var(--ab-space-px-1) solid var(--ab-danger-a30)", borderRadius: "var(--ab-r-px-7)", padding: "var(--ab-space-2)", cursor: "pointer" }}
              onClick={() => toast("POST /api/kit/instances/current/close → ✓")}
            >close</span>
          </div>
        </div>
        {/* ── GPU Fleet ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: "var(--ab-space-4)" }}>
          <span style={{ fontSize: "var(--ab-fs-sm)", fontWeight: "var(--ab-fw-700)" }}>GPU Fleet</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--ab-space-3)" }}>
            {gpuBar("GPU 0", "82%", "linear-gradient(90deg,var(--ab-ok),var(--ab-accent))", "82%")}
            {gpuBar("GPU 1", "24%", "linear-gradient(90deg,var(--ab-ok),var(--ab-accent))", "24%")}
            {gpuBar("VRAM", "61%", "linear-gradient(90deg,var(--ab-warn),var(--ab-danger))", "14.6/24 GB")}
          </div>
          <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dimmer)" }}>kit-manager-api :8010 · /api/kit/* proxy</span>
        </div>
        {/* ── 服務健康 ── */}
        <div data-prov="fixture" style={{ ...cardBase, gap: "var(--ab-space-3)" }}>
          <span style={{ fontSize: "var(--ab-fs-sm)", fontWeight: "var(--ab-fw-700)" }}>{L.svc_health}</span>
          {services.map((sv) => (
            <div key={sv.name} style={{ display: "flex", alignItems: "center", gap: "var(--ab-space-3)" }}>
              <span data-uc="svc-dot" data-ok={sv.ok ? "true" : "false"} style={{ width: 7, height: 7, borderRadius: "var(--ab-r-round)", background: sv.ok ? "var(--ab-ok)" : "var(--ab-danger)", flex: "none" }} />
              <span style={{ fontSize: "var(--ab-fs-11-5)", color: "var(--ab-text-2)", flex: 1 }}>{sv.name}</span>
              <span style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10)", color: "var(--ab-text-dim)" }}>{sv.port}</span>
            </div>
          ))}
        </div>
      </div>
      {/* ── structLog · 最近事件 ── */}
      <div data-prov="fixture" style={{ ...cardBase, gap: "var(--ab-space-3)" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: "var(--ab-fs-sm)", fontWeight: "var(--ab-fw-700)" }}>{`structLog · ${L.recent}`}</span>
          <span style={{ marginLeft: "auto", fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-9-5)", color: "var(--ab-text-dimmer)" }}>GET /api/internal/structLog/health ✓</span>
        </div>
        <div style={{ fontFamily: "var(--ab-mono)", fontSize: "var(--ab-fs-10-5)", color: "var(--ab-text-dim)", display: "flex", flexDirection: "column", gap: "var(--ab-space-1)" }}>
          <span><span style={{ color: "var(--ab-ok-text)" }}>INFO</span> 10:53:43 review-session S-240601 first-frame 1840ms</span>
          <span><span style={{ color: "var(--ab-ok-text)" }}>INFO</span> 10:53:12 viewer-lease claim lease_8812 role=editor</span>
          <span><span style={{ color: "var(--ab-warn)" }}>WARN</span> 10:41:02 callback-outbox retry ×2 OB-201</span>
          <span><span style={{ color: "var(--ab-ok-text)" }}>INFO</span> 10:20:19 conversion cj_0117 done → ingest quality-metrics</span>
        </div>
      </div>
    </div>
  );
}

export default OpsPage;
