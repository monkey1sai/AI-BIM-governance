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
  conversionApiBase: string;
  kitManagerApiBase: string;
  kitStreamServer: string;
  kitSignalingPort: number;
  kitMediaServer: string;
  kitMediaPort: number | null;
  kitInstanceEndpoints: KitInstanceEndpointConfig[];
  devAuthToken: string;
  sessionStoreDir: string;
  eventLogDir: string;
  sessionIdleTimeoutMs?: number;
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
  // minio-closed-loop-phase1 Task 1：持久 ConversionLedger（coordinator-local shadow）
  // env CONVERSION_LEDGER_STORE_PATH；default data/conversion-ledger.json
  conversionLedgerStorePath: string;
  // edge artifact health：落地端 runtime data-plane metadata，不進雲端、不放 deploy checkout。
  edgeSiteId: string;
  edgeRuntimeDataRoot: string;
  // Host-native conversion artifacts as visible to this process. Docker uses
  // a dedicated read-only mount; host-local defaults to EDGE_RUNTIME_DATA_ROOT/artifacts.
  a4ConversionArtifactsRoot: string;
  // Same artifacts tree in the host-native governance process namespace.
  // Docker deploy injects an absolute Windows/Linux host path separately.
  a4ConversionArtifactsHostRoot: string;
  artifactHealthLedgerStorePath: string;
  // T7：使用者（local web view）auth provider，可替換；不做死 EZPLUS SSO，
  // local web view ↔ 公司 SSO 真實銜接待 OQ5。
  userAuthProvider: string;
  // fast-ifc-link-demo-loop §2.5:同步下載 IFC + viewer_url 組合 + shared volume 路徑
  ifcDownloadTimeoutSeconds: number;     // POST /api/external/ifc-ready 同步下載 timeout
  // production 設 true:strict 下 non-2xx IFC 回 502 不靜默 placeholder
  // (mapping fallbackOnFetchError: !ifcDownloadStrict);default false。
  ifcDownloadStrict: boolean;            // env IFC_DOWNLOAD_STRICT,default false
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
  // CH-E:React UnifiedConsole build(vite base=/ui/)的 dist 目錄。env CONSOLE_DIST_DIR;
  // default 空字串＝未設定 → /ui 回退既有 dev-console.html(zero-risk,不影響既有部署)。
  // 設定且目錄含 index.html 時,coordinator 於 /ui 服務 React console(static + SPA fallback)。
  consoleDistDir: string;
  // minio-watch-auto-intake（O4 觸發機制 B 案，預設關）：env opt-in 的 MinIO
  // ListObjectsV2 輪詢自動 intake。watcher 扮演本地自動化外部 IFC worker，
  // 自打 loopback POST /api/external/ifc-ready；既有 intake/去重/dispatch 契約零變動。
  minioWatchEnabled: boolean;            // MINIO_WATCH_ENABLED，default false
  minioWatchEndpoint: string;            // MINIO_WATCH_ENDPOINT，如 http://192.168.20.234:9000
  minioWatchBucket: string;              // MINIO_WATCH_BUCKET，如 bim-control
  minioWatchPrefix: string;              // MINIO_WATCH_PREFIX，default 空
  minioWatchAccessKey: string;           // MINIO_WATCH_ACCESS_KEY（唯讀帳號；不落 tracked 檔）
  minioWatchSecretKey: string;           // MINIO_WATCH_SECRET_KEY（同上）
  // MINIO_WATCH_INTERVAL_SECONDS，default 60，下限預設 10（可由 MINIO_WATCH_INTERVAL_FLOOR_SECONDS 降檔，僅供 E2E）
  minioWatchIntervalSeconds: number;
  minioWatchKeySuffix: string;           // MINIO_WATCH_KEY_SUFFIX，default /model.ifc（規約檔名）
  // watcher intake payload 的 tenant_id。env MINIO_WATCH_TENANT_ID，default tenant_demo_001
  // （維持現行為）。部署切 tenant 時必設此值，否則所有 watcher intake 會帶錯 tenant
  // （靜默資料污染進 store 與雲端 callback）。
  minioWatchTenantId: string;            // MINIO_WATCH_TENANT_ID，default tenant_demo_001
  // 測試 seam：watcher 自打 loopback 的 base url。default 空＝執行期用 http://127.0.0.1:${port}。
  // 整合測試以 listen(0) 取得實際 port 後注入完整 base，避免依賴固定 8004。
  minioWatchSelfBaseUrl: string;
  // ── rvt-ifc-usdc-lineage task 3.1（governed source bundle）─────────────────
  // 與上方 MINIO_WATCH_*（legacy watcher）是**兩套獨立設定**：design.md §11.2 規則 3
  // 要求 `mw_<hash16>` 與 `source_bundle_id` 兩個去重空間互不取代／抑制／推導，
  // 故 prefix、credentials、開關一律不共用 env（D-8）。
  // governed source bundle durable store。env SOURCE_BUNDLE_STORE_PATH；
  // default data/source-bundles.json（比照 conversionLedgerStorePath 的 <cwd>/data 慣例）。
  sourceBundleStorePath: string;
  // SOURCE_BUNDLE_SHA256_VERIFY_MODE：`full`（default，streaming 全量重算 SHA-256）或
  // `size_etag_only`（降檔門；此模式下 validator MUST 在 integrity_diagnostics 誠實標示
  // SHA-256 未重驗）。未知值 fail-fast，不靜默降檔（與 integerFromEnv 的 fail-fast 同風格）。
  sourceBundleSha256VerifyMode: "full" | "size_etag_only";
  // governed MinIO 連線（唯讀重驗用）。三者任一為空＝governed 端未設定 → route 一律 503。
  governedSourceMinioEndpoint: string;   // GOVERNED_SOURCE_MINIO_ENDPOINT
  governedSourceMinioAccessKey: string;  // GOVERNED_SOURCE_MINIO_ACCESS_KEY（不落 tracked 檔）
  governedSourceMinioSecretKey: string;  // GOVERNED_SOURCE_MINIO_SECRET_KEY（同上）
  // D-3 fail-closed allowlist：manifest locator 自帶 `minio://<authority>/<bucket>/…`，
  // 不在清單內的 authority／bucket 一律拒收（回 semantic_contract_violation）。
  // 空清單＝未設定＝governed 端視為未設定（fail-closed，不是「全部放行」）。
  governedSourceAuthorityAllowlist: string[];  // GOVERNED_SOURCE_AUTHORITY_ALLOWLIST（CSV）
  governedSourceBucketAllowlist: string[];     // GOVERNED_SOURCE_BUCKET_ALLOWLIST（CSV）
  // governed discovery prefix（reconciliation 與 legacy preview 用）。MUST NOT 重用
  // MINIO_WATCH_PREFIX。非空時 normalize 為以 '/' 結尾（同 watcher prefix 的 boundary 對齊理由）。
  governedSourcePrefix: string;          // GOVERNED_SOURCE_PREFIX
  /**
   * rvt-ifc-usdc-lineage task 3.4：artifact download 的 public target policy（單一 JSON
   * 陣列 env `LINEAGE_DOWNLOAD_TARGET_POLICIES`，形如
   * `[{"authority":"...","bucket":"...","public_origin":"https://...","object_path_prefix":"/<bucket>/"}]`）。
   *
   * 這裡刻意存**原始字串**而不是解析後的物件：config 是扁平的 env 快照，解析／驗證
   * 屬 composition root（`parseLineageArtifactDownloadTargetPolicies`），測試也因此能用
   * 與 operator 完全相同的輸入形式覆寫。
   *
   * 未設定＝空字串＝空清單＝**fail-closed**（沒有任何 bucket 可被簽章下載）。
   */
  lineageDownloadTargetPolicies: string; // LINEAGE_DOWNLOAD_TARGET_POLICIES
  // ── rvt-ifc-usdc-lineage task 3.2（durable stable pipeline job）───────────
  // governed pipeline job 的 durable store。env PIPELINE_JOB_STORE_PATH；
  // default data/pipeline-jobs.json（同 conversionLedgerStorePath 的 <cwd>/data 慣例）。
  // 與 sourceBundleStorePath 分檔：bundle（來源事實）與 job（編排狀態）是兩個
  // 生命週期不同的文件族，共檔會讓其中一邊的壞檔連坐另一邊。
  pipelineJobStorePath: string;
  // polling reconciliation（撿漏，非主要觸發面）。**預設關閉**，比照 MINIO_WATCH_ENABLED。
  // env 獨立命名（D-8）：MUST NOT 重用 MINIO_WATCH_*——legacy 的 `mw_<hash16>` 與
  // governed 的 `source_bundle_id` 是兩個 MUST NOT 互相取代／抑制／推導的去重空間。
  sourceBundleReconcileEnabled: boolean;   // SOURCE_BUNDLE_RECONCILE_ENABLED，default false
  // SOURCE_BUNDLE_RECONCILE_INTERVAL_MS，default 300000（5 分鐘），下限 5000。
  // 單位刻意用 ms（而非 watcher 的 seconds）：撿漏面的節奏與 watcher 無關，
  // 共用單位容易讓人以為兩者該設成同一個值。
  sourceBundleReconcileIntervalMs: number;
  // R8（2026-07-10）：local_fs 測試 fixtures 專案清單（如 270,889,990,271），由部署區 .env 注入；
  // default 空＝不標。前端據 GET /api/dev/test-data-projects 渲染「測試資料」badge——
  // 編號不進程式碼（D-05），誠實標記由後端 config 驅動（鐵律 #3）。
  testDataProjectIds: string[];
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

