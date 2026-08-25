import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isAttemptScopedMinioResultLocation } from "../../src/services/lineage/minioLocator.js";
import { parsePipelineResultManifest } from "../../src/services/lineage/pipelineResultManifest.js";

/**
 * `parsePipelineResultManifest` 對**契約正本語料**的表格測試。
 *
 * 語料來源：`tests/contracts/lineage/fixtures/result_manifest/{valid,invalid,semantic}/`
 * （repo root 的契約正本，本檔唯讀，不得改動）。逐檔驅動是刻意的：手寫的反例只會蓋到
 * 作者想得到的分支，canonical 語料蓋的是**契約 owner 想得到的**分支。
 *
 * 這同時是 P1 的回歸網：`invalid-manifest-offset-published-at.json` 與
 * `invalid-manifest-lowercase-z-artifact-published-at.json` 在修復前會讓 parse 擲
 * `RangeError`（zod v3 欄位級 refine 失敗只標 dirty，object 級 superRefine 仍執行，
 * 於是未校驗字串被餵進 `utcTimestampToMicros`）。下方的 `not.toThrow` 就是那條線的鎖。
 */

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../tests/contracts/lineage/fixtures/result_manifest",
);

interface FixtureCase {
  name: string;
  documentType: string | null;
  /** 餵進 parser 的 envelope（semantic 語料包在 `payload` 之下）。 */
  bytes: Buffer;
}

function loadDirectory(sub: "valid" | "invalid" | "semantic"): FixtureCase[] {
  const dir = path.join(FIXTURE_ROOT, sub);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw = fs.readFileSync(path.join(dir, name), "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // semantic 語料的形狀是 `{payload, expect}`；parser 吃的是 payload 那份 envelope。
      const envelope = (
        sub === "semantic" ? (parsed.payload as Record<string, unknown>) : parsed
      );
      return {
        name,
        documentType:
          typeof envelope.document_type === "string" ? envelope.document_type : null,
        bytes: Buffer.from(JSON.stringify(envelope), "utf-8"),
      };
    });
}

const VALID = loadDirectory("valid");
const INVALID = loadDirectory("invalid");
const SEMANTIC = loadDirectory("semantic");

describe("canonical result_manifest 語料：valid", () => {
  it("語料目錄非空（路徑寫錯時不得靜默變成零案例）", () => {
    expect(VALID.length).toBeGreaterThan(0);
    expect(VALID.filter((item) => item.documentType === "result_manifest")).toHaveLength(6);
  });

  it.each(VALID.map((item) => [item.name, item] as const))(
    "%s",
    (_name, fixture) => {
      let parsed: ReturnType<typeof parsePipelineResultManifest>;
      expect(() => {
        parsed = parsePipelineResultManifest(fixture.bytes);
      }).not.toThrow();

      if (fixture.documentType === "result_manifest") {
        // canonical valid manifest 必須全數被接受——任何新規則誤殺它們都會在這裡變紅。
        expect(parsed!).not.toBeNull();
        expect(parsed!.manifest_schema_version).toBe("result-manifest/v1");
      } else {
        // `result_publication_outcome`／`local_cache_observation` 是同一份 schema 檔的
        // 其他 document_type；本 parser 只認 result_manifest，其餘一律 null（不越權解析）。
        expect(parsed!).toBeNull();
      }
    },
  );
});

describe("canonical result_manifest 語料：invalid", () => {
  it("語料目錄非空", () => {
    expect(INVALID.length).toBeGreaterThan(0);
  });

  it.each(INVALID.map((item) => [item.name, item] as const))(
    "%s",
    (_name, fixture) => {
      // 不得擲例外（typed-error 契約：解析失敗只能回 null）——這是 P1 的機器鎖。
      let parsed: ReturnType<typeof parsePipelineResultManifest>;
      expect(() => {
        parsed = parsePipelineResultManifest(fixture.bytes);
      }).not.toThrow();
      expect(parsed!).toBeNull();
    },
  );
});

