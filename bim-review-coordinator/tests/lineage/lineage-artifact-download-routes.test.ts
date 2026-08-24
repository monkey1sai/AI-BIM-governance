import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { registerLineageArtifactDownloadRoutes } from "../../src/routes/lineageArtifactDownloadRoutes.js";
import type {
  ExpectedExternalLineageDecision,
  ExternalLineageAuthorizationPort,
  ExternalLineagePrincipal,
  ExternalLineageRequestContext,
  VerifiedExternalLineageDecision,
} from "../../src/services/lineage/externalLineageAuthorization.js";
import type {
  LineageArtifactDownloadSignerPort,
  LineageArtifactDownloadSignerInput,
  LineageArtifactSignedDownload,
} from "../../src/services/lineage/lineageArtifactDownloadSigner.js";
import { PipelineJobStore } from "../../src/services/lineage/pipelineJobStore.js";
import type {
  PipelineResultArtifactDescriptor,
  PipelineResultArtifactReaderPort,
} from "../../src/services/lineage/pipelineResultArtifactReader.js";
import {
  PipelineResultStore,
  type PipelineResultView,
  type RegisterPipelineResultInput,
} from "../../src/services/lineage/pipelineResultStore.js";

const NOW = "2026-07-16T08:51:00.000000Z";
const DECISION_HEADER = "signed-test-decision-not-a-real-credential";
const ARTIFACT_ID = "usdc";
const TARGET_POLICIES = [
  {
    authority: "edge-test-01",
    bucket: "lineage-results",
    public_origin: "https://downloads.example.test",
    object_path_prefix: "/lineage-results/",
  },
] as const;
const DOWNLOAD_ORIGIN = "https://downloads.example.test";
const DOWNLOAD_OBJECT_PATH =
  "/lineage-results/model-version-test-0001/results/attempt-0007/model.usdc";

function signedUrl(input: {
  origin?: string;
  objectPath?: string;
  versionId?: string;
  omit?: string[];
  overrides?: Record<string, string>;
  append?: Array<[string, string]>;
} = {}): string {
  const values: Array<[string, string]> = [
    ["versionId", input.versionId ?? "v-usdc-0007"],
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD"],
    ["X-Amz-Credential", "TESTACCESSKEY/20260716/us-east-1/s3/aws4_request"],
    ["X-Amz-Date", "20260716T085100Z"],
    ["X-Amz-Expires", "60"],
    ["X-Amz-Signature", "d".repeat(64)],
    ["X-Amz-SignedHeaders", "host"],
    ["x-amz-checksum-mode", "ENABLED"],
    ["x-id", "GetObject"],
  ];
  const omitted = new Set(input.omit ?? []);
  const params = new URLSearchParams();
  for (const [key, originalValue] of values) {
    if (omitted.has(key)) continue;
    params.append(key, input.overrides?.[key] ?? originalValue);
  }
  for (const [key, value] of input.append ?? []) params.append(key, value);
  return `${input.origin ?? DOWNLOAD_ORIGIN}${input.objectPath ?? DOWNLOAD_OBJECT_PATH}?${params}`;
}

class FakeAuthorization implements ExternalLineageAuthorizationPort {
  readonly expected: ExpectedExternalLineageDecision[] = [];
  readonly contexts: ExternalLineageRequestContext[] = [];
  principal: ExternalLineagePrincipal = {
    subject: "operator-test-01",
    actor_kind: "operator",
    authentication_ref: "principal-ref-test-01",
  };

  async resolvePrincipal(input: {
    request: ExternalLineageRequestContext;
    now: string;
  }): Promise<ExternalLineagePrincipal> {
    this.contexts.push(input.request);
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
      authorization_decision_ref: "decision-artifact-download-01",
      issuer: "https://control-plane.test/",
      audience: "urn:ai-bim:edge-lineage",
      subject: input.principal.subject,
      capability: input.expected.capability,
      jti: "jti-artifact-download-01",
      issued_at: NOW,
      not_before: NOW,
      expires_at: "2026-07-16T08:54:00.000000Z",
      verified_at: input.now,
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
    completed_at: "2026-07-16T08:41:03.125000Z",
    correlation_id: "corr-lineage-0007",
    now: "2026-07-16T08:41:07.500000Z",
  };
}

