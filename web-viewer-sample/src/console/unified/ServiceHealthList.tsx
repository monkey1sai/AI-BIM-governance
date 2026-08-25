// ═══════════════════════════════════════════════════════════════════════
// UnifiedConsole — 服務健康六列（unified-console-runtime-truth design §3.3 svc-dot）
// 只由 /api/runtime/status、/api/kit/health、/api/external/minio-watch/status、/api/governance/rule-runs 的
// 可達性推導 ok／degraded／unknown；沒有探測端點的服務（conversion authority、Kit signaling）誠實標 unknown＋
// 「無探測端點 · 未取得」，port／base_url 只在 runtime/status live 時由 configured_endpoints 顯示，不寫死。
// ═══════════════════════════════════════════════════════════════════════
import { MONO } from "./fixtures";
import type { CoordinatorStatusSnapshot } from "./coordinatorStatusStore";
import { HEALTH_DOT, healthOf } from "./runtimeTruth";
import type { HealthState } from "./runtimeTruth";

export interface ServiceRow { id: string; name: string; detail: string; health: HealthState; }

export function deriveServiceRows(snap: CoordinatorStatusSnapshot, zh: boolean): ServiceRow[] {
  const rt = snap.runtimeStatus.state === "live" ? snap.runtimeStatus.data : null;
  const watch = snap.minioWatch.state === "live" ? snap.minioWatch.data : null;
  const noProbe = zh ? "無探測端點 · 未取得" : "no probe endpoint · not observed";
  return [
    {
      id: "coordinator", name: "bim-review-coordinator",
      detail: rt ? `:${rt.configured_endpoints.coordinator.port}` : "—",
      health: healthOf(snap.runtimeStatus, (d) => d.service.status !== "ok"),
    },
    { id: "governance", name: "governance-service", detail: "/api/governance/* proxy", health: healthOf(snap.ruleRuns) },
    {
      id: "conversion", name: "conversion authority",
      detail: rt && rt.configured_endpoints.conversion_authority.base_url ? `${rt.configured_endpoints.conversion_authority.base_url} · ${noProbe}` : noProbe,
      health: "unknown",
    },
    {
      id: "kit", name: "Kit signaling / WebRTC",
      detail: rt && rt.configured_endpoints.kit.length > 0 ? `signaling :${rt.configured_endpoints.kit[0].signalingPort} · ${noProbe}` : noProbe,
      health: "unknown",
    },
    { id: "kitmgr", name: "kit-manager-api", detail: "/api/kit/health proxy", health: healthOf(snap.kitHealth) },
    {
      id: "minio", name: "MinIO watch",
      detail: watch ? (watch.enabled ? (zh ? "watch 啟用" : "watch enabled") : (zh ? "watch 停用" : "watch disabled")) : "—",
      health: healthOf(snap.minioWatch, (d) => d.enabled !== true),
    },
  ];
}

export function ServiceHealthList({ snap, zh }: { snap: CoordinatorStatusSnapshot; zh: boolean }) {
  return (
    <>
      {deriveServiceRows(snap, zh).map((sv) => (
        <div key={sv.id} data-uc="svc-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span data-uc="svc-dot" data-health={sv.health} style={{ width: 7, height: 7, borderRadius: "50%", background: HEALTH_DOT[sv.health], flex: "none" }} />
          <span style={{ fontSize: "11.5px", color: "var(--ab-text-2)", flex: 1 }}>{sv.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 10, color: "var(--ab-text-dim)" }}>{sv.detail}</span>
        </div>
      ))}
    </>
  );
}
