import { afterEach,describe,expect,it,vi } from "vitest";
import { validationReportClient,ReportHttpError } from "./validationReportClient";
afterEach(()=>vi.restoreAllMocks());
describe("validation report transport",()=>{
 it("downloads exact PDF bytes through the coordinator",async()=>{
 const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("%PDF-1.7\noriginal",{headers:{"Content-Type":"application/pdf"}}));
 const blob=await validationReportClient.downloadPdf("model/一","report");
 expect(await blob.text()).toBe("%PDF-1.7\noriginal");
 expect(String(fetcher.mock.calls[0][0])).toContain("model%2F%E4%B8%80/validations/report?format=pdf");
 expect(fetcher.mock.calls[0][1]?.credentials).toBe("same-origin");
 });
 it.each([["text/html","%PDF-fake"],["application/pdf","not pdf"]])("rejects invalid PDF %s",async(type,body)=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(body,{headers:{"Content-Type":type}}));
 await expect(validationReportClient.downloadPdf("m","r")).rejects.toThrow();
 });
 it("preserves a PDF access denial without leaking server detail",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("private-sentinel",{status:403}));
 const error=await validationReportClient.downloadPdf("m","r").catch(e=>e);
 expect(error).toBeInstanceOf(ReportHttpError);expect(error.status).toBe(403);
 expect(error.message).not.toContain("private-sentinel");
 });
 it("encodes selectors without permitting URL injection",async()=>{
 const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('{"items":[],"total":0,"nextOffset":null}'));
 expect(await validationReportClient.getHistory("model/一",50)).toEqual({items:[],total:0,nextOffset:null});
 expect(String(fetcher.mock.calls[0][0])).toContain("/api/conversion/records/model%2F%E4%B8%80/validations?offset=50&limit=50");
 });
 it("returns exact CSV bytes as a Blob, not a navigation or recomputed report",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("原始,csv\r\n",{headers:{"Content-Type":"text/csv"}}));
 const blob=await validationReportClient.downloadCsv("model","report");
 expect(await blob.text()).toBe("原始,csv\r\n");
 });
 it("rejects denied detail and never puts private server messages in the error",async()=>{
 vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('{"detail":"private-sentinel"}',{status:403}));
 const error=await validationReportClient.getReport("m","r").catch(e=>e);
 expect(error).toBeInstanceOf(ReportHttpError);expect(error.status).toBe(403);expect(error.message).not.toContain("private-sentinel");
 });
 it("does not dispatch an already-aborted request",async()=>{
 const fetcher=vi.spyOn(globalThis,"fetch");const c=new AbortController();c.abort();
 await expect(validationReportClient.getReport("m","r",c.signal)).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
 });
});
