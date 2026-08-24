import { isIP } from "node:net";
import { z } from "zod";
import {
  isUtcTimestamp,
  utcTimestampToMicros,
  type MinioLocator,
  type ParsedRef,
} from "./minioLocator.js";
import type { PipelineResultArtifactId } from "./pipelineResultArtifactReader.js";

export const LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS = 300;

export interface LineageArtifactDownloadTargetPolicy {
  authority: string;
  bucket: string;
  /** Exact browser-visible HTTPS origin; IP literals and local-only host suffixes are forbidden. */
  public_origin: string;
  /** Exact path-style prefix which already includes the bucket, for example `/lineage-results/`. */
  object_path_prefix: string;
}

export interface LineageArtifactDownloadTarget {
  pipeline_job_id: string;
  result_id: string;
  artifact_id: PipelineResultArtifactId;
  locator: MinioLocator;
  parsed_ref: ParsedRef;
  public_origin: string;
  object_path: string;
  filename: string | null;
  content_type: string | null;
}

export interface LineageArtifactDownloadSignerInput {
  target: LineageArtifactDownloadTarget;
  requested_at: string;
  /** Hard safety ceiling. A deployment adapter may issue a shorter-lived URL. */
  max_ttl_seconds: number;
}

export interface LineageArtifactSignedDownload {
  kind: "presigned_get";
  url: string;
  expires_at: string;
  /** Echoed non-secret binding; the route also validates the actual URL target. */
  bound_ref: string;
  object_version_id: string;
  supports_range: true;
}

export interface LineageArtifactDownloadSignerPort {
  /**
   * Sign a versioned GetObject using parsed_ref Bucket/Key/VersionId and the resolved public
   * target. Implementations must never follow redirects or caller-supplied URLs.
   */
  sign(input: LineageArtifactDownloadSignerInput): Promise<LineageArtifactSignedDownload>;
}

export class LineageArtifactDownloadUnavailableError extends Error {
  readonly code = "artifact_download_unavailable";
  readonly httpStatus = 503;

  constructor(detail = "version-aware artifact download signer is unavailable") {
    super(detail);
    this.name = "LineageArtifactDownloadUnavailableError";
  }
}

