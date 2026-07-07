import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ArtifactHealthLedger,
  toCloudProjection,
  type EdgeArtifactRecord,
} from "../src/services/artifactHealthLedger.js";

let tmp: string | null = null;

function storePath(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-health-ledger-"));
  return path.join(tmp, "artifact-health-ledger.json");
}

afterEach(() => {
  if (tmp) {
    fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  }
});

function makeRecord(overrides: Partial<EdgeArtifactRecord> = {}): EdgeArtifactRecord {
  return {
    site_id: "site_taipei",
    tenant_id: "tenant_demo",
    project_id: "project_alpha",
    external_model_version_id: "ver_001",
    ifc_ready_job_id: "ifcready_001",
    conversion_job_id: "conv_001",
    review_session_id: "session_001",
    artifact_kind: "source_ifc",
    edge_artifact_id: "artifact_001",
    host_local_path: "D:\\Users\\deploy\\AI-bim-geo-data\\storage\\ifc-cache\\ifcready_001\\source.ifc",
    edge_relative_path: "storage\\ifc-cache\\ifcready_001\\source.ifc",
    public_url: "http://127.0.0.1:49100/artifacts/source.ifc",
    status: "present",
    size_bytes: 1234,
    sha256: "abc123",
    etag: "etag-001",
    last_checked_at: "2026-07-07T08:00:00.000Z",
    failure_code: null,
    created_at: "2026-07-07T07:59:00.000Z",
    updated_at: "2026-07-07T08:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactHealthLedger", () => {
  it("persists and reloads edge-local host paths", () => {
    const p = storePath();
    const ledger = new ArtifactHealthLedger(p);
    ledger.upsert(
      makeRecord({
        created_at: "1999-01-01T00:00:00.000Z",
        updated_at: "1999-01-01T00:00:00.000Z",
      }),
      "2026-07-07T08:00:00.000Z",
    );

    const reloaded = new ArtifactHealthLedger(p);
    const record = reloaded.get("site_taipei", "artifact_001", "source_ifc");

    expect(record?.host_local_path).toBe(
      "D:\\Users\\deploy\\AI-bim-geo-data\\storage\\ifc-cache\\ifcready_001\\source.ifc",
    );
    expect(record?.created_at).toBe("2026-07-07T08:00:00.000Z");
    expect(record?.updated_at).toBe("2026-07-07T08:00:00.000Z");
  });

  it("corrupt JSON starts empty and does not crash", () => {
    const p = storePath();
    fs.writeFileSync(p, "{ not json", "utf-8");

    const ledger = new ArtifactHealthLedger(p);

    expect(ledger.list()).toEqual([]);
    expect(() => ledger.upsert(makeRecord(), "2026-07-07T08:00:00.000Z")).not.toThrow();
  });

  it("schema version mismatch starts empty", () => {
    const p = storePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        schema_version: "artifact-health-ledger/v0",
        records: [makeRecord()],
      }),
      "utf-8",
    );

    const ledger = new ArtifactHealthLedger(p);

    expect(ledger.list()).toEqual([]);
  });

  it("cloud projection excludes host_local_path, edge_relative_path, and raw public_url", () => {
    const record = makeRecord({
      artifact_kind: "model_usdc",
      status: "reachable",
      public_url: "http://127.0.0.1:49100/artifacts/model.usdc",
      size_bytes: 5678,
      sha256: "usdc-sha-001",
      last_checked_at: "2026-07-07T08:30:00.000Z",
    });

    const projection = toCloudProjection(record);

    expect(projection).not.toHaveProperty("host_local_path");
    expect(projection).not.toHaveProperty("edge_relative_path");
    expect(projection).not.toHaveProperty("public_url");
    expect(projection.model_usdc_reachable).toBe(true);
    expect(projection.model_usdc_size_bytes).toBe(5678);
    expect(projection.artifact_url_hashes).toEqual({
      model_usdc: crypto.createHash("sha256").update("http://127.0.0.1:49100/artifacts/model.usdc").digest("hex"),
    });
  });
});
