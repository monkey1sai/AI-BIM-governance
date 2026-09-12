import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createConversionValidationRecord } from "../src/services/conversionValidationRecord.js";
import { projectValidationReport } from "../src/services/conversionValidationReportProjection.js";
import { serializeValidationReportPdf } from "../src/services/conversionValidationReportPdf.js";
import { registerConversionValidationReports } from "../src/routes/conversionValidationReports.js";

const grant = { tenantId: "tenant", projectId: "project", modelVersionId: "v1" };
function fixture() {
  return projectValidationReport(createConversionValidationRecord({
    recordId: "report_pdf", readyModelId: "ready", conversionJobId: "job", ...grant,
    source: { name: "臺灣建築審查.ifc", sha256: "a".repeat(64) },
    artifacts: { usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64) },
    converterVersion: null, validatorVersion: "驗證器一", validatedAt: "2026-09-09T00:00:00Z",
    inventory: { expectedRenderable: 2, convertedRenderable: 1,
      missing: [{ guid: "missing_last", reasonCodes: ["no_geometry"] }],
      excluded: [{ guid: "excluded_last", reason: "outside_approved_scope" }] },
    correspondence: [{ guid: "wall_last", primPaths: ["/World/Wall_last"] }],
    purposes: [
      { purpose: "view_3d", policy: { id: "view", version: "一", purpose: "view_3d", requiredCheckIds: ["shape"] },
        checks: [{ id: "shape", state: "pass_with_limits", reasonCodes: ["partial"], limitations: ["梁柱缺漏，僅供示意檢視。"] }] },
      { purpose: "locate_highlight", policy: { id: "locate", version: "一", purpose: "locate_highlight", requiredCheckIds: ["mapping"] },
        checks: [{ id: "mapping", state: "pass", reasonCodes: [] }] },
      { purpose: "ifc_rules", policy: { id: "rules", version: "一", purpose: "ifc_rules", requiredCheckIds: ["rule"] },
        checks: [{ id: "rule", state: "fail", reasonCodes: ["rule_failed"] }] },
    ],
  }));
}
async function inspect(bytes: Buffer) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => "str" in item ? item.str : "").join(""));
    }
    const attachments = await pdf.getAttachments();
    return { pages, attached: JSON.parse(new TextDecoder().decode(attachments["validation-record.json"].content)) };
  } finally { await pdf.destroy(); }
}
afterEach(() => vi.restoreAllMocks());

