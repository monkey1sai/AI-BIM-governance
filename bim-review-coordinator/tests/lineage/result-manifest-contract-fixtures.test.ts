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

/**
 * semantic 語料的期望值是**分層**的，不是一律 null。
 *
 * `parsePipelineResultManifest` 只負責 schema 層＋zod 能表達的語意（時序、denominator
 * 綁定）；`result_prefix` 末段是否等於 `attempt_id` 是 **registration 層**的職責
 * （`PipelineResultLocationError` / `result_prefix_not_attempt_scoped`，見
 * `pipeline-result-registration.test.ts`）。2026-08-25 裁決 B：不在 zod 重複同一條
 * 規則——同一條不變式兩個地方各寫一次，遲早會有一邊漂走。
 *
 * 所以每支語料在這一層的期望要逐檔宣告，並附上「被哪一層擋下」的理由。
 */
const SEMANTIC_PARSE_EXPECTATIONS: Record<string, { parsed: boolean; why: string }> = {
  // result_manifest：zod superRefine 擋得下的兩條語意規則。
  "semantic-manifest-before-artifacts.json": {
    parsed: false,
    why: "manifest_published_before_artifacts：zod superRefine 的時序檢查",
  },
  "semantic-summary-mismatch-vs-alignment-report.json": {
    parsed: false,
    why: "alignment_summary_denominator_mismatch：zod superRefine 的 denominator 綁定",
  },
  // result_manifest：zod **不**檢查的 attempt-scoped prefix（registration 層職責）。
  "semantic-result-prefix-not-attempt-scoped.json": {
    parsed: true,
    why: "result_prefix_not_attempt_scoped：schema 層合格，由 registration 層的 isAttemptScopedMinioResultLocation 擋",
  },
  // 其餘三支是 `result_publication_outcome`，本 parser 一律不認（不越權解析）。
  "semantic-publication-resume-same-attempt-no-second-result.json": {
    parsed: false,
    why: "document_type = result_publication_outcome",
  },
  "semantic-same-attempt-different-digest-conflict.json": {
    parsed: false,
    why: "document_type = result_publication_outcome",
  },
  "semantic-same-attempt-same-digest-idempotent.json": {
    parsed: false,
    why: "document_type = result_publication_outcome",
  },
};

describe("canonical result_manifest 語料：semantic", () => {
  it("每一支 semantic 語料都要逐檔登記期望（新語料不得靜默沿用舊預設）", () => {
    expect(SEMANTIC.map((item) => item.name).sort()).toEqual(
      Object.keys(SEMANTIC_PARSE_EXPECTATIONS).sort(),
    );
  });

  it.each(SEMANTIC.map((item) => [item.name, item] as const))(
    "%s",
    (name, fixture) => {
      const expectation = SEMANTIC_PARSE_EXPECTATIONS[name];
      let parsed: ReturnType<typeof parsePipelineResultManifest>;
      expect(() => {
        parsed = parsePipelineResultManifest(fixture.bytes);
      }).not.toThrow();
      if (expectation.parsed) {
        expect(parsed!, expectation.why).not.toBeNull();
      } else {
        expect(parsed!, expectation.why).toBeNull();
      }
    },
  );
});

/**
 * **契約 fixture 與 store invariant 的一致性**（2026-08-25 裁決 B 落地）。
 *
 * `PipelineResultStore.registerResult()` 的 `validateResultLocation` 要求
 * `result_prefix` 末段逐字等於 `attempt_id`（`isAttemptScopedMinioResultLocation`）。
 * 三支 audit-only／zero-denominator 的 **canonical valid** fixture 一度把
 * `result_prefix` 末段留在 `attempt-0007`（複製貼上），與各自的 `attempt_id` 不符——
 * 依 store 行為它們無法被註冊，而契約卻宣稱它們 valid。
 *
 * 裁決 B：**錯在 fixtures**，不放寬 store invariant。fixtures 已修正，並在契約的
 * python 語意層補上同名規則（`semantic_validators.result_prefix_not_attempt_scoped`）
 * 根治，讓語料層先擋，而不是等 coordinator 在註冊時才發現。
 *
 * 本測試因此改成正向斷言：六支 valid manifest fixture 的 schema 層與 location 層
 * **必須同時接受**。任何一支再度漂走都會在這裡變紅。
 */
describe("契約 fixture × store invariant 一致性（2026-08-25 裁決 B 落地）", () => {
  /** 裁決 B 修正的三支：prefix 末段一度停在 attempt-0007。 */
  const REALIGNED = [
    ["valid-result-manifest-failed-audit-only.json", "attempt-0009"],
    ["valid-result-manifest-cancelled-audit-only.json", "attempt-0010"],
    ["valid-result-manifest-zero-denominator-not-evaluable.json", "attempt-0014"],
  ] as const;

  /** 一開始就對齊的三支：這一組原本就是「矛盾非全面性」的證據。 */
  const ALREADY_ALIGNED = [
    "valid-result-manifest-full.json",
    "valid-result-manifest-minimal-required-roles.json",
    "valid-result-manifest-succeeded-with-warnings.json",
  ] as const;

  function readEnvelope(name: string): {
    raw: string;
    body: { attempt_id: string; result_prefix: string };
  } {
    const raw = fs.readFileSync(path.join(FIXTURE_ROOT, "valid", name), "utf-8");
    return { raw, ...(JSON.parse(raw) as { body: { attempt_id: string; result_prefix: string } }) };
  }

  function attemptScoped(body: { attempt_id: string; result_prefix: string }): boolean {
    return isAttemptScopedMinioResultLocation({
      resultPrefix: body.result_prefix,
      attemptId: body.attempt_id,
      manifestRef: `${body.result_prefix}result-manifest.json?versionId=v-1`,
    });
  }

  it.each(REALIGNED)(
    "%s：schema 接受且 attempt-scoped 檢查為真（prefix 末段＝attempt_id＝%s）",
    (name, expectedAttemptId) => {
      const { raw, body } = readEnvelope(name);
      const parsed = parsePipelineResultManifest(Buffer.from(raw, "utf-8"));

      expect(parsed).not.toBeNull();
      expect(body.attempt_id).toBe(expectedAttemptId);
      // 逐字比對末段，而不是只看「有沒有包含」：prefix 落在別的 attempt 之下才是本 bug。
      expect(body.result_prefix.endsWith(`/results/${expectedAttemptId}/`)).toBe(true);
      expect(attemptScoped(body)).toBe(true);
    },
  );

  it.each(ALREADY_ALIGNED)("%s：一開始就對齊，維持為真", (name) => {
    const { body } = readEnvelope(name);
    expect(attemptScoped(body), name).toBe(true);
  });
});
