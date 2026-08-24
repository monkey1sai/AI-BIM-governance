import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SourceBundleStore,
  type SourceBundleRecord,
} from "../../src/services/lineage/sourceBundleStore.js";

// durable governed store。持久化 pattern 逐字沿用 conversionLedger（tmp+rename、
// schema_version、壞檔不 crash），所以這裡也逐項驗同一組性質。

const tempRoots: string[] = [];

function makeStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-bundle-store-"));
  tempRoots.push(root);
  return path.join(root, "data", "source-bundles.json");
}

function makeRecord(overrides: Partial<SourceBundleRecord> = {}): SourceBundleRecord {
  return {
    source_bundle_id: "source-bundle-test-0001",
    external_model_version_id: "model-version-test-0001",
    tenant_id: "tenant-test",
    project_id: "project-test",
    project_display_name: "project-test",
    model_category: "structure",
    manifest_ref:
      "minio://edge-test-01/source-bundles-test/source-bundles/tenant-test/project-test/model-version-test/manifest.json?versionId=v-manifest-0001",
    manifest_sha256: "d".repeat(64),
    bundle_state: "READY",
    integrity_diagnostics: [],
    producer_id: "ifc-worker-test-01",
    producer_kind: "external_ifc_worker",
    claimed_at: "2026-07-16T07:58:20.000Z",
    validated_at: "2026-07-16T07:58:40.000Z",
    pipeline_job_id: null,
    created_at: "2026-07-16T07:58:40.000Z",
    updated_at: "2026-07-16T07:58:40.000Z",
    ...overrides,
  };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("SourceBundleStore — admit 的 create-once 語意", () => {
  it("首見 id → created", () => {
    const store = new SourceBundleStore(null);
    const result = store.admit(makeRecord());
    expect(result.outcome).toBe("created");
    expect(store.get("source-bundle-test-0001")).not.toBeNull();
  });

  it("同 id 同 digest → replay_same_digest，identity 沿用既有、觀測欄位刷新", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord());
    const replay = store.admit(
      makeRecord({
        // identity 面被打壞的重放：store 必須以既有紀錄為準，不得被 replay 改寫。
        external_model_version_id: "model-version-IMPOSTOR",
        created_at: "2030-01-01T00:00:00.000Z",
        bundle_state: "NON_READY",
        validated_at: "2026-07-16T09:00:00.000Z",
        updated_at: "2026-07-16T09:00:00.000Z",
      }),
    );
    expect(replay.outcome).toBe("replay_same_digest");
    expect(replay.record.external_model_version_id).toBe("model-version-test-0001");
    expect(replay.record.created_at).toBe("2026-07-16T07:58:40.000Z");
    expect(replay.record.bundle_state).toBe("NON_READY");
    expect(replay.record.validated_at).toBe("2026-07-16T09:00:00.000Z");
    expect(replay.record.updated_at).toBe("2026-07-16T09:00:00.000Z");
  });

  it("同 id 異 digest → conflict_different_digest，且**完全不寫入**", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord());
    const conflict = store.admit(makeRecord({ manifest_sha256: "e".repeat(64) }));
    expect(conflict.outcome).toBe("conflict_different_digest");
    expect(conflict.record.manifest_sha256).toBe("d".repeat(64));
    expect(store.get("source-bundle-test-0001")?.manifest_sha256).toBe("d".repeat(64));
  });

  it("replay 不得洗掉已綁定的 pipeline_job_id", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord());
    store.bindPipelineJob("source-bundle-test-0001", "pipeline-job-test-0001");
    const replay = store.admit(makeRecord({ pipeline_job_id: null }));
    expect(replay.record.pipeline_job_id).toBe("pipeline-job-test-0001");
  });

  it("N 次重放只有第一次是 created", () => {
    const store = new SourceBundleStore(null);
    const outcomes = [1, 2, 3, 4, 5].map(() => store.admit(makeRecord()).outcome);
    expect(outcomes).toEqual([
      "created",
      "replay_same_digest",
      "replay_same_digest",
      "replay_same_digest",
      "replay_same_digest",
    ]);
    expect(store.list()).toHaveLength(1);
  });
});

describe("SourceBundleStore — bindPipelineJob", () => {
  it("綁定成功並保留其餘欄位；now 有給才動 updated_at", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord());
    const bound = store.bindPipelineJob("source-bundle-test-0001", "pipeline-job-test-0001");
    expect(bound?.pipeline_job_id).toBe("pipeline-job-test-0001");
    expect(bound?.updated_at).toBe("2026-07-16T07:58:40.000Z");
    const rebound = store.bindPipelineJob(
      "source-bundle-test-0001",
      "pipeline-job-test-0002",
      "2026-07-17T00:00:00.000Z",
    );
    expect(rebound?.updated_at).toBe("2026-07-17T00:00:00.000Z");
  });

  it("找不到 bundle 回 null（非 crash）", () => {
    const store = new SourceBundleStore(null);
    expect(store.bindPipelineJob("nope", "pipeline-job-x")).toBeNull();
  });
});

describe("SourceBundleStore — 持久化", () => {
  it("restart roundtrip：重建 store 找得回全部紀錄", () => {
    const storePath = makeStorePath();
    const first = new SourceBundleStore(storePath);
    first.admit(makeRecord());
    first.admit(makeRecord({ source_bundle_id: "source-bundle-test-0002" }));
    first.bindPipelineJob("source-bundle-test-0001", "pipeline-job-test-0001");

    const reopened = new SourceBundleStore(storePath);
    expect(reopened.list()).toHaveLength(2);
    expect(reopened.get("source-bundle-test-0001")?.pipeline_job_id).toBe(
      "pipeline-job-test-0001",
    );
    // restart 後同 digest 的 claim 仍然是 replay，不是第二次 created。
    expect(reopened.admit(makeRecord()).outcome).toBe("replay_same_digest");
  });

  it("寫入是 atomic swap（.tmp 不留在磁碟上）並帶 schema_version", () => {
    const storePath = makeStorePath();
    const store = new SourceBundleStore(storePath);
    store.admit(makeRecord());
    expect(fs.existsSync(`${storePath}.tmp`)).toBe(false);
    const persisted = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
      schema_version: string;
      records: unknown[];
    };
    expect(persisted.schema_version).toBe("source-bundle/v1");
    expect(persisted.records).toHaveLength(1);
  });

  it("壞檔不 crash，當空 store 起手", () => {
    const storePath = makeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{ this is not json", "utf-8");
    const store = new SourceBundleStore(storePath);
    expect(store.list()).toEqual([]);
    expect(store.admit(makeRecord()).outcome).toBe("created");
  });

  it("records 不是陣列時安全降級（版本／格式漂移）", () => {
    const storePath = makeStorePath();
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify({ schema_version: "source-bundle/v0", records: { nope: true } }),
      "utf-8",
    );
    expect(new SourceBundleStore(storePath).list()).toEqual([]);
  });

  it("persistencePath 為 null 時純記憶體，不建任何檔", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord());
    expect(store.list()).toHaveLength(1);
  });

  it("list() 依 created_at 降冪（最新在前）", () => {
    const store = new SourceBundleStore(null);
    store.admit(makeRecord({ source_bundle_id: "older", created_at: "2026-07-01T00:00:00.000Z" }));
    store.admit(makeRecord({ source_bundle_id: "newer", created_at: "2026-07-20T00:00:00.000Z" }));
    expect(store.list().map((r) => r.source_bundle_id)).toEqual(["newer", "older"]);
  });
});
