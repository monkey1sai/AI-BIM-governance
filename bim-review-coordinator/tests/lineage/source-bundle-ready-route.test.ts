import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig, type CoordinatorConfig } from "../../src/config.js";
import { IntranetDevAuthProvider } from "../../src/services/authProvider.js";
import type { LineageSourceBundleRouteDeps } from "../../src/routes/lineageSourceBundleRoutes.js";
import type { SourceBundleRecord } from "../../src/services/lineage/sourceBundleStore.js";
import type { BundleValidationResult } from "../../src/services/lineage/sourceBundleValidator.js";
import {
  createFakeSourceBundleObjectPort,
  createFakeSourceBundleStore,
  createFakeStructLogger,
  createLineageTestApp,
  createStubValidator,
  legacyPreviewFor,
  readyResultFor,
  type FakeSourceBundleObjectPort,
  type FakeSourceBundleStore,
  type ValidatorClaim,
} from "../helpers/fakeSourceBundleDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.1 —— governed source-bundle **route 契約**測試。
 *
 * 契約權威 = repo-root `tests/contracts/source_bundle_ready.json` 與其 L1 fixtures
 * （`tests/contracts/lineage/fixtures/source_bundle_ready/{valid,invalid}`）。
 * 本檔直接吃那些 fixture，不手抄 payload——手抄等於在測試裡複製一份會漂移的契約。
 *
 * 測的是 route 層：transport auth 映射、wire 形狀拒絕、重驗結果 → 狀態碼、冪等 admit、
 * fail-closed 守衛、L1 envelope 形狀。MinIO 重驗與 store 持久化本身屬 worker I 的檔。
 */

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  TEST_DIR,
  "..",
  "..",
  "..",
  "tests",
  "contracts",
  "lineage",
  "fixtures",
  "source_bundle_ready",
);

function readFixture(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_ROOT, relativePath), "utf-8"),
  ) as Record<string, unknown>;
}

const VALID_MINIMAL = readFixture(path.join("valid", "valid-source-bundle-ready-minimal.json"));
const VALID_FULL = readFixture(path.join("valid", "valid-source-bundle-ready-full.json"));
const INVALID_FIXTURE_NAMES = fs
  .readdirSync(path.join(FIXTURE_ROOT, "invalid"))
  .filter((name) => name.endsWith(".json"))
  .sort();

const WEBHOOK_SECRET = "dev-webhook-secret"; // = config 預設（環境設定，非契約資料）

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(VALID_MINIMAL), ...overrides };
}

function authHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Webhook-Secret": WEBHOOK_SECRET,
    "X-Correlation-Id": "corr-source-bundle-0003",
    "X-Idempotency-Key": "idem-source-bundle-0003",
    ...overrides,
  };
}

interface Harness {
  app: express.Express;
  store: FakeSourceBundleStore;
  objects: FakeSourceBundleObjectPort | null;
  logs: ReturnType<typeof createFakeStructLogger>;
  ipRejections: number;
}

function makeHarness(
  options: {
    respond?: (claim: ValidatorClaim) => BundleValidationResult | Promise<BundleValidationResult>;
    objects?: FakeSourceBundleObjectPort | null;
    enqueue?: (record: SourceBundleRecord) => Promise<string>;
    previewLegacy?: LineageSourceBundleRouteDeps["previewLegacy"];
    rejectIp?: boolean;
    ipAllowlist?: string[];
    configOverrides?: Partial<CoordinatorConfig>;
  } = {},
): Harness {
  const store = createFakeSourceBundleStore();
  const logs = createFakeStructLogger();
  const objects =
    options.objects === undefined ? createFakeSourceBundleObjectPort() : options.objects;
  const config = loadConfig({
    governedSourcePrefix: "source-bundles/",
    sourceBundleSha256VerifyMode: "full",
    ...options.configOverrides,
  });
  const harness: Harness = {
    app: express(),
    store,
    objects,
    logs,
    ipRejections: 0,
  };
  harness.app = createLineageTestApp({
    config,
    authProvider: new IntranetDevAuthProvider(
      WEBHOOK_SECRET,
      options.ipAllowlist ?? ["127.0.0.1", "::1"],
    ),
    store: store.asStore(),
    validator: createStubValidator(options.respond ?? ((claim) => readyResultFor(claim))),
    objects,
    enqueue: options.enqueue,
    rejectIfIpNotAllowed: (_request, response) => {
      if (!options.rejectIp) return false;
      harness.ipRejections += 1;
      response.status(403).json({ detail: "caller ip not allowed" });
      return true;
    },
    structLog: logs.logger,
    previewLegacy: options.previewLegacy,
  });
  return harness;
}

