// CFD Settings Catalog：tests/contracts/cfd-run-request-v1.schema.json 每個計算設定的 x-cfd-setting
// → streaming、coordinator、viewer 三份只含資料的產出檔（入版控，runtime 不讀 schema）。
// 決策紀錄：docs/architecture/cfd-settings-catalog-adr.md
//
// 再生成：cd web-viewer-sample && npm run generate:cfd-settings-catalog
// 只檢查：cd web-viewer-sample && npm run generate:cfd-settings-catalog -- --check
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGENERATE = "cd web-viewer-sample && npm run generate:cfd-settings-catalog";

export const SCHEMA_RELATIVE_PATH = "tests/contracts/cfd-run-request-v1.schema.json";
export const OUTPUTS = [
  {
    relativePath:
      "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/cfd_settings_catalog.py",
    language: "py",
  },
  { relativePath: "bim-review-coordinator/src/generated/cfd-settings-catalog.ts", language: "ts" },
  { relativePath: "web-viewer-sample/src/generated/cfd-settings-catalog.ts", language: "ts" },
];

// The request sections whose scalar properties are settings. Everything else in the request (identity,
// source binding, requested_by) is not a setting and carries no annotation.
export const SETTING_SECTIONS = ["preprocess", "wind", "mesh", "solver"];
// Properties of those sections that are the scenario being asked about, not a tunable setting.
export const NOT_SETTINGS = new Set(["preprocess.profile", "wind.wind_from_degrees"]);
export const PANEL_SECTIONS = ["general", "advanced"];

const ANNOTATION_KEYS = new Set(["preset", "engine", "panel"]);
const PANEL_KEYS = new Set(["section", "ui_default", "step", "unit", "label", "help", "enum_labels", "visible_when"]);
// The only JSON Schema keywords a setting may use: each runtime builds its validator from the derived bounds, so a
// keyword outside this set would be silently dropped. Add support here before using a new one.
const SCHEMA_KEYWORDS = new Set(["type", "enum", "minimum", "maximum", "exclusiveMinimum", "default", "description", "x-cfd-setting"]);
const ENGINE_NAME = /^[a-z][a-z0-9_]*$/;

