import { useEffect, useRef, useState } from "react";
import type { CfdCaptureOptions, CfdCaptureResult } from "../../components/cfdCapture";
import { t } from "../i18n";

export function CfdCaptureControls({ capture, cancel }: {
  capture: (options: CfdCaptureOptions) => Promise<CfdCaptureResult>; cancel?: () => void;
}) {
  const [seconds, setSeconds] = useState(5);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(true);
  const active = useRef(false);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    const ownedUrls = urls.current;
    return () => { alive.current = false; cancel?.(); ownedUrls.forEach(url => URL.revokeObjectURL(url)); ownedUrls.clear(); };
  }, [cancel]);
  const save = async (options: CfdCaptureOptions) => {
    if (active.current) return;
    active.current = true;
    setBusy(true); setMessage(t("正在擷取目前視角…", "Capturing the current view…"));
    try {
      const result = await capture(options);
      if (!alive.current) return;
      const url = URL.createObjectURL(result.blob); urls.current.add(url);
      const link = document.createElement("a"); link.href = url; link.download = result.filename;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      setMessage(`${t("已產生本機檔案", "Local file generated")} · ${result.width}×${result.height} · ${result.filename}`);
    } catch {
      if (alive.current) setMessage(t("擷取已取消或失敗，未下載不完整檔案。", "Capture cancelled or failed; no incomplete file downloaded."));
    } finally { active.current = false; if (alive.current) setBusy(false); }
  };
  return <fieldset aria-label={t("本機圖像與短片匯出", "Local image and video export")}>
    <legend>{t("匯出目前視角", "Export current view")}</legend>
    <button type="button" disabled={busy} onClick={() => void save({ format: "png" })}>{t("下載 PNG", "Download PNG")}</button>
    <label>{t("短片秒數", "Video seconds")} <input aria-label={t("短片秒數", "Video seconds")} type="number" min={1} max={20} step={1}
      disabled={busy} value={seconds} onChange={event => setSeconds(Number(event.target.value))} /></label>
    <button type="button" disabled={busy || !Number.isInteger(seconds) || seconds < 1 || seconds > 20}
      onClick={() => void save({ format: "webm", durationSeconds: seconds })}>{t("錄製 WebM", "Record WebM")}</button>
    {busy ? <button type="button" onClick={() => cancel?.()}>{t("取消擷取", "Cancel capture")}</button> : null}
    <small>{t("包含已套用結果的圖例、風向與用途。只存本機；錄製期間可操作視角，換結果或失去畫面會取消。", "Includes applied result labels and purpose. Local only; changing result or losing video cancels capture.")}</small>
    <div role="status" data-testid="cfd-capture-status">{message}</div>
  </fieldset>;
}
