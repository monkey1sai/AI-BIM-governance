// CFD 計算設定（building-energy-cfd-p2-contract.md S8，settings phase A2）的純邏輯。
// 表單完全由 coordinator 透傳的 cfd-options/v1 產生：預設值、上下限、預設組都不寫死在 viewer。
// 值以「輸入框字串」保存（"" = null，給可為 null 的欄位，例如背景格留空＝自動規則），送出前才解析與驗證。
import type { CfdEstimateRequest, CfdOptionsDocument, CfdOptionsField, CfdRunOrigin } from "./cfdClient";

export type SettingsValues = Readonly<Record<string, string>>;
export type ParsedValue = number | string | null;
/** [zh, en]：由 i18n `t(...)` 取用。 */
export type Bilingual = readonly [string, string];

export const CUSTOM_PRESET = "custom";
export const STANDARD_PRESET = "standard";
/** 契約目前唯一的前處理 profile（cfd-run-request/v1 的 enum 只有一個值）。 */
const PROFILE = "exterior-wind/v1";

type Sections = {
  preprocess: Record<string, ParsedValue>;
  wind: Record<string, ParsedValue | number[]>;
  mesh: Record<string, ParsedValue>;
  solver: Record<string, ParsedValue>;
};
const SECTION_NAMES = ["preprocess", "wind", "mesh", "solver"] as const;

