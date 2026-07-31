import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { correlationIdFor, deriveIntakeFromKey, idempotencyKeyFor } from "../services/minioWatcher.js";

/**
 * a4-console-convergence Task 4.0：隔離 branch stack 的真實 IFC-ready seeding。
 *
 * 為什麼需要這支工具：`scripts/dev/start-isolated-branch-stack.ps1` 對 coordinator 明示
 * `MINIO_WATCH_ENABLED=false`，且 `EXTERNAL_IFC_READY_STORE_PATH` / `STORAGE_ROOT` 都綁 per-run
 * 目錄。隔離 stack 因此永遠沒有 `download_status="downloaded"` 的 job，`a4-closeout.spec.ts`
 * 的 preflight 會在開瀏覽器前就 fail（isolated-branch-stack-browser-e2e 記錄的 known gap）。
 *
 * 本工具「顯式重放一次 watcher tick」：list 真 MinIO → presign → 打同一條
 * `POST /api/external/ifc-ready` intake → coordinator 真的從 MinIO 下載 bytes 進 per-run storage。
 * 刻意複用 `minioWatcher` 的 `deriveIntakeFromKey` / `idempotencyKeyFor` / `correlationIdFor`
 * 而不自造一套：seed 與 watcher 產生同一組 idempotency key，日後若 operator 開啟 watcher，
 * 既有 seed job 會命中 idempotent replay 而不重複進件。
 *
 * 不做的事：不啟動 stack（launcher 的責任）、不跑轉檔（A4 deterministic 搜尋只需 IFC 本體，
 * `element_mapping` 在 `governance-service/search/engine.py` 為選用）、不改任何 A4 前後端實作。
 */

/** 測試部署區與 Kit 的保留 port：seed 一旦打中即 fail closed，不得污染部署區狀態。 */
export const RESERVED_DEPLOYMENT_PORTS: readonly number[] = [5173, 8004, 49100, 49102];

/** 隔離 stack 的 coordinator port＝8005 + offset，offset 僅允許 0..4。 */
export const ISOLATED_COORDINATOR_PORTS: readonly number[] = [8005, 8006, 8007, 8008, 8009];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * 只允許把 seed 打到隔離 stack 的 loopback coordinator。
 *
 * 檢查順序刻意固定：scheme → loopback host → port 存在 → 保留 port 明示拒絕 → 隔離範圍。
 * loopback 檢查必須早於範圍檢查，否則 `http://192.168.20.234:8005` 這種「port 合法但 host 是
 * LAN 真機」的輸入會被誤放行。
 */
export function assertIsolatedCoordinatorTarget(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`coordinator base 不是合法 URL：${baseUrl}`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`coordinator base 必須使用 http: scheme（收到 ${url.protocol}）；隔離 stack 只跑 loopback http。`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `coordinator base host 必須為 loopback（127.0.0.1 / localhost），收到 ${url.hostname}。` +
        `安全約束：seed 會夾帶 intake webhook secret，禁止送往非 loopback host。`,
    );
  }
  if (!url.port) {
    throw new Error(`coordinator base 必須明示 port（收到 ${baseUrl}）；未指定會落到預設 80 而非隔離 stack。`);
  }
  const port = Number(url.port);
  if (RESERVED_DEPLOYMENT_PORTS.includes(port)) {
    throw new Error(
      `port ${port} 屬於測試部署區／Kit 保留集合，seed 不得連線（保留集合：${RESERVED_DEPLOYMENT_PORTS.join(", ")}）。`,
    );
  }
  if (!ISOLATED_COORDINATOR_PORTS.includes(port)) {
    throw new Error(
      `port ${port} 不在隔離 stack coordinator 範圍（${ISOLATED_COORDINATOR_PORTS.join(", ")}＝8005+offset，offset 0..4）。`,
    );
  }
  return url;
}

export interface SeedObject {
  key: string;
  etag: string;
}

export interface SeedCandidate {
  key: string;
  etag: string;
  projectId: string;
  projectDisplayName: string;
  category: string;
  externalModelVersionId: string;
}

export interface SeedSkip {
  key: string;
  reason: string;
}

export type SelectSeedResult =
  | { ok: true; candidate: SeedCandidate; skipped: SeedSkip[] }
  | { ok: false; reason: string; skipped: SeedSkip[] };

