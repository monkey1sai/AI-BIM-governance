import type { RuntimeKitBinding, RuntimeSessionSummary, RuntimeStatus } from "../coordinatorClient";

export type HealthTone = "green" | "yellow" | "red";
export type EndpointRole = "primary" | "spectator";
export type LeaseState = "free" | "reserved" | "signaling" | "connected" | "draining" | "released" | "failed";
export type EvidenceState = "ok" | "not_observed" | "missing" | "failed";
export type EndpointReadiness = "free" | "waiting_runtime" | "waiting_first_frame" | "occupied" | "releasable" | "failed";

export interface HealthLine {
  tone: HealthTone;
  label: string;
  detail: string;
}

export interface ClassicDashboardSummary {
  overall: HealthLine;
  kitRuntime: HealthLine;
  endpointPool: { value: string; detail: string };
  activeSessions: { value: string; detail: string };
  viewerEvidence: { value: string; detail: string };
  stageTruth: { value: string; detail: string };
  recentRisk: HealthLine;
}

export interface EndpointRow {
  code: "PRI" | "SPC";
  endpointId: string;
  port: number;
  role: EndpointRole;
  leaseState: LeaseState;
  sessionId: string;
  kitInstanceId: string;
  firstFrame: EvidenceState;
  heartbeat: EvidenceState;
  stageTruth: EvidenceState;
  readiness: EndpointReadiness;
  businessStatus: string;
  nextAllowedAction: string;
  technicalDetail: string;
}

function bindingToLeaseState(binding: RuntimeKitBinding | undefined): LeaseState {
  if (!binding) {
    return "free";
  }
  switch (binding.status) {
    case "allocated":
      return "reserved";
    case "starting":
      return "signaling";
    case "ready":
      return "connected";
    case "draining":
      return "draining";
    case "released":
      return "released";
    case "failed":
      return "failed";
    default:
      return "failed";
  }
}

function leaseToReadiness(leaseState: LeaseState): EndpointReadiness {
  switch (leaseState) {
    case "free":
    case "released":
      return "free";
    case "reserved":
    case "signaling":
      return "waiting_runtime";
    case "connected":
      return "waiting_first_frame";
    case "draining":
      return "releasable";
    case "failed":
      return "failed";
  }
}

function readinessToBusinessStatus(readiness: EndpointReadiness): string {
  switch (readiness) {
    case "free":
      return "可分配";
    case "waiting_runtime":
      return "等待 Kit runtime 啟動";
    case "waiting_first_frame":
      return "等待第一幀畫面";
    case "occupied":
      return "使用中";
    case "releasable":
      return "可釋放";
    case "failed":
      return "Runtime 失敗";
  }
}

function nextAllowedAction(role: EndpointRole, readiness: EndpointReadiness): string {
  if (readiness === "free") {
    return role === "primary" ? "Open primary URL" : "Open spectator URL";
  }
  if (readiness === "waiting_first_frame" && role === "spectator") {
    return "Reclaim stale spectator if timeout";
  }
  if (readiness === "releasable") {
    return "Release after audit";
  }
  if (readiness === "failed") {
    return "Force release / restart requires reason";
  }
  return "Observe evidence";
}

function heartbeatState(binding: RuntimeKitBinding | undefined, readiness: EndpointReadiness): EvidenceState {
  if (readiness === "free") {
    return "missing";
  }
  if (binding?.last_heartbeat_at) {
    return "ok";
  }
  return "not_observed";
}

function findSession(rt: RuntimeStatus, binding: RuntimeKitBinding | undefined): RuntimeSessionSummary | null {
  if (binding) {
    return rt.sessions.items.find((session) => session.session_id === binding.session_id) ?? null;
  }
  return null;
}

function findActiveSession(rt: RuntimeStatus): RuntimeSessionSummary | null {
  return (
    rt.sessions.items.find((session) => session.status === "active") ??
    (rt.sessions.active_count > 0 ? rt.sessions.items[0] ?? null : null)
  );
}

