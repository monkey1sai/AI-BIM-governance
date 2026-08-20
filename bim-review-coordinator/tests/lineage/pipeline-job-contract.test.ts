import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as AjvNs from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  PipelineJobStore,
  toPipelineJobDocument,
  type PipelineJobRecord,
  type ReadyEventLedgerEntry,
} from "../../src/services/lineage/pipelineJobStore.js";
import { sequentialEventIds } from "../helpers/fakePipelineJobDeps.js";

/**
 * `rvt-ifc-usdc-lineage` task 3.2 —— **runtime job 文件 ↔ L1 契約對拍**。
 *
 * 兩個方向都測：
 *   1. runtime 產生的每一份 `pipeline_job` 文件都必須過 repo-root
 *      `tests/contracts/pipeline_job_attempt.json`（ajv，L1 為唯一權威）；
 *   2. L1 的 `valid-job-*` fixture body 必須能被 store 的持久化層原樣收下——
 *      證明我們的形狀守門沒有比契約更嚴（那會讓合法文件在重啟時被靜默丟棄）。
 *
 * 另外把 `semantic_validators.validate_job_scenario` 的 job 半邊三條規則**逐字轉寫**
 * 成本檔的 `jobSemanticCodes()`，對每一份 runtime 文件斷言為空集合。schema 管形狀、
 * 語意層管順序與算術，兩層都要綠才算對齊 L1。
 */

type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile: (schema: unknown) => ((data: unknown) => boolean) & { errors?: unknown };
};
const Ajv = (AjvNs as unknown as { default: AjvCtor }).default;

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..", "..", "..");
const CONTRACT = JSON.parse(
  fs.readFileSync(path.resolve(REPO_ROOT, "tests", "contracts", "pipeline_job_attempt.json"), "utf-8"),
) as Record<string, unknown>;
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(CONTRACT);

const JOB_FIXTURE_DIR = path.resolve(
  REPO_ROOT,
  "tests",
  "contracts",
  "lineage",
  "fixtures",
  "pipeline_job_attempt",
  "valid",
);

const NOW = "2026-07-16T08:00:00.000Z";
const LATER = "2026-07-16T08:05:12.250Z";

const tmpRoots: string[] = [];

function tmpStorePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-job-contract-"));
  tmpRoots.push(root);
  return path.join(root, "pipeline-jobs.json");
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * `semantic_validators.validate_job_scenario` 的 `pipeline_job` 三條規則（逐字轉寫）。
 *
 * 轉寫而非呼叫 python：coordinator 的 vitest 不跑 pytest；L1 的 python validator
 * 仍是正本，本函式若與它漂移，兩邊的 fixture 測試會分別紅在自己那一側。
 */
function jobSemanticCodes(body: PipelineJobRecord): string[] {
  const codes: string[] = [];
  const restartKinds = new Set(["streaming_restart", "coordinator_restart"]);
  body.ready_event_ledger.forEach((entry: ReadyEventLedgerEntry, index: number) => {
    if (!entry.created_new_logical_job) return;
    if (restartKinds.has(entry.event_kind)) codes.push("restart_created_second_logical_job");
    else if (index > 0) codes.push("duplicate_logical_job_for_source_bundle");
  });
  if (body.job_state === "manual_correction_required") {
    const retried =
      body.in_flight_attempt_id !== null ||
      body.ready_event_ledger.some((entry) => entry.event_kind === "retry");
    if (retried) codes.push("semantic_invalid_source_retried_same_job");
  }
  return [...new Set(codes)];
}

function expectContractValid(record: PipelineJobRecord): void {
  const document = toPipelineJobDocument(record);
  const ok = ajvValidate(document);
  if (!ok) throw new Error(`pipeline_job document failed L1: ${JSON.stringify(ajvValidate.errors)}`);
  expect(ok).toBe(true);
  expect(jobSemanticCodes(record)).toEqual([]);
}

function ensure(
  store: PipelineJobStore,
  overrides: Partial<Parameters<PipelineJobStore["ensureJobForSourceBundle"]>[0]> = {},
): PipelineJobRecord {
  return store.ensureJobForSourceBundle({
    sourceBundleId: "source-bundle-test-0001",
    externalModelVersionId: "model-version-test-0001",
    tenantId: "tenant-test",
    projectId: "project-test",
    eventId: "evt-0001",
    now: NOW,
    ...overrides,
  }).job;
}