function sortByKey(objects: SeedObject[]): SeedObject[] {
  // 明示 code-unit 排序而非 localeCompare：locale 相依的排序會讓同一 bucket 在不同機器上
  // 挑到不同物件，seed 出來的 job id 就不可重現，E2E 也無法固定 A4_E2E_IFC_READY_JOB_ID。
  return [...objects].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}

/**
 * 從 bucket 物件清單挑出唯一 seed 目標。
 *
 * 一律走訪全部物件（而非命中第一個就 break），因為 `skipped` 診斷是誠實揭露的一部分：
 * operator 需要看到「bucket 裡有幾個物件因為不合規約而沒被採用」，否則 seeding 挑錯物件時
 * 只會看到一個成功訊息，無從察覺 bucket 佈局已經漂移。
 */
export function selectSeedCandidate(input: {
  objects: SeedObject[];
  prefix: string;
  keySuffix: string;
  requiredKey?: string;
}): SelectSeedResult {
  const { objects, prefix, keySuffix, requiredKey } = input;
  const skipped: SeedSkip[] = [];
  const candidates: SeedCandidate[] = [];

  for (const object of sortByKey(objects)) {
    const derived = deriveIntakeFromKey({ key: object.key, prefix, keySuffix });
    if (!derived.ok) {
      skipped.push({ key: object.key, reason: derived.reason });
      continue;
    }
    candidates.push({
      key: object.key,
      etag: object.etag,
      projectId: derived.projectId,
      projectDisplayName: derived.projectDisplayName,
      category: derived.category,
      externalModelVersionId: derived.externalModelVersionId,
    });
  }

  if (requiredKey) {
    const pinned = candidates.find(candidate => candidate.key === requiredKey);
    if (!pinned) {
      const skippedReason = skipped.find(entry => entry.key === requiredKey)?.reason;
      return {
        ok: false,
        skipped,
        reason: skippedReason
          ? `指定的 key 存在但不可導出：${requiredKey}（${skippedReason}）`
          : `指定的 key 不在 bucket 可導出物件中：${requiredKey}`,
      };
    }
    return { ok: true, candidate: pinned, skipped };
  }

  const first = candidates[0];
  if (!first) {
    return {
      ok: false,
      skipped,
      reason:
        `bucket 內沒有可導出的 IFC-ready 物件（檢視 ${objects.length} 個 key，全部略過）。` +
        `規約：{prefix}{專案}/…/{種類}/{版本}${keySuffix}，去 prefix/suffix 後須 ≥3 段。`,
    };
  }
  return { ok: true, candidate: first, skipped };
}

export interface SeedIntakeBody {
  event: "ifc_ready";
  tenant_id: string;
  project_id: string;
  project_display_name: string;
  model_category: string;
  external_model_version_id: string;
  external_conversion_task_id: string;
  source_ifc: { ref: string; etag: string; filename: string; format: string };
  requested_outputs: string[];
}

export interface SeedIntakeRequest {
  body: SeedIntakeBody;
  idempotencyKey: string;
  correlationId: string;
}

/**
 * 組出與 `minioWatcher` triggerIntake 逐欄同形的 intake payload。
 *
 * 同形是硬需求而非美學：intake 的去重、ledger hash 與下游 dispatch 都吃這組欄位，
 * seed 若自造一套 `external_conversion_task_id` 或 idempotency key，watcher 之後掃到同一物件
 * 會被視為新進件而重複轉檔。
 */
export function buildSeedIntakeRequest(input: {
  bucket: string;
  key: string;
  etag: string;
  presignedRef: string;
  tenantId: string;
  prefix: string;
  keySuffix: string;
}): SeedIntakeRequest {
  const { bucket, key, etag, presignedRef, tenantId, prefix, keySuffix } = input;
  const derived = deriveIntakeFromKey({ key, prefix, keySuffix });
  if (!derived.ok) {
    throw new Error(`key 不可導出為 intake 欄位：${derived.reason}`);
  }
  const etagClean = derived.sourceEtagFrom(etag);
  return {
    idempotencyKey: idempotencyKeyFor(bucket, key, etag),
    correlationId: correlationIdFor(bucket, key, etag),
    body: {
      event: "ifc_ready",
      tenant_id: tenantId,
      project_id: derived.projectId,
      project_display_name: derived.projectDisplayName,
      model_category: derived.category,
      external_model_version_id: derived.externalModelVersionId,
      external_conversion_task_id: `${derived.externalModelVersionId}_mw_${etagClean.slice(0, 8)}`,
      source_ifc: { ref: presignedRef, etag: etagClean, filename: "model.ifc", format: "ifc" },
      requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
    },
  };
}

