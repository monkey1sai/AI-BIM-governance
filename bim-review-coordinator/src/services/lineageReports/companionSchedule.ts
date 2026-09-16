import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { LineageObjectTooLargeError, type LineageReportObjectPort } from "./lineageReportObjectStore.js";

/**
 * bim-control 把 Revit 元件資料（`schedule.csv`）與 IFC 放在同一個 MinIO 資料夾。
 * IFC 下載後把它一併抓到 IFC 旁邊，dispatch 時交給轉檔服務做對齊報表。
 *
 * 來源與 checksum 寫在同目錄的 sidecar，重啟後重建 dispatch 也讀得到，不必改 intake job 結構。
 */
export const COMPANION_SCHEDULE_FILENAME = "schedule.csv";
export const COMPANION_SCHEDULE_SIDECAR = "schedule.source.json";
export const COMPANION_SCHEDULE_MAX_BYTES = 64 * 1024 * 1024;

export type CompanionScheduleSource = {
  schema_version: "companion-schedule-source/v1";
  bucket: string;
  key: string;
  etag: string;
  sha256: string;
  size_bytes: number;
  fetched_at: string;
};

export type CompanionScheduleFetch =
  | { status: "downloaded"; source: CompanionScheduleSource }
  | { status: "absent" }
  | { status: "failed"; reason: "schedule_too_large" | "schedule_unavailable" };

/** 轉檔請求中的 `schedule_artifact`；路徑必須在轉檔服務的 storage root 之內。 */
export type ScheduleArtifactPayload = {
  artifact_id: string;
  format: "csv";
  filename: string;
  checksum_sha256: string;
  size_bytes: number;
  etag: string;
  local_path: string;
  host_local_path: string;
};

/** `a/b/model.ifc` → `a/b/`；bucket 根目錄的 IFC → 空字串。 */
export function ifcFolderOf(ifcKey: string): string {
  return ifcKey.slice(0, ifcKey.lastIndexOf("/") + 1);
}

export function companionScheduleKey(ifcKey: string): string {
  return ifcFolderOf(ifcKey) + COMPANION_SCHEDULE_FILENAME;
}

/** 同目錄的另一個檔名；保留原路徑的分隔符（host 路徑可能混用 `\` 與 `/`）。 */
export function siblingPath(filePath: string, name: string): string {
  return filePath.replace(/[^\\/]*$/, name);
}

function writeAtomic(target: string, bytes: Buffer | string): void {
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, target);
}

export async function fetchCompanionSchedule(input: {
  objects: LineageReportObjectPort;
  bucket: string;
  ifcKey: string;
  ifcLocalPath: string;
  now?: () => Date;
}): Promise<CompanionScheduleFetch> {
  const key = companionScheduleKey(input.ifcKey);
  let object: { bytes: Buffer; etag: string } | null;
  try {
    object = await input.objects.getObjectBytes(key, COMPANION_SCHEDULE_MAX_BYTES);
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof LineageObjectTooLargeError ? "schedule_too_large" : "schedule_unavailable",
    };
  }
  if (!object) return { status: "absent" };
  const source: CompanionScheduleSource = {
    schema_version: "companion-schedule-source/v1",
    bucket: input.bucket,
    key,
    etag: object.etag,
    sha256: createHash("sha256").update(object.bytes).digest("hex"),
    size_bytes: object.bytes.length,
    fetched_at: (input.now ?? (() => new Date()))().toISOString(),
  };
  try {
    writeAtomic(siblingPath(input.ifcLocalPath, COMPANION_SCHEDULE_FILENAME), object.bytes);
    writeAtomic(siblingPath(input.ifcLocalPath, COMPANION_SCHEDULE_SIDECAR), `${JSON.stringify(source)}\n`);
  } catch {
    return { status: "failed", reason: "schedule_unavailable" };
  }
  return { status: "downloaded", source };
}

function isSource(value: unknown): value is CompanionScheduleSource {
  const item = value as Partial<CompanionScheduleSource> | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schema_version === "companion-schedule-source/v1" &&
    typeof item.bucket === "string" &&
    typeof item.key === "string" &&
    typeof item.etag === "string" &&
    typeof item.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    Number.isSafeInteger(item.size_bytes) &&
    typeof item.fetched_at === "string"
  );
}

/** 讀已下載 schedule 的來源紀錄；沒有或壞掉回 null。 */
export function readCompanionScheduleSource(ifcLocalPath: string): CompanionScheduleSource | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(siblingPath(ifcLocalPath, COMPANION_SCHEDULE_SIDECAR), "utf-8"));
    return isSource(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** dispatch 前重新核對檔案內容與 sidecar 一致，才交給轉檔服務。 */
export function readCompanionSchedule(ifcLocalPath: string, ifcHostLocalPath: string): ScheduleArtifactPayload | null {
  const source = readCompanionScheduleSource(ifcLocalPath);
  if (!source) return null;
  const localPath = siblingPath(ifcLocalPath, COMPANION_SCHEDULE_FILENAME);
  let bytes: Buffer;
  try {
    bytes = readFileSync(localPath);
  } catch {
    return null;
  }
  if (bytes.length !== source.size_bytes || createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
    return null;
  }
  return {
    artifact_id: `schedule_${source.sha256.slice(0, 16)}`,
    format: "csv",
    filename: COMPANION_SCHEDULE_FILENAME,
    checksum_sha256: source.sha256,
    size_bytes: source.size_bytes,
    etag: source.etag,
    local_path: localPath,
    host_local_path: siblingPath(ifcHostLocalPath, COMPANION_SCHEDULE_FILENAME),
  };
}
