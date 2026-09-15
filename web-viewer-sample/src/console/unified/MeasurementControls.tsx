import { t } from "../i18n";
import type { MeasurementAction, MeasurementState } from "../measurementBridge";

export function MeasurementControls({ ready, state, onSend }: { ready: boolean; state: MeasurementState; onSend: (action: MeasurementAction) => void }) {
  const failure = state.reason === "restore_focus_before_measurement"
    ? t("請先按「還原檢視」退出定位透明效果，再開始量測，避免取到遮擋構件。", "Restore focus appearance before measuring to avoid picking an occluding component.")
    : state.reason === "no_hit" || state.reason === "invalid_pixel"
    ? t("未點到模型表面；請重新開始，在可見表面內取點。", "No model surface was hit. Restart and pick inside a visible surface.")
    : state.reason === "scene_changed" || state.reason === "context_changed"
      ? t("量測期間模型、視角或連線已改變，請重新開始。", "The model, camera or connection changed while measuring. Restart the measurement.")
      : state.reason === "units_unverified"
        ? t("模型未提供可確認的單位，無法換算公尺。", "Model units are unverified; a distance in metres cannot be confirmed.")
        : state.reason === "timeout"
          ? t("量測回覆逾時，請重新開始。", "The measurement response timed out. Restart the measurement.")
          : t("無法確認量測。請確認權限、模型單位與視角後重試。", "Measurement could not be confirmed. Check access, model units and camera, then retry.");
  const message = {
    idle: t("先調整視角，再開始量測。", "Position the camera before measuring."),
    pending: t("正在確認量測…", "Confirming measurement…"),
    first: t("請在模型表面點選第一點。", "Pick the first point on the model surface."),
    second: t("請在模型表面點選第二點。", "Pick the second point on the model surface."),
    result: t("兩點直線距離", "Straight-line distance"),
    cancelled: t("已取消量測。", "Measurement cancelled."),
    cleared: t("已清除量測。", "Measurement cleared."),
    unconfirmed: t("模型或連線已改變，請重新量測。", "Model or connection changed. Measure again."),
    error: failure,
  }[state.status];
  const active = ["pending", "first", "second"].includes(state.status);
  return <section aria-label={t("距離量測", "Distance measurement")} data-testid="measurement-controls" style={{ borderTop: "1px solid var(--ab-border)", paddingTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
    <h3 style={{ margin: 0, fontSize: 14 }}>{t("距離量測", "Distance measurement")}</h3>
    <button data-testid="measurement-start" disabled={!ready || active} onClick={() => onSend("start")}>{t("開始兩點量測", "Start two-point measurement")}</button>
    <button data-testid="measurement-cancel" disabled={!active} onClick={() => onSend("cancel")}>{t("取消取點", "Cancel picking")}</button>
    <button data-testid="measurement-clear" disabled={state.status === "idle" || state.status === "cleared"} onClick={() => onSend("clear")}>{t("清除量測", "Clear measurement")}</button>
    <div role="status" aria-live="polite">{message}</div>
    {state.status === "result" ? <output data-testid="measurement-distance" data-prov="live">{state.distanceMetres?.toFixed(3)} m</output> : null}
    {state.status === "result" && state.points && <details data-testid="measurement-details">
      <summary>{t("量測資訊", "Measurement details")}</summary>
      <small>{t("Kit 回覆的模型座標（依 Stage 單位），不是自動吸附的端點。", "Native model coordinates in Stage units; these are not snapped endpoints.")}</small>
      {state.points.map((point, index) => <div key={index}>P{index + 1}: {point.map(value => value.toFixed(6)).join(", ")}</div>)}
      <small>{state.requestId}</small>
    </details>}
    <small>{t("量測期間暫停相機與構件選取；Esc 可取消。距離為模型表面兩點的直線讀值。", "Camera and selection pause while picking; Esc cancels. Distance is the straight line between two surface points.")}</small>
    {!ready ? <small>{t("請先載入模型並取得操作權限。", "Load a model and obtain control first.")}</small> : null}
  </section>;
}
