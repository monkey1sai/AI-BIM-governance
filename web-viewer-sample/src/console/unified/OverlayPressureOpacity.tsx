import { useRef, useState } from "react";
import { t } from "../i18n";
import { controlField } from "./controlStyles";
import { commandErrorText } from "./viewerCommandText";
import { OVERLAY_DISPLAY_OPACITY_MAX, OVERLAY_DISPLAY_OPACITY_MIN, type OverlayStyleState } from "../../viewerCommandChannel/overlayStyle";
import type { ViewerCommandPort } from "../../viewerCommandChannel/parentSide";

/** Session-only styling of the declared pressure mesh; never changes the CFD artifact or BIM. */
export function OverlayPressureOpacity({ primPath, ready, commands, state }: {
  primPath: string; ready: boolean; commands: ViewerCommandPort; state: OverlayStyleState;
}) {
  const [value, setValue] = useState(1);
  const dirty = useRef(false);
  const disabled = !ready || state.status === "pending";
  const apply = (opacity: number) => {
    if (disabled) return;
    dirty.current = false;
    setValue(opacity);
    void commands.send("overlay_style", { primPath, displayOpacity: opacity });
  };
  const commit = () => { if (dirty.current) apply(value); };
  const actual = state.status === "applied" && state.primPath === primPath ? state.displayOpacity : undefined;
  return <div data-testid="wind-pressure-opacity" style={{ display: "grid", gap: 4 }}>
    <label>{t("表面壓力透明度", "Surface pressure opacity")} {value.toFixed(2)}
      <input type="range" aria-label={t("表面壓力透明度", "Surface pressure opacity")} data-testid="wind-pressure-opacity-slider"
        min={OVERLAY_DISPLAY_OPACITY_MIN} max={OVERLAY_DISPLAY_OPACITY_MAX} step={0.05} value={value} disabled={disabled}
        onChange={event => { dirty.current = true; setValue(Number(event.target.value)); }}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    </label>
    <div style={{ display: "flex", gap: 4 }}>
      <button style={controlField} disabled={disabled} onClick={() => apply(0.35)}>{t("半透明 0.35", "Translucent 0.35")}</button>
      <button style={controlField} disabled={disabled} onClick={() => apply(1)}>{t("不透明 1.00", "Opaque 1.00")}</button>
    </div>
    <small role="status" data-testid="wind-pressure-opacity-status">
      {actual !== undefined ? `${t("Kit 已套用壓力透明度 ", "Kit applied pressure opacity ")}${actual.toFixed(2)}`
        : state.status === "pending" ? t("等待 Kit 套用圖層樣式…", "Waiting for Kit layer styling…")
        : state.status === "error" ? `${t("圖層樣式未套用：", "Layer style not applied: ")}${commandErrorText(state.reason)}`
        : t("壓力透明度尚未確認。", "Pressure opacity is unconfirmed.")}
    </small>
    <small>{t("先顯示表面壓力；0.35 較透明，1.00 不透明。僅改計算外殼呈現，不改善外殼幾何精度；重新載入疊圖會回復預設。",
      "Show the pressure layer first; 0.35 is more transparent, 1.00 opaque. This styles the computation shell, not its geometric accuracy; reloading restores the default.")}</small>
  </div>;
}