describe("POST /api/external/source-bundles/ready — transport auth（沿用 ifc-ready 慣例）", () => {
  it("缺 X-Webhook-Secret / X-Webhook-Signature → 401", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set({ "X-Correlation-Id": "c", "X-Idempotency-Key": "i" })
      .send(payload());
    expect(response.status).toBe(401);
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("錯誤 secret → 401", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders({ "X-Webhook-Secret": "wrong-secret-value" }))
      .send(payload());
    expect(response.status).toBe(401);
  });

  it("缺 X-Idempotency-Key → 401（transport header 由 authProvider 強制）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set({ "X-Webhook-Secret": WEBHOOK_SECRET, "X-Correlation-Id": "c" })
      .send(payload());
    expect(response.status).toBe(401);
  });

  it("caller IP 不在 allowlist → 403（authProvider 的 IP 守門）", async () => {
    const harness = makeHarness({ ipAllowlist: ["10.9.9.9"] });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(403);
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("auth 先於 payload 驗證：未通過 auth 的 malformed payload 不換到 schema 診斷", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set({ "X-Correlation-Id": "c", "X-Idempotency-Key": "i" })
      .send(payload({ event: "not_source_bundle_ready" }));
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty("pointer");
  });
});

describe("POST /api/external/source-bundles/ready — wire payload（逐字對齊 L1 contract）", () => {
  it.each(INVALID_FIXTURE_NAMES)("L1 invalid fixture %s → 400", async (name) => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(readFixture(path.join("invalid", name)));
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_payload");
    expect(typeof response.body.reason).toBe("string");
    expect(typeof response.body.pointer).toBe("string");
    // 形狀不合的 claim 一律不得進入重驗／store。
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("cloud publication 欄位出現 → forbidden_cloud_field（dual-authority ban 的精確原因）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(readFixture(path.join("invalid", "invalid-cloud-publication-fields-present.json")));
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("forbidden_cloud_field");
  });

  it("legacy callback_url 出現 → forbidden_cloud_field（governed intake 不是 legacy 回呼面）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(readFixture(path.join("invalid", "invalid-legacy-callback-url-present.json")));
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("forbidden_cloud_field");
    expect(response.body.pointer).toBe("/callback_url");
  });

  it("presigned manifest locator → presigned_locator_forbidden", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(readFixture(path.join("invalid", "invalid-manifest-ref-presigned.json")));
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("presigned_locator_forbidden");
    expect(response.body.pointer).toBe("/manifest_ref/ref");
  });

  it("未知欄位 → unexpected_field（additionalProperties:false）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload({ extra_field: "nope" }));
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("unexpected_field");
    expect(response.body.pointer).toBe("/extra_field");
  });

  it("calendar-invalid claimed_at（2026-02-30）→ 400（pattern 過得了，runtime 必須擋）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload({ claimed_at: "2026-02-30T07:58:20.000Z" }));
    expect(response.status).toBe(400);
    expect(response.body.reason).toBe("invalid_calendar_date");
  });

  it("結尾換行的 timestamp → 400（JSON Schema `$` 的已知 quirk，runtime 絕對錨定）", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload({ claimed_at: "2026-07-16T07:58:20.000Z\n" }));
    expect(response.status).toBe(400);
    expect(response.body.pointer).toBe("/claimed_at");
  });

  it("L1 valid full fixture（含 optional 欄位）通過 wire 驗證並進入重驗", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders({ "X-Correlation-Id": "corr-source-bundle-0004", "X-Idempotency-Key": "idem-source-bundle-0004" }))
      .send(structuredClone(VALID_FULL));
    expect(response.status).toBe(202);
    expect(harness.store.admitInputs[0].project_display_name).toBe(
      VALID_FULL.project_display_name,
    );
    expect(harness.store.admitInputs[0].model_category).toBe(VALID_FULL.model_category);
  });
});

