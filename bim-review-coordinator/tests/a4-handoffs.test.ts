/** S2: coordinator-owned, session-scoped transient A4 handoff create/consume. */
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  registerA4HandoffRoutes,
  type A4HandoffRouteDeps,
  type A4SearchSessionContext,
  type A4SearchSessionResolution,
} from "../src/routes/a4HandoffRoutes.js";
import { A4HandoffStore } from "../src/services/a4HandoffStore.js";

const INTERNAL_TOKEN = "test-a4-internal-context-token";
const SESSION_ID = "review_session_deadbeef12";
const NOW_MS = Date.parse("2026-07-21T03:00:00.000Z");
const activeServers: http.Server[] = [];
const originalGovernanceBase = process.env.GOVERNANCE_API_BASE;

function proof(id: string): string {
  return `a4p.a4_test_kid.${id}.${"a".repeat(64)}`;
}

function trustedContext(overrides: Partial<A4SearchSessionContext> = {}): A4SearchSessionContext {
  return {
    trace_id: `rev_${SESSION_ID}`,
    ifc_source_path: "C:/server-only/a4.ifc",
    model_version_id: "a4_fixture_v1",
    review_session_id: SESSION_ID,
    principal_ref: "principal_a",
    auth_scope: "production",
    primary_lease_capability: "verified",
    primary_artifact_id: "artifact_a4",
    mapping_provenance: "server_resolved",
    active_binding_revision: "binding_a4_1",
    ...overrides,
  };
}

function okResolution(context: A4SearchSessionContext): A4SearchSessionResolution {
  return { ok: true, context };
}

function makeApp(deps: A4HandoffRouteDeps) {
  const app = express();
  app.use(express.json());
  registerA4HandoffRoutes(app, deps);
  return app;
}

async function startGovernanceStub(options: {
  nowMs?: number;
  proofExpiryMs?: number;
  invalidProof?: string;
  stall?: boolean;
  oversizedResponseBytes?: number;
} = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown>; token?: string }> = [];
  const nowMs = options.nowMs ?? NOW_MS;
  const proofExpiryMs = options.proofExpiryMs ?? nowMs + 30_000;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
      calls.push({
        url: `${req.method} ${req.url}`,
        body,
        token: typeof req.headers["x-a4-internal-token"] === "string" ? req.headers["x-a4-internal-token"] : undefined,
      });
      if (req.method !== "POST" || req.url !== "/api/internal/a4/handoffs/verify") {
        res.writeHead(404).end();
        return;
      }
      if (options.stall) return;
      if (options.oversizedResponseBytes) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("x".repeat(options.oversizedResponseBytes));
        res.end();
        return;
      }
      const evidenceProofs = Array.isArray(body.evidence_proofs) ? body.evidence_proofs as string[] : [];
      const failedIndex = options.invalidProof ? evidenceProofs.indexOf(options.invalidProof) : -1;
      if (failedIndex >= 0) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          accepted: false,
          action: body.action,
          code: "proof_invalid",
          failed_index: failedIndex,
          min_proof_expires_at: null,
          rows: [],
        }));
        return;
      }
      const expiresAt = new Date(proofExpiryMs).toISOString();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        accepted: true,
        action: body.action,
        code: null,
        failed_index: null,
        min_proof_expires_at: expiresAt,
        rows: evidenceProofs.map((_item, index) => ({
          proof_id: `proof_id_${index}`,
          ifc_guid: `GUID-${index + 1}`,
          prim_path: `/World/Doors/Door_${String(index + 1).padStart(3, "0")}`,
          proof_expires_at: expiresAt,
        })),
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  activeServers.push(server);
  const port = (server.address() as AddressInfo).port;
  process.env.GOVERNANCE_API_BASE = `http://127.0.0.1:${port}`;
  return { calls };
}

