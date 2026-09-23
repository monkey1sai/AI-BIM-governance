// 風環境面板的「計算設定」區（building-energy-cfd-p2-contract.md S8，settings phase A2）。
// 欄位、分區、上下限、預設值、預設組全部來自 cfd-options/v1；這裡只負責呈現與把輸入字串回報給面板。
// 估算一律標示「估算值，不是實測」，並寫明依據（幾何來源、加細比例與每格耗時的來源與筆數）。
import { t } from "../i18n";
import { controlField, fieldsetLegend } from "./controlStyles";
import type { CfdEstimate, CfdOptionsDocument, CfdOptionsField } from "./cfdClient";
import {
  allowsAutomatic, AUTO_CELL_FIELD, confirmReasonsText, CUSTOM_PRESET, formatCells, formatDuration, isVisible, valueToInput, type Bilingual, type SettingsValues,
} from "./cfdSettings";

export type EstimateState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; key: string; estimate: CfdEstimate }
  | { status: "error"; key: string; reason: string };

const REASON_TEXT: Record<string, Bilingual> = {
  no_geometry_source: ["這個模型還沒有可用的幾何資料（沒有先前的 run，也沒有元件外框索引），無法估算。", "No geometry source for this model yet (no earlier run and no element bounding boxes); cannot estimate."],
  geometry_below_ground: ["模型幾何全在地面以下，無法估算。", "The model geometry lies below ground; cannot estimate."],
  estimate_failed: ["估算失敗。", "The estimate failed."],
};
const GEOMETRY_TEXT: Record<string, Bilingual> = {
  previous_run_shell: ["同模型先前 run 的外殼，背景格數為精算", "the shell of an earlier run of this model; background cells are exact"],
  bbox_index_profile_filter: ["轉檔元件外框依 profile 篩選，屬粗估，斜向風向會偏大", "converted element boxes filtered by the profile; rough, oblique directions come out larger"],
};
const FACTOR_SOURCE_TEXT: Record<string, Bilingual> = {
  history_same_model: ["本模型已完成的 run", "this model's finished runs"],
  history_any_model: ["本機其他模型已完成的 run", "other models' finished runs on this host"],
  config_default: ["設定檔記載的預設值", "the documented default"],
};
const SECONDS_SOURCE_TEXT: Record<string, Bilingual> = {
  history_same_n_procs: ["相同核心數的已完成 run", "finished runs with the same core count"],
  config_default_scaled_by_n_procs: ["設定檔預設值，依核心數換算", "the documented default scaled by core count"],
};
function text(value: Bilingual | undefined, fallback: string): string {
  return value ? t(value[0], value[1]) : fallback;
}

function FieldInput({ field, value, error, disabled, autoHint, onChange }: {
  field: CfdOptionsField; value: string; error: Bilingual | undefined; disabled: boolean; autoHint: number | null; onChange: (key: string, raw: string) => void;
}) {
  const label = t(field.label.zh, field.label.en);
  const help = t(field.help.zh, field.help.en);
  const testId = `wind-setting-${field.key}`;
  if (field.type === "enum") {
    return (
      <div data-testid={`${testId}-field`} style={{ display: "grid", gap: 2 }}>
        <label>{label}
          <select data-testid={testId} aria-label={label} style={controlField} value={value} disabled={disabled} onChange={(event) => onChange(field.key, event.target.value)}>
            {(field.enum ?? []).map((item) => {
              const itemLabel = field.enum_labels?.[item];
              return <option key={item} value={item}>{itemLabel ? t(itemLabel.zh, itemLabel.en) : item}</option>;
            })}
          </select>
        </label>
        <small>{help}</small>
        {error ? <span role="alert" data-testid={`${testId}-error`}>{t(error[0], error[1])}</span> : null}
      </div>
    );
  }
  const canBeAutomatic = allowsAutomatic(field);
  const automatic = canBeAutomatic && value === "";
  // Unticking "automatic" starts from the automatic value the estimate reported; without one, from the coarsest
  // allowed value (for the background cell the cheapest run), never from the finest.
  const manualStart = autoHint ?? field.maximum ?? field.minimum ?? 1;
  const unit = field.unit ? `（${field.unit}）` : "";
  return (
    <div data-testid={`${testId}-field`} style={{ display: "grid", gap: 2 }}>
      <label>{label}{unit}
        <input type="number" data-testid={testId} aria-label={label} style={controlField} value={value} step={field.step ?? "any"}
          min={field.exclusive_minimum ?? field.minimum} max={field.maximum} disabled={disabled || automatic}
          placeholder={automatic ? t("自動", "Automatic") : undefined} onChange={(event) => onChange(field.key, event.target.value)} />
      </label>
      {canBeAutomatic ? (
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" data-testid={`${testId}-auto`} checked={automatic} disabled={disabled}
            onChange={(event) => onChange(field.key, event.target.checked ? "" : valueToInput(manualStart))} />
          <span>{t("自動", "Automatic")}</span>
        </label>
      ) : null}
      <small>{help}</small>
      {error ? <span role="alert" data-testid={`${testId}-error`}>{t(error[0], error[1])}</span> : null}
    </div>
  );
}