describe("POST /api/external/source-bundles/ready — 重驗結果 → 狀態碼", () => {
  it("governed MinIO 未設定 → 503（claim 不得被當成 READY）", async () => {
    const harness = makeHarness({ objects: null });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("governed_source_store_unconfigured");
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("READY → 202 ＋ L1 envelope；identity 取 manifest 實讀值而非 claim", async () => {
    const harness = makeHarness({
      respond: (claim) =>
        readyResultFor(claim, { external_model_version_id: "model-version-from-manifest" }),
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(202);
    expect(response.body.schema_version).toBe("model-version-bundle-manifest/v1");
    expect(response.body.document_type).toBe("source_bundle_validation_result");
    expect(response.body.body.bundle_state).toBe("READY");
    expect(response.body.body.replay).toBe(false);
    expect(response.body.body.integrity_diagnostics).toEqual([]);
    // 3.1 不注入 enqueue → 誠實 null，不偽造 pipeline job。
    expect(response.body.body.enqueued_pipeline_job_id).toBeNull();
    // claim 非權威：store 收到的 external_model_version_id 來自 validator（manifest 實讀）。
    expect(harness.store.admitInputs[0].external_model_version_id).toBe(
      "model-version-from-manifest",
    );
    expect(harness.store.admitInputs[0].pipeline_job_id).toBeNull();
  });

  it("同 id 同 digest 重放 → 200 ＋ replay:true（冪等鍵是 source_bundle_id）", async () => {
    const harness = makeHarness();
    const first = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(first.status).toBe(202);
    // 換一組 transport header（不同 X-Idempotency-Key）仍必須被視為同一 bundle 的重放：
    // governed 去重空間是 source_bundle_id，不是 header 冪等鍵。
    const second = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders({ "X-Idempotency-Key": "idem-different-transport-key" }))
      .send(payload());
    expect(second.status).toBe(200);
    expect(second.body.body.replay).toBe(true);
    expect(second.body.body.bundle_state).toBe("READY");
  });

  it("同 id 異 digest → 409 ＋ immutable_bundle_overwrite_rejected（READY 後不可變）", async () => {
    const otherDigest = "a".repeat(64);
    const harness = makeHarness();
    await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    const conflicting = payload({
      manifest_sha256: otherDigest,
      manifest_ref: {
        ...(structuredClone(VALID_MINIMAL).manifest_ref as Record<string, unknown>),
        sha256: otherDigest,
      },
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(conflicting);
    expect(response.status).toBe(409);
    const body = response.body.body as BundleValidationResult;
    // 文件必須自洽：帶診斷就不能還宣稱 READY（L1 allOf）。
    expect(body.bundle_state).toBe("NON_READY");
    expect(body.enqueued_pipeline_job_id).toBeNull();
    expect(body.conditional_create.outcome).toBe("conflict_different_digest");
    expect(body.integrity_diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "immutable_bundle_overwrite_rejected",
    );
  });

  it("重驗推翻 claim（claim digest ≠ MinIO 實讀）→ 422 ＋ diagnostics，且不入 store", async () => {
    const harness = makeHarness({
      respond: (claim) =>
        readyResultFor(claim, {
          bundle_state: "NON_READY",
          manifest_sha256: "b".repeat(64),
          conditional_create: { attempted: false, outcome: "not_attempted" },
          integrity_diagnostics: [
            {
              code: "manifest_digest_conflict",
              role: null,
              expected: claim.manifest_sha256,
              observed: "b".repeat(64),
              detail: "claimed digest does not match the manifest read from MinIO",
            },
          ],
        }),
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(422);
    expect(response.body.document_type).toBe("source_bundle_validation_result");
    expect(response.body.body.bundle_state).toBe("NON_READY");
    expect(response.body.body.enqueued_pipeline_job_id).toBeNull();
    expect(response.body.body.integrity_diagnostics[0].code).toBe("manifest_digest_conflict");
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("validator 回 READY 但 conditional_create 不合 L1 → fail-closed 500，不送出違約文件", async () => {
    const harness = makeHarness({
      respond: (claim) =>
        readyResultFor(claim, { conditional_create: { attempted: false, outcome: "not_attempted" } }),
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(500);
    expect(harness.store.admitInputs).toHaveLength(0);
  });

  it("validator 回 READY 但沒有 manifest digest → fail-closed 500", async () => {
    const harness = makeHarness({
      respond: (claim) => readyResultFor(claim, { manifest_sha256: null }),
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(500);
  });

  it("注入 enqueue（task 3.2）→ 回填 pipeline_job_id 並綁定 store", async () => {
    const harness = makeHarness({
      enqueue: async () => "pipeline_job_test_0001",
    });
    const response = await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    expect(response.status).toBe(202);
    expect(response.body.body.enqueued_pipeline_job_id).toBe("pipeline_job_test_0001");
    expect(harness.store.bindCalls).toEqual([
      { sourceBundleId: "source-bundle-0003", pipelineJobId: "pipeline_job_test_0001" },
    ]);
  });
});

describe("governed 讀取面（list / detail / shadow）", () => {
  async function seededHarness(): Promise<Harness> {
    const harness = makeHarness();
    await request(harness.app)
      .post("/api/external/source-bundles/ready")
      .set(authHeaders())
      .send(payload());
    return harness;
  }

  it("GET /api/external/source-bundles → count ＋ items", async () => {
    const harness = await seededHarness();
    const response = await request(harness.app).get("/api/external/source-bundles");
    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
    expect(response.body.items[0].source_bundle_id).toBe("source-bundle-0003");
  });

  it("GET /api/external/source-bundles/:id → 投影 validation_summary，不重建單次 claim 事實", async () => {
    const harness = await seededHarness();
    const response = await request(harness.app).get(
      "/api/external/source-bundles/source-bundle-0003",
    );
    expect(response.status).toBe(200);
    expect(response.body.source_bundle.bundle_state).toBe("READY");
    expect(response.body.validation_summary.manifest_sha256).toBe(VALID_MINIMAL.manifest_sha256);
    // `replay` / `conditional_create` 是單次 claim 的事實，GET 不得捏造。
    expect(response.body.validation_summary).not.toHaveProperty("replay");
    expect(response.body.validation_summary).not.toHaveProperty("conditional_create");
  });

  it("未知 id → 404；不合法 id → 400", async () => {
    const harness = await seededHarness();
    expect((await request(harness.app).get("/api/external/source-bundles/no-such-bundle")).status).toBe(404);
    expect((await request(harness.app).get("/api/external/source-bundles/bad%20id")).status).toBe(400);
  });

  it("GET /:id/shadow → governed shadow（獨立於 legacy 12 欄），並宣告 control-plane 權威歸屬", async () => {
    const harness = await seededHarness();
    const response = await request(harness.app).get(
      "/api/external/source-bundles/source-bundle-0003/shadow",
    );
    expect(response.status).toBe(200);
    const shadow = response.body.governed_shadow_metadata;
    expect(shadow.source_bundle_id).toBe("source-bundle-0003");
    expect(shadow.manifest_sha256).toBe(VALID_MINIMAL.manifest_sha256);
    expect(shadow.pipeline_job_id).toBeNull();
    // 尚未擁有的能力不以 null 佔位（3.2/3.3 才 additive 加入）。
    expect(shadow).not.toHaveProperty("job_state");
    expect(shadow).not.toHaveProperty("active_result_id");
    expect(response.body.control_plane_authority).toEqual({
      owner: "company-cloud-bim-control",
      referenced_by: "external_model_version_id",
      not_mirrored: true,
    });
    // 誠實鐵律：governed 出口不得帶 presigned 簽章。
    expect(JSON.stringify(response.body)).not.toMatch(/X-Amz-/i);
  });
});

describe("GET /api/lineage/legacy-unmanaged/preview（唯讀）", () => {
  it("缺 grouping_key → 400", async () => {
    const harness = makeHarness();
    const response = await request(harness.app).get("/api/lineage/legacy-unmanaged/preview");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_grouping_key");
  });

  it("IP 不在 allowlist → 403（控制面守門）", async () => {
    const harness = makeHarness({ rejectIp: true });
    const response = await request(harness.app).get(
      "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy",
    );
    expect(response.status).toBe(403);
    expect(harness.ipRejections).toBe(1);
  });

  it("governed MinIO 未設定 → 503", async () => {
    const harness = makeHarness({ objects: null });
    const response = await request(harness.app).get(
      "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy",
    );
    expect(response.status).toBe(503);
  });

  it("成功 → legacy_unmanaged_preview envelope，mutates_store 恆 false 且零寫入嘗試", async () => {
    const harness = makeHarness({
      previewLegacy: async (groupingKey) => legacyPreviewFor(groupingKey),
    });
    const response = await request(harness.app).get(
      "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy",
    );
    expect(response.status).toBe(200);
    expect(response.body.schema_version).toBe("model-version-bundle-manifest/v1");
    expect(response.body.document_type).toBe("legacy_unmanaged_preview");
    expect(response.body.body.state).toBe("LEGACY_UNMANAGED");
    expect(response.body.body.mutates_store).toBe(false);
    expect(response.body.body.requires_capability).toBe("bundle.publish");
    expect(harness.objects?.writeAttempts).toBe(0);
  });

  it("preview 宣稱會寫入 → fail-closed 500（不送出違反 L1 const 的文件）", async () => {
    const harness = makeHarness({
      previewLegacy: async (groupingKey) =>
        legacyPreviewFor(groupingKey, {
          mutates_store: true as unknown as false,
        }),
    });
    const response = await request(harness.app).get(
      "/api/lineage/legacy-unmanaged/preview?grouping_key=tenant-a/legacy",
    );
    expect(response.status).toBe(500);
  });
});

describe("POST /api/lineage/legacy-unmanaged/confirm（D-4 preview-only ＋ D-5 最小 gate）", () => {
  const confirmBody = {
    grouping_key: "tenant-a/legacy",
    confirmed_by_subject: "operator_test_subject",
    capability: "bundle.publish",
    authorization_decision_ref: "decision://governance-console/abc123",
  };

  it("缺 authorization_decision_ref → 403 fail closed", async () => {
    const harness = makeHarness();
    const { authorization_decision_ref: _omitted, ...withoutDecision } = confirmBody;
    const response = await request(harness.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send(withoutDecision);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("authorization_decision_required");
    expect(response.body.authorization_verification).toBe("minimal_gate_only");
    expect(harness.objects?.writeAttempts).toBe(0);
  });

  it("capability 不是 bundle.publish → 403", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send({ ...confirmBody, capability: "conversion.trigger" });
    expect(response.status).toBe(403);
    expect(response.body.required_capability).toBe("bundle.publish");
  });

  it("缺 grouping_key → 400", async () => {
    const harness = makeHarness();
    const { grouping_key: _omitted, ...withoutGrouping } = confirmBody;
    const response = await request(harness.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send(withoutGrouping);
    expect(response.status).toBe(400);
  });

  it("IP 不在 allowlist → 403（先於任何 body 判定）", async () => {
    const harness = makeHarness({ rejectIp: true });
    const response = await request(harness.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send(confirmBody);
    expect(response.status).toBe(403);
    expect(harness.ipRejections).toBe(1);
  });

  it("完整授權 → 501 awaiting_owner_carveout，且**沒有**產生 legacy_enrollment_confirmation 文件", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post("/api/lineage/legacy-unmanaged/confirm")
      .send(confirmBody);
    expect(response.status).toBe(501);
    expect(response.body.error).toBe("awaiting_owner_carveout");
    expect(response.body.mutates_store).toBe(false);
    expect(response.body).not.toHaveProperty("document_type");
    expect(response.body).not.toHaveProperty("conditional_create");
    expect(response.body).not.toHaveProperty("created_source_bundle_id");
    // preview-only 的機器證明：整條 confirm 路徑對 MinIO 零寫入嘗試。
    expect(harness.objects?.writeAttempts).toBe(0);
  });
});
