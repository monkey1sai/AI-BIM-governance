import { isIP } from "node:net";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
  /**
   * The path-style prefix the signed URL will carry, which **must be exactly**
   * `` `/${bucket}/` `` — a leading slash, the same bucket named above, one trailing slash.
   *
   * This is an equality rule, not a shape rule with an illustrative example. Under
   * `forcePathStyle: true` with a `public_origin` whose pathname is `/`, the SigV4 signer
   * emits `/<bucket>/<objectKey>` and the route compares the resulting pathname to
   * `object_path_prefix + objectKey` verbatim. Any other value — a different bucket, a
   * `/downloads/` style vanity path — produces a URL whose pathname can never match, so the
   * download surface returns 503 for every artifact. Both the env schema and
   * `resolveLineageArtifactDownloadTarget` assert the equality.
   */
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

/**
 * 可簽章 object key 的字集，刻意窄於 S3 允許的 key 空間。
 *
 * **這是 documented limit，不是疏漏**：只放行 `A-Za-z0-9._~-` 與 `/`。因此 key 含
 * `+`、`=`、`(`、`)`、空白或任何非 ASCII 字元的 artifact **永久回 503**，不會被簽出
 * 一個 URL——那是刻意的 fail-closed：這些字元在 presign 的 canonical URI 編碼、
 * 瀏覽器位址列與中介 proxy 三者之間的處理並不一致，簽章能過不代表下載端拿到的是
 * 同一個 key。與其簽一個「可能對」的 URL，不如拒絕。
 *
 * 本 repo 的 key 慣例不受影響：governed result prefix 是
 * `<model-version>/results/<attempt-id>/<filename>`，watcher 端的中文物件名也早已
 * 正規化成 `mv_<hash8>`（見 CONTEXT.md 的 MinIO key 慣例）。真的需要更寬的字集時，
 * 應該是先擴 `resolveLineageArtifactDownloadTarget` 的 canonical 規則並補反例語料，
 * 不是在這裡放寬。
 */
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
      isCanonicalObjectPathPrefix(policy.object_path_prefix) &&
      // 簽章邊界再自證一次（與 `createS3LineageArtifactDownloadSigner` 對 public_origin
      // 的重驗同一哲學）：`parseLineageArtifactDownloadTargetPolicies` 的 schema 已經擋過
      // 這條，但 policy 陣列是一個**可直接建構**的參數——測試、未來的 config 來源或任何
      // 繞過 env 解析的呼叫端都能塞進一個 `/downloads/`。沒有這一行，那種 policy 會被
      // 當成唯一命中、簽出一個 pathname 永遠對不上的 URL，然後在 route 的綁定檢查才
      // 以無因的 503 收場。
      policy.object_path_prefix === `/${policy.bucket}/`,
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

/**
 * Executable binding between the returned URL and the SigV4 object request the adapter signs.
 *
 * The query-key set below is a **closed set**, not a claim that the SDK version is pinned:
 * `@aws-sdk/*` is declared as `^3.1067.0`, so a lockfile bump can legitimately add or rename a
 * query parameter. That is exactly why the set is closed — an unexpected key makes this
 * predicate return `false`, the route raises `artifact_download_unavailable`, and the adapter
 * test turns red on the bump instead of silently widening what a signed URL may contain.
 * Fail-closed by construction: the review happens when the SDK changes, not after.
 */
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

const targetPolicySchema = z
  .object({
    authority: z.string().min(1).max(253).regex(/^[A-Za-z0-9._-]+$/),
    bucket: z.string().min(1).max(253).regex(/^[A-Za-z0-9._-]+$/),
    public_origin: z.string().min(1).refine((value) => normalizedPublicOrigin(value) !== null),
    object_path_prefix: z.string().min(1).refine(isCanonicalObjectPathPrefix),
  })
  .strict()
  .superRefine((policy, context) => {
    // path-style 簽章（`forcePathStyle: true`）＋ `public_origin.pathname === "/"` 之下，
    // 簽出的 URL pathname 恆為 `/<bucket>/<objectKey>`，而 route 的綁定檢查要求
    // `pathname === object_path_prefix + objectKey` 逐字相符。因此 `object_path_prefix`
    // 的**唯一**合法值就是 `/<bucket>/`。
    //
    // 沒有這一條，一個 typo（`/downloads/` 之類）會是 `malformed: false`、零告警、
    // 而下載面全數 503 且無從診斷——正好違反本模組「設錯要吵」的宣言。
    const expected = `/${policy.bucket}/`;
    if (policy.object_path_prefix !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["object_path_prefix"],
        message: `object_path_prefix must be exactly ${expected} for path-style signing`,
      });
    }
  });

export interface LineageArtifactDownloadTargetPolicyParseResult {
  policies: LineageArtifactDownloadTargetPolicy[];
  /** raw 非空但解析／驗證失敗；呼叫端應該記一筆 warn，而不是靜默當成「沒設定」。 */
  malformed: boolean;
}