afterEach(async () => {
  while (activeServers.length) {
    const server = activeServers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
  if (originalGovernanceBase === undefined) delete process.env.GOVERNANCE_API_BASE;
  else process.env.GOVERNANCE_API_BASE = originalGovernanceBase;
});

describe("A4 coordinator handoffs", () => {
  it("creates a URL-safe focus handoff and consumes trusted prims exactly once", async () => {
    const gov = await startGovernanceStub();
    let nowMs = NOW_MS;
    const store = new A4HandoffStore({ ttlMs: 60_000, now: () => nowMs });
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      handoffStore: store,
      resolveA4SearchSessionContext: () => okResolution(trustedContext()),
    });
    const evidenceProof = proof("proof_id_focus_0001");

    const created = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .set("Authorization", "Bearer principal-a")
      .send({ action: "focus", evidence_proofs: [evidenceProof] });

    expect(created.status).toBe(201);
    expect(created.body.handoff_id).toMatch(/^a4h_[A-Za-z0-9_-]{16,96}$/);
    expect(created.body.open_url).toBe(
      `/ui/open?session=${SESSION_ID}&trace_id=${encodeURIComponent(`rev_${SESSION_ID}`)}&a4_handoff=${encodeURIComponent(created.body.handoff_id)}`,
    );
    expect(created.body.viewer_url).toBe(created.body.open_url);
    expect(created.body.expires_at).toBe("2026-07-21T03:00:30.000Z");
    expect(JSON.stringify(created.body)).not.toContain(evidenceProof);
    expect(JSON.stringify(created.body)).not.toContain("/World/");
    expect(gov.calls).toEqual([{
      url: "POST /api/internal/a4/handoffs/verify",
      token: INTERNAL_TOKEN,
      body: {
        action: "focus",
        evidence_proofs: [evidenceProof],
        binding: {
          session_id: SESSION_ID,
          principal: "principal_a",
          model_version_id: "a4_fixture_v1",
          model_artifact: "artifact_a4",
          active_binding_revision: "binding_a4_1",
        },
      },
    }]);

    const consumed = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .set("Authorization", "Bearer principal-a")
      .send({});
    expect(consumed.status).toBe(200);
    expect(consumed.body).toMatchObject({
      handoff_id: created.body.handoff_id,
      action: "focus",
      prim_paths: ["/World/Doors/Door_001"],
      binding: {
        review_session_id: SESSION_ID,
        model_version_id: "a4_fixture_v1",
        primary_artifact_id: "artifact_a4",
        active_binding_revision: "binding_a4_1",
      },
    });
    expect(JSON.stringify(consumed.body)).not.toContain(evidenceProof);

    nowMs += 1;
    const replay = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .set("Authorization", "Bearer principal-a")
      .send({});
    expect(replay.status).toBe(404);
    expect(replay.body.error_code).toBe("a4_handoff_unavailable");
  });

  it("fails closed before governance when the server-owned session trace is not canonical", async () => {
    const gov = await startGovernanceStub();
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      resolveA4SearchSessionContext: () => okResolution(trustedContext({
        trace_id: "rev_review_session_other",
      })),
    });

    const response = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_bad_trace_01")] });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error_code: "a4_handoff_trace_unavailable",
      detail: "A4 handoff trace authority is unavailable.",
    });
    expect(gov.calls).toHaveLength(0);
  });

  it("atomically rejects an invalid selected set without creating a handoff", async () => {
    const invalid = proof("proof_id_invalid_0002");
    const gov = await startGovernanceStub({ invalidProof: invalid });
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      handoffStore: new A4HandoffStore({ now: () => NOW_MS }),
      resolveA4SearchSessionContext: () => okResolution(trustedContext()),
    });

    const response = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "highlight", evidence_proofs: [proof("proof_id_valid_0001"), invalid] });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error_code: "proof_invalid", failed_index: 1 });
    expect(response.body).not.toHaveProperty("handoff_id");
    expect(response.body).not.toHaveProperty("rows");
    expect(gov.calls).toHaveLength(1);
  });

  it("fails cross-principal closed and invalidates same-principal stale binding", async () => {
    await startGovernanceStub();
    let currentPrincipal = "principal_a";
    let currentRevision = "binding_a4_1";
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      handoffStore: new A4HandoffStore({ now: () => NOW_MS }),
      resolveA4SearchSessionContext: (sessionId) => okResolution(trustedContext({
        review_session_id: sessionId,
        principal_ref: currentPrincipal,
        active_binding_revision: currentRevision,
      })),
    });
    const created = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_cross_0001")] });
    expect(created.status).toBe(201);

    const crossSession = await request(app)
      .post(`/api/review-sessions/review_session_other0001/a4-handoffs/${created.body.handoff_id}/consume`)
      .send({});
    expect(crossSession.status).toBe(404);
    expect(crossSession.body.error_code).toBe("a4_handoff_unavailable");

    currentPrincipal = "principal_b";
    const stolen = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .send({});
    expect(stolen.status).toBe(404);
    expect(stolen.body.error_code).toBe("a4_handoff_unavailable");

    currentPrincipal = "principal_a";
    currentRevision = "binding_a4_2";
    const stale = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .send({});
    expect(stale.status).toBe(409);
    expect(stale.body.error_code).toBe("a4_handoff_binding_mismatch");

    currentRevision = "binding_a4_1";
    const invalidated = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .send({});
    expect(invalidated.status).toBe(404);
  });

  it("uses the earliest proof expiry and rejects an expired handoff", async () => {
    let nowMs = NOW_MS;
    await startGovernanceStub({ nowMs, proofExpiryMs: nowMs + 5_000 });
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      handoffStore: new A4HandoffStore({ ttlMs: 60_000, now: () => nowMs }),
      resolveA4SearchSessionContext: () => okResolution(trustedContext()),
    });
    const created = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_expiry_0001")] });
    expect(created.status).toBe(201);
    expect(created.body.expires_at).toBe("2026-07-21T03:00:05.000Z");

    nowMs += 5_000;
    const expired = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs/${created.body.handoff_id}/consume`)
      .send({});
    expect(expired.status).toBe(410);
    expect(expired.body.error_code).toBe("a4_handoff_expired");
  });

  it("re-resolves authority after proof verification and stores nothing if binding changed", async () => {
    const gov = await startGovernanceStub();
    let resolutionCount = 0;
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      handoffStore: new A4HandoffStore({ now: () => NOW_MS }),
      resolveA4SearchSessionContext: () => {
        resolutionCount += 1;
        return okResolution(trustedContext({
          active_binding_revision: resolutionCount === 1 ? "binding_a4_1" : "binding_a4_2",
        }));
      },
    });

    const response = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_race_00001")] });

    expect(response.status).toBe(409);
    expect(response.body.error_code).toBe("a4_handoff_binding_changed");
    expect(response.body).not.toHaveProperty("handoff_id");
    expect(resolutionCount).toBe(2);
    expect(gov.calls).toHaveLength(1);
  });

  it("rejects browser authority/prim fields and ineligible lab authority before upstream", async () => {
    const gov = await startGovernanceStub();
    let context = trustedContext();
    const app = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      resolveA4SearchSessionContext: () => okResolution(context),
    });
    const injected = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({
        action: "focus",
        evidence_proofs: [proof("proof_id_inject_0001")],
        user_id: "forged",
        prim_paths: ["/World/Forged"],
      });
    expect(injected.status).toBe(400);
    expect(injected.body.error_code).toBe("invalid_a4_handoff_controls");

    context = trustedContext({ auth_scope: "lab", primary_lease_capability: "lab_unverified" });
    const lab = await request(app)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_lab_000001")] });
    expect(lab.status).toBe(409);
    expect(lab.body.error_code).toBe("a4_handoff_not_eligible");
    expect(gov.calls).toHaveLength(0);
  });

  it("bounds stalled and oversized governance authority responses", async () => {
    await startGovernanceStub({ stall: true });
    const stalledApp = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      governanceTimeoutMs: 50,
      resolveA4SearchSessionContext: () => okResolution(trustedContext()),
    });
    const startedAt = Date.now();
    const stalled = await request(stalledApp)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_stalled_001")] });
    expect(stalled.status).toBe(502);
    expect(stalled.body.error_code).toBe("a4_handoff_authority_unavailable");
    expect(Date.now() - startedAt).toBeLessThan(1_000);

    await startGovernanceStub({ oversizedResponseBytes: 64 * 1024 + 1 });
    const oversizedApp = makeApp({
      isSafeSessionId: () => true,
      a4InternalContextToken: INTERNAL_TOKEN,
      resolveA4SearchSessionContext: () => okResolution(trustedContext()),
    });
    const oversized = await request(oversizedApp)
      .post(`/api/review-sessions/${SESSION_ID}/a4-handoffs`)
      .send({ action: "focus", evidence_proofs: [proof("proof_id_oversized_01")] });
    expect(oversized.status).toBe(502);
    expect(oversized.body.error_code).toBe("a4_handoff_authority_unavailable");
  });
});
