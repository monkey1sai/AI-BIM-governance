import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversionLedger } from "../src/services/conversionLedger.js";
import { registerConversionValidationReports } from "../src/routes/conversionValidationReports.js";
import { projectValidationReport } from "../src/services/conversionValidationReportProjection.js";
import { resolveValidationReportAccess, type ValidationReportAccess, type ValidationReportDecision } from "../src/services/validationReportAccess.js";

const roots: string[] = [];
const readyModelId = "worker:圖書館/2026#建築";
const source = { readyModelId, tenantId: "tenant-一", projectId: "project/圖書館", modelVersionId: "version:一", sourceSha256: "a".repeat(64) };
const base = "/api/conversion/records/" + encodeURIComponent(readyModelId) + "/validations";
const catalog = "/api/conversion/validation-models";
const grant = (): ValidationReportDecision => ({ subject: "test-only-operator", actorKind: "operator",
  expiresAt: new Date(Date.now() + 120000).toISOString(), sources: [source] });
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive:true,force:true}); vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purpose-reports-")); roots.push(root);
  const file = path.join(root, "ledger.json"), ledger = new ConversionLedger(file);
  ledger.upsert({ idempotency_key: readyModelId, correlation_id: "trace", project_id: source.projectId,
    project_display_name: "圖書館", category: "A", external_model_version_id: source.modelVersionId,
    conversion_job_id: "job", status: "ready" }, "2026-09-12T00:00:00Z");
  const input = { recordId: "report_1", readyModelId, conversionJobId: "job",
    tenantId: source.tenantId, projectId: source.projectId, modelVersionId: source.modelVersionId,
    source: {name: '=圖書館,"建築".ifc', sha256: source.sourceSha256},
    artifacts: {usdcSha256: "b".repeat(64), mappingSha256: "c".repeat(64)},
    correspondence: [{guid:"wall", primPaths:["/World/Wall"]}], converterVersion: null,
    validatorVersion: "v1", validatedAt: "2026-09-12T00:00:00Z",
    inventory: {expectedRenderable:2, convertedRenderable:1,
      missing:[{guid:"missing",reasonCodes:["no_geometry"]}], excluded:[]}, purposes: [],
  };
  ledger.appendValidationRecord(readyModelId, input);
  ledger.appendValidationRecord(readyModelId, {...input, recordId:"report_2", validatedAt:"2026-09-12T01:00:00Z"});
  return {file, ledger};
}
function appFor(ledger: Pick<ConversionLedger,"listValidationRecords">, access?: ValidationReportAccess) {
  const app = express(); registerConversionValidationReports(app, {ledger,access}); return app;
}
// Independent RFC4180 parser; compare decoded export with the actual HTTP JSON body.
function readCsv(csv: string) {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i=0;i<text.length;i++) {
    const char=text[i];
    if (char==='"') { if(quoted && text[i+1]==='"') {field+='"';i++;} else quoted=!quoted; }
    else if(char==="," && !quoted) {row.push(field);field="";}
    else if(char==="\r" && text[i+1]==="\n" && !quoted) {row.push(field);rows.push(row);row=[];field="";i++;}
    else field+=char;
  }
  return rows;
}

