import { describe, expect, it } from "vitest";
import {
    getQueryParam, getQueryPort, isSpectatorStreamMode, hasDirectStreamEndpointOverride,
    resolveInitialStreamEndpoint, streamEndpointLabel,
} from "./runtimeStreamProfile";

const props = { signalingserver: "prop-signal", signalingport: 3100, mediaserver: "prop-media", mediaport: 3101 };
const defaults = { server: "default-host", signalingPort: 4100, mediaPort: null };
describe("runtimeStreamProfile", () => {
    it("preserves alias order, trimming, exact casing and first-value semantics", () => {
        expect(getQueryParam("?a=++&b=+second+&c=third", "a", "b", "c")).toBe("second");
        expect(getQueryParam("?a=first&b=second", "b", "a")).toBe("second");
        expect(getQueryParam("?A=wrong", "a")).toBeNull();
        expect(getQueryParam("?a=&a=second", "a")).toBeNull();
    });
    it.each([
        ["", null], ["?p=nope", null], ["?p=0", 0], ["?p=-12", -12],
        ["?p=12suffix", 12], ["?p=1.9", 1], ["?p=0x20", 0],
        ["?p=Infinity", null], ["?p=+24+", 24],
    ] as const)("preserves parseInt behavior for %s", (search, expected) => {
        expect(getQueryPort(search, "p")).toBe(expected);
    });
    it.each(["streamRole", "stream_role", "viewerMode", "viewer_mode"])("supports role alias %s", (name) => {
        expect(isSpectatorStreamMode(`?${name}=+SPECTATOR+`)).toBe(true);
        expect(isSpectatorStreamMode(`?${name}=view_only`)).toBe(true);
        expect(isSpectatorStreamMode(`?${name}=primary`)).toBe(false);
    });
    it("preserves role precedence and does not snapshot a prior search", () => {
        expect(isSpectatorStreamMode("?streamRole=primary&viewer_mode=spectator")).toBe(false);
        expect(isSpectatorStreamMode("?streamRole=+&viewer_mode=spectator")).toBe(true);
        expect(isSpectatorStreamMode("")).toBe(false);
    });
    it.each(["signalingPort", "signalingport", "mediaPort", "mediaport"])("override uses presence for %s", (name) => {
        expect(hasDirectStreamEndpointOverride(`?${name}=`)).toBe(true);
        expect(hasDirectStreamEndpointOverride(`?${name}=bad`)).toBe(true);
    });
    it("does not treat a host-only or differently cased key as a port override", () => {
        expect(hasDirectStreamEndpointOverride("?signalingServer=x&MediaPort=12")).toBe(false);
    });
    it("preserves query then props then defaults precedence", () => {
        expect(resolveInitialStreamEndpoint("?kitInstanceId=kit&kit_instance_id=other&signalingServer=query-s&signalingserver=other&signalingPort=12x&signalingport=99&mediaServer=query-m&mediaPort=13", props, defaults))
            .toEqual({ kitInstanceId: "kit", signalingserver: "query-s", signalingport: 12, mediaserver: "query-m", mediaport: 13 });
        expect(resolveInitialStreamEndpoint("", props, defaults))
            .toEqual({ kitInstanceId: null, signalingserver: "prop-signal", signalingport: 3100, mediaserver: "prop-media", mediaport: 3101 });
        expect(resolveInitialStreamEndpoint("", { signalingserver: "", signalingport: 0, mediaserver: "", mediaport: undefined }, defaults))
            .toEqual({ kitInstanceId: null, signalingserver: "default-host", signalingport: 4100, mediaserver: "default-host", mediaport: undefined });
    });
    it("preserves lower-case aliases and skips whitespace-only primary aliases", () => {
        expect(resolveInitialStreamEndpoint("?kitInstanceId=+&kit_instance_id=kit-lower&signalingServer=+&signalingserver=lower-s&signalingPort=+&signalingport=22&mediaserver=lower-m&mediaport=23", props, defaults))
            .toEqual({ kitInstanceId: "kit-lower", signalingserver: "lower-s", signalingport: 22, mediaserver: "lower-m", mediaport: 23 });
    });
    it("keeps signaling OR versus media nullish behavior and negative values", () => {
        const zero = resolveInitialStreamEndpoint("?signalingPort=0&mediaPort=0", props, defaults);
        expect(zero.signalingport).toBe(3100);
        expect(zero.mediaport).toBe(0);
        const negative = resolveInitialStreamEndpoint("?signalingPort=-1&mediaPort=-2", props, defaults);
        expect(negative.signalingport).toBe(-1);
        expect(negative.mediaport).toBe(-2);
        expect(resolveInitialStreamEndpoint("?mediaPort=bad", { ...props, mediaport: undefined }, { ...defaults, mediaPort: 0 }).mediaport).toBe(0);
    });
    it("does not mutate props or defaults", () => {
        const before = JSON.stringify({ props, defaults });
        resolveInitialStreamEndpoint("?mediaPort=0", props, defaults);
        expect(JSON.stringify({ props, defaults })).toBe(before);
    });
    it("keeps endpoint labels including zero/negative media and ignores media server", () => {
        const endpoint = resolveInitialStreamEndpoint("", props, defaults);
        expect(streamEndpointLabel(endpoint)).toBe("prop-signal:3100/3101");
        expect(streamEndpointLabel({ ...endpoint, kitInstanceId: "kit", mediaport: 0 })).toBe("kit prop-signal:3100/0");
        expect(streamEndpointLabel({ ...endpoint, mediaport: undefined })).toBe("prop-signal:3100");
        expect(streamEndpointLabel({ ...endpoint, mediaserver: "not-in-label", mediaport: -1 })).toBe("prop-signal:3100/-1");
    });
});
