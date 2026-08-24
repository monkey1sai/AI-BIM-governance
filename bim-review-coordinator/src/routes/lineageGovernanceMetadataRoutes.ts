import type express from "express";
import {
  EXTERNAL_LINEAGE_DECISION_HEADER,
  LineageAuthorizationDeniedError,
  LineageAuthorizationUnavailableError,
  readSingleExternalLineageHeader,
  resolveExternalLineagePrincipal,
  verifyExternalLineageDecision,
  type ExpectedExternalLineageDecision,
  type ExternalLineageAuthorizationPort,
  type ExternalLineageRequestContext,
  type ExternalLineageResourceBinding,
  type LineageCapability,
} from "../services/lineage/externalLineageAuthorization.js";
import type {
  PipelineJobRecord,
  PipelineJobStore,
} from "../services/lineage/pipelineJobStore.js";
import type {
  SourceBundleRecord,
  SourceBundleStore,
} from "../services/lineage/sourceBundleStore.js";
import {
  PipelineResultStateUnavailableError,
  type ActivationAuditEntry,
  type ActiveResultPointer,
  type PipelineResultStore,
  type PipelineResultView,
} from "../services/lineage/pipelineResultStore.js";

export const LINEAGE_METADATA_SCHEMA_VERSION = "lineage-governance-console/metadata-v1";
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export type LineageMetadataSurface =
  | "overview"
  | "artifacts"
  | "alignment"
  | "attempts"
  | "audit";

export interface NotBuiltProvenance {
  state: "NOT_BUILT";
  contract: "rvt-ifc-usdc-lineage/3.4";
  source:
    | "source_bundle_manifest"
    | "result_manifest"
    | "alignment_report"
    | "admission_record"
    | "release_audit";
  reason_code: "reader_not_wired" | "store_not_present";
  read_model_owner: "bim-review-coordinator";
}

export interface LineageMetadataJobSummary {
  owner: PipelineJobRecord["owner"];
  pipeline_job_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  job_state: PipelineJobRecord["job_state"];
  attempt_count: number;
  in_flight_attempt_id: string | null;
  manual_correction_blocker: PipelineJobRecord["manual_correction_blocker"];
  created_at: string;
  updated_at: string;
}

export interface LineageMetadataResultSummary {
  result_id: string;
  attempt_id: string;
  attempt_number: number;
  attempt_outcome: PipelineResultView["attempt_outcome"];
  publication_state: PipelineResultView["publication_state"];
  selection_state: PipelineResultView["selection_state"];
  result_manifest_digest: string;
  completed_at: string;
  registered_at: string;
}

interface AvailableProjection<T, Source extends string> {
  state: "AVAILABLE";
  source: Source;
  value: T;
}

export interface LineageMetadataOverviewBody {
  job: LineageMetadataJobSummary;
  source_bundle: AvailableProjection<
    Pick<
      SourceBundleRecord,
      | "source_bundle_id"
      | "external_model_version_id"
      | "bundle_state"
      | "manifest_sha256"
      | "validated_at"
      | "pipeline_job_id"
    >,
    "source_bundle_store"
  > & { coverage: "governed_ready" };
  active_result: AvailableProjection<ActiveResultPointer | null, "pipeline_result_store">;
  results: AvailableProjection<LineageMetadataResultSummary[], "pipeline_result_store">;
  alignment_metrics: NotBuiltProvenance;
  difference_counts: NotBuiltProvenance;
  warnings: NotBuiltProvenance;
}

export interface LineageMetadataArtifactsBody {
  source_artifacts: NotBuiltProvenance;
  result_artifacts: NotBuiltProvenance;
}

export interface LineageMetadataAlignmentBody {
  summary: NotBuiltProvenance;
  differences: NotBuiltProvenance;
}

export interface LineageMetadataAttemptsBody {
  items: AvailableProjection<LineageMetadataResultSummary[], "pipeline_result_store"> & {
    coverage: "published_results_only";
  };
  in_flight_attempt_id: string | null;
  admission: NotBuiltProvenance;
}

export interface LineageMetadataAuditBody {
  activation: AvailableProjection<ActivationAuditEntry[], "pipeline_result_store">;
  release: NotBuiltProvenance;
}

type LineageMetadataBody =
  | LineageMetadataOverviewBody
  | LineageMetadataArtifactsBody
  | LineageMetadataAlignmentBody
  | LineageMetadataAttemptsBody
  | LineageMetadataAuditBody;

export interface LineageMetadataReadRouteDeps {
  jobs: Pick<PipelineJobStore, "get">;
  bundles: Pick<SourceBundleStore, "get">;
  results: Pick<
    PipelineResultStore,
    "listResults" | "getActiveResultPointer" | "listActivationAudit"
  >;
  authorization: ExternalLineageAuthorizationPort | null;
  now: () => string;
}

