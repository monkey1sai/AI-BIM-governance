import { buildHandoff, type AxisKey } from "./handoff";
import { useSharedStatus } from "./useSharedStatus";
import { t } from "./i18n";

// One shared status/evidence rail mounted at EdgeConsole top level, visible on every page (spec §5.3).
// Single source of truth = GET /api/runtime/status via SharedStatusProvider. null → 未取得, stale → dim.
export function SharedStatusRail({ activeAxis }: { activeAxis: AxisKey }) {
  const s = useSharedStatus();
  const notAvail = t("未取得", "not available");
  const gpu = s.gpuNodesTotal == null || s.gpuNodesBusy == null ? notAvail : `${s.gpuNodesBusy}/${s.gpuNodesTotal}`;
  const queue = s.conversionQueue == null ? notAvail : String(s.conversionQueue);
  const healthLabel = s.health === "ok" ? "ok" : s.health === "degraded" ? "degraded" : t("未取得（unknown）", "unknown");
  const go = (target: AxisKey) => { window.location.hash = buildHandoff(target, { source: activeAxis }); };

  return (
    <div className={`ec-statusrail ${s.stale ? "stale" : ""}`} data-testid="shared-status-rail" data-active-axis={activeAxis} data-stale={s.stale ? "true" : "false"}>
      <button className="ec-statusrail-item" data-testid="rail-sessions" title="GET /api/runtime/status" onClick={() => go("sessions")}>
        <span className="ec-statusrail-k">{t("使用中 session", "Active sessions")}</span>
        <span className="ec-statusrail-v" data-testid="rail-sessions-value">{s.activeSessions}</span>
      </button>
      <button className="ec-statusrail-item" data-testid="rail-gpu" title={t("GPU 遙測待建（1 GPU = 1 stream）", "GPU telemetry not built (1 GPU = 1 stream)")} onClick={() => go("instances")}>
        <span className="ec-statusrail-k">GPU</span>
        <span className={`ec-statusrail-v ${s.gpuNodesTotal == null ? "muted" : ""}`} data-testid="rail-gpu-value">{gpu}</span>
      </button>
      <button className="ec-statusrail-item" data-testid="rail-health" onClick={() => go("runtime")}>
        <span className="ec-statusrail-k">Health</span>
        <span className={`ec-statusrail-v health-${s.health}`} data-testid="rail-health-value">{healthLabel}</span>
      </button>
      <span className="ec-statusrail-item">
        <span className="ec-statusrail-k">{t("轉檔佇列", "Conversion queue")}</span>
        <span className={`ec-statusrail-v ${s.conversionQueue == null ? "muted" : ""}`} data-testid="rail-queue-value">{queue}</span>
      </span>
      <span className="ec-statusrail-item" data-testid="rail-updated">
        <span className="ec-statusrail-k">{t("資料時間", "Updated")}</span>
        <span className="ec-statusrail-v">{s.stale ? t("資料過期", "stale") : (s.updatedAt || "—")}</span>
      </span>
    </div>
  );
}
