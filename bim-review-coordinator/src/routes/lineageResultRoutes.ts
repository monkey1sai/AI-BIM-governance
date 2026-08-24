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
  type ExternalLineagePrincipal,
  type ExternalLineageRequestContext,
  type VerifiedExternalLineageDecision,
} from "../services/lineage/externalLineageAuthorization.js";
import type { PipelineJobStore } from "../services/lineage/pipelineJobStore.js";
import {
  buildPipelineResultCompareDifferences,
  parsePipelineResultCompareSide,
  PipelineResultDetailUnavailableError,
  type PipelineResultCompareSide,
  type PipelineResultDetailReaderPort,
} from "../services/lineage/pipelineResultDetailReader.js";
import {
  PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION,
  PIPELINE_RESULT_INTENT_TTL_MS,
  PipelineResultAuthorizationError,
  PipelineResultConflictError,
  PipelineResultInvariantError,
  PipelineResultRevisionConflictError,
  PipelineResultStateUnavailableError,
  type PipelineResultActivationIntent,
  type PipelineResultStore,
  type PipelineResultView,
  type VerifiedExternalResultDecision,
} from "../services/lineage/pipelineResultStore.js";

const SAFE_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export interface LineageResultRouteDeps {
  jobs: Pick<PipelineJobStore, "get">;
  results: Pick<
    PipelineResultStore,
    | "getComparableResults"
    | "createActivationIntent"
    | "confirmActivationIntent"
    | "getActivationIntent"
  >;
  authorization: ExternalLineageAuthorizationPort | null;
  details: PipelineResultDetailReaderPort | null;
  now: () => string;
  newIntentId: () => string;
  newIntentNonce: () => string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, maxLength = 2_000): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
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
}

function authorizationUnavailable(response: express.Response): void {
  response.status(503).json({ error: "authorization_unavailable" });
}

function authorizationDenied(response: express.Response): void {
  response.status(403).json({ error: "stale_or_missing_authorization_decision" });
}

async function resolvePrincipal(
  deps: LineageResultRouteDeps,
  request: express.Request,
  now: string,
): Promise<ExternalLineagePrincipal> {
  return resolveExternalLineagePrincipal({
    authorization: deps.authorization,
    request: requestContext(request),
    now,
  });
}

