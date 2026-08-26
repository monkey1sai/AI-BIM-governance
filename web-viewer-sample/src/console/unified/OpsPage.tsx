// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Ops 頁（Runtime / Kit · GPU 營運）
// unified-console-runtime-truth slice 1（tasks 1.6）：Kit instance 卡（GET /api/kit/instances/current）、GPU 卡
// （/api/runtime/status 與 kit instance 皆無 GPU 使用率欄位 → 誠實「未取得」，不渲染任何數值）、服務健康六列、
// 事件列誠實停用（coordinator 無事件端點；導向 #instances）。控制項只有 nav 或 disabled＋原因；不打任何 mutation。
// 版面沿用設計原型；須在 UnifiedShell（ConsoleDataProvider）內渲染。
// ═══════════════════════════════════════════════════════════════════════
import type { CSSProperties } from "react";
import { useLang } from "../i18n";
import { MONO, chipBox, getL } from "./fixtures";
import { useConsoleData } from "./consoleData";
import type { EndpointKey } from "./coordinatorStatusStore";
import { ServiceHealthList } from "./ServiceHealthList";
import { cell, cellSub, cellText, stateColor } from "./runtimeTruth";

const OPS_KEYS: readonly EndpointKey[] = ["kitInstance", "runtimeStatus", "kitHealth", "minioWatch", "ruleRuns"];

const cardBase: CSSProperties = { ...chipBox, padding: 16, display: "flex", flexDirection: "column" };
const navBtn: CSSProperties = { flex: 1, textAlign: "center", fontSize: 11, color: "var(--ab-accent-text)", border: "1px solid rgba(65,199,232,.3)", borderRadius: 7, padding: 6, cursor: "pointer", textDecoration: "none" };
const disabledBtn: CSSProperties = { textAlign: "center", fontSize: 11, color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 7, padding: "3px 9px", cursor: "not-allowed" };
const mono10: CSSProperties = { fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-muted)" };

export function OpsPage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(OPS_KEYS);
  const nav = (hash: string) => { window.location.hash = hash; };

  const kit = cell(snap.kitInstance, (k) => k);
  // 盤點（tasks 1.2）：/api/runtime/status 與 /api/kit/instances/current 皆無 GPU 使用率欄位 → live 即「未取得」，不捏造。
  const gpu = cell(snap.runtimeStatus, () => null);
  const link = (uc: string, hash: string, label: string) => (
    <a data-uc={uc} data-action="nav" href={hash} onClick={(e) => { e.preventDefault(); nav(hash); }} className="hv-accent-bg" style={navBtn}>{label}</a>
  );

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{L.ops_title}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        {/* ── Kit Instance（GET /api/kit/instances/current）── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Kit Instance</span>
            <span data-uc="kit-instance-state" data-state={kit.state} style={{ marginLeft: "auto", fontSize: 10, fontFamily: MONO, color: stateColor(kit.state) ?? "var(--ab-ok-text)", background: "rgba(120,160,210,.06)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 4, padding: "1px 6px" }}>{cellText(kit, L, (k) => k.status)}</span>
          </div>
          <div style={{ ...mono10, display: "flex", flexDirection: "column", gap: 4 }}>
            <span data-uc="kit-instance-id" data-prov="asbuilt" data-state={kit.state} style={{ color: stateColor(kit.state) ?? "var(--ab-text)" }}>{cellText(kit, L, (k) => k.instance_id)}</span>
            <span data-uc="kit-instance-detail">{cellSub(kit, L, (k) => `control ${k.control_status} · last ${k.last_command ?? "—"} · opened ${k.opened_runtime_uris.length}`)}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {link("to-instances", "#instances", zh ? "Kit / GPU 機隊 →" : "Kit / GPU fleet →")}
            {link("to-sessions", "#sessions", zh ? "Session 管理 →" : "Sessions →")}
          </div>
        </div>
        {/* ── GPU Fleet（無遙測來源 → 未取得）── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>GPU Fleet</span>
          <span data-uc="gpu-val" data-prov="asbuilt" data-state={gpu.state} style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO, color: stateColor(gpu.state) }}>{cellText(gpu, L)}</span>
          <span data-uc="gpu-sub" style={{ fontFamily: MONO, fontSize: "9.5px", color: "var(--ab-text-dimmer)" }}>
            {cellSub(gpu, L, () => "")}
            {gpu.state === "unavailable" ? (zh ? "：/api/runtime/status 與 /api/kit/instances/current 皆無 GPU 使用率欄位" : ": no GPU utilization field on /api/runtime/status or /api/kit/instances/current") : ""}
          </span>
          <div style={{ display: "flex", gap: 8 }}>{link("to-gpu", "#gpu", zh ? "GPU 審查室 →" : "GPU review room →")}</div>
        </div>
        {/* ── 服務健康 ── */}
        <div data-prov="asbuilt" style={{ ...cardBase, gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{L.svc_health}</span>
          <ServiceHealthList snap={snap} zh={zh} />
        </div>
      </div>
      {/* ── 事件（coordinator 無事件端點 → 誠實停用，導向 #instances）── */}
      <div data-prov="asbuilt" style={{ ...cardBase, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{`structLog · ${L.recent}`}</span>
          <span data-uc="events-disabled" role="button" aria-disabled="true" tabIndex={-1} data-action="disabled" data-prov="p1" aria-describedby="events-reason" style={{ ...disabledBtn, marginLeft: "auto" }}>{zh ? "事件流" : "event stream"}</span>
        </div>
        <span id="events-reason" data-uc="events-reason" style={{ fontSize: "10.5px", color: "var(--ab-text-dim)" }}>{zh
          ? "事件流未提供（coordinator 無事件端點，不捏造事件列表）；請見 #instances。"
          : "No event stream endpoint on coordinator; no fabricated event list. See #instances."}</span>
        <div style={{ display: "flex", gap: 8 }}>{link("to-instances-events", "#instances", zh ? "Kit / GPU 機隊 →" : "Kit / GPU fleet →")}</div>
      </div>
    </div>
  );
}

export default OpsPage;
