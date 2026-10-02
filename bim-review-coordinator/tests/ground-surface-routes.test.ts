import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGroundSurfaceRoutes, type GroundAccess } from "../src/routes/groundSurfaceRoutes.js";
import { SessionStore } from "../src/services/sessionStore.js";
import { GroundSelectionLedger } from "../src/services/groundSelectionLedger.js";
import { createSession, modelBinding } from "./helpers/fakeCfdRunWorkflowDeps.js";

const preview = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/fixtures/ground-selection-preview-v1.json", import.meta.url), "utf8"));
let root: string, store: SessionStore, access: GroundAccess | null, app: express.Express, base: string;
let upstream: ReturnType<typeof vi.fn>;
let ledger: GroundSelectionLedger;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ground-route-test-")); store = new SessionStore(root);
  const session = createSession(store, "test", { conversionJobId: "stream_conv_test" });
  const primary = modelBinding("test", "stream_conv_test");
  access = { principal: "reviewer", conversionJobId: "stream_conv_test", primary, binding: {
    bindingRevisionId: "binding_rev_test", principal: "reviewer", leaseId: "lease_test", sourceClientId: "client_test",
    composition: { primary: { artifactId: primary.artifact_id, role: "primary", loadOrder: 0, usdcUrl: primary.url! },
      secondaryLayers: [{ artifactId: preview.artifact_id, role: "secondary", loadOrder: 1, usdcUrl: "http://127.0.0.1:49101/ground-artifacts/preview.usda" }] },
  } };
  app = express(); app.use(express.json()); upstream = vi.fn(async () => ({ status: 200, body: preview }));
  ledger = new GroundSelectionLedger(path.join(root, "versions"));
  registerGroundSurfaceRoutes(app, { store, ledger, access: () => access, upstream,
    rejectIfUnauthorized: (req, res) => { if (req.header("x-denied")) { res.status(403).json({ detail: "denied" }); return true; } return false; },
    publicArtifactsUrl: "http://192.168.20.181:49101/artifacts" });
  base = `/api/review-sessions/${session}/ground-surfaces`;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const draft = () => ({ region_name: preview.region_name, model_usdc_sha256: preview.model_usdc_sha256,
  faces: preview.faces.map((face: Record<string, unknown>) => ({ ifc_guid: face.ifc_guid, mesh_prim_path: face.mesh_prim_path,
    polygon_face_index: face.polygon_face_index, face_id: face.face_id })) });

describe("ground selection authorization and exact binding", () => {
  it("registers only a trusted fixed preview URL, without changing the primary", async () => {
    const reply = await request(app).post(`${base}/previews`).send(draft());
    expect(reply.status).toBe(200); expect(reply.body.primary_artifact_id).toBe("artifact_test");
    const bindings = store.get(base.split("/")[3])!.artifact_bindings;
    expect(bindings[0].artifact_id).toBe("artifact_test");
    expect(bindings[1].url).toBe(`http://192.168.20.181:49101/ground-artifacts/${preview.selection_id}/preview.usda`);
  });
  it("rejects an unauthorized caller before reading the source", async () => {
    expect((await request(app).post(`${base}/previews`).set("x-denied", "1").send(draft())).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    access = null;
    expect((await request(app).post(`${base}/previews`).send(draft())).status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(["revision", "missing-layer"])("refuses saved success without exact Kit evidence: %s", async mode => {
    if (mode === "revision") access!.binding.bindingRevisionId = "other";
    else access!.binding.composition.secondaryLayers = [];
    const reply = await request(app).post(`${base}/selections/${preview.selection_id}`).send({ binding_revision_id: "binding_rev_test" });
    expect(reply.status).toBe(409); expect(upstream).not.toHaveBeenCalled();
  });
  it("does not bind an old preview after an await changes the source or lease", async () => {
    upstream.mockImplementation(async () => { access = { ...access!, conversionJobId: "stream_conv_other" }; return { status: 200, body: preview }; });
    expect((await request(app).post(`${base}/previews`).send(draft())).status).toBe(409);
    expect(store.get(base.split("/")[3])!.artifact_bindings).toHaveLength(1);
  });
  it("passes only server-owned principal and observed revision to confirmation", async () => {
    const version = { ...preview, schema: "ground-selection-version/v1", selection_confirmed_by_user: true,
      confirmation: { principal: "reviewer", session_id: base.split("/")[3], binding_revision_id: "binding_rev_test" } };
    upstream.mockResolvedValue({ status: 200, body: preview });
    const reply = await request(app).post(`${base}/selections/${preview.selection_id}`).send({ binding_revision_id: "binding_rev_test" });
    expect(reply.status).toBe(200);
    expect(upstream).toHaveBeenCalledWith("stream_conv_test", `selections/${preview.selection_id}`, undefined);
    expect(ledger.get(preview.selection_id)?.confirmation).toEqual(version.confirmation);
    expect(reply.body.actual_ground_verified).toBe(false);
  });
  it.each(["lease", "source", "revision"])("does not persist a confirmation when await changes %s", async mode => {
    upstream.mockImplementation(async () => {
      if (mode === "lease") access = { ...access!, binding: { ...access!.binding, leaseId: "other" } };
      if (mode === "source") access = { ...access!, conversionJobId: "stream_conv_other" };
      if (mode === "revision") access = { ...access!, binding: { ...access!.binding, bindingRevisionId: "other" } };
      return { status: 200, body: preview };
    });
    const reply = await request(app).post(`${base}/selections/${preview.selection_id}`).send({ binding_revision_id: "binding_rev_test" });
    expect(reply.status).toBe(409); expect(ledger.get(preview.selection_id)).toBeNull();
    expect(fs.existsSync(path.join(root, "versions"))).toBe(false);
  });
  it("rejects URL injection, unknown fields and upstream provenance mismatches", async () => {
    expect((await request(app).post(`${base}/previews`).send({ ...draft(), url: "https://example.com/evil.usd" })).status).toBe(400);
    upstream.mockResolvedValue({ status: 200, body: { ...preview, conversion_job_id: "stream_conv_other" } });
    expect((await request(app).post(`${base}/previews`).send(draft())).status).toBe(502);
    expect(store.get(base.split("/")[3])!.artifact_bindings).toHaveLength(1);
  });
});