export interface SeedEvidenceRecord {
  schema_version: "a4-isolated-seed-result/v1";
  change_id: string;
  run_id: string;
  coordinator_base_url: string;
  source_chain: "real_minio_presigned_intake";
  source: {
    endpoint: string;
    bucket: string;
    key: string;
    etag: string;
    presigned_ref_redacted: true;
  };
  ifc_ready_job_id: string;
  download_status: string;
  idempotency_key: string;
  correlation_id: string;
  disclosure: string[];
}

/**
 * 產出可進 evidence 目錄的 seed 結果。
 *
 * 刻意收下 `presignedRef` 與 `webhookSecret` 卻不寫進 record：呼叫端手上就是這兩個敏感值，
 * 由本函式集中決定「不外吐」，並讓 redaction 可被測試直接斷言，而不是散在各呼叫點各自小心。
 */
export function buildSeedEvidenceRecord(input: {
  changeId: string;
  runId: string;
  coordinatorBaseUrl: string;
  bucket: string;
  endpoint: string;
  key: string;
  etag: string;
  /** 僅用於明示「已知悉但不記錄」；不會出現在回傳結果。 */
  presignedRef: string;
  /** 同上；不會出現在回傳結果。 */
  webhookSecret: string;
  ifcReadyJobId: string;
  downloadStatus: string;
  idempotencyKey: string;
  correlationId: string;
}): SeedEvidenceRecord {
  return {
    schema_version: "a4-isolated-seed-result/v1",
    change_id: input.changeId,
    run_id: input.runId,
    coordinator_base_url: input.coordinatorBaseUrl,
    source_chain: "real_minio_presigned_intake",
    source: {
      endpoint: input.endpoint,
      bucket: input.bucket,
      key: input.key,
      etag: input.etag.replace(/^"+|"+$/g, ""),
      presigned_ref_redacted: true,
    },
    ifc_ready_job_id: input.ifcReadyJobId,
    download_status: input.downloadStatus,
    idempotency_key: input.idempotencyKey,
    correlation_id: input.correlationId,
    disclosure: [
      "IFC bytes 由 coordinator 自真實 MinIO 經 presigned GET 下載，非 fixture 複製、非偽造記錄。",
      "presigned 簽章與 intake webhook secret 一律不寫入本檔。",
      "本 seed 不執行轉檔；conversion_status 仍可能為未轉檔狀態。",
      "本 seed 僅證明 IFC-ready intake 鏈；不得據以推論 design gate／deploy path／Kit-WebRTC runtime。",
    ],
  };
}

export interface SeedCliArgs {
  coordinatorBaseUrl: string;
  changeId: string;
  runId: string;
  requiredKey?: string;
  outPath?: string;
  envFile?: string;
}

/**
 * CLI 參數解析（純函式，與行程副作用分離以便直接測試）。
 *
 * 支援 `--flag value` 與 `--flag=value` 兩式：wrapper 用前者、手動除錯常用後者。
 */
export function parseSeedCliArgs(argv: string[]): SeedCliArgs {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq > -1) {
      map.set(token.slice(2, eq), token.slice(eq + 1));
    } else {
      map.set(token.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }
  const coordinatorBaseUrl = map.get("coordinator-base-url") ?? "";
  const changeId = map.get("change-id") ?? "";
  const runId = map.get("run-id") ?? "";
  const missing = [
    ["--coordinator-base-url", coordinatorBaseUrl],
    ["--change-id", changeId],
    ["--run-id", runId],
  ].filter(([, value]) => !value).map(([flag]) => flag);
  if (missing.length > 0) {
    throw new Error(`缺少必要參數：${missing.join(", ")}`);
  }
  return {
    coordinatorBaseUrl,
    changeId,
    runId,
    requiredKey: map.get("required-key") || undefined,
    outPath: map.get("out") || undefined,
    envFile: map.get("env-file") || undefined,
  };
}

