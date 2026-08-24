import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import * as AjvNs from "ajv/dist/2020.js";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerLineageResultRoutes } from "../../src/routes/lineageResultRoutes.js";
import {
  assertNormalizedExternalLineageDecision,
  LineageAuthorizationDeniedError,
  type ExpectedExternalLineageDecision,
  type ExternalLineageAuthorizationPort,
  type ExternalLineagePrincipal,
  type ExternalLineageRequestContext,
  type VerifiedExternalLineageDecision,
} from "../../src/services/lineage/externalLineageAuthorization.js";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import type {
  PipelineResultCompareSide,
  PipelineResultDetailReaderPort,
} from "../../src/services/lineage/pipelineResultDetailReader.js";
import {
  PipelineResultStore,
  type PipelineResultView,
  type RegisterPipelineResultInput,
} from "../../src/services/lineage/pipelineResultStore.js";

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: unknown };
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT = JSON.parse(
  fs.readFileSync(
    path.resolve(REPO_ROOT, "tests", "contracts", "pipeline_job_attempt.json"),
    "utf-8",
  ),
) as Record<string, unknown>;
const validateContract = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

const NOW = "2026-07-16T08:51:00.000Z";
const DECISION_HEADER = "signed-test-decision-not-a-real-credential";

function resultInput(
  pipelineJobId: string,
  overrides: Partial<RegisterPipelineResultInput> = {},
): RegisterPipelineResultInput {
  return {
    result_id: "result-0007",
    attempt_id: "attempt-0007",
    pipeline_job_id: pipelineJobId,
    source_bundle_id: "source-bundle-test-0001",
    external_model_version_id: "model-version-test-0001",
    attempt_number: 1,
    result_prefix:
      "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/",
    result_manifest_ref:
      "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/result-manifest.json?versionId=v-manifest-0007",
    result_manifest_digest: "a".repeat(64),
    attempt_outcome: "succeeded",
    publication_state: "AVAILABLE",
    completed_at: "2026-07-16T08:41:03.125Z",
    correlation_id: "corr-lineage-0007",
    now: "2026-07-16T08:41:07.500Z",
    ...overrides,
  };
}

function compareSide(result: PipelineResultView): PipelineResultCompareSide {
  const partial = result.result_id === "result-0008";
  return {
    result_id: result.result_id,
    attempt_id: result.attempt_id,
    pipeline_job_id: result.pipeline_job_id,
    publication_state: "AVAILABLE",
    attempt_outcome: result.attempt_outcome as "succeeded" | "succeeded_with_warnings",
    result_manifest_digest: result.result_manifest_digest,
    result_manifest_ref: {
      ref: result.result_manifest_ref,
      object_version_id:
        result.result_id === "result-0008" ? "v-manifest-0008" : "v-manifest-0007",
      etag: `etag-${result.result_id}`,
      sha256: result.result_manifest_digest,
      size_bytes: 8_421,
    },
    converter: {
      converter_id: "ifc-usdc-converter",
      converter_version: "2.4.1",
      runtime_profile: "kit-gpu-exclusive",
    },
    metrics: {
      ifc_usdc_coverage_ratio: {
        numerator: partial ? 1_180 : 1_200,
        denominator: 1_200,
        ratio: partial ? 0.9833333333 : 1,
        status: partial ? "partial" : "complete",
      },
      rvt_ifc_alignment_ratio: {
        numerator: partial ? 990 : 1_000,
        denominator: 1_000,
        ratio: partial ? 0.99 : 1,
        status: partial ? "partial" : "complete",
      },
      rvt_ifc_usdc_lineage_ratio: {
        numerator: partial ? 975 : 1_000,
        denominator: 1_000,
        ratio: partial ? 0.975 : 1,
        status: partial ? "partial" : "complete",
      },
    },
    counts: {
      csv_total_count: partial ? 1_010 : 1_000,
      csv_valid_count: 1_000,
      eligible_ifc_product_count: 1_200,
      duplicate_rvt_id_count: 0,
      duplicate_ifc_guid_count: 0,
      invalid_row_count: partial ? 10 : 0,
      csv_only_count: partial ? 10 : 0,
      ifc_only_count: partial ? 210 : 200,
      ifc_usdc_unmapped_count: partial ? 20 : 0,
      full_lineage_matched_count: partial ? 975 : 1_000,
    },
    warning_codes: partial ? ["PARTIAL_RVT_IFC_ALIGNMENT"] : [],
  };
}

