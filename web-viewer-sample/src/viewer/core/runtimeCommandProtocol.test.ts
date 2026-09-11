import { describe, expect, it } from "vitest";
import { getPayloadString, isRuntimeMutator, parseRuntimeCommandRejection, type RuntimeRejectionReason } from "./runtimeCommandProtocol";

const events = ["openStageRequest", "loadArtifactGroupRequest", "composeStageRequest", "highlightPrimsRequest", "focusPrimRequest", "clearHighlightRequest", "selectPrimsRequest", "makePrimsPickable", "resetStage"] as const;
const reasons: readonly RuntimeRejectionReason[] = ["spectator_readonly", "lease_invalid", "session_lifecycle_blocked", "unauthorized_source_client", "unsupported_command", "invalid_payload"];
const valid = { rejected_event_type: "focusPrimRequest", reason: "lease_invalid", request_id: "req_runtime_001", retryable: true, runtime_state: "unchanged", detail_code: "authority_unavailable" };

describe("runtime command protocol", () => {
    it("does not enable deferred clip-plane mutation or rejection", () => {
        expect(isRuntimeMutator("clipPlaneRequest")).toBe(false);
        expect(parseRuntimeCommandRejection({ ...valid, rejected_event_type: "clipPlaneRequest" }))
            .toBeNull();
    });
    it.each(events)("preserves mutating wire event %s", event => expect(isRuntimeMutator(event)).toBe(true));
    it.each(["", "loadingStateQuery", "commandRejected", "focusPrimRequest<script>"])("rejects non-mutator %s", event => expect(isRuntimeMutator(event)).toBe(false));
    it("preserves the string accessor without coercion", () => {
        expect(getPayloadString({ value: "exact" }, "value")).toBe("exact");
        for (const value of [42, null, undefined, false, [], {}]) expect(getPayloadString({ value }, "value")).toBe("");
        expect(getPayloadString({}, "value")).toBe("");
    });
    it.each(reasons)("accepts exact reason %s", reason => {
        expect(parseRuntimeCommandRejection({ ...valid, reason })).toEqual({ ...valid, reason });
    });
    it("accepts rejection_id and omits untrusted fields", () => {
        const expected = { rejected_event_type: "loadArtifactGroupRequest", reason: "session_lifecycle_blocked", rejection_id: "rej_runtime_001", retryable: false, runtime_state: "changed_unconfirmed" };
        expect(parseRuntimeCommandRejection({ ...expected, binding_revision_id: "untrusted_revision", detail: "must_not_copy", viewer_lease_token: "test-only-placeholder" })).toEqual(expected);
    });
    it("preserves inclusive machine-field bounds", () => {
        expect(parseRuntimeCommandRejection({ ...valid, request_id: "r".repeat(128), detail_code: "d".repeat(64) })).not.toBeNull();
        expect(parseRuntimeCommandRejection({ ...valid, request_id: undefined, rejection_id: "r".repeat(128) })).not.toBeNull();
    });
    it("does not mutate its input", () => {
        const input = Object.freeze({ ...valid });
        expect(parseRuntimeCommandRejection(input)).toEqual(valid);
        expect(input).toEqual(valid);
    });
    const invalid: Array<[string, Record<string, unknown>]> = [
        ["unknown reason", { ...valid, reason: "unknown" }],
        ["non-string reason", { ...valid, reason: 42 }],
        ["unknown state", { ...valid, runtime_state: "changed" }],
        ["non-mutator", { ...valid, rejected_event_type: "loadingStateQuery" }],
        ["unsafe command", { ...valid, rejected_event_type: "focusPrimRequest<script>" }],
        ["non-boolean retryable", { ...valid, retryable: "true" }],
        ["both ids", { ...valid, rejection_id: "rej_runtime_001" }],
        ["neither id", { ...valid, request_id: undefined }],
        ["empty id", { ...valid, request_id: "" }],
        ["unsafe id", { ...valid, request_id: "req runtime" }],
        ["long id", { ...valid, request_id: "r".repeat(129) }],
        ["unsafe rejection id", { ...valid, request_id: undefined, rejection_id: "rej runtime" }],
        ["long rejection id", { ...valid, request_id: undefined, rejection_id: "r".repeat(129) }],
        ["unsafe detail", { ...valid, detail_code: "authority unavailable" }],
        ["long detail", { ...valid, detail_code: "d".repeat(65) }],
    ];
    it.each(invalid)("fails closed: %s", (_name, payload) => expect(parseRuntimeCommandRejection(payload)).toBeNull());
});
