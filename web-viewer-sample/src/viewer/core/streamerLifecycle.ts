/*
 * SPDX-FileCopyrightText: Copyright (c) 2024 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: LicenseRef-NvidiaProprietary
 *
 * NVIDIA CORPORATION, its affiliates and licensors retain all intellectual
 * property and proprietary rights in and to this material, related
 * documentation and any modifications thereto. Any use, reproduction,
 * disclosure or distribution of this material and related documentation
 * without an express license agreement from NVIDIA CORPORATION or
 * its affiliates is strictly prohibited.
 */
import { StreamStatus } from "@nvidia/omniverse-webrtc-streaming-library";
import StreamConfig from "../../../stream.config.json";
import { getStreamer } from "../../harness/streamer";
import { harnessEnabled } from "../../harness/harnessConfig";

// NVIDIA's singleton streamer clears its callback map only after a successful
// terminate result. A fulfilled inProgress/error result can retain _stream,
// so serialize the next connect behind proven physical teardown rather than
// treating every fulfilled Promise as a completed lifecycle.
let pendingStreamerTeardown: Promise<boolean> | null = null;
const STREAMER_TEARDOWN_POLL_MS = 25;
const STREAMER_TEARDOWN_TIMEOUT_MS = 5_000;
const GFN_STREAMER_IDLE_STATES = new Set([0, 7]); // Unknown / Finished in GFN client SDK 1.x.

interface GfnStreamerLifecycle {
    state?: number;
    stop?: () => unknown;
}

function usesGfnManagedLifecycle(): boolean {
    // NVIDIA AppStreamer 5.18.2 does not implement its GFN adapter's
    // terminate(), so GFN must be stopped through the client SDK global.
    return StreamConfig.source === "gfn";
}

function getGfnStreamerLifecycle(): GfnStreamerLifecycle | null {
    const gfn = (globalThis as typeof globalThis & {
        GFN?: { streamer?: GfnStreamerLifecycle };
    }).GFN;
    return gfn?.streamer || null;
}

function isGfnStreamerPhysicallyTerminated(): boolean {
    const state = getGfnStreamerLifecycle()?.state;
    return typeof state === "number" && GFN_STREAMER_IDLE_STATES.has(state);
}

function waitForPhysicalGfnTeardown(): Promise<boolean> {
    if (isGfnStreamerPhysicallyTerminated()) return Promise.resolve(true);
    const deadline = Date.now() + STREAMER_TEARDOWN_TIMEOUT_MS;
    return new Promise((resolve) => {
        const poll = () => {
            if (isGfnStreamerPhysicallyTerminated()) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(poll, STREAMER_TEARDOWN_POLL_MS);
        };
        poll();
    });
}

async function terminateGfnStreamer(): Promise<boolean> {
    const streamer = getGfnStreamerLifecycle();
    if (!streamer) return false;
    if (isGfnStreamerPhysicallyTerminated()) return true;
    if (typeof streamer.stop !== "function") return false;
    try {
        await Promise.resolve(streamer.stop());
        return waitForPhysicalGfnTeardown();
    } catch (error) {
        console.error(error);
        return false;
    }
}

function hasCompletedStreamerTeardown(result: unknown): boolean {
    // The deterministic harness terminates synchronously and deliberately
    // returns void after it clears its own callback/timer state. Production
    // AppStreamer must return the documented terminate/success event.
    if (harnessEnabled() && result === undefined) return true;
    if (!result || typeof result !== "object") return false;
    const event = result as { action?: unknown; status?: unknown };
    return event.action === "terminate" && event.status === "success";
}

function isStreamerPhysicallyTerminated(): boolean {
    if (harnessEnabled()) return true;
    return (getStreamer() as { streamStatus?: unknown }).streamStatus === StreamStatus.none;
}

function waitsForStreamerTeardown(result: unknown): boolean {
    if (!result || typeof result !== "object") return false;
    const event = result as { action?: unknown; status?: unknown };
    return event.action === "terminate" && event.status === "inProgress";
}

function waitForPhysicalStreamerTeardown(): Promise<boolean> {
    if (isStreamerPhysicallyTerminated()) return Promise.resolve(true);
    const deadline = Date.now() + STREAMER_TEARDOWN_TIMEOUT_MS;
    return new Promise((resolve) => {
        const poll = () => {
            if (isStreamerPhysicallyTerminated()) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(poll, STREAMER_TEARDOWN_POLL_MS);
        };
        poll();
    });
}

function trackStreamerTeardown(teardown: Promise<boolean>): Promise<boolean> {
    pendingStreamerTeardown = teardown;
    void teardown.finally(() => {
        if (pendingStreamerTeardown === teardown) pendingStreamerTeardown = null;
    });
    return teardown;
}

export function terminateStreamer(): Promise<boolean> {
    if (pendingStreamerTeardown) return pendingStreamerTeardown;
    if (usesGfnManagedLifecycle()) return trackStreamerTeardown(terminateGfnStreamer());
    if (isStreamerPhysicallyTerminated()) return Promise.resolve(true);
    try {
        const teardown = Promise.resolve(getStreamer().terminate(false))
            .then(
                (result) => {
                    if (hasCompletedStreamerTeardown(result)) return true;
                    if (waitsForStreamerTeardown(result)) return waitForPhysicalStreamerTeardown();
                    // A fulfilled error/warning is not a terminal cleanup
                    // acknowledgement. It must fail this lifecycle even when
                    // a snapshot happens to report none; a later fresh mount
                    // may independently observe none and reconnect safely.
                    console.error("AppStream streamer teardown did not complete");
                    return false;
                },
                (error) => {
                    console.error(error);
                    return false;
                },
            );
        return trackStreamerTeardown(teardown);
    } catch (error) {
        console.error(error);
        return Promise.resolve(false);
    }
}

export function waitForStreamerTeardown(): Promise<boolean> {
    if (pendingStreamerTeardown) return pendingStreamerTeardown;
    if (usesGfnManagedLifecycle()) return Promise.resolve(isGfnStreamerPhysicallyTerminated());
    return Promise.resolve(isStreamerPhysicallyTerminated());
}