function EstimateView({ state, options }: { state: EstimateState; options: CfdOptionsDocument }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <p data-testid="wind-estimate" data-state="loading" style={{ margin: 0 }}>{t("估算中…", "Estimating…")}</p>;
  if (state.status === "error") return <p data-testid="wind-estimate" data-state="error" role="alert" style={{ margin: 0 }}>{t("無法取得估算：", "Estimate unavailable: ")}{state.reason}</p>;
  const estimate = state.estimate;
  if (!estimate.available || !estimate.totals || !estimate.basis) {
    return <p data-testid="wind-estimate" data-state="unavailable" style={{ margin: 0 }}>{text(REASON_TEXT[estimate.reason ?? "estimate_failed"], estimate.reason ?? "")}</p>;
  }
  const { totals, basis, limits } = estimate;
  const auto = estimate.background_cell_rule === "auto";
  return (
    <div data-testid="wind-estimate" data-state="available" role="status" aria-live="polite" style={{ display: "grid", gap: 2, padding: "4px 8px", border: "1px dashed var(--ab-border)", borderRadius: 6 }}>
      <strong>{t("預估（估算值，不是實測）", "Estimate (not a measurement)")}</strong>
      <span data-testid="wind-estimate-total">
        {t(`共 ${estimate.directions.length} 個風向，約 ${formatCells(totals.estimated_cells)} 格，`, `${estimate.directions.length} directions, about ${formatCells(totals.estimated_cells)} cells, `)}
        {text(formatDuration(totals.estimated_seconds), "")}
        {t(`（含前處理約 ${Math.round(totals.preprocess_seconds / 60)} 分鐘）`, ` (incl. about ${Math.round(totals.preprocess_seconds / 60)} min of pre-processing)`)}
      </span>
      <small data-testid="wind-estimate-cells">
        {t(`背景格 ${estimate.background_cell_m} m（${auto ? "自動" : "手動"}）；近建物格約 ${estimate.near_building_cell_m} m；加細盒格約 ${estimate.refinement_box_cell_m} m`,
          `Background cells ${estimate.background_cell_m} m (${auto ? "automatic" : "manual"}); near-building cells about ${estimate.near_building_cell_m} m; refinement-box cells about ${estimate.refinement_box_cell_m} m`)}
      </small>
      <details data-testid="wind-estimate-directions">
        <summary>{t("每個風向", "Per direction")}</summary>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {estimate.directions.map((direction) => (
            <li key={direction.wind_from_degrees} data-testid={`wind-estimate-dir-${direction.wind_from_degrees}`}>
              {direction.wind_from_degrees}°{t("：背景 ", ": background ")}{formatCells(direction.background_cells)}{t(" 格，約 ", " cells, about ")}{formatCells(direction.estimated_cells)}{t(" 格，", " cells, ")}{text(formatDuration(direction.estimated_seconds), "")}
            </li>
          ))}
        </ul>
      </details>
      <small data-testid="wind-estimate-basis">
        {t("依據：幾何取自", "Basis: geometry from ")}{text(GEOMETRY_TEXT[estimate.geometry_source ?? ""], estimate.geometry_source ?? "")}
        {t(`；加細比例 ${basis.refine_factor}，來自`, `; refinement factor ${basis.refine_factor} from `)}{text(FACTOR_SOURCE_TEXT[basis.refine_factor_source], basis.refine_factor_source)}
        {t(`（${basis.refine_factor_samples} 筆）；每格耗時來自`, ` (${basis.refine_factor_samples} samples); time per cell from `)}{text(SECONDS_SOURCE_TEXT[basis.seconds_per_cell_source], basis.seconds_per_cell_source)}
        {t(`（${basis.seconds_per_cell_samples} 筆，${basis.n_procs} 核）。未收斂的風向會自動延長一次，耗時可能約加倍。`, ` (${basis.seconds_per_cell_samples} samples, ${basis.n_procs} cores). A direction that does not converge is extended once, which can roughly double its time.`)}
      </small>
      {limits.exceeds_hard_cap ? (
        <span role="alert" data-testid="wind-estimate-cap">
          {t(`超過算力上限：單一風向最多 ${formatCells(options.limits.max_cells_per_direction)} 格，伺服器會拒絕。請加大背景格或減少加細。`,
            `Over the compute cap of ${formatCells(options.limits.max_cells_per_direction)} cells per direction; the server will reject it. Use larger background cells.`)}
        </span>
      ) : null}
      {limits.confirm_required ? (
        <span data-testid="wind-estimate-confirm">
          {t("超過再確認門檻（", "Above the confirmation threshold (")}{text(confirmReasonsText(limits.confirm_reasons), "")}{t("），送出前會再問一次。", "); you will be asked again before submitting.")}
        </span>
      ) : null}
    </div>
  );
}

