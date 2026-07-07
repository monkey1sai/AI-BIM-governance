import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EdgeArtifactKind = "source_ifc" | "model_usdc" | "element_mapping" | "metadata" | "entity_index";

export type EdgeArtifactStatus = "unknown" | "present" | "missing" | "reachable" | "unreachable" | "stale";

export interface EdgeArtifactRecord {
  site_id: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  ifc_ready_job_id: string | null;
  conversion_job_id: string | null;
  review_session_id: string | null;
  artifact_kind: EdgeArtifactKind;
  edge_artifact_id: string;
  host_local_path: string | null;
  edge_relative_path: string | null;
  public_url: string | null;
  status: EdgeArtifactStatus;
  size_bytes: number | null;
  sha256: string | null;
  etag: string | null;
  last_checked_at: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudArtifactProjection {
  site_id: string;
  tenant_id: string;
  project_id: string;
  external_model_version_id: string;
  ifc_ready_job_id: string | null;
  conversion_job_id: string | null;
  review_session_id: string | null;
  source_ifc_exists: boolean | null;
  model_usdc_reachable: boolean | null;
  mapping_reachable: boolean | null;
  metadata_reachable: boolean | null;
  source_ifc_size_bytes: number | null;
  source_ifc_sha256: string | null;
  model_usdc_size_bytes: number | null;
  model_usdc_sha256: string | null;
  mapping_sha256: string | null;
  artifact_url_hashes: Record<string, string>;
  checked_at: string;
  stale_reason: string | null;
}

type PersistedArtifactHealthLedger = {
  schema_version?: string;
  records?: unknown;
};

const SCHEMA_VERSION = "artifact-health-ledger/v1";

function makeKey(siteId: string, edgeArtifactId: string, artifactKind: EdgeArtifactKind): string {
  return `${siteId}:${edgeArtifactId}:${artifactKind}`;
}

function toBooleanStatus(record: EdgeArtifactRecord): boolean | null {
  switch (record.status) {
    case "present":
    case "reachable":
      return true;
    case "missing":
    case "unreachable":
    case "stale":
      return false;
    default:
      return null;
  }
}

export function toCloudProjection(record: EdgeArtifactRecord): CloudArtifactProjection {
  const projection: CloudArtifactProjection = {
    site_id: record.site_id,
    tenant_id: record.tenant_id,
    project_id: record.project_id,
    external_model_version_id: record.external_model_version_id,
    ifc_ready_job_id: record.ifc_ready_job_id,
    conversion_job_id: record.conversion_job_id,
    review_session_id: record.review_session_id,
    source_ifc_exists: null,
    model_usdc_reachable: null,
    mapping_reachable: null,
    metadata_reachable: null,
    source_ifc_size_bytes: null,
    source_ifc_sha256: null,
    model_usdc_size_bytes: null,
    model_usdc_sha256: null,
    mapping_sha256: null,
    artifact_url_hashes: {},
    checked_at: record.last_checked_at ?? record.updated_at,
    stale_reason: record.failure_code,
  };

  if (record.public_url) {
    projection.artifact_url_hashes[record.artifact_kind] = crypto.createHash("sha256").update(record.public_url).digest("hex");
  }

  switch (record.artifact_kind) {
    case "source_ifc":
      projection.source_ifc_exists = toBooleanStatus(record);
      projection.source_ifc_size_bytes = record.size_bytes;
      projection.source_ifc_sha256 = record.sha256;
      break;
    case "model_usdc":
      projection.model_usdc_reachable = toBooleanStatus(record);
      projection.model_usdc_size_bytes = record.size_bytes;
      projection.model_usdc_sha256 = record.sha256;
      break;
    case "element_mapping":
      projection.mapping_reachable = toBooleanStatus(record);
      projection.mapping_sha256 = record.sha256;
      break;
    case "metadata":
      projection.metadata_reachable = toBooleanStatus(record);
      break;
    case "entity_index":
      break;
  }

  return projection;
}

export class ArtifactHealthLedger {
  private readonly records = new Map<string, EdgeArtifactRecord>();

  constructor(private readonly persistencePath: string | null = null) {
    this.load();
  }

  private load(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const raw = fs.readFileSync(this.persistencePath, "utf-8");
      const parsed = JSON.parse(raw) as PersistedArtifactHealthLedger;
      if (parsed.schema_version !== SCHEMA_VERSION) {
        return;
      }
      if (!Array.isArray(parsed.records)) return;
      for (const item of parsed.records) {
        const record = item as EdgeArtifactRecord;
        if (
          record
          && typeof record.site_id === "string"
          && typeof record.edge_artifact_id === "string"
          && typeof record.artifact_kind === "string"
        ) {
          this.records.set(makeKey(record.site_id, record.edge_artifact_id, record.artifact_kind), record);
        }
      }
    } catch {
      this.records.clear();
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    fs.writeFileSync(
      tmpPath,
      JSON.stringify({ schema_version: SCHEMA_VERSION, records: [...this.records.values()] }, null, 2),
      "utf-8",
    );
    fs.renameSync(tmpPath, this.persistencePath);
  }

  upsert(input: EdgeArtifactRecord, now: string): EdgeArtifactRecord {
    const key = makeKey(input.site_id, input.edge_artifact_id, input.artifact_kind);
    const existing = this.records.get(key);
    const record: EdgeArtifactRecord = {
      ...input,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.records.set(key, record);
    this.persist();
    return record;
  }

  get(siteId: string, edgeArtifactId: string, artifactKind: EdgeArtifactKind): EdgeArtifactRecord | null {
    return this.records.get(makeKey(siteId, edgeArtifactId, artifactKind)) ?? null;
  }

  list(): EdgeArtifactRecord[] {
    return [...this.records.values()].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
  }
}