describe("source-authorized persisted reports", () => {
  it("fails closed before any ledger read without a deployment adapter", async () => {
    const list = vi.fn(() => {throw new Error("private-path");}), app = appFor({listValidationRecords:list});
    for(const url of [catalog,base,base+"/report_1",base+"/report_1?format=csv",base+"/report_1?format=pdf"]) {
      const result = await request(app).get(url).set("Authorization","Bearer test-only").set("X-Role","supervisor").expect(503);
      expect(result.text).not.toContain("private-path");
    }
    expect(list).not.toHaveBeenCalled();
  });
  it("preserves opaque worker IDs, paginates history and reloads identical records", async () => {
    const {ledger,file} = fixture(), before=fs.readFileSync(file,"utf8"), access=vi.fn(async()=>grant());
    const app=appFor(ledger,access);
    expect((await request(app).get(catalog).expect(200)).body.items[0].readyModelId).toBe(readyModelId);
    const first=await request(app).get(base+"?limit=1").expect(200);
    expect(first.body.items[0].recordId).toBe("report_2"); expect(first.body.nextOffset).toBe(1);
    const second=await request(app).get(base+"?limit=1&offset=1").expect(200);
    expect(second.body.items[0].recordId).toBe("report_1");expect(second.body.nextOffset).toBeNull();
    const reloaded=appFor(new ConversionLedger(file),access);
    const json=await request(reloaded).get(base+"/report_1").expect(200);
    expect(json.body).toEqual(projectValidationReport(ledger.listValidationRecords(readyModelId)[0]));
    expect(fs.readFileSync(file,"utf8")).toBe(before);
  });
  it("returns CSV from the same historical snapshot with no current-policy recomputation", async () => {
    const {ledger,file}=fixture(), before=fs.readFileSync(file,"utf8"), app=appFor(ledger,async()=>grant());
    const json=await request(app).get(base+"/report_1").expect(200);
    const csv=await request(app).get(base+"/report_1?format=csv").expect(200);
    expect(Object.fromEntries(readCsv(csv.text).slice(1).map(row=>[row[3],JSON.parse(row[4])]))).toEqual(json.body);
    expect(json.body.evaluations.map((value:{outcome:string})=>value.outcome)).toEqual(Array(4).fill("not_validated"));
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="report_1.csv"');
    expect(csv.headers["cache-control"]).toBe("no-store");expect(csv.headers["x-content-type-options"]).toBe("nosniff");
    expect(fs.readFileSync(file,"utf8")).toBe(before);
  });
  it.each(["tenantId","projectId","modelVersionId","readyModelId","sourceSha256"] as const)("hides all formats and catalog totals for wrong %s", async field => {
    const {ledger}=fixture(), access=grant(); access.sources[0]={...source,[field]:field==="sourceSha256"?"f".repeat(64):"other"};
    const app=appFor(ledger,async()=>access);
    for(const url of [catalog,base]) expect((await request(app).get(url).expect(200)).body).toEqual({items:[],total:0,nextOffset:null});
    for(const format of ["json","pdf","csv"]) {
      const hidden=await request(app).get(base+"/report_1?format="+format).expect(404);
      const absent=await request(app).get(base+"/absent?format="+format).expect(404);
      expect(hidden.body).toEqual(absent.body);
    }
  });
  it("denies expired, service-account and forged decisions before ledger reads", async () => {
    const list=vi.fn(()=>[]);
    const invalid=[null,{...grant(),expiresAt:"2020-01-01T00:00:00Z"},{...grant(),actorKind:"service_account"},{...grant(),sources:[{...source,sourceSha256:"bad"}]}];
    for(const value of invalid) {
      const access=(async()=>value) as ValidationReportAccess;
      await request(appFor({listValidationRecords:list},access)).get(base).expect(403);
    }
    expect(list).not.toHaveBeenCalled();
  });
  it("binds the adapter request target and sanitizes adapter failures", async () => {
    const {ledger}=fixture(), access=vi.fn<ValidationReportAccess>(async()=>grant()), app=appFor(ledger,access);
    await request(app).get(base+"/report_1?format=csv").expect(200);
    expect(access.mock.calls[0]?.[1]).toEqual({readyModelId,recordId:"report_1",format:"csv"});
    const failed=await request(appFor(ledger,async()=>{throw new Error("https://secret.invalid");})).get(base).expect(503);
    expect(failed.text).not.toContain("secret.invalid");
  });
  it.each(["?offset=-1","?limit=0","?limit=101","?offset=9007199254740992","?limit=2&limit=3","?role=operator"])("rejects malformed selectors %s", async query=> {
    const {ledger}=fixture();await request(appFor(ledger,async()=>grant())).get(base+query).expect(400);
  });
  it("aborts an unresponsive authority with a sanitized timeout", async()=> {
    vi.useFakeTimers();let signal:AbortSignal|undefined;
    const pending=resolveValidationReportAccess((_request,_target,s)=>{signal=s;return new Promise(()=>{});},{} as express.Request,{format:"models"});
    const result=expect(pending).rejects.toThrow("Report authorization unavailable.");
    await vi.advanceTimersByTimeAsync(5000);await result;expect(signal?.aborted).toBe(true);
  });
});
