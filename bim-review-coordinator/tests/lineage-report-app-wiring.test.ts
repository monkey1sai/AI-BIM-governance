import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { ALIGNMENT_CSV_HEADER } from "../src/services/lineageReports/lineageReportCollector.js";
import type { LineageReportObjectPort } from "../src/services/lineageReports/lineageReportObjectStore.js";

// 端到端串接（只替換 MinIO 與網路）：MinIO IFC 資料夾的 schedule.csv → 轉檔派工帶 schedule_artifact
// → 轉檔 ready → 取回報表 → 本地保存並上傳 MinIO → 讀取 API。

const CONV = "stream_conv_lineage_001";
const CORRELATION = "corr_lineage_001";
const IFC_KEY = "899/main/p1/model.ifc";
const SCHEDULE = "ID,IfcGUID\n1001,3F2DC9C8-AA45-4609-9D7C-8E58D64F9180\n";
const FIXTURE = fileURLToPath(
  new URL(
    "../../tests/contracts/lineage/fixtures/lineage_alignment_report/valid/alignment-report-json-all-difference-sets.json",
    import.meta.url,
  ),
);

let active: CoordinatorApp | null = null;
let stub: http.Server | null = null;
const roots: string[] = [];

afterEach(async () => {
  if (active) {
    await active.dispose();
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (stub) {
    stub.closeAllConnections?.();
    await new Promise<void>((resolve) => stub?.close(() => resolve()));
    stub = null;
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function reportJson(): Buffer {
  const document = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));
  document.body.attempt_id = CONV;
  document.body.result_id = CONV;
  return Buffer.from(JSON.stringify(document));
}

async function startStub(): Promise<{ base: string; dispatched: Array<Record<string, unknown>> }> {
  const json = reportJson();
  const csv = Buffer.from(`${ALIGNMENT_CSV_HEADER}\n1,1001,,,,,csv_only,ifc_product_not_found\n`);
  const dispatched: Array<Record<string, unknown>> = [];
  let base = "";
  stub = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method === "GET" && req.url === `/bim-control/${IFC_KEY}`) {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end("ISO-10303-21;\nEND-ISO-10303-21;\n");
        return;
      }
      if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
        dispatched.push(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ conversion_job_id: CONV, status: "queued", authority: "bim-streaming-server" }));
        return;
      }
      if (req.method === "GET" && req.url === `/api/conversions/${CONV}/result`) {
        const artifact = (name: string, bytes: Buffer) => ({ url: `${base}/artifacts/${CONV}/${name}`, checksum_sha256: sha(bytes) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            conversion_job_id: CONV,
            authority: "bim-streaming-server",
            status: "succeeded",
            ready: true,
            correlation_id: CORRELATION,
            model: { status: "ready", url: `${base}/artifacts/${CONV}/model.usdc` },
            artifacts: {
              model_usdc: { url: `${base}/artifacts/${CONV}/model.usdc` },
              element_mapping: { url: `${base}/artifacts/${CONV}/element_mapping.json` },
              alignment_report_json: artifact("alignment_report.json", json),
              alignment_report_csv: artifact("alignment_report.csv", csv),
            },
            lineage_alignment: { status: "generated", schedule_csv: { present: true, filename: "schedule.csv" } },
          }),
        );
        return;
      }
      if (req.method === "GET" && req.url === `/artifacts/${CONV}/alignment_report.json`) {
        res.writeHead(200).end(json);
        return;
      }
      if (req.method === "GET" && req.url === `/artifacts/${CONV}/alignment_report.csv`) {
        res.writeHead(200).end(csv);
        return;
      }
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((resolve) => stub!.listen(0, "127.0.0.1", () => resolve()));
  base = `http://127.0.0.1:${(stub!.address() as AddressInfo).port}`;
  return { base, dispatched };
}

function fakeObjects(): LineageReportObjectPort & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    async getObjectBytes(key) {
      return key === "899/main/p1/schedule.csv" ? { bytes: Buffer.from(SCHEDULE), etag: "etag-schedule" } : null;
    },
    async putObjectIfAbsent(key) {
      puts.push(key);
      return "created";
    },
    destroy() {},
  };
}

function makeApp(base: string, root: string, minioEndpoint: string, objects: LineageReportObjectPort): CoordinatorApp {
  active = createCoordinatorApp(
    {
      sessionStoreDir: path.join(root, "sessions"),
      eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
      conversionLedgerStorePath: path.join(root, "coordinator", "conversion-ledger.json"),
      externalIfcReadyStorePath: path.join(root, "coordinator", "external-ifc-ready.json"),
      storageRoot: path.join(root, "storage"),
      storageHostRoot: path.join(root, "host-storage"),
      streamingConversionApiBase: base,
      streamingConversionPublicArtifactsUrl: `${base}/artifacts`,
      conversionPollEnabled: false,
      minioWatchEndpoint: minioEndpoint,
      minioWatchBucket: "bim-control",
      corsOrigins: ["http://127.0.0.1:5173"],
    },
    { lineageReportObjectStore: objects },
  );
  return active;
}