function descriptorFor(result: PipelineResultView): PipelineResultArtifactDescriptor {
  return {
    pipeline_job_id: result.pipeline_job_id,
    result_id: result.result_id,
    attempt_id: result.attempt_id,
    source_bundle_id: result.source_bundle_id,
    external_model_version_id: result.external_model_version_id,
    result_manifest_ref: result.result_manifest_ref,
    result_manifest_digest: result.result_manifest_digest,
    artifact_id: ARTIFACT_ID,
    role: ARTIFACT_ID,
    locator: {
      ref: `${result.result_prefix}model.usdc?versionId=v-usdc-0007`,
      object_version_id: "v-usdc-0007",
      etag: "etag-v-usdc-0007",
      sha256: "b".repeat(64),
      size_bytes: 73_400_320,
    },
    published_at: "2026-07-16T08:40:22.750000Z",
    filename: "model.usdc",
    content_type: "application/octet-stream",
  };
}

class FakeArtifactReader implements PipelineResultArtifactReaderPort {
  readonly calls: Array<{ result: PipelineResultView; artifactId: string }> = [];
  descriptor: PipelineResultArtifactDescriptor | null;

  constructor(descriptor: PipelineResultArtifactDescriptor) {
    this.descriptor = descriptor;
  }

  async readArtifact(
    result: PipelineResultView,
    artifactId: string,
  ): Promise<PipelineResultArtifactDescriptor | null> {
    this.calls.push({ result, artifactId });
    return this.descriptor;
  }
}

class FakeSigner implements LineageArtifactDownloadSignerPort {
  readonly calls: LineageArtifactDownloadSignerInput[] = [];
  outputOverrides: Partial<LineageArtifactSignedDownload> = {};

  async sign(
    input: LineageArtifactDownloadSignerInput,
  ): Promise<LineageArtifactSignedDownload> {
    this.calls.push(input);
    return {
      kind: "presigned_get",
      url: signedUrl(),
      expires_at: "2026-07-16T08:52:00.000000Z",
      bound_ref: input.target.locator.ref,
      object_version_id: input.target.locator.object_version_id,
      supports_range: true,
      ...this.outputOverrides,
    };
  }
}

function makeHarness() {
  const jobs = new PipelineJobStore(null);
  const { job } = jobs.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    eventId: "ready-event-0001",
    now: "2026-07-16T08:00:00.000000Z",
  });
  const results = new PipelineResultStore(jobs, null);
  const registered = results.registerResult(resultInput(job.pipeline_job_id)).result;
  const authorization = new FakeAuthorization();
  const reader = new FakeArtifactReader(descriptorFor(registered));
  const signer = new FakeSigner();
  const app = express();
  registerLineageArtifactDownloadRoutes(app, {
    jobs,
    results,
    authorization,
    reader,
    signer,
    target_policies: TARGET_POLICIES,
    now: () => NOW,
  });
  const path = `/api/lineage/pipeline-jobs/${job.pipeline_job_id}/results/${registered.result_id}/artifacts/${ARTIFACT_ID}/download`;
  return { app, jobs, results, authorization, reader, signer, job, registered, path };
}

function authorizedGet(app: express.Express, path: string) {
  return request(app)
    .get(path)
    .set("authorization", "test-principal-credential")
    .set("dpop", "test-sender-proof")
    .set("x-lineage-authorization-decision", DECISION_HEADER);
}