describe("canonical result_manifest 語料：semantic", () => {
  it.each(SEMANTIC.map((item) => [item.name, item] as const))(
    "%s",
    (_name, fixture) => {
      let parsed: ReturnType<typeof parsePipelineResultManifest>;
      expect(() => {
        parsed = parsePipelineResultManifest(fixture.bytes);
      }).not.toThrow();
      // 兩支 result_manifest semantic 反例（`manifest_published_before_artifacts` 與
      // `alignment_summary_denominator_mismatch`）都必須被 runtime 擋下；另外三支是
      // `result_publication_outcome`，本 parser 一律不認。
      expect(parsed!).toBeNull();
    },
  );
});

/**
 * **契約 fixture 與 store invariant 的正本矛盾（待契約 owner 裁決）**。
 *
 * `PipelineResultStore.registerResult()` 的 `validateResultLocation` 要求
 * `result_prefix` 末段逐字等於 `attempt_id`（`isAttemptScopedMinioResultLocation`）。
 * 但三支 **canonical valid** result_manifest fixture 的 `result_prefix` 末段是
 * `attempt-0007`，而 `attempt_id` 另有其值——依現行 store 行為它們**無法被註冊**。
 *
 * 處置（依 coordinator 裁決）：**不改 fixtures**、不放寬 store invariant。本測試把矛盾
 * 機器化記錄下來：schema 層接受（上方 valid 表格），location 層拒絕（下方），
 * 兩者同時為真即為矛盾本身。裁決落地後改這裡的期望值即可。
 */
describe("契約 fixture × store invariant 矛盾（記錄用，待裁決）", () => {
  const CONTRADICTING = [
    ["valid-result-manifest-failed-audit-only.json", "attempt-0009"],
    ["valid-result-manifest-cancelled-audit-only.json", "attempt-0010"],
    ["valid-result-manifest-zero-denominator-not-evaluable.json", "attempt-0014"],
  ] as const;

  it.each(CONTRADICTING)(
    "%s：schema 接受但 attempt-scoped 檢查拒絕（attempt_id=%s vs prefix 末段 attempt-0007）",
    (name, expectedAttemptId) => {
      const raw = fs.readFileSync(path.join(FIXTURE_ROOT, "valid", name), "utf-8");
      const envelope = JSON.parse(raw) as {
        body: { attempt_id: string; result_prefix: string };
      };
      const parsed = parsePipelineResultManifest(Buffer.from(raw, "utf-8"));

      expect(parsed).not.toBeNull();
      expect(envelope.body.attempt_id).toBe(expectedAttemptId);
      expect(envelope.body.result_prefix.endsWith("/results/attempt-0007/")).toBe(true);
      expect(
        isAttemptScopedMinioResultLocation({
          resultPrefix: envelope.body.result_prefix,
          attemptId: envelope.body.attempt_id,
          manifestRef: `${envelope.body.result_prefix}result-manifest.json?versionId=v-1`,
        }),
      ).toBe(false);
    },
  );

  it("同組其餘 valid manifest fixture 的 attempt-scoped 檢查為真（矛盾非全面性）", () => {
    for (const name of [
      "valid-result-manifest-full.json",
      "valid-result-manifest-minimal-required-roles.json",
      "valid-result-manifest-succeeded-with-warnings.json",
    ]) {
      const envelope = JSON.parse(
        fs.readFileSync(path.join(FIXTURE_ROOT, "valid", name), "utf-8"),
      ) as { body: { attempt_id: string; result_prefix: string } };
      expect(
        isAttemptScopedMinioResultLocation({
          resultPrefix: envelope.body.result_prefix,
          attemptId: envelope.body.attempt_id,
          manifestRef: `${envelope.body.result_prefix}result-manifest.json?versionId=v-1`,
        }),
        name,
      ).toBe(true);
    }
  });
});
