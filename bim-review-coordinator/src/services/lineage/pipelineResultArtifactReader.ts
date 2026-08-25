import { z } from "zod";
import {
  assertLocatorConsistent,
  isSha256,
  isUtcTimestamp,
  minioRefBelongsToPrefix,
  type MinioLocator,
} from "./minioLocator.js";
import {
  PipelineResultManifestReadError,
  readPipelineResultManifest,
  RESULT_MANIFEST_ARTIFACT_ROLES,
  type PipelineResultManifestReadDeps,
} from "./pipelineResultManifest.js";
import { SourceBundleAccessDeniedError } from "./sourceBundleObjectPort.js";
import type { PipelineResultView } from "./pipelineResultStore.js";

/**
 * Task 3.4 的穩定 artifact id ＝ result manifest 的 role 詞彙（單一正本）。
 *
 * 正本定義在 `pipelineResultManifest.ts`；這裡只 re-export，**不得**改成本地副本——
 * 兩份清單一旦漂移，download route 認得的 id 就會與 manifest 能提供的 role 不同。
 */
export const PIPELINE_RESULT_ARTIFACT_IDS = RESULT_MANIFEST_ARTIFACT_ROLES;

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

/**
 * 生產 adapter 的相依：與 registration／detail reader **同一條** manifest 讀取／驗證管道
 * （`pipelineResultManifest.ts`）。三個消費者共用一套 parse，不可能長出第二套契約解讀。
 */
export type S3PipelineResultArtifactReaderDeps = PipelineResultManifestReadDeps;

/**
 * 讀取失敗的兩種誠實分類。
 *
 * * **integrity**：證據自相矛盾（digest／etag／size 不符、locator 壞掉、契約不合格）——
 *   東西在，但它不是 store 記錄所描述的那份。
 * * **detail**：拿不到（不存在、超出有界讀上限、allowlist 不允許）。
 *
 * 兩者在 route 都是 503，但錯誤碼不同：運維要能分辨「MinIO 被改壞」與「這份部署讀不到」。
 */
function classifyManifestReadFailure(error: PipelineResultManifestReadError): Error {
  switch (error.failure) {
    case "etag_mismatch":
    case "size_mismatch":
    case "digest_mismatch":
    case "locator_malformed":
    case "schema_invalid":
      return new PipelineResultArtifactIntegrityUnavailableError(
        `result manifest evidence failed validation (${error.code})`,
      );
    default:
      return new PipelineResultArtifactDetailUnavailableError(
        `result manifest is unreadable (${error.code})`,
      );
  }
}

/**
 * 生產 artifact reader：由 governed MinIO 讀 `result-manifest.json`，取出指定 role 的
 * artifact 並投影成 descriptor。
 *
 * 誠實鐵律：
 *   1. **role 缺席回 `null`**（route 據此回 404 `artifact_not_found`），不是錯誤，也不捏造 locator。
 *   2. digest 以實讀 bytes 為準並與 store 的 `result_manifest_digest` 比對（由讀取管道完成）。
 *   3. artifact 必須落在 `result.result_prefix` 之下——route 的 `assertDescriptorBinding`
 *      也會再驗一次，這裡先擋是為了讓越界引用在**簽章鏈之外**就終止。
 *   4. 回傳前用本檔既有的 `parsePipelineResultArtifactDescriptor` 重驗（例如 `size_bytes`
 *      必須為正：0 byte 的 artifact 不是可下載的東西）。
 */
export function createS3PipelineResultArtifactReader(
  deps: S3PipelineResultArtifactReaderDeps,
): PipelineResultArtifactReaderPort {
  return {
    async readArtifact(
      result: PipelineResultView,
      artifactId: PipelineResultArtifactId,
    ): Promise<PipelineResultArtifactDescriptor | null> {
      let read;
      try {
        read = await readPipelineResultManifest(
          {
            ref: result.result_manifest_ref,
            // store 記錄只釘 ref 與 digest；etag／size 是 HEAD 的觀測結果，沒有 claim 可比。
            sha256: result.result_manifest_digest,
            etag: null,
            size_bytes: null,
          },
          { objects: deps.objects },
        );
      } catch (error) {
        if (error instanceof SourceBundleAccessDeniedError) {
          throw new PipelineResultArtifactDetailUnavailableError(
            "result manifest locator is not governed by this deployment",
          );
        }
        if (error instanceof PipelineResultManifestReadError) {
          throw classifyManifestReadFailure(error);
        }
        throw error;
      }

      // manifest 合格 ≠ 它描述的是這個 result；identity 必須逐欄對上 store 記錄。
      const manifest = read.manifest;
      if (
        manifest.result_id !== result.result_id ||
        manifest.attempt_id !== result.attempt_id ||
        manifest.pipeline_job_id !== result.pipeline_job_id ||
        manifest.source_bundle_id !== result.source_bundle_id ||
        manifest.external_model_version_id !== result.external_model_version_id
      ) {
        throw new PipelineResultArtifactIntegrityUnavailableError(
          `result manifest identity does not match result ${result.result_id}`,
        );
      }

      const artifact = manifest.artifacts.find((item) => item.role === artifactId);
      // role 缺席是**正常的部分結果**（例如 audit-only manifest 沒有 quality_report）。
      if (!artifact) return null;

      if (!minioRefBelongsToPrefix(result.result_prefix, artifact.ref)) {
        throw new PipelineResultArtifactIntegrityUnavailableError(
          `artifact ${artifactId} ref is outside the result prefix`,
        );
      }

      const descriptor = parsePipelineResultArtifactDescriptor({
        pipeline_job_id: result.pipeline_job_id,
        result_id: result.result_id,
        attempt_id: result.attempt_id,
        source_bundle_id: result.source_bundle_id,
        external_model_version_id: result.external_model_version_id,
        result_manifest_ref: result.result_manifest_ref,
        result_manifest_digest: read.observed_sha256,
        artifact_id: artifactId,
        role: artifact.role,
        locator: {
          ref: artifact.ref,
          object_version_id: artifact.object_version_id,
          etag: artifact.etag,
          sha256: artifact.sha256,
          size_bytes: artifact.size_bytes,
        },
        published_at: artifact.published_at,
        filename: artifact.filename ?? null,
        content_type: artifact.content_type ?? null,
      });
      if (!descriptor) {
        throw new PipelineResultArtifactIntegrityUnavailableError(
          `artifact ${artifactId} does not project a contract-valid descriptor`,
        );
      }
      return descriptor;
    },
  };
}