describe("lineage artifact download route", () => {
  it("returns one short-lived version-bound URL after exact external authorization", async () => {
    const harness = makeHarness();
    const response = await authorizedGet(harness.app, harness.path);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.pragma).toBe("no-cache");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(harness.authorization.expected).toEqual([
      {
        capability: "artifact.download",
        principal_subject: "operator-test-01",
        method: "GET",
        path: harness.path,
        resource: {
          kind: "artifact_download",
          pipeline_job_id: harness.job.pipeline_job_id,
          result_id: harness.registered.result_id,
          artifact_id: ARTIFACT_ID,
        },
      },
    ]);
    expect(harness.authorization.contexts[0]).toMatchObject({
      authorization: "test-principal-credential",
      dpop: "test-sender-proof",
    });
    expect(harness.reader.calls).toHaveLength(1);
    expect(harness.reader.calls[0]).toMatchObject({ artifactId: ARTIFACT_ID });
    expect(harness.signer.calls).toHaveLength(1);
    expect(harness.signer.calls[0]).toMatchObject({
      requested_at: NOW,
      max_ttl_seconds: 300,
      target: {
        pipeline_job_id: harness.job.pipeline_job_id,
        result_id: harness.registered.result_id,
        artifact_id: ARTIFACT_ID,
        parsed_ref: {
          authority: "edge-test-01",
          bucket: "lineage-results",
          objectKey: "model-version-test-0001/results/attempt-0007/model.usdc",
          versionId: "v-usdc-0007",
        },
        public_origin: "https://downloads.example.test",
        object_path:
          "/lineage-results/model-version-test-0001/results/attempt-0007/model.usdc",
      },
    });
    expect(response.body).toMatchObject({
      schema_version: "lineage-artifact-download/v1",
      pipeline_job_id: harness.job.pipeline_job_id,
      result_id: harness.registered.result_id,
      artifact_id: ARTIFACT_ID,
      artifact: {
        filename: "model.usdc",
        content_type: "application/octet-stream",
        object_version_id: "v-usdc-0007",
        etag: "etag-v-usdc-0007",
        sha256: "b".repeat(64),
        size_bytes: 73_400_320,
      },
      download: {
        kind: "presigned_get",
        expires_at: "2026-07-16T08:52:00.000000Z",
        range_unit: "bytes",
        resumable: true,
      },
    });
    expect(response.body.download.url).toMatch(/^https:\/\//);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("test-principal-credential");
    expect(serialized).not.toContain("test-sender-proof");
    expect(serialized).not.toContain("jti-artifact-download-01");
    expect(serialized).not.toContain("result_manifest_ref");
  });

  it("fails closed before any store/read/sign operation when authorization is absent or denied", async () => {
    let reads = 0;
    const mustNotRead = () => {
      reads += 1;
      throw new Error("artifact state must not be read before authorization");
    };
    const reader = { readArtifact: mustNotRead };
    const signer = { sign: mustNotRead };
    const path = "/api/lineage/pipeline-jobs/pj-unknown/results/result-unknown/artifacts/usdc/download";

    const withoutAdapter = express();
    registerLineageArtifactDownloadRoutes(withoutAdapter, {
      jobs: { get: mustNotRead },
      results: { getResult: mustNotRead },
      authorization: null,
      reader,
      signer,
      target_policies: TARGET_POLICIES,
      now: () => NOW,
    });
    const unavailable = await request(withoutAdapter)
      .get(path)
      .set("x-lineage-authorization-decision", DECISION_HEADER);
    expect(unavailable.status).toBe(503);
    expect(unavailable.body).toEqual({ error: "authorization_unavailable" });

    const deniedAdapter = express();
    registerLineageArtifactDownloadRoutes(deniedAdapter, {
      jobs: { get: mustNotRead },
      results: { getResult: mustNotRead },
      authorization: new FakeAuthorization(),
      reader,
      signer,
      target_policies: TARGET_POLICIES,
      now: () => NOW,
    });
    const denied = await request(deniedAdapter)
      .get(path)
      .set("authorization", "test-principal-credential");
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "stale_or_missing_authorization_decision" });
    expect(reads).toBe(0);
  });

  it("keeps production HELD before existence reads when reader or version-aware signer is absent", async () => {
    const harness = makeHarness();
    let reads = 0;
    const mustNotRead = () => {
      reads += 1;
      throw new Error("artifact state must remain opaque while production seam is unavailable");
    };

    const noSigner = express();
    registerLineageArtifactDownloadRoutes(noSigner, {
      jobs: { get: mustNotRead },
      results: { getResult: mustNotRead },
      authorization: harness.authorization,
      reader: harness.reader,
      signer: null,
      target_policies: TARGET_POLICIES,
      now: () => NOW,
    });
    const signerUnavailable = await authorizedGet(noSigner, harness.path);
    expect(signerUnavailable.status).toBe(503);
    expect(signerUnavailable.body).toEqual({ error: "artifact_signer_unavailable" });

    const noReader = express();
    registerLineageArtifactDownloadRoutes(noReader, {
      jobs: { get: mustNotRead },
      results: { getResult: mustNotRead },
      authorization: harness.authorization,
      reader: null,
      signer: harness.signer,
      target_policies: TARGET_POLICIES,
      now: () => NOW,
    });
    const readerUnavailable = await authorizedGet(noReader, harness.path);
    expect(readerUnavailable.status).toBe(503);
    expect(readerUnavailable.body).toEqual({ error: "artifact_detail_unavailable" });
    expect(reads).toBe(0);
  });

  it("uses one generic authorized 404 for missing, cross-job, non-selectable, and missing-artifact state", async () => {
    const cases: Array<{
      name: string;
      result: PipelineResultView | null;
      readerReturnsNull?: boolean;
    }> = [];
    const base = makeHarness();
    cases.push(
      { name: "missing", result: null },
      {
        name: "cross-job",
        result: { ...base.registered, pipeline_job_id: "pj-other" },
      },
      {
        name: "non-selectable",
        result: { ...base.registered, publication_state: "INVALID" },
      },
      { name: "missing-artifact", result: base.registered, readerReturnsNull: true },
    );

    for (const item of cases) {
      const harness = makeHarness();
      if (item.readerReturnsNull) harness.reader.descriptor = null;
      const app = express();
      registerLineageArtifactDownloadRoutes(app, {
        jobs: harness.jobs,
        results: { getResult: () => item.result },
        authorization: harness.authorization,
        reader: harness.reader,
        signer: harness.signer,
        target_policies: TARGET_POLICIES,
        now: () => NOW,
      });
      const response = await authorizedGet(app, harness.path);
      expect(response.status, item.name).toBe(404);
      expect(response.body, item.name).toEqual({ error: "artifact_not_found" });
      expect(harness.signer.calls, item.name).toHaveLength(0);
    }
  });

  it.each([
    ["wrong result identity", { result_id: "result-other" }],
    ["wrong manifest digest", { result_manifest_digest: "c".repeat(64) }],
    ["wrong artifact role", { role: "quality_report" }],
    ["wrong object version", { locator: { object_version_id: "v-other" } }],
    ["zero size", { locator: { size_bytes: 0 } }],
    ["uppercase digest", { locator: { sha256: "B".repeat(64) } }],
    ["cross-prefix ref", { locator: { ref: "minio://edge-test-01/lineage-results/other/model.usdc?versionId=v-usdc-0007" } }],
  ])("rejects reader integrity drift (%s) without calling the signer", async (_name, patch) => {
    const harness = makeHarness();
    const descriptor = descriptorFor(harness.registered) as PipelineResultArtifactDescriptor & {
      locator: PipelineResultArtifactDescriptor["locator"];
    };
    harness.reader.descriptor = {
      ...descriptor,
      ...patch,
      locator: {
        ...descriptor.locator,
        ...((patch as { locator?: Partial<PipelineResultArtifactDescriptor["locator"]> }).locator ?? {}),
      },
    } as PipelineResultArtifactDescriptor;

    const response = await authorizedGet(harness.app, harness.path);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "artifact_integrity_unavailable" });
    expect(harness.signer.calls).toHaveLength(0);
  });

  it.each([
    ["non-https", { url: "http://downloads.example.test/model.usdc" }],
    ["userinfo", { url: "https://user:pass@downloads.example.test/model.usdc" }],
    ["fragment", { url: "https://downloads.example.test/model.usdc#secret" }],
    ["line break", { url: "https://downloads.example.test/model.usdc\r\nX-Test: injected" }],
    [
      "HTAB in object path",
      { url: signedUrl().replace("/lineage-results/", "/lineage-\tresults/") },
    ],
    [
      "HTAB in signature",
      { url: signedUrl().replace("X-Amz-Signature=", "X-Amz-Signature=\t") },
    ],
    ["expired", { expires_at: NOW }],
    ["ttl over cap", { expires_at: "2026-07-16T08:56:00.000001Z" }],
    ["wrong ref", { bound_ref: "minio://edge-test-01/lineage-results/other?versionId=v-other" }],
    ["wrong version", { object_version_id: "v-other" }],
    ["no range", { supports_range: false }],
    ["non-allowlisted host", { url: signedUrl({ origin: "https://evil.example.test" }) }],
    ["private IP host", { url: signedUrl({ origin: "https://127.0.0.1" }) }],
    ["wrong object path", { url: signedUrl({ objectPath: "/lineage-results/other/model.usdc" }) }],
    ["missing URL version", { url: signedUrl({ omit: ["versionId"] }) }],
    ["wrong URL version", { url: signedUrl({ versionId: "v-other" }) }],
    ["missing SigV4 algorithm", { url: signedUrl({ omit: ["X-Amz-Algorithm"] }) }],
    ["duplicate SigV4 algorithm", { url: signedUrl({ append: [["X-Amz-Algorithm", "AWS4-HMAC-SHA256"]] }) }],
    ["missing SigV4 credential", { url: signedUrl({ omit: ["X-Amz-Credential"] }) }],
    ["missing signed headers", { url: signedUrl({ omit: ["X-Amz-SignedHeaders"] }) }],
    ["missing payload mode", { url: signedUrl({ omit: ["X-Amz-Content-Sha256"] }) }],
    ["unknown bearer query", { url: signedUrl({ append: [["bearer", "unexpected-token"]] }) }],
    ["future signing date", { url: signedUrl({ overrides: { "X-Amz-Date": "20260716T085200Z" } }), expires_at: "2026-07-16T08:53:00.000000Z" }],
    ["expired signing date", { url: signedUrl({ overrides: { "X-Amz-Date": "20260716T084900Z" } }), expires_at: "2026-07-16T08:50:00.000000Z" }],
  ])("rejects unsafe signer output (%s) without returning a URL", async (_name, patch) => {
    const harness = makeHarness();
    harness.signer.outputOverrides = patch as Partial<LineageArtifactSignedDownload>;

    const response = await authorizedGet(harness.app, harness.path);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "artifact_download_unavailable" });
    expect(JSON.stringify(response.body)).not.toContain("downloads.example.test");
  });

  it.each([
    [
      "missing trailing slash with lexical sibling escape",
      {
        result_prefix:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007",
        artifact_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007-foreign/model.usdc?versionId=v-usdc-0007",
      },
    ],
    [
      "manifest outside the attempt prefix",
      {
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-other/result-manifest.json?versionId=v-manifest-0007",
      },
    ],
    [
      "wrong manifest leaf inside the attempt prefix",
      {
        result_manifest_ref:
          "minio://edge-test-01/lineage-results/model-version-test-0001/results/attempt-0007/other.json?versionId=v-manifest-0007",
      },
    ],
  ] as Array<[
    string,
    {
      result_prefix?: string;
      result_manifest_ref?: string;
      artifact_ref?: string;
    },
  ]>)("rejects corrupt attempt-scoped result evidence (%s)", async (_name, patch) => {
    const harness = makeHarness();
    const result = {
      ...harness.registered,
      ...(patch.result_prefix ? { result_prefix: patch.result_prefix } : {}),
      ...(patch.result_manifest_ref
        ? { result_manifest_ref: patch.result_manifest_ref }
        : {}),
    };
    const descriptor = descriptorFor(result);
    harness.reader.descriptor = {
      ...descriptor,
      ...(patch.artifact_ref
        ? { locator: { ...descriptor.locator, ref: patch.artifact_ref } }
        : {}),
    };
    const app = express();
    registerLineageArtifactDownloadRoutes(app, {
      jobs: harness.jobs,
      results: { getResult: () => result },
      authorization: harness.authorization,
      reader: harness.reader,
      signer: harness.signer,
      target_policies: TARGET_POLICIES,
      now: () => NOW,
    });

    const response = await authorizedGet(app, harness.path);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "artifact_integrity_unavailable" });
    expect(harness.signer.calls).toHaveLength(0);
  });

  it.each([
    "https://localhost.",
    "https://minio.local.",
    "https://storage.internal.",
  ])("rejects trailing-dot local target policy before signing: %s", async (publicOrigin) => {
    const harness = makeHarness();
    const app = express();
    registerLineageArtifactDownloadRoutes(app, {
      jobs: harness.jobs,
      results: harness.results,
      authorization: harness.authorization,
      reader: harness.reader,
      signer: harness.signer,
      target_policies: [
        {
          ...TARGET_POLICIES[0],
          public_origin: publicOrigin,
        },
      ],
      now: () => NOW,
    });

    const response = await authorizedGet(app, harness.path);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "artifact_download_unavailable" });
    expect(harness.signer.calls).toHaveLength(0);
  });

  it("rejects unknown artifact roles before authorization or state reads", async () => {
    const harness = makeHarness();
    const response = await authorizedGet(
      harness.app,
      harness.path.replace("/usdc/download", "/manifest.json/download"),
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "invalid_artifact_download_request" });
    expect(harness.authorization.expected).toHaveLength(0);
    expect(harness.reader.calls).toHaveLength(0);
    expect(harness.signer.calls).toHaveLength(0);
  });
});