export class LineageMetadataStateUnavailableError extends Error {
  readonly code = "lineage_metadata_state_unavailable";

  constructor(detail: string) {
    super(detail);
    this.name = "LineageMetadataStateUnavailableError";
  }
}

interface SurfaceConfig {
  surface: LineageMetadataSurface;
  capability: LineageCapability;
  resourceKind: "pipeline_job_results" | "pipeline_job_audit";
}

const SURFACES: readonly SurfaceConfig[] = [
  { surface: "overview", capability: "bundle.read", resourceKind: "pipeline_job_results" },
  { surface: "artifacts", capability: "bundle.read", resourceKind: "pipeline_job_results" },
  { surface: "alignment", capability: "alignment.read", resourceKind: "pipeline_job_results" },
  { surface: "attempts", capability: "bundle.read", resourceKind: "pipeline_job_results" },
  { surface: "audit", capability: "bundle.read", resourceKind: "pipeline_job_audit" },
] as const;

function notBuilt(source: NotBuiltProvenance["source"]): NotBuiltProvenance {
  return {
    state: "NOT_BUILT",
    contract: "rvt-ifc-usdc-lineage/3.4",
    source,
    reason_code: source === "admission_record" || source === "release_audit"
      ? "store_not_present"
      : "reader_not_wired",
    read_model_owner: "bim-review-coordinator",
  };
}

function requestContext(request: express.Request): ExternalLineageRequestContext {
  return {
    method: request.method.toUpperCase(),
    path: request.path,
    remote_address: request.ip || request.socket.remoteAddress || null,
    authorization: readSingleExternalLineageHeader({
      raw_headers: request.rawHeaders,
      header_name: "authorization",
      fallback: request.get("authorization") ?? null,
    }),
    dpop: readSingleExternalLineageHeader({
      raw_headers: request.rawHeaders,
      header_name: "dpop",
      fallback: request.get("dpop") ?? null,
    }),
  };
}

async function authorizeRead(
  deps: LineageMetadataReadRouteDeps,
  request: express.Request,
  capability: LineageCapability,
  resource: ExternalLineageResourceBinding,
  now: string,
): Promise<void> {
  const context = requestContext(request);
  const principal = await resolveExternalLineagePrincipal({
    authorization: deps.authorization,
    request: context,
    now,
  });
  const expected: ExpectedExternalLineageDecision = {
    capability,
    principal_subject: principal.subject,
    method: request.method.toUpperCase(),
    path: request.path,
    resource,
  };
  await verifyExternalLineageDecision({
    authorization: deps.authorization,
    request: context,
    opaque_decision: readSingleExternalLineageHeader({
      raw_headers: request.rawHeaders,
      header_name: EXTERNAL_LINEAGE_DECISION_HEADER,
      fallback: request.get(EXTERNAL_LINEAGE_DECISION_HEADER) ?? null,
    }),
    expected,
    principal,
    now,
  });
}

function jobSummary(job: PipelineJobRecord): LineageMetadataJobSummary {
  return {
    owner: job.owner,
    pipeline_job_id: job.pipeline_job_id,
    source_bundle_id: job.source_bundle_id,
    external_model_version_id: job.external_model_version_id,
    job_state: job.job_state,
    attempt_count: job.attempt_count,
    in_flight_attempt_id: job.in_flight_attempt_id,
    manual_correction_blocker: job.manual_correction_blocker,
    created_at: job.created_at,
    updated_at: job.updated_at,
  };
}

function resultSummary(result: PipelineResultView): LineageMetadataResultSummary {
  return {
    result_id: result.result_id,
    attempt_id: result.attempt_id,
    attempt_number: result.attempt_number,
    attempt_outcome: result.attempt_outcome,
    publication_state: result.publication_state,
    selection_state: result.selection_state,
    result_manifest_digest: result.result_manifest_digest,
    completed_at: result.completed_at,
    registered_at: result.registered_at,
  };
}

function activationAuditSummary(entry: ActivationAuditEntry): ActivationAuditEntry {
  return {
    audit_entry_id: entry.audit_entry_id,
    pipeline_job_id: entry.pipeline_job_id,
    transition: entry.transition,
    from_result_id: entry.from_result_id,
    to_result_id: entry.to_result_id,
    target_result_evidence: {
      result_id: entry.target_result_evidence.result_id,
      publication_state: entry.target_result_evidence.publication_state,
      attempt_outcome: entry.target_result_evidence.attempt_outcome,
      selection_state_before: entry.target_result_evidence.selection_state_before,
    },
    capability: entry.capability,
    reason: entry.reason,
    actor: {
      actor_kind: entry.actor.actor_kind,
      actor_id: entry.actor.actor_id,
    },
    authorization_decision_ref: entry.authorization_decision_ref,
    correlation_id: entry.correlation_id,
    occurred_at: entry.occurred_at,
    append_only: true,
  };
}