/**
 * 解析 `LINEAGE_DOWNLOAD_TARGET_POLICIES`（單一 JSON 陣列 env）。
 *
 * **fail-closed 三態合一**：未設定、空字串、任何解析／驗證失敗，全部收斂成**空清單**。
 * 空清單代表「沒有任何 authority/bucket 可被簽章下載」，`resolveLineageArtifactDownloadTarget`
 * 於是 `matches.length !== 1` → route 誠實 503。這是刻意的：一個打錯字的 policy 設定
 * 必須讓下載面完全關閉，而不是退化成某個「差不多」的 origin。
 *
 * 同一組 `(authority, bucket)` 重複宣告也視為 malformed：resolver 要求**唯一命中**，
 * 重複只會在執行期變成難查的 503，不如在啟動時就收斂成空清單並告警。
 */
export function parseLineageArtifactDownloadTargetPolicies(
  raw: string,
): LineageArtifactDownloadTargetPolicyParseResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return { policies: [], malformed: false };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { policies: [], malformed: true };
  }
  const parsed = z.array(targetPolicySchema).max(32).safeParse(value);
  if (!parsed.success) return { policies: [], malformed: true };
  const keys = parsed.data.map((policy) => `${policy.authority}/${policy.bucket}`);
  if (new Set(keys).size !== keys.length) return { policies: [], malformed: true };
  return { policies: parsed.data, malformed: false };
}

export interface S3LineageArtifactDownloadSignerOptions {
  /** 與 governed object port **同一組** credentials（design.md §11.2 規則 3／5）。 */
  accessKey: string;
  secretKey: string;
  /** SigV4 的 region 標籤；MinIO 不使用它，但簽章字串必須有一個固定值。 */
  region?: string;
}

/**
 * 生產 presigner。
 *
 * **簽章綁 host**：S3Client 的 `endpoint` 直接用 `target.public_origin`
 * （path-style），因此 SigV4 的 `SignedHeaders=host` 綁的就是瀏覽器實際會連的那個 host。
 * 絕不用內網 endpoint 簽完再換 host——那會讓簽章與請求的 Host header 不符而被 MinIO 拒絕，
 * 或更糟：在某些寬鬆設定下通過，讓簽章的有效範圍脫離治理宣告的 public origin。
 *
 * 其餘鐵律：不跟 redirect、不接受 caller 提供的 URL（Bucket/Key/VersionId 一律取自
 * 已驗證的 `parsed_ref`）、TTL 取 `min(caller, 契約上限)`、`expires_at` 由**簽章瞬間**導出。
 */
export function createS3LineageArtifactDownloadSigner(
  opts: S3LineageArtifactDownloadSignerOptions,
): LineageArtifactDownloadSignerPort {
  const region = opts.region ?? "us-east-1";
  // 每個 public origin 一個 client：endpoint 是簽章輸入的一部分，不能共用。
  const clients = new Map<string, S3Client>();

  function clientFor(publicOrigin: string): S3Client {
    const existing = clients.get(publicOrigin);
    if (existing) return existing;
    const client = new S3Client({
      endpoint: publicOrigin,
      region,
      forcePathStyle: true, // MinIO 必要；也讓 pathname 等於 /<bucket>/<key>
      credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
    });
    clients.set(publicOrigin, client);
    return client;
  }

  return {
    async sign(
      input: LineageArtifactDownloadSignerInput,
    ): Promise<LineageArtifactSignedDownload> {
      const ttlSeconds = Math.min(
        input.max_ttl_seconds,
        LINEAGE_ARTIFACT_DOWNLOAD_MAX_TTL_SECONDS,
      );
      if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new LineageArtifactDownloadUnavailableError(
          "requested artifact download TTL is not a positive whole number of seconds",
        );
      }
      if (!isUtcTimestamp(input.requested_at)) {
        throw new LineageArtifactDownloadUnavailableError(
          "artifact download request time is not a canonical UTC timestamp",
        );
      }
      // 防禦性：resolver 已保證 public_origin 是 https 且無 path，但簽章是安全邊界，
      // 這裡再自證一次比相信上游便宜。
      if (normalizedPublicOrigin(input.target.public_origin) !== input.target.public_origin) {
        throw new LineageArtifactDownloadUnavailableError(
          "artifact download target public origin is not a canonical https origin",
        );
      }

      // AWS `X-Amz-Date` 只有秒精度。`expires_at` 必須由**截斷後**的簽章瞬間導出，
      // 否則 route 的 `declaredExpires === signingInstant + X-Amz-Expires` 綁定會差
      // 幾百微秒而整批 503。
      const signingSeconds = Number(utcTimestampToMicros(input.requested_at) / 1_000_000n);
      const signingDate = new Date(signingSeconds * 1_000);

      const url = await getSignedUrl(
        clientFor(input.target.public_origin),
        new GetObjectCommand({
          Bucket: input.target.parsed_ref.bucket,
          Key: input.target.parsed_ref.objectKey,
          VersionId: input.target.parsed_ref.versionId,
          // 讓 MinIO 在 GET 時回 checksum header；route 的綁定檢查要求這個 query key。
          ChecksumMode: "ENABLED",
        }),
        { expiresIn: ttlSeconds, signingDate },
      );

      return {
        kind: "presigned_get",
        url,
        expires_at: new Date((signingSeconds + ttlSeconds) * 1_000).toISOString(),
        // echo 已驗證的非機密綁定；route 會再比對一次實際 URL 的目標。
        bound_ref: input.target.locator.ref,
        object_version_id: input.target.locator.object_version_id,
        supports_range: true,
      };
    },
  };
}