export interface ResolvedSeedEnv {
  endpoint: string;
  bucket: string;
  prefix: string;
  keySuffix: string;
  accessKey: string;
  secretKey: string;
  tenantId: string;
  webhookSecret: string;
}

/**
 * 從 env 解析 MinIO 連線設定。
 *
 * 空字串與未設定同樣視為缺漏：`bim-review-coordinator/.env` 實際會把 `MINIO_WATCH_*` 這組 key
 * 宣告成空值（未配置真憑證的機器），若只檢查 `undefined`，S3 client 會拿空 bucket 送出請求，
 * 錯誤訊息變成難以追查的 `No value provided for input HTTP label: Bucket`。
 */
export function resolveSeedEnv(env: NodeJS.ProcessEnv): ResolvedSeedEnv {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) {
      throw new Error(
        `缺少必要環境變數 ${name}（值未設定或為空）。隔離 stack seeding 需要真實 MinIO 連線設定；` +
          `worktree 內沒有 untracked 的 .env，請以 --env-file 指向可用的設定檔。`,
      );
    }
    return value;
  };
  return {
    endpoint: required("MINIO_WATCH_ENDPOINT"),
    bucket: required("MINIO_WATCH_BUCKET"),
    prefix: env.MINIO_WATCH_PREFIX ?? "",
    keySuffix: env.MINIO_WATCH_KEY_SUFFIX || "/model.ifc",
    accessKey: required("MINIO_WATCH_ACCESS_KEY"),
    secretKey: required("MINIO_WATCH_SECRET_KEY"),
    tenantId: env.MINIO_WATCH_TENANT_ID || "tenant_demo_001",
    webhookSecret: env.EXTERNAL_INTAKE_WEBHOOK_SECRET || "dev-webhook-secret",
  };
}

export interface SeedRunOptions {
  coordinatorBaseUrl: string;
  endpoint: string;
  bucket: string;
  prefix: string;
  keySuffix: string;
  accessKey: string;
  secretKey: string;
  tenantId: string;
  webhookSecret: string;
  changeId: string;
  runId: string;
  requiredKey?: string;
  presignExpiresInSeconds?: number;
  /** POST intake 含同步 IFC 下載；預設對齊 coordinator 600s download timeout + 5s 緩衝。 */
  intakeTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** 測試注入點；預設用全域 fetch。 */
  fetchImpl?: typeof fetch;
  /** 測試注入點；預設依 endpoint/credentials 自建 path-style client。 */
  s3Client?: S3Client;
  sleepImpl?: (ms: number) => Promise<void>;
  logger?: (message: string) => void;
}

interface IntakeResponseShape {
  ifc_ready_job_id?: string;
  download_status?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 建立 intake request，集中落實 secret-bearing request 的 fail-closed transport 約束。
 *
 * `redirect: "error"` 不只是防禦性選項：307/308 會保留 POST body，而 body 含 presigned
 * MinIO URL、headers 含 webhook secret。即使初始 target 已驗為 loopback，也不能允許 loopback
 * response 把這些值 redirect 到另一個 origin。
 */
export function buildSeedIntakeFetchInit(input: {
  intake: SeedIntakeRequest;
  webhookSecret: string;
  timeoutMs: number;
}): RequestInit {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error(`intake timeout 必須是正數毫秒（收到 ${input.timeoutMs}）`);
  }
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": input.webhookSecret,
      "X-Correlation-Id": input.intake.correlationId,
      "X-Idempotency-Key": input.intake.idempotencyKey,
    },
    body: JSON.stringify(input.intake.body),
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs),
  };
}

async function listAllObjects(client: S3Client, bucket: string, prefix: string): Promise<SeedObject[]> {
  const out: SeedObject[] = [];
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: continuationToken }),
    );
    for (const object of response.Contents ?? []) {
      if (object.Key) out.push({ key: object.Key, etag: object.ETag ?? "" });
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return out;
}

/**
 * 對隔離 stack 執行一次真實 MinIO → intake → 下載完成的 seeding，回傳可落檔的 evidence。
 *
 * 逾時語意：intake 本身是同步下載（coordinator 在 202 前就下載完），poll 只是對
 * `GET /api/external/ifc-ready/:jobId` 再確認一次 `download_status`，避免把 202 當成
 * 「一定 downloaded」的推論——replay 路徑會回 200 且狀態可能是既有 job 的舊狀態。
 */