describe("PDF immutable report export", () => {
  it("cancels an active render without emitting partial bytes and releases admission", async () => {
    const controller=new AbortController(), dto=fixture();
    dto.correspondence=Array.from({length:180},(_,n)=>({guid:"guid_"+n,primPaths:["/World/Wall_"+n]}));
    const rendering=serializeValidationReportPdf(dto,controller.signal);
    controller.abort();
    await expect(rendering).rejects.toThrow("PDF report unavailable.");
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
  it("keeps all four purposes and unknown inventory on page one with 50 valid limitations", async () => {
    const {schemaVersion:_schema,evaluations:_evaluations,...input}=fixture();
    const first=input.purposes[0].checks[0];
    if(first.state!=="pass_with_limits")throw new Error("fixture");
    first.limitations=Array.from({length:50},(_,i)=>"限制"+i+"：構件對照尚有缺漏，請核對原始資料及模型版本後使用。");
    const dto=createConversionValidationRecord({...input,correspondence:null,
      inventory:{observation:"not_run",expectedRenderable:null,convertedRenderable:null,missing:[],excluded:[]}});
    const result=await inspect(await serializeValidationReportPdf(dto));
    for(const label of ["3D 檢視","構件定位與高亮","距離量測","IFC 規則檢核","尚未盤點"])expect(result.pages[0]).toContain(label);
    expect(result.pages.join("")).toContain("限制49");
    expect(result.attached).toEqual(dto);
  });
  it("rejects unsupported glyphs instead of silently losing source text", async () => {
    const dto=fixture();dto.source.name="模型🧱.ifc";
    await expect(serializeValidationReportPdf(dto).then(()=>true)).rejects.toThrow("PDF report unavailable.");
  });
  it("embeds Chinese, full DTO and all four stored conclusions without changing the record", async () => {
    const dto = fixture(), before = JSON.stringify(dto);
    const bytes = await serializeValidationReportPdf(dto);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("/FontFile3");
    const result = await inspect(bytes), text = result.pages.join("");
    for (const item of ["臺灣建築審查.ifc", "3D 檢視", "構件定位與高亮", "距離量測", "IFC 規則檢核",
      "有限制可使用", "可使用", "不可使用", "尚未驗證", "梁柱缺漏", "report_pdf", "v1",
      "2026-09-09T00:00:00Z", "missing_last", "no_geometry", "excluded_last",
      "outside_approved_scope", "wall_last", "/World/Wall_last", dto.source.sha256]) {
      expect(text).toContain(item);
    }
    expect(result.attached).toEqual(dto);
    expect(JSON.stringify(dto)).toBe(before);
  });
  it("paginates full body to the last correspondence, missing and excluded entry", async () => {
    const dto = fixture();
    dto.correspondence = Array.from({ length: 180 }, (_, n) => ({ guid: "guid_" + n, primPaths: ["/World/構件_" + n] }));
    const bytes = await serializeValidationReportPdf(dto);
    const result = await inspect(bytes);
    expect(result.pages.length).toBeGreaterThan(2);
    expect(result.pages.join("")).toContain("/World/構件_179");
    expect(result.pages.join("")).toContain("missing_last");
    expect(result.pages.join("")).toContain("outside_approved_scope");
    expect(result.attached).toEqual(dto);
    if (process.env.PDF_REPORT_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.PDF_REPORT_ARTIFACT_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.PDF_REPORT_ARTIFACT_DIR, "purpose-report.pdf"), bytes);
      fs.writeFileSync(path.join(process.env.PDF_REPORT_ARTIFACT_DIR, "purpose-report.json"), JSON.stringify(dto));
    }
  });
  it("keeps unknown inventory and unknown version explicit", async () => {
    const dto = fixture();
    dto.inventory = { observation: "not_run", expectedRenderable: null, convertedRenderable: null, missing: [], excluded: [] };
    dto.correspondence = null;
    const result = await inspect(await serializeValidationReportPdf(dto));
    expect(result.pages[0]).toContain("尚未盤點");
    expect(result.pages[0]).toContain("未取得");
    expect(result.attached.inventory.expectedRenderable).toBeNull();
  });
  it("rejects oversized input and releases admission for the next report", async () => {
    const dto = fixture(); dto.source.name = "長".repeat(8000001);
    await expect(serializeValidationReportPdf(dto)).rejects.toThrow();
    expect((await serializeValidationReportPdf(fixture())).subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("rejects a concurrent render, then admits a subsequent one", async () => {
    const first = serializeValidationReportPdf(fixture());
    await expect(serializeValidationReportPdf(fixture())).rejects.toThrow();
    await first;
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
  it("rejects excessive pages instead of truncating content and releases admission", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text").mockImplementationOnce(function(this:PDFKit.PDFDocument) {
      for(let i=0;i<601;i++)this.addPage(); return this;
    });
    await expect(serializeValidationReportPdf(fixture()).then(()=>true)).rejects.toThrow();
    text.mockRestore();
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
  it("rejects output byte overflow and releases admission", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text").mockImplementationOnce(function(this:PDFKit.PDFDocument) {
      this.emit("data", Buffer.alloc(16 * 1024 * 1024 + 1)); return this;
    });
    await expect(serializeValidationReportPdf(fixture())).rejects.toThrow();
    text.mockRestore();
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
  it("rejects a font-loading error without exposing its path and releases admission", async () => {
    const font = vi.spyOn(PDFDocument.prototype, "font").mockImplementationOnce(() => { throw new Error("C:/private-sentinel"); });
    const error = await serializeValidationReportPdf(fixture()).catch(e => e);
    expect(error.message).toBe("PDF report unavailable.");
    font.mockRestore();
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
  it("rejects stream errors without an unhandled rejection", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text").mockImplementationOnce(function(this:PDFKit.PDFDocument) {
      this.emit("error", new Error("private-stream-sentinel")); return this;
    });
    await expect(serializeValidationReportPdf(fixture())).rejects.toThrow("PDF report unavailable.");
    text.mockRestore();
    await expect(serializeValidationReportPdf(fixture())).resolves.toBeInstanceOf(Buffer);
  });
});

describe("authorized PDF route", () => {
  const url = "/api/conversion/records/ready/validations/report_pdf?format=pdf";
  function setup(scopes: typeof grant[] | null = [grant]) {
    const dto = fixture(), list = vi.fn(() => [dto]), app = express();
    registerConversionValidationReports(app, { ledger: { listValidationRecords: list }, access: async () => scopes === null ? null : ({
      subject: "test-only-operator", actorKind: "operator", expiresAt: new Date(Date.now()+120000).toISOString(),
      sources: scopes.map(source => ({...source, readyModelId: "ready", sourceSha256: "a".repeat(64)})),
    }) });
    return { app, list, dto };
  }
  it("downloads parseable bytes from the same JSON record with safe headers", async () => {
    const { app, dto } = setup();
    const before = JSON.stringify(dto);
    const json = await request(app).get(url.replace("?format=pdf", "")).expect(200);
    const pdf = await request(app).get(url).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toBe('attachment; filename="report_pdf.pdf"');
    expect(pdf.headers["cache-control"]).toBe("no-store");
    expect(pdf.headers["x-content-type-options"]).toBe("nosniff");
    expect((await inspect(pdf.body)).attached).toEqual(json.body);
    expect(JSON.stringify(dto)).toBe(before);
  });
  it.each([null, []])("denies before reading records for missing grants (%s)", async grants => {
    const { app, list } = setup(grants);
    await request(app).get(url).set("X-Role", "supervisor").expect(grants === null ? 403 : 404);
    expect(list).not.toHaveBeenCalled();
  });
  it.each(["tenantId", "projectId", "modelVersionId"])("rejects mismatched %s", async field => {
    const { app } = setup([{ ...grant, [field]: "other" }]);
    await request(app).get(url).expect(404);
  });
  it("sanitizes failure and never sends a partial PDF", async () => {
    const { app, dto } = setup(); dto.validatorVersion = "file:///private-sentinel";
    const result = await request(app).get(url).expect(503);
    expect(result.text).not.toContain("private-sentinel");
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.headers["content-disposition"]).toBeUndefined();
  });
  it("keeps oversized render failures as JSON and recovers", async () => {
    const { app, dto } = setup();
    dto.correspondence = Array.from({length:200001},()=>({guid:"g",primPaths:["/World/G"]}));
    const result = await request(app).get(url).expect(503);
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.headers["content-disposition"]).toBeUndefined();
    dto.correspondence = null;
    await request(app).get(url).expect(200);
  });
  it("does not download a PDF with missing glyphs", async () => {
    const { app, dto } = setup();dto.source.name="模型🧱.ifc";
    const result=await request(app).get(url).expect(503);
    expect(result.headers["content-disposition"]).toBeUndefined();
    expect(result.headers["content-type"]).toContain("application/json");
  });
});
