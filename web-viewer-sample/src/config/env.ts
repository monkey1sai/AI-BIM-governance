export const reviewEnv = {
    coordinatorApiBase: import.meta.env.VITE_COORDINATOR_API_BASE || "http://127.0.0.1:8004",
    coordinatorSocketUrl: import.meta.env.VITE_COORDINATOR_SOCKET_URL || "http://127.0.0.1:8004",
    bimControlApiBase: import.meta.env.VITE_BIM_CONTROL_API_BASE || "http://127.0.0.1:8001",
    defaultProjectId: import.meta.env.VITE_DEFAULT_PROJECT_ID || "project_demo_001",
    defaultModelVersionId: import.meta.env.VITE_DEFAULT_MODEL_VERSION_ID || "version_demo_001",
    defaultUserId: import.meta.env.VITE_DEFAULT_USER_ID || "dev_user_001",
    defaultDisplayName: import.meta.env.VITE_DEFAULT_DISPLAY_NAME || "Dev User",
    autoCreateSession: (import.meta.env.VITE_AUTO_CREATE_SESSION || "true") !== "false",
};
