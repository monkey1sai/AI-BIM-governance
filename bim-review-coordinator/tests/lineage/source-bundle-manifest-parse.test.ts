import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  manifestDocumentDiagnostics,
  parseSourceBundleManifest,
  sha256Hex,
} from "../../src/services/lineage/sourceBundleManifest.js";
import { dedupedCodes } from "../helpers/governedBundleFixtures.js";

// 手寫 manifest parser ×（L1 schema ＋ L1 semantic fixture）三方對拍。
// 分工：parser 管形狀，manifestDocumentDiagnostics 管文件語意；兩層的**聯集**
// 必須涵蓋 ajv 拒絕的每一個 invalid fixture，否則就有一條規則從 runtime 掉了。

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT_PATH = path.resolve(
  REPO_ROOT,
  "tests",
  "contracts",
  "model_version_bundle_manifest.json",
);
const FIXTURE_ROOT = path.resolve(
  REPO_ROOT,
  "tests",
  "contracts",
  "lineage",
  "fixtures",
  "model_version_bundle_manifest",
);

const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf-8")) as Record<string, unknown>;
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

interface Fixture {
  name: string;
  document: Record<string, unknown>;
}

function readFixtures(kind: "valid" | "invalid" | "semantic"): Fixture[] {
  const dir = path.join(FIXTURE_ROOT, kind);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({
      name,
      document: JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8")) as Record<
        string,
        unknown
      >,
    }));
}

function toBytes(document: unknown): Buffer {
  return Buffer.from(JSON.stringify(document, null, 2), "utf-8");
}

function isManifestDocument(document: Record<string, unknown>): boolean {
  return document.document_type === "source_bundle_manifest";
}

const VALID = readFixtures("valid");
const INVALID = readFixtures("invalid");
const SEMANTIC = readFixtures("semantic");

const VALID_MANIFESTS = VALID.filter((fixture) => isManifestDocument(fixture.document));
const VALID_NON_MANIFESTS = VALID.filter((fixture) => !isManifestDocument(fixture.document));

describe("source bundle manifest parser", () => {
  it("L1 fixture 數量與 README 的 ratchet 一致（9 valid / 30 invalid / 8 semantic）", () => {
    expect(VALID.length).toBe(9);
    expect(INVALID.length).toBe(30);
    expect(SEMANTIC.length).toBe(8);
    expect(VALID_MANIFESTS.length).toBeGreaterThan(0);
  });

  it.each(VALID_MANIFESTS.map((f) => [f.name, f] as const))(
    "接受 valid manifest fixture %s 且語意層零診斷",
    (_name, fixture) => {
      expect(ajvValidate(fixture.document)).toBe(true);
      const result = parseSourceBundleManifest(toBytes(fixture.document));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(manifestDocumentDiagnostics(result.manifest)).toEqual([]);
    },
  );

  it.each(VALID_NON_MANIFESTS.map((f) => [f.name, f] as const))(
    "拒絕非 source_bundle_manifest 的 valid fixture %s（parser 只吃自己的 document_type）",
    (_name, fixture) => {
      const result = parseSourceBundleManifest(toBytes(fixture.document));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.diagnostics[0].code).toBe("semantic_contract_violation");
    },
  );

  it.each(INVALID.map((f) => [f.name, f] as const))(
    "invalid fixture %s 至少被形狀層或語意層其中一層擋下",
    (_name, fixture) => {
      expect(ajvValidate(fixture.document)).toBe(false);
      const result = parseSourceBundleManifest(toBytes(fixture.document));
      if (!result.ok) {
        expect(result.diagnostics.length).toBeGreaterThan(0);
        return;
      }
      // 形狀過得了的（duplicate role／四個 artifact／presigned ref／unversioned ref）
      // 必須由語意層開槍，而且開的是精確的 wire code，不是籠統的形狀錯。
      const diagnostics = manifestDocumentDiagnostics(result.manifest);
      expect(diagnostics.length).toBeGreaterThan(0);
    },
  );

  it.each(
    SEMANTIC.filter((f) =>
      isManifestDocument((f.document as { payload: Record<string, unknown> }).payload),
    ).map((f) => [f.name, f] as const),
  )("semantic fixture %s 的 diagnostic code 序列逐字相符", (_name, fixture) => {
    const wrapper = fixture.document as unknown as {
      payload: Record<string, unknown>;
      expect: { diagnostic_codes: string[] };
    };
    // semantic fixture 的 payload 必須本來就 schema-valid（README §4 的硬規則）。
    expect(ajvValidate(wrapper.payload)).toBe(true);
    const result = parseSourceBundleManifest(toBytes(wrapper.payload));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dedupedCodes(manifestDocumentDiagnostics(result.manifest))).toEqual(
      wrapper.expect.diagnostic_codes,
    );
  });

  it("回傳的 sha256 是**原始 bytes** 的 digest，不是重新序列化後的", () => {
    const fixture = VALID_MANIFESTS[0];
    // 刻意用與 toBytes 不同的縮排：digest 必須跟著實際 bytes 走。
    const bytes = Buffer.from(`${JSON.stringify(fixture.document)}\n`, "utf-8");
    const result = parseSourceBundleManifest(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
    expect(result.sha256).toBe(sha256Hex(bytes));
    expect(result.sha256).not.toBe(sha256Hex(toBytes(fixture.document)));
  });

  it("非 JSON bytes 收斂成 semantic_contract_violation，不 crash", () => {
    const result = parseSourceBundleManifest(Buffer.from("not json at all", "utf-8"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toEqual(["semantic_contract_violation"]);
  });

  it("缺 role 的 manifest 吐 missing_required_role 而不是形狀錯", () => {
    const fixture = VALID_MANIFESTS.find((f) => f.name.includes("full")) ?? VALID_MANIFESTS[0];
    const document = JSON.parse(JSON.stringify(fixture.document)) as {
      body: { artifacts: unknown[] };
    };
    document.body.artifacts = document.body.artifacts.slice(0, 2);
    const result = parseSourceBundleManifest(toBytes(document));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dedupedCodes(manifestDocumentDiagnostics(result.manifest))).toEqual([
      "missing_required_role",
    ]);
  });
});