export function valueToInput(value: ParsedValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function initialSettings(options: CfdOptionsDocument): Record<string, string> {
  return Object.fromEntries(options.fields.map((field) => [field.key, valueToInput(field.default)]));
}

export function isVisible(field: CfdOptionsField, values: SettingsValues): boolean {
  const condition = field.visible_when;
  return !condition || (values[condition.key] ?? "") === valueToInput(condition.equals);
}

/**
 * 空值＝「自動」（引擎的自動規則，例如背景格）只適用於沒有顯示條件、可為 null 的欄位。
 * 有顯示條件的欄位（例如真北來源選手動後才出現的角度）是那個條件需要的值：看得到時就必填。
 */
export function allowsAutomatic(field: CfdOptionsField): boolean {
  return Boolean(field.nullable) && !field.visible_when;
}

/** cfd-estimate/v1 的 background_cell_m 是自動規則選出的背景格，只當這個欄位取消「自動」時的起始值。 */
export const AUTO_CELL_FIELD = "mesh.background_cell_m";

function rangeText(field: CfdOptionsField): Bilingual {
  const exclusive = field.exclusive_minimum !== undefined;
  const low = exclusive ? field.exclusive_minimum : field.minimum;
  const high = field.maximum;
  if (low !== undefined && high !== undefined) {
    return exclusive ? [`須大於 ${low}，且不超過 ${high}`, `Must be above ${low} and at most ${high}`] : [`須介於 ${low} 到 ${high}`, `Must be between ${low} and ${high}`];
  }
  if (high !== undefined) return [`不可超過 ${high}`, `Must be at most ${high}`];
  if (low !== undefined) return exclusive ? [`須大於 ${low}`, `Must be above ${low}`] : [`不可小於 ${low}`, `Must be at least ${low}`];
  return ["超出範圍", "Out of range"];
}

export interface FieldCheck {
  value: ParsedValue;
  error: Bilingual | null;
}

/** 以選項文件回報的契約上下限驗證一個欄位（viewer 不另寫上下限）。 */
export function checkField(field: CfdOptionsField, raw: string | undefined): FieldCheck {
  const text = (raw ?? "").trim();
  if (field.type === "enum") {
    return field.enum?.includes(text) ? { value: text, error: null } : { value: null, error: ["請選擇一個選項", "Choose an option"] };
  }
  if (text === "") return allowsAutomatic(field) ? { value: null, error: null } : { value: null, error: ["必填", "Required"] };
  const number = Number(text);
  if (!Number.isFinite(number)) return { value: null, error: ["須為數字", "Must be a number"] };
  if (field.type === "integer" && !Number.isInteger(number)) return { value: number, error: ["須為整數", "Must be a whole number"] };
  const belowExclusive = field.exclusive_minimum !== undefined && number <= field.exclusive_minimum;
  const belowMinimum = field.minimum !== undefined && number < field.minimum;
  const aboveMaximum = field.maximum !== undefined && number > field.maximum;
  if (belowExclusive || belowMinimum || aboveMaximum) return { value: number, error: rangeText(field) };
  return { value: number, error: null };
}

function sameInput(left: string, right: string): boolean {
  if (left === right) return true;
  if (left === "" || right === "") return false;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** 目前的值等於哪一個預設組（只比對表單上看得到的欄位；隱藏欄位視為 null）；都不等於時回 CUSTOM_PRESET。 */
export function matchPreset(options: CfdOptionsDocument, values: SettingsValues): string {
  for (const preset of options.presets) {
    const same = options.fields.every((field) => {
      if (!(field.key in preset.values)) return true;
      const current = isVisible(field, values) ? (values[field.key] ?? "").trim() : "";
      return sameInput(current, valueToInput(preset.values[field.key as keyof typeof preset.values]));
    });
    if (same) return preset.preset_id;
  }
  return CUSTOM_PRESET;
}

export function applyPreset(options: CfdOptionsDocument, values: SettingsValues, presetId: string): Record<string, string> {
  const preset = options.presets.find((item) => item.preset_id === presetId);
  const next = { ...values };
  if (!preset) return next;
  for (const field of options.fields) {
    if (field.key in preset.values) next[field.key] = valueToInput(preset.values[field.key as keyof typeof preset.values]);
  }
  return next;
}

export interface BuiltSettings {
  ok: boolean;
  /** field key → 錯誤說明（只含看得到的欄位）。 */
  errors: Record<string, Bilingual>;
  sections: Sections;
  presetId: string;
}

/**
 * 表單值 → 請求的 preprocess／wind／mesh／solver 區塊。看不到的欄位不送（例如來源不是手動時的真北角度）；
 * 表單沒有的預設組欄位（前處理與加細層數）取「符合的預設組」，自訂時取標準預設組，讓請求明寫實際採用的設定。
 */
export function buildSettings(options: CfdOptionsDocument, values: SettingsValues): BuiltSettings {
  const sections: Sections = { preprocess: { profile: PROFILE }, wind: {}, mesh: {}, solver: {} };
  const errors: Record<string, Bilingual> = {};
  const presetId = matchPreset(options, values);
  const basis = options.presets.find((item) => item.preset_id === (presetId === CUSTOM_PRESET ? STANDARD_PRESET : presetId)) ?? options.presets[0];
  const formKeys = new Set<string>(options.fields.map((field) => field.key));
  for (const [key, value] of Object.entries(basis?.values ?? {})) {
    if (formKeys.has(key) || value === undefined) continue;
    const [section, name] = key.split(".") as [keyof Sections, string];
    if (SECTION_NAMES.includes(section)) sections[section][name] = value;
  }
  for (const field of options.fields) {
    if (!isVisible(field, values)) continue;
    const check = checkField(field, values[field.key]);
    if (check.error) { errors[field.key] = check.error; continue; }
    const [section, name] = field.key.split(".") as [keyof Sections, string];
    if (SECTION_NAMES.includes(section)) sections[section][name] = check.value;
  }
  return { ok: Object.keys(errors).length === 0, errors, sections, presetId };
}

export function estimateRequest(conversionJobId: string, directions: readonly number[], built: BuiltSettings): CfdEstimateRequest {
  return {
    schema: "cfd-estimate-request/v1",
    source: { conversion_job_id: conversionJobId },
    preprocess: built.sections.preprocess as CfdEstimateRequest["preprocess"],
    wind: { ...built.sections.wind, wind_from_degrees: [...directions] } as CfdEstimateRequest["wind"],
    mesh: built.sections.mesh as NonNullable<CfdEstimateRequest["mesh"]>,
    solver: built.sections.solver as NonNullable<CfdEstimateRequest["solver"]>,
  };
}

/** 估算結果只對「產生它的那組輸入」有效；以此鍵判斷是否過期。 */
export function settingsKey(conversionJobId: string, directions: readonly number[], built: BuiltSettings): string {
  return JSON.stringify([conversionJobId, [...directions], built.sections]);
}

/**
 * 「用這組設定重新送出」：把 ledger origin 記錄的送出設定帶回表單。S8 以前的 run 沒記 zref／z0／真北，
 * 當時面板固定送 10 m／0.5 m／IFC 定位資料，等於標準預設組，因此缺值時回到欄位預設。
 */
export function settingsFromOrigin(options: CfdOptionsDocument, origin: CfdRunOrigin, current: SettingsValues): Record<string, string> {
  const recorded: Record<string, ParsedValue | undefined> = {
    "wind.uref_m_s": origin.uref_m_s,
    "wind.zref_m": origin.zref_m,
    "wind.z0_m": origin.z0_m,
    "wind.true_north_source": origin.true_north_source,
    "wind.true_north_degrees_manual": origin.true_north_degrees_manual,
    "mesh.background_cell_m": origin.background_cell_m,
    "solver.end_time": origin.end_time,
  };
  const next = { ...current };
  for (const field of options.fields) {
    if (!(field.key in recorded)) continue;
    const value = recorded[field.key];
    next[field.key] = value === undefined || (value === null && !field.nullable) ? valueToInput(field.default) : valueToInput(value);
  }
  return next;
}

const CONFIRM_REASON_TEXT: Record<string, Bilingual> = {
  cells_per_direction: ["單一風向格數偏多", "many cells in one direction"],
  total_hours: ["總耗時偏長", "long total time"],
};

/** 再確認門檻的原因（cfd-estimate/v1 limits.confirm_reasons），估算區與再確認對話框共用；未知代碼原樣顯示。 */
export function confirmReasonsText(reasons: readonly string[]): Bilingual {
  const join = (index: 0 | 1, separator: string) => reasons.map((reason) => CONFIRM_REASON_TEXT[reason]?.[index] ?? reason).join(separator);
  return [join(0, "、"), join(1, ", ")];
}

export function formatCells(cells: number): string {
  return cells >= 1_000_000 ? `${(cells / 1_000_000).toFixed(2)} M` : cells.toLocaleString("en-US");
}

export function formatDuration(seconds: number): Bilingual {
  if (seconds < 90) return [`約 ${Math.round(seconds)} 秒`, `about ${Math.round(seconds)} s`];
  if (seconds < 5400) return [`約 ${Math.round(seconds / 60)} 分鐘`, `about ${Math.round(seconds / 60)} min`];
  const hours = (seconds / 3600).toFixed(1);
  return [`約 ${hours} 小時`, `about ${hours} h`];
}
