// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — Ops 頁（Runtime / Kit · GPU 營運）
// unified-console-runtime-truth slice 1（tasks 1.6）：Kit instance 卡（GET /api/kit/instances/current）、GPU 卡
// （/api/runtime/status 與 kit instance 皆無 GPU 使用率欄位 → 誠實「未取得」，不渲染任何數值）、服務健康六列、
// 事件列誠實停用（coordinator 無事件端點；導向 #instances）。控制項只有 nav 或 disabled＋原因；不打任何 mutation。
// 版面沿用設計原型；須在 UnifiedShell（ConsoleDataProvider）內渲染。
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useState, type CSSProperties } from "react";
import { useLang } from "../i18n";
import { coordinatorClient, isSecureOperatorTransport, type SessionIdlePolicy } from "../coordinatorClient";
import { MONO, chipBox, getL } from "./fixtures";
import { useConsoleData } from "./consoleData";
import type { EndpointKey } from "./coordinatorStatusStore";
import { ServiceHealthList } from "./ServiceHealthList";
import { cell, cellSub, cellText, stateColor } from "./runtimeTruth";

const OPS_KEYS: readonly EndpointKey[] = ["kitInstance", "runtimeStatus", "kitHealth", "minioWatch", "ruleRuns", "sessionIdlePolicy"];
const MAX_IDLE_MINUTES = Math.floor(2_147_483_647 / 60_000);

const cardBase: CSSProperties = { ...chipBox, padding: 16, display: "flex", flexDirection: "column" };
const navBtn: CSSProperties = { flex: 1, textAlign: "center", fontSize: 11, color: "var(--ab-accent-text)", border: "1px solid rgba(65,199,232,.3)", borderRadius: 7, padding: 6, cursor: "pointer", textDecoration: "none" };
const disabledBtn: CSSProperties = { textAlign: "center", fontSize: 11, color: "var(--ab-text-dimmer)", border: "1px solid rgba(120,160,210,.14)", borderRadius: 7, padding: "3px 9px", cursor: "not-allowed" };
const mono10: CSSProperties = { fontFamily: MONO, fontSize: "10.5px", color: "var(--ab-text-muted)" };

