// bim-review-coordinator/src/services/lineage/lineageMetadataProjections.ts
//
// Task 3.4 metadata surfaces 的**投影讀取面**（governance console 的 read model）。
//
// 為什麼獨立成一個 port 而不是讓 route 直接讀 MinIO：route 必須能在「reader 未接線」
// 時誠實回 `NOT_BUILT`，而不是回一個空陣列假裝「沒有 artifact」。有沒有 reader 是
// composition root 的事實，route 只讀它。
//
// 三條誠實鐵律：
//   1. 讀不到／驗不過 → 擲 typed error（route → 503），**絕不**降級成 `NOT_BUILT`
//      ——`NOT_BUILT` 的語意是「這個部署沒有建這條讀取路徑」，不是「這次讀失敗了」。
//   2. digest 一律以實讀 bytes 為準，並與 store 記錄比對（result manifest 走
//      `readPipelineResultManifest`，source bundle manifest 比 `manifest_sha256`）。
//   3. 只投影 manifest 已經宣告的欄位，不做任何推導或補值。
import {
  isRefParseFailure,
  parseMinioRef,
} from "./minioLocator.js";
import {
  PipelineResultManifestReadError,
  readPipelineResultManifest,
  type PipelineResultManifestAlignmentSummary,
  type PipelineResultManifestArtifact,
  type PipelineResultManifestReadDeps,
} from "./pipelineResultManifest.js";
import { parseSourceBundleManifest, type BundleArtifact } from "./sourceBundleManifest.js";
import { MANIFEST_MAX_BYTES } from "./sourceBundleValidator.js";
import {
  SourceBundleAccessDeniedError,
  SourceBundleObjectTooLargeError,
} from "./sourceBundleObjectPort.js";
import type { PipelineResultView } from "./pipelineResultStore.js";
import type { SourceBundleRecord } from "./sourceBundleStore.js";

/** manifest 已宣告的 artifact 投影（source bundle 與 result 兩側共用同一形狀）。 */
export interface LineageArtifactProjection {
  role: string;
  ref: string;
  object_version_id: string;
  etag: string;
  sha256: string;
  size_bytes: number;
  /** source bundle manifest 的 artifact 不帶 published_at。 */
  published_at: string | null;
  filename: string | null;
  content_type: string | null;
}

export interface LineageResultManifestProjection {
  result_id: string;
  attempt_id: string;
  /** 實讀 bytes 的 digest（與 store 記錄相符才會走到這裡）。 */
  result_manifest_digest: string;
  converter: {
    converter_id: string;
    converter_version: string;
    runtime_profile: string;
  };
  metrics: PipelineResultManifestAlignmentSummary["metrics"];
  counts: PipelineResultManifestAlignmentSummary["counts"];
  warning_codes: string[];
  artifacts: LineageArtifactProjection[];
}

export interface LineageMetadataProjectionReaderPort {
  /** 由 governed MinIO 讀該 result 的 manifest 並投影成 read model。 */
  readResultManifest(result: PipelineResultView): Promise<LineageResultManifestProjection>;
  /** 由 governed MinIO 讀該 bundle 的 `manifest.json` 並投影其 artifacts。 */
  readSourceBundleArtifacts(
    bundle: Pick<SourceBundleRecord, "source_bundle_id" | "manifest_ref" | "manifest_sha256">,
  ): Promise<LineageArtifactProjection[]>;
}

/**
 * 投影讀取失敗。
 *
 * 與 `NOT_BUILT` 嚴格區分：這個錯誤代表「路徑接了但這次讀不到／驗不過」，route 必須
 * 讓它變成 503，而不是把它包裝成一個看起來像「本來就沒建」的 provenance。
 */
export class LineageMetadataProjectionUnavailableError extends Error {
  readonly code = "lineage_metadata_projection_unavailable";

  constructor(detail: string) {
    super(detail);
    this.name = "LineageMetadataProjectionUnavailableError";
  }
}

function projectResultArtifact(
  artifact: PipelineResultManifestArtifact,
): LineageArtifactProjection {
  return {
    role: artifact.role,
    ref: artifact.ref,
    object_version_id: artifact.object_version_id,
    etag: artifact.etag,
    sha256: artifact.sha256,
    size_bytes: artifact.size_bytes,
    published_at: artifact.published_at,
    filename: artifact.filename ?? null,
    content_type: artifact.content_type ?? null,
  };
}

