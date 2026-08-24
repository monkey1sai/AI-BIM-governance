import type express from "express";
import {
  EXTERNAL_LINEAGE_DECISION_HEADER,
  LineageAuthorizationDeniedError,
  LineageAuthorizationUnavailableError,
  readSingleExternalLineageHeader,
  resolveExternalLineagePrincipal,
  verifyExternalLineageDecision,
  type ExternalLineageAuthorizationPort,
  type ExternalLineageRequestContext,
} from "../services/lineage/externalLineageAuthorization.js";
import {
  isLineageArtifactSignedTargetBound,
  LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
  LineageArtifactDownloadUnavailableError,
  parseLineageArtifactSignedDownload,
  resolveLineageArtifactDownloadTarget,
  type LineageArtifactDownloadSignerPort,
  type LineageArtifactDownloadTargetPolicy,
} from "../services/lineage/lineageArtifactDownloadSigner.js";
import {
  isAttemptScopedMinioResultLocation,
  isRefParseFailure,
  minioRefBelongsToPrefix,
  parseMinioRef,
  utcTimestampToMicros,
} from "../services/lineage/minioLocator.js";
import type { PipelineJobStore } from "../services/lineage/pipelineJobStore.js";
import {
  isPipelineResultArtifactId,
  parsePipelineResultArtifactDescriptor,
  PipelineResultArtifactDetailUnavailableError,
  PipelineResultArtifactIntegrityUnavailableError,
  type PipelineResultArtifactDescriptor,
  type PipelineResultArtifactReaderPort,
} from "../services/lineage/pipelineResultArtifactReader.js";
import {
  isSelectableResult,
  PipelineResultStateUnavailableError,
  type PipelineResultStore,
  type PipelineResultView,
} from "../services/lineage/pipelineResultStore.js";