function optionalIntegerFromEnv(
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  return integerFromEnv([name], options.min ?? 1, options);
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

// rvt-ifc-usdc-lineage task 3.1：SHA-256 重驗深度只有兩個合法值（D-1）。
// 未設＝full（誠實預設）；設了但拼錯 → fail-fast，不靜默降檔成 size_etag_only 或 full
// （靜默降檔會讓 bundle_state="READY" 名不副實）。
function sha256VerifyModeFromEnv(): "full" | "size_etag_only" {
  const raw = process.env.SOURCE_BUNDLE_SHA256_VERIFY_MODE;
  if (raw === undefined || raw.trim() === "") return "full";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "full" || normalized === "size_etag_only") return normalized;
  throw new Error(
    "SOURCE_BUNDLE_SHA256_VERIFY_MODE must be 'full' or 'size_etag_only'.",
  );
}

// rvt-ifc-usdc-lineage task 3.2：reconciliation 輪詢下限（安全保護，防忙迴圈連打 MinIO）。
// 常數而非 env：撿漏面不需要為了 E2E 降到秒級（測試以 `pollNow()` 驅動），
// 少一個 env 就少一個「被調成 1ms 打爆 MinIO」的部署面。
const SOURCE_BUNDLE_RECONCILE_INTERVAL_FLOOR_MS = 5_000;

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
  // watcher 輪詢間隔下限（秒）。production 預設 10 防忙迴圈連打 MinIO；不設 env 時行為與舊版一致。
  // 唯一降檔入口：MINIO_WATCH_INTERVAL_FLOOR_SECONDS（如 E2E 起 spawn coordinator 需 ≤10s 輪詢驗證
  // 自動 intake 鏈時設為 1）。預設不設＝floor 10，故 config-minio-watch.test.ts 與生產皆維持夾為 10。
  // 守衛硬下限 1s：Math.max(1, …) 確保即使 FLOOR=0/負值也不會讓 minioWatchIntervalSeconds 降到 0，
  // 否則 minioWatcher 的 setTimeout(runTick, 0) 會每輪 tick 完成立即重排，形成 event-loop 忙迴圈連打 MinIO。
  const minioWatchIntervalFloor = Math.max(1, numberFromEnv("MINIO_WATCH_INTERVAL_FLOOR_SECONDS", 10));
  const host = process.env.HOST || "127.0.0.1";
  const port = numberFromEnv("PORT", 8004);
  const publicHost = process.env.PUBLIC_HOST || "127.0.0.1";
  const edgeRuntimeDataRoot = process.env.EDGE_RUNTIME_DATA_ROOT || cwd;
  const artifactHealthLedgerDefaultPath = process.env.EDGE_RUNTIME_DATA_ROOT
    ? path.join(edgeRuntimeDataRoot, "ledgers", "artifact-health-ledger.json")
    : path.join(cwd, "data", "artifact-health-ledger.json");
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
  const merged = {
    host,
    port,
    coordinatorPublicBaseUrl,
    conversionApiBase: conversionApiBaseFromEnv(),
    // CH-D：kit-manager-api base（forward-only proxy 用）。docker compose 顯式設 host.docker.internal:8010；
    // host-native 預設 127.0.0.1:8010。Kit 控制權威仍在 kit-manager（RK1）。
    kitManagerApiBase: process.env.KIT_MANAGER_API_BASE || "http://127.0.0.1:8010",
    kitStreamServer,
    kitSignalingPort,
    kitMediaServer,
    kitMediaPort,
    kitInstanceEndpoints: kitInstanceEndpointsFromEnv("KIT_INSTANCE_ENDPOINTS", defaultKitEndpoint),
    devAuthToken: process.env.DEV_AUTH_TOKEN || "dev-token",
    sessionStoreDir: process.env.SESSION_STORE_DIR || path.join(cwd, "data", "sessions"),
    eventLogDir: process.env.EVENT_LOG_DIR || path.join(cwd, "data", "events"),
    // session-lifecycle: fail closed until the deployment has a measured baseline.
    // Explicit values must be bounded positive integers; partial parse (for example
    // "300000ms"), fractions, zero, and unsafe values are configuration errors.
    sessionIdleTimeoutMs: optionalIntegerFromEnv("SESSION_IDLE_TIMEOUT_MS", {
      min: 1,
      max: 2_147_483_647,
    }),
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
    conversionLedgerStorePath:
      process.env.CONVERSION_LEDGER_STORE_PATH ||
      path.join(cwd, "data", "conversion-ledger.json"),
    edgeSiteId: process.env.EDGE_SITE_ID || "site_local_dev",
    edgeRuntimeDataRoot,
    a4ConversionArtifactsRoot:
      process.env.A4_CONVERSION_ARTIFACTS_ROOT || path.join(edgeRuntimeDataRoot, "artifacts"),
    a4ConversionArtifactsHostRoot:
      process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT || path.join(edgeRuntimeDataRoot, "artifacts"),
    artifactHealthLedgerStorePath:
      process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH ||
      artifactHealthLedgerDefaultPath,
    userAuthProvider: process.env.USER_AUTH_PROVIDER || "local-dev",
    // fast-ifc-link-demo-loop §2.5:
    ifcDownloadTimeoutSeconds: numberFromEnv("IFC_DOWNLOAD_TIMEOUT_SECONDS", 600),
    ifcDownloadStrict: parseBooleanEnv("IFC_DOWNLOAD_STRICT", false),
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
    // CH-E:未設定＝空字串 → mountDevConsole 回退 dev-console.html(zero-risk 預設)。
    consoleDistDir: process.env.CONSOLE_DIST_DIR || "",
    minioWatchEnabled: parseBooleanEnv("MINIO_WATCH_ENABLED", false),
    minioWatchEndpoint: process.env.MINIO_WATCH_ENDPOINT || "",
    minioWatchBucket: process.env.MINIO_WATCH_BUCKET || "",
    minioWatchPrefix: process.env.MINIO_WATCH_PREFIX || "",
    minioWatchAccessKey: process.env.MINIO_WATCH_ACCESS_KEY || "",
    minioWatchSecretKey: process.env.MINIO_WATCH_SECRET_KEY || "",
    minioWatchIntervalSeconds: Math.max(minioWatchIntervalFloor, numberFromEnv("MINIO_WATCH_INTERVAL_SECONDS", 60)),
    minioWatchKeySuffix: process.env.MINIO_WATCH_KEY_SUFFIX || "/model.ifc",
    minioWatchTenantId: process.env.MINIO_WATCH_TENANT_ID || "tenant_demo_001",
    minioWatchSelfBaseUrl: process.env.MINIO_WATCH_SELF_BASE_URL || "",
    testDataProjectIds: csvFromEnv("TEST_DATA_PROJECT_IDS", []),
    // rvt-ifc-usdc-lineage task 3.1（governed source bundle；與 MINIO_WATCH_* 完全分離）
    sourceBundleStorePath:
      process.env.SOURCE_BUNDLE_STORE_PATH || path.join(cwd, "data", "source-bundles.json"),
    sourceBundleSha256VerifyMode: sha256VerifyModeFromEnv(),
    governedSourceMinioEndpoint: process.env.GOVERNED_SOURCE_MINIO_ENDPOINT || "",
    governedSourceMinioAccessKey: process.env.GOVERNED_SOURCE_MINIO_ACCESS_KEY || "",
    governedSourceMinioSecretKey: process.env.GOVERNED_SOURCE_MINIO_SECRET_KEY || "",
    governedSourceAuthorityAllowlist: csvFromEnv("GOVERNED_SOURCE_AUTHORITY_ALLOWLIST", []),
    governedSourceBucketAllowlist: csvFromEnv("GOVERNED_SOURCE_BUCKET_ALLOWLIST", []),
    governedSourcePrefix: process.env.GOVERNED_SOURCE_PREFIX || "",
    lineageDownloadTargetPolicies: process.env.LINEAGE_DOWNLOAD_TARGET_POLICIES || "",
    // rvt-ifc-usdc-lineage task 3.2（durable stable pipeline job；env 與 MINIO_WATCH_* 分離）
    pipelineJobStorePath:
      process.env.PIPELINE_JOB_STORE_PATH || path.join(cwd, "data", "pipeline-jobs.json"),
    sourceBundleReconcileEnabled: parseBooleanEnv("SOURCE_BUNDLE_RECONCILE_ENABLED", false),
    sourceBundleReconcileIntervalMs: numberFromEnv("SOURCE_BUNDLE_RECONCILE_INTERVAL_MS", 300_000),
    ...overrides,
  };
  // 下限是安全保護（防忙迴圈連打 MinIO），必須在 overrides 合併後夾值，
  // 否則 loadConfig({minioWatchIntervalSeconds: 3}) 會繞過 env 路徑的 Math.max。
  // 預設 floor=10；唯一降檔入口為 MINIO_WATCH_INTERVAL_FLOOR_SECONDS（見上方註解）。
  merged.minioWatchIntervalSeconds = Math.max(minioWatchIntervalFloor, merged.minioWatchIntervalSeconds);
  // 非空 watch prefix normalize 為以 '/' 結尾（Codex review P2 修復）：deriveIntakeFromKey
  // 對非 boundary-aligned prefix 一律 fail-fast 拒收（防 `89` startsWith 命中 `899/...` 的
  // 靜默污染）。若 operator 設 `MINIO_WATCH_PREFIX=tenant_a`（無尾斜線）原值直通，watcher
  // 列得到物件卻全數 skipped_malformed（靜默無作為）。與 interval floor 同理：必須在
  // overrides 合併後 normalize，否則 loadConfig({minioWatchPrefix:"x"}) 繞過 env 路徑。
  // 空字串保持空（= watch 全 bucket）。
  if (merged.minioWatchPrefix && !merged.minioWatchPrefix.endsWith("/")) {
    merged.minioWatchPrefix = `${merged.minioWatchPrefix}/`;
  }
  // governed discovery prefix 同理（boundary-aligned）：`tenant_a` 不得靜默命中
  // `tenant_ab/…`。與 watch prefix 是**獨立**設定，只是共用同一條 normalize 規則。
  if (merged.governedSourcePrefix && !merged.governedSourcePrefix.endsWith("/")) {
    merged.governedSourcePrefix = `${merged.governedSourcePrefix}/`;
  }
  // reconciliation 間隔下限（防忙迴圈連打 MinIO）。與 minioWatchIntervalSeconds 同理，
  // 必須在 overrides 合併後才夾值，否則 loadConfig({sourceBundleReconcileIntervalMs: 1})
  // 會繞過 env 路徑的夾值。governed 側刻意**不**提供降檔 env：撿漏面沒有 E2E 需要
  // 秒級輪詢，測試一律用 `pollNow()` 驅動（比照 minioWatchSurface 的既有慣例）。
  merged.sourceBundleReconcileIntervalMs = Math.max(
    SOURCE_BUNDLE_RECONCILE_INTERVAL_FLOOR_MS,
    merged.sourceBundleReconcileIntervalMs,
  );
  // F2（2026-07-10）：production fail-fast——預設機密是原始碼常數（已知字串），
  // 部署漏設 env 時不得靜默沿用。與 integerFromEnv 的 fail-fast 風格一致；
  // dev（NODE_ENV 非 production）維持原預設行為，測試 overrides 注入自訂值即可通過。
  if (process.env.NODE_ENV === "production") {
    const defaultedSecrets: string[] = [];
    if (merged.devAuthToken === "dev-token") defaultedSecrets.push("DEV_AUTH_TOKEN");
    if (merged.internalApiAuthToken === "dev-internal-token") defaultedSecrets.push("INTERNAL_API_AUTH_TOKEN");
    if (merged.externalIntakeWebhookSecret === "dev-webhook-secret") defaultedSecrets.push("EXTERNAL_INTAKE_WEBHOOK_SECRET");
    if (defaultedSecrets.length > 0) {
      throw new Error(
        `NODE_ENV=production 下偵測到預設機密（原始碼常數），拒絕啟動。請設定：${defaultedSecrets.join(", ")}`,
      );
    }
  }
  if (!process.env.ARTIFACT_HEALTH_LEDGER_STORE_PATH && overrides.artifactHealthLedgerStorePath === undefined) {
    const finalEdgeRoot = merged.edgeRuntimeDataRoot;
    merged.artifactHealthLedgerStorePath =
      finalEdgeRoot === cwd
        ? path.join(cwd, "data", "artifact-health-ledger.json")
        : path.join(finalEdgeRoot, "ledgers", "artifact-health-ledger.json");
  }
  if (!process.env.A4_CONVERSION_ARTIFACTS_ROOT && overrides.a4ConversionArtifactsRoot === undefined) {
    merged.a4ConversionArtifactsRoot = path.join(merged.edgeRuntimeDataRoot, "artifacts");
  }
  if (!process.env.A4_CONVERSION_ARTIFACTS_HOST_ROOT && overrides.a4ConversionArtifactsHostRoot === undefined) {
    merged.a4ConversionArtifactsHostRoot = merged.a4ConversionArtifactsRoot;
  }
  return merged;
}
