// bim-review-coordinator/src/services/lineage/minioLocator.ts
//
// `minio://<authority>/<bucket>/<objectKey>?versionId=<id>` locator 的解析與一致性檢查。
//
// Pattern 正本：`tests/contracts/model_version_bundle_manifest.json` 的
// `$defs/minioObjectRef`（與 `$defs/locator.properties.ref`、
// `source_bundle_ready.json` 的同名 `$def` byte-identical）。
//
// **絕對錨定**：L1 README §2 記錄了 Python `re.search` + `$` 會放行單一結尾換行的
// quirk，並對 3.x runtime 下硬要求「只掛 JSON Schema 不足以擋住這一類值」。
// JavaScript 的 `$`（無 `m` flag）本來就只 match 字串結尾，但本檔仍額外顯式拒絕
// 任何 CR／LF，讓「runtime 比 schema 嚴」這件事在原始碼上可讀，而不是依賴
// 兩種 regex 引擎的差異。
import {
  diagnostic,
  type ArtifactRole,
  type IntegrityDiagnostic,
  type IntegrityDiagnosticCode,
} from "./integrityDiagnostics.js";

export type { ArtifactRole, IntegrityDiagnostic, IntegrityDiagnosticCode };

/** L1 `$defs/locator`：object 形態的完整 locator。 */
export interface MinioLocator {
  ref: string;
  object_version_id: string;
  etag: string;
  sha256: string;
  size_bytes: number;
}

/** 解析成功的 locator 分量。 */
export interface ParsedRef {
  authority: string;
  bucket: string;
  objectKey: string;
  versionId: string;
}

/** `parseMinioRef` 的失敗形狀。三個 reason 都能直接映射成 integrity diagnostic code。 */
export interface RefParseFailure {
  error: "malformed" | "presigned_locator_forbidden" | "unversioned_locator";
}