export const LINEAGE_ARTIFACT_DOWNLOAD_SCHEMA_VERSION = "lineage-artifact-download/v1";
const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export interface LineageArtifactDownloadRouteDeps {
  jobs: Pick<PipelineJobStore, "get">;
  results: Pick<PipelineResultStore, "getResult">;
  authorization: ExternalLineageAuthorizationPort | null;
  reader: PipelineResultArtifactReaderPort | null;
  signer: LineageArtifactDownloadSignerPort | null;
  target_policies: readonly LineageArtifactDownloadTargetPolicy[];
  now: () => string;
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

function noStore(response: express.Response): void {
  response.set("Cache-Control", "private, no-store");
  response.set("Pragma", "no-cache");
  response.set("Referrer-Policy", "no-referrer");
  response.set("X-Content-Type-Options", "nosniff");
}

function notFound(response: express.Response): void {
  response.status(404).json({ error: "artifact_not_found" });
}

function assertDescriptorBinding(
  descriptor: PipelineResultArtifactDescriptor,
  result: PipelineResultView,
  artifactId: string,
): void {
  if (
    descriptor.pipeline_job_id !== result.pipeline_job_id ||
    descriptor.result_id !== result.result_id ||
    descriptor.attempt_id !== result.attempt_id ||
    descriptor.source_bundle_id !== result.source_bundle_id ||
    descriptor.external_model_version_id !== result.external_model_version_id ||
    descriptor.result_manifest_ref !== result.result_manifest_ref ||
    descriptor.result_manifest_digest !== result.result_manifest_digest ||
    descriptor.artifact_id !== artifactId ||
    descriptor.role !== artifactId ||
    !minioRefBelongsToPrefix(result.result_prefix, descriptor.locator.ref)
  ) {
    throw new PipelineResultArtifactIntegrityUnavailableError();
  }
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
  if (
    error instanceof PipelineResultArtifactDetailUnavailableError ||
    error instanceof PipelineResultArtifactIntegrityUnavailableError ||
    error instanceof LineageArtifactDownloadUnavailableError
  ) {
    response.status(error.httpStatus).json({ error: error.code });
    return;
  }
  response.status(500).json({ error: "lineage_artifact_download_internal_error" });
}

/** Task 3.4 individual, short-lived, version-pinned artifact download contract. */
export function registerLineageArtifactDownloadRoutes(
  app: express.Express,
  deps: LineageArtifactDownloadRouteDeps,
): void {
  app.get(
    "/api/lineage/pipeline-jobs/:pipelineJobId/results/:resultId/artifacts/:artifactId/download",
    async (request, response) => {
      noStore(response);
      const pipelineJobId = request.params.pipelineJobId;
      const resultId = request.params.resultId;
      const artifactId = request.params.artifactId;
      if (
        !SAFE_ID.test(pipelineJobId) ||
        !SAFE_ID.test(resultId) ||
        !isPipelineResultArtifactId(artifactId)
      ) {
        response.status(400).json({ error: "invalid_artifact_download_request" });
        return;
      }

      const now = deps.now();
      try {
        const context = requestContext(request);
        const principal = await resolveExternalLineagePrincipal({
          authorization: deps.authorization,
          request: context,
          now,
        });
        await verifyExternalLineageDecision({
          authorization: deps.authorization,
          request: context,
          opaque_decision: readSingleExternalLineageHeader({
            raw_headers: request.rawHeaders,
            header_name: EXTERNAL_LINEAGE_DECISION_HEADER,
            fallback: request.get(EXTERNAL_LINEAGE_DECISION_HEADER) ?? null,
          }),
          principal,
          expected: {
            capability: "artifact.download",
            principal_subject: principal.subject,
            method: "GET",
            path: request.path,
            resource: {
              kind: "artifact_download",
              pipeline_job_id: pipelineJobId,
              result_id: resultId,
              artifact_id: artifactId,
            },
          },
          now,
        });

        // These seams deliberately precede existence reads: an unwired production deployment
        // remains HELD without becoming a job/result/artifact existence oracle.
        if (!deps.signer) {
          response.status(503).json({ error: "artifact_signer_unavailable" });
          return;
        }
        if (!deps.reader) {
          response.status(503).json({ error: "artifact_detail_unavailable" });
          return;
        }

        const job = deps.jobs.get(pipelineJobId);
        const result = deps.results.getResult(resultId);
        if (
          !job ||
          !result ||
          result.pipeline_job_id !== pipelineJobId ||
          result.source_bundle_id !== job.source_bundle_id ||
          result.external_model_version_id !== job.external_model_version_id ||
          !isSelectableResult(result)
        ) {
          notFound(response);
          return;
        }
        if (
          !isAttemptScopedMinioResultLocation({
            resultPrefix: result.result_prefix,
            attemptId: result.attempt_id,
            manifestRef: result.result_manifest_ref,
          })
        ) {
          throw new PipelineResultArtifactIntegrityUnavailableError();
        }

        let rawDescriptor: PipelineResultArtifactDescriptor | null;
        try {
          rawDescriptor = await deps.reader.readArtifact(result, artifactId);
        } catch (error) {
          if (
            error instanceof PipelineResultArtifactDetailUnavailableError ||
            error instanceof PipelineResultArtifactIntegrityUnavailableError
          ) {
            throw error;
          }
          throw new PipelineResultArtifactDetailUnavailableError();
        }
        if (!rawDescriptor) {
          notFound(response);
          return;
        }
        const descriptor = parsePipelineResultArtifactDescriptor(rawDescriptor);
        if (!descriptor) throw new PipelineResultArtifactIntegrityUnavailableError();
        assertDescriptorBinding(descriptor, result, artifactId);
        const parsedRef = parseMinioRef(descriptor.locator.ref);
        if (isRefParseFailure(parsedRef)) {
          throw new PipelineResultArtifactIntegrityUnavailableError();
        }
        const resolvedTarget = resolveLineageArtifactDownloadTarget({
          policies: deps.target_policies,
          parsed_ref: parsedRef,
        });
        if (!resolvedTarget) throw new LineageArtifactDownloadUnavailableError();

        let rawSignedDownload: unknown;
        try {
          rawSignedDownload = await deps.signer.sign({
            target: {
              pipeline_job_id: pipelineJobId,
              result_id: resultId,
              artifact_id: artifactId,
              locator: descriptor.locator,
              parsed_ref: parsedRef,
              public_origin: resolvedTarget.public_origin,
              object_path: resolvedTarget.object_path,
              filename: descriptor.filename,
              content_type: descriptor.content_type,
            },
            requested_at: now,
            max_ttl_seconds: LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
          });
        } catch {
          throw new LineageArtifactDownloadUnavailableError();
        }
        const signedDownload = parseLineageArtifactSignedDownload(rawSignedDownload);
        if (!signedDownload) throw new LineageArtifactDownloadUnavailableError();
        const nowMicros = utcTimestampToMicros(now);
        const expiresMicros = utcTimestampToMicros(signedDownload.expires_at);
        const maxExpiresMicros =
          nowMicros + BigInt(LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS) * 1_000_000n;
        if (
          !isLineageArtifactSignedTargetBound({
            download: signedDownload,
            target: {
              pipeline_job_id: pipelineJobId,
              result_id: resultId,
              artifact_id: artifactId,
              locator: descriptor.locator,
              parsed_ref: parsedRef,
              public_origin: resolvedTarget.public_origin,
              object_path: resolvedTarget.object_path,
              filename: descriptor.filename,
              content_type: descriptor.content_type,
            },
            requested_at: now,
            max_ttl_seconds: LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
          }) ||
          expiresMicros <= nowMicros ||
          expiresMicros > maxExpiresMicros
        ) {
          throw new LineageArtifactDownloadUnavailableError();
        }

        response.status(200).json({
          schema_version: LINEAGE_ARTIFACT_DOWNLOAD_SCHEMA_VERSION,
          pipeline_job_id: pipelineJobId,
          result_id: resultId,
          artifact_id: artifactId,
          artifact: {
            filename: descriptor.filename,
            content_type: descriptor.content_type,
            object_version_id: descriptor.locator.object_version_id,
            etag: descriptor.locator.etag,
            sha256: descriptor.locator.sha256,
            size_bytes: descriptor.locator.size_bytes,
          },
          download: {
            kind: signedDownload.kind,
            url: signedDownload.url,
            expires_at: signedDownload.expires_at,
            range_unit: "bytes",
            resumable: true,
          },
        });
      } catch (error) {
        handleError(error, response);
      }
    },
  );
}
