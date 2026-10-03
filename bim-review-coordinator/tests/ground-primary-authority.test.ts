import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { StreamingConversionClient } from "../src/services/streamingConversionClient.js";
import { createSession } from "./helpers/fakeCfdRunWorkflowDeps.js";
import { GroundSelectionLedger } from "../src/services/groundSelectionLedger.js";

const preview = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/fixtures/ground-selection-preview-v1.json", import.meta.url), "utf8"));
let active: CoordinatorApp | null = null, root: string;
afterEach(async () => { vi.restoreAllMocks(); if (active) { await active.dispose(); active = null; } if (root) fs.rmSync(root, { recursive: true, force: true }); });

describe("real app ground primary lease authority", () => {
  it("requires the owning client credential even when the spectator has the same principal", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ground-primary-test-"));
    active = createCoordinatorApp({ sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "outbox.json"), conversionLedgerStorePath: path.join(root, "conversions.json"),
      artifactHealthLedgerStorePath: path.join(root, "health.json"), cfdRunLedgerStorePath: path.join(root, "cfd.json"),
      logRoot: path.join(root, "logs"), conversionPollEnabled: false, internalApiAuthToken: "test-internal-token",
      kitInstanceEndpoints: [{ id: "kit_local_001", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 }] });
    const app = active.app, session = createSession(active.store, "test", { conversionJobId: "stream_conv_test" }), trace = `rev_${session}`;
    active.store.update(session, { kit_instance_bindings: [{ kit_instance_id: "kit_local_001", provider: "local_fixed", tenant_id: "test",
      assigned_artifact_ids: ["artifact_test"], status: "ready", stream_config: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 },
      started_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString(), released_at: null, gpu_profile: { profile: "test", capacity_slot: "test" } }] });
    const claim = async (role: "primary" | "spectator") => {
      const reply = await request(app).post(`/api/review-sessions/${session}/viewer-leases/claim`).set("X-User-Token", "same-principal")
        .send({ viewer_id: `${role}_client`, requested_role: role, client_nonce: `${role}_nonce` });
      expect(reply.status, JSON.stringify({ detail: reply.body.detail, error_code: reply.body.error_code })).toBe(200);
      return reply.body as { lease_id: string; lease_token: string };
    };
    const owner = await claim("primary"), spectator = await claim("spectator");
    const pending = await request(app).post(`/api/review-sessions/${session}/stage-binding`).set("X-User-Token", "same-principal")
      .set("X-Viewer-Lease-Token", owner.lease_token).send({ source_client_id: owner.lease_id, role: "primary",
        artifacts: [{ artifact_id: "artifact_test", role: "primary", load_order: 0 }] });
    expect(pending.status).toBe(200);
    const fields = { stage_binding_authorization_id: pending.body.stage_binding_authorization_id,
      binding_revision_id: pending.body.binding_revision_id, stage_composition: pending.body.stage_composition };
    const authorized = await request(app).post(`/api/internal/review-sessions/${session}/runtime-command-authorizations`)
      .set("X-Internal-Token", "test-internal-token").set("X-Trace-Id", trace).set("X-Viewer-Lease-Token", owner.lease_token)
      .send({ trace_id: trace, source_client_id: owner.lease_id, requested_event_type: "openStageRequest", request_id: "ground_stage_test", command_context: {}, ...fields });
    expect(authorized.body.authorized).toBe(true);
    const confirmed = await request(app).post(`/api/internal/review-sessions/${session}/stage-binding-confirmations`)
      .set("X-Internal-Token", "test-internal-token").set("X-Trace-Id", trace).set("X-Viewer-Lease-Token", owner.lease_token)
      .send({ trace_id: trace, stage_binding_authorization_id: fields.stage_binding_authorization_id,
        binding_revision_id: fields.binding_revision_id, request_id: "ground_stage_test", outcome: "success" });
    expect(confirmed.body.confirmed).toBe(true);
    const upstream = vi.spyOn(StreamingConversionClient.prototype, "groundSurfaces").mockResolvedValue({ status: 200, body: {
      schema: "ground-face-catalog/v1", conversion_job_id: preview.conversion_job_id, model_usdc_sha256: preview.model_usdc_sha256,
      component_path: "/World/Elements/IfcSlab/G_0000000000000000000000", stage_meters_per_unit: 1, faces: preview.faces,
      rejected_faces: {}, rejected_meshes: [], inspected_faces: 1, complete: true, next_cursor: null, actual_ground_verified: false,
    } });
    const endpoint = `/api/review-sessions/${session}/ground-surfaces/catalog`, body = { component_path: "/World/Elements/IfcSlab/G_0000000000000000000000" };
    const call = (client: string, token: string) => request(app).post(endpoint).set("X-User-Token", "same-principal")
      .set("X-Viewer-Source-Client-Id", client).set("X-Viewer-Lease-Token", token).send(body);
    expect((await call(owner.lease_id, owner.lease_token)).status).toBe(200);
    upstream.mockClear();
    const saved = { ...preview, schema: "ground-selection-version/v1" as const, selection_confirmed_by_user: true as const,
      confirmation: { principal: "same-principal", session_id: session, binding_revision_id: "historical_confirmed_revision" } };
    new GroundSelectionLedger(path.join(root, "ground-selection-versions")).save(saved);
    const sampleEndpoint = `/api/review-sessions/${session}/ground-surfaces/selections/${preview.selection_id}/sample-points`;
    const sampleBody = { bounds_m: [0.5, 0.5, 0.5, 0.5], spacing_m: 0.5 };
    const report = { schema: "cfd-ground-sample-points/v1", algorithm: "authored-triangle-vertical/v1", coordinate_frame: "model_world_Z_up_metres",
      selection_id: saved.selection_id, selection_sha256: saved.selection_sha256, conversion_job_id: saved.conversion_job_id, model_usdc_sha256: saved.model_usdc_sha256,
      ...sampleBody, source_faces: saved.faces.map((face: { face_id: string; geometry_sha256: string }) => ({ face_id: face.face_id, geometry_sha256: face.geometry_sha256 })),
      height_above_surface_m: 1.5, display_lift_m: 0, actual_ground_verified: false, fluid_region_verified: false, velocity_sampled: false,
      query_count: 1, generated_count: 1, rejected_by_reason: {}, points: [{ query_index: 0, xy_m: [0.5, 0.5], status: "point_generated", face_id: saved.faces[0].face_id, ground_z_m: 0.63, target_m: [0.5, 0.5, 2.13] }] };
    upstream.mockResolvedValue({ status: 200, body: report });
    const sample = (client: string, token: string) => request(app).post(sampleEndpoint).set("X-User-Token", "same-principal")
      .set("X-Viewer-Source-Client-Id", client).set("X-Viewer-Lease-Token", token).send(sampleBody);
    expect((await sample(owner.lease_id, owner.lease_token)).status).toBe(200); upstream.mockClear();
    for (const [client, token] of [[owner.lease_id, ""], [owner.lease_id, "wrong"], [spectator.lease_id, spectator.lease_token], ["other-client", owner.lease_token]]) {
      expect((await sample(client, token)).status).toBe(409);
    }
    expect(upstream).not.toHaveBeenCalled();
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("test listener missing");
      const largeBody = " ".repeat(8193) + JSON.stringify(sampleBody);
      for (const samplePath of [sampleEndpoint, sampleEndpoint.replace("/api/", "/API/"),
        sampleEndpoint.replace("/ground-surfaces/", "/Ground-Surfaces/").replace("/sample-points", "/Sample-Points/"),
        sampleEndpoint.replace("sample-points", "engineering-assessment"),
        sampleEndpoint.replace("sample-points", "Engineering-Assessment/")]) {
      const status = await new Promise<number>( (resolve, reject) => {
        const outgoing = http.request({ hostname: "127.0.0.1", port: address.port, method: "POST", path: samplePath,
          headers: { "Content-Type": "application/json", "Transfer-Encoding": "chunked", "X-User-Token": "same-principal",
            "X-Viewer-Source-Client-Id": owner.lease_id, "X-Viewer-Lease-Token": owner.lease_token } }, incoming => {
          incoming.resume(); incoming.on("end", () => resolve(incoming.statusCode!));
        });
        outgoing.on("error", reject); outgoing.write(largeBody.slice(0, 4096)); outgoing.end(largeBody.slice(4096));
      });
      expect(status).toBe(413); expect(upstream).not.toHaveBeenCalled();
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    const assessmentEndpoint = sampleEndpoint.replace("sample-points", "engineering-assessment");
    for (const [client, token] of [[owner.lease_id, ""], [owner.lease_id, "wrong"], [spectator.lease_id, spectator.lease_token], ["other-client", owner.lease_token]]) {
      expect((await request(app).post(assessmentEndpoint).set("X-User-Token", "same-principal")
        .set("X-Viewer-Source-Client-Id", client).set("X-Viewer-Lease-Token", token)
        .send({ source_run_id: "cfd_test000001", wind_from_degrees: 0 })).status).toBe(409);
    }
    expect(upstream).not.toHaveBeenCalled();
    for (const raw of ['{"source_run_id":"cfd_test000001","wind_from_degrees":0,"wind_from_degrees":1}',
      '{"source_run_id":"cfd_test000001","wind_from_degrees":1e999}']) {
      expect((await request(app).post(assessmentEndpoint).set("X-User-Token", "same-principal")
        .set("X-Viewer-Source-Client-Id", owner.lease_id).set("X-Viewer-Lease-Token", owner.lease_token)
        .set("Content-Type", "application/json").send(raw)).status).toBe(400);
    }
    for (const [client, token] of [[owner.lease_id, ""], [owner.lease_id, "wrong"], [spectator.lease_id, spectator.lease_token], ["other-client", owner.lease_token]]) {
      expect((await call(client, token)).status).toBe(409);
    }
    expect(upstream).not.toHaveBeenCalled();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    expect((await call(owner.lease_id, owner.lease_token)).status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    expect((await sample(owner.lease_id, owner.lease_token)).status).toBe(409);
    expect(new GroundSelectionLedger(path.join(root, "ground-selection-versions")).get(saved.selection_id)).toEqual(saved);
  });
});
