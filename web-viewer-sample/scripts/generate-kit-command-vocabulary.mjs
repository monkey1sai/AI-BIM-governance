// Kit Command Vocabulary：tests/contracts/kit-datachannel-v1.schema.json 的 x-kit-command／x-kit-constant
// → viewer、coordinator、Kit 三份只含資料的產出檔（入版控，runtime 不讀 schema）。
// 決策紀錄：docs/architecture/kit-command-vocabulary-adr.md
//
// 再生成：cd web-viewer-sample && npm run generate:kit-command-vocabulary
// 只檢查：cd web-viewer-sample && npm run generate:kit-command-vocabulary -- --check
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGENERATE = "cd web-viewer-sample && npm run generate:kit-command-vocabulary";
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;
const COMMAND_KEYS = new Set(["mutates", "stageLoad", "harnessOnly", "results", "context"]);
const GENERATED_NAMES = new Set([
  "KIT_COMMANDS", "KIT_MUTATING_COMMANDS", "KIT_READONLY_COMMANDS", "KIT_STAGE_LOAD_COMMANDS",
  "KIT_HARNESS_ONLY_COMMANDS", "KIT_EVENTS", "KIT_COMMAND_REJECTION_REASONS", "KIT_COMMAND_RESULTS",
  "KIT_COMMAND_CONTEXT_FIELDS",
]);

export const SCHEMA_RELATIVE_PATH = "tests/contracts/kit-datachannel-v1.schema.json";
export const OUTPUTS = [
  { relativePath: "web-viewer-sample/src/generated/kit-command-vocabulary.ts", language: "ts" },
  { relativePath: "bim-review-coordinator/src/generated/kit-command-vocabulary.ts", language: "ts" },
  {
    relativePath:
      "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/kit_command_vocabulary.py",
    language: "py",
  },
];

export const lf = (text) => text.replace(/\r\n/g, "\n");
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

function fail(message) {
  throw new Error(`kit-command-vocabulary: ${message}`);
}

function eventNameOf(entry) {
  const ref = entry?.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) {
    fail(`oneOf entry ${JSON.stringify(entry)} is not a #/$defs reference`);
  }
  return ref.slice("#/$defs/".length);
}

// The payload's own property names: its `properties` and those of its allOf/oneOf/anyOf branches. Referenced
// definitions (the runtime authority envelope) are not followed: their fields are never command context.
function payloadPropertyNames(def) {
  const names = new Set();
  const visit = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const key of Object.keys(node.properties ?? {})) names.add(key);
    for (const branch of ["allOf", "oneOf", "anyOf"]) {
      if (Array.isArray(node[branch])) node[branch].forEach(visit);
    }
  };
  visit(def?.properties?.payload);
  return names;
}

function readCommand(name, annotation, kitEventSet, payloadNames) {
  if (!annotation || typeof annotation !== "object" || Array.isArray(annotation)) {
    fail(`$defs/${name} x-kit-command must be an object`);
  }
  for (const key of Object.keys(annotation)) {
    if (!COMMAND_KEYS.has(key)) fail(`$defs/${name} x-kit-command has unknown key ${key}`);
  }
  const { mutates, stageLoad = false, harnessOnly = false, results, context } = annotation;
  if (typeof mutates !== "boolean" || typeof stageLoad !== "boolean" || typeof harnessOnly !== "boolean") {
    fail(`$defs/${name} x-kit-command flags must be booleans`);
  }
  if ((stageLoad || harnessOnly) && !mutates) fail(`$defs/${name} stageLoad/harnessOnly requires mutates: true`);
  if (!Array.isArray(results) || results.length === 0) fail(`$defs/${name} x-kit-command.results must be a non-empty array`);
  if (new Set(results).size !== results.length) fail(`$defs/${name} x-kit-command.results has duplicates`);
  for (const result of results) {
    if (!kitEventSet.has(result)) fail(`$defs/${name} result ${result} is not a Kit→viewer event in oneOf`);
  }
  if (context !== undefined) {
    if (!mutates) fail(`$defs/${name} x-kit-command.context requires mutates: true`);
    if (!Array.isArray(context) || !context.every((field) => typeof field === "string")) {
      fail(`$defs/${name} x-kit-command.context must be an array of payload property names`);
    }
    if (new Set(context).size !== context.length) fail(`$defs/${name} x-kit-command.context has duplicates`);
    for (const field of context) {
      if (!payloadNames.has(field)) fail(`$defs/${name} context field ${field} is not a payload property`);
    }
  }
  return { name, mutates, stageLoad, harnessOnly, results: [...results], context: context === undefined ? null : [...context] };
}