export function buildEndpointRows(rt: RuntimeStatus | null): EndpointRow[] {
  if (!rt) {
    return [];
  }

  const bindingsByKitInstanceId = new Map<string, RuntimeKitBinding>(
    rt.kit_instance_bindings.map((binding) => [binding.kit_instance_id, binding]),
  );

  return rt.configured_endpoints.kit.map((endpoint, index): EndpointRow => {
    const binding = bindingsByKitInstanceId.get(endpoint.id);
    const session = findSession(rt, binding);
    const code = index === 0 ? "PRI" : "SPC";
    const role = index === 0 ? "primary" : "spectator";
    const leaseState = bindingToLeaseState(binding);
    const readiness = leaseToReadiness(leaseState);
    const sessionId = binding?.session_id ?? "—";
    const mediaPort = endpoint.mediaPort ?? "—";

    return {
      code,
      endpointId: `${code} :${endpoint.signalingPort}`,
      port: endpoint.signalingPort,
      role,
      leaseState,
      sessionId,
      kitInstanceId: binding?.kit_instance_id ?? endpoint.id,
      firstFrame: readiness === "free" ? "missing" : "not_observed",
      heartbeat: heartbeatState(binding, readiness),
      stageTruth: session?.expected_stage_url ? "not_observed" : "missing",
      readiness,
      businessStatus: readinessToBusinessStatus(readiness),
      nextAllowedAction: nextAllowedAction(role, readiness),
      technicalDetail: `kit_instance=${binding?.kit_instance_id ?? endpoint.id}; media=${endpoint.mediaServer}:${mediaPort}; session=${sessionId}`,
    };
  });
}

