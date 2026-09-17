import { t } from "../i18n";
import type { CameraState, CommandReason } from "../cameraViewBridge";

export function commandErrorText(reason: CommandReason | undefined): string {
  return {
    invalid: t("輸入的值不正確。", "The value is not valid."),
    busy: t("已有操作等待回覆，請稍候。", "An operation is pending. Please wait."),
    unavailable: t("目前無法操作模型，請確認連線與操作權限。", "The model is unavailable. Check connection and access."),
    rejected: t("模型拒絕此操作，請確認目前操作權限。", "The model rejected this operation. Check access."),
    transport: t("傳送失敗，請確認連線後再試。", "Sending failed. Check the connection and try again."),
    timeout: t("尚未收到回覆；模型可能已變更，請確認畫面後重試。", "No response received; the model may have changed. Check the view before retrying."),
    readback: t("回覆無法確認結果，請確認畫面後重試。", "The response could not confirm the result. Check the view before retrying."),
  }[reason ?? "readback"];
}

const fixed = (value: number) => value.toFixed(2);

export function cameraSummary(camera: CameraState): string {
  const projection = camera.projection === "orthographic" ? t("正交", "Orthographic") : t("透視", "Perspective");
  return `${projection} · ${t("位置", "Position")} (${camera.position.map(fixed).join(", ")}) · `
    + `${t("視線", "Direction")} (${camera.direction.map(fixed).join(", ")})`;
}
