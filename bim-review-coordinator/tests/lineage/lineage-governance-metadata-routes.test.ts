import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  registerLineageGovernanceMetadataRoutes,
} from "../../src/routes/lineageGovernanceMetadataRoutes.js";
import type {
  ExpectedExternalLineageDecision,
  ExternalLineageAuthorizationPort,
  ExternalLineagePrincipal,
  ExternalLineageRequestContext,
  VerifiedExternalLineageDecision,
} from "../../src/services/lineage/externalLineageAuthorization.js";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import { SourceBundleStore } from "../../src/services/lineage/sourceBundleStore.js";
import {
  PipelineResultStateUnavailableError,
  PipelineResultStore,
  type RegisterPipelineResultInput,
} from "../../src/services/lineage/pipelineResultStore.js";

const NOW = "2026-07-16T08:51:00.000Z";
const DECISION_HEADER = "signed-test-decision-not-a-real-credential";
const SURFACES = ["overview", "artifacts", "alignment", "attempts", "audit"] as const;

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
      authorization_decision_ref: `decision-${input.expected.capability}`,
      issuer: "https://control-plane.test/",
      audience: "urn:ai-bim:edge-lineage",
      subject: input.principal.subject,
      capability: input.expected.capability,
      jti: `jti-${input.expected.capability}`,
      issued_at: NOW,
      not_before: NOW,
      expires_at: "2026-07-16T08:54:00.000Z",
      verified_at: input.now,
      ...this.decisionOverrides,
    };
  }
}

function resultInput(pipelineJobId: string): RegisterPipelineResultInput {
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
  };
}

function makeHarness(authorization: ExternalLineageAuthorizationPort | null = new FakeAuthorization()) {
  const jobs = new PipelineJobStore(null);
  const { job } = jobs.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000Z",
  });
  const bundles = new SourceBundleStore(null);
  bundles.admit({
    source_bundle_id: job.source_bundle_id,
    external_model_version_id: job.external_model_version_id,
    tenant_id: "tenant-a",
    project_id: "project-library",
    project_display_name: null,
    model_category: null,
    manifest_ref:
      "minio://edge-test-01/source-bundles/tenant-a/project-library/model-version-test-0001/manifest.json?versionId=v-src-manifest-0001",
    manifest_sha256: "d".repeat(64),
    bundle_state: "READY",
    integrity_diagnostics: [],
    producer_id: "ifc-worker-edge-01",
    producer_kind: "external_ifc_worker",
    claimed_at: "2026-07-16T07:58:20.000Z",
    validated_at: "2026-07-16T08:00:00.000Z",
    pipeline_job_id: job.pipeline_job_id,
    created_at: "2026-07-16T08:00:00.000Z",
    updated_at: "2026-07-16T08:00:00.000Z",
  });
  const results = new PipelineResultStore(jobs, null);
  results.registerResult(resultInput(job.pipeline_job_id));
  const app = express();
  registerLineageGovernanceMetadataRoutes(app, {
    jobs,
    bundles,
    results,
    authorization,
    now: () => NOW,
  });
  return { app, jobs, bundles, results, authorization, pipelineJobId: job.pipeline_job_id };
}