async function intake(app: CoordinatorApp, base: string): Promise<string> {
  const response = await request(app.app)
    .post("/api/external/ifc-ready")
    .set({ "X-Webhook-Secret": "dev-webhook-secret", "X-Correlation-Id": CORRELATION, "X-Idempotency-Key": "idem_lineage_001" })
    .send({
      event: "ifc_ready",
      tenant_id: "tenant_demo_001",
      project_id: "project_1",
      external_model_version_id: "ext_mv_1",
      source_ifc: { ref: `${base}/bim-control/${IFC_KEY}`, etag: "etag-ifc", filename: "model.ifc", format: "ifc" },
    });
  expect(response.status).toBe(202);
  return response.body.ifc_ready_job_id as string;
}

describe("lineage report app wiring", () => {
  it("來源不是本地 MinIO 時不配對 schedule.csv，也不上傳報表", async () => {
    const { base, dispatched } = await startStub();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineage-app-"));
    roots.push(root);
    const objects = fakeObjects();
    const app = makeApp(base, root, "http://minio.elsewhere.test:9000", objects);
    const jobId = await intake(app, base);
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));
    expect(dispatched[0]).not.toHaveProperty("schedule_artifact");
    expect(fs.existsSync(path.join(root, "storage", "ifc-cache", jobId, "schedule.csv"))).toBe(false);

    await request(app.app).post(`/api/internal/conversions/${CONV}/ingest`).set({ "X-Internal-Token": "dev-internal-token" }).send({});
    await vi.waitFor(async () => {
      const report = await request(app.app).get(`/api/lineage/conversion-reports/${CONV}`);
      expect(report.body.minio_upload).toMatchObject({ status: "skipped", reason: "source_key_unknown" });
    });
    expect(objects.puts).toEqual([]);
  });

  it("MinIO schedule.csv → 派工 → 報表收集、上傳與讀取 API 串成一條", async () => {
    const { base, dispatched } = await startStub();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lineage-app-"));
    roots.push(root);
    const objects = fakeObjects();
    active = makeApp(base, root, base, objects);
    const jobId = await intake(active, base);
    await vi.waitFor(() => expect(dispatched).toHaveLength(1));

    const schedulePath = path.join(root, "storage", "ifc-cache", jobId, "schedule.csv");
    expect(fs.readFileSync(schedulePath, "utf-8")).toBe(SCHEDULE);
    expect(dispatched[0]).toMatchObject({
      schedule_artifact: {
        format: "csv",
        filename: "schedule.csv",
        checksum_sha256: sha(Buffer.from(SCHEDULE)),
        etag: "etag-schedule",
        host_local_path: expect.stringMatching(/host-storage.*schedule\.csv$/),
      },
      lineage_report: { pipeline_job_id: jobId },
    });

    const ingest = await request(active.app)
      .post(`/api/internal/conversions/${CONV}/ingest`)
      .set({ "X-Internal-Token": "dev-internal-token" })
      .send({});
    expect(ingest.status).toBe(202);

    await vi.waitFor(async () => {
      const report = await request(active!.app).get(`/api/lineage/conversion-reports/${CONV}`);
      expect(report.status).toBe(200);
      expect(report.body.minio_upload.status).toBe("uploaded");
    });
    const report = await request(active.app).get(`/api/lineage/conversion-reports/${CONV}`);
    expect(report.body).toMatchObject({
      status: "generated",
      ifc_ready_job_id: jobId,
      source_ifc: { bucket: "bim-control", key: IFC_KEY, etag: "etag-ifc" },
      schedule: { key: "899/main/p1/schedule.csv", etag: "etag-schedule", used: true },
    });
    expect(objects.puts).toEqual([
      `899/main/p1/lineage-reports/${CONV}/alignment_report.json`,
      `899/main/p1/lineage-reports/${CONV}/alignment_report.csv`,
    ]);

    const list = await request(active.app).get("/api/lineage/conversion-reports").query({ source_ifc_key: IFC_KEY });
    expect(list.body.items.map((item: { conversion_job_id: string }) => item.conversion_job_id)).toEqual([CONV]);
    const csv = await request(active.app).get(`/api/lineage/conversion-reports/${CONV}/files/alignment_report.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("csv_only");
    expect(fs.existsSync(path.join(root, "coordinator", "lineage-reports", "index.json"))).toBe(true);
  });
});
