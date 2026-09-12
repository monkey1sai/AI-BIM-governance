import { afterEach, describe, expect, it, vi } from "vitest";

const modules = import.meta.glob("./remediationHistoryClient.ts");
async function client() {
  expect(modules["./remediationHistoryClient.ts"], "history client is implemented").toBeTypeOf("function");
  return (await modules["./remediationHistoryClient.ts"]() as typeof import("./remediationHistoryClient")).remediationHistoryClient;
}
function page() {
  const group = { run_id: "r1", model_version_id: "v1", ifc_guid: "g1", rule_code: "NAME",
    rule_content_digest: "digest", anchor_id: "a1", members: [{ id: "a1", ifc_guid: "g1", rule_code: "NAME", status: "fail" }] };
  return { issue: { id: "i/1", status: "reopened", revision: 2, model_version_id: "v1", ifc_guid: "g1", source_ref: "a1" },
    items: [{ schema_version: "a1-remediation/v1", id: "c1", issue_id: "i/1", principal_ref: "test-supervisor",
      created_at: "2026-09-09T00:00:00Z", revision_before: 0, revision_after: 1, note: "checked",
      original: group, revised: { ...group, model_version_id: "v2", run_id: "r2", members: [{ ...group.members[0], status: "pass" }] } }],
    total: 1, limit: 20, offset: 0, next_offset: null as number | null };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("authorized history read client", () => {
  it("uses encoded coordinator GET without browser authority and preserves reopened", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(page())));
    vi.stubGlobal("fetch", fetcher);
    expect(await (await client()).read("i/1")).toEqual(page());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/api/governance/issues/i%2F1/remediation-history?limit=20&offset=0");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", headers: { Accept: "application/json" } });
    expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });
  it.each(["", " i1", "i\n1"])("rejects invalid identifier %j before network", async id => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect((await client()).read(id)).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])("rejects offset %s", async offset => {
    vi.stubGlobal("fetch", vi.fn());
    await expect((await client()).read("i/1", offset)).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["issue", "status", "schema", "revision", "group", "member", "count", "offset", "next", "duplicate"])("rejects malformed %s", async kind => {
    const value = page();
    if (kind === "issue") value.issue.id = "other";
    if (kind === "status") value.issue.status = "invented";
    if (kind === "schema") value.items[0].schema_version = "unknown";
    if (kind === "revision") value.items[0].revision_after = 9;
    if (kind === "group") value.items[0].original.model_version_id = "other";
    if (kind === "member") value.items[0].revised.members[0].status = "unknown";
    if (kind === "count") value.total = 2;
    if (kind === "offset") value.offset = 1;
    if (kind === "next") value.next_offset = 1;
    if (kind === "duplicate") { value.items.push(value.items[0]); value.total = 2; }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await expect((await client()).read("i/1")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("projects away internal fields at each nested level", async () => {
    const value = page();
    Object.assign(value.issue, { authorization_ref: "private" });
    Object.assign(value.items[0], { request_hash: "private" });
    Object.assign(value.items[0].original, { correspondence_ref: "private" });
    Object.assign(value.items[0].revised.members[0], { idempotency_key: "private" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    expect(JSON.stringify(await (await client()).read("i/1"))).not.toContain("private");
  });
  it("accepts coherent 20-plus-1 pagination with exact next offsets", async () => {
    const first = page(); first.issue.revision = 42; first.total = 21; first.next_offset = 20;
    first.items = Array.from({ length: 20 }, (_, i) => ({ ...page().items[0], id: `c${i}`, revision_before: i * 2, revision_after: i * 2 + 1 }));
    const second = { ...first, items: [{ ...page().items[0], id: "c20", revision_before: 40, revision_after: 41 }], offset: 20, next_offset: null };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockResolvedValueOnce(new Response(JSON.stringify(second))));
    const api = await client();
    expect((await api.read("i/1")).next_offset).toBe(20);
    const last = await api.read("i/1", 20);
    expect(last.items[0].id).toBe("c20"); expect(last.next_offset).toBeNull();
  });
  it("rejects array-valued status instead of coercing it into PASS", async () => {
    const value = page();
    Object.assign(value.items[0].revised.members[0], { status: ["pass"] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await expect((await client()).read("i/1")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each([403, 404, 503])("returns safe HTTP error %s", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private server details", { status })));
    await expect((await client()).read("i/1")).rejects.toMatchObject({ status, message: "request_failed" });
  });
  it.each([403, 503])("cancels unread HTTP %s body without waiting for stream cleanup", async status => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { status });
    const json = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect((await client()).read("i/1")).rejects.toMatchObject({ status, message: "request_failed" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
  });
  it("rejects malformed success JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));
    await expect((await client()).read("i/1")).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("sanitizes network exceptions without retry", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private")); vi.stubGlobal("fetch", fetcher);
    await expect((await client()).read("i/1")).rejects.toMatchObject({ message: "request_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a parent-aborted request before fetch", async () => {
    const controller = new AbortController(); controller.abort("private");
    vi.stubGlobal("fetch", vi.fn());
    await expect((await client()).read("i/1", 0, controller.signal)).rejects.toMatchObject({ message: "request_failed" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("times out response body and discards late JSON", async () => {
    const api = await client(); vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const json = new Promise(r => { resolve = r; });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => json }));
    const pending = api.read("i/1");
    const checked = expect(pending).rejects.toMatchObject({ message: "request_failed" });
    await vi.advanceTimersByTimeAsync(15001); resolve(page()); await checked;
  });
});