describe("lineage governance metadata routes", () => {
  it("五個 surface 只輸出可證 metadata，缺 reader/store 的區塊固定 NOT_BUILT", async () => {
    const harness = makeHarness();
    const responses = new Map<string, request.Response>();
    for (const surface of SURFACES) {
      const response = await request(harness.app)
        .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/${surface}`)
        .set("authorization", "test-principal-credential")
        .set("x-lineage-authorization-decision", DECISION_HEADER);
      expect(response.status, surface).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.body).toMatchObject({
        schema_version: "lineage-governance-console/metadata-v1",
        surface,
        pipeline_job_id: harness.pipelineJobId,
        observed_at: NOW,
      });
      responses.set(surface, response);
    }

    const overview = responses.get("overview")!.body;
    expect(overview.body.job).toMatchObject({
      pipeline_job_id: harness.pipelineJobId,
      source_bundle_id: "source-bundle-test-0001",
      external_model_version_id: "model-version-test-0001",
    });
    expect(harness.jobs.get(harness.pipelineJobId)?.active_result_id).toBeNull();
    expect(overview.body.active_result).toMatchObject({
      state: "AVAILABLE",
      source: "pipeline_result_store",
      value: { result_id: "result-0007" },
    });
    expect(overview.body.source_bundle).toEqual({
      state: "AVAILABLE",
      source: "source_bundle_store",
      coverage: "governed_ready",
      value: {
        source_bundle_id: "source-bundle-test-0001",
        external_model_version_id: "model-version-test-0001",
        bundle_state: "READY",
        manifest_sha256: "d".repeat(64),
        validated_at: "2026-07-16T08:00:00.000Z",
        pipeline_job_id: harness.pipelineJobId,
      },
    });
    expect(overview.body.results).toMatchObject({
      state: "AVAILABLE",
      source: "pipeline_result_store",
      value: [expect.objectContaining({ result_id: "result-0007", selection_state: "active" })],
    });
    expect(overview.body.alignment_metrics).toMatchObject({
      state: "NOT_BUILT",
      source: "result_manifest",
      reason_code: "reader_not_wired",
      read_model_owner: "bim-review-coordinator",
    });
    expect(overview.body.difference_counts).toMatchObject({
      state: "NOT_BUILT",
      source: "alignment_report",
    });
    expect(overview.body.warnings).toMatchObject({
      state: "NOT_BUILT",
      source: "result_manifest",
    });

    expect(responses.get("artifacts")!.body.body).toMatchObject({
      source_artifacts: { state: "NOT_BUILT", source: "source_bundle_manifest" },
      result_artifacts: { state: "NOT_BUILT", source: "result_manifest" },
    });
    expect(responses.get("alignment")!.body.body).toMatchObject({
      summary: { state: "NOT_BUILT", source: "alignment_report" },
      differences: { state: "NOT_BUILT", source: "alignment_report" },
    });
    expect(responses.get("attempts")!.body.body).toMatchObject({
      items: {
        state: "AVAILABLE",
        source: "pipeline_result_store",
        coverage: "published_results_only",
        value: [expect.objectContaining({ attempt_id: "attempt-0007" })],
      },
      admission: { state: "NOT_BUILT", source: "admission_record" },
    });
    expect(responses.get("audit")!.body.body).toMatchObject({
      activation: {
        state: "AVAILABLE",
        source: "pipeline_result_store",
        value: [expect.objectContaining({ transition: "first_activation" })],
      },
      release: { state: "NOT_BUILT", source: "release_audit" },
    });
    expect(JSON.stringify([...responses.values()].map((value) => value.body))).not.toContain(
      "jti-",
    );

    const authorization = harness.authorization as FakeAuthorization;
    expect(authorization.expected.map((item) => item.capability)).toEqual([
      "bundle.read",
      "bundle.read",
      "alignment.read",
      "bundle.read",
      "bundle.read",
    ]);
    expect(authorization.expected.map((item) => item.resource)).toEqual([
      { kind: "pipeline_job_results", pipeline_job_id: harness.pipelineJobId },
      { kind: "pipeline_job_results", pipeline_job_id: harness.pipelineJobId },
      { kind: "pipeline_job_results", pipeline_job_id: harness.pipelineJobId },
      { kind: "pipeline_job_results", pipeline_job_id: harness.pipelineJobId },
      { kind: "pipeline_job_audit", pipeline_job_id: harness.pipelineJobId },
    ]);
    for (const [index, surface] of SURFACES.entries()) {
      expect(authorization.expected[index]).toMatchObject({
        method: "GET",
        path: `/api/lineage/pipeline-jobs/${harness.pipelineJobId}/${surface}`,
      });
    }
  });

  it("audit surface 只投影 closed public DTO，不外洩 store 額外欄位", async () => {
    const harness = makeHarness();
    const app = express();
    registerLineageGovernanceMetadataRoutes(app, {
      jobs: harness.jobs,
      bundles: harness.bundles,
      results: {
        listResults: (pipelineJobId) => harness.results.listResults(pipelineJobId),
        getActiveResultPointer: (pipelineJobId) =>
          harness.results.getActiveResultPointer(pipelineJobId),
        listActivationAudit: (pipelineJobId) =>
          harness.results.listActivationAudit(pipelineJobId).map((entry) => ({
            ...entry,
            jti: "synthetic-jti-must-not-leak",
            credential: "synthetic-credential-must-not-leak",
          })),
      },
      authorization: harness.authorization,
      now: () => NOW,
    });

    const response = await request(app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/audit`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);

    expect(response.status).toBe(200);
    const entry = response.body.body.activation.value[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(
      [
        "audit_entry_id",
        "pipeline_job_id",
        "transition",
        "from_result_id",
        "to_result_id",
        "target_result_evidence",
        "capability",
        "reason",
        "actor",
        "authorization_decision_ref",
        "correlation_id",
        "occurred_at",
        "append_only",
      ].sort(),
    );
    expect(JSON.stringify(response.body)).not.toContain("synthetic-jti-must-not-leak");
    expect(JSON.stringify(response.body)).not.toContain("synthetic-credential-must-not-leak");
  });

  it("overview 缺少 authoritative READY bundle 時 fail closed，不從 job identity 推導", async () => {
    const harness = makeHarness();
    const app = express();
    registerLineageGovernanceMetadataRoutes(app, {
      jobs: harness.jobs,
      bundles: { get: () => null },
      results: harness.results,
      authorization: harness.authorization,
      now: () => NOW,
    });

    const response = await request(app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/overview`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "lineage_metadata_state_unavailable" });
  });

  it("authorization adapter 缺失時五個 surface 都在讀 store 前 fail closed 503", async () => {
    const app = express();
    const mustNotRead = () => {
      throw new Error("metadata store must not be read before authorization");
    };
    registerLineageGovernanceMetadataRoutes(app, {
      jobs: { get: mustNotRead },
      bundles: { get: mustNotRead },
      results: {
        listResults: mustNotRead,
        getActiveResultPointer: mustNotRead,
        listActivationAudit: mustNotRead,
      },
      authorization: null,
      now: () => NOW,
    });

    for (const surface of SURFACES) {
      const response = await request(app)
        .get(`/api/lineage/pipeline-jobs/pj_unknown/${surface}`)
        .set("x-lineage-authorization-decision", DECISION_HEADER);
      expect(response.status, surface).toBe(503);
      expect(response.body).toEqual({ error: "authorization_unavailable" });
    }
  });

  it("缺 decision 不探查 job；授權成功後 missing job 才回 404", async () => {
    const harness = makeHarness();
    const denied = await request(harness.app)
      .get("/api/lineage/pipeline-jobs/pj_missing/overview")
      .set("authorization", "test-principal-credential");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "stale_or_missing_authorization_decision" });

    const missing = await request(harness.app)
      .get("/api/lineage/pipeline-jobs/pj_missing/overview")
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "pipeline_job_not_found" });
  });

  it("expired normalized decision 在 store read 前 generic 403", async () => {
    const authorization = new FakeAuthorization();
    authorization.decisionOverrides = { expires_at: "2026-07-16T08:50:59.999999Z" };
    const app = express();
    const mustNotRead = () => {
      throw new Error("metadata store must not be read after authorization denial");
    };
    registerLineageGovernanceMetadataRoutes(app, {
      jobs: { get: mustNotRead },
      bundles: { get: mustNotRead },
      results: {
        listResults: mustNotRead,
        getActiveResultPointer: mustNotRead,
        listActivationAudit: mustNotRead,
      },
      authorization,
      now: () => NOW,
    });

    const response = await request(app)
      .get("/api/lineage/pipeline-jobs/pj_unknown/overview")
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "stale_or_missing_authorization_decision" });
  });

  it("result sidecar unavailable 維持 503，不以空資料掩蓋", async () => {
    const harness = makeHarness();
    const app = express();
    const unavailable = () => {
      throw new PipelineResultStateUnavailableError("sidecar unavailable in test");
    };
    registerLineageGovernanceMetadataRoutes(app, {
      jobs: harness.jobs,
      bundles: harness.bundles,
      results: {
        listResults: unavailable,
        getActiveResultPointer: unavailable,
        listActivationAudit: unavailable,
      },
      authorization: harness.authorization,
      now: () => NOW,
    });

    const response = await request(app)
      .get(`/api/lineage/pipeline-jobs/${harness.pipelineJobId}/overview`)
      .set("authorization", "test-principal-credential")
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "pipeline_result_state_unavailable" });
  });
});