export async function runSeed(options: SeedRunOptions): Promise<SeedEvidenceRecord> {
  const target = assertIsolatedCoordinatorTarget(options.coordinatorBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;
  const log = options.logger ?? ((message: string) => console.log(message));
  const client =
    options.s3Client
    ?? new S3Client({
      endpoint: options.endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });

  const objects = await listAllObjects(client, options.bucket, options.prefix);
  log(`[seed] MinIO ${options.endpoint}/${options.bucket} 列出 ${objects.length} 個物件`);

  const selection = selectSeedCandidate({
    objects,
    prefix: options.prefix,
    keySuffix: options.keySuffix,
    requiredKey: options.requiredKey,
  });
  if (!selection.ok) {
    throw new Error(`seed 目標選取失敗：${selection.reason}`);
  }
  const candidate = selection.candidate;
  log(`[seed] 採用 key=${candidate.key}（略過 ${selection.skipped.length} 個不合規約物件）`);

  const presignedRef = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: options.bucket, Key: candidate.key }),
    { expiresIn: options.presignExpiresInSeconds ?? 3600 },
  );

  const intake = buildSeedIntakeRequest({
    bucket: options.bucket,
    key: candidate.key,
    etag: candidate.etag,
    presignedRef,
    tenantId: options.tenantId,
    prefix: options.prefix,
    keySuffix: options.keySuffix,
  });

  const response = await fetchImpl(
    new URL("/api/external/ifc-ready", target).toString(),
    buildSeedIntakeFetchInit({
      intake,
      webhookSecret: options.webhookSecret,
      timeoutMs: options.intakeTimeoutMs ?? 605_000,
    }),
  );
  const text = await response.text();
  if (response.status >= 400) {
    // 誠實鐵律：intake 失敗訊息可能夾帶 source_ifc_ref，截斷並不回吐 presigned 簽章。
    throw new Error(`intake 失敗 HTTP ${response.status}：${text.replace(/X-Amz-[^&\s"]+/g, "[redacted]").slice(0, 200)}`);
  }
  let parsed: IntakeResponseShape;
  try {
    parsed = JSON.parse(text || "{}") as IntakeResponseShape;
  } catch {
    throw new Error(`intake 回應非 JSON（HTTP ${response.status}）`);
  }
  const jobId = parsed.ifc_ready_job_id;
  if (!jobId) {
    throw new Error(`intake 回應缺少 ifc_ready_job_id（HTTP ${response.status}）`);
  }
  log(`[seed] intake 已受理 job=${jobId}（HTTP ${response.status}）`);

  const pollTimeoutMs = options.pollTimeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + pollTimeoutMs;
  let downloadStatus = parsed.download_status ?? "unknown";
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`等待 download_status=downloaded 逾時（job=${jobId}，最後狀態 ${downloadStatus}）`);
    }
    const detail = await fetchImpl(
      new URL(`/api/external/ifc-ready/${encodeURIComponent(jobId)}`, target).toString(),
      {
        redirect: "error",
        // 單次 GET 也不得超過整體 poll deadline；否則一個掛住的 response 會使 timeout 失效。
        signal: AbortSignal.timeout(remainingMs),
      },
    );
    if (detail.ok) {
      const job = (await detail.json()) as IntakeResponseShape;
      downloadStatus = job.download_status ?? downloadStatus;
      if (downloadStatus === "downloaded") break;
      if (downloadStatus === "failed") throw new Error(`IFC 下載失敗：job=${jobId} download_status=failed`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待 download_status=downloaded 逾時（job=${jobId}，最後狀態 ${downloadStatus}）`);
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  log(`[seed] job=${jobId} download_status=downloaded`);

  return buildSeedEvidenceRecord({
    changeId: options.changeId,
    runId: options.runId,
    coordinatorBaseUrl: target.origin,
    bucket: options.bucket,
    endpoint: options.endpoint,
    key: candidate.key,
    etag: candidate.etag,
    presignedRef,
    webhookSecret: options.webhookSecret,
    ifcReadyJobId: jobId,
    downloadStatus,
    idempotencyKey: intake.idempotencyKey,
    correlationId: intake.correlationId,
  });
}
