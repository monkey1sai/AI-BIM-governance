import { useState } from "react";
import { t } from "../i18n";
import type { CameraPreset, CameraViewInput, CameraViewState } from "../cameraViewBridge";
import { cameraSummary, commandErrorText } from "./viewerCommandText";
import { controlField } from "./controlStyles";

const PRESETS: Array<{ view: CameraPreset; zh: string; en: string }> = [
  { view: "top", zh: "上", en: "Top" },
  { view: "front", zh: "前", en: "Front" },
  { view: "back", zh: "後", en: "Back" },
  { view: "left", zh: "左", en: "Left" },
  { view: "right", zh: "右", en: "Right" },
  { view: "iso", zh: "等角", en: "Isometric" },
];

export function CameraViewControls({ ready, state, onSend }: { ready: boolean; state: CameraViewState; onSend: (input: CameraViewInput) => void }) {
  const [includeSite, setIncludeSite] = useState(false);
  const blocked = !ready || state.status === "pending";
  const camera = state.status === "applied" ? state.camera : undefined;
  const scope = includeSite ? "all" : "building";
  const title = {
    idle: t("尚未套用視角", "No view applied"),
    pending: t("等待套用", "Waiting for response"),
    applied: t("相機狀態已確認", "Camera state confirmed"),
    unconfirmed: t("尚未確認", "Not confirmed"),
    error: t("未能套用", "Could not apply"),
  }[state.status];
  return <section aria-label={t("視角", "Views")} data-testid="camera-view-controls" style={{ flexShrink: 0, display: "grid", gap: 8, fontSize: 12 }}>
    <div role="group" aria-label={t("預設視角", "Preset views")} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {PRESETS.map(preset => <button key={preset.view} data-testid={`camera-preset-${preset.view}`} style={controlField} disabled={blocked}
        onClick={() => onSend({ action: "preset", view: preset.view, scope })}>{t(preset.zh, preset.en)}</button>)}
    </div>
    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="checkbox" data-testid="camera-include-site" checked={includeSite} disabled={blocked}
        onChange={event => setIncludeSite(event.target.checked)} />
      {t("包含場地與遠處構件", "Include site and distant elements")}
    </label>
    <div role="group" aria-label={t("投影", "Projection")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      <button data-testid="camera-projection-perspective" style={controlField} disabled={blocked} aria-pressed={camera?.projection === "perspective"}
        onClick={() => onSend({ action: "projection", projection: "perspective" })}>{t("透視", "Perspective")}</button>
      <button data-testid="camera-projection-orthographic" style={controlField} disabled={blocked} aria-pressed={camera?.projection === "orthographic"}
        onClick={() => onSend({ action: "projection", projection: "orthographic" })}>{t("正交", "Orthographic")}</button>
    </div>
    <small>{t("方向以模型座標為準（Z 軸朝上），不是真北。", "Directions use model axes (Z up), not true north.")}</small>
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 5 }}>
      <strong>{title}</strong>
      {camera ? <span>{cameraSummary(camera)}</span> : null}
      {camera ? <span>{t("請在模型畫面確認視角。", "Check the view in the model.")}</span> : null}
      {state.status === "error" ? <span>{commandErrorText(state.reason)}</span> : null}
      {state.status === "unconfirmed" ? <span>{t("模型或連線已變更，請重新確認。", "The model or connection changed. Please verify again.")}</span> : null}
      {!ready ? <span>{t("模型尚未就緒或目前沒有操作權限。", "The model is not ready or access is unavailable.")}</span> : null}
    </div>
  </section>;
}
