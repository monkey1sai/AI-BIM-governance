import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmLegacyEnrollment,
  deriveGroupingIdentity,
  LegacyEnrollmentAuthorizationError,
  LegacyEnrollmentNotImplementedError,
  LegacyGroupingAlreadyGovernedError,
  LegacyGroupingKeyError,
  LegacyGroupingNotFoundError,
  previewLegacyGrouping,
  type LegacyEnrollmentDeps,
} from "../../src/services/lineage/legacyEnrollment.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import { fixedNow, TEST_ALLOWLIST, TEST_AUTHORITY, TEST_BUCKET } from "../helpers/governedBundleFixtures.js";

// D-4（preview-only）＋ D-5（authorization minimal gate）。
// preview 的 `mutates_store: false` 用 fake port 的寫入計數器當機器證據，
// 不是靠讀原始碼相信。

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => (data: unknown) => boolean;
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(REPO_ROOT, "tests", "contracts", "model_version_bundle_manifest.json"),
    "utf-8",
  ),
) as Record<string, unknown>;
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

const LEGACY_ROOT = `minio://${TEST_AUTHORITY}/${TEST_BUCKET}/legacy-unmanaged/`;
const GROUPING_KEY = "legacy-project-01/legacy-version-01";
const GROUPING_PREFIX = "legacy-unmanaged/legacy-project-01/legacy-version-01/";

let port: FakeSourceBundleObjectPort;

function deps(overrides: Partial<LegacyEnrollmentDeps> = {}): LegacyEnrollmentDeps {
  return { objects: port, legacyRootPrefix: LEGACY_ROOT, now: fixedNow(), ...overrides };
}

function seedLegacyObject(filename: string, versionId: string): void {
  port.seed({
    authority: TEST_AUTHORITY,
    bucket: TEST_BUCKET,
    objectKey: `${GROUPING_PREFIX}${filename}`,
    versionId,
    bytes: `${filename}-legacy-bytes`,
  });
}

function seedFullLegacyGrouping(): void {
  seedLegacyObject("model.rvt", "v-legacy-rvt");
  seedLegacyObject("schedule.csv", "v-legacy-csv");
  seedLegacyObject("model.ifc", "v-legacy-ifc");
}

beforeEach(() => {
  port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
});

describe("previewLegacyGrouping — 唯讀", () => {
  it("mutates_store 恆 false，且 fake port 的寫入計數器一次都沒動", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(preview.mutates_store).toBe(false);
    expect(port.writeCalls).toBe(0);
    expect(port.getBytesCalls).toBe(0);
    expect(port.sha256Calls).toBe(0);
  });

  it("輸出的文件通過 L1 legacy_unmanaged_preview schema", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(
      ajvValidate({
        schema_version: "model-version-bundle-manifest/v1",
        document_type: "legacy_unmanaged_preview",
        body: preview,
      }),
    ).toBe(true);
  });

  it("state 與 requires_capability 是契約的 const", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(preview.state).toBe("LEGACY_UNMANAGED");
    expect(preview.requires_capability).toBe("bundle.publish");
    expect(preview.observed_at).toBe("2026-07-16T08:00:00.000Z");
  });

  it("candidate artifact 依 role 順序呈現，且帶 version/etag/size 但不帶 sha256", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(preview.candidate_metadata.candidate_artifacts.map((a) => a.role)).toEqual([
      "source_rvt",
      "schedule_csv",
      "source_ifc",
    ]);
    for (const candidate of preview.candidate_metadata.candidate_artifacts) {
      expect(candidate.object_version_id).toMatch(/^v-legacy-/);
      expect(candidate.etag).not.toBeNull();
      expect(candidate.size_bytes).toBeGreaterThan(0);
      expect(candidate).not.toHaveProperty("sha256");
    }
  });

  it("每個候選 artifact 都標 digest_unknown（preview 不讀 bytes 算 SHA-256）", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    const digestUnknown = preview.differences.filter((d) => d.difference_kind === "digest_unknown");
    expect(digestUnknown).toHaveLength(3);
    expect(preview.differences[0]).toEqual({
      field: "manifest.json",
      difference_kind: "missing_manifest",
      candidate_value: null,
      governed_value: "source-bundle-manifest/v1",
    });
  });

  it("湊不齊三個 role 時逐一標 missing_artifact（不得呈現為可升格）", async () => {
    seedLegacyObject("model.rvt", "v-legacy-rvt");
    seedLegacyObject("model.ifc", "v-legacy-ifc");
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    const missing = preview.differences.filter((d) => d.difference_kind === "missing_artifact");
    expect(missing.map((d) => d.governed_value)).toEqual(["schedule_csv"]);
  });

  it("無法歸類與重複 role 的 object 標成 extra_artifact（tie-break = object key 字典序第一）", async () => {
    seedFullLegacyGrouping();
    seedLegacyObject("notes.txt", "v-legacy-notes");
    seedLegacyObject("backup.rvt", "v-legacy-rvt-2");
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    const extras = preview.differences.filter((d) => d.difference_kind === "extra_artifact");
    // `backup.rvt` 字典序在 `model.rvt` 之前 → 它才是 source_rvt 候選，`model.rvt` 落成 extra。
    // 這個 tie-break 是刻意且確定性的（見 previewLegacyGrouping 的註解），不是巧合。
    expect(extras.map((d) => d.field).sort()).toEqual([
      `${GROUPING_PREFIX}model.rvt`,
      `${GROUPING_PREFIX}notes.txt`,
    ]);
    const rvtCandidate = preview.candidate_metadata.candidate_artifacts.find(
      (a) => a.role === "source_rvt",
    );
    expect(rvtCandidate?.ref).toContain("backup.rvt");
  });

  it("tenant_id 不從 object path 猜（tenancy authority 在 external cloud）", async () => {
    seedFullLegacyGrouping();
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(preview.candidate_metadata.tenant_id).toBeNull();
    expect(preview.candidate_metadata.project_id).toBe("legacy-project-01");
    expect(preview.candidate_metadata.external_model_version_id).toBe("legacy-version-01");
  });

  it("grouping 已有 manifest.json → 409，它不是 LEGACY_UNMANAGED", async () => {
    seedFullLegacyGrouping();
    seedLegacyObject("manifest.json", "v-legacy-manifest");
    await expect(previewLegacyGrouping(GROUPING_KEY, deps())).rejects.toBeInstanceOf(
      LegacyGroupingAlreadyGovernedError,
    );
  });

  it("零個可辨識候選 → 404（不吐 schema-invalid 的空 preview）", async () => {
    seedLegacyObject("readme.txt", "v-legacy-readme");
    await expect(previewLegacyGrouping(GROUPING_KEY, deps())).rejects.toBeInstanceOf(
      LegacyGroupingNotFoundError,
    );
  });

  it("prefix boundary 對齊：相鄰 grouping 的 object 不得被吸進來", async () => {
    seedFullLegacyGrouping();
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "legacy-unmanaged/legacy-project-01/legacy-version-011/model.rvt",
      versionId: "v-neighbour",
      bytes: "neighbour",
    });
    const preview = await previewLegacyGrouping(GROUPING_KEY, deps());
    expect(preview.candidate_metadata.candidate_artifacts).toHaveLength(3);
    for (const candidate of preview.candidate_metadata.candidate_artifacts) {
      expect(candidate.ref).toContain(GROUPING_PREFIX);
    }
  });

  it("allowlist fail-closed 也套用在 preview", async () => {
    seedFullLegacyGrouping();
    const closed = createFakeSourceBundleObjectPort({
      allowedAuthorities: [],
      allowedBuckets: [],
    });
    closed.objects = port.objects;
    await expect(
      previewLegacyGrouping(GROUPING_KEY, deps({ objects: closed })),
    ).rejects.toThrow(/allowlist/);
  });
});

