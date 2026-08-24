import { z } from "zod";
import {
  assertLocatorConsistent,
  isSha256,
  isUtcTimestamp,
  type MinioLocator,
} from "./minioLocator.js";
import type { PipelineResultView } from "./pipelineResultStore.js";

export const PIPELINE_RESULT_ARTIFACT_IDS = [
  "usdc",
  "element_mapping",
  "entity_index",
  "bbox_index",
  "spatial_index",
  "pset_index",
  "alignment_report_json",
  "alignment_report_csv",
  "quality_report",
] as const;

export type PipelineResultArtifactId = (typeof PIPELINE_RESULT_ARTIFACT_IDS)[number];

export interface PipelineResultArtifactDescriptor {
  pipeline_job_id: string;
  result_id: string;
  attempt_id: string;
  source_bundle_id: string;
  external_model_version_id: string;
  /** Immutable manifest object used by the reader. */
  result_manifest_ref: string;
  /** Digest verified by the reader before returning an artifact. */
  result_manifest_digest: string;
  /** Task 3.4 uses the closed result-manifest role as its stable artifact id. */
  artifact_id: PipelineResultArtifactId;
  role: PipelineResultArtifactId;
  locator: MinioLocator;
  published_at: string;
  filename: string | null;
  content_type: string | null;
}

export interface PipelineResultArtifactReaderPort {
  /**
   * Read one artifact from the exact version/digest-bound result manifest represented by result.
   * The route validates the returned runtime value again; null means the role is absent.
   */
  readArtifact(
    result: PipelineResultView,
    artifactId: PipelineResultArtifactId,
  ): Promise<PipelineResultArtifactDescriptor | null>;
}

export class PipelineResultArtifactDetailUnavailableError extends Error {
  readonly code = "artifact_detail_unavailable";
  readonly httpStatus = 503;

  constructor(detail = "result artifact detail reader is unavailable") {
    super(detail);
    this.name = "PipelineResultArtifactDetailUnavailableError";
  }
}

export class PipelineResultArtifactIntegrityUnavailableError extends Error {
  readonly code = "artifact_integrity_unavailable";
  readonly httpStatus = 503;

  constructor(detail = "result artifact evidence failed integrity validation") {
    super(detail);
    this.name = "PipelineResultArtifactIntegrityUnavailableError";
  }
}

const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/);
const boundedPrintable = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const descriptorSchema = z
  .object({
    pipeline_job_id: safeId,
    result_id: safeId,
    attempt_id: safeId,
    source_bundle_id: safeId,
    external_model_version_id: safeId,
    result_manifest_ref: boundedPrintable(8_192),
    result_manifest_digest: z.string().refine(isSha256),
    artifact_id: z.enum(PIPELINE_RESULT_ARTIFACT_IDS),
    role: z.enum(PIPELINE_RESULT_ARTIFACT_IDS),
    locator: z
      .object({
        ref: boundedPrintable(8_192),
        object_version_id: boundedPrintable(1_024),
        etag: boundedPrintable(1_024),
        sha256: z.string().refine(isSha256),
        size_bytes: z.number().int().safe().positive(),
      })
      .strict(),
    published_at: z.string().refine(isUtcTimestamp),
    filename: boundedPrintable(255)
      .refine((value) => !/[\\/]/.test(value))
      .nullable(),
    content_type: boundedPrintable(200).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.artifact_id !== value.role) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifact_id must equal the result manifest role",
      });
    }
    if (assertLocatorConsistent(value.locator) !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "artifact locator is not immutable and internally consistent",
      });
    }
  });

export function isPipelineResultArtifactId(value: unknown): value is PipelineResultArtifactId {
  return (
    typeof value === "string" &&
    (PIPELINE_RESULT_ARTIFACT_IDS as readonly string[]).includes(value)
  );
}

/** Exhaustive runtime validation for output from a deployment-owned manifest reader. */
export function parsePipelineResultArtifactDescriptor(
  value: unknown,
): PipelineResultArtifactDescriptor | null {
  const parsed = descriptorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