const SEMANTIC_CONTRADICTIONS: Array<{
  label: string;
  mutate: (side: PipelineResultCompareSide) => PipelineResultCompareSide;
}> = [
  {
    label: "metric/count binding mismatch",
    mutate: (side) => ({
      ...side,
      counts: {
        ...side.counts,
        eligible_ifc_product_count: side.counts.eligible_ifc_product_count - 1,
      },
    }),
  },
  {
    label: "csv valid count exceeds total",
    mutate: (side) => ({
      ...side,
      counts: {
        ...side.counts,
        csv_total_count: side.counts.csv_valid_count - 1,
      },
    }),
  },
  {
    label: "diagnostic count exceeds non-valid rows",
    mutate: (side) => ({
      ...side,
      counts: {
        ...side.counts,
        duplicate_rvt_id_count:
          side.counts.csv_total_count - side.counts.csv_valid_count + 1,
      },
    }),
  },
  {
    label: "ifc-only count identity mismatch",
    mutate: (side) => ({
      ...side,
      counts: {
        ...side.counts,
        ifc_only_count: side.counts.ifc_only_count + 1,
      },
    }),
  },
  {
    label: "full-lineage set-intersection violation",
    mutate: (side) => {
      const lowerBound = Math.max(
        0,
        side.metrics.rvt_ifc_alignment_ratio.numerator +
          side.metrics.ifc_usdc_coverage_ratio.numerator -
          side.counts.eligible_ifc_product_count,
      );
      const invalidFullLineage = lowerBound - 1;
      const denominator = side.metrics.rvt_ifc_usdc_lineage_ratio.denominator;
      return {
        ...side,
        metrics: {
          ...side.metrics,
          rvt_ifc_usdc_lineage_ratio: {
            numerator: invalidFullLineage,
            denominator,
            ratio: invalidFullLineage / denominator,
            status: "partial",
          },
        },
        counts: {
          ...side.counts,
          full_lineage_matched_count: invalidFullLineage,
        },
      };
    },
  },
  {
    label: "ratio is not the exact 10dp truncation",
    mutate: (side) => ({
      ...side,
      metrics: {
        ...side.metrics,
        ifc_usdc_coverage_ratio: {
          ...side.metrics.ifc_usdc_coverage_ratio,
          ratio: side.result_id === "result-0008" ? 0.9833333334 : 0.9999999999,
        },
      },
    }),
  },
  {
    label: "metric status contradicts numerator and denominator",
    mutate: (side) => ({
      ...side,
      metrics: {
        ...side.metrics,
        ifc_usdc_coverage_ratio: {
          ...side.metrics.ifc_usdc_coverage_ratio,
          status: side.result_id === "result-0008" ? "complete" : "partial",
        },
      },
    }),
  },
];

class FakeAuthorization implements ExternalLineageAuthorizationPort {
  readonly expected: ExpectedExternalLineageDecision[] = [];
  decisionOverrides: Partial<VerifiedExternalLineageDecision> = {};
  principal: ExternalLineagePrincipal = {
    subject: "operator-test-01",
    actor_kind: "operator",
    authentication_ref: "principal-ref-test-01",
  };

  async resolvePrincipal(_input: {
    request: ExternalLineageRequestContext;
    now: string;
  }): Promise<ExternalLineagePrincipal> {
    return { ...this.principal };
  }

  async verifyDecision(input: {
    opaque_decision: string;
    request: ExternalLineageRequestContext;
    expected: ExpectedExternalLineageDecision;
    principal: ExternalLineagePrincipal;
    now: string;
  }): Promise<VerifiedExternalLineageDecision> {
    expect(input.opaque_decision).toBe(DECISION_HEADER);
    this.expected.push(input.expected);
    return {
      authorization_decision_ref: "decision-result-action-0008",
      issuer: "https://control-plane.test/",
      audience: "urn:ai-bim:edge-lineage",
      subject: input.principal.subject,
      capability: input.expected.capability,
      jti: `jti-${input.expected.capability}-0008`,
      issued_at: "2026-07-16T08:51:00.000Z",
      not_before: "2026-07-16T08:51:00.000Z",
      expires_at: "2026-07-16T08:54:00.000Z",
      verified_at: input.now,
      ...this.decisionOverrides,
    };
  }
}

