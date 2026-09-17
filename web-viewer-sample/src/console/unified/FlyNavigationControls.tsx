import { useState } from "react";
import { t } from "../i18n";
import { FLY_SPEED_MAX, FLY_SPEED_MIN, parseFlySpeed, type CameraViewState, type FlyState } from "../cameraViewBridge";
import { cameraSummary, commandErrorText } from "./viewerCommandText";
import { controlField } from "./controlStyles";

export function FlyNavigationControls({ ready, state, camera, onSetSpeed, onReadCamera, blockedReason }: {
  ready: boolean; state: FlyState; camera: CameraViewState; onSetSpeed: (speed: number) => void; onReadCamera: () => void;
  blockedReason?: string;
}) {
  const [speed, setSpeed] = useState("1");
  const parsed = speed.trim() === "" ? null : parseFlySpeed(Number(speed));
  const blocked = !ready || state.status === "pending";
  const confirmedCamera = camera.status === "applied" ? camera.camera : undefined;
  const title = {
    idle: t("尚未設定速度", "Speed not set"),
    pending: t("等待套用", "Waiting for response"),
    applied: t("速度已套用", "Speed applied"),
    unconfirmed: t("尚未確認", "Not confirmed"),
    error: t("未能套用", "Could not apply"),
  }[state.status];
  return <section aria-label={t("飛行", "Fly")} data-testid="fly-controls" style={{ flexShrink: 0, display: "grid", gap: 8, fontSize: 12 }}>
    <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
      <li>{t("先點一下 3D 畫面。", "Click the 3D view first.")}</li>
      <li>{t("按住滑鼠右鍵並移動滑鼠：轉動視線。", "Hold the right mouse button and move the mouse: look around.")}</li>
      <li>{t("按住右鍵加 W／A／S／D：前、左、後、右移動。", "Hold the right button with W/A/S/D: move forward, left, back, right.")}</li>
      <li>{t("按住右鍵加 Q／E：下降／上升。", "Hold the right button with Q/E: move down/up.")}</li>
      <li>{t("按住右鍵時滾動滾輪：調整速度。", "Scroll the wheel while holding the right button: change speed.")}</li>
    </ol>
    <small>{t("建議在透視投影下飛行。", "Fly in perspective projection.")}</small>
    <label>{t("移動速度", "Move speed")}<input aria-label={t("移動速度", "Move speed")} type="number" step="any"
      min={FLY_SPEED_MIN} max={FLY_SPEED_MAX} style={controlField} disabled={blocked} value={speed}
      onChange={event => setSpeed(event.target.value)} /></label>
    {parsed === null ? <span role="alert">{t(`請輸入 ${FLY_SPEED_MIN} 到 ${FLY_SPEED_MAX} 之間的數字。`, `Enter a number from ${FLY_SPEED_MIN} to ${FLY_SPEED_MAX}.`)}</span> : null}
    <button data-testid="fly-speed-apply" style={controlField} disabled={blocked || parsed === null}
      onClick={() => { if (parsed !== null) onSetSpeed(parsed); }}>{t("套用速度", "Apply speed")}</button>
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 5 }}>
      <strong>{title}</strong>
      {state.status === "applied" && state.speed !== undefined ? <span>{t("目前速度：", "Current speed: ")}{state.speed}</span> : null}
      {state.status === "error" ? <span>{commandErrorText(state.reason)}</span> : null}
      {state.status === "unconfirmed" ? <span>{t("模型或連線已變更，請重新確認。", "The model or connection changed. Please verify again.")}</span> : null}
      {!ready ? <span>{blockedReason
        ? `${t("無法操作：", "Unavailable: ")}${blockedReason}`
        : t("模型尚未就緒或目前沒有操作權限。", "The model is not ready or access is unavailable.")}</span> : null}
    </div>
    <button data-testid="fly-read-camera" style={controlField} disabled={!ready || camera.status === "pending"} onClick={onReadCamera}>
      {t("讀取目前相機位置", "Read current camera")}
    </button>
    {confirmedCamera ? <span data-testid="fly-camera-summary">{cameraSummary(confirmedCamera)}</span> : null}
  </section>;
}
