import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmLegacyEnrollment,
  deriveGroupingIdentity,
  LEGACY_ENROLLMENT_ID_PREFIX,
  LEGACY_ENROLLMENT_UNASSIGNED_TENANT_ID,
  legacyEnrollmentSourceBundleId,
  LegacyEnrollmentAuthorizationError,
  LegacyEnrollmentIncompleteError,
  LegacyGroupingAlreadyGovernedError,
  LegacyGroupingKeyError,
  LegacyGroupingNotFoundError,
  previewLegacyGrouping,
  type LegacyEnrollmentConfirmDeps,
  type LegacyEnrollmentDeps,
} from "../../src/services/lineage/legacyEnrollment.js";
import { SourceBundleStore } from "../../src/services/lineage/sourceBundleStore.js";
import { validateSourceBundle } from "../../src/services/lineage/sourceBundleValidator.js";
import { SourceBundleWriteScopeError } from "../../src/services/lineage/sourceBundleObjectPort.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import { fixedNow, TEST_ALLOWLIST, TEST_AUTHORITY, TEST_BUCKET } from "../helpers/governedBundleFixtures.js";

// preview 的 `mutates_store: false`、以及 confirm 的「只寫一個 manifest.json」，
// 都用 fake port 的寫入計數器與 object 清單當機器證據，不是靠讀原始碼相信。
//
// confirm 的測試刻意接上**真的** `SourceBundleStore` 與**真的** `validateSourceBundle`：
// 這條路徑的價值就在於「寫完之後由 MinIO 重讀重驗才決定 bundle_state」，用假的
// validator 會把要證明的東西假設掉。

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

const MANIFEST_OBJECT_KEY = `${GROUPING_PREFIX}manifest.json`;
const SUBJECT = "subject:operator-test";
const DECISION_REF = "decision://governance-console/authz-decision-test-0001";

let port: FakeSourceBundleObjectPort;
let store: SourceBundleStore;

function deps(overrides: Partial<LegacyEnrollmentDeps> = {}): LegacyEnrollmentDeps {
  return { objects: port, legacyRootPrefix: LEGACY_ROOT, now: fixedNow(), ...overrides };
}

/** confirm deps：接真 store ＋ 真 validator（重驗不是被假設出來的）。 */
function confirmDeps(
  overrides: Partial<LegacyEnrollmentConfirmDeps> = {},
): LegacyEnrollmentConfirmDeps {
  return {
    objects: port,
    legacyRootPrefix: LEGACY_ROOT,
    now: fixedNow(),
    store,
    validator: validateSourceBundle,
    sha256Mode: "full",
    ...overrides,
  };
}

function confirmInput(overrides: Record<string, string> = {}) {
  return {
    groupingKey: GROUPING_KEY,
    confirmedBySubject: SUBJECT,
    authorizationDecisionRef: DECISION_REF,
    ...overrides,
  };
}

