import { resolveBimControlBase } from "./envHelpers";
import { normalizeA4HandoffId } from "../clients/a4Handoff";

function queryParam(name: string): string | null {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get(name);
}

export function allowedCoordinatorOrigins(): Set<string> {
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

export function trustedCoordinatorBase(raw: string): string | null {
    if (!raw || typeof globalThis.location === "undefined") return null;

    const parsed = normalizedHttpBaseUrl(raw);
    if (!parsed) return null;

    const browserHost = globalThis.location.hostname;
    if (parsed.hostname === browserHost) return baseUrlString(parsed);
    if (isLoopbackHost(browserHost) && isLoopbackHost(parsed.hostname)) return baseUrlString(parsed);
    if (allowedCoordinatorOrigins().has(parsed.origin)) return baseUrlString(parsed);

    return null;
}

function trustedCoordinatorBaseFromQuery(name: string): string | null {
    const raw = queryParam(name);
    return raw ? trustedCoordinatorBase(raw) : null;
}

// coordinator `/ui/open?session=review_session_xxx` redirects the browser to
// the Vite viewer with the same `session` query key. Keep `sessionId` as the
// legacy explicit key, but treat `session` as the primary coordinator handoff.
const rawSessionId = queryParam("session") || queryParam("sessionId");
const hasExplicitEmptySessionId = rawSessionId !== null && rawSessionId.trim() === "";
const rawA4HandoffId = queryParam("a4_handoff");
const a4HandoffId = normalizeA4HandoffId(rawA4HandoffId);
const queryCoordinatorApiBase = trustedCoordinatorBaseFromQuery("coordinatorApiBase");
const queryCoordinatorSocketUrl = trustedCoordinatorBaseFromQuery("coordinatorSocketUrl");
const defaultCoordinatorApiBase = "http://127.0.0.1:8004";
const rawEnvCoordinatorApiBase = import.meta.env.VITE_COORDINATOR_API_BASE || defaultCoordinatorApiBase;
const envCoordinatorApiBase = trustedCoordinatorBase(rawEnvCoordinatorApiBase) || defaultCoordinatorApiBase;

function positiveNumberConfig(queryName: string, envValue: string | undefined, fallback: number): number {
    const raw = queryParam(queryName) || envValue;
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
    a4HandoffId,
    hasInvalidA4HandoffId: rawA4HandoffId !== null && a4HandoffId === null,
    defaultUserId: queryParam("userId") || import.meta.env.VITE_DEFAULT_USER_ID || "dev_user_001",
    // 載入時的 source_client_id 設定值（嵌入時為父視窗配給的 lease id）；執行期不改寫。
    // 使用者憑證與 viewer lease token 屬 Viewer Credentials（src/clients/viewerCredentials.ts）：
    // standalone 於執行期產生、嵌入時由 origin 驗證過的 vg01 postMessage 送入，
    // 絕不從 URL 或 VITE_* 讀取 bearer 值；production 在綁定 IdP 前維持 fail-closed。
    sourceClientId: queryParam("sourceClientId") || queryParam("viewerLeaseId") || queryParam("leaseId") || queryParam("userId") || import.meta.env.VITE_DEFAULT_USER_ID || "dev_user_001",
    defaultDisplayName: queryParam("displayName") || import.meta.env.VITE_DEFAULT_DISPLAY_NAME || "示範使用者",
    autoCreateSession: (import.meta.env.VITE_AUTO_CREATE_SESSION || "true") !== "false",
    showDemoPanel: (import.meta.env.VITE_SHOW_DEMO_PANEL || "true") !== "false",
    streamStartTimeoutMs: positiveNumberConfig("streamTimeoutMs", import.meta.env.VITE_STREAM_START_TIMEOUT_MS, 30000),
};
