import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurposeReportPage } from "./PurposeReportPage";

const report = {
 schemaVersion:"conversion-validation-record/v1", recordId:"report_1",readyModelId:"mw_1",
 conversionJobId:"job_1",tenantId:"tenant",projectId:"project",modelVersionId:"v1",
 source:{name:"building.ifc",sha256:"a".repeat(64)},artifacts:{usdcSha256:null,mappingSha256:null},
 validatedAt:"2026-09-09T00:00:00Z",converterVersion:"1",validatorVersion:"1",
 inventory:{expectedRenderable:null,convertedRenderable:2,missing:[{guid:"missing_1",reasonCodes:["no_geometry"]}],excluded:[]},
 correspondence:[{guid:"wall_1",primPaths:["/World/Wall"]}],purposes:[],
 evaluations:[
 {purpose:"view_3d",outcome:"usable_with_limits",policyId:"p",policyVersion:"1",reasonCodes:[],limitations:["部分構件缺漏"]},
 {purpose:"locate_highlight",outcome:"usable",policyId:"p",policyVersion:"1",reasonCodes:[],limitations:[]},
 {purpose:"distance_measurement",outcome:"not_validated",policyId:null,policyVersion:null,reasonCodes:["policy_not_configured"],limitations:[]},
 {purpose:"ifc_rules",outcome:"not_usable",policyId:"p",policyVersion:"1",reasonCodes:["failed"],limitations:[]},
 ]};
const models = {total:101,nextOffset:100,items:[{readyModelId:"mw_1",sourceName:"建築",modelVersionId:"v1"},
 {readyModelId:"mw_2",sourceName:"機電",modelVersionId:"v2"},
 ...Array.from({length:98},(_,i)=>({readyModelId:"mw_extra_"+i,sourceName:"歷史模型 "+i,modelVersionId:"v1"}))]};