describe("runtime pipeline_job 文件 → L1 契約", () => {
  it("剛建立的 PENDING_ADMISSION job", () => {
    expectContractValid(ensure(new PipelineJobStore(null)));
  });

  it("replay 之後（ledger 兩筆）", () => {
    const store = new PipelineJobStore(null);
    ensure(store);
    expectContractValid(ensure(store, { eventId: "evt-0002", now: LATER }));
  });

  it("tenant/project 未知（optional 鍵不宣告）", () => {
    const store = new PipelineJobStore(null);
    expectContractValid(ensure(store, { tenantId: null, projectId: null }));
  });

  it("WAITING_CAPACITY（in_flight_attempt_id 必為 null）", () => {
    const store = new PipelineJobStore(null);
    const job = ensure(store);
    const waiting = store.transition(job.pipeline_job_id, { job_state: "WAITING_CAPACITY" }, LATER);
    expectContractValid(waiting!);
  });

  it("RUNNING（in_flight_attempt_id 必為 string）", () => {
    const store = new PipelineJobStore(null);
    const job = ensure(store);
    const running = store.transition(
      job.pipeline_job_id,
      { job_state: "RUNNING", in_flight_attempt_id: "attempt-0007" },
      LATER,
    );
    expectContractValid(running!);
  });

  it("manual_correction_required（必帶 blocker，且 requires_new_source_bundle 恆 true）", () => {
    const store = new PipelineJobStore(null);
    const job = ensure(store);
    const blocked = store.transition(
      job.pipeline_job_id,
      {
        job_state: "manual_correction_required",
        manual_correction_blocker: {
          blocker_code: "semantic_invalid_source",
          detail: "alignment contract not satisfiable for this source bundle",
          requires_new_source_bundle: true,
        },
      },
      LATER,
    );
    expectContractValid(blocked!);
  });

  it("coordinator restart 恢復後的 job", () => {
    const storePath = tmpStorePath();
    const store = new PipelineJobStore(storePath);
    const job = ensure(store);
    store.transition(job.pipeline_job_id, { job_state: "WAITING_CAPACITY" }, LATER);

    const rebooted = new PipelineJobStore(storePath);
    const recovered = rebooted.recoverOnStart("2026-07-16T09:00:00.000Z", sequentialEventIds("r"));
    expect(recovered).toHaveLength(1);
    expectContractValid(recovered[0]);
  });

  it("streaming restart 之後的 job", () => {
    const store = new PipelineJobStore(null);
    ensure(store);
    expectContractValid(
      ensure(store, { eventId: "evt-restart", eventKind: "streaming_restart", now: LATER }),
    );
  });

  it("envelope 的 schema_version／document_type 逐字對齊 L1 const", () => {
    const document = toPipelineJobDocument(ensure(new PipelineJobStore(null)));
    expect(document.schema_version).toBe("pipeline-job-attempt/v1");
    expect(document.document_type).toBe("pipeline_job");
  });
});

describe("L1 valid-job-* fixture → 持久化層", () => {
  const fixtureNames = fs
    .readdirSync(JOB_FIXTURE_DIR)
    .filter((name) => name.startsWith("valid-job-") && name.endsWith(".json"))
    .sort();

  it("fixture 目錄不是空的（避免這一組測試靜默空轉）", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
  });

  it.each(fixtureNames)("%s 能被 store 原樣讀回並仍過契約", (name) => {
    const document = JSON.parse(
      fs.readFileSync(path.join(JOB_FIXTURE_DIR, name), "utf-8"),
    ) as { body: PipelineJobRecord };
    const storePath = tmpStorePath();
    fs.writeFileSync(
      storePath,
      JSON.stringify({ schema_version: "pipeline-job/v1", records: [document.body] }),
      "utf-8",
    );

    const store = new PipelineJobStore(storePath);
    const restored = store.get(document.body.pipeline_job_id);
    // 形狀守門若比 L1 嚴，合法文件會在這裡變成 null——那等於重啟時靜默丟掉真 job。
    expect(restored).not.toBeNull();
    expect(restored).toEqual(document.body);
    expect(ajvValidate(toPipelineJobDocument(restored!))).toBe(true);
  });

  it("依 source_bundle_id 的索引在重建後仍指得回同一個 job", () => {
    const document = JSON.parse(
      fs.readFileSync(path.join(JOB_FIXTURE_DIR, "valid-job-pending-admission.json"), "utf-8"),
    ) as { body: PipelineJobRecord };
    const storePath = tmpStorePath();
    fs.writeFileSync(
      storePath,
      JSON.stringify({ schema_version: "pipeline-job/v1", records: [document.body] }),
      "utf-8",
    );

    const store = new PipelineJobStore(storePath);
    expect(store.getBySourceBundle(document.body.source_bundle_id)?.pipeline_job_id).toBe(
      document.body.pipeline_job_id,
    );
  });
});

describe("語意層轉寫的自我檢查（negative control）", () => {
  it("restart entry 宣稱建立 logical job 時，轉寫的規則確實會開槍", () => {
    const store = new PipelineJobStore(null);
    const job = ensure(store);
    const doctored: PipelineJobRecord = {
      ...job,
      ready_event_ledger: [
        ...job.ready_event_ledger,
        {
          event_id: "evt-bad",
          event_kind: "coordinator_restart",
          received_at: LATER,
          created_new_logical_job: true,
        },
      ],
    };
    // schema 仍會放行（L1 明說順序／算術由語意層管），語意層必須擋下來。
    expect(ajvValidate(toPipelineJobDocument(doctored))).toBe(true);
    expect(jobSemanticCodes(doctored)).toEqual(["restart_created_second_logical_job"]);
  });

  it("第二筆 ready 事件宣稱建立 logical job → duplicate_logical_job_for_source_bundle", () => {
    const store = new PipelineJobStore(null);
    const job = ensure(store);
    const doctored: PipelineJobRecord = {
      ...job,
      ready_event_ledger: [
        ...job.ready_event_ledger,
        {
          event_id: "evt-bad",
          event_kind: "ready_replay",
          received_at: LATER,
          created_new_logical_job: true,
        },
      ],
    };
    expect(jobSemanticCodes(doctored)).toEqual(["duplicate_logical_job_for_source_bundle"]);
  });
});
