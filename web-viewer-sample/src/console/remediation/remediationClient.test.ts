import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the HTTP boundary is replaced: the client validates/serializes real commands.
const modules = import.meta.glob("./remediationClient.ts");
type Client = { confirm(id:string, command:Record<string, unknown>, signal?:AbortSignal):Promise<Record<string, unknown>> };
let client:Client;
beforeEach(async () => {
  expect(modules["./remediationClient.ts"]).toBeTypeOf("function");
  const loaded = await modules["./remediationClient.ts"]() as { remediationClient:Client };
  client = loaded.remediationClient;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const command = () => ({
  expected_revision:0, revised_model_version_id:"v2", revised_run_id:"rr2",
  revised_result_id:"res2", idempotency_key:"confirm-1",
});
const receipt = () => ({
  issue:{id:"issue/1",kind:"issue",title:"Fire door",description:null,status:"resolved",
    severity:"high",assignee:null,ifc_guid:"guid-1",usd_prim_path:null,model_version_id:"v1",
    source_type:"rule_result",source_ref:"res1",created_at:"2026-09-09T01:00:00Z",
    updated_at:"2026-09-09T02:00:00Z",revision:1},
  confirmation:{schema_version:"a1-remediation/v1",id:"rc1",issue_id:"issue/1",
    request_hash:"a".repeat(64),principal_ref:"test-supervisor",authorization_ref:"test-auth",
    correspondence_ref:"test-correspondence",created_at:"2026-09-09T02:00:00Z",
    revision_before:0,revision_after:1,note:"",
    original:{run_id:"rr1",model_version_id:"v1",ifc_guid:"guid-1",rule_code:"fire",
      rule_content_digest:"dsl-json-v1:sha256:"+"b".repeat(64),anchor_id:"res1",
      members:[{id:"res1",ifc_guid:"guid-1",rule_code:"fire",status:"fail"}]},
    revised:{run_id:"rr2",model_version_id:"v2",ifc_guid:"guid-1",rule_code:"fire",
      rule_content_digest:"dsl-json-v1:sha256:"+"b".repeat(64),anchor_id:"res2",
      members:[{id:"res2",ifc_guid:"guid-1",rule_code:"fire",status:"pass"}]}},
  replayed:false,
});
const response = (body:unknown, status=200) => new Response(JSON.stringify(body), {status});
describe("remediation confirmation transport", () => {
  it("sends only the six command fields through encoded coordinator route", async () => {
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(response(receipt()));
    const result=await client.confirm("issue/1",{...command(),role:"supervisor",actor:"spoof",status:"resolved"});
    expect(result).toEqual(receipt());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,init]=fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8004/api/governance/issues/issue%2F1/confirm-remediation");
    expect(init).toMatchObject({method:"POST",credentials:"same-origin",redirect:"error",
      headers:{"Content-Type":"application/json",Accept:"application/json"}});
    expect(JSON.parse(String(init?.body))).toEqual({...command(),note:""});
  });
  it("preserves current reopened state and historical confirmation on explicit same-key retry", async () => {
    const first=receipt(), replay=receipt(); replay.replayed=true; replay.issue.status="reopened"; replay.issue.revision=2;
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(replay));
    await client.confirm("issue/1",command());
    expect(await client.confirm("issue/1",command())).toEqual(replay);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  });
  it("captures identity before await even if caller mutates command", async () => {
    let complete!:(value:Response)=>void;
    vi.spyOn(globalThis,"fetch").mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
    const input=command(), pending=client.confirm("issue/1",input);
    input.revised_run_id="other";
    complete(response(receipt()));
    expect(await pending).toEqual(receipt());
  });
  it.each([
    [503,"remediation_authorization_unavailable"],[503,"remediation_persistence_unavailable"],
    [403,"remediation_authorization_denied"],[409,"remediation_conflict"],[422,"remediation_evidence_invalid"],
  ])("allows only known error status/code pair %s %s",async (status,code)=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(response({detail:{code,debug:"PRIVATE"}},Number(status)));
    const error=await client.confirm("issue/1",command()).catch(e=>e);
    expect(error).toMatchObject({code,status});
    expect(String(error)).not.toContain("PRIVATE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400,401,403,409,422,502,503])("never exposes raw or mismatched errors %s",async status=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(response({detail:{code:"PRIVATE",path:"PRIVATE"}},status));
    const error=await client.confirm("issue/1",command()).catch(e=>e);
    expect(error).toMatchObject({code:"request_failed",status});
    expect(String(error)).not.toContain("PRIVATE");
  });
  it("rejects an otherwise known error with the wrong HTTP status",async ()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(response({detail:{code:"remediation_conflict"}},503));
    await expect(client.confirm("issue/1",command())).rejects.toMatchObject({code:"request_failed",status:503});
  });
  it("maps network and non-JSON upstream errors without retry or details",async ()=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(new Error("PRIVATE endpoint"))
      .mockResolvedValueOnce(new Response("PRIVATE upstream",{status:502}));
    await expect(client.confirm("issue/1",command())).rejects.toMatchObject({code:"request_failed",status:0});
    await expect(client.confirm("issue/1",command())).rejects.toMatchObject({code:"request_failed",status:502});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    (r:ReturnType<typeof receipt>)=>{r.issue.id="other";},
    (r:ReturnType<typeof receipt>)=>{r.issue.revision=-1;},
    (r:ReturnType<typeof receipt>)=>{r.issue.status="";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.issue_id="other";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.schema_version="unknown";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.id="";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.revised.run_id="other";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.revised.model_version_id="other";},
    (r:ReturnType<typeof receipt>)=>{r.confirmation.revised.anchor_id="other";},
  ])("rejects malformed or cross-request receipt %#",async mutate=>{
    const value=receipt();mutate(value);
    vi.spyOn(globalThis,"fetch").mockResolvedValue(response(value));
    await expect(client.confirm("issue/1",command())).rejects.toMatchObject({code:"invalid_response"});
  });
  it.each([null,{},[],{...receipt(),replayed:"yes"}])("rejects missing receipt structure %#",async value=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(response(value));
    await expect(client.confirm("issue/1",command())).rejects.toMatchObject({code:"invalid_response"});
  });
  it("rejects invalid successful JSON without leaking its contents",async ()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("PRIVATE"));
    const error=await client.confirm("issue/1",command()).catch(e=>e);
    expect(error.code).toBe("invalid_response");expect(String(error)).not.toContain("PRIVATE");
  });
  it.each([-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,"0",null])("rejects invalid revision %# before HTTP",async revision=>{
    const fetcher=vi.spyOn(globalThis,"fetch");
    await expect(client.confirm("issue/1",{...command(),expected_revision:revision})).rejects.toMatchObject({code:"invalid_request"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([""," x","x ","x\n","x\u007f","x".repeat(513)])("rejects malformed identifier %# before HTTP",async id=>{
    const fetcher=vi.spyOn(globalThis,"fetch");
    for (const field of ["revised_model_version_id","revised_run_id","revised_result_id","idempotency_key"]) {
      await expect(client.confirm("issue/1",{...command(),[field]:id})).rejects.toMatchObject({code:"invalid_request"});
    }
    await expect(client.confirm(id,command())).rejects.toMatchObject({code:"invalid_request"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null,5,"n".repeat(4001)])("rejects invalid note %#",async note=>{
    const fetcher=vi.spyOn(globalThis,"fetch");
    await expect(client.confirm("issue/1",{...command(),note})).rejects.toMatchObject({code:"invalid_request"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains note and accepts documented boundary lengths",async ()=>{
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(response(receipt()));
    await client.confirm("issue/1",{...command(),idempotency_key:"k".repeat(512),note:"n".repeat(4000)});
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).note).toHaveLength(4000);
  });
  it("does not send a pre-aborted request or expose abort reason",async ()=>{
    const controller=new AbortController();controller.abort("PRIVATE");
    const fetcher=vi.spyOn(globalThis,"fetch");
    const error=await client.confirm("issue/1",command(),controller.signal).catch(e=>e);
    expect(error.code).toBe("request_failed");expect(String(error)).not.toContain("PRIVATE");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects after body read if caller aborted, even if transport ignores signal",async ()=>{
    const controller=new AbortController();
    const res=response(receipt());
    vi.spyOn(res,"json").mockImplementation(async()=>{controller.abort("PRIVATE");return receipt();});
    vi.spyOn(globalThis,"fetch").mockResolvedValue(res);
    await expect(client.confirm("issue/1",command(),controller.signal)).rejects.toMatchObject({code:"request_failed"});
  });
  it("aborts a pending fetch at 15 seconds, cleans resources and never retries",async ()=>{
    vi.useFakeTimers();
    const controller=new AbortController(), removed=vi.spyOn(controller.signal,"removeEventListener");
    const fetcher=vi.spyOn(globalThis,"fetch").mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener("abort",()=>reject(new Error("PRIVATE")),{once:true});
    }));
    const outcome=client.confirm("issue/1",command(),controller.signal).catch(e=>e);
    await vi.advanceTimersByTimeAsync(15000);
    expect(await outcome).toMatchObject({code:"request_failed"});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith("abort",expect.any(Function));
  });
  it("cleans success timers and abort listeners without changing viewer state",async ()=>{
    vi.useFakeTimers();
    const controller=new AbortController(), removed=vi.spyOn(controller.signal,"removeEventListener");
    const fetcher=vi.spyOn(globalThis,"fetch").mockResolvedValue(response(receipt()));
    const originalHash=window.location.hash;
    await client.confirm("issue/1",command(),controller.signal);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith("abort",expect.any(Function));
    expect(window.location.hash).toBe(originalHash);
  });
});