function writtenManifestDocument(): Record<string, unknown> {
  const stored = port.objects.find((object) => object.objectKey === MANIFEST_OBJECT_KEY);
  if (!stored) throw new Error("no manifest.json was written to the fake store");
  return JSON.parse(stored.bytes.toString("utf-8")) as Record<string, unknown>;
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
  // persistencePath = null → 純記憶體，測試之間不共用磁碟狀態。
  store = new SourceBundleStore(null);
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

describe("confirmLegacyEnrollment — D-5 授權 gate 先於任何 MinIO 動作", () => {
  it("缺 authorization_decision_ref → 403 fail closed", async () => {
    await expect(
      confirmLegacyEnrollment(confirmInput({ authorizationDecisionRef: "" }), confirmDeps()),
    ).rejects.toMatchObject({
      name: "LegacyEnrollmentAuthorizationError",
      code: "authorization_decision_ref_required",
      httpStatus: 403,
    });
  });

  it("缺 confirmed_by_subject → 403", async () => {
    await expect(
      confirmLegacyEnrollment(confirmInput({ confirmedBySubject: "   " }), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyEnrollmentAuthorizationError);
  });

  it("缺 grouping key → 400（不是 403）", async () => {
    await expect(
      confirmLegacyEnrollment(confirmInput({ groupingKey: "" }), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyGroupingKeyError);
  });

  it("授權 gate 擋下的 confirm 對 MinIO 零寫入、store 零紀錄", async () => {
    seedFullLegacyGrouping();
    const before = port.objects.length;
    await expect(
      confirmLegacyEnrollment(confirmInput({ authorizationDecisionRef: "" }), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyEnrollmentAuthorizationError);
    expect(port.writeCalls).toBe(0);
    expect(port.objects).toHaveLength(before);
    expect(store.list()).toEqual([]);
  });
});

describe("confirmLegacyEnrollment — conditional create（owner carve-out 2026-08-20）", () => {
  it("created：回傳 L1-conformant confirmation，id 非 null 且 retryable false", async () => {
    seedFullLegacyGrouping();
    const confirmation = await confirmLegacyEnrollment(confirmInput(), confirmDeps());

    expect(confirmation.conditional_create.outcome).toBe("created");
    expect(confirmation.created_source_bundle_id).toBe(
      legacyEnrollmentSourceBundleId(GROUPING_KEY),
    );
    expect(confirmation.retryable).toBe(false);
    expect(confirmation.capability).toBe("bundle.publish");
    expect(confirmation.authorization_decision_ref).toBe(DECISION_REF);
    expect(confirmation.confirmed_at).toBe("2026-07-16T08:00:00.000Z");
    expect(
      ajvValidate({
        schema_version: "model-version-bundle-manifest/v1",
        document_type: "legacy_enrollment_confirmation",
        body: confirmation,
      }),
    ).toBe(true);
  });

  it("carve-out 的機器證據：整條路徑只寫一次，且寫的是 `.../manifest.json`", async () => {
    seedFullLegacyGrouping();
    const before = port.objects.length;
    await confirmLegacyEnrollment(confirmInput(), confirmDeps());

    expect(port.writeCalls).toBe(1);
    expect(port.objects).toHaveLength(before + 1);
    const written = port.objects[port.objects.length - 1];
    expect(written.objectKey).toBe(MANIFEST_OBJECT_KEY);
    expect(written.objectKey.endsWith("/manifest.json")).toBe(true);
  });

  it("寫進 MinIO 的 manifest.json 通過 L1 source_bundle_manifest schema", async () => {
    seedFullLegacyGrouping();
    await confirmLegacyEnrollment(confirmInput(), confirmDeps());

    const document = writtenManifestDocument();
    expect(ajvValidate(document)).toBe(true);
    expect(document.document_type).toBe("source_bundle_manifest");
    const body = document.body as Record<string, unknown>;
    expect(body.producer).toEqual({ producer_id: SUBJECT, producer_kind: "legacy_enrollment" });
    expect(body.external_model_version_id).toBe("legacy-version-01");
    expect(body.project_id).toBe("legacy-project-01");
    // tenancy authority 在 external cloud：manifest 不從 object path 猜 tenant。
    expect(body).not.toHaveProperty("tenant_id");
    const artifacts = body.artifacts as Array<Record<string, unknown>>;
    expect(artifacts.map((artifact) => artifact.role)).toEqual([
      "source_rvt",
      "schedule_csv",
      "source_ifc",
    ]);
    // preview 標 digest_unknown；confirm 才真的讀 bytes 算 SHA-256。
    for (const artifact of artifacts) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(port.sha256Calls).toBeGreaterThanOrEqual(3);
  });

  it("並行升格：視野停在寫入之前的第二位 operator 拿到 conflict ＋ retryable，且不覆寫", async () => {
    seedFullLegacyGrouping();
    // 第二位 operator 的 preview 發生在第一位寫入**之前**——這正是 conditional create
    // 存在的理由。用「凍結的 list 視野」精確重現這個交錯，而不是靠 Promise 排程碰運氣。
    const prefix = `${LEGACY_ROOT}legacy-project-01/legacy-version-01/`;
    const staleListing = await port.listObjectsUnder(prefix);
    const staleView: FakeSourceBundleObjectPort = {
      ...port,
      async listObjectsUnder() {
        return staleListing;
      },
    };

    const first = await confirmLegacyEnrollment(confirmInput(), confirmDeps());
    const firstDocument = writtenManifestDocument();
    const objectsAfterFirst = port.objects.length;

    const second = await confirmLegacyEnrollment(
      confirmInput({
        confirmedBySubject: "subject:operator-second",
        authorizationDecisionRef: "decision://governance-console/authz-decision-test-0002",
      }),
      confirmDeps({ objects: staleView }),
    );

    expect(first.conditional_create.outcome).toBe("created");
    expect(second.conditional_create.outcome).toBe("conflict_existing_manifest");
    expect(second.created_source_bundle_id).toBeNull();
    expect(second.retryable).toBe(true);
    expect(
      ajvValidate({
        schema_version: "model-version-bundle-manifest/v1",
        document_type: "legacy_enrollment_confirmation",
        body: second,
      }),
    ).toBe(true);
    // 輸家 MUST NOT 覆寫：object 數量不變，內容仍是第一位 operator 的 manifest。
    expect(port.objects).toHaveLength(objectsAfterFirst);
    expect(writtenManifestDocument()).toEqual(firstDocument);
    expect(store.list()).toHaveLength(1);
  });

  it("真並行（Promise.all）：不論交錯順序，恰好一份 manifest、一筆紀錄、一個 created", async () => {
    seedFullLegacyGrouping();
    const settled = await Promise.allSettled([
      confirmLegacyEnrollment(confirmInput(), confirmDeps()),
      confirmLegacyEnrollment(
        confirmInput({ confirmedBySubject: "subject:operator-second" }),
        confirmDeps(),
      ),
    ]);

    const fulfilled = settled.filter((result) => result.status === "fulfilled");
    const createdCount = fulfilled.filter(
      (result) =>
        (result as PromiseFulfilledResult<Awaited<ReturnType<typeof confirmLegacyEnrollment>>>)
          .value.conditional_create.outcome === "created",
    ).length;
    // 輸家可能在 preview 就被擋（already governed）也可能在 conditional create 才輸；
    // 兩者都是「沒有覆寫」。唯一不可接受的是兩個都 created。
    expect(createdCount).toBe(1);
    expect(port.objects.filter((object) => object.objectKey.endsWith("/manifest.json"))).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
  });

  it("created 後才落 store 紀錄，且 bundle_state 由重驗決定（不自我背書）", async () => {
    seedFullLegacyGrouping();
    const confirmation = await confirmLegacyEnrollment(confirmInput(), confirmDeps());
    const record = store.get(confirmation.created_source_bundle_id ?? "");

    expect(record).not.toBeNull();
    expect(record?.bundle_state).toBe("READY");
    expect(record?.integrity_diagnostics).toEqual([]);
    expect(record?.producer_kind).toBe("legacy_enrollment");
    expect(record?.producer_id).toBe(SUBJECT);
    expect(record?.project_id).toBe("legacy-project-01");
    // tenancy authority 在 external cloud → 自我描述的 sentinel，不是憑空猜的 tenant。
    expect(record?.tenant_id).toBe(LEGACY_ENROLLMENT_UNASSIGNED_TENANT_ID);
    // 3.2 才綁 job；本路徑不偽造。
    expect(record?.pipeline_job_id).toBeNull();
    expect(record?.manifest_ref).toContain(`${MANIFEST_OBJECT_KEY}?versionId=`);
  });

  it("降檔模式（size_etag_only）→ 紀錄誠實為 NON_READY ＋ 診斷，不因為是自己寫的就宣告 READY", async () => {
    seedFullLegacyGrouping();
    const confirmation = await confirmLegacyEnrollment(
      confirmInput(),
      confirmDeps({ sha256Mode: "size_etag_only" }),
    );
    // MinIO 端的事實仍是 created —— 降檔影響的是 READY 宣告，不是寫入是否發生。
    expect(confirmation.conditional_create.outcome).toBe("created");
    const record = store.get(confirmation.created_source_bundle_id ?? "");
    expect(record?.bundle_state).toBe("NON_READY");
    expect(record?.integrity_diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it("source_bundle_id 是 grouping key 的確定性函式（並行時兩邊算出同一個身分）", () => {
    const id = legacyEnrollmentSourceBundleId(GROUPING_KEY);
    expect(id).toBe(legacyEnrollmentSourceBundleId(GROUPING_KEY));
    expect(id.startsWith(LEGACY_ENROLLMENT_ID_PREFIX)).toBe(true);
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(legacyEnrollmentSourceBundleId("other/grouping")).not.toBe(id);
  });
});

describe("confirmLegacyEnrollment — 寫入前的 fail-closed", () => {
  it("grouping 已 governed → 409，且零寫入（preview 的判定同樣適用於 confirm）", async () => {
    seedFullLegacyGrouping();
    seedLegacyObject("manifest.json", "v-legacy-manifest");
    await expect(
      confirmLegacyEnrollment(confirmInput(), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyGroupingAlreadyGovernedError);
    expect(port.writeCalls).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("零候選 artifact → 404，且零寫入", async () => {
    seedLegacyObject("readme.txt", "v-legacy-readme");
    await expect(
      confirmLegacyEnrollment(confirmInput(), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyGroupingNotFoundError);
    expect(port.writeCalls).toBe(0);
  });

  it("湊不齊三個 role → 422，且**在寫入之前**擋下（不把 grouping 用壞 manifest 鎖死）", async () => {
    seedLegacyObject("model.rvt", "v-legacy-rvt");
    seedLegacyObject("model.ifc", "v-legacy-ifc");
    await expect(confirmLegacyEnrollment(confirmInput(), confirmDeps())).rejects.toMatchObject({
      name: "LegacyEnrollmentIncompleteError",
      code: "legacy_grouping_incomplete_for_governance",
      httpStatus: 422,
    });
    expect(port.writeCalls).toBe(0);
    expect(port.objects.some((object) => object.objectKey.endsWith("/manifest.json"))).toBe(false);
  });

  it("0-byte artifact → 422（契約合法的 manifest 湊不出來）", async () => {
    seedLegacyObject("model.rvt", "v-legacy-rvt");
    seedLegacyObject("schedule.csv", "v-legacy-csv");
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: `${GROUPING_PREFIX}model.ifc`,
      versionId: "v-legacy-ifc",
      bytes: "",
      etag: "etag-empty",
    });
    await expect(
      confirmLegacyEnrollment(confirmInput(), confirmDeps()),
    ).rejects.toBeInstanceOf(LegacyEnrollmentIncompleteError);
    expect(port.writeCalls).toBe(0);
  });

  it("artifact 在 preview 之後消失 → 422 TOCTOU fail closed（confirm 重新 HEAD，不信舊 preview）", async () => {
    seedFullLegacyGrouping();
    const vanishing: FakeSourceBundleObjectPort = {
      ...port,
      async headVersioned(ref) {
        return ref.objectKey.endsWith("model.ifc") ? null : port.headVersioned(ref);
      },
    };
    await expect(
      confirmLegacyEnrollment(confirmInput(), confirmDeps({ objects: vanishing })),
    ).rejects.toBeInstanceOf(LegacyEnrollmentIncompleteError);
    expect(port.writeCalls).toBe(0);
  });

  it("allowlist fail-closed 同樣套用在 confirm（寫入面不得比讀取面寬）", async () => {
    seedFullLegacyGrouping();
    const closed = createFakeSourceBundleObjectPort({
      allowedAuthorities: [],
      allowedBuckets: [],
    });
    closed.objects = port.objects;
    await expect(
      confirmLegacyEnrollment(confirmInput(), confirmDeps({ objects: closed })),
    ).rejects.toThrow(/allowlist/);
    expect(closed.writeCalls).toBe(0);
  });

  it("carve-out 的 key gate 是 port 層強制：非 manifest.json 的 conditional create 直接拋錯", async () => {
    await expect(
      port.putIfAbsent(
        { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: `${GROUPING_PREFIX}model.rvt` },
        Buffer.from("not a manifest"),
        "application/octet-stream",
      ),
    ).rejects.toBeInstanceOf(SourceBundleWriteScopeError);
    expect(port.objects.some((object) => object.objectKey.endsWith("model.rvt"))).toBe(false);
  });
});