export function OpsPage() {
  const lang = useLang();
  const zh = lang === "zh";
  const L = getL(zh);
  const snap = useConsoleData(OPS_KEYS);
  const [draftMinutes, setDraftMinutes] = useState("30");
  const [operatorToken, setOperatorToken] = useState("");
  const [reason, setReason] = useState("");
  const [policyOverride, setPolicyOverride] = useState<SessionIdlePolicy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const operatorTransportSecure = isSecureOperatorTransport();
  const nav = (hash: string) => { window.location.hash = hash; };

  const kit = cell(snap.kitInstance, (k) => k);
  // 盤點（tasks 1.2）：/api/runtime/status 與 /api/kit/instances/current 皆無 GPU 使用率欄位 → live 即「未取得」，不捏造。
  const gpu = cell(snap.runtimeStatus, () => null);
  const remotePolicy = snap.sessionIdlePolicy.state === "live" ? snap.sessionIdlePolicy.data : null;
  const remotePolicyRevision = remotePolicy?.revision;
  const remotePolicyProcessEpoch = remotePolicy?.process_epoch;
  const policy = policyOverride ?? remotePolicy;
  useEffect(() => {
    if (remotePolicyRevision === undefined) return;
    setPolicyOverride((current) => {
      if (!current) return null;
      if (current.process_epoch !== remotePolicyProcessEpoch) return null;
      return remotePolicyRevision < current.revision ? current : null;
    });
  }, [remotePolicyRevision, remotePolicyProcessEpoch]);

  const effectivePolicyTimeoutMs = policy?.timeout_ms;
  const effectivePolicyRevision = policy?.revision;
  const effectivePolicyProcessEpoch = policy?.process_epoch;
  useEffect(() => {
    if (effectivePolicyTimeoutMs !== null && effectivePolicyTimeoutMs !== undefined) {
      setDraftMinutes(String(Math.max(1, Math.ceil(effectivePolicyTimeoutMs / 60_000))));
    }
  }, [effectivePolicyTimeoutMs, effectivePolicyRevision, effectivePolicyProcessEpoch]);

  const updateIdlePolicy = async (timeoutMs: number | null) => {
    setPolicyMessage(null);
    if (!operatorTransportSecure) {
      setPolicyMessage({ kind: "error", text: zh ? "非本機 coordinator 必須使用 HTTPS 才能傳送 operator token。" : "A non-loopback coordinator must use HTTPS before sending an operator token." });
      return;
    }
    if (!policy) {
      setPolicyMessage({ kind: "error", text: zh ? "尚未取得 coordinator 設定，請稍後重試。" : "Coordinator policy is not available yet." });
      return;
    }
    if (!operatorToken.trim()) {
      setPolicyMessage({ kind: "error", text: zh ? "請輸入 operator token。" : "Enter the operator token." });
      return;
    }
    if (!reason.trim()) {
      setPolicyMessage({ kind: "error", text: zh ? "請填寫變更原因。" : "Enter a reason for this change." });
      return;
    }
    setPolicyBusy(true);
    try {
      const next = await coordinatorClient.updateSessionIdlePolicy(
        timeoutMs,
        policy.revision,
        policy.process_epoch,
        reason.trim(),
        operatorToken,
      );
      setPolicyOverride(next);
      setReason("");
      setPolicyMessage({
        kind: "ok",
        text: next.enabled
          ? (zh ? `已套用：${Math.ceil((next.timeout_ms ?? 0) / 60_000)} 分鐘。既有 ready session 已重新起算。` : `Applied: ${Math.ceil((next.timeout_ms ?? 0) / 60_000)} minutes. Ready sessions restarted their idle clock.`)
          : (zh ? "已停用閒置回收。" : "Idle reclaim is disabled."),
      });
    } catch (error) {
      setPolicyMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setOperatorToken("");
      setPolicyBusy(false);
    }
  };

  const applyDraft = () => {
    const minutes = Number(draftMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_IDLE_MINUTES) {
      setPolicyMessage({ kind: "error", text: zh ? `分鐘必須是 1–${MAX_IDLE_MINUTES} 的整數。` : `Minutes must be an integer from 1 to ${MAX_IDLE_MINUTES}.` });
      return;
    }
    void updateIdlePolicy(minutes * 60_000);
  };
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
      <div data-prov="asbuilt" data-uc="session-idle-policy-card" style={{ ...cardBase, gap: 14, borderColor: "rgba(230,178,62,.28)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{zh ? "Session 閒置回收策略" : "Session idle reclaim policy"}</span>
          <code style={mono10}>SESSION_IDLE_TIMEOUT_MS</code>
          <span data-uc="session-idle-policy-state" data-state={snap.sessionIdlePolicy.state} style={{ marginLeft: "auto", fontSize: 10, color: policy?.enabled ? "var(--ab-ok-text)" : "var(--ab-warn)", border: "1px solid rgba(230,178,62,.25)", borderRadius: 999, padding: "2px 8px" }}>
            {policy ? (policy.enabled ? (zh ? "已啟用" : "enabled") : (zh ? "已停用" : "disabled")) : (zh ? "未連線" : "offline")}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 10, color: "var(--ab-text-dimmer)" }}>{zh ? "目前有效值" : "Effective value"}</span>
            <span data-uc="session-idle-policy-value" style={{ fontSize: 22, fontWeight: 700, fontFamily: MONO }}>
              {policy?.timeout_ms === null
                ? (zh ? "停用" : "Disabled")
                : policy?.timeout_ms
                  ? (policy.timeout_ms < 60_000 ? `${policy.timeout_ms} ms` : `${Math.ceil(policy.timeout_ms / 60_000)} ${zh ? "分鐘" : "min"}`)
                  : "—"}
            </span>
            <span style={mono10}>{policy
              ? `${zh ? "來源" : "source"}: ${policy.source} · rev ${policy.revision} · ${zh ? "倒數" : "countdown"} ${policy.countdown_seconds}s`
              : (snap.sessionIdlePolicy.message ?? (zh ? "正在讀取 coordinator…" : "Loading coordinator policy…"))}</span>
            <span style={{ fontSize: 10.5, color: "var(--ab-warn)" }}>{zh
              ? "立即套用目前 process；服務重啟後恢復部署環境值。既有 ready session 從套用時重新計時。"
              : "Applies to this process now; restart restores the deployment environment value. Ready sessions restart their idle clock."}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="session-idle-minutes" style={{ fontSize: 10.5, color: "var(--ab-text-muted)" }}>{zh ? "閒置分鐘" : "Idle minutes"}</label>
            <input id="session-idle-minutes" data-uc="session-idle-minutes" type="number" min={1} max={MAX_IDLE_MINUTES} step={1} value={draftMinutes} onChange={(event) => setDraftMinutes(event.target.value)} disabled={policyBusy} aria-describedby="session-idle-help" style={{ background: "rgba(7,13,21,.75)", color: "var(--ab-text)", border: "1px solid rgba(120,160,210,.25)", borderRadius: 6, padding: "7px 9px", fontFamily: MONO }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[15, 30, 60, 120].map((minutes) => <button key={minutes} type="button" data-uc={`session-idle-preset-${minutes}`} onClick={() => setDraftMinutes(String(minutes))} disabled={policyBusy} style={{ ...disabledBtn, cursor: policyBusy ? "wait" : "pointer", color: "var(--ab-accent-text)" }}>{minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}</button>)}
            </div>
            <span id="session-idle-help" style={{ fontSize: 9.5, color: "var(--ab-text-dimmer)" }}>{zh ? `整數 1–${MAX_IDLE_MINUTES} 分鐘；逾時後進入 ${policy?.countdown_seconds ?? 10} 秒倒數。` : `Whole minutes 1–${MAX_IDLE_MINUTES}; then a ${policy?.countdown_seconds ?? 10}-second countdown.`}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor="session-idle-token" style={{ fontSize: 10.5, color: "var(--ab-text-muted)" }}>{zh ? "Operator token（僅本次送出）" : "Operator token (this request only)"}</label>
            <input id="session-idle-token" data-uc="session-idle-token" type="password" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} disabled={policyBusy || !operatorTransportSecure} autoComplete="off" aria-describedby={!operatorTransportSecure ? "session-idle-transport-warning" : undefined} style={{ background: "rgba(7,13,21,.75)", color: "var(--ab-text)", border: "1px solid rgba(120,160,210,.25)", borderRadius: 6, padding: "7px 9px" }} />
            {!operatorTransportSecure && <span id="session-idle-transport-warning" role="alert" style={{ fontSize: 9.5, color: "var(--ab-danger)" }}>{zh ? "已停用：非本機 coordinator 需 HTTPS。" : "Disabled: non-loopback coordinator requires HTTPS."}</span>}
            <label htmlFor="session-idle-reason" style={{ fontSize: 10.5, color: "var(--ab-text-muted)" }}>{zh ? "變更原因" : "Reason"}</label>
            <input id="session-idle-reason" data-uc="session-idle-reason" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} disabled={policyBusy} style={{ background: "rgba(7,13,21,.75)", color: "var(--ab-text)", border: "1px solid rgba(120,160,210,.25)", borderRadius: 6, padding: "7px 9px" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" data-uc="session-idle-apply" onClick={applyDraft} disabled={policyBusy || !policy || !operatorTransportSecure} style={{ ...navBtn, background: "transparent" }}>{policyBusy ? (zh ? "套用中…" : "Applying…") : (zh ? "套用" : "Apply")}</button>
              <button type="button" data-uc="session-idle-disable" onClick={() => { void updateIdlePolicy(null); }} disabled={policyBusy || !policy || !policy.enabled || !operatorTransportSecure} style={{ ...disabledBtn, cursor: policyBusy ? "wait" : "pointer", color: "var(--ab-warn)" }}>{zh ? "停用" : "Disable"}</button>
            </div>
          </div>
        </div>
        {policyMessage && <div data-uc="session-idle-feedback" role={policyMessage.kind === "error" ? "alert" : "status"} style={{ fontSize: 10.5, color: policyMessage.kind === "error" ? "var(--ab-danger)" : "var(--ab-ok-text)" }}>{policyMessage.text}</div>}
      </div>
    </div>
  );
}

export default OpsPage;
