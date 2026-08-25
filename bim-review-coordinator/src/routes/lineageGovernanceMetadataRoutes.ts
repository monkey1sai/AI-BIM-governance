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
import {
  LineageMetadataProjectionUnavailableError,
  type LineageArtifactProjection,
  type LineageMetadataProjectionReaderPort,
  type LineageResultManifestProjection,
} from "../services/lineage/lineageMetadataProjections.js";

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
  alignment_metrics: AvailableProjection<
    LineageMetadataAlignmentMetrics,
    "result_manifest"
  > | NotBuiltProvenance;
  difference_counts: NotBuiltProvenance;
  warnings: AvailableProjection<
    LineageMetadataWarnings,
    "result_manifest"
  > | NotBuiltProvenance;
}

/** overview 的 alignment 數字投影：三個 ratio ＋ 十個 count，逐字取自 result manifest。 */
export interface LineageMetadataAlignmentMetrics {
  result_id: string;
  attempt_id: string;
  result_manifest_digest: string;
  converter: LineageResultManifestProjection["converter"];
  metrics: LineageResultManifestProjection["metrics"];
  counts: LineageResultManifestProjection["counts"];
}

export interface LineageMetadataWarnings {
  result_id: string;
  warning_codes: string[];
}

export interface LineageMetadataArtifactsBody {
  source_artifacts: AvailableProjection<
    LineageArtifactProjection[],
    "source_bundle_manifest"
  > | NotBuiltProvenance;
  result_artifacts: AvailableProjection<
    LineageArtifactProjection[],
    "result_manifest"
  > | NotBuiltProvenance;
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
  /**
   * manifest 投影讀取面（task 3.4 收尾刀）。省略／null＝這個部署沒建這條讀取路徑，
   * 對應欄位誠實維持 `NOT_BUILT`／`reader_not_wired`——**絕不**改回空陣列假裝沒有 artifact。
   */
  projections?: LineageMetadataProjectionReaderPort | null;
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

function notBuilt(
  source: NotBuiltProvenance["source"],
  reason: NotBuiltProvenance["reason_code"] = source === "admission_record" ||
  source === "release_audit"
    ? "store_not_present"
    : "reader_not_wired",
): NotBuiltProvenance {
  return {
    state: "NOT_BUILT",
    contract: "rvt-ifc-usdc-lineage/3.4",
    source,
    reason_code: reason,
    read_model_owner: "bim-review-coordinator",
  };
}

function isNotBuilt(value: unknown): value is NotBuiltProvenance {
  return (value as NotBuiltProvenance | null)?.state === "NOT_BUILT";
}

/**
 * 讀 active result 的 manifest 投影。
 *
 * 兩種 `NOT_BUILT` 的理由必須分開，否則運維無從判斷該去接 reader 還是該去發佈 result：
 *   * reader 沒接（`projections` 為 null）→ `reader_not_wired`
 *   * reader 接了但這個 job 還沒有 active result → `store_not_present`
 *
 * 讀取本身失敗（manifest 不見／digest 漂移／allowlist 拒絕）**不會**變成 `NOT_BUILT`：
 * `LineageMetadataProjectionUnavailableError` 會冒到 handler 變成 503。
 */
async function activeResultManifest(
  job: PipelineJobRecord,
  deps: LineageMetadataReadRouteDeps,
): Promise<LineageResultManifestProjection | NotBuiltProvenance> {
  if (!deps.projections) return notBuilt("result_manifest");
  const pointer = deps.results.getActiveResultPointer(job.pipeline_job_id);
  const active = pointer
    ? deps.results
        .listResults(job.pipeline_job_id)
        .find((item) => item.result_id === pointer.result_id) ?? null
    : null;
  if (!active) return notBuilt("result_manifest", "store_not_present");
  return deps.projections.readResultManifest(active);
}

/**
 * 取得與這個 job 互相對照得上的 authoritative READY bundle，否則 503。
 *
 * 四個條件缺一不可，其中 `bundle.pipeline_job_id === job.pipeline_job_id` 是
 * **back-reference**：少了它，一個指向別的 job 的 bundle 也能通過前三項，
 * metadata 就會把另一個 job 的 source artifacts 端到這個 job 的面板上。
 *
 * 為什麼是 503 而不是 `NOT_BUILT`：兩份 store 都在、卻互相對照不上，這是
 * **狀態不一致**，不是「這個部署沒建這條讀取路徑」。overview 一直是這個語意；
 * artifacts 先前回 `store_not_present`，等於同一個事實在兩個 surface 上有兩種說法。
 */
function requireMatchingReadyBundle(
  job: PipelineJobRecord,
  deps: LineageMetadataReadRouteDeps,
): SourceBundleRecord {
  const bundle = deps.bundles.get(job.source_bundle_id);
  if (
    !bundle ||
    bundle.bundle_state !== "READY" ||
    bundle.external_model_version_id !== job.external_model_version_id
  ) {
    throw new LineageMetadataStateUnavailableError(
      `pipeline job ${job.pipeline_job_id} lacks matching authoritative READY bundle evidence`,
    );
  }
  // back-reference 的兩種失敗對 operator 是**完全不同的事**，HTTP 上同為 503
  // `lineage_metadata_state_unavailable`（對外不洩漏內部拓撲），但 detail 必須分開：
  //
  //   * `pipeline_job_id === null`：3.1 收下 bundle 時尚未回寫 job id（由 3.2 的
  //     auto-enqueue 補上）。這是一個**會自癒的窗口**，operator 該做的是等下一輪
  //     reconcile／確認 enqueue 有跑，不是去查資料損毀。
  //   * 指向另一個 job：兩份 store 對同一個 source bundle 的歸屬說法互相矛盾。
  //     這**不會**自癒，需要人去看是哪一側寫錯。
  //
  // 合成同一句話會讓前者被當成後者調查，或更糟——後者被當成前者「再等等」。
  // 這裡刻意不引入 structLog：本 route 的 deps 沒有 logger，為了兩行訊息新增一個
  // log 基建會把「誰擁有這條 route 的可觀測性」這個決定偷偷做掉。
  if (bundle.pipeline_job_id === null) {
    throw new LineageMetadataStateUnavailableError(
      `pipeline job ${job.pipeline_job_id} source bundle has no pipeline_job_id back-reference yet (task 3.1 admission precedes the 3.2 write-back; this self-heals)`,
    );
  }
  if (bundle.pipeline_job_id !== job.pipeline_job_id) {
    throw new LineageMetadataStateUnavailableError(
      `pipeline job ${job.pipeline_job_id} source bundle back-reference points at a different job (binding conflict; does not self-heal)`,
    );
  }
  return bundle;
}

async function sourceBundleArtifacts(
  job: PipelineJobRecord,
  deps: LineageMetadataReadRouteDeps,
): Promise<LineageArtifactProjection[] | NotBuiltProvenance> {
  if (!deps.projections) return notBuilt("source_bundle_manifest");
  return deps.projections.readSourceBundleArtifacts(requireMatchingReadyBundle(job, deps));
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
  // 投影讀取失敗 ≠ 這個部署沒建讀取路徑：誠實 503，不偽裝成 NOT_BUILT。
  if (error instanceof LineageMetadataProjectionUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  response.status(500).json({ error: "lineage_metadata_internal_error" });
}

async function buildBody(
  surface: LineageMetadataSurface,
  job: PipelineJobRecord,
  deps: LineageMetadataReadRouteDeps,
): Promise<LineageMetadataBody> {
  switch (surface) {
    case "overview": {
      const bundle = requireMatchingReadyBundle(job, deps);
      const manifest = await activeResultManifest(job, deps);
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
        alignment_metrics: isNotBuilt(manifest)
          ? manifest
          : {
              state: "AVAILABLE" as const,
              source: "result_manifest" as const,
              value: {
                result_id: manifest.result_id,
                attempt_id: manifest.attempt_id,
                result_manifest_digest: manifest.result_manifest_digest,
                converter: manifest.converter,
                metrics: manifest.metrics,
                counts: manifest.counts,
              },
            },
        // difference_counts 的來源是 alignment_report（逐 element 的差異集合），
        // 不是 result manifest 的摘要數字；本刀未建那條讀取路徑，維持誠實 NOT_BUILT。
        difference_counts: notBuilt("alignment_report"),
        warnings: isNotBuilt(manifest)
          ? manifest
          : {
              state: "AVAILABLE" as const,
              source: "result_manifest" as const,
              value: {
                result_id: manifest.result_id,
                warning_codes: manifest.warning_codes,
              },
            },
      };
    }
    case "artifacts": {
      const [source, result] = await Promise.all([
        sourceBundleArtifacts(job, deps),
        activeResultManifest(job, deps),
      ]);
      return {
        source_artifacts: isNotBuilt(source)
          ? source
          : {
              state: "AVAILABLE" as const,
              source: "source_bundle_manifest" as const,
              value: source,
            },
        result_artifacts: isNotBuilt(result)
          ? result
          : {
              state: "AVAILABLE" as const,
              source: "result_manifest" as const,
              value: result.artifacts,
            },
      };
    }
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
          // body 先算完再送：`await` 留在 response literal 裡的話，「投影失敗時
          // status/headers 還沒被寫出去」就成了隱形承重——某天有人把 status 提前
          // 或加一個早寫的欄位，503 就會退化成一個帶 200 的半截 JSON。
          const body = await buildBody(config.surface, job, deps);
          response.status(200).json({
            schema_version: LINEAGE_METADATA_SCHEMA_VERSION,
            surface: config.surface,
            pipeline_job_id: pipelineJobId,
            observed_at: now,
            body,
          });
        } catch (error) {
          handleError(error, response);
        }
      },
    );
  }
}
