import { describe, expect, it, vi } from "vitest";
import {
    a4ServerAuthorityBlockReason,
    buildA4HandoffCommand,
    evaluateA4LocalAuthority,
    normalizeA4HandoffId,
    parseA4HandoffIntent,
    parseA4ViewerLeaseStatus,
    type A4HandoffIntent,
    type A4ServerAuthoritySnapshot,
} from "./a4Handoff";
import { CoordinatorClient, CoordinatorHttpError } from "./coordinatorClient";

const HANDOFF_ID = "a4h_1234567890abcdef";
const SESSION_ID = "review_session_a4_001";
const NOW_MS = Date.parse("2026-07-23T03:00:00.000Z");

function intent(action: "focus" | "highlight" = "focus"): A4HandoffIntent {
    return {
        handoff_id: HANDOFF_ID,
        action,
        expires_at: "2026-07-23T03:01:00.000Z",
        prim_paths: action === "focus" ? ["/World/Door_001"] : ["/World/Door_001", "/World/Wall_002"],
        binding: {
            review_session_id: SESSION_ID,
            model_version_id: "model_v1",
            primary_artifact_id: "artifact_usdc_1",
            active_binding_revision: "binding_rev_1",
        },
    };
}

function serverSnapshot(): A4ServerAuthoritySnapshot {
    return {
        session: {
            session_id: SESSION_ID,
            status: "active",
            project_id: "project_1",
            model_version_id: "model_v1",
            created_by: "principal_1",
            kit_instance: { stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1" },
            artifact_bindings: [],
            kit_instance_bindings: [],
        },
        stream_config: {
            session_id: SESSION_ID,
            trace_id: `rev_${SESSION_ID}`,
            lifecycle_status: "active",
            source: "local_fixed",
            webrtc: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1" },
            model: { status: "ready", artifact_id: "artifact_usdc_1", url: "stage://model.usdc", mapping_url: null },
            artifacts: [],
            artifact_bindings: [],
            kit_instance_bindings: [],
            stage_composition: {
                applied_policy: "coordinator_load_order",
                primary_artifact_id: "artifact_usdc_1",
                secondary_artifact_ids: [],
                primary: {
                    binding_id: "binding_1",
                    artifact_group_id: "group_1",
                    model_version_id: "model_v1",
                    artifact_id: "artifact_usdc_1",
                    artifact_role: "derived",
                    url: "stage://model.usdc",
                    mapping_url: null,
                    load_order: 0,
                    routing_policy: "same_instance",
                    ready_status: "ready",
                },
                secondary_layers: [],
            },
        },
        lease_status: {
            session_id: SESSION_ID,
            auth_scope: "bound",
            primary: { available: false, owned_by_caller: true },
            leases: [{
                lease_id: "viewer_lease_1",
                role: "primary",
                status: "active",
                expires_at: "2026-07-23T03:01:00.000Z",
            }],
            stage_binding: { active_binding_revision: "binding_rev_1" },
        },
    };
}

describe("A4 trusted handoff contract", () => {
    it("只接受 opaque handoff id 與 bounded trusted intent", () => {
        expect(normalizeA4HandoffId(HANDOFF_ID)).toBe(HANDOFF_ID);
        expect(normalizeA4HandoffId("/World/Door_001")).toBeNull();
        expect(parseA4HandoffIntent(intent(), HANDOFF_ID)).toEqual(intent());
        expect(parseA4HandoffIntent({ ...intent(), prim_paths: ["../../secret"] }, HANDOFF_ID)).toBeNull();
        expect(parseA4HandoffIntent({ ...intent(), handoff_id: "a4h_other_other_other" }, HANDOFF_ID)).toBeNull();
        expect(parseA4HandoffIntent({ ...intent("focus"), prim_paths: ["/World/A", "/World/B"] }, HANDOFF_ID)).toBeNull();
    });

    it("strictly parses caller-bound viewer lease status", () => {
        const raw = serverSnapshot().lease_status;
        expect(parseA4ViewerLeaseStatus(raw, SESSION_ID)).toEqual(raw);
        expect(parseA4ViewerLeaseStatus({ ...raw, session_id: "review_session_other" }, SESSION_ID)).toBeNull();
        expect(parseA4ViewerLeaseStatus({ ...raw, leases: [{ ...raw.leases[0], expires_at: "invalid" }] }, SESSION_ID)).toBeNull();
    });

    it("local gate waits for stage/DataChannel but rejects binding drift", () => {
        const base = {
            session_id: SESSION_ID,
            model_version_id: "model_v1",
            primary_artifact_id: "artifact_usdc_1",
            active_binding_revision: "binding_rev_1",
            lifecycle_status: "active",
            stage_status: "matched" as const,
            stage_matches_expected: true,
            datachannel_ready: true,
            spectator: false,
        };
        expect(evaluateA4LocalAuthority(intent(), base, NOW_MS)).toEqual({ kind: "ready" });
        expect(evaluateA4LocalAuthority(intent(), { ...base, datachannel_ready: false }, NOW_MS)).toEqual({
            kind: "wait",
            code: "datachannel_pending",
        });
        expect(evaluateA4LocalAuthority(intent(), { ...base, active_binding_revision: "binding_rev_2" }, NOW_MS)).toEqual({
            kind: "reject",
            code: "binding_revision_changed",
        });
    });

    it("server revalidation requires bound auth, the same active primary lease and revision", () => {
        const base = serverSnapshot();
        expect(a4ServerAuthorityBlockReason(intent(), base, "viewer_lease_1", "stage://model.usdc", NOW_MS)).toBeNull();
        expect(a4ServerAuthorityBlockReason(
            intent(),
            { ...base, lease_status: { ...base.lease_status, auth_scope: "local_dev_lab" } },
            "viewer_lease_1",
            "stage://model.usdc",
            NOW_MS,
        )).toBe("a4_authentic_lease_unavailable");
        expect(a4ServerAuthorityBlockReason(intent(), base, "viewer_lease_other", "stage://model.usdc", NOW_MS)).toBe("primary_lease_changed");
    });

    it("builds exactly one focus/highlight command and links retry without browser evidence", () => {
        expect(buildA4HandoffCommand(intent(), "cmd_first")).toEqual({
            event_type: "focusPrimRequest",
            payload: {
                request_id: "cmd_first",
                prim_path: "/World/Door_001",
            },
        });
        expect(buildA4HandoffCommand(intent("highlight"), "cmd_retry", "cmd_first")).toEqual({
            event_type: "highlightPrimsRequest",
            payload: {
                request_id: "cmd_retry",
                mode: "replace",
                items: [{ prim_path: "/World/Door_001" }, { prim_path: "/World/Wall_002" }],
                focus_first: true,
                retry_of_request_id: "cmd_first",
            },
        });
    });

    it("consume client keeps principal/lease carriers in headers and sends an empty body", async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(intent()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));
        const client = new CoordinatorClient("http://127.0.0.1:8004", fetchImpl as typeof fetch);

        await expect(client.consumeA4Handoff(
            SESSION_ID,
            HANDOFF_ID,
            "principal_carrier_secret",
            "lease_token_secret",
        )).resolves.toEqual(intent());

        const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`http://127.0.0.1:8004/api/review-sessions/${SESSION_ID}/a4-handoffs/${HANDOFF_ID}/consume`);
        expect(url).not.toContain("principal_carrier_secret");
        expect(url).not.toContain("lease_token_secret");
        expect(init.body).toBe("{}");
        expect(init.headers).toEqual(expect.objectContaining({
            "X-User-Token": "principal_carrier_secret",
            "X-Viewer-Lease-Token": "lease_token_secret",
        }));
    });

    it("preserves bounded coordinator error codes and fails closed on malformed success", async () => {
        const unavailableFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            error_code: "a4_authentic_lease_unavailable",
            detail: "must not be rendered verbatim",
        }), { status: 503, headers: { "Content-Type": "application/json" } }));
        const unavailableClient = new CoordinatorClient("http://127.0.0.1:8004", unavailableFetch as typeof fetch);
        await expect(unavailableClient.consumeA4Handoff(SESSION_ID, HANDOFF_ID, "principal", "lease"))
            .rejects.toEqual(expect.objectContaining<Partial<CoordinatorHttpError>>({
                status: 503,
                errorCode: "a4_authentic_lease_unavailable",
            }));

        const malformedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...intent(), prim_paths: ["../../secret"] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        }));
        const malformedClient = new CoordinatorClient("http://127.0.0.1:8004", malformedFetch as typeof fetch);
        await expect(malformedClient.consumeA4Handoff(SESSION_ID, HANDOFF_ID, "principal", "lease"))
            .rejects.toEqual(expect.objectContaining<Partial<CoordinatorHttpError>>({
                status: 502,
                errorCode: "a4_handoff_response_malformed",
            }));
    });
});