/** L1 ref pattern 的逐字副本（authority / bucket / objectKey / versionId 四個 group）。 */
const REF_PATTERN =
  /^minio:\/\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/([^?#\s]+)\?versionId=([A-Za-z0-9._~%-]+)$/;

/** L1 ref 的 `not` 子句：presign 參數（大小寫皆擋）。 */
const PRESIGN_PATTERN = /[?&][Xx]-[Aa][Mm][Zz]-/;

/** 沒有 `?versionId=` 但形狀上仍是 `minio://authority/bucket/key` 的 ref。 */
const UNVERSIONED_PATTERN = /^minio:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[^?#\s]+$/;

/** SHA-256 十六進位小寫 64 字元（L1 `$defs/sha256`）。 */
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** L1 `$defs/utcTimestamp` 的 pattern（僅形狀；calendar 檢查另做）。 */
const UTC_TIMESTAMP_PATTERN =
  /^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?Z$/;

/** 任何 CR／LF 一律先擋掉（README §2 的 trailing-newline 缺口封口）。 */
function hasLineBreak(value: string): boolean {
  return value.includes("\n") || value.includes("\r");
}

/** SHA-256 欄位的 runtime gate：絕對錨定 + 拒絕換行。 */
export function isSha256(value: unknown): value is string {
  return typeof value === "string" && !hasLineBreak(value) && SHA256_PATTERN.test(value);
}

/**
 * `$defs/utcTimestamp` 的 runtime gate：pattern + **calendar** 檢查。
 *
 * pattern 過得了 `2026-02-30T00:00:00Z`，所以 3.x runtime 必須另外驗真實日期
 * （L1 README §2 對 runtime 的硬要求）。用逐欄位重組比對而不是 `Date.parse`，
 * 因為 `Date.parse` 會靜默 roll over（2/30 變成 3/2）。
 */
export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || hasLineBreak(value)) return false;
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * 把 `$defs/utcTimestamp` 解析成 epoch millis 供時序比較。
 *
 * 時間一律當 instant 比，不比字串：`...:00Z` 與 `...:00.000Z` 是同一刻，字串序卻相反
 * （與 `semantic_validators._parse_utc` 同一裁決）。
 */
export function utcTimestampToMillis(value: string): number {
  return Date.parse(value);
}

/** 解析結果是否為失敗。 */
export function isRefParseFailure(value: ParsedRef | RefParseFailure): value is RefParseFailure {
  return (value as RefParseFailure).error !== undefined;
}

/**
 * 解析一個 governed locator。
 *
 * 判定順序（單一 reason，故必須定序）：
 * 1. presign 參數 → `presigned_locator_forbidden`（presigned URL 本來就不是 `minio://`
 *    locator，先判它才能給出可讀的原因，而不是籠統的 malformed）
 * 2. 形狀對但缺 `?versionId=` → `unversioned_locator`
 * 3. 其餘不符 pattern → `malformed`
 */
export function parseMinioRef(ref: string): ParsedRef | RefParseFailure {
  if (typeof ref !== "string" || hasLineBreak(ref)) return { error: "malformed" };
  if (PRESIGN_PATTERN.test(ref)) return { error: "presigned_locator_forbidden" };
  const matched = REF_PATTERN.exec(ref);
  if (!matched) {
    if (UNVERSIONED_PATTERN.test(ref)) return { error: "unversioned_locator" };
    return { error: "malformed" };
  }
  return {
    authority: matched[1],
    bucket: matched[2],
    objectKey: matched[3],
    versionId: matched[4],
  };
}

/** locator ref 的 authority（`minio://` 之後的第一段）；解析不出來時回空字串。 */
export function locatorAuthority(ref: string): string {
  const remainder = String(ref).split("://", 2)[1] ?? "";
  return remainder.split("/", 1)[0] ?? "";
}

/**
 * 單一 locator 的一致性檢查，回**第一個**違規 code；全部通過回 null。
 *
 * 逐項對應 `semantic_validators._check_object_refs`：presign → `?versionId=` 與
 * `object_version_id` 逐字相等 → `size_bytes` 非 0。malformed ref 沒有對應的
 * wire code，收斂成 `semantic_contract_violation`（契約詞彙裡唯一的「這份文件不符
 * 契約」通用碼），不自創第 14 個字。
 *
 * 需要**全部**違規（validator 的逐 artifact 迴圈）時用 `locatorDiagnostics`。
 */
export function assertLocatorConsistent(loc: MinioLocator): IntegrityDiagnosticCode | null {
  const parsed = parseMinioRef(loc.ref);
  if (isRefParseFailure(parsed)) {
    return parsed.error === "malformed" ? "semantic_contract_violation" : parsed.error;
  }
  if (parsed.versionId !== loc.object_version_id) return "unversioned_locator";
  if (loc.size_bytes === 0) return "artifact_incomplete";
  return null;
}

/**
 * 單一 locator 的**全部**文件層違規，順序逐字對齊
 * `semantic_validators._check_object_refs`：presigned → unversioned → incomplete。
 *
 * @param loc   要檢查的 locator
 * @param role  診斷要標的 role；bundle 級 locator（manifest.json 本身）傳 null
 */
export function locatorDiagnostics(
  loc: MinioLocator,
  role: ArtifactRole | null,
): IntegrityDiagnostic[] {
  const out: IntegrityDiagnostic[] = [];
  const parsed = parseMinioRef(loc.ref);
  if (isRefParseFailure(parsed)) {
    if (parsed.error === "presigned_locator_forbidden") {
      out.push(
        diagnostic(
          "presigned_locator_forbidden",
          role,
          "minio://<authority>/<bucket>/<key>?versionId=<id>",
          "presigned locator",
          "locator 帶 X-Amz-* presign 參數；governed ref 只能是不可變的 minio:// locator",
        ),
      );
      return out;
    }
    if (parsed.error === "unversioned_locator") {
      out.push(
        diagnostic(
          "unversioned_locator",
          role,
          loc.object_version_id,
          null,
          "locator 沒有 ?versionId=，未釘死到不可變的 object version",
        ),
      );
      return out;
    }
    out.push(
      diagnostic(
        "semantic_contract_violation",
        role,
        "minio://<authority>/<bucket>/<key>?versionId=<id>",
        null,
        "locator 不符 governed ref pattern",
      ),
    );
    return out;
  }
  if (parsed.versionId !== loc.object_version_id) {
    out.push(
      diagnostic(
        "unversioned_locator",
        role,
        loc.object_version_id,
        parsed.versionId,
        "locator 的 ?versionId= 與宣告的 object_version_id 不符，未釘死到不可變 bytes",
      ),
    );
  }
  if (loc.size_bytes === 0) {
    out.push(
      diagnostic(
        "artifact_incomplete",
        role,
        "size_bytes > 0",
        "0",
        "size_bytes 為 0：object 已存在但尚未寫完",
      ),
    );
  }
  return out;
}
