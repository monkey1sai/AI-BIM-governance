import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface KitInstanceEndpointConfig {
  id: string;
  signalingServer: string;
  signalingPort: number;
  mediaServer: string;
  mediaPort: number | null;
}

export interface CoordinatorConfig {
  host: string;
  port: number;
  bimControlApiBase: string;
  conversionApiBase: string;
  kitStreamServer: string;
  kitSignalingPort: number;
  kitMediaServer: string;
  kitMediaPort: number | null;
  kitInstanceEndpoints: KitInstanceEndpointConfig[];
  devAuthToken: string;
  sessionStoreDir: string;
  eventLogDir: string;
  corsOrigins: string[];
  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：對外 IFC-ready intake。
  // 公司雲端 control-plane / 落地端 IFC Worker 為外部系統；以下為落地端內網
  // machine-to-machine 設定（可替換 AuthProvider）。
  streamingConversionApiBase: string;
  externalIntakeAuthProvider: string;
  externalIntakeWebhookSecret: string;
  externalIntakeIpAllowlist: string[];
  // T5 雲端 callback（metadata-only outbox）。真實公司雲端 endpoint/auth 待
  // OQ1；未確認前 default 空＝無 real endpoint（outbox 視為不可達，保留重試
  // 至 dead-letter，不靜默丟棄）。每事件可由 ifc-ready callback_url 覆寫。
  cloudCallbackBaseUrl: string;
  callbackOutboxMaxAttempts: number;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumberFromEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function endpointFromUnknown(value: unknown, index: number, fallback: KitInstanceEndpointConfig): KitInstanceEndpointConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const signalingPort = readNumber(record.signalingPort ?? record.signaling_port);
  if (signalingPort === null) return null;
  return {
    id: readString(record.id ?? record.instance_id ?? record.kit_instance_id) || `kit_local_${String(index + 1).padStart(3, "0")}`,
    signalingServer: readString(record.signalingServer ?? record.signaling_server ?? record.stream_server) || fallback.signalingServer,
    signalingPort,
    mediaServer: readString(record.mediaServer ?? record.media_server) || fallback.mediaServer,
    mediaPort: readNumber(record.mediaPort ?? record.media_port),
  };
}

function kitInstanceEndpointsFromEnv(name: string, fallback: KitInstanceEndpointConfig): KitInstanceEndpointConfig[] {
  const value = process.env[name];
  if (!value) return [fallback];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [fallback];
    const endpoints = parsed
      .map((item, index) => endpointFromUnknown(item, index, fallback))
      .filter((endpoint): endpoint is KitInstanceEndpointConfig => endpoint !== null);
    return endpoints.length > 0 ? endpoints : [fallback];
  } catch {
    return [fallback];
  }
}

export function loadConfig(overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig {
  const cwd = process.cwd();
  const kitStreamServer = process.env.KIT_STREAM_SERVER || "127.0.0.1";
  const kitSignalingPort = numberFromEnv("KIT_SIGNALING_PORT", 49100);
  const kitMediaServer = process.env.KIT_MEDIA_SERVER || "127.0.0.1";
  const kitMediaPort = nullableNumberFromEnv("KIT_MEDIA_PORT");
  const defaultKitEndpoint: KitInstanceEndpointConfig = {
    id: "kit_local_001",
    signalingServer: kitStreamServer,
    signalingPort: kitSignalingPort,
    mediaServer: kitMediaServer,
    mediaPort: kitMediaPort,
  };
  return {
    host: process.env.HOST || "127.0.0.1",
    port: numberFromEnv("PORT", 8004),
    bimControlApiBase: process.env.BIM_CONTROL_API_BASE || "http://127.0.0.1:8001",
    conversionApiBase: process.env.WORKER_API_BASE || process.env.CONVERSION_API_BASE || "http://127.0.0.1:8005",
    kitStreamServer,
    kitSignalingPort,
    kitMediaServer,
    kitMediaPort,
    kitInstanceEndpoints: kitInstanceEndpointsFromEnv("KIT_INSTANCE_ENDPOINTS", defaultKitEndpoint),
    devAuthToken: process.env.DEV_AUTH_TOKEN || "dev-token",
    sessionStoreDir: process.env.SESSION_STORE_DIR || path.join(cwd, "data", "sessions"),
    eventLogDir: process.env.EVENT_LOG_DIR || path.join(cwd, "data", "events"),
    corsOrigins: csvFromEnv("CORS_ORIGINS", ["http://127.0.0.1:5173", "http://localhost:5173"]),
    streamingConversionApiBase:
      process.env.STREAMING_CONVERSION_API_BASE || "http://127.0.0.1:49100",
    externalIntakeAuthProvider: process.env.EXTERNAL_INTAKE_AUTH_PROVIDER || "intranet-dev",
    externalIntakeWebhookSecret: process.env.EXTERNAL_INTAKE_WEBHOOK_SECRET || "dev-webhook-secret",
    externalIntakeIpAllowlist: csvFromEnv("EXTERNAL_INTAKE_IP_ALLOWLIST", [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
    ]),
    cloudCallbackBaseUrl: process.env.CLOUD_CALLBACK_BASE_URL || "",
    callbackOutboxMaxAttempts: numberFromEnv("CALLBACK_OUTBOX_MAX_ATTEMPTS", 5),
    ...overrides,
  };
}
