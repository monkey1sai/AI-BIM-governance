import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { StreamingConversionClient } from "../src/services/streamingConversionClient.js";
import { createSession } from "./helpers/fakeCfdRunWorkflowDeps.js";

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
    for (const [client, token] of [[owner.lease_id, ""], [owner.lease_id, "wrong"], [spectator.lease_id, spectator.lease_token], ["other-client", owner.lease_token]]) {
      expect((await call(client, token)).status).toBe(409);
    }
    expect(upstream).not.toHaveBeenCalled();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    expect((await call(owner.lease_id, owner.lease_token)).status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "ground-selection-versions"))).toBe(false);
  });
});
