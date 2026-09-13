import http from "node:http";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerRemediationRoutes } from "../src/routes/remediationRoutes.js";
import { createLocalRemediationAccess, resolveRemediationAccess, type RemediationAccess } from "../src/services/remediationAccess.js";
import { loadConfig } from "../src/config.js";

const key = "synthetic-test-only-key-32-bytes-long";
const tuple = {
  issue_id: "issue1", tenant_id: "tenant_library_validation", project_id: "project_library_validation",
  ifc_guid: "guid1", rule_code: "FIRE",
  original: { model_version_id: "24e598ab-be3d-4dbb-a1aa-60b0ba610618", run_id: "run1",
    source_sha256: "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce" },
  revised: { model_version_id: "v2", run_id: "run2", source_sha256: "b".repeat(64) },
};
const grant = () => ({ principal_ref: "operator1", actor_kind: "external_authority" as const,
  authorization_ref: "trusted-authority", expires_at_ms: Date.now() + 30000,
  cases: [{ ...tuple, correspondence_ref: "stable-pair" }] });
const command = { expected_revision: 0, revised_model_version_id: "v2", revised_run_id: "run2", revised_result_id: "result2", idempotency_key: "key1" };
function appFor(access?: RemediationAccess) {
  const app = express(); app.use(express.json());
  registerRemediationRoutes(app, { access, internalKey: key }); return app;
}
const confirmPath = "/api/governance/issues/issue1/confirm-remediation";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("remediation proxy trust boundary", () => {
  it("denies absent authority regardless of preview, intake token or browser role", async () => {
    vi.stubEnv("VALIDATION_REPORT_SUPERVISOR_PREVIEW", "true");
    const upstream = vi.spyOn(globalThis, "fetch");
    const app = appFor();
    for (const actor of ["supervisor", "local_supervisor_preview", "intake-client"]) {
      const res = await request(app).post(confirmPath).set("X-A1-Intent", "confirm").set("X-Role", actor)
        .set("Authorization", "Bearer synthetic-machine-token").send(command);
      expect(res.status).toBe(503);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it("signs only server authority and the exact forwarded operation/body", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ issue: { id: "issue1" } })));
    const access = vi.fn(async () => grant());
    const res = await request(appFor(access)).post(confirmPath).set("X-A1-Intent", "confirm")
      .set("X-A1-Remediation-Grant", "browser-forgery").send(command);
    expect(res.status).toBe(200); expect(access).toHaveBeenCalledOnce();
    const options = upstream.mock.calls[0][1]!;
    const signed = (options.headers as Record<string, string>)["X-A1-Remediation-Grant"];
    const [encoded, signature] = signed.split(".");
    expect(signature).toBe(createHmac("sha256", key).update(encoded).digest("hex"));
    const claims = JSON.parse(Buffer.from(encoded, "base64url").toString());
    expect(claims).toMatchObject({ version: 1, operation: "confirm", issue_id: "issue1", principal_ref: "operator1" });
    expect(claims.body_sha256).toBe(createHash("sha256").update(options.body as string).digest("hex"));
    expect(claims.expires_at_ms).toBeLessThanOrEqual(Date.now() + 20000);
    expect(JSON.stringify(options)).not.toContain("browser-forgery");
    expect(res.body.access.actor_kind).toBe("external_authority");
  });
  it.each([null, { ...grant(), actor_kind: "local_supervisor_preview" }, { ...grant(), actor_kind: "local_validation" },
    { ...grant(), expires_at_ms: 1 }, { ...grant(), cases: [{ ...tuple, correspondence_ref: "pair", issue_id: "other" }] }])(
    "denies malformed, stale or wrong resource authority %#", async value => {
      const upstream = vi.spyOn(globalThis, "fetch");
      const res = await request(appFor(async () => value as never)).post(confirmPath).set("X-A1-Intent", "confirm").send(command);
      expect(res.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
    });
  it("rejects browser PASS fields and missing intent before upstream", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const app = appFor(async () => grant());
    expect((await request(app).post(confirmPath).send(command)).status).toBe(403);
    expect((await request(app).post(confirmPath).set("X-A1-Intent", "confirm").send({ ...command, PASS: true })).status).toBe(422);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("bounds an unresponsive authority and aborts the adapter", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const promise = resolveRemediationAccess((_r, _t, s) => { signal = s; return new Promise(() => {}); },
      {} as express.Request, { issueId: "issue1", operation: "confirm" });
    const check = expect(promise).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(5001); await check; expect(signal!.aborted).toBe(true);
  });
  it("sanitizes upstream errors and never follows redirects", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: "C:\\private\\secret" }), { status: 500 }));
    const res = await request(appFor(async () => grant())).post(confirmPath).set("X-A1-Intent", "confirm").send(command);
    expect(res.status).toBe(502); expect(res.text).not.toContain("private");
    expect(upstream.mock.calls[0][1]!.redirect).toBe("error");
  });
  it("keeps a lost upstream mutation outcome uncertain instead of claiming no write", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network interrupted"));
    const res = await request(appFor(async () => grant())).post(confirmPath).set("X-A1-Intent", "confirm").send(command);
    expect(res.status).toBe(503); expect(res.body.detail.code).toBe("remediation_outcome_unknown");
  });
});