function makeHarness(
  options: {
    authorization?: ExternalLineageAuthorizationPort | null;
    details?: PipelineResultDetailReaderPort | null;
  } = {},
) {
  const jobs = new PipelineJobStore(null);
  const { job } = jobs.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  const results = new PipelineResultStore(jobs, null);
  results.registerResult(resultInput(job.pipeline_job_id));
  results.registerResult(
    resultInput(job.pipeline_job_id, {
      result_id: "result-0008",
      attempt_id: "attempt-0008",
      attempt_number: 2,
      result_prefix:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/",
      result_manifest_ref:
        "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0008/result-manifest.json?versionId=v-manifest-0008",
      result_manifest_digest: "b".repeat(64),
      attempt_outcome: "succeeded_with_warnings",
      correlation_id: "corr-lineage-0008",
      now: "2026-07-16T08:45:00.000Z",
    }),
  );
  const authorization =
    options.authorization === undefined ? new FakeAuthorization() : options.authorization;
  let detailReadCount = 0;
  const details =
    options.details === undefined
      ? {
          readCompareSide: async (result: PipelineResultView) => {
            detailReadCount += 1;
            return compareSide(result);
          },
        }
      : options.details;
  const app = express();
  app.use(express.json());
  registerLineageResultRoutes(app, {
    jobs,
    results,
    authorization,
    details,
    now: () => NOW,
    newIntentId: () => "intent_route_promote_0008",
    newIntentNonce: () => "nonce-" + "9".repeat(64),
  });
  return {
    app,
    jobs,
    results,
    authorization,
    detailReadCount: () => detailReadCount,
    pipelineJobId: job.pipeline_job_id,
  };
}

