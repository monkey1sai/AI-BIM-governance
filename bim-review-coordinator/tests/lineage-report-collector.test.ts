import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { IfcReadyIntakeJob } from "../src/types.js";
import type { StreamingConversionResult } from "../src/services/streamingConversionClient.js";
import { ALIGNMENT_CSV_HEADER, LineageReportCollector } from "../src/services/lineageReports/lineageReportCollector.js";
import type { LineageReportObjectPort } from "../src/services/lineageReports/lineageReportObjectStore.js";
import {
  LineageReportStore,
  LineageReportStoreUnavailableError,
} from "../src/services/lineageReports/lineageReportStore.js";

const CONV = "stream_conv_20260916120000_abcd1234";
const INTERNAL = "http://streaming.internal:49101";
const PUBLIC = "http://192.0.2.10:49101";
const FIXTURE = fileURLToPath(
  new URL(
    "../../tests/contracts/lineage/fixtures/lineage_alignment_report/valid/alignment-report-json-all-difference-sets.json",
    import.meta.url,
  ),
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lineage-report-"));
  dirs.push(dir);
  return dir;
}

function reportJson(overrides: { attempt_id?: string } = {}): Buffer {
  const document = JSON.parse(readFileSync(FIXTURE, "utf-8")) as { body: Record<string, unknown> };
  document.body.attempt_id = overrides.attempt_id ?? CONV;
  document.body.result_id = CONV;
  return Buffer.from(JSON.stringify(document), "utf-8");
}

const REPORT_CSV = Buffer.from(`${ALIGNMENT_CSV_HEADER}\n1,R1,,,,,invalid_row,missing_guid\n`, "utf-8");
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function job(overrides: Partial<IfcReadyIntakeJob> = {}): IfcReadyIntakeJob {
  return {
    ifc_ready_job_id: "ifcready_1",
    status: "dispatched",
    idempotent_replay: false,
    correlation_id: "corr_1",
    idempotency_key: "mw_0123456789abcdef",
    tenant_id: "tenant_demo_001",
    project_id: "project_1",
    external_model_version_id: "ext_mv_1",
    source_ifc_ref: "http://minio.internal:9000/bim-control/899/main/p1/model.ifc",
    source_ifc_etag: '"etag-ifc"',
    conversion_job_id: CONV,
    conversion_status: "ready",
    conversion_authority: "bim-streaming-server",
    created_at: "2026-09-16T11:00:00.000Z",
    updated_at: "2026-09-16T11:05:00.000Z",
    ...overrides,
  };
}

function result(
  files: { json?: Buffer; csv?: Buffer } = {},
  summary: Record<string, unknown> | null = { status: "generated", schedule_csv: { present: true, filename: "schedule.csv" } },
  urlOrigin = PUBLIC,
): StreamingConversionResult {
  const json = files.json ?? reportJson();
  const csv = files.csv ?? REPORT_CSV;
  const raw: Record<string, unknown> = {
    conversion_job_id: CONV,
    status: "succeeded",
    artifacts: {
      alignment_report_json: { url: `${urlOrigin}/artifacts/${CONV}/alignment_report.json`, checksum_sha256: sha(json) },
      alignment_report_csv: { url: `${urlOrigin}/artifacts/${CONV}/alignment_report.csv`, checksum_sha256: sha(csv) },
    },
  };
  if (summary) raw.lineage_alignment = summary;
  return { conversion_job_id: CONV, status: "succeeded", ready: true, raw };
}

function fakeFetch(served: Record<string, Buffer | number>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = served[url];
    if (hit === undefined) return new Response("missing", { status: 404 });
    if (typeof hit === "number") return new Response("error", { status: hit });
    return new Response(new Uint8Array(hit), { status: 200 });
  }) as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

function servedReports(json = reportJson(), csv = REPORT_CSV): Record<string, Buffer> {
  return {
    [`${INTERNAL}/artifacts/${CONV}/alignment_report.json`]: json,
    [`${INTERNAL}/artifacts/${CONV}/alignment_report.csv`]: csv,
  };
}

type FakePort = LineageReportObjectPort & { puts: Array<{ key: string; body: string; contentType: string }> };

function fakePort(outcome: "created" | "exists" | "denied" | Error = "created"): FakePort {
  const puts: FakePort["puts"] = [];
  return {
    puts,
    async getObjectBytes() {
      return null;
    },
    async putObjectIfAbsent(key, body, contentType) {
      if (outcome instanceof Error) throw outcome;
      puts.push({ key, body: body.toString("utf-8"), contentType });
      return outcome;
    },
    destroy() {},
  };
}