describe("separate local library validation", () => {
  let directory: string, policyPath: string;
  const bound: AddressInfo = { address: "127.0.0.1", family: "IPv4", port: 12345 };
  beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "a1-remediation-test-")); policyPath = path.join(directory, "policy.json"); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const policy = () => ({ version: 1, expires_at_ms: Date.now() + 60000, cases: [{ ...tuple, operations: ["confirm", "history", "reopen"] }] });
  function req(origin = "http://127.0.0.1:5180", socket = {}) {
    const headers = ["Host", "127.0.0.1:12345", "X-A1-Intent", "confirm", ...(origin ? ["Origin", origin] : [])];
    return { method: "POST", rawHeaders: headers,
      get: (name: string) => name === "x-a1-intent" ? "confirm" : undefined,
      socket: { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", localPort: 12345, ...socket },
    } as unknown as express.Request;
  }
  const target = { issueId: "issue1", operation: "confirm" as const };
  it("is default off, strict and rejects production/wildcard/missing key or registry", () => {
    vi.stubEnv("A1_REMEDIATION_LOCAL_VALIDATION", undefined);
    expect(loadConfig().remediationLocalValidation).toBe(false);
    vi.stubEnv("A1_REMEDIATION_LOCAL_VALIDATION", "1"); expect(() => loadConfig()).toThrow("true or false");
    vi.stubEnv("A1_REMEDIATION_LOCAL_VALIDATION", "true"); expect(() => loadConfig()).toThrow("Local remediation");
    const cfg = { host: "127.0.0.1", remediationLocalPolicyPath: policyPath, remediationInternalKey: key, viewerPublicBaseUrl: "http://127.0.0.1:5180" };
    expect(loadConfig(cfg).remediationLocalValidation).toBe(true);
    expect(() => loadConfig({ ...cfg, host: "0.0.0.0" })).toThrow("Local remediation");
    vi.stubEnv("NODE_ENV", "production"); expect(() => loadConfig(cfg)).toThrow("Local remediation");
  });
  it("binds exact sources with stable correspondence, re-reads revocation and separates operations", async () => {
    await writeFile(policyPath, JSON.stringify(policy()));
    const access = createLocalRemediationAccess(() => bound, policyPath, "http://127.0.0.1:5180");
    const first = await access(req(), target, new AbortController().signal);
    expect(first?.actor_kind).toBe("local_validation"); expect(first?.cases[0]).toMatchObject(tuple);
    await writeFile(policyPath, JSON.stringify({ ...policy(), cases: [{ ...tuple, operations: ["confirm"] }] }));
    expect((await access(req(), target, new AbortController().signal))?.cases[0].correspondence_ref).toBe(first?.cases[0].correspondence_ref);
    expect(await access({ ...req(), method: "GET" } as express.Request, { ...target, operation: "history" }, new AbortController().signal)).toBeNull();
    await writeFile(policyPath, JSON.stringify({ ...policy(), expires_at_ms: 1 }));
    expect(await access(req(), target, new AbortController().signal)).toBeNull();
  });
  it("rejects missing/cross Origin, remote socket, forwarded headers and other fixture scope", async () => {
    await writeFile(policyPath, JSON.stringify(policy()));
    const access = createLocalRemediationAccess(() => bound, policyPath, "http://127.0.0.1:5180");
    const forwarded = req(); forwarded.rawHeaders.push("X-Forwarded-For", "127.0.0.1");
    for (const value of [req(""), req("http://attacker.invalid"), req(undefined, { remoteAddress: "10.0.0.1" }), forwarded]) {
      expect(await access(value, target, new AbortController().signal)).toBeNull();
    }
    await writeFile(policyPath, JSON.stringify({ ...policy(), cases: [{ ...tuple, tenant_id: "other", operations: ["confirm"] }] }));
    expect(await access(req(), target, new AbortController().signal)).toBeNull();
  });
  it("checks the actual listener on a real HTTP connection", async () => {
    await writeFile(policyPath, JSON.stringify(policy()));
    const app = express(), server = http.createServer(app);
    const access = createLocalRemediationAccess(() => server.address(), policyPath, "http://127.0.0.1:5180");
    app.post("/test", async (request, response) => response.status(await access(request, target, new AbortController().signal) ? 200 : 403).end());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      expect((await fetch(base + "/test", { method: "POST", headers: { Origin: "http://127.0.0.1:5180", "X-A1-Intent": "confirm" } })).status).toBe(200);
      expect((await fetch(base + "/test", { method: "POST", headers: { "X-A1-Intent": "confirm" } })).status).toBe(403);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
