import { t } from "../i18n";
import { controlField } from "./controlStyles";

export interface SectionDraft { axis: "x" | "y" | "z"; position: string }
export function requestedSectionDrafts(drafts: SectionDraft[]): Array<{ axis: SectionDraft["axis"]; position_m: number }> | null {
  if (drafts.length > 8 || drafts.some(row => row.position.trim() === "" || !Number.isFinite(Number(row.position)) || Math.abs(Number(row.position)) > 1e9)) return null;
  return drafts.map(row => ({ axis: row.axis, position_m: Number(row.position) }));
}
export function CfdSectionSampling({ drafts, onChange, disabled }: { drafts: SectionDraft[]; onChange(drafts: SectionDraft[]): void; disabled: boolean }) {
  return <fieldset data-testid="wind-section-sampling">
    <legend>{t("剖面取樣", "Section sampling")}</legend>
    <small>{t("標準取樣：0.25H、0.5H、0.75H 與通過建築形心的 X／Y 面。可再加 8 個自訂位置；以模型座標、公尺輸入。", "Standard: 0.25H, 0.5H, 0.75H and X/Y planes through the building centroid. Add up to 8 custom model-coordinate positions in metres.")}</small>
    <small style={{ display: "block" }}>{t("自訂位置需已有相同模型與前處理的計算外殼；沒有時先送出標準取樣。剖面不改網格與求解估算。", "Custom positions require an existing computation shell for the same model and preprocessing; submit standard sampling first. Sections do not change the mesh or solve estimate.")}</small>
    {drafts.map((row, i) => <div key={i} style={{ display: "flex", gap: 4 }}>
      <select aria-label={t(`自訂剖面 ${i + 1} 軸向`, `Custom section ${i + 1} axis`)} value={row.axis} disabled={disabled} style={controlField}
        onChange={e => onChange(drafts.map((r, j) => j === i ? { ...r, axis: e.target.value as SectionDraft["axis"] } : r))}>
        {["x", "y", "z"].map(axis => <option key={axis} value={axis}>{axis.toUpperCase()}</option>)}
      </select>
      <input aria-label={t(`自訂剖面 ${i + 1} 位置 m`, `Custom section ${i + 1} position m`)} type="number" value={row.position} disabled={disabled}
        step="any" style={{ ...controlField, minWidth: 0, width: "100%" }}
        onChange={e => onChange(drafts.map((r, j) => j === i ? { ...r, position: e.target.value } : r))} />
      <button style={controlField} disabled={disabled} onClick={() => onChange(drafts.filter((_, j) => j !== i))}>{t("移除", "Remove")}</button>
    </div>)}
    <button data-testid="wind-section-add" style={controlField} disabled={disabled || drafts.length >= 8}
      onClick={() => onChange([...drafts, { axis: "z", position: "" }])}>{t("新增自訂剖面", "Add custom section")}</button>
    {requestedSectionDrafts(drafts) === null ? <small role="alert">{t("請填入有效的剖面位置（m）。", "Enter valid section positions (m).")}</small> : null}
  </fieldset>;
}