function normalizedPublicOrigin(value: string): string | null {
  if (value.length > 2_048 || /[\r\n]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    const parsedHostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const hostname = parsedHostname.endsWith(".")
      ? parsedHostname.slice(0, -1)
      : parsedHostname;
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value ||
      isIP(hostname) !== 0 ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function isCanonicalObjectPathPrefix(value: string): boolean {
  return (
    value.length <= 2_048 &&
    /^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value) &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function isCanonicalDownloadObjectKey(value: string): boolean {
  return (
    value.length <= 8_192 &&
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(value) &&
    !value.split("/").some((segment) => segment === "." || segment === "..")
  );
}

export function resolveLineageArtifactDownloadTarget(input: {
  policies: readonly LineageArtifactDownloadTargetPolicy[];
  parsed_ref: ParsedRef;
}): { public_origin: string; object_path: string } | null {
  if (!isCanonicalDownloadObjectKey(input.parsed_ref.objectKey)) return null;
  const matches = input.policies.filter(
    (policy) =>
      /^[A-Za-z0-9._-]+$/.test(policy.authority) &&
      /^[A-Za-z0-9._-]+$/.test(policy.bucket) &&
      policy.authority === input.parsed_ref.authority &&
      policy.bucket === input.parsed_ref.bucket &&
      normalizedPublicOrigin(policy.public_origin) !== null &&
      isCanonicalObjectPathPrefix(policy.object_path_prefix),
  );
  if (matches.length !== 1) return null;
  return {
    public_origin: matches[0].public_origin,
    object_path: `${matches[0].object_path_prefix}${input.parsed_ref.objectKey}`,
  };
}

function isSafePresignedHttpsUrl(value: string): boolean {
  if (value.length > 16_384 || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.href === value &&
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === "" &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

const signedDownloadSchema = z
  .object({
    kind: z.literal("presigned_get"),
    url: z.string().min(1).refine(isSafePresignedHttpsUrl),
    expires_at: z.string().refine(isUtcTimestamp),
    bound_ref: z.string().min(1).max(8_192).refine((value) => !/[\r\n]/.test(value)),
    object_version_id: z.string().min(1).max(1_024).refine((value) => !/[\r\n]/.test(value)),
    supports_range: z.literal(true),
  })
  .strict();

/** Runtime gate for output from the deployment-owned signer adapter. */
export function parseLineageArtifactSignedDownload(
  value: unknown,
): LineageArtifactSignedDownload | null {
  const parsed = signedDownloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function awsSigningInstantMillis(value: string): number | null {
  const matched = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!matched) return null;
  const parts = matched.slice(1).map(Number);
  const millis = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  const canonical = new Date(millis)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".000", "");
  return canonical === value ? millis : null;
}

const REQUIRED_SIGV4_QUERY_KEYS = [
  "versionId",
  "X-Amz-Algorithm",
  "X-Amz-Content-Sha256",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Signature",
  "X-Amz-SignedHeaders",
  "x-amz-checksum-mode",
  "x-id",
] as const;
const OPTIONAL_SIGV4_QUERY_KEYS = new Set(["X-Amz-Security-Token"]);
const ALLOWED_SIGV4_QUERY_KEYS = new Set<string>([
  ...REQUIRED_SIGV4_QUERY_KEYS,
  ...OPTIONAL_SIGV4_QUERY_KEYS,
]);

/** Executable binding between the returned URL and the exact pinned-SDK SigV4 object request. */
export function isLineageArtifactSignedTargetBound(input: {
  download: LineageArtifactSignedDownload;
  target: LineageArtifactDownloadTarget;
  requested_at: string;
  max_ttl_seconds: number;
}): boolean {
  try {
    const parsed = new URL(input.download.url);
    for (const key of parsed.searchParams.keys()) {
      if (!ALLOWED_SIGV4_QUERY_KEYS.has(key)) return false;
    }
    for (const key of REQUIRED_SIGV4_QUERY_KEYS) {
      if (parsed.searchParams.getAll(key).length !== 1) return false;
    }
    if (parsed.searchParams.getAll("X-Amz-Security-Token").length > 1) return false;
    const securityToken = parsed.searchParams.get("X-Amz-Security-Token");
    if (
      securityToken !== null &&
      (securityToken.length === 0 ||
        securityToken.length > 8_192 ||
        /[\u0000-\u001f\u007f]/.test(securityToken))
    ) {
      return false;
    }
    const signingDate = parsed.searchParams.get("X-Amz-Date") ?? "";
    const credential = parsed.searchParams.get("X-Amz-Credential") ?? "";
    const credentialMatch =
      /^([A-Za-z0-9][A-Za-z0-9._-]{2,127})\/(\d{8})\/([a-z0-9-]{1,63})\/s3\/aws4_request$/.exec(
        credential,
      );
    if (
      parsed.origin !== input.target.public_origin ||
      parsed.pathname !== input.target.object_path ||
      parsed.searchParams.get("versionId") !== input.target.parsed_ref.versionId ||
      parsed.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      parsed.searchParams.get("X-Amz-Content-Sha256") !== "UNSIGNED-PAYLOAD" ||
      parsed.searchParams.get("X-Amz-SignedHeaders") !== "host" ||
      parsed.searchParams.get("x-amz-checksum-mode") !== "ENABLED" ||
      parsed.searchParams.get("x-id") !== "GetObject" ||
      !credentialMatch ||
      credentialMatch[2] !== signingDate.slice(0, 8) ||
      !/^[0-9a-f]{64}$/.test(parsed.searchParams.get("X-Amz-Signature") ?? "") ||
      signingDate.length === 0
    ) {
      return false;
    }
    const signingMillis = awsSigningInstantMillis(signingDate);
    const expiresText = parsed.searchParams.get("X-Amz-Expires") ?? "";
    if (!/^[1-9][0-9]{0,2}$/.test(expiresText)) return false;
    const expiresSeconds = Number(expiresText);
    if (
      signingMillis === null ||
      expiresSeconds > input.max_ttl_seconds ||
      input.download.bound_ref !== input.target.locator.ref ||
      input.download.object_version_id !== input.target.locator.object_version_id
    ) {
      return false;
    }
    const signingMicros = BigInt(signingMillis) * 1_000n;
    const requestedMicros = utcTimestampToMicros(input.requested_at);
    if (signingMicros > requestedMicros || requestedMicros - signingMicros > 60_000_000n) {
      return false;
    }
    const declaredExpiresMicros = utcTimestampToMicros(input.download.expires_at);
    const signedExpiresMicros = signingMicros + BigInt(expiresSeconds) * 1_000_000n;
    return declaredExpiresMicros === signedExpiresMicros;
  } catch {
    return false;
  }
}