export const lf = (text) => text.replace(/\r\n/g, "\n");
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function fail(message) {
  throw new Error(`cfd-settings-catalog: ${message}`);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

function readBounds(key, spec) {
  for (const keyword of Object.keys(spec)) {
    if (!SCHEMA_KEYWORDS.has(keyword)) fail(`${key} uses schema keyword ${keyword}, which the catalog does not derive`);
  }
  if (Array.isArray(spec.enum)) {
    if (spec.enum.length === 0 || !spec.enum.every((value) => typeof value === "string")) fail(`${key} enum must be non-empty strings`);
    if (spec.type !== undefined || spec.minimum !== undefined || spec.maximum !== undefined || spec.exclusiveMinimum !== undefined) {
      fail(`${key} enum must not carry a type or numeric bounds`);
    }
    return { type: "enum", enum: [...spec.enum] };
  }
  const types = Array.isArray(spec.type) ? spec.type : [spec.type];
  const nullable = types.includes("null");
  const base = types.filter((type) => type !== "null");
  if (base.length !== 1 || !["number", "integer"].includes(base[0]) || types.length > 2) {
    fail(`${key} type must be number, integer, or one of them with null`);
  }
  const bounds = { type: base[0] };
  for (const [keyword, name] of [["minimum", "minimum"], ["exclusiveMinimum", "exclusive_minimum"], ["maximum", "maximum"]]) {
    if (spec[keyword] === undefined) continue;
    if (!isNumber(spec[keyword])) fail(`${key} ${keyword} must be a finite number`);
    bounds[name] = spec[keyword];
  }
  if (bounds.minimum !== undefined && bounds.exclusive_minimum !== undefined) fail(`${key} has both minimum and exclusiveMinimum`);
  if (bounds.maximum === undefined) fail(`${key} needs a maximum: the browser form and the estimator rely on a finite range`);
  if (nullable) bounds.nullable = true;
  return bounds;
}

// Mirrors cfd_options._within_bounds so the generator refuses a ui_default or visible_when value the validator would.
function withinBounds(bounds, value) {
  if (value === null) return Boolean(bounds.nullable);
  if (bounds.type === "enum") return bounds.enum.includes(value);
  if (!isNumber(value)) return false;
  if (bounds.type === "integer" && !Number.isInteger(value)) return false;
  if (bounds.minimum !== undefined && value < bounds.minimum) return false;
  if (bounds.exclusive_minimum !== undefined && value <= bounds.exclusive_minimum) return false;
  if (bounds.maximum !== undefined && value > bounds.maximum) return false;
  return true;
}

function readText(value, where) {
  if (!isObject(value) || Object.keys(value).length !== 2) fail(`${where} must be an object with zh and en`);
  for (const lang of ["zh", "en"]) {
    if (typeof value[lang] !== "string" || value[lang] === "") fail(`${where}.${lang} must be a non-empty string`);
  }
  return { zh: value.zh, en: value.en };
}

function readPanel(key, bounds, preset, raw) {
  if (!isObject(raw)) fail(`${key} x-cfd-setting.panel must be an object`);
  for (const name of Object.keys(raw)) {
    if (!PANEL_KEYS.has(name)) fail(`${key} x-cfd-setting.panel has unknown key ${name}`);
  }
  if (!PANEL_SECTIONS.includes(raw.section)) fail(`${key} panel.section must be one of ${PANEL_SECTIONS.join(", ")}`);
  // Key order matters: cfd_options.build_options_document serialises this dict as the options field.
  const panel = { key, section: raw.section, label: readText(raw.label, `${key} panel.label`), help: readText(raw.help, `${key} panel.help`) };
  if (Object.hasOwn(raw, "ui_default")) {
    if (preset) fail(`${key} is preset-controlled and takes its default from the standard preset, not ui_default`);
    if (!withinBounds(bounds, raw.ui_default)) fail(`${key} panel.ui_default is outside the bounds`);
    panel.ui_default = raw.ui_default;
  } else if (!preset) {
    fail(`${key} is not preset-controlled and is on the panel, so it needs panel.ui_default`);
  }
  if (Object.hasOwn(raw, "step")) {
    if (!isNumber(raw.step) || raw.step <= 0) fail(`${key} panel.step must be a positive number`);
    panel.step = raw.step;
  }
  if (Object.hasOwn(raw, "unit")) {
    if (typeof raw.unit !== "string") fail(`${key} panel.unit must be a string`);
    panel.unit = raw.unit;
  }
  if (Object.hasOwn(raw, "enum_labels")) {
    if (bounds.type !== "enum") fail(`${key} panel.enum_labels needs an enum setting`);
    if (!isObject(raw.enum_labels) || Object.keys(raw.enum_labels).sort().join() !== [...bounds.enum].sort().join()) {
      fail(`${key} panel.enum_labels must label exactly ${bounds.enum.join(", ")}`);
    }
    panel.enum_labels = Object.fromEntries(bounds.enum.map((name) => [name, readText(raw.enum_labels[name], `${key} panel.enum_labels.${name}`)]));
  }
  if (Object.hasOwn(raw, "visible_when")) panel.visible_when = raw.visible_when; // checked once every setting is known
  return panel;
}

export function buildCatalog(schema) {
  const properties = schema?.properties;
  if (!isObject(properties)) fail("schema has no properties");
  const settings = [];
  for (const section of SETTING_SECTIONS) {
    const block = properties[section]?.properties;
    if (!isObject(block)) fail(`schema has no properties.${section}.properties`);
    // Whether a request must carry the setting is a schema fact (the section's `required`), not an annotation.
    const required = properties[section].required ?? [];
    if (!Array.isArray(required) || !required.every((entry) => typeof entry === "string")) fail(`properties.${section}.required must be an array of names`);
    for (const [name, spec] of Object.entries(block)) {
      const key = `${section}.${name}`;
      const annotated = isObject(spec) && Object.hasOwn(spec, "x-cfd-setting");
      if (NOT_SETTINGS.has(key)) {
        if (annotated) fail(`${key} is not a setting and must not carry x-cfd-setting`);
        continue;
      }
      if (!annotated) fail(`${key} has no x-cfd-setting; every scalar in ${SETTING_SECTIONS.join("/")} is a setting or listed in NOT_SETTINGS`);
      const annotation = spec["x-cfd-setting"];
      if (!isObject(annotation)) fail(`${key} x-cfd-setting must be an object`);
      for (const field of Object.keys(annotation)) {
        if (!ANNOTATION_KEYS.has(field)) fail(`${key} x-cfd-setting has unknown key ${field}`);
      }
      if (typeof annotation.preset !== "boolean") fail(`${key} x-cfd-setting.preset must be a boolean`);
      if (annotation.engine !== null && (typeof annotation.engine !== "string" || !ENGINE_NAME.test(annotation.engine))) {
        fail(`${key} x-cfd-setting.engine must be a CaseParams field name or null`);
      }
      const bounds = readBounds(key, spec);
      const panel = Object.hasOwn(annotation, "panel") ? readPanel(key, bounds, annotation.preset, annotation.panel) : null;
      settings.push({ key, section, required: required.includes(name), bounds, preset: annotation.preset, engine: annotation.engine, panel });
    }
  }
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  for (const setting of settings) {
    const condition = setting.panel?.visible_when;
    if (condition === undefined) continue;
    if (!isObject(condition) || Object.keys(condition).sort().join() !== "equals,key") fail(`${setting.key} panel.visible_when must be {key, equals}`);
    const target = byKey.get(condition.key);
    if (!target) fail(`${setting.key} panel.visible_when.key ${condition.key} is not a setting`);
    if (!withinBounds(target.bounds, condition.equals)) fail(`${setting.key} panel.visible_when.equals is not a valid value of ${condition.key}`);
    setting.panel.visible_when = { key: condition.key, equals: condition.equals };
  }
  const engines = settings.filter((setting) => setting.engine !== null).map((setting) => setting.engine);
  if (new Set(engines).size !== engines.length) fail("two settings drive the same engine field");
  return { settings, panelSections: [...PANEL_SECTIONS] };
}

// ---------------------------------------------------------------------------------------------- Python rendering

const quote = (value) => JSON.stringify(value);
const pyTuple = (values) => (values.length === 1 ? `(${values[0]},)` : `(${values.join(", ")})`);

// Number bounds are rendered as floats and integer bounds as ints, which is what the hand-kept table held; a
// generic literal keeps the JSON number's own form (a step of 1 stays 1).
const pyFloat = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));