function collector(options: {
  store?: LineageReportStore;
  objects?: LineageReportObjectPort | null;
  fetchImpl?: typeof fetch;
}) {
  const store = options.store ?? new LineageReportStore(tempDir());
  return {
    store,
    collector: new LineageReportCollector({
      store,
      objects: options.objects === undefined ? fakePort() : options.objects,
      bucket: "bim-control",
      conversionOrigin: INTERNAL,
      publicArtifactOrigin: PUBLIC,
      fetchImpl: options.fetchImpl ?? fakeFetch(servedReports()),
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    }),
  };
}

describe("LineageReportCollector", () => {
  it("取回並驗證兩份報表、存檔，並不覆寫地上傳到 IFC 資料夾下的 lineage-reports/<轉檔編號>/", async () => {
    const objects = fakePort("created");
    const fetchImpl = fakeFetch(servedReports());
    const { store, collector: subject } = collector({ objects, fetchImpl });

    const record = await subject.collect(job(), result());

    expect(fetchImpl.calls).toEqual([
      `${INTERNAL}/artifacts/${CONV}/alignment_report.json`,
      `${INTERNAL}/artifacts/${CONV}/alignment_report.csv`,
    ]);
    expect(record).toMatchObject({
      conversion_job_id: CONV,
      ifc_ready_job_id: "ifcready_1",
      source_model_id: "mw_0123456789abcdef",
      source_ifc: { bucket: "bim-control", key: "899/main/p1/model.ifc", etag: "etag-ifc" },
      status: "generated",
      error_code: null,
      counts: { csv_total_count: 12, full_lineage_matched_count: 7 },
      files: {
        "alignment_report.json": { sha256: sha(reportJson()), size_bytes: reportJson().length },
        "alignment_report.csv": { sha256: sha(REPORT_CSV), size_bytes: REPORT_CSV.length },
      },
      schedule: { used: true },
      minio_upload: {
        status: "uploaded",
        bucket: "bim-control",
        keys: {
          "alignment_report.json": `899/main/p1/lineage-reports/${CONV}/alignment_report.json`,
          "alignment_report.csv": `899/main/p1/lineage-reports/${CONV}/alignment_report.csv`,
        },
        reason: null,
      },
    });
    expect(record?.metrics?.rvt_ifc_usdc_lineage_ratio.numerator).toBe(7);
    expect(objects.puts.map((put) => [put.key, put.contentType])).toEqual([
      [`899/main/p1/lineage-reports/${CONV}/alignment_report.json`, "application/json"],
      [`899/main/p1/lineage-reports/${CONV}/alignment_report.csv`, "text/csv; charset=utf-8"],
    ]);
    expect(objects.puts[1]!.body).toBe(REPORT_CSV.toString("utf-8"));
    expect(store.readFile(CONV, "alignment_report.csv")?.equals(REPORT_CSV)).toBe(true);
    expect(store.get(CONV)).toEqual(record);
  });

  it("帶上已下載 schedule.csv 的來源資訊", async () => {
    const dir = tempDir();
    const ifcLocalPath = path.join(dir, "source.ifc");
    writeFileSync(ifcLocalPath, "x");
    writeFileSync(
      path.join(dir, "schedule.source.json"),
      JSON.stringify({
        schema_version: "companion-schedule-source/v1",
        bucket: "bim-control",
        key: "899/main/p1/schedule.csv",
        etag: "etag-s",
        sha256: "a".repeat(64),
        size_bytes: 42,
        fetched_at: "2026-09-16T11:00:00.000Z",
      }),
    );
    const { collector: subject } = collector({});
    const record = await subject.collect(job({ local_path: ifcLocalPath }), result());
    expect(record?.schedule).toEqual({
      key: "899/main/p1/schedule.csv",
      etag: "etag-s",
      sha256: "a".repeat(64),
      size_bytes: 42,
      used: true,
    });
  });

  it("沒有寫入權限時報表照樣保存，上傳記為 denied", async () => {
    const objects = fakePort("denied");
    const { store, collector: subject } = collector({ objects });
    const record = await subject.collect(job(), result());
    expect(record?.status).toBe("generated");
    expect(record?.minio_upload).toMatchObject({ status: "denied", reason: "minio_write_denied" });
    expect(objects.puts).toHaveLength(1);
    expect(store.readFile(CONV, "alignment_report.json")).not.toBeNull();
  });

  it("兩份都已存在時記為 exists；MinIO 未設定或來源 key 不明時記為 skipped", async () => {
    expect((await collector({ objects: fakePort("exists") }).collector.collect(job(), result()))?.minio_upload.status).toBe(
      "exists",
    );
    const unconfigured = await collector({ objects: null }).collector.collect(job(), result());
    expect(unconfigured?.minio_upload).toMatchObject({ status: "skipped", reason: "minio_not_configured" });
    const unknownKey = await collector({}).collector.collect(job({ source_ifc_ref: "devstorage:model.ifc" }), result());
    expect(unknownKey?.source_ifc).toEqual({ bucket: null, key: null, etag: null });
    expect(unknownKey?.minio_upload).toMatchObject({ status: "skipped", reason: "source_key_unknown" });
  });

  it("來源 key 由 sourceKeyOf 決定；手動觸發把 key 當 ETag 時不記錄 ETag", async () => {
    const store = new LineageReportStore(tempDir());
    const objects = fakePort();
    const subject = new LineageReportCollector({
      store,
      objects,
      bucket: "bim-control",
      conversionOrigin: INTERNAL,
      publicArtifactOrigin: PUBLIC,
      fetchImpl: fakeFetch(servedReports()),
      sourceKeyOf: () => null,
    });
    const foreign = await subject.collect(job(), result());
    expect(foreign?.source_ifc).toEqual({ bucket: null, key: null, etag: null });
    expect(foreign?.minio_upload).toMatchObject({ status: "skipped", reason: "source_key_unknown" });
    expect(objects.puts).toEqual([]);

    const manual = await collector({}).collector.collect(
      job({ conversion_job_id: CONV, source_ifc_etag: "899/main/p1/model.ifc" }),
      result(),
    );
    expect(manual?.source_ifc).toEqual({ bucket: "bim-control", key: "899/main/p1/model.ifc", etag: null });
  });

  it("上傳失敗時記為 failed，下次收集只重試上傳，不重抓報表", async () => {
    const store = new LineageReportStore(tempDir());
    const firstFetch = fakeFetch(servedReports());
    const first = collector({ store, objects: fakePort(new Error("socket hang up")), fetchImpl: firstFetch });
    const failed = await first.collector.collect(job(), result());
    expect(failed?.minio_upload).toMatchObject({ status: "failed", reason: "upload_error" });

    const secondFetch = fakeFetch({});
    const objects = fakePort("created");
    const second = collector({ store, objects, fetchImpl: secondFetch });
    const retried = await second.collector.collect(job(), result());
    expect(retried?.minio_upload.status).toBe("uploaded");
    expect(secondFetch.calls).toEqual([]);
    expect(objects.puts).toHaveLength(2);
  });

  it("已完成的紀錄不重複收集", async () => {
    const store = new LineageReportStore(tempDir());
    await collector({ store }).collector.collect(job(), result());
    const fetchImpl = fakeFetch({});
    const objects = fakePort();
    const again = await collector({ store, fetchImpl, objects }).collector.collect(job(), result());
    expect(again?.minio_upload.status).toBe("uploaded");
    expect(fetchImpl.calls).toEqual([]);
    expect(objects.puts).toEqual([]);
  });

  it("轉檔結果沒有報表摘要時記為 not_produced；轉檔端報表失敗時沿用它的錯誤碼", async () => {
    const fetchImpl = fakeFetch(servedReports());
    const none = await collector({ fetchImpl }).collector.collect(job(), result({}, null));
    expect(none).toMatchObject({ status: "not_produced", error_code: "report_not_produced", metrics: null });
    expect(fetchImpl.calls).toEqual([]);

    const failed = await collector({}).collector.collect(
      job(),
      result({}, { status: "failed", error_code: "alignment_ifc_unreadable" }),
    );
    expect(failed).toMatchObject({ status: "failed", error_code: "alignment_ifc_unreadable" });
    const odd = await collector({}).collector.collect(job(), result({}, { status: "failed", error_code: "Bad Code!" }));
    expect(odd?.error_code).toBe("alignment_failed");
  });

  it.each([
    ["checksum 不符", () => ({ served: servedReports(Buffer.from("{}")), res: result() }), "report_checksum_mismatch"],
    [
      "JSON 不符合契約",
      () => {
        const json = Buffer.from('{"schema_version":"lineage-alignment-report/v1"}');
        return { served: servedReports(json), res: result({ json }) };
      },
      "report_schema_invalid",
    ],
    [
      "報表身分與轉檔編號不符",
      () => {
        const json = reportJson({ attempt_id: "someone_else" });
        return { served: servedReports(json), res: result({ json }) };
      },
      "report_identity_mismatch",
    ],
    [
      "CSV 表頭不符合契約",
      () => {
        const csv = Buffer.from("a,b\n");
        return { served: servedReports(undefined, csv), res: result({ csv }) };
      },
      "report_csv_invalid",
    ],
    ["artifact URL 不是轉檔服務的發布位置", () => ({ served: servedReports(), res: result({}, undefined, "http://evil.example") }), "report_artifact_invalid"],
    ["轉檔服務暫時取不到報表", () => ({ served: { [`${INTERNAL}/artifacts/${CONV}/alignment_report.json`]: 503 }, res: result() }), "report_unavailable"],
  ])("%s → invalid（%s），不上傳", async (_label, setup, code) => {
    const { served, res } = setup();
    const objects = fakePort();
    const { store, collector: subject } = collector({ objects, fetchImpl: fakeFetch(served) });
    const record = await subject.collect(job(), res);
    expect(record).toMatchObject({ status: "invalid", error_code: code, metrics: null });
    expect(record?.minio_upload).toMatchObject({ status: "skipped", reason: "report_not_generated" });
    expect(objects.puts).toEqual([]);
    expect(store.readFile(CONV, "alignment_report.json")).toBeNull();
  });

  it("暫時取不到的報表下次會重收；其他 invalid 不重收", async () => {
    const store = new LineageReportStore(tempDir());
    await collector({ store, fetchImpl: fakeFetch({}) }).collector.collect(job(), result());
    expect(store.get(CONV)?.error_code).toBe("report_unavailable");
    const recovered = await collector({ store }).collector.collect(job(), result());
    expect(recovered?.status).toBe("generated");

    const other = new LineageReportStore(tempDir());
    await collector({ store: other, fetchImpl: fakeFetch(servedReports(Buffer.from("{}"))) }).collector.collect(
      job(),
      result(),
    );
    const fetchImpl = fakeFetch(servedReports());
    await collector({ store: other, fetchImpl }).collector.collect(job(), result());
    expect(fetchImpl.calls).toEqual([]);
  });

  it("轉檔編號不一致或不合法時不處理", async () => {
    const { store, collector: subject } = collector({});
    expect(await subject.collect(job({ conversion_job_id: "other" }), result())).toBeNull();
    expect(await subject.collect(job({ conversion_job_id: "../escape" }), { ...result(), conversion_job_id: "../escape" })).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("resume 只補收已完成、尚無紀錄的轉檔，取不到結果就跳過", async () => {
    const { store, collector: subject } = collector({});
    const jobs = [
      job(),
      job({ ifc_ready_job_id: "ifcready_2", conversion_job_id: "stream_conv_failed", conversion_status: "failed" }),
      job({ ifc_ready_job_id: "ifcready_3", conversion_job_id: "stream_conv_gone" }),
    ];
    const asked: string[] = [];
    const collected = await subject.resume(jobs, async (id) => {
      asked.push(id);
      if (id === "stream_conv_gone") throw new Error("404");
      return result();
    });
    expect(asked).toEqual([CONV, "stream_conv_gone"]);
    expect(collected).toEqual([CONV]);
    expect(store.list().map((record) => record.conversion_job_id)).toEqual([CONV]);
  });
});

describe("LineageReportStore", () => {
  it("重新載入後保留紀錄與檔案，依轉檔時間新到舊排序", async () => {
    const dir = tempDir();
    const first = collector({ store: new LineageReportStore(dir) });
    await first.collector.collect(job(), result());
    await first.collector.collect(
      job({ ifc_ready_job_id: "ifcready_0", conversion_job_id: "stream_conv_older", created_at: "2026-09-15T00:00:00.000Z" }),
      { ...result({}, null), conversion_job_id: "stream_conv_older" },
    );

    const reloaded = new LineageReportStore(dir);
    expect(reloaded.list().map((record) => record.conversion_job_id)).toEqual([CONV, "stream_conv_older"]);
    expect(reloaded.readFile(CONV, "alignment_report.json")?.equals(reportJson())).toBe(true);
    expect(reloaded.readFile("stream_conv_older", "alignment_report.json")).toBeNull();
  });

  it("index 損壞時整個 store 失效，不假裝沒有報表", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "index.json"), "{broken");
    const store = new LineageReportStore(dir);
    expect(store.available).toBe(false);
    expect(() => store.list()).toThrow(LineageReportStoreUnavailableError);
    expect(() => store.get(CONV)).toThrow(LineageReportStoreUnavailableError);
  });
});
