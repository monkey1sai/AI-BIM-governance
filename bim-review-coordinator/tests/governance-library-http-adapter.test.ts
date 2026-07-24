import { afterEach, describe, expect, it, vi } from "vitest";
import { GovernanceLibraryHttpAdapter } from "../src/services/governanceLibraryHttpAdapter.js";

const savedGovernanceApiBase = process.env.GOVERNANCE_API_BASE;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (savedGovernanceApiBase === undefined) {
    delete process.env.GOVERNANCE_API_BASE;
  } else {
    process.env.GOVERNANCE_API_BASE = savedGovernanceApiBase;
  }
});

describe("GovernanceLibraryHttpAdapter", () => {
  it("resolves the base per call and preserves operation-specific transport semantics", async () => {
    const timeoutSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ projects: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        "upstream failure at /var/data/model.ifc",
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GovernanceLibraryHttpAdapter();

    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:49001/";
    await expect(adapter.loadTree()).resolves.toEqual({ projects: [] });

    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:49002";
    const reply = await adapter.postRuleRun({ ifc_source_path: "C:\\srv\\model.ifc" });

    expect(reply).toEqual({
      status: 500,
      contentType: "text/plain; charset=utf-8",
      bodyText: "upstream failure at /var/data/model.ifc",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:49001/api/files/tree");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: "application/json" },
    });
    expect(timeoutSpy).toHaveBeenCalledOnce();
    expect(timeoutSpy).toHaveBeenCalledWith(3000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(timeoutSignal);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:49002/api/rule-runs");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ifc_source_path: "C:\\srv\\model.ifc" }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).not.toHaveProperty("signal");
  });

  it.each([
    ["non-2xx tree response", () => new Response("{}", { status: 503 })],
    ["invalid tree JSON", () => new Response("not-json", { status: 200 })],
  ])("rejects %s", async (_label, responseFactory) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFactory()));
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:49001";
    const adapter = new GovernanceLibraryHttpAdapter();

    await expect(adapter.loadTree()).rejects.toBeInstanceOf(Error);
  });

  it("defaults a missing POST content type without parsing or reserializing the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([111, 107]),
      { status: 202 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:49001";
    const adapter = new GovernanceLibraryHttpAdapter();

    const reply = await adapter.postRuleRun({
      ifc_source_path: "C:\\srv\\model.ifc",
    });

    expect(reply).toEqual({
      status: 202,
      contentType: "application/json",
      bodyText: "ok",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