function pyLiteral(value) {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(", ")}]`;
  return `{${Object.entries(value).map(([key, item]) => `${quote(key)}: ${pyLiteral(item)}`).join(", ")}}`;
}

function pyBounds(bounds) {
  const parts = [`"type": ${quote(bounds.type)}`];
  if (bounds.enum) parts.push(`"enum": ${pyLiteral(bounds.enum)}`);
  const number = bounds.type === "integer" ? String : pyFloat;
  for (const name of ["minimum", "exclusive_minimum", "maximum"]) {
    if (bounds[name] !== undefined) parts.push(`${quote(name)}: ${number(bounds[name])}`);
  }
  if (bounds.nullable) parts.push('"nullable": True');
  return `{${parts.join(", ")}}`;
}

function header(comment, sourceSha) {
  return [
    `${comment} GENERATED FILE - DO NOT EDIT.`,
    `${comment} CFD Settings Catalog，由 ${SCHEMA_RELATIVE_PATH} 的 x-cfd-setting 生成。`,
    `${comment} 再生成：${REGENERATE}`,
    `${comment} source-sha256: ${sourceSha}`,
  ];
}

export function renderPython(catalog, sourceSha) {
  const { settings } = catalog;
  const keys = (predicate) => settings.filter(predicate).map((setting) => quote(setting.key));
  const lines = [
    ...header("#", sourceSha),
    '"""CFD Settings Catalog data; see docs/architecture/cfd-settings-catalog-adr.md."""',
    "",
    `SECTIONS = ${pyTuple(catalog.panelSections.map(quote))}`,
    "",
    "# Contract bounds of every setting, in request order.",
    "REQUEST_FIELD_BOUNDS = {",
    ...settings.map((setting) => `    ${quote(setting.key)}: ${pyBounds(setting.bounds)},`),
    "}",
    "",
    "# Settings a preset controls; every preset in cfd_options.json sets exactly these.",
    `PRESET_KEYS = ${pyTuple(keys((setting) => setting.preset))}`,
    "",
    "# Request key -> the cfd_pipeline.openfoam_case.CaseParams field it drives (preprocess settings drive run_preprocess instead).",
    "ENGINE_FIELDS = {",
    ...settings.filter((setting) => setting.engine !== null).map((setting) => `    ${quote(setting.key)}: ${quote(setting.engine)},`),
    "}",
    "",
    "# Every setting is recorded in the coordinator's ledger origin with the value the request carried (null when omitted).",
    `ORIGIN_FIELDS = ${pyTuple(keys(() => true))}`,
    "",
    "# Browser form fields in panel order; cfd_options.build_options_document adds the bounds and the default.",
    "PANEL_FIELDS = (",
    ...settings.filter((setting) => setting.panel !== null).map((setting) => `    ${pyLiteral(setting.panel)},`),
    ")",
  ];
  return `${lines.join("\n")}\n`;
}

// ------------------------------------------------------------------------------------------ TypeScript rendering

// The same bounds object the Python file holds, in the same key order, as one JSON literal per setting.
function orderedBounds(bounds) {
  const out = { type: bounds.type };
  if (bounds.enum) out.enum = bounds.enum;
  for (const name of ["minimum", "exclusive_minimum", "maximum"]) {
    if (bounds[name] !== undefined) out[name] = bounds[name];
  }
  if (bounds.nullable) out.nullable = true;
  return out;
}

export function renderTypeScript(catalog, sourceSha) {
  const { settings } = catalog;
  const keys = (predicate) => settings.filter(predicate).map((setting) => setting.key);
  const sortedKeys = [...keys(() => true)].sort();
  const declarations = settings.map((setting) => JSON.stringify({
    key: setting.key, section: setting.section, required: setting.required, bounds: orderedBounds(setting.bounds),
    preset: setting.preset, engine: setting.engine, panel: setting.panel,
  }));
  const lines = [
    ...header("//", sourceSha),
    "",
    "export type CfdSettingSection = \"preprocess\" | \"wind\" | \"mesh\" | \"solver\";",
    "export type CfdSettingBounds =",
    "  | { readonly type: \"number\" | \"integer\"; readonly minimum?: number; readonly exclusive_minimum?: number; readonly maximum: number; readonly nullable?: true }",
    "  | { readonly type: \"enum\"; readonly enum: readonly string[] };",
    "export interface CfdLocalizedText { readonly zh: string; readonly en: string }",
    "export interface CfdPanelField {",
    "  readonly key: CfdSettingKey;",
    `  readonly section: ${catalog.panelSections.map(quote).join(" | ")};`,
    "  readonly label: CfdLocalizedText;",
    "  readonly help: CfdLocalizedText;",
    "  readonly ui_default?: number | string | null;",
    "  readonly step?: number;",
    "  readonly unit?: string;",
    "  readonly enum_labels?: Readonly<Record<string, CfdLocalizedText>>;",
    "  readonly visible_when?: { readonly key: CfdSettingKey; readonly equals: number | string | null };",
    "}",
    "export interface CfdSettingDeclaration {",
    "  readonly key: CfdSettingKey;",
    "  readonly section: CfdSettingSection;",
    "  /** The request section lists the setting in `required`; otherwise a request may omit it and the service applies the standard preset. */",
    "  readonly required: boolean;",
    "  readonly bounds: CfdSettingBounds;",
    "  /** A preset controls the value; the presets themselves live in the streaming cfd_options.json. */",
    "  readonly preset: boolean;",
    "  /** The cfd_pipeline CaseParams field the setting drives; null for preprocess settings. */",
    "  readonly engine: string | null;",
    "  readonly panel: CfdPanelField | null;",
    "}",
    "",
    "/** Every setting key, sorted: the `fieldKey` enumeration of cfd-options-v1 and cfd-estimate-v1. */",
    `export const CFD_SETTING_KEYS = ${tsList(sortedKeys)};`,
    "export type CfdSettingKey = (typeof CFD_SETTING_KEYS)[number];",
    "",
    "/** Every setting in request order, with its bounds, preset membership, engine field and panel metadata. */",
    "export const CFD_SETTINGS: readonly CfdSettingDeclaration[] = [",
    ...declarations.map((literal) => `  ${literal},`),
    "];",
    "",
    "/** The same declarations grouped by request section, as literals: a validator built from them keeps the",
    " *  field types (required, nullable, enum members) without a hand-written copy. */",
    "export const CFD_SECTION_SETTINGS = {",
    ...SETTING_SECTIONS.flatMap((section) => [
      `  ${section}: {`,
      ...settings.filter((setting) => setting.section === section).map((setting) => `    ${setting.key.slice(section.length + 1)}: ${JSON.stringify({
        required: setting.required, bounds: orderedBounds(setting.bounds), preset: setting.preset,
      })},`),
      "  },",
    ]),
    "} as const;",
    "",
    `export const CFD_PRESET_KEYS: readonly CfdSettingKey[] = ${tsList(keys((setting) => setting.preset))};`,
    `export const CFD_ORIGIN_FIELDS: readonly CfdSettingKey[] = ${tsList(keys(() => true))};`,
    `export const CFD_PANEL_SECTIONS = ${tsList(catalog.panelSections)};`,
  ];
  return `${lines.join("\n")}\n`;
}

const tsList = (values) => `[${values.map(quote).join(", ")}] as const`;

export function renderAll() {
  const schemaText = readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8");
  const sourceSha = sha256(lf(schemaText));
  const catalog = buildCatalog(JSON.parse(schemaText));
  return OUTPUTS.map((output) => ({
    ...output,
    content: output.language === "ts" ? renderTypeScript(catalog, sourceSha) : renderPython(catalog, sourceSha),
  }));
}

function main(argv) {
  const check = argv.includes("--check");
  const stale = [];
  for (const output of renderAll()) {
    const target = path.join(repoRoot, output.relativePath);
    const current = existsSync(target) ? lf(readFileSync(target, "utf8")) : null;
    if (current === output.content) continue;
    if (check) {
      stale.push(output.relativePath);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, output.content, "utf8");
    console.log(`wrote ${output.relativePath}`);
  }
  if (stale.length > 0) {
    console.error(`stale generated files:\n  ${stale.join("\n  ")}\nrun: ${REGENERATE}`);
    process.exitCode = 1;
  } else if (check) {
    console.log(`cfd-settings-catalog: ${OUTPUTS.length} outputs up to date`);
  }
}

function isCliEntry() {
  if (!process.argv[1] || !existsSync(process.argv[1])) return false;
  // Node 以 realpath 載入主模組；經由 junction／symlink 執行時，argv[1] 不是解析後的路徑。
  return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
}

if (isCliEntry()) {
  main(process.argv.slice(2));
}
