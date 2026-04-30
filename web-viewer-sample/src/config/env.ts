function queryParam(name: string): string | null {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get(name);
}

function positiveNumberConfig(queryName: string, envName: string, fallback: number): number {
    const raw = queryParam(queryName) || import.meta.env[envName];
    if (!raw) return fallback;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const reviewEnv = {
    coordinatorApiBase: import.meta.env.VITE_COORDINATOR_API_BASE || "http://127.0.0.1:8004",
    coordinatorSocketUrl: import.meta.env.VITE_COORDINATOR_SOCKET_URL || "http://127.0.0.1:8004",
    bimControlApiBase: import.meta.env.VITE_BIM_CONTROL_API_BASE || "http://127.0.0.1:8001",
    defaultProjectId: queryParam("projectId") || import.meta.env.VITE_DEFAULT_PROJECT_ID || "project_demo_001",
    defaultModelVersionId: queryParam("modelVersionId") || import.meta.env.VITE_DEFAULT_MODEL_VERSION_ID || "version_demo_001",
    defaultSessionId: queryParam("sessionId") || import.meta.env.VITE_DEFAULT_SESSION_ID || "",
    defaultUserId: queryParam("userId") || import.meta.env.VITE_DEFAULT_USER_ID || "dev_user_001",
    defaultDisplayName: queryParam("displayName") || import.meta.env.VITE_DEFAULT_DISPLAY_NAME || "示範使用者",
    autoCreateSession: (import.meta.env.VITE_AUTO_CREATE_SESSION || "true") !== "false",
    showDemoPanel: (import.meta.env.VITE_SHOW_DEMO_PANEL || "true") !== "false",
    streamStartTimeoutMs: positiveNumberConfig("streamTimeoutMs", "VITE_STREAM_START_TIMEOUT_MS", 30000),
};