function handleError(error: unknown, response: express.Response): void {
  if (error instanceof LineageAuthorizationUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  if (error instanceof LineageAuthorizationDeniedError) {
    response.status(403).json({ error: error.code });
    return;
  }
  if (error instanceof PipelineResultStateUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  if (error instanceof LineageMetadataStateUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  response.status(500).json({ error: "lineage_metadata_internal_error" });
}

function buildBody(
  surface: LineageMetadataSurface,
  job: PipelineJobRecord,
  deps: LineageMetadataReadRouteDeps,
): LineageMetadataBody {
  switch (surface) {
    case "overview": {
      const bundle = deps.bundles.get(job.source_bundle_id);
      if (
        !bundle ||
        bundle.bundle_state !== "READY" ||
        bundle.external_model_version_id !== job.external_model_version_id ||
        bundle.pipeline_job_id !== job.pipeline_job_id
      ) {
        throw new LineageMetadataStateUnavailableError(
          `pipeline job ${job.pipeline_job_id} lacks matching authoritative READY bundle evidence`,
        );
      }
      return {
        job: jobSummary(job),
        source_bundle: {
          state: "AVAILABLE" as const,
          source: "source_bundle_store" as const,
          coverage: "governed_ready" as const,
          value: {
            source_bundle_id: bundle.source_bundle_id,
            external_model_version_id: bundle.external_model_version_id,
            bundle_state: bundle.bundle_state,
            manifest_sha256: bundle.manifest_sha256,
            validated_at: bundle.validated_at,
            pipeline_job_id: bundle.pipeline_job_id,
          },
        },
        active_result: {
          state: "AVAILABLE" as const,
          source: "pipeline_result_store" as const,
          value: deps.results.getActiveResultPointer(job.pipeline_job_id),
        },
        results: {
          state: "AVAILABLE" as const,
          source: "pipeline_result_store" as const,
          value: deps.results.listResults(job.pipeline_job_id).map(resultSummary),
        },
        alignment_metrics: notBuilt("result_manifest"),
        difference_counts: notBuilt("alignment_report"),
        warnings: notBuilt("result_manifest"),
      };
    }
    case "artifacts":
      return {
        source_artifacts: notBuilt("source_bundle_manifest"),
        result_artifacts: notBuilt("result_manifest"),
      };
    case "alignment":
      return {
        summary: notBuilt("alignment_report"),
        differences: notBuilt("alignment_report"),
      };
    case "attempts":
      return {
        items: {
          state: "AVAILABLE" as const,
          source: "pipeline_result_store" as const,
          coverage: "published_results_only" as const,
          value: deps.results.listResults(job.pipeline_job_id).map(resultSummary),
        },
        in_flight_attempt_id: job.in_flight_attempt_id,
        admission: notBuilt("admission_record"),
      };
    case "audit":
      return {
        activation: {
          state: "AVAILABLE" as const,
          source: "pipeline_result_store" as const,
          value: deps.results
            .listActivationAudit(job.pipeline_job_id)
            .map(activationAuditSummary),
        },
        release: notBuilt("release_audit"),
      };
  }
}

/** Task 3.4 metadata-only surfaces. Artifact signing/download remains a separate HELD slice. */
export function registerLineageGovernanceMetadataRoutes(
  app: express.Express,
  deps: LineageMetadataReadRouteDeps,
): void {
  for (const config of SURFACES) {
    app.get(
      `/api/lineage/pipeline-jobs/:pipelineJobId/${config.surface}`,
      async (request, response) => {
        response.set("Cache-Control", "private, no-store");
        response.set("Pragma", "no-cache");
        const pipelineJobId = request.params.pipelineJobId;
        if (!SAFE_ID.test(pipelineJobId)) {
          response.status(400).json({ error: "invalid_pipeline_job_id" });
          return;
        }
        const now = deps.now();
        const resource: ExternalLineageResourceBinding = {
          kind: config.resourceKind,
          pipeline_job_id: pipelineJobId,
        };
        try {
          await authorizeRead(deps, request, config.capability, resource, now);
          const job = deps.jobs.get(pipelineJobId);
          if (!job) {
            response.status(404).json({ error: "pipeline_job_not_found" });
            return;
          }
          response.status(200).json({
            schema_version: LINEAGE_METADATA_SCHEMA_VERSION,
            surface: config.surface,
            pipeline_job_id: pipelineJobId,
            observed_at: now,
            body: buildBody(config.surface, job, deps),
          });
        } catch (error) {
          handleError(error, response);
        }
      },
    );
  }
}