async function verifyDecision(
  deps: LineageResultRouteDeps,
  request: express.Request,
  principal: ExternalLineagePrincipal,
  expected: ExpectedExternalLineageDecision,
  now: string,
): Promise<VerifiedExternalLineageDecision> {
  return verifyExternalLineageDecision({
    authorization: deps.authorization,
    request: requestContext(request),
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

function handleRouteError(error: unknown, response: express.Response): void {
  if (error instanceof LineageAuthorizationUnavailableError) {
    authorizationUnavailable(response);
    return;
  }
  if (
    error instanceof LineageAuthorizationDeniedError ||
    error instanceof PipelineResultAuthorizationError
  ) {
    authorizationDenied(response);
    return;
  }
  if (error instanceof PipelineResultStateUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  if (error instanceof PipelineResultDetailUnavailableError) {
    response.status(503).json({ error: error.code });
    return;
  }
  if (error instanceof PipelineResultRevisionConflictError) {
    response.status(409).json({ error: error.code });
    return;
  }
  if (error instanceof PipelineResultConflictError) {
    response.status(409).json({ error: error.code });
    return;
  }
  if (error instanceof PipelineResultInvariantError) {
    response.status(409).json({ error: error.code });
    return;
  }
  response.status(500).json({ error: "lineage_result_internal_error" });
}

function assertCompareSide(side: PipelineResultCompareSide, result: PipelineResultView): void {
  if (
    side.result_id !== result.result_id ||
    side.attempt_id !== result.attempt_id ||
    side.pipeline_job_id !== result.pipeline_job_id ||
    side.publication_state !== "AVAILABLE" ||
    side.attempt_outcome !== result.attempt_outcome ||
    side.result_manifest_digest !== result.result_manifest_digest ||
    side.result_manifest_ref.ref !== result.result_manifest_ref ||
    side.result_manifest_ref.sha256 !== result.result_manifest_digest ||
    !side.result_manifest_ref.ref.includes("?versionId=") ||
    /x-amz-|credential=|signature=/i.test(side.result_manifest_ref.ref) ||
    !Number.isSafeInteger(side.result_manifest_ref.size_bytes) ||
    side.result_manifest_ref.size_bytes < 0 ||
    new Set(side.warning_codes).size !== side.warning_codes.length
  ) {
    throw new PipelineResultDetailUnavailableError(
      `result detail ${result.result_id} does not match immutable result evidence`,
    );
  }
}

function activationBinding(intent: PipelineResultActivationIntent) {
  return {
    kind: "result_activation_confirm" as const,
    intent_id: intent.intent_id,
    intent_nonce_sha256: intent.intent_nonce_sha256,
    pipeline_job_id: intent.pipeline_job_id,
    target_result_id: intent.target_result_id,
    expected_active_result_id: intent.expected_active_result_id,
    transition: intent.transition,
    correlation_id: intent.correlation_id,
  };
}

/**
 * Task 3.3 protected result actions. Task 3.4 list/detail/audit/download surfaces are added in a
 * later slice; keeping them separate prevents this module from fabricating unavailable detail.
 */
export function registerLineageResultRoutes(
  app: express.Express,
  deps: LineageResultRouteDeps,
): void {
  app.get(
    "/api/lineage/pipeline-jobs/:pipelineJobId/results/compare",
    async (request, response) => {
      noStore(response);
      const pipelineJobId = request.params.pipelineJobId;
      const leftResultId = nonEmptyString(request.query.left_result_id, 200);
      const rightResultId = nonEmptyString(request.query.right_result_id, 200);
      if (
        !SAFE_ID.test(pipelineJobId) ||
        !leftResultId ||
        !rightResultId ||
        !SAFE_ID.test(leftResultId) ||
        !SAFE_ID.test(rightResultId)
      ) {
        response.status(400).json({ error: "invalid_result_compare_request" });
        return;
      }
      const now = deps.now();
      try {
        const principal = await resolvePrincipal(deps, request, now);
        const resultIds = [leftResultId, rightResultId].sort() as [string, string];
        await verifyDecision(
          deps,
          request,
          principal,
          {
            capability: "result.compare",
            principal_subject: principal.subject,
            method: "GET",
            path: request.path,
            resource: {
              kind: "result_compare",
              pipeline_job_id: pipelineJobId,
              result_ids: resultIds,
            },
          },
          now,
        );
        if (!deps.jobs.get(pipelineJobId)) {
          response.status(404).json({ error: "pipeline_job_not_found" });
          return;
        }
        if (!deps.details) {
          response.status(503).json({ error: "result_detail_unavailable" });
          return;
        }
        const comparable = deps.results.getComparableResults(
          pipelineJobId,
          leftResultId,
          rightResultId,
        );
        const [rawLeft, rawRight] = await Promise.all([
          deps.details.readCompareSide(comparable.left),
          deps.details.readCompareSide(comparable.right),
        ]);
        const left = parsePipelineResultCompareSide(rawLeft);
        const right = parsePipelineResultCompareSide(rawRight);
        if (!left || !right) {
          throw new PipelineResultDetailUnavailableError(
            "result detail reader returned a contract-invalid compare side",
          );
        }
        assertCompareSide(left, comparable.left);
        assertCompareSide(right, comparable.right);
        response.status(200).json({
          schema_version: PIPELINE_RESULT_DOCUMENT_SCHEMA_VERSION,
          document_type: "result_compare",
          body: {
            capability: "result.compare",
            read_only: true,
            active_pointer_changed: false,
            pipeline_job_id: pipelineJobId,
            actor: {
              actor_kind: principal.actor_kind,
              actor_id: principal.subject,
            },
            compared_at: now,
            left,
            right,
            differences: buildPipelineResultCompareDifferences(left, right),
          },
        });
      } catch (error) {
        handleRouteError(error, response);
      }
    },
  );

  app.post(
    "/api/lineage/pipeline-jobs/:pipelineJobId/result-actions/intent",
    async (request, response) => {
      noStore(response);
      const pipelineJobId = request.params.pipelineJobId;
      const body = isPlainObject(request.body) ? request.body : {};
      const transition = body.transition;
      const targetResultId = nonEmptyString(body.target_result_id, 200);
      const expectedActiveResultId = nonEmptyString(body.expected_active_result_id, 200);
      const reason = nonEmptyString(body.reason, 2_000);
      const correlationId = nonEmptyString(body.correlation_id, 200);
      if (
        !SAFE_ID.test(pipelineJobId) ||
        (transition !== "promote" && transition !== "rollback") ||
        !targetResultId ||
        !SAFE_ID.test(targetResultId) ||
        !expectedActiveResultId ||
        !SAFE_ID.test(expectedActiveResultId) ||
        !reason ||
        !correlationId ||
        !SAFE_ID.test(correlationId)
      ) {
        response.status(400).json({ error: "invalid_activation_intent_request" });
        return;
      }
      const now = deps.now();
      try {
        const principal = await resolvePrincipal(deps, request, now);
        const capability =
          transition === "promote" ? "result.promote" : "result.rollback";
        // Intent creation itself is protected: authorize the exact target/pointer snapshot before
        // looking up job/result state. Confirm later re-verifies a second nonce-bound decision.
        await verifyDecision(
          deps,
          request,
          principal,
          {
            capability,
            principal_subject: principal.subject,
            method: "POST",
            path: request.path,
            resource: {
              kind: "result_activation_intent",
              pipeline_job_id: pipelineJobId,
              target_result_id: targetResultId,
              expected_active_result_id: expectedActiveResultId,
              transition,
              correlation_id: correlationId,
            },
          },
          now,
        );
        if (!deps.jobs.get(pipelineJobId)) {
          response.status(404).json({ error: "pipeline_job_not_found" });
          return;
        }
        const intentId = deps.newIntentId();
        const intentNonce = deps.newIntentNonce();
        const expiresAt = new Date(Date.parse(now) + PIPELINE_RESULT_INTENT_TTL_MS).toISOString();
        const created = deps.results.createActivationIntent({
          intent_id: intentId,
          intent_nonce: intentNonce,
          pipeline_job_id: pipelineJobId,
          target_result_id: targetResultId,
          expected_active_result_id: expectedActiveResultId,
          transition,
          capability,
          reason,
          actor: {
            actor_kind: principal.actor_kind,
            actor_id: principal.subject,
          },
          correlation_id: correlationId,
          created_at: now,
          expires_at: expiresAt,
        });
        response.status(created.replay ? 200 : 201).json({
          intent_id: created.intent.intent_id,
          state: created.intent.state,
          replay: created.replay,
          required_capability: created.intent.capability,
          expires_at: created.intent.expires_at,
          authorization_request: {
            intent_nonce: intentNonce,
            pipeline_job_id: created.intent.pipeline_job_id,
            target_result_id: created.intent.target_result_id,
            expected_active_result_id: created.intent.expected_active_result_id,
            transition: created.intent.transition,
            correlation_id: created.intent.correlation_id,
          },
        });
      } catch (error) {
        handleRouteError(error, response);
      }
    },
  );

  app.post(
    "/api/lineage/pipeline-jobs/:pipelineJobId/result-actions/confirm",
    async (request, response) => {
      noStore(response);
      const pipelineJobId = request.params.pipelineJobId;
      const body = isPlainObject(request.body) ? request.body : {};
      const intentId = nonEmptyString(body.intent_id, 200);
      if (!SAFE_ID.test(pipelineJobId) || !intentId || !SAFE_ID.test(intentId)) {
        response.status(400).json({ error: "invalid_activation_confirm_request" });
        return;
      }
      const now = deps.now();
      try {
        const principal = await resolvePrincipal(deps, request, now);
        const intent = deps.results.getActivationIntent(intentId);
        if (!intent || intent.pipeline_job_id !== pipelineJobId) {
          authorizationDenied(response);
          return;
        }
        if (
          principal.subject !== intent.actor.actor_id ||
          principal.actor_kind !== intent.actor.actor_kind
        ) {
          authorizationDenied(response);
          return;
        }
        const verified = await verifyDecision(
          deps,
          request,
          principal,
          {
            capability: intent.capability,
            principal_subject: principal.subject,
            method: "POST",
            path: request.path,
            resource: activationBinding(intent),
          },
          now,
        );
        if (verified.capability !== "result.promote" && verified.capability !== "result.rollback") {
          throw new LineageAuthorizationDeniedError("decision capability is not a result action");
        }
        const decision: VerifiedExternalResultDecision = {
          authorization_decision_ref: verified.authorization_decision_ref,
          issuer: verified.issuer,
          audience: verified.audience,
          subject: verified.subject,
          capability: verified.capability,
          jti: verified.jti,
          issued_at: verified.issued_at,
          not_before: verified.not_before,
          expires_at: verified.expires_at,
          verified_at: verified.verified_at,
        };
        const confirmed = deps.results.confirmActivationIntent({
          intent_id: intent.intent_id,
          decision,
          now,
        });
        if (confirmed.outcome === "rejected_stale") {
          response.status(409).json({
            error: "stale_activation_intent",
            replay: confirmed.replay,
            intent_id: confirmed.intent.intent_id,
            observed_active_result_id: confirmed.observed_active_result_id,
          });
          return;
        }
        response.status(200).json({
          outcome: confirmed.outcome,
          replay: confirmed.replay,
          intent_id: confirmed.intent.intent_id,
          active_result_pointer: confirmed.active_result_pointer,
          activation_audit_entry: confirmed.activation_audit_entry,
        });
      } catch (error) {
        handleRouteError(error, response);
      }
    },
  );
}
