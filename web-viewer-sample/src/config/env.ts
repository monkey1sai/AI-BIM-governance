import { resolveBimControlBase } from "./envHelpers";

function queryParam(name: string): string | null {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get(name);
}

function allowedCoordinatorOrigins(): Set<string> {
    const raw = import.meta.env.VITE_ALLOWED_COORDINATOR_ORIGINS || "";
    return new Set(
        raw
            .split(",")
            .map((origin: string) => origin.trim())
            .filter(Boolean)
            .map((origin: string) => normalizedHttpBaseUrl(origin)?.origin)
            .filter((origin: string | undefined): origin is string => Boolean(origin)),
    );
}

function isLoopbackHost(hostname: string): boolean {
    const normalized = hostname.toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function normalizedHttpBaseUrl(raw: string): URL | null {
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        parsed.hash = "";
        parsed.search = "";
        return parsed;
    } catch {
        return null;
    }
}

function baseUrlString(url: URL): string {
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname && pathname !== "/" ? pathname : ""}`;
}

function trustedCoordinatorBaseFromQuery(name: string): string | null {
    const raw = queryParam(name);
    if (!raw || typeof globalThis.location === "undefined") return null;

    const parsed = normalizedHttpBaseUrl(raw);
    if (!parsed) return null;

    const browserHost = globalThis.location.hostname;
    if (parsed.hostname === browserHost) return baseUrlString(parsed);
    if (isLoopbackHost(browserHost) && isLoopbackHost(parsed.hostname)) return baseUrlString(parsed);
    if (allowedCoordinatorOrigins().has(parsed.origin)) return baseUrlString(parsed);

    return null;
}

// coordinator `/ui/open?session=review_session_xxx` redirects the browser to
// the Vite viewer with the same `session` query key. Keep `sessionId` as the
// legacy explicit key, but treat `session` as the primary coordinator handoff.
const rawSessionId = queryParam("session") || queryParam("sessionId");
const hasExplicitEmptySessionId = rawSessionId !== null && rawSessionId.trim() === "";
const queryCoordinatorApiBase = trustedCoordinatorBaseFromQuery("coordinatorApiBase");
const queryCoordinatorSocketUrl = trustedCoordinatorBaseFromQuery("coordinatorSocketUrl");
const envCoordinatorApiBase = import.meta.env.VITE_COORDINATOR_API_BASE || "http://127.0.0.1:8004";

function positiveNumberConfig(queryName: string, envName: string, fallback: number): number {
    const raw = queryParam(queryName) || import.meta.env[envName];
    if (!raw) return fallback;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const reviewEnv = {
    coordinatorApiBase: queryCoordinatorApiBase || envCoordinatorApiBase,
    coordinatorSocketUrl: queryCoordinatorSocketUrl || queryCoordinatorApiBase || import.meta.env.VITE_COORDINATOR_SOCKET_URL || envCoordinatorApiBase,
    bimControlApiBase: resolveBimControlBase(queryCoordinatorApiBase, envCoordinatorApiBase),
    defaultProjectId: queryParam("projectId") || import.meta.env.VITE_DEFAULT_PROJECT_ID || "project_demo_001",
    defaultModelVersionId: queryParam("modelVersionId") || import.meta.env.VITE_DEFAULT_MODEL_VERSION_ID || "version_demo_001",
    defaultReviewRequestId: queryParam("reviewRequestId") || queryParam("review_request_id") || import.meta.env.VITE_DEFAULT_REVIEW_REQUEST_ID || "",
    defaultSessionId: hasExplicitEmptySessionId ? "" : rawSessionId || import.meta.env.VITE_DEFAULT_SESSION_ID || "",
    hasExplicitEmptySessionId,
    defaultUserId: queryParam("userId") || import.meta.env.VITE_DEFAULT_USER_ID || "dev_user_001",
    defaultDisplayName: queryParam("displayName") || import.meta.env.VITE_DEFAULT_DISPLAY_NAME || "示範使用者",
    autoCreateSession: (import.meta.env.VITE_AUTO_CREATE_SESSION || "true") !== "false",
    showDemoPanel: (import.meta.env.VITE_SHOW_DEMO_PANEL || "true") !== "false",
    streamStartTimeoutMs: positiveNumberConfig("streamTimeoutMs", "VITE_STREAM_START_TIMEOUT_MS", 30000),
};
