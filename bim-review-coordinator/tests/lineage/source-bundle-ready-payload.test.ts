import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_CLOUD_FIELDS,
  validateSourceBundleReadyPayload,
} from "../../src/services/lineage/sourceBundleReadyPayload.js";

// D-2（coordinator 裁決）：ajv **不**進 production。production 走手寫 validator，
// 這一支 ajv-backed sibling 負責證明手寫 gate 與 L1 schema 在全部 fixture 上判得一樣。
// 先例：`src/lib/structLog.ts` 的 validateLogRecordBasic ＋ ajv contract test。

// `ajv/dist/2020` 而不是 `ajv`：L1 contract 宣告 `$schema: .../draft/2020-12/schema`，
// ajv 的預設 export 只認 draft-07，compile 會直接拋 "no schema with key or ref"。
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT_PATH = path.resolve(REPO_ROOT, "tests", "contracts", "source_bundle_ready.json");
const FIXTURE_ROOT = path.resolve(
  REPO_ROOT,
  "tests",
  "contracts",
  "lineage",
  "fixtures",
  "source_bundle_ready",
);

const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as Record<string, unknown>;
// strict:false 與既有 structured-log contract test 同設定；`format` 只是 annotation
// （L1 README §2：拒絕責任全在 pattern），所以不掛 format checker。
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

function readFixtures(kind: "valid" | "invalid"): Array<[string, unknown]> {
  const dir = path.join(FIXTURE_ROOT, kind);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [name, JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as unknown]);
}

const VALID_FIXTURES = readFixtures("valid");
const INVALID_FIXTURES = readFixtures("invalid");

describe("source_bundle_ready wire payload validator", () => {
  it("L1 fixture 數量與 README 的 ratchet 一致（2 valid / 13 invalid）", () => {
    expect(VALID_FIXTURES.length).toBe(2);
    expect(INVALID_FIXTURES.length).toBe(13);
  });

  it.each(VALID_FIXTURES)("接受 valid fixture %s（ajv 與手寫 validator 一致）", (_name, payload) => {
    expect(ajvValidate(payload)).toBe(true);
    const result = validateSourceBundleReadyPayload(payload);
    expect(result.ok).toBe(true);
  });

  it.each(INVALID_FIXTURES)(
    "拒絕 invalid fixture %s（ajv 與手寫 validator 一致）",
    (_name, payload) => {
      expect(ajvValidate(payload)).toBe(false);
      const result = validateSourceBundleReadyPayload(payload);
      expect(result.ok).toBe(false);
    },
  );

  it("逐一拒絕 8 個 dual-authority 禁用欄位，且拒絕理由指名該欄位", () => {
    const base = VALID_FIXTURES[0][1] as Record<string, unknown>;
    expect(FORBIDDEN_CLOUD_FIELDS).toHaveLength(8);
    for (const field of FORBIDDEN_CLOUD_FIELDS) {
      const payload = { ...base, [field]: "anything" };
      const result = validateSourceBundleReadyPayload(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.pointer).toBe(`/${field}`);
      expect(result.rejection.reason).toBe("forbidden_cloud_field");
      expect(ajvValidate(payload)).toBe(false);
    }
  });

  it("拒絕 calendar-invalid 的 claimed_at —— schema pattern 放行，runtime 必須擋", () => {
    const base = VALID_FIXTURES[0][1] as Record<string, unknown>;
    const payload = { ...base, claimed_at: "2026-02-30T09:19:30.000Z" };
    // L1 README §2 記錄的缺口：只掛 pattern 擋不住 2/30，schema 這一側是放行的。
    expect(ajvValidate(payload)).toBe(true);
    const result = validateSourceBundleReadyPayload(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.pointer).toBe("/claimed_at");
  });

  it("拒絕帶結尾換行的 timestamp（README §2 的 trailing-newline 缺口）", () => {
    const base = VALID_FIXTURES[0][1] as Record<string, unknown>;
    const payload = { ...base, claimed_at: `${base.claimed_at as string}\n` };
    const result = validateSourceBundleReadyPayload(payload);
    expect(result.ok).toBe(false);
    // 誠實註：README 的 quirk 是 Python `re.search` + `$` 的性質；JS 的 `$`（無 m flag）
    // 只 match 字串結尾，所以 ajv 這一側也會紅。runtime 的顯式 CR/LF 拒絕是縱深防禦，
    // 不依賴兩種 regex 引擎剛好一致。
    expect(ajvValidate(payload)).toBe(false);
  });

  it("拒絕結尾換行的 manifest_sha256", () => {
    const base = VALID_FIXTURES[0][1] as Record<string, unknown>;
    const payload = { ...base, manifest_sha256: `${base.manifest_sha256 as string}\n` };
    const result = validateSourceBundleReadyPayload(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.pointer).toBe("/manifest_sha256");
  });

  it("拒絕非 object 的 payload", () => {
    for (const input of [null, undefined, 42, "text", [1, 2, 3]]) {
      const result = validateSourceBundleReadyPayload(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.rejection.pointer).toBe("");
    }
  });

  it("接受 full fixture 的可選欄位並保留其值", () => {
    const full = VALID_FIXTURES.find(([name]) => name.includes("full"));
    expect(full).toBeDefined();
    const result = validateSourceBundleReadyPayload(full![1]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.event).toBe("source_bundle_ready");
    expect(result.payload.contract_version).toBe("source-bundle-ready/v1");
  });
});
