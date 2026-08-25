// 測試專用：十端點的「閒置真值」payload（形狀對齊 2026-08-25 canonical-linux 同分鐘 API：0 session／issues []／
// kit_local_001 idle）與 coordinatorClient 層 spy helper。production 元件不得 import 本目錄
// （fixtureNotInProduction.test.ts 守門）。
import { vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "../../coordinatorClient";
import type { CallbackOutboxSummaryEntry, ConversionRecord, RuntimeSessionSummary, RuntimeStatus } from "../../coordinatorClient";
import type { EndpointData, EndpointFetchers, EndpointKey } from "../coordinatorStatusStore";

export const RT_IDLE: RuntimeStatus = {
  service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-08-25T00:00:00Z" },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
    conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
    kit: [{ id: "kit_local_001", signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1", mediaPort: 47998 }],
  },
  sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
  kit_instance_bindings: [],
  ifc_ready_jobs: { count: 0, recent: [] },
  observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [49100], kit_media_ports: [47998] } },
};

export const IDLE: EndpointData = {
  runtimeStatus: RT_IDLE,
  ifcReady: { count: 0, items: [] },
  conversionRecords: { count: 0, items: [] },
  outboxSummary: { total: 0, limit: 200, entries: [] },
  issues: { issues: [] },
  ruleRuns: { filters: {}, limit: 5, offset: 0, total: 0, items: [] },
  minioWatch: { enabled: false, note: "watch disabled" },
  minioFolder: { bucket: null, prefix: "", folders: [], objects: [], count: 0 },
  kitHealth: { status: "ok" },
  kitInstance: { instance_id: "kit_local_001", status: "idle", control_status: "not_sent", selected_artifact_ids: [], opened_runtime_uris: [], last_command: null },
};

export const ENDPOINT_PATHS: Record<EndpointKey, string> = {
  runtimeStatus: "/api/runtime/status",
  ifcReady: "/api/external/ifc-ready?limit=20",
  conversionRecords: "/api/conversion/records?limit=100",
  outboxSummary: "/api/callback-outbox/summary?limit=200",
  issues: "/api/governance/issues",
  ruleRuns: "/api/governance/rule-runs?limit=5",
  minioWatch: "/api/external/minio-watch/status",
  minioFolder: "/api/minio/objects?delimiter=%2F",
  kitHealth: "/api/kit/health",
  kitInstance: "/api/kit/instances/current",
};

export function offline503(key: EndpointKey): CoordinatorHttpError {
  return new CoordinatorHttpError(ENDPOINT_PATHS[key], 503, "design_gate_deterministic_offline");
}

/** 直接餵給 CoordinatorStatusStore 建構子的 fetcher 組（不經 coordinatorClient）。 */
export function idleFetchers(overrides: Partial<EndpointData> = {}): EndpointFetchers {
  const data: EndpointData = { ...IDLE, ...overrides };
  return {
    runtimeStatus: async () => data.runtimeStatus,
    ifcReady: async () => data.ifcReady,
    conversionRecords: async () => data.conversionRecords,
    outboxSummary: async () => data.outboxSummary,
    issues: async () => data.issues,
    ruleRuns: async () => data.ruleRuns,
    minioWatch: async () => data.minioWatch,
    minioFolder: async () => data.minioFolder,
    kitHealth: async () => data.kitHealth,
    kitInstance: async () => data.kitInstance,
  };
}

export type EndpointOverrides = Partial<{ [K in EndpointKey]: EndpointData[K] | Error }>;

/** 對 coordinatorClient 十個方法一次 spy：預設閒置真值；overrides 給 payload 或 Error（reject）。 */
export function spyCoordinatorEndpoints(overrides: EndpointOverrides = {}) {
  const pick = <K extends EndpointKey>(key: K): Promise<EndpointData[K]> => {
    const v = overrides[key];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve((v ?? IDLE[key]) as EndpointData[K]);
  };
  return {
    runtimeStatus: vi.spyOn(coordinatorClient, "runtimeStatus").mockImplementation(() => pick("runtimeStatus")),
    listIfcReady: vi.spyOn(coordinatorClient, "listIfcReady").mockImplementation(() => pick("ifcReady")),
    getConversionRecords: vi.spyOn(coordinatorClient, "getConversionRecords").mockImplementation(() => pick("conversionRecords")),
    getCallbackOutboxSummary: vi.spyOn(coordinatorClient, "getCallbackOutboxSummary").mockImplementation(() => pick("outboxSummary")),
    governanceIssues: vi.spyOn(coordinatorClient, "governanceIssues").mockImplementation(() => pick("issues")),
    governanceRuleRuns: vi.spyOn(coordinatorClient, "governanceRuleRuns").mockImplementation(() => pick("ruleRuns")),
    minioWatchStatus: vi.spyOn(coordinatorClient, "minioWatchStatus").mockImplementation(() => pick("minioWatch")),
    getMinioFolder: vi.spyOn(coordinatorClient, "getMinioFolder").mockImplementation(() => pick("minioFolder")),
    kitHealth: vi.spyOn(coordinatorClient, "kitHealth").mockImplementation(() => pick("kitHealth")),
    kitInstanceCurrent: vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockImplementation(() => pick("kitInstance")),
  };
}

/** 十端點全部 503（design gate 環境語意）。 */
export function spyCoordinatorEndpointsOffline() {
  return spyCoordinatorEndpoints({
    runtimeStatus: offline503("runtimeStatus"), ifcReady: offline503("ifcReady"), conversionRecords: offline503("conversionRecords"),
    outboxSummary: offline503("outboxSummary"), issues: offline503("issues"), ruleRuns: offline503("ruleRuns"),
    minioWatch: offline503("minioWatch"), minioFolder: offline503("minioFolder"), kitHealth: offline503("kitHealth"),
    kitInstance: offline503("kitInstance"),
  });
}

export function conversionRecord(key: string, status: ConversionRecord["status"]): ConversionRecord {
  return {
    idempotency_key: key, project_id: "270", project_display_name: "270", category: "building", external_model_version_id: "v1",
    conversion_job_id: null, status, usdc_key: null, coverage_report: null, object_key: null, detected_at: "2026-08-12T00:00:00Z", updated_at: "2026-08-12T00:00:00Z",
  };
}

export function outboxEntries(n: number, attempts: number, maxAttempts: number): CallbackOutboxSummaryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    outbox_id: `ob_${i}`, event: "conversion-result", status: "pending" as const, attempts, max_attempts: maxAttempts,
    last_error: null, created_at: "2026-08-25T00:00:00Z", delivered_at: null, correlation_id: null, conversion_job_id: null,
  }));
}

export function sessionItem(id: string, status = "active"): RuntimeSessionSummary {
  return {
    session_id: id, status, project_id: "270", model_version_id: "v1", participant_count: 1, expected_stage_url: null,
    conversion_status: "ready", kit_instance_ids: [], created_at: "2026-08-25T00:00:00Z", updated_at: "2026-08-25T00:00:00Z",
  };
}