describe("lineage result routes", () => {
  it("normalized decision 亦綁定 expected principal subject", () => {
    const principal: ExternalLineagePrincipal = {
      subject: "operator-test-01",
      actor_kind: "operator",
      authentication_ref: "principal-ref-test-01",
    };
    expect(() =>
      assertNormalizedExternalLineageDecision(
        {
          authorization_decision_ref: "decision-result-compare-0001",
          issuer: "https://control-plane.test/",
          audience: "urn:ai-bim:edge-lineage",
          subject: principal.subject,
          capability: "result.compare",
          jti: "jti-result-compare-0001",
          issued_at: NOW,
          not_before: NOW,
          expires_at: "2026-07-16T08:54:00.000Z",
          verified_at: NOW,
        },
        {
          principal,
          expected: {
            capability: "result.compare",
            principal_subject: "operator-other",
            method: "GET",
            path: "/api/lineage/pipeline-jobs/pj_test/results/compare",
            resource: {
              kind: "result_compare",
              pipeline_job_id: "pj_test",
              result_ids: ["result-0007", "result-0008"],
            },
          },
          now: NOW,
        },
      ),
    ).toThrow(LineageAuthorizationDeniedError);
  });

  it("result.compare 驗 exact pair decision，回 L1 document 且不改 pointer/audit", async () => {
    const harness = makeHarness();
    const pointerBefore = harness.results.getActiveResultPointer(harness.pipelineJobId);
    const auditBefore = harness.results.listActivationAudit(harness.pipelineJobId);

    const response = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);

    expect(response.status).toBe(200);
    expect(validateContract(response.body), JSON.stringify(validateContract.errors)).toBe(true);
    expect(response.body).toMatchObject({
      schema_version: "pipeline-job-attempt/v1",
      document_type: "result_compare",
      body: {
        capability: "result.compare",
        read_only: true,
        active_pointer_changed: false,
        pipeline_job_id: harness.pipelineJobId,
        actor: { actor_id: "operator-test-01" },
        differences: {
          warning_codes_added: ["PARTIAL_RVT_IFC_ALIGNMENT"],
        },
      },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(harness.results.getActiveResultPointer(harness.pipelineJobId)).toEqual(pointerBefore);
    expect(harness.results.listActivationAudit(harness.pipelineJobId)).toEqual(auditBefore);
    expect((harness.authorization as FakeAuthorization).expected[0]?.resource).toEqual({
      kind: "result_compare",
      pipeline_job_id: harness.pipelineJobId,
      result_ids: ["result-0007", "result-0008"],
    });
  });

  it.each([
    ["expired", { expires_at: "2026-07-16T08:50:59.000Z" }],
    ["future not-before", { not_before: "2026-07-16T08:52:00.000Z" }],
    ["future issued-at", { issued_at: "2026-07-16T08:52:00.000Z" }],
    ["sub-millisecond future not-before", { not_before: "2026-07-16T08:51:00.000001Z" }],
    ["sub-millisecond future issued-at", { issued_at: "2026-07-16T08:51:00.000001Z" }],
    ["non-canonical UTC", { issued_at: "2026-07-16T08:50:05.1234567Z" }],
  ] as const)("result.compare 對 verifier 的 %s normalized decision 再次 fail closed", async (_case, overrides) => {
    const authorization = new FakeAuthorization();
    authorization.decisionOverrides = overrides;
    const harness = makeHarness({ authorization });
    const response = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "stale_or_missing_authorization_decision" });
    expect(harness.detailReadCount()).toBe(0);
  });

  it("intent 只建立 server challenge；confirm 才以 verified decision 原子 promote", async () => {
    const harness = makeHarness();
    const pointerBefore = harness.results.getActiveResultPointer(harness.pipelineJobId);
    const auditBefore = harness.results.listActivationAudit(harness.pipelineJobId);

    const intent = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({
        transition: "promote",
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
        reason: "operator selected the verified warning result",
        correlation_id: "corr-promote-0008",
      });
    expect(intent.status).toBe(201);
    expect(intent.body).toMatchObject({
      intent_id: "intent_route_promote_0008",
      state: "pending",
      required_capability: "result.promote",
      authorization_request: {
        intent_nonce: "nonce-" + "9".repeat(64),
        pipeline_job_id: harness.pipelineJobId,
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
      },
    });
    expect(harness.results.getActiveResultPointer(harness.pipelineJobId)).toEqual(pointerBefore);
    expect(harness.results.listActivationAudit(harness.pipelineJobId)).toEqual(auditBefore);

    const confirmed = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/confirm`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({ intent_id: intent.body.intent_id });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({
      outcome: "committed",
      replay: false,
      active_result_pointer: { result_id: "result-0008" },
      activation_audit_entry: {
        capability: "result.promote",
        actor: { actor_id: "operator-test-01" },
        authorization_decision_ref: "decision-result-action-0008",
      },
    });
    expect(JSON.stringify(confirmed.body)).not.toContain(DECISION_HEADER);
    expect(harness.results.listActivationAudit(harness.pipelineJobId)).toHaveLength(2);
  });

  it("confirm 的 principal subject 不等於 intent actor 時 403 且 pointer 不變", async () => {
    const auth = new FakeAuthorization();
    const harness = makeHarness({ authorization: auth });
    const intent = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({
        transition: "promote",
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
        reason: "promote candidate",
        correlation_id: "corr-promote-0008",
      });
    auth.principal = {
      subject: "operator-other",
      actor_kind: "operator",
      authentication_ref: "principal-ref-other",
    };
    const confirmed = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/confirm`)
      .set("authorization", "test-other-principal")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({ intent_id: intent.body.intent_id });
    expect(confirmed.status).toBe(403);
    expect(confirmed.body.error).toBe("stale_or_missing_authorization_decision");
    expect(harness.results.getActiveResultPointer(harness.pipelineJobId)?.result_id).toBe(
      "result-0007",
    );
  });

  it("confirm 未知 intent 與已知但 wrong-job intent 都只回 generic 403，不形成 existence oracle", async () => {
    const harness = makeHarness();
    const authorization = harness.authorization as FakeAuthorization;
    const unknown = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/confirm`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({ intent_id: "intent_unknown_0001" });

    expect(unknown.status).toBe(403);
    expect(unknown.body).toEqual({ error: "stale_or_missing_authorization_decision" });
    expect(authorization.expected).toHaveLength(0);

    const intent = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({
        transition: "promote",
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
        reason: "promote candidate",
        correlation_id: "corr-promote-0008",
      });
    expect(intent.status).toBe(201);
    const otherJob = harness.jobs.ensureJobForSourceBundle({
      sourceBundleId: "source-bundle-test-0002",
      externalModelVersionId: "model-version-test-0002",
      eventId: "ready-event-0002",
      now: "2026-07-16T08:52:00.000Z",
    }).job;
    const verificationCount = authorization.expected.length;
    const wrongJob = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${otherJob.pipeline_job_id}/result-actions/confirm`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({ intent_id: intent.body.intent_id });

    expect(wrongJob.status).toBe(unknown.status);
    expect(wrongJob.body).toEqual(unknown.body);
    expect(authorization.expected).toHaveLength(verificationCount);
    expect(harness.results.getActiveResultPointer(harness.pipelineJobId)?.result_id).toBe(
      "result-0007",
    );
  });

  it("未設定 authorization adapter 時 compare/intent 都誠實 503", async () => {
    const harness = makeHarness({ authorization: null });
    const compare = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(compare.status).toBe(503);
    expect(compare.body.error).toBe("authorization_unavailable");

    const intent = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .send({
        transition: "promote",
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
        reason: "promote candidate",
        correlation_id: "corr-promote-0008",
      });
    expect(intent.status).toBe(503);
    expect(intent.body.error).toBe("authorization_unavailable");
    expect(harness.results.getActivationIntent("intent_route_promote_0008")).toBeNull();
  });

  it("已登入但缺 result action decision 時 intent 403，且不探查或持久化 target", async () => {
    const harness = makeHarness();
    const response = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .set("authorization", "test-principal-credential")
      .send({
        transition: "promote",
        target_result_id: "result-0008",
        expected_active_result_id: "result-0007",
        reason: "promote candidate",
        correlation_id: "corr-promote-0008",
      });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("stale_or_missing_authorization_decision");
    expect(harness.results.getActivationIntent("intent_route_promote_0008")).toBeNull();
  });

  it("detail reader 回 contract-invalid counts/version 時 compare 503，不回傳未驗資料", async () => {
    const harness = makeHarness({
      details: {
        readCompareSide: async (result) => ({
          ...compareSide(result),
          counts: {
            ...compareSide(result).counts,
            csv_total_count: -1,
          },
          result_manifest_ref: {
            ...compareSide(result).result_manifest_ref,
            object_version_id: "wrong-version",
          },
        }),
      },
    });
    const response = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "result_detail_unavailable" });
    expect(JSON.stringify(response.body)).not.toContain("wrong-version");
  });

  it.each(SEMANTIC_CONTRADICTIONS)(
    "detail reader 回 schema-valid semantic contradiction（$label）時 compare 503",
    async ({ mutate }) => {
      const harness = makeHarness({
        details: {
          readCompareSide: async (result) => mutate(compareSide(result)),
        },
      });
      const response = await request(harness.app)
        .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
        .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
        .set("authorization", "test-principal-credential")
        .set("x-lineage-authorization-decision", DECISION_HEADER);

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "result_detail_unavailable" });
    },
  );

  it("detail reader 回 schema-valid 但 immutable identity 漂移時仍只回 detail 503", async () => {
    const harness = makeHarness({
      details: {
        readCompareSide: async (result) => ({
          ...compareSide(result),
          result_manifest_digest: "f".repeat(64),
        }),
      },
    });
    const response = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-0008" })
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "result_detail_unavailable" });
    expect(JSON.stringify(response.body)).not.toContain("f".repeat(64));
  });

  it("compare 與 protected action invariant 都維持 generic 409 wire code", async () => {
    const harness = makeHarness();
    harness.results.registerResult(
      resultInput(harness.pipelineJobId, {
        result_id: "result-failed-0009",
        attempt_id: "attempt-failed-0009",
        attempt_number: 3,
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-failed-0009/",
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-failed-0009/result-manifest.json?versionId=v-manifest-failed-0009",
        result_manifest_digest: "f".repeat(64),
        attempt_outcome: "failed",
        correlation_id: "corr-lineage-failed-0009",
      }),
    );
    const pointerBefore = harness.results.getActiveResultPointer(harness.pipelineJobId);
    const auditBefore = harness.results.listActivationAudit(harness.pipelineJobId);

    const compare = await request(harness.app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/results/compare`)
      .query({ left_result_id: "result-0007", right_result_id: "result-failed-0009" })
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(compare.status).toBe(409);
    expect(compare.body).toEqual({ error: "pipeline_result_invariant_violation" });

    const action = await request(harness.app)
      .post(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/result-actions/intent`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER)
      .send({
        transition: "promote",
        target_result_id: "result-0007",
        expected_active_result_id: "result-0007",
        reason: "invalidly promote the already-active result",
        correlation_id: "corr-invalid-promote-active",
      });
    expect(action.status).toBe(409);
    expect(action.body).toEqual({ error: "pipeline_result_invariant_violation" });
    expect(harness.results.getActiveResultPointer(harness.pipelineJobId)).toEqual(pointerBefore);
    expect(harness.results.listActivationAudit(harness.pipelineJobId)).toEqual(auditBefore);
  });
});
