import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { createCoordinatorApp } from "../src/app.js";
import { createLocalSupervisorReportAccess } from "../src/services/localSupervisorReportAccess.js";
import { resolveValidationReportAccess } from "../src/services/validationReportAccess.js";
import { registerConversionValidationReports } from "../src/routes/conversionValidationReports.js";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const address: AddressInfo = { address: "127.0.0.1", family: "IPv4", port: 12345 };
function request(rawHeaders = ["Host", "127.0.0.1:12345"], socket = {}) {
  return { method: "GET", rawHeaders, socket: {
    localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", localPort: 12345, ...socket,
  } } as express.Request;
}
const invoke = (req = request(), bound: AddressInfo | string | null = address) =>
  createLocalSupervisorReportAccess(() => bound)(req, { format: "models" }, new AbortController().signal);

describe("owner-enabled local supervisor preview", () => {
  it("defaults off and parses only explicit true or false", () => {
    vi.stubEnv("VALIDATION_REPORT_SUPERVISOR_PREVIEW", undefined);
    expect(loadConfig().validationReportSupervisorPreview).toBe(false);
    vi.stubEnv("VALIDATION_REPORT_SUPERVISOR_PREVIEW", "true");
    expect(loadConfig({ host: "127.0.0.1" }).validationReportSupervisorPreview).toBe(true);
    vi.stubEnv("VALIDATION_REPORT_SUPERVISOR_PREVIEW", "false");
    expect(loadConfig().validationReportSupervisorPreview).toBe(false);
    vi.stubEnv("VALIDATION_REPORT_SUPERVISOR_PREVIEW", "1");
    expect(() => loadConfig()).toThrow("must be true or false");
  });
  it.each(["0.0.0.0", "::", "192.168.1.1", "localhost"])("rejects configured bind %s", host => {
    expect(() => loadConfig({ host, validationReportSupervisorPreview: true })).toThrow("explicit loopback");
  });
  it("rejects production and mixing a formal adapter before app side effects", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => loadConfig({ validationReportSupervisorPreview: true })).toThrow("non-production");
    vi.stubEnv("NODE_ENV", "test");
    expect(() => createCoordinatorApp({ validationReportSupervisorPreview: true, host: "127.0.0.1" },
      { validationReportAccess: async () => null })).toThrow("cannot be combined");
  });
  it("grants only the fixed library tuple with a distinct local principal and bounded expiry", async () => {
    const grant = await invoke();
    expect(grant).toMatchObject({ subject: "local-supervisor-preview", actorKind: "local_supervisor_preview",
      sources: [{ tenantId: "tenant_library_validation", projectId: "project_library_validation",
        modelVersionId: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", readyModelId: "mw_library_validation",
        sourceSha256: "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce" }] });
    expect(Date.parse(grant!.expiresAt) - Date.now()).toBeGreaterThan(290000);
    expect(Date.parse(grant!.expiresAt) - Date.now()).toBeLessThanOrEqual(300000);
    grant!.sources[0].tenantId = "changed";
    expect((await invoke())!.sources[0].tenantId).toBe("tenant_library_validation");
  });
  it.each([
    ["Host", "evil.example:12345"], ["Host", "127.0.0.1:8004"],
    ["Host", "127.0.0.1:12345", "Host", "127.0.0.1:12345"],
    ["Host", "127.0.0.1:12345", "Origin", "null"],
    ["Host", "127.0.0.1:12345", "Origin", "http://evil.example"],
    ["Host", "127.0.0.1:12345", "Origin", "http://127.0.0.1:12345", "Origin", "http://127.0.0.1:12345"],
    ["Host", "127.0.0.1:12345", "Forwarded", "for=127.0.0.1"],
    ["Host", "127.0.0.1:12345", "X-Forwarded-Host", "127.0.0.1"],
    ["Host", "127.0.0.1:12345", "X-Forwarded-For", "127.0.0.1"],
    ["Host", "127.0.0.1:12345", "Sec-Fetch-Site", "cross-site"],
    ["Host", "127.0.0.1:12345", "Sec-Fetch-Site", "same-site"],
    ["Host", "127.0.0.1:12345", "Sec-Fetch-Site", "none", "Sec-Fetch-Site", "none"],
    [],
  ])("denies malformed or foreign raw headers %#", async (...headers) => {
    expect(await invoke(request(headers))).toBeNull();
  });
  it.each([{ remoteAddress: "10.0.0.1" }, { localAddress: "10.0.0.1" }, { localPort: 8004 }])(
    "denies a remote or mismatched connection %#", async socket => expect(await invoke(request(undefined, socket))).toBeNull());
  it.each([null, "pipe", { ...address, address: "0.0.0.0" }, { ...address, address: "::" }])(
    "denies a missing or wildcard actual listener %#", async bound => expect(await invoke(request(), bound)).toBeNull());
  it("accepts direct same-origin requests and both IPv6 loopback forms", async () => {
    expect(await invoke(request(["Host", "localhost:12345", "Origin", "http://localhost:12345", "Sec-Fetch-Site", "same-origin"]))).not.toBeNull();
    expect(await invoke(request(["Host", "[::1]:12345"], { localAddress: "::1", remoteAddress: "::1" }),
      { ...address, address: "::1" })).not.toBeNull();
    expect(await invoke(request(undefined, { remoteAddress: "::ffff:127.0.0.1" }))).not.toBeNull();
  });
  it("rejects HEAD, aborted requests and a preview actor on the formal adapter path", async () => {
    expect(await invoke({ ...request(), method: "HEAD" } as express.Request)).toBeNull();
    await expect(resolveValidationReportAccess(createLocalSupervisorReportAccess(() => address), request(),
      { format: "models" })).rejects.toMatchObject({ status: 403 });
    const controller = new AbortController(); controller.abort();
    expect(await createLocalSupervisorReportAccess(() => address)(request(), { format: "pdf" }, controller.signal)).toBeNull();
  });
  it("uses the actual HTTP listener and reports the preview mode only after authorization", async () => {
    const app = express(), server = http.createServer(app), list = vi.fn(() => []);
    registerConversionValidationReports(app, { ledger: { listValidationRecords: list },
      access: createLocalSupervisorReportAccess(() => server.address()), localSupervisorPreview: true });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
      const response = await fetch(base + "/api/conversion/validation-models");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [], total: 0, nextOffset: null, accessMode: "local-supervisor-preview" });
      expect(list).toHaveBeenCalledWith("mw_library_validation");
      list.mockClear();
      for (const headers of [new Headers({ Origin: "http://attacker.invalid" }), new Headers({ "X-Forwarded-For": "127.0.0.1" })]) {
        expect((await fetch(base + "/api/conversion/validation-models", { headers })).status).toBe(403);
      }
      expect((await fetch(base + "/api/conversion/validation-models", { method: "HEAD" })).status).toBe(403);
      expect(list).not.toHaveBeenCalled();
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
