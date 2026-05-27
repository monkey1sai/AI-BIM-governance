import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

dotenv.config();

const DEFAULT_STREAMING_CONVERSION_API_BASE = "http://127.0.0.1:49101";
const RETIRED_LEGACY_CONVERSION_API_BASES = new Set([
  "http://127.0.0.1:8003",
  "http://localhost:8003",
]);

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
  coordinatorPublicBaseUrl: string;
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
  internalApiAuthToken: string;
  // B-scheme（local-coordinator-ifc-ready-intake-boundary T3）：對外 IFC-ready intake。
  // 公司雲端 control-plane / 落地端 IFC Worker 為外部系統；以下為落地端內網
  // machine-to-machine 設定（可替換 AuthProvider）。
  streamingConversionApiBase: string;
  // host-native conversion service 啟用 internal token 時，coordinator 帶
  // X-Internal-Conversion-Token；optional（default 空＝streaming 未啟用 token），
  // 既有手動建構的 config literal 無需一律補欄位。
  streamingConversionInternalToken?: string;
  externalIntakeAuthProvider: string;
  externalIntakeWebhookSecret: string;
  externalIntakeIpAllowlist: string[];
  // T5 雲端 callback（metadata-only outbox）。真實公司雲端 endpoint/auth 待
  // OQ1；未確認前 default 空＝無 real endpoint（outbox 視為不可達，保留重試
  // 至 dead-letter，不靜默丟棄）。每事件的 callback_url 只允許落在
  // cloudCallbackBaseUrl 同 origin；未設定時不得由外部 payload 任意指定。
  cloudCallbackBaseUrl: string;
  callbackOutboxMaxAttempts: number;
  callbackOutboxStorePath: string;
  // T7：使用者（local web view）auth provider，可替換；不做死 EZPLUS SSO，
  // local web view ↔ 公司 SSO 真實銜接待 OQ5。
  userAuthProvider: string;
  // fast-ifc-link-demo-loop §2.5:同步下載 IFC + viewer_url 組合 + shared volume 路徑
  ifcDownloadTimeoutSeconds: number;     // POST /api/external/ifc-ready 同步下載 timeout
  storageRoot: string;                    // coordinator 寫入路徑;docker compose 顯式設 /workspace/storage,host-native 預設 <cwd>/storage
  storageHostRoot: string;                // host view storage root,寫進 dispatch payload host_local_path
  publicHost: string;                     // viewer_url 用的對外 host(coordinator 對 LAN IP);default 127.0.0.1
  viewerPublicBaseUrl: string;            // browser-visible viewer origin;default follows PUBLIC_HOST:VIEWER_PORT
  // coordinator-auto-poll-streaming-conversion:dispatch 成功後 in-process 自動 poll
  // streaming-server `/api/conversions/<id>/result` 直到 terminal,自動跑既有 ingest path,
  // 不需要外部手動 POST /api/internal/conversions/<id>/ingest。test fixture 可關掉。
  conversionPollEnabled: boolean;         // env CONVERSION_POLL_ENABLED,default true
  conversionPollIntervalSeconds: number;  // env CONVERSION_POLL_INTERVAL_SECONDS,default 5
  conversionPollMaxAttempts: number;      // env CONVERSION_POLL_MAX_ATTEMPTS,default 60(= 5 分鐘上限)
  // cross-service-structured-log-baseline: 結構化 log 寫入根目錄。
  // 預設 LOG_ROOT env 或 <cwd>/logs;tests fixture 應在 overrides 內傳 tmp 路徑避免污染 repo。
  logRoot: string;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function normalizePublicBaseUrl(value: string | undefined, name: string): string | null {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) {
    throw new Error(`${name} must be an absolute http(s) URL.`);
  }
  const url = new URL(normalized);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use http or https.`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must not include query, hash, or credentials.`);
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "" ? "" : pathname}`;
}

function publicBaseUrlFromHost(hostOrUrl: string, port: number): string {
  const normalized = normalizeBaseUrl(hostOrUrl) || "127.0.0.1";
  if (/^https?:\/\//i.test(normalized)) return normalizePublicBaseUrl(normalized, "PUBLIC_HOST") || "http://127.0.0.1";
  return `http://${normalized}:${port}`;
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

function integerFromEnv(names: string[], fallback: number, options: { min?: number; max?: number } = {}): number {
  const name = names.find((candidate) => process.env[candidate] !== undefined);
  if (!name) return fallback;
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`${name} must be an integer.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${name} must be >= ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${name} must be <= ${options.max}.`);
  }
  return parsed;
}

function localIpv4ForStreaming(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal && address.address) {
        return address.address;
      }
    }
  }
  return null;
}

function kitHostFromEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value) return fallback;
  if (value.trim().toLowerCase() !== "auto") return value;
  return localIpv4ForStreaming() || fallback;
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
  if (!value) return withGeneratedSpectatorEndpoints([fallback]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} must be a JSON array; raw=${JSON.stringify(value)}; error=${message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array; raw=${JSON.stringify(value)}.`);
  }
  const endpoints = parsed
    .map((item, index) => endpointFromUnknown(item, index, fallback))
    .filter((endpoint): endpoint is KitInstanceEndpointConfig => endpoint !== null);
  if (endpoints.length === 0) {
    throw new Error(`${name} produced no valid Kit endpoints from raw=${JSON.stringify(value)}.`);
  }
  return withGeneratedSpectatorEndpoints(endpoints);
}

function endpointKey(endpoint: KitInstanceEndpointConfig): string {
  return `${endpoint.signalingServer}:${endpoint.signalingPort}:${endpoint.mediaServer}:${endpoint.mediaPort ?? ""}`;
}

function withGeneratedSpectatorEndpoints(endpoints: KitInstanceEndpointConfig[]): KitInstanceEndpointConfig[] {
  if (endpoints.length !== 1) return endpoints;

  const count = integerFromEnv(["KIT_SPECTATOR_COUNT"], 0, { min: 0, max: 32 });
  if (count === 0) return endpoints;

  const signalingStart = integerFromEnv(["KIT_SPECTATOR_SIGNALING_PORT_START"], 49110, { min: 1, max: 65535 });
  const mediaStart = integerFromEnv(
    ["KIT_SPECTATOR_MEDIA_PORT_START", "KIT_SPECTATOR_STREAM_PORT_START"],
    48008,
    { min: 1, max: 65535 },
  );
  const stride = integerFromEnv(["KIT_SPECTATOR_PORT_STRIDE"], 10, { min: 1, max: 1000 });
  const [primary] = endpoints;
  const used = new Set([endpointKey(primary)]);
  const usedSignalingPorts = new Set<number>([primary.signalingPort]);
  const usedMediaPorts = new Set<number>();
  if (primary.mediaPort !== null && primary.mediaPort !== undefined) {
    usedMediaPorts.add(primary.mediaPort);
  }
  const spectators: KitInstanceEndpointConfig[] = [];

  for (let index = 0; index < count; index += 1) {
    const signalingPort = signalingStart + index * stride;
    const mediaPort = mediaStart + index * stride;
    if (signalingPort > 65535 || mediaPort > 65535) {
      throw new Error("KIT_SPECTATOR_* generated a port outside 1-65535.");
    }
    if (usedSignalingPorts.has(signalingPort)) {
      throw new Error(`KIT_SPECTATOR_* generated a duplicate signaling port: ${signalingPort}.`);
    }
    if (usedMediaPorts.has(mediaPort)) {
      throw new Error(`KIT_SPECTATOR_* generated a duplicate media port: ${mediaPort}.`);
    }
    const endpoint: KitInstanceEndpointConfig = {
      id: `${primary.id}_spectator_${String(index + 1).padStart(2, "0")}`,
      signalingServer: primary.signalingServer,
      signalingPort,
      mediaServer: primary.mediaServer,
      mediaPort,
    };
    const key = endpointKey(endpoint);
    if (used.has(key)) {
      throw new Error("KIT_SPECTATOR_* generated a duplicate Kit endpoint.");
    }
    used.add(key);
    usedSignalingPorts.add(signalingPort);
    usedMediaPorts.add(mediaPort);
    spectators.push(endpoint);
  }

  return [...endpoints, ...spectators];
}

function conversionApiBaseFromEnv(): string {
  const streamingBase = process.env.STREAMING_CONVERSION_API_BASE;
  if (streamingBase) return streamingBase;

  const legacyBase = process.env.CONVERSION_API_BASE;
  if (!legacyBase) return DEFAULT_STREAMING_CONVERSION_API_BASE;
  return RETIRED_LEGACY_CONVERSION_API_BASES.has(legacyBase)
    ? DEFAULT_STREAMING_CONVERSION_API_BASE
    : legacyBase;
}

export function loadConfig(overrides: Partial<CoordinatorConfig> = {}): CoordinatorConfig {
  const cwd = process.cwd();
  const host = process.env.HOST || "127.0.0.1";
  const port = numberFromEnv("PORT", 8004);
  const publicHost = process.env.PUBLIC_HOST || "127.0.0.1";
  const viewerPublicBaseUrl =
    normalizePublicBaseUrl(process.env.VIEWER_PUBLIC_BASE_URL, "VIEWER_PUBLIC_BASE_URL") ||
    publicBaseUrlFromHost(publicHost, numberFromEnv("VIEWER_PORT", 5173));
  const coordinatorPublicBaseUrl =
    normalizePublicBaseUrl(process.env.COORDINATOR_PUBLIC_BASE_URL, "COORDINATOR_PUBLIC_BASE_URL") ||
    publicBaseUrlFromHost(publicHost, port);
  const kitStreamServer = kitHostFromEnv("KIT_STREAM_SERVER", "127.0.0.1");
  const kitSignalingPort = numberFromEnv("KIT_SIGNALING_PORT", 49100);
  const kitMediaServer = kitHostFromEnv("KIT_MEDIA_SERVER", kitStreamServer);
  const kitMediaPort = nullableNumberFromEnv("KIT_MEDIA_PORT");
  const defaultKitEndpoint: KitInstanceEndpointConfig = {
    id: "kit_local_001",
    signalingServer: kitStreamServer,
    signalingPort: kitSignalingPort,
    mediaServer: kitMediaServer,
    mediaPort: kitMediaPort,
  };
  return {
    host,
    port,
    coordinatorPublicBaseUrl,
    bimControlApiBase: process.env.BIM_CONTROL_API_BASE || "",
    conversionApiBase: conversionApiBaseFromEnv(),
    kitStreamServer,
    kitSignalingPort,
    kitMediaServer,
    kitMediaPort,
    kitInstanceEndpoints: kitInstanceEndpointsFromEnv("KIT_INSTANCE_ENDPOINTS", defaultKitEndpoint),
    devAuthToken: process.env.DEV_AUTH_TOKEN || "dev-token",
    sessionStoreDir: process.env.SESSION_STORE_DIR || path.join(cwd, "data", "sessions"),
    eventLogDir: process.env.EVENT_LOG_DIR || path.join(cwd, "data", "events"),
    corsOrigins: csvFromEnv("CORS_ORIGINS", uniqueStrings([
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      new URL(viewerPublicBaseUrl).origin,
    ])),
    internalApiAuthToken: process.env.INTERNAL_API_AUTH_TOKEN || "dev-internal-token",
    streamingConversionApiBase:
      process.env.STREAMING_CONVERSION_API_BASE || DEFAULT_STREAMING_CONVERSION_API_BASE,
    streamingConversionInternalToken:
      process.env.STREAMING_CONVERSION_INTERNAL_TOKEN || "",
    externalIntakeAuthProvider: process.env.EXTERNAL_INTAKE_AUTH_PROVIDER || "intranet-dev",
    externalIntakeWebhookSecret: process.env.EXTERNAL_INTAKE_WEBHOOK_SECRET || "dev-webhook-secret",
    externalIntakeIpAllowlist: csvFromEnv("EXTERNAL_INTAKE_IP_ALLOWLIST", [
      "127.0.0.1",
      "::1",
      "172.16.0.0/12",
    ]),
    cloudCallbackBaseUrl: process.env.CLOUD_CALLBACK_BASE_URL || "",
    callbackOutboxMaxAttempts: numberFromEnv("CALLBACK_OUTBOX_MAX_ATTEMPTS", 5),
    callbackOutboxStorePath:
      process.env.CALLBACK_OUTBOX_STORE_PATH ||
      path.join(cwd, "data", "callback-outbox.json"),
    userAuthProvider: process.env.USER_AUTH_PROVIDER || "local-dev",
    // fast-ifc-link-demo-loop §2.5:
    ifcDownloadTimeoutSeconds: numberFromEnv("IFC_DOWNLOAD_TIMEOUT_SECONDS", 600),
    storageRoot: process.env.STORAGE_ROOT || path.join(cwd, "storage"),
    storageHostRoot:
      process.env.STORAGE_HOST_ROOT || process.env.RUNTIME_STORAGE_ROOT || path.join(cwd, "storage"),
    publicHost,
    viewerPublicBaseUrl,
    // coordinator-auto-poll-streaming-conversion:default 啟用 polling;test fixture
    // 應在 loadConfig overrides 內傳 conversionPollEnabled: false。
    conversionPollEnabled: parseBooleanEnv("CONVERSION_POLL_ENABLED", true),
    conversionPollIntervalSeconds: numberFromEnv("CONVERSION_POLL_INTERVAL_SECONDS", 5),
    conversionPollMaxAttempts: numberFromEnv("CONVERSION_POLL_MAX_ATTEMPTS", 60),
    logRoot: process.env.LOG_ROOT || path.join(cwd, "logs"),
    ...overrides,
  };
}