export function deriveClassicDashboard(rt: RuntimeStatus | null): ClassicDashboardSummary {
  if (!rt) {
    return {
      overall: {
        tone: "red",
        label: "Runtime 無法連線",
        detail: "未取得 coordinator runtime status",
      },
      kitRuntime: {
        tone: "red",
        label: "Runtime 無法連線",
        detail: "無法取得 Kit runtime 狀態",
      },
      endpointPool: {
        value: "0",
        detail: "未取得 endpoint pool",
      },
      activeSessions: {
        value: "0",
        detail: "未取得 session summary",
      },
      viewerEvidence: {
        value: "未取得 first-frame evidence",
        detail: "coordinator runtime status unavailable",
      },
      stageTruth: {
        value: "stage loaded 未觀測",
        detail: "coordinator runtime status unavailable",
      },
      recentRisk: {
        tone: "red",
        label: "Runtime status unavailable",
        detail: "無法判讀近期 runtime 風險",
      },
    };
  }

  const endpoints = buildEndpointRows(rt);
  const activeSession = findActiveSession(rt);
  const hasConfiguredKitEndpoint = rt.configured_endpoints.kit.length > 0;
  const hasFailedEndpoint = endpoints.some((endpoint) => endpoint.readiness === "failed");
  const hasWaitingFirstFrame = endpoints.some((endpoint) => endpoint.readiness === "waiting_first_frame");
  const hasWaitingRuntime = endpoints.some((endpoint) => endpoint.readiness === "waiting_runtime");

  const overall = (() => {
    if (!hasConfiguredKitEndpoint) {
      return {
        tone: "red",
        label: "未配置 Kit endpoint",
        detail: "Runtime endpoint 未觀測：configured_endpoints.kit 為空",
      } satisfies HealthLine;
    }
    if (hasFailedEndpoint) {
      return {
        tone: "red",
        label: "Runtime endpoint 失敗",
        detail: "至少一個 Kit endpoint 回報 failed",
      } satisfies HealthLine;
    }
    if (hasWaitingFirstFrame) {
      return {
        tone: "yellow",
        label: "等待第一幀畫面",
        detail: "Kit binding ready，但 browser first-frame evidence 尚未取得",
      } satisfies HealthLine;
    }
    if (hasWaitingRuntime) {
      return {
        tone: "yellow",
        label: "等待 Kit runtime 啟動",
        detail: "Kit endpoint 已保留，等待 runtime ready",
      } satisfies HealthLine;
    }
    if (activeSession) {
      return {
        tone: "yellow",
        label: "等待 Runtime endpoint",
        detail: "存在 active session，但尚未觀測到 Kit binding",
      } satisfies HealthLine;
    }
    return {
      tone: "green",
      label: "Runtime 空閒",
      detail: "目前沒有 active session",
    } satisfies HealthLine;
  })();

  const kitRuntime: HealthLine = (() => {
    if (!hasConfiguredKitEndpoint) {
      return {
        tone: "red",
        label: "未配置 Kit endpoint",
        detail: "Kit runtime 無可用 endpoint capacity",
      };
    }
    if (hasFailedEndpoint) {
      return {
        tone: "red",
        label: "Kit runtime failed",
        detail: "至少一個 Kit binding 或 endpoint 需要人工處理",
      };
    }
    if (hasWaitingRuntime) {
      return {
        tone: "yellow",
        label: "Kit runtime 啟動中",
        detail: "endpoint 已保留但尚未 ready",
      };
    }
    if (hasWaitingFirstFrame) {
      return {
        tone: "yellow",
        label: "Kit runtime ready",
        detail: "runtime ready，等待 browser first-frame evidence",
      };
    }
    return {
      tone: "yellow",
      label: "Kit endpoint 已配置",
      detail: "process evidence 未取得；等 lease / heartbeat 後判定 Kit alive",
    };
  })();

  const endpointPool = {
    value: `${endpoints.length}`,
    detail: hasConfiguredKitEndpoint
      ? `primary=${endpoints.filter((endpoint) => endpoint.role === "primary").length}; spectator=${endpoints.filter((endpoint) => endpoint.role === "spectator").length}`
      : "未配置 Kit endpoint",
  };

  const activeSessions = {
    value: `${rt.sessions.active_count}`,
    detail: `sessions=${rt.sessions.count}; participants=${rt.sessions.participant_count}`,
  };

  const viewerEvidence = hasWaitingFirstFrame || activeSession
    ? {
        value: "未取得 first-frame evidence",
        detail: hasWaitingFirstFrame
          ? "Phase 1 尚未取得 browser first-frame evidence"
          : "active session 尚未取得 browser evidence",
      }
    : {
        value: "目前無 active viewer evidence 需求",
        detail: "目前沒有 active session 需要 viewer evidence",
      };

  const stageTruth = activeSession?.expected_stage_url
    ? {
        value: "stage loaded 未觀測",
        detail: `expected_stage_url=${activeSession.expected_stage_url}`,
      }
    : {
        value: activeSession ? "缺少 expected_stage_url" : "目前無 active stage",
        detail: activeSession ? `session=${activeSession.session_id}` : "目前沒有 active session",
      };

  const recentRisk: HealthLine = (() => {
    if (!hasConfiguredKitEndpoint) {
      return {
        tone: "red",
        label: "Runtime endpoint 未觀測",
        detail: "configured_endpoints.kit 為空，無法建立 runtime lease",
      };
    }
    if (hasFailedEndpoint) {
      return {
        tone: "red",
        label: "Runtime endpoint failed",
        detail: "需要 force release / restart reason",
      };
    }
    if (hasWaitingFirstFrame) {
      return {
        tone: "yellow",
        label: "Evidence pending",
        detail: "Kit ready 但 browser first-frame evidence 尚未出現",
      };
    }
    return {
      tone: "green",
      label: "無近期風險",
      detail: "目前沒有 failed endpoint 或 pending first-frame",
    };
  })();

  return {
    overall,
    kitRuntime,
    endpointPool,
    activeSessions,
    viewerEvidence,
    stageTruth,
    recentRisk,
  };
}
