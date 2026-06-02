import type { KitInstanceBinding, ReviewLifecycleStatus } from "../types/review";
import {
    isBlockedLifecycle,
    sameStreamTransportEndpoint,
    selectSpectatorBinding,
    type KitStreamEndpoint,
} from "./windowHelpers";

function makeBinding(
    kitInstanceId: string,
    streamConfig: KitStreamEndpoint,
): KitInstanceBinding {
    return {
        kit_instance_id: kitInstanceId,
        provider: "local_fixed",
        tenant_id: "tenant-1",
        assigned_artifact_ids: [],
        status: "ready",
        stream_config: streamConfig,
        released_at: null,
    };
}

const primaryTransport: KitStreamEndpoint = {
    signalingServer: "127.0.0.1",
    signalingPort: 49100,
    mediaServer: "127.0.0.1",
    mediaPort: 1024,
};

const spectatorTransport: KitStreamEndpoint = {
    signalingServer: "127.0.0.1",
    signalingPort: 49110,
    mediaServer: "127.0.0.1",
    mediaPort: 1025,
};

describe("isBlockedLifecycle", () => {
    const blocked: ReviewLifecycleStatus[] = [
        "blocked_conversion",
        "queued_for_instance",
        "queued_for_conversion",
        "dropped_on_restart",
        "closing",
        "closed",
        "failed",
    ];

    for (const status of blocked) {
        it(`treats ${status} as blocked`, () => {
            expect(isBlockedLifecycle(status)).toBe(true);
        });
    }

    it("treats created / active as not blocked", () => {
        expect(isBlockedLifecycle("created")).toBe(false);
        expect(isBlockedLifecycle("active")).toBe(false);
    });

    it("treats null as not blocked", () => {
        expect(isBlockedLifecycle(null)).toBe(false);
    });
});

describe("sameStreamTransportEndpoint", () => {
    it("matches identical transports", () => {
        expect(sameStreamTransportEndpoint(primaryTransport, { ...primaryTransport })).toBe(true);
    });

    it("differs when signalingPort differs", () => {
        expect(sameStreamTransportEndpoint(primaryTransport, spectatorTransport)).toBe(false);
    });

    it("treats missing mediaPort and explicit null as equal", () => {
        const withNull: KitStreamEndpoint = {
            signalingServer: "127.0.0.1",
            signalingPort: 49100,
            mediaServer: "127.0.0.1",
            mediaPort: null,
        };
        const withoutMediaPort: KitStreamEndpoint = {
            signalingServer: "127.0.0.1",
            signalingPort: 49100,
            mediaServer: "127.0.0.1",
        };
        expect(sameStreamTransportEndpoint(withNull, withoutMediaPort)).toBe(true);
    });

    it("differs when one side has a mediaPort and the other is null", () => {
        const withNull: KitStreamEndpoint = {
            signalingServer: "127.0.0.1",
            signalingPort: 49100,
            mediaServer: "127.0.0.1",
            mediaPort: null,
        };
        expect(sameStreamTransportEndpoint(withNull, primaryTransport)).toBe(false);
    });
});

describe("selectSpectatorBinding", () => {
    const primaryBinding = makeBinding("kit_primary", primaryTransport);
    const spectatorBinding = makeBinding("kit_spectator", spectatorTransport);
    const bindings = [primaryBinding, spectatorBinding];

    it("picks the first binding whose kit_instance_id differs from the primary", () => {
        const selected = selectSpectatorBinding(bindings, "kit_primary", primaryTransport);
        expect(selected).toBe(spectatorBinding);
    });

    it("returns null when every binding equals the primary kit instance id", () => {
        const selected = selectSpectatorBinding([primaryBinding], "kit_primary", primaryTransport);
        expect(selected).toBeNull();
    });

    it("falls back to transport port-diff when primaryKitInstanceId is missing", () => {
        const selected = selectSpectatorBinding(bindings, null, primaryTransport);
        expect(selected).toBe(spectatorBinding);
    });

    it("port-diff fallback returns null when only the primary transport exists", () => {
        const selected = selectSpectatorBinding([primaryBinding], undefined, primaryTransport);
        expect(selected).toBeNull();
    });

    it("falls back to transport port-diff when primaryKitInstanceId is not in bindings", () => {
        // coordinator 資料不一致:primaryKitInstanceId 不在 bindings → 不可用 id 顯式挑
        // (否則可能選到實際 primary),改走 transport port-diff fallback。
        const selected = selectSpectatorBinding(bindings, "kit_nonexistent", primaryTransport);
        expect(selected).toBe(spectatorBinding);
    });
});