function projectBundleArtifact(artifact: BundleArtifact): LineageArtifactProjection {
  return {
    role: artifact.role,
    ref: artifact.ref,
    object_version_id: artifact.object_version_id,
    etag: artifact.etag,
    sha256: artifact.sha256,
    size_bytes: artifact.size_bytes,
    // source bundle manifest 的 artifact 契約不含 published_at；不得補值。
    published_at: null,
    filename: artifact.filename ?? null,
    content_type: artifact.content_type ?? null,
  };
}

export function createS3LineageMetadataProjectionReader(
  deps: PipelineResultManifestReadDeps,
): LineageMetadataProjectionReaderPort {
  return {
    async readResultManifest(
      result: PipelineResultView,
    ): Promise<LineageResultManifestProjection> {
      let read;
      try {
        read = await readPipelineResultManifest(
          {
            ref: result.result_manifest_ref,
            sha256: result.result_manifest_digest,
            etag: null,
            size_bytes: null,
          },
          { objects: deps.objects },
        );
      } catch (error) {
        if (error instanceof SourceBundleAccessDeniedError) {
          throw new LineageMetadataProjectionUnavailableError(
            `result ${result.result_id} manifest locator is not governed by this deployment`,
          );
        }
        if (error instanceof PipelineResultManifestReadError) {
          throw new LineageMetadataProjectionUnavailableError(
            `result ${result.result_id} manifest is unreadable (${error.code})`,
          );
        }
        throw error;
      }
      const manifest = read.manifest;
      if (
        manifest.result_id !== result.result_id ||
        manifest.attempt_id !== result.attempt_id ||
        manifest.pipeline_job_id !== result.pipeline_job_id
      ) {
        throw new LineageMetadataProjectionUnavailableError(
          `result ${result.result_id} manifest identity does not match the result record`,
        );
      }
      return {
        result_id: manifest.result_id,
        attempt_id: manifest.attempt_id,
        result_manifest_digest: read.observed_sha256,
        converter: { ...manifest.converter },
        metrics: { ...manifest.alignment_summary.metrics },
        counts: { ...manifest.alignment_summary.counts },
        warning_codes: [...manifest.alignment_summary.warning_codes],
        artifacts: manifest.artifacts.map(projectResultArtifact),
      };
    },

    async readSourceBundleArtifacts(
      bundle: Pick<SourceBundleRecord, "source_bundle_id" | "manifest_ref" | "manifest_sha256">,
    ): Promise<LineageArtifactProjection[]> {
      const parsed = parseMinioRef(bundle.manifest_ref);
      if (isRefParseFailure(parsed)) {
        throw new LineageMetadataProjectionUnavailableError(
          `source bundle ${bundle.source_bundle_id} manifest_ref is not a governed locator`,
        );
      }
      let head;
      let rawBytes;
      try {
        head = await deps.objects.headVersioned(parsed);
        if (head === null) {
          throw new LineageMetadataProjectionUnavailableError(
            `source bundle ${bundle.source_bundle_id} manifest object version does not exist`,
          );
        }
        // 與 result manifest 同款雙門：HEAD 宣告先擋，streaming tally 為第二道。
        if (head.sizeBytes > MANIFEST_MAX_BYTES) {
          throw new LineageMetadataProjectionUnavailableError(
            `source bundle ${bundle.source_bundle_id} manifest exceeds the bounded read limit`,
          );
        }
        rawBytes = await deps.objects.getBytesVersioned(parsed, MANIFEST_MAX_BYTES);
      } catch (error) {
        if (error instanceof LineageMetadataProjectionUnavailableError) throw error;
        if (error instanceof SourceBundleAccessDeniedError) {
          throw new LineageMetadataProjectionUnavailableError(
            `source bundle ${bundle.source_bundle_id} manifest locator is not governed by this deployment`,
          );
        }
        if (error instanceof SourceBundleObjectTooLargeError) {
          throw new LineageMetadataProjectionUnavailableError(
            `source bundle ${bundle.source_bundle_id} manifest exceeds the bounded read limit`,
          );
        }
        throw error;
      }
      const parseResult = parseSourceBundleManifest(rawBytes);
      if (!parseResult.ok) {
        throw new LineageMetadataProjectionUnavailableError(
          `source bundle ${bundle.source_bundle_id} manifest does not satisfy the governed contract`,
        );
      }
      // store 記錄的 digest 是驗過的事實；實讀不符代表 object 事後被換過。
      if (parseResult.sha256 !== bundle.manifest_sha256) {
        throw new LineageMetadataProjectionUnavailableError(
          `source bundle ${bundle.source_bundle_id} manifest digest no longer matches the admitted evidence`,
        );
      }
      return parseResult.manifest.artifacts.map(projectBundleArtifact);
    },
  };
}