function collectConstants(node, where, out) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectConstants(child, `${where}/${index}`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (Object.hasOwn(node, "x-kit-constant")) {
    const name = node["x-kit-constant"];
    if (typeof name !== "string" || !CONSTANT_NAME.test(name)) fail(`${where} x-kit-constant must be UPPER_SNAKE_CASE`);
    if (out.some((constant) => constant.name === name)) fail(`duplicate x-kit-constant ${name}`);
    if (Array.isArray(node.enum) && node.enum.length > 0 && node.enum.every((value) => typeof value === "string")) {
      out.push({ name, kind: "enum", values: [...node.enum] });
    } else if (typeof node.minimum === "number" && typeof node.maximum === "number") {
      out.push({ name, kind: "range", minimum: node.minimum, maximum: node.maximum });
    } else {
      fail(`${where} x-kit-constant ${name} must sit on a string enum or on a number with minimum and maximum`);
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key !== "x-kit-constant") collectConstants(value, `${where}/${key}`, out);
  }
}

export function buildVocabulary(schema) {
  const defs = schema?.$defs;
  if (!defs || typeof defs !== "object") fail("schema has no $defs");
  if (!Array.isArray(schema.oneOf)) fail("schema has no oneOf");
  const events = schema.oneOf.map(eventNameOf);
  for (const name of events) {
    if (!Object.hasOwn(defs, name)) fail(`oneOf references missing $defs/${name}`);
    if (defs[name]?.properties?.event_type?.const !== name) fail(`$defs/${name} event_type const must equal its name`);
  }
  const eventSet = new Set(events);
  for (const [name, def] of Object.entries(defs)) {
    if (def && typeof def === "object" && Object.hasOwn(def, "x-kit-command") && !eventSet.has(name)) {
      fail(`$defs/${name} has x-kit-command but is not listed in oneOf`);
    }
  }
  const isCommand = (name) => Object.hasOwn(defs[name], "x-kit-command");
  const kitEvents = events.filter((name) => !isCommand(name));
  const kitEventSet = new Set(kitEvents);
  const commands = events.filter(isCommand)
    .map((name) => readCommand(name, defs[name]["x-kit-command"], kitEventSet, payloadPropertyNames(defs[name])));

  const rejection = defs.commandRejected?.properties?.payload?.properties;
  const rejectedEventTypes = rejection?.rejected_event_type?.enum;
  const reasons = rejection?.reason?.enum;
  if (!Array.isArray(rejectedEventTypes)) fail("commandRejected payload.rejected_event_type.enum is missing");
  if (!Array.isArray(reasons) || reasons.length === 0) fail("commandRejected payload.reason.enum is missing");
  const commandNames = commands.map((command) => command.name);
  const missing = commandNames.filter((name) => !rejectedEventTypes.includes(name));
  const extra = rejectedEventTypes.filter((name) => !commandNames.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    fail(
      "commandRejected.rejected_event_type must list every command "
        + `(missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
    );
  }

  const constants = [];
  collectConstants(defs, "$defs", constants);
  // Python 把 range 拆成 <NAME>_MINIMUM／<NAME>_MAXIMUM；任何撞名都會在某一邊靜默覆寫或編譯失敗。
  const emitted = new Set(GENERATED_NAMES);
  for (const constant of constants) {
    const names = constant.kind === "range"
      ? [constant.name, `${constant.name}_MINIMUM`, `${constant.name}_MAXIMUM`]
      : [constant.name];
    for (const name of names) {
      if (emitted.has(name)) fail(`x-kit-constant ${constant.name} collides with generated name ${name}`);
      emitted.add(name);
    }
  }
  return { commands, kitEvents, rejectionReasons: [...reasons], constants };
}

const quote = (value) => JSON.stringify(value);
const tsList = (values) => `[${values.map(quote).join(", ")}] as const`;
const pyTuple = (values) => (values.length === 1 ? `(${quote(values[0])},)` : `(${values.map(quote).join(", ")})`);
const pyNumber = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));

function lists(vocabulary) {
  const pick = (predicate) => vocabulary.commands.filter(predicate).map((command) => command.name);
  return [
    ["KIT_COMMANDS", pick(() => true)],
    ["KIT_MUTATING_COMMANDS", pick((command) => command.mutates)],
    ["KIT_READONLY_COMMANDS", pick((command) => !command.mutates)],
    ["KIT_STAGE_LOAD_COMMANDS", pick((command) => command.stageLoad)],
    ["KIT_HARNESS_ONLY_COMMANDS", pick((command) => command.harnessOnly)],
    ["KIT_EVENTS", vocabulary.kitEvents],
    ["KIT_COMMAND_REJECTION_REASONS", vocabulary.rejectionReasons],
  ];
}

function header(comment, sourceSha) {
  return [
    `${comment} GENERATED FILE - DO NOT EDIT.`,
    `${comment} Kit Command Vocabulary，由 ${SCHEMA_RELATIVE_PATH} 的 x-kit-command／x-kit-constant 生成。`,
    `${comment} 再生成：${REGENERATE}`,
    `${comment} source-sha256: ${sourceSha}`,
  ];
}

export function renderTypeScript(vocabulary, sourceSha) {
  const lines = [...header("//", sourceSha), ""];
  for (const [name, values] of lists(vocabulary)) lines.push(`export const ${name} = ${tsList(values)};`);
  lines.push(
    "export type KitCommand = (typeof KIT_COMMANDS)[number];",
    "export type KitEvent = (typeof KIT_EVENTS)[number];",
    "",
    "export const KIT_COMMAND_RESULTS: { readonly [C in KitCommand]: readonly KitEvent[] } = {",
    ...vocabulary.commands.map((command) => `  ${command.name}: ${tsList(command.results)},`),
    "};",
    "",
    "/** Payload fields each authorized command forwards to Runtime Mutation Authority as command_context. */",
    "export const KIT_COMMAND_CONTEXT_FIELDS: { readonly [C in KitCommand]?: readonly string[] } = {",
    ...vocabulary.commands.filter((command) => command.context).map((command) => `  ${command.name}: ${tsList(command.context)},`),
    "};",
  );
  if (vocabulary.constants.length > 0) lines.push("");
  for (const constant of vocabulary.constants) {
    lines.push(constant.kind === "enum"
      ? `export const ${constant.name} = ${tsList(constant.values)};`
      : `export const ${constant.name} = { minimum: ${constant.minimum}, maximum: ${constant.maximum} } as const;`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderPython(vocabulary, sourceSha) {
  const lines = [
    ...header("#", sourceSha),
    '"""Kit Command Vocabulary data; see docs/architecture/kit-command-vocabulary-adr.md."""',
    "",
  ];
  for (const [name, values] of lists(vocabulary)) lines.push(`${name} = ${pyTuple(values)}`);
  lines.push(
    "",
    "KIT_COMMAND_RESULTS = {",
    ...vocabulary.commands.map((command) => `    ${quote(command.name)}: ${pyTuple(command.results)},`),
    "}",
    "",
    "KIT_COMMAND_CONTEXT_FIELDS = {",
    ...vocabulary.commands.filter((command) => command.context).map((command) => `    ${quote(command.name)}: ${pyTuple(command.context)},`),
    "}",
  );
  if (vocabulary.constants.length > 0) lines.push("");
  for (const constant of vocabulary.constants) {
    if (constant.kind === "enum") {
      lines.push(`${constant.name} = ${pyTuple(constant.values)}`);
    } else {
      lines.push(`${constant.name}_MINIMUM = ${pyNumber(constant.minimum)}`, `${constant.name}_MAXIMUM = ${pyNumber(constant.maximum)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function renderAll() {
  const schemaText = readFileSync(path.join(repoRoot, SCHEMA_RELATIVE_PATH), "utf8");
  const sourceSha = sha256(lf(schemaText));
  const vocabulary = buildVocabulary(JSON.parse(schemaText));
  return OUTPUTS.map((output) => ({
    ...output,
    content: output.language === "ts" ? renderTypeScript(vocabulary, sourceSha) : renderPython(vocabulary, sourceSha),
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
    console.log(`kit-command-vocabulary: ${OUTPUTS.length} outputs up to date`);
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
