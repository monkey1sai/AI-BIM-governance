import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReadyRenderBundle, ReadyReviewSourceSnapshot } from "../types.js";

const requestIdSchema = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => value === value.trim());
const explicitIntentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create_new"), request_id: requestIdSchema }).strict(),
  z.object({
    mode: z.literal("open_existing"),
    session_id: z.string().regex(/^review_session_[A-Za-z0-9_-]+$/)
      .refine((value) => value === value.trim()),
  }).strict(),
]);

export type ReadyReviewIntent = { mode: "legacy" } | z.infer<typeof explicitIntentSchema>;

/** Parse explicit intent while retaining the legacy empty-body contract. */
export function parseReadyReviewIntent(body: unknown): ReadyReviewIntent {
  if (body !== null && typeof body === "object" && !Array.isArray(body)
    && Object.getPrototypeOf(body) === Object.prototype && Object.keys(body).length === 0) {
    return { mode: "legacy" };
  }
  return explicitIntentSchema.parse(body);
}

export interface ReadyReviewRequestIdentity {
  scopeDigest: string;
  fingerprint: string;
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

/** Identity only: callers must supply a server-resolved bundle and enforce authorization. */
export function identifyReadyReviewRequest(
  bundle: ReadyRenderBundle,
  requestId: string,
): ReadyReviewRequestIdentity {
  const key = requestIdSchema.parse(requestId);
  return {
    scopeDigest: digest(["ready-review-create/v1", bundle.tenantId, bundle.projectId, key]),
    fingerprint: digest([
      "ready-review-source/v1", bundle.readyModelId, bundle.tenantId, bundle.projectId,
      bundle.modelVersionId, bundle.conversionJobId, bundle.correlationId, bundle.rootTraceId,
      bundle.model.url, bundle.model.sha256, bundle.mapping.url, bundle.mapping.sha256,
    ]),
  };
}

const sourceSnapshotSchema = z.object({
  schema_version: z.literal("ready-review-source/v1"),
  ready_model_id: z.string().regex(/^mw_[a-f0-9]{16}$/),
  conversion_job_id: z.string().min(1),
  correlation_id: z.string().min(1), root_trace_id: z.string().min(1),
  tenant_id: z.string().min(1), project_id: z.string().min(1), model_version_id: z.string().min(1),
  model: z.object({url: z.string().min(1), sha256: z.string().length(64).regex(/^[a-f0-9]+$/)}).strict(),
  mapping: z.object({url: z.string().min(1), sha256: z.string().length(64).regex(/^[a-f0-9]+$/)}).strict(),
}).strict();
export function readyReviewSourceSnapshot(b: ReadyRenderBundle): ReadyReviewSourceSnapshot {
  return sourceSnapshotSchema.parse({
    schema_version: "ready-review-source/v1", ready_model_id: b.readyModelId,
    conversion_job_id: b.conversionJobId, correlation_id: b.correlationId, root_trace_id: b.rootTraceId,
    tenant_id: b.tenantId, project_id: b.projectId, model_version_id: b.modelVersionId,
    model: {...b.model}, mapping: {...b.mapping},
  });
}
export function isReadyReviewSourceSnapshot(value: unknown): value is ReadyReviewSourceSnapshot {
  return sourceSnapshotSchema.safeParse(value).success;
}
export function fingerprintReadyReviewSource(source: ReadyReviewSourceSnapshot): string {
  const s = sourceSnapshotSchema.parse(source);
  return digest([s.schema_version, s.ready_model_id, s.tenant_id, s.project_id, s.model_version_id,
    s.conversion_job_id, s.correlation_id, s.root_trace_id, s.model.url, s.model.sha256,
    s.mapping.url, s.mapping.sha256]);
}