const json = (v:unknown, status=200) => new Response(JSON.stringify(v),{status,headers:{"Content-Type":"application/json"}});
const history = {items:[{recordId:"report_1",readyModelId:"mw_1",modelVersionId:"v1",sourceName:"building.ifc",validatedAt:report.validatedAt}],total:1,nextOffset:null};
let host:HTMLDivElement, root:Root;
beforeEach(()=>{(globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){await act(async()=>{root.render(<PurposeReportPage/>);});}
async function select(label:string,value:string){await act(async()=>{const el=host.querySelector('select[aria-label="'+label+'"]') as HTMLSelectElement;expect(el).not.toBeNull();el.value=value;el.dispatchEvent(new Event("change",{bubbles:true}));});}
function button(text:string){return [...host.querySelectorAll("button")].find(b=>b.textContent?.includes(text))!;}
async function click(text:string){await act(async()=>{expect(button(text)).toBeTruthy();button(text).click();});}
function transport(override?:(url:string)=>Promise<Response>|undefined){
 return vi.spyOn(globalThis,"fetch").mockImplementation((input)=>{
 const url=String(input);const other=override?.(url);if(other)return other;
 if(url.includes("/api/conversion/validation-models?"))return Promise.resolve(json(models));
 if(url.endsWith("/validations?offset=0&limit=50"))return Promise.resolve(json(history));
 if(url.endsWith("/validations/report_1"))return Promise.resolve(json(report));
 throw new Error("Unexpected request "+url);
 });
}
async function selected(){await mount();await select("模型與版本","mw_1");await select("驗證紀錄","report_1");}
describe("human purpose report",()=>{
 it("labels local supervisor preview from the authorized catalog and clears it on failure",async()=>{
 let fail=false;
 transport(u=>u.includes("validation-models?")?Promise.resolve(fail?json({},503):json({...models,accessMode:"local-supervisor-preview"})):undefined);
 await mount();
 expect(host.querySelector('aside[aria-label="主管暫行驗證權限"]')?.textContent).toContain("未驗證公司登入身份");
 expect(host.textContent).toContain("24e598ab-be3d-4dbb-a1aa-60b0ba610618");
 fail=true;await click("載入更多模型紀錄");
 expect(host.querySelector('aside[aria-label="主管暫行驗證權限"]')).toBeNull();
 expect(host.textContent).toContain("報表服務或來源授權目前無法使用");
 });
 it("does not label an ordinary authority response as local preview",async()=>{
 transport();await mount();expect(host.querySelector('aside[aria-label="主管暫行驗證權限"]')).toBeNull();
 });
 it("cancels an in-progress PDF and discards its late bytes",async()=>{
 let resolve!:(r:Response)=>void;
 transport(u=>u.endsWith("?format=pdf")?new Promise(r=>{resolve=r;}):undefined);
 const anchor=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 await selected();await click("下載 PDF");await click("取消下載");
 expect(host.textContent).toContain("已取消下載");expect(button("下載 PDF").disabled).toBe(false);
 await act(async()=>resolve(new Response("%PDF-1.7\nlate",{headers:{"Content-Type":"application/pdf"}})));
 expect(anchor).not.toHaveBeenCalled();expect(host.textContent).not.toContain("已交給瀏覽器下載");
 });
 it("loads more authorized models instead of falling back to the public conversion list",async()=>{
 const fetcher=transport(u=>u.includes("validation-models?offset=100")?Promise.resolve(json({total:101,nextOffset:null,items:[{readyModelId:"last",sourceName:"最舊版本",modelVersionId:"v0"}]})):undefined);
 await mount();await click("載入更多模型紀錄");
 expect(host.querySelector('select[aria-label="模型與版本"]')?.textContent).toContain("最舊版本");
 expect(button("載入更多模型紀錄")).toBeUndefined();
 expect(fetcher.mock.calls.some(([url])=>String(url).includes("/api/conversion/records?"))).toBe(false);
 });
 it("refuses a detail response belonging to another model version",async()=>{
 transport(u=>u.endsWith("/validations/report_1")?Promise.resolve(json({...report,modelVersionId:"other"})):undefined);
 await selected();expect(host.textContent).toContain("報表讀取失敗");expect(button("下載 PDF")).toBeUndefined();
 });
 it("shows the missing source authority as a visible retryable failure",async()=>{
 transport(u=>u.includes("validation-models?")?Promise.resolve(json({detail:"private-provider"},503)):undefined);
 await mount();expect(host.textContent).toContain("報表服務或來源授權目前無法使用");
 expect(host.textContent).not.toContain("private-provider");expect(button("重試模型清單")).toBeTruthy();
 });
 it("downloads PDF with record filename and reports browser handoff, never disk success",async()=>{
 transport(u=>u.endsWith("?format=pdf")?Promise.resolve(new Response("%PDF-1.7\noriginal",{headers:{"Content-Type":"application/pdf"}})):undefined);
 vi.stubGlobal("URL",class extends URL {
   static createObjectURL=vi.fn(()=>"blob:report");
   static revokeObjectURL=vi.fn();
 });
 let name="";vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){name=this.download;});
 await selected();await click("下載 PDF");
 expect(name).toBe("report_1.pdf");expect(host.textContent).toContain("PDF 已交給瀏覽器下載");
 expect(host.textContent).not.toContain("已儲存");expect(host.querySelector("iframe,video")).toBeNull();
 expect(button("下載 CSV")).toBeTruthy();
 });
 it("shows PDF denial separately and allows retry",async()=>{
 transport(u=>u.endsWith("?format=pdf")?Promise.resolve(json({},403)):undefined);
 await selected();await click("下載 PDF");
 expect(host.textContent).toContain("沒有此報表的存取權限");expect(button("下載 PDF").disabled).toBe(false);
 });
 it("offers PDF retry after a service failure without dropping the report",async()=>{
 transport(u=>u.endsWith("?format=pdf")?Promise.resolve(json({},503)):undefined);
 await selected();await click("下載 PDF");
 expect(host.textContent).toContain("下載失敗，請再次按下載 PDF 重試");
 expect(host.textContent).toContain("building.ifc");expect(button("下載 PDF").disabled).toBe(false);
 });
 it("guards repeated synchronous clicks and late completion after unmount",async()=>{
 let resolve!:(r:Response)=>void;
 const fetcher=transport(u=>u.endsWith("?format=pdf")?new Promise(r=>{resolve=r;}):undefined);
 const anchor=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 await selected();
 await act(async()=>{button("下載 PDF").click();button("下載 PDF").click();});
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith("?format=pdf"))).toHaveLength(1);
 await act(async()=>root.render(null));
 await act(async()=>resolve(new Response("%PDF-1.7",{headers:{"Content-Type":"application/pdf"}})));
 expect(anchor).not.toHaveBeenCalled();
 });
 it.each(["model","report"])("suppresses late PDF after changing %s",async(kind)=>{
 let resolve!:(r:Response)=>void;
 transport(u=>u.endsWith("?format=pdf")?new Promise(r=>{resolve=r;}):u.includes("/mw_2/validations")?Promise.resolve(json({items:[],total:0,nextOffset:null})):undefined);
 const anchor=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 await selected();await click("下載 PDF");
 expect(button("下載 CSV").disabled).toBe(true);
 await select(kind==="model"?"模型與版本":"驗證紀錄",kind==="model"?"mw_2":"");
 await act(async()=>resolve(new Response("%PDF-1.7",{headers:{"Content-Type":"application/pdf"}})));
 expect(anchor).not.toHaveBeenCalled();
 expect(host.textContent).not.toContain("已交給瀏覽器");
 });
 it.each(["not_run",undefined])("does not present unobserved inventory as zero (%s)",async(observation)=>{
 const fetcher=transport(u=>u.endsWith("/validations/report_1")?Promise.resolve(json({...report,converterVersion:null,
   correspondence:null,inventory:{observation,expectedRenderable:null,convertedRenderable:null,missing:[],excluded:[]}})):undefined);
 await selected();
 const value=(label:string)=>[...host.querySelectorAll("dt")].find(el=>el.textContent===label)?.nextElementSibling?.textContent;
 expect(value("轉換器版本")).toBe("未取得版本資訊");
 expect(value("缺漏構件")).toBe("尚未盤點");expect(value("排除構件")).toBe("尚未盤點");
 const details=host.querySelector("details")!;
 expect(details.textContent).toContain("尚未盤點");
 expect([...details.querySelectorAll("pre")].some(el=>el.textContent?.includes('"missing": []'))).toBe(false);
 expect(host.querySelector("iframe,video")).toBeNull();expect(fetcher.mock.calls).toHaveLength(3);
 });
 it("preserves known legacy missing and excluded facts even with unknown counts",async()=>{
 transport(u=>u.endsWith("/validations/report_1")?Promise.resolve(json({...report,
   inventory:{...report.inventory,convertedRenderable:null,excluded:[{guid:"excluded_1",reason:"non_renderable"}]}})):undefined);
 await selected();
 for(const label of ["缺漏構件","排除構件"])expect([...host.querySelectorAll("dt")].find(el=>el.textContent===label)?.nextElementSibling?.textContent).toBe("1");
 expect(host.querySelector("details")?.textContent).toContain("missing_1");
 expect(host.querySelector("details")?.textContent).toContain("excluded_1");
 });
 it("keeps history pagination alive when selecting a report during loading",async()=>{
 let resolve!:(r:Response)=>void;
 transport(u=>u.endsWith("/validations?offset=0&limit=50")?Promise.resolve(json({...history,total:2,nextOffset:1})):
   u.endsWith("/validations?offset=1&limit=50")?new Promise(r=>{resolve=r;}):undefined);
 await mount();await select("模型與版本","mw_1");await click("載入更多歷史");
 await select("驗證紀錄","report_1");
 await act(async()=>resolve(json({items:[{...history.items[0],recordId:"report_2",sourceName:"second.ifc"}],total:2,nextOffset:null})));
 expect(host.querySelector('select[aria-label="驗證紀錄"]')?.textContent).toContain("second.ifc");
 expect(host.textContent).not.toContain("正在載入驗證紀錄");
 });
 it("reads four stored outcomes, unknown denominator and expandable source evidence without a viewer",async()=>{
 const fetcher = transport();await selected();
 expect(fetcher.mock.calls.some(([url])=>String(url).endsWith("/api/conversion/validation-models?offset=0&limit=100"))).toBe(true);
 expect(host.querySelector('select[aria-label="模型與版本"]')?.querySelectorAll("option").length).toBe(101);
 expect(button("載入更多模型紀錄")).toBeTruthy();
 for(const text of ["有限制可使用","可使用","尚未驗證","不可使用","未取得","部分構件缺漏","building.ifc"])expect(host.textContent).toContain(text);
 expect(host.querySelector("iframe,video")).toBeNull();
 expect(host.querySelector("details")?.textContent).toContain("report_1");
 expect(host.textContent).not.toContain("NOT_BUILT");
 });
 it("renders loading then empty records without download",async()=>{
 let resolve!:(r:Response)=>void;transport(u=>u.includes("/api/conversion/validation-models?")?new Promise(r=>{resolve=r;}):undefined);
 await mount();expect(host.textContent).toContain("載入");
 await act(async()=>resolve(json({total:0,nextOffset:null,items:[]})));
 expect(host.textContent).toContain("尚無模型");expect(button("下載 CSV")).toBeUndefined();
 });
 it("shows human denial and retries without exposing server detail",async()=>{
 let denied=true;transport(u=>u.endsWith("/validations?offset=0&limit=50")&&denied?Promise.resolve(json({detail:"private-server-path"},403)):undefined);
 await mount();await select("模型與版本","mw_1");
 expect(host.textContent).toContain("沒有此報表的存取權限");expect(host.textContent).not.toContain("private-server-path");
 denied=false;await click("重試");
 expect(host.querySelector('select[aria-label="驗證紀錄"]')?.textContent).toContain("building.ifc");
 });
 it("ignores a late detail from the previously selected model",async()=>{
 let resolve!:(r:Response)=>void;
 transport(u=>u.endsWith("/validations/report_1")?new Promise(r=>{resolve=r;}):u.includes("/mw_2/validations")?Promise.resolve(json({items:[],total:0,nextOffset:null})):undefined);
 await selected();await select("模型與版本","mw_2");
 await act(async()=>resolve(json({...report,source:{...report.source,name:"STALE.ifc"}})));
 expect(host.textContent).not.toContain("STALE.ifc");expect(host.textContent).toContain("尚無驗證紀錄");
 });
 it.each(["model", "report"])("does not download a late CSV after %s selection changes",async(kind)=>{
 let resolve!:(r:Response)=>void;
 transport(u=>u.endsWith("?format=csv")?new Promise(r=>{resolve=r;}):u.includes("/mw_2/validations")?Promise.resolve(json({items:[],total:0,nextOffset:null})):undefined);
 const anchor=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
 await selected();await click("下載 CSV");await select(kind === "model" ? "模型與版本" : "驗證紀錄",kind === "model" ? "mw_2" : "");
 await act(async()=>resolve(new Response("stale csv",{headers:{"Content-Type":"text/csv"}})));
 expect(anchor).not.toHaveBeenCalled();expect(host.textContent).not.toContain("下載失敗");
 });
 it("shows CSV failure and offers retry while retaining the selected report",async()=>{
 transport(u=>u.endsWith("?format=csv")?Promise.resolve(json({},503)):undefined);
 await selected();await click("下載 CSV");expect(host.textContent).toContain("下載失敗");expect(host.textContent).toContain("building.ifc");expect(button("下載 CSV")?.disabled).toBe(false);
 });
});
