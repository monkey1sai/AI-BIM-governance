import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { installContractResponseSeam, type ContractViolation } from "../src/contract/responseValidation.js";
import { registerLineageConversionReportRoutes } from "../src/routes/lineageConversionReportRoutes.js";
import {
  LineageReportStore,
  type LineageReportRecord,
} from "../src/services/lineageReports/lineageReportStore.js";

const FIXTURE = fileURLToPath(
  new URL(
    "../../tests/contracts/lineage/fixtures/lineage_alignment_report/valid/alignment-report-json-all-difference-sets.json",
    import.meta.url,
  ),
);
const CSV = Buffer.from(
  "row_number,rvt_element_id,ifc_uuid36_raw,ifc_uuid36,ifc_global_id22,usd_prim_path,alignment_class,reason_code\n1,=cmd,,,,,invalid_row,missing_guid\n",
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function record(conversionJobId: string, overrides: Partial<LineageReportRecord> = {}): LineageReportRecord {
  const json = readFileSync(FIXTURE);
  const body = JSON.parse(json.toString("utf-8")).body;
  return {
    conversion_job_id: conversionJobId,
    ifc_ready_job_id: `ifcready_${conversionJobId}`,
    source_model_id: "mw_0123456789abcdef",
    project_id: "project_1",
    external_model_version_id: "ext_1",
    source_ifc: { bucket: "bim-control", key: "899/main/p1/model.ifc", etag: "etag-1" },
    schedule: { key: "899/main/p1/schedule.csv", etag: "etag-s", sha256: "a".repeat(64), size_bytes: 10, used: true },
    status: "generated",
    error_code: null,
    report_generated_at: body.generated_at,
    conversion_created_at: "2026-09-16T11:00:00.000Z",
    recorded_at: "2026-09-16T12:00:00.000Z",
    metrics: body.metrics,
    counts: body.counts,
    warning_codes: body.warning_codes,
    files: {
      "alignment_report.json": { sha256: sha(json), size_bytes: json.length },
      "alignment_report.csv": { sha256: sha(CSV), size_bytes: CSV.length },
    },
    minio_upload: {
      status: "denied",
      bucket: "bim-control",
      keys: {
        "alignment_report.json": `899/main/p1/lineage-reports/${conversionJobId}/alignment_report.json`,
        "alignment_report.csv": `899/main/p1/lineage-reports/${conversionJobId}/alignment_report.csv`,
      },
      reason: "minio_write_denied",
      attempted_at: "2026-09-16T12:00:00.000Z",
    },
    ...overrides,
  };
}

function build(seed: (store: LineageReportStore) => void = () => {}, dir?: string) {
  const storeDir = dir ?? mkdtempSync(path.join(tmpdir(), "lineage-routes-"));
  if (!dir) dirs.push(storeDir);
  const store = new LineageReportStore(storeDir);
  seed(store);
  const violations: ContractViolation[] = [];
  const app = express();
  installContractResponseSeam(app, { mode: "enforce", onViolation: (violation) => violations.push(violation) });
  registerLineageConversionReportRoutes(app, { store });
  return { app, store, violations };
}

function seedGenerated(store: LineageReportStore, id = "stream_conv_1", overrides: Partial<LineageReportRecord> = {}): void {
  store.save(record(id, overrides), { "alignment_report.json": readFileSync(FIXTURE), "alignment_report.csv": CSV });
}

describe("GET /api/lineage/conversion-reports", () => {
  it("列出報表（新到舊），可依 IFC object key 篩選，回應符合契約", async () => {
    const { app, violations } = build((store) => {
      seedGenerated(store, "stream_conv_old", { conversion_created_at: "2026-09-15T00:00:00.000Z" });
      seedGenerated(store, "stream_conv_new");
      seedGenerated(store, "stream_conv_other", {
        source_ifc: { bucket: "bim-control", key: "900/main/p2/model.ifc", etag: "e" },
      });
    });

    const all = await request(app).get("/api/lineage/conversion-reports");
    expect(all.status).toBe(200);
    expect(all.body.count).toBe(3);

    const filtered = await request(app)
      .get("/api/lineage/conversion-reports")
      .query({ source_ifc_key: "899/main/p1/model.ifc", limit: "1" });
    expect(filtered.status).toBe(200);
    expect(filtered.body.count).toBe(2);
    expect(filtered.body.items.map((item: LineageReportRecord) => item.conversion_job_id)).toEqual(["stream_conv_new"]);
    expect(violations).toEqual([]);
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "abc" }],
    [{ source_ifc_key: "" }],
    [{ source_ifc_key: "x".repeat(1025) }],
    [{ source_ifc_key: ["a", "b"] }],
  ])("查詢參數不合法（%j）回 400", async (query) => {
    const { app, violations } = build();
    const response = await request(app).get("/api/lineage/conversion-reports").query(query);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "invalid_lineage_report_query", error_code: "invalid_lineage_report_query" });
    expect(violations).toEqual([]);
  });

  it("紀錄檔損壞時回 503，不回空清單", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lineage-routes-"));
    dirs.push(dir);
    writeFileSync(path.join(dir, "index.json"), "{broken");
    const { app, violations } = build(undefined, dir);
    const response = await request(app).get("/api/lineage/conversion-reports");
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("lineage_report_store_unavailable");
    expect((await request(app).get("/api/lineage/conversion-reports/stream_conv_1")).status).toBe(503);
    expect(violations).toEqual([]);
  });
});