export function WindRunSettings({ options, values, presetId, errors, disabled, estimate, autoCellHint, onChange, onPreset }: {
  options: CfdOptionsDocument;
  values: SettingsValues;
  presetId: string;
  errors: Record<string, Bilingual>;
  disabled: boolean;
  estimate: EstimateState;
  /** 這個模型最近一次估算的自動背景格（m）；沒有時為 null。 */
  autoCellHint: number | null;
  onChange: (key: string, raw: string) => void;
  onPreset: (presetId: string) => void;
}) {
  const renderFields = (section: "general" | "advanced") => options.fields
    .filter((field) => field.section === section && isVisible(field, values))
    .map((field) => <FieldInput key={field.key} field={field} value={values[field.key] ?? ""} error={errors[field.key]} disabled={disabled}
      autoHint={field.key === AUTO_CELL_FIELD ? autoCellHint : null} onChange={onChange} />);
  const custom = presetId === CUSTOM_PRESET;
  return (
    <section data-testid="wind-settings" aria-label={t("計算設定", "Run settings")} style={{ display: "grid", gap: 6, border: "1px solid var(--ab-border)", borderRadius: 6, padding: 8 }}>
      <strong>{t("計算設定", "Run settings")}</strong>
      <label>{t("預設組", "Preset")}
        <select data-testid="wind-preset" aria-label={t("預設組", "Preset")} style={controlField} value={presetId} disabled={disabled} onChange={(event) => onPreset(event.target.value)}>
          {options.presets.map((preset) => (
            <option key={preset.preset_id} value={preset.preset_id}>{t(preset.label.zh, preset.label.en)}{preset.verified ? "" : t("（未驗證）", " (unverified)")}</option>
          ))}
          <option value={CUSTOM_PRESET}>{t("自訂", "Custom")}</option>
        </select>
      </label>
      {!custom ? (() => {
        const preset = options.presets.find((item) => item.preset_id === presetId);
        return preset ? <small data-testid="wind-preset-description">{t(preset.description.zh, preset.description.en)}</small> : null;
      })() : (
        <small data-testid="wind-settings-custom" role="note">
          {t("自訂設定：不屬於已驗證的預設組，結果與 issue 文字會加註；精度等級仍為 screening。", "Custom settings: not a verified preset; the results and issue text say so, and accuracy stays at screening.")}
        </small>
      )}
      <fieldset data-testid="wind-settings-general" style={{ border: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend style={fieldsetLegend}>{t("一般", "General")}</legend>
        {renderFields("general")}
      </fieldset>
      <details data-testid="wind-settings-advanced">
        <summary>{t("進階", "Advanced")}</summary>
        <div style={{ display: "grid", gap: 6, paddingTop: 4 }}>{renderFields("advanced")}</div>
      </details>
      <EstimateView state={estimate} options={options} />
    </section>
  );
}
