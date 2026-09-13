import { useState, type CSSProperties } from "react";
import { t } from "../i18n";
import type { SectionInput, SectionState } from "../sectionPlaneBridge";

const field: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--ab-border)", background: "var(--ab-surface)", color: "var(--ab-text)" };
export function SectionPlaneControls({ ready, state, onSend }: { ready: boolean; state: SectionState; onSend: (input: SectionInput) => void }) {
  const [axis, setAxis] = useState<SectionInput["axis"]>("z");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [position, setPosition] = useState("0");
  const valid = position.trim() !== "" && Number.isFinite(Number(position)) && Math.abs(Number(position)) <= 3.4028234663852886e38;
  const blocked = !ready || state.status === "pending";
  const title = {
    idle: t("尚未設定", "Not configured"),
    pending: t("等待套用", "Waiting for response"),
    applied: t("設定已套用", "Settings applied"),
    off: t("剖切已關閉", "Section disabled"),
    unconfirmed: t("尚未確認", "Not confirmed"),
    error: t("未能套用", "Could not apply"),
  }[state.status];
  const error = state.status === "error" ? {
    invalid: t("請輸入有效的位置。", "Enter a valid position."),
    busy: t("已有操作等待回覆，請稍候。", "An operation is pending. Please wait."),
    unavailable: t("目前無法操作模型，請確認連線與操作權限。", "The model is unavailable. Check connection and access."),
    rejected: t("模型拒絕此操作，請確認目前操作權限。", "The model rejected this operation. Check access."),
    transport: t("傳送失敗，請確認連線後再試。", "Sending failed. Check the connection and try again."),
    timeout: t("尚未收到設定回覆；模型可能已變更，請確認畫面後重試。", "No response received; the model may have changed. Check the view before retrying."),
    readback: t("回覆無法確認設定，請確認畫面後重試。", "The response could not confirm settings. Check the view before retrying."),
  }[state.reason ?? "readback"] : null;
  const effective = "effective" in state ? state.effective : undefined;
  return <section aria-label={t("剖切", "Section plane")} data-testid="section-controls" style={{ flexShrink: 0, borderTop: "1px solid var(--ab-border)", paddingTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
    <h3 style={{ margin: 0, fontSize: 14 }}>{t("剖切", "Section plane")}</h3>
    <label>{t("剖切軸", "Axis")}<select aria-label={t("剖切軸", "Axis")} style={field} disabled={blocked} value={axis} onChange={event => setAxis(event.target.value as SectionInput["axis"])}><option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select></label>
    <label>{t("方向", "Direction")}<select aria-label={t("方向", "Direction")} style={field} disabled={blocked} value={direction} onChange={event => setDirection(event.target.value === "-1" ? -1 : 1)}><option value="1">{t("正向", "Positive")}</option><option value="-1">{t("反向", "Negative")}</option></select></label>
    <label>{t("位置", "Position")}<input aria-label={t("位置", "Position")} type="number" step="any" style={field} disabled={blocked} value={position} onChange={event => setPosition(event.target.value)} /></label>
    <small>{t("位置使用模型座標單位。", "Position uses model coordinate units.")}</small>
    {!valid ? <span role="alert">{t("請輸入有限數字，位置不可留空。", "Enter a finite number; position cannot be empty.")}</span> : null}
    <button data-testid="section-apply" style={field} disabled={blocked || !valid} onClick={() => onSend({ enabled: true, axis, direction, position: Number(position) })}>{state.status === "error" ? t("重試套用", "Retry apply") : t("套用剖切", "Apply section")}</button>
    <button data-testid="section-off" style={field} disabled={blocked} onClick={() => onSend({ enabled: false, axis: "z", direction: 1, position: 0 })}>{t("關閉剖切", "Disable section")}</button>
    <div role="status" aria-live="polite" style={{ display: "grid", gap: 5 }}>
      <strong>{title}</strong>
      {effective ? <span>{t("已回覆設定：", "Confirmed settings: ")}{effective.axis.toUpperCase()} · {effective.direction > 0 ? "+" : "−"} · {effective.position}</span> : null}
      {error ? <span>{error}</span> : null}
      {state.status === "applied" || state.status === "off" ? <span>{t("請在模型畫面確認剖切結果。", "Check the section result in the model view.")}</span> : null}
      {state.status === "unconfirmed" ? <span>{t("模型或連線已變更，請重新確認。", "The model or connection changed. Please verify again.")}</span> : null}
      {!ready ? <span>{t("模型尚未就緒或目前沒有操作權限。", "The model is not ready or access is unavailable.")}</span> : null}
    </div>
  </section>;
}