describe("deriveGroupingIdentity — 路徑穿越形狀 fail closed", () => {
  it("沿用 專案/種類/版本 約定", () => {
    expect(deriveGroupingIdentity("proj/cat/ver")).toEqual({
      project_id: "proj",
      project_display_name: "proj",
      model_category: "cat",
      external_model_version_id: "ver",
    });
  });

  it("兩段時沒有種類", () => {
    expect(deriveGroupingIdentity("proj/ver").model_category).toBeNull();
  });

  it.each([["../etc"], ["proj/../ver"], ["proj//ver"], ["proj/./ver"], ["only-one"], [""]])(
    "拒絕不合法的 grouping key %s",
    (key) => {
      expect(() => deriveGroupingIdentity(key)).toThrow(LegacyGroupingKeyError);
    },
  );

  it("拒絕帶換行的 grouping key", () => {
    expect(() => deriveGroupingIdentity("proj/ver\n")).toThrow(LegacyGroupingKeyError);
  });
});

describe("confirmLegacyEnrollment — D-5 授權 gate 先於 D-4 未實作", () => {
  it("缺 authorization_decision_ref → 403 fail closed", async () => {
    await expect(
      confirmLegacyEnrollment(
        {
          groupingKey: GROUPING_KEY,
          confirmedBySubject: "subject:operator-test",
          authorizationDecisionRef: "",
        },
        deps(),
      ),
    ).rejects.toMatchObject({
      name: "LegacyEnrollmentAuthorizationError",
      code: "authorization_decision_ref_required",
      httpStatus: 403,
    });
  });

  it("缺 confirmed_by_subject → 403", async () => {
    await expect(
      confirmLegacyEnrollment(
        {
          groupingKey: GROUPING_KEY,
          confirmedBySubject: "   ",
          authorizationDecisionRef: "authz-decision-test-0001",
        },
        deps(),
      ),
    ).rejects.toBeInstanceOf(LegacyEnrollmentAuthorizationError);
  });

  it("缺 grouping key → 400（不是 403，也不是 501）", async () => {
    await expect(
      confirmLegacyEnrollment(
        {
          groupingKey: "",
          confirmedBySubject: "subject:operator-test",
          authorizationDecisionRef: "authz-decision-test-0001",
        },
        deps(),
      ),
    ).rejects.toBeInstanceOf(LegacyGroupingKeyError);
  });

  it("授權齊備後仍 501 awaiting owner carve-out（D-4 preview-only）", async () => {
    seedFullLegacyGrouping();
    await expect(
      confirmLegacyEnrollment(
        {
          groupingKey: GROUPING_KEY,
          confirmedBySubject: "subject:operator-test",
          authorizationDecisionRef: "authz-decision-test-0001",
        },
        deps(),
      ),
    ).rejects.toMatchObject({
      name: "LegacyEnrollmentNotImplementedError",
      code: "legacy_enrollment_awaiting_owner_carve_out",
      httpStatus: 501,
    });
  });

  it("被拒絕的 confirm 完全沒有寫入 MinIO", async () => {
    seedFullLegacyGrouping();
    const before = port.objects.length;
    await expect(
      confirmLegacyEnrollment(
        {
          groupingKey: GROUPING_KEY,
          confirmedBySubject: "subject:operator-test",
          authorizationDecisionRef: "authz-decision-test-0001",
        },
        deps(),
      ),
    ).rejects.toBeInstanceOf(LegacyEnrollmentNotImplementedError);
    expect(port.writeCalls).toBe(0);
    expect(port.objects).toHaveLength(before);
  });
});
