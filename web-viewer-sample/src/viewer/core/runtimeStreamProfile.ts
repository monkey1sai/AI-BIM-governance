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
import type { StreamEndpoint } from "../../utils/windowHelpers";

export interface RuntimeStreamProfileProps {
    signalingserver: string;
    signalingport: number;
    mediaserver: string;
    mediaport: number | undefined;
}

export interface RuntimeStreamProfileDefaults {
    server: string;
    signalingPort: number;
    mediaPort?: number | null;
}

export function getQueryParam(search: string, ...names: string[]): string | null {
    const params = new URLSearchParams(search);
    for (const name of names) {
        const value = params.get(name);
        if (value && value.trim().length > 0) return value.trim();
    }
    return null;
}

export function getQueryPort(search: string, ...names: string[]): number | null {
    const value = getQueryParam(search, ...names);
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

export function isSpectatorStreamMode(search: string): boolean {
    const mode = getQueryParam(search, "streamRole", "stream_role", "viewerMode", "viewer_mode");
    return mode?.toLowerCase() === "spectator" || mode?.toLowerCase() === "view_only";
}

export function hasDirectStreamEndpointOverride(search: string): boolean {
    const params = new URLSearchParams(search);
    return params.has("signalingPort") || params.has("signalingport") || params.has("mediaPort") || params.has("mediaport");
}

export function resolveInitialStreamEndpoint(
    search: string,
    props: RuntimeStreamProfileProps,
    defaults: RuntimeStreamProfileDefaults,
): StreamEndpoint {
    return {
        kitInstanceId: getQueryParam(search, "kitInstanceId", "kit_instance_id"),
        signalingserver: getQueryParam(search, "signalingServer", "signalingserver") || props.signalingserver || defaults.server,
        signalingport: getQueryPort(search, "signalingPort", "signalingport") || props.signalingport || defaults.signalingPort,
        mediaserver: getQueryParam(search, "mediaServer", "mediaserver") || props.mediaserver || defaults.server,
        mediaport: getQueryPort(search, "mediaPort", "mediaport") ?? props.mediaport ?? defaults.mediaPort ?? undefined,
    };
}

export function streamEndpointLabel(endpoint: StreamEndpoint): string {
    const kit = endpoint.kitInstanceId ? `${endpoint.kitInstanceId} ` : "";
    const media = endpoint.mediaport !== undefined ? `/${endpoint.mediaport}` : "";
    return `${kit}${endpoint.signalingserver}:${endpoint.signalingport}${media}`;
}