describe("GET /api/lineage/conversion-reports/{id}", () => {
  it("回傳單筆紀錄；不存在回 404；不合法的 id 回 400", async () => {
    const { app, violations } = build((store) => seedGenerated(store));
    const found = await request(app).get("/api/lineage/conversion-reports/stream_conv_1");
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ conversion_job_id: "stream_conv_1", minio_upload: { status: "denied" } });
    expect(JSON.stringify(found.body)).not.toMatch(/local_path|X-Amz|ifc-cache/);

    const missing = await request(app).get("/api/lineage/conversion-reports/stream_conv_missing");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("lineage_report_not_found");

    const invalid = await request(app).get("/api/lineage/conversion-reports/bad%20id");
    expect(invalid.status).toBe(400);
    expect(violations).toEqual([]);
  });
});

describe("GET /api/lineage/conversion-reports/{id}/differences", () => {
  it("分頁回傳指定差異集合，並附上權威計數", async () => {
    const { app, violations } = build((store) => seedGenerated(store));
    const page = await request(app)
      .get("/api/lineage/conversion-reports/stream_conv_1/differences")
      .query({ set: "ifc_only", offset: "1", limit: "2" });
    expect(page.status).toBe(200);
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf-8")).body;
    expect(page.body).toEqual({
      conversion_job_id: "stream_conv_1",
      set: "ifc_only",
      total: fixture.difference_sets.ifc_only.length,
      authoritative_count: fixture.counts.ifc_only_count,
      offset: 1,
      limit: 2,
      items: fixture.difference_sets.ifc_only.slice(1, 3),
    });
    const full = await request(app)
      .get("/api/lineage/conversion-reports/stream_conv_1/differences")
      .query({ set: "full_lineage_matched" });
    expect(full.body.items).toHaveLength(fixture.difference_sets.full_lineage_matched.length);
    expect(full.body.limit).toBe(100);
    expect(violations).toEqual([]);
  });

  it("未產出報表回 404；集合或分頁參數不合法回 400", async () => {
    const { app, violations } = build((store) => {
      store.save(record("stream_conv_failed", { status: "failed", error_code: "alignment_failed", metrics: null, counts: null, files: { "alignment_report.json": null, "alignment_report.csv": null } }));
      seedGenerated(store);
    });
    const notGenerated = await request(app)
      .get("/api/lineage/conversion-reports/stream_conv_failed/differences")
      .query({ set: "csv_only" });
    expect(notGenerated.status).toBe(404);
    expect(notGenerated.body.error).toBe("lineage_report_not_generated");

    for (const query of [{ set: "bogus" }, {}, { set: "csv_only", offset: "-1" }, { set: "csv_only", limit: "1001" }]) {
      const response = await request(app).get("/api/lineage/conversion-reports/stream_conv_1/differences").query(query);
      expect(response.status, JSON.stringify(query)).toBe(400);
    }
    expect(violations).toEqual([]);
  });
});

describe("GET /api/lineage/conversion-reports/{id}/files/{name}", () => {
  it("以附件下載 JSON 與 CSV，禁止快取與內容嗅探", async () => {
    const { app } = build((store) => seedGenerated(store));
    const csv = await request(app).get("/api/lineage/conversion-reports/stream_conv_1/files/alignment_report.csv");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="stream_conv_1_alignment_report.csv"');
    expect(csv.headers["cache-control"]).toBe("no-store");
    expect(csv.headers["x-content-type-options"]).toBe("nosniff");
    expect(csv.text).toBe(CSV.toString("utf-8"));

    const json = await request(app)
      .get("/api/lineage/conversion-reports/stream_conv_1/files/alignment_report.json")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(json.status).toBe(200);
    expect(json.headers["content-type"]).toMatch(/^application\/json/);
    expect((json.body as Buffer).equals(readFileSync(FIXTURE))).toBe(true);
  });

  it("不支援的檔名、沒有檔案或內容與紀錄不符時不送出", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lineage-routes-"));
    dirs.push(dir);
    const { app } = build((store) => seedGenerated(store), dir);
    expect((await request(app).get("/api/lineage/conversion-reports/stream_conv_1/files/model.usdc")).status).toBe(404);
    expect((await request(app).get("/api/lineage/conversion-reports/stream_conv_missing/files/alignment_report.csv")).status).toBe(404);

    writeFileSync(path.join(dir, "reports", "stream_conv_1", "alignment_report.csv"), "tampered");
    const tampered = await request(app).get("/api/lineage/conversion-reports/stream_conv_1/files/alignment_report.csv");
    expect(tampered.status).toBe(409);
    expect(tampered.body.error).toBe("lineage_report_file_mismatch");
  });
});
