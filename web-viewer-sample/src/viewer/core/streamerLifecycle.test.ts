import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamer, profile } = vi.hoisted(() => ({
    streamer: { streamStatus: 1, terminate: vi.fn<() => unknown>() },
    profile: { source: "local" },
}));
vi.mock("../../harness/streamer", () => ({ getStreamer: () => streamer }));
vi.mock("../../harness/harnessConfig", () => ({ harnessEnabled: () => false }));
vi.mock("../../../stream.config.json", () => ({ default: profile }));

beforeEach(() => {
    vi.resetModules();
    profile.source = "local";
    streamer.streamStatus = 1;
    streamer.terminate.mockReset().mockResolvedValue({ action: "terminate", status: "success" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("streamerLifecycle", () => {
    it("shares one pending teardown with terminate and wait callers", async () => {
        let complete!: (result: unknown) => void;
        streamer.terminate.mockReturnValue(new Promise(resolve => { complete = resolve; }));
        const { terminateStreamer, waitForStreamerTeardown } = await import("./streamerLifecycle");
        const first = terminateStreamer();
        expect(terminateStreamer()).toBe(first);
        expect(waitForStreamerTeardown()).toBe(first);
        expect(streamer.terminate).toHaveBeenCalledTimes(1);
        complete({ action: "terminate", status: "success" });
        expect(await first).toBe(true);
        expect(await waitForStreamerTeardown()).toBe(false);
    });
    it("does not terminate an already physically idle singleton", async () => {
        streamer.streamStatus = 0;
        const { terminateStreamer, waitForStreamerTeardown } = await import("./streamerLifecycle");
        expect(await terminateStreamer()).toBe(true);
        expect(await waitForStreamerTeardown()).toBe(true);
        expect(streamer.terminate).not.toHaveBeenCalled();
    });
    it("waits for physical none after inProgress", async () => {
        vi.useFakeTimers();
        streamer.terminate.mockResolvedValue({ action: "terminate", status: "inProgress" });
        const { terminateStreamer } = await import("./streamerLifecycle");
        const result = terminateStreamer();
        await vi.advanceTimersByTimeAsync(25);
        streamer.streamStatus = 0;
        await vi.advanceTimersByTimeAsync(25);
        expect(await result).toBe(true);
    });
    it("fails closed after the existing five-second physical teardown deadline", async () => {
        vi.useFakeTimers();
        streamer.terminate.mockResolvedValue({ action: "terminate", status: "inProgress" });
        const { terminateStreamer } = await import("./streamerLifecycle");
        const result = terminateStreamer();
        await vi.advanceTimersByTimeAsync(5000);
        expect(await result).toBe(false);
    });
    it.each(["fulfilled-error", "rejection", "throw"] as const)("preserves failure for %s", async mode => {
        if (mode === "fulfilled-error") streamer.terminate.mockImplementation(() => {
            streamer.streamStatus = 0;
            return Promise.resolve({ action: "terminate", status: "error" });
        });
        else if (mode === "rejection") streamer.terminate.mockRejectedValue(new Error("test failure"));
        else streamer.terminate.mockImplementation(() => { throw new Error("test failure"); });
        const { terminateStreamer } = await import("./streamerLifecycle");
        expect(await terminateStreamer()).toBe(false);
    });
    it("uses the GFN stop lifecycle without calling the direct streamer", async () => {
        profile.source = "gfn";
        const gfn = { state: 1, stop: () => { gfn.state = 7; } };
        vi.stubGlobal("GFN", { streamer: gfn });
        const { terminateStreamer, waitForStreamerTeardown } = await import("./streamerLifecycle");
        expect(await terminateStreamer()).toBe(true);
        expect(await waitForStreamerTeardown()).toBe(true);
        expect(streamer.terminate).not.toHaveBeenCalled();
    });
    it("rejects missing GFN lifecycle rather than declaring teardown complete", async () => {
        profile.source = "gfn";
        vi.stubGlobal("GFN", undefined);
        const { terminateStreamer, waitForStreamerTeardown } = await import("./streamerLifecycle");
        expect(await terminateStreamer()).toBe(false);
        expect(await waitForStreamerTeardown()).toBe(false);
        expect(streamer.terminate).not.toHaveBeenCalled();
    });
});
