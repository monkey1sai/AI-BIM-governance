import type { AnomalyData } from "../lib/structLog.js";
import {
  assertBoundaryAlignedKeySuffix,
  assertLoopbackSelfBaseUrl,
  correlationIdFor,
  deriveIntakeFromKey,
  idempotencyKeyFor,
  stripEtagQuotes,
  type MinioWatcherStatus,
} from "./minioWatcher.js";
import { createS3ObjectStore, type ObjectStorePort } from "./minioObjectStore.js";

/**
 * MinIO Watch Surface（CONTEXT.md 詞條）：coordinator 對 governed MinIO bucket 的
 * deep module——watcher loop 生命週期與 runtime toggle、object key → intake 導出、
 * ConversionLedger 冪等水印、loopback auto-intake dispatch 與 dirty-event 通知。
 * 不擁有 intake 收件決策（IfcReadyConversionPipeline）與 conversion authority。
 *
 * 測試驅動原語是 {@link MinioWatchSurface.pollNow}：與 auto tick 共用同一條 promise
 * 鏈序列化（維持「tick 永不並發」不變量），resolve 時該輪 list／intake POST／counters
 * 全部落定——呼叫端可同步斷言，不需輪詢計數器（取代舊 minio-watcher-loop.test.ts 的
 * waitFor「觀測契約」；該競態類別在此介面形狀下結構性不存在）。
 *
 * PR 分段（2026-07-30 grilling 共識）：本檔為 PR1（watcher 核心＋toggle＋status）。
 * folder browse／cache／SSE fan-out／手動 trigger 仍在 app.ts，PR2 收入本 surface；
 * 過渡期間以 onObjectObserved callback 跨 seam 通知 cache invalidation。
 */

// 最小 structLog 介面（避免 import app 造成循環依賴；只 type-only import AnomalyData）。
// 與舊 minioWatcher.ts 同款：anomaly fields 用真實 AnomalyData 使真 StructLogger 可賦值。
export interface WatchSurfaceLogger {
  anomaly: (op: string, msg: string, fields: AnomalyData) => void;
  withTraceId?: (id: string) => { anomaly: WatchSurfaceLogger["anomaly"] };
}

/** 關閉態 status payload（與既有 route JSON 逐位元組一致；欄位順序由物件字面值固定）。 */
export interface MinioWatchDisabledStatus {
  enabled: boolean;
  bucket?: string | null;
  prefix?: string | null;
  interval_seconds?: number;
  note: string;
}

export type MinioWatchStatusView = MinioWatcherStatus | MinioWatchDisabledStatus;

export type WatchToggleOutcome =
  | { ok: true; noop: boolean }
  | { ok: false; code: "not_configured" }
  | { ok: false; code: "busy" }
  | { ok: false; code: "start_failed"; message: string };

/** 單一物件在一輪 tick 中的處置（triggerIntake 三態 + 兩種 skip 前置態）。 */
export interface TickOutcome {
  key: string;
  outcome: "triggered" | "skip_permanent" | "fail_transient" | "skip_seen" | "skip_ledgered";
  job_id: string | null;
  error: string | null;
}

export interface TickSummary {
  /** false = 這輪沒跑（watcher 未啟用/未啟動）；reason 說明原因。 */
  ran: boolean;
  reason?: "disabled" | "not_started";
  /** list 失敗時整輪中止：error 帶訊息、outcomes 為空（與 status.last_error 同值）。 */
  error?: string;
  listed_count: number;
  matched_count: number;
  outcomes: TickOutcome[];
}

export interface MinioWatchSurfaceOptions {
  config: {
    /** env opt-in 初值（runtime flag 可被 setEnabled 覆寫）。 */
    enabled: boolean;
    endpoint: string;
    bucket: string;
    prefix: string;
    accessKey: string;
    secretKey: string;
    keySuffix: string;
    intervalSeconds: number;
    /** 空字串 = 用 resolveSelfBaseUrl()（production 綁定 port）；非空 = 測試注入。 */
    selfBaseUrl: string;
    tenantId: string;
    intakeTimeoutMs?: number;
  };
  webhookSecret: string;
  /** §3.4 auto-enroll：持久 ledger 去重水印（權威去重；in-memory seen 僅單實例快取）。 */
  isLedgered: (idkey: string) => boolean;
  /** dirty signal：第一次看到 (key, etag) 時通知上層 folder cache/SSE（PR2 內化）。 */
  onObjectObserved?: (event: {
    bucket: string;
    key: string;
    etag: string;
    idempotency_key: string;
    at: string;
  }) => void;
  /** production 讀 server.address() 的實際 listen port（config.selfBaseUrl 空時使用）。 */
  resolveSelfBaseUrl: () => string;
  /**
   * 啟動 fail-fast 守衛（EXTERNAL_INTAKE_IP_ALLOWLIST 缺 loopback → throw）。由 app.ts
   * 注入以重用 authProvider.isIpAllowed，避免判定分歧；surface 在每次冷啟前呼叫。
   */
  assertIntakeReachable: () => void;
  /** seam：測試注入 in-memory fake；省略 = production 真 S3 adapter。每次冷啟建新實例。 */
  objectStoreFactory?: (cfg: { endpoint: string; bucket: string; accessKey: string; secretKey: string }) => ObjectStorePort;
  structLog: WatchSurfaceLogger;
}

export interface MinioWatchSurface {
  /** 連線參數齊全判斷（endpoint/bucket/accessKey/secretKey 四欄全檢）。 */
  configured(): boolean;
  /**
   * 冷啟（idempotent）：runtime flag 開且尚無 run 時建立 watcher loop。兩條啟動路徑
   * （server "listening" 事件、selfBaseUrl 已設的立即路徑）共用單一 run guard 防雙 watcher。
   * 啟動守衛（SSRF loopback / keySuffix boundary / intake allowlist）失敗即 throw。
   */
  startIfEnabled(): void;
  /** runtime toggle。busy 鎖內含；HTTP 語意映射（409/422/500）由 route 層負責。 */
  setEnabled(enabled: boolean): Promise<WatchToggleOutcome>;
  /** status 投影（GET status 與 PUT toggle 共用同一邏輯，避免兩處分歧）。 */
  status(): MinioWatchStatusView;
  /**
   * 確定性驅動：等前一輪 tick settle 後立刻跑一輪完整 tick，resolve 時該輪全部效應
   * （含 intake 回應解析與 counters 寫入）已落定。與 auto tick 共用序列化鏈，永不並發。
   */
  pollNow(): Promise<TickSummary>;
  /** 停止 loop 並釋放資源：await in-flight tick settle（2s 上限）後 destroy object store。 */
  dispose(): Promise<void>;
}

/** 每次冷啟一個 run：fresh counters/seen/observed（與舊 startMinioWatcher 每次新 handle 同語意）。 */
interface WatchRun {
  store: ObjectStorePort;
  selfBaseUrl: string;
  status: MinioWatcherStatus;
  seen: Map<string, string>; // key → etag（單輪/跨輪快取；權威去重以持久 ledger 為準）
  observed: Map<string, string>; // key → etag（dirty signal 去重；不影響 intake 重試語意）
  isFirstRound: boolean;
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** tick 序列化鏈：auto tick 與 pollNow 都經此 enqueue，維持「永不並發」不變量。 */
  chain: Promise<void>;
}

export function createMinioWatchSurface(opts: MinioWatchSurfaceOptions): MinioWatchSurface {
  const cfg = opts.config;
  // intake POST 逾時：未設或 ≤0 時用 10s 預設（防 watcher 因 app 不回應而凍結）。
  const intakeTimeoutMs = cfg.intakeTimeoutMs && cfg.intakeTimeoutMs > 0 ? cfg.intakeTimeoutMs : 10_000;
  const storeFactory = opts.objectStoreFactory ?? createS3ObjectStore;

  function configured(): boolean {
    return Boolean(cfg.endpoint && cfg.bucket && cfg.accessKey && cfg.secretKey);
  }

  // 誠實區分「env opt-in 但連線參數不完整」：runtime flag 壓回 false + note 專句。
  const startupConfigError = cfg.enabled && !configured()
    ? "MINIO_WATCH_ENABLED=true but endpoint/bucket/credentials are incomplete"
    : "";
  // runtime toggle 真相。初值 = env opt-in；setEnabled 在 runtime 覆寫。
  let runtimeEnabled = cfg.enabled && !startupConfigError;
  // toggle 同步鎖：dispose 為 async（2s cap），防並發 setEnabled 在 await 期間交錯啟兩個 run。
  let toggleBusy = false;
  let run: WatchRun | null = null;

  function recordTriggered(r: WatchRun, key: string, jobId: string | null, error: string | null): void {
    r.status.last_triggered.unshift({ key, job_id: jobId, error, at: new Date().toISOString() });
    r.status.last_triggered = r.status.last_triggered.slice(0, 5);
  }

  // triggerIntake 三態（語意沿舊 minioWatcher.ts 逐條保留）：
  // - "triggered"：intake 成功（含 idempotent_replay）→ 標 seen，之後同 etag 不再觸發。
  // - "skip_permanent"：malformed key 或 failed-job replay → 確定性結果，標 seen 停止重試。
  // - "fail_transient"：presign / 網路 / 逾時 / HTTP error / 2xx 非 JSON → 不標 seen，
  //   下輪重試（自癒）；idempotency key 確定性導出，重試命中既有去重不重複建 job。
  async function triggerIntake(r: WatchRun, key: string, etag: string): Promise<TickOutcome> {
    const derived = deriveIntakeFromKey({ key, prefix: cfg.prefix, keySuffix: cfg.keySuffix });
    if (!derived.ok) {
      r.status.skipped_malformed_total += 1;
      return { key, outcome: "skip_permanent", job_id: null, error: null };
    }
    // presign 失敗只屬「此物件」失敗：記入 recordTriggered 後返回，不向上浮到 tick 外層
    // catch——否則會覆蓋整輪 last_error 並中斷同輪其餘物件的觸發。
    let presignedRef: string;
    try {
      presignedRef = await r.store.presign(key, 3600);
    } catch (err) {
      const msg = `presign failed: ${err instanceof Error ? err.message : String(err)}`;
      recordTriggered(r, key, null, msg);
      return { key, outcome: "fail_transient", job_id: null, error: msg };
    }
    const idemKey = idempotencyKeyFor(cfg.bucket, key, etag);
    const corrId = correlationIdFor(cfg.bucket, key, etag);
    const etagShort = derived.sourceEtagFrom(etag).slice(0, 8);
    const body = {
      event: "ifc_ready",
      tenant_id: cfg.tenantId,
      project_id: derived.projectId,
      // 種類(倒數二層)與專案原名(中文如實顯示)隨進件傳遞；可保存為 coordinator-local
      // display hints，但不構成外部 metadata authority（R5 / local-artifact-shadow-metadata）。
      project_display_name: derived.projectDisplayName,
      model_category: derived.category,
      external_model_version_id: derived.externalModelVersionId,
      external_conversion_task_id: `${derived.externalModelVersionId}_mw_${etagShort}`,
      source_ifc: {
        ref: presignedRef,
        etag: derived.sourceEtagFrom(etag),
        filename: "model.ifc",
        format: "ifc",
      },
      requested_outputs: ["usdc", "element_mapping", "entity_index", "metadata"],
    };
    try {
      const resp = await fetch(`${r.selfBaseUrl}/api/external/ifc-ready`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": opts.webhookSecret,
          "X-Correlation-Id": corrId,
          "X-Idempotency-Key": idemKey,
        },
        body: JSON.stringify(body),
        // app 死鎖/過載長時不回時逾時中斷，避免 tick 無限 await 凍結整個 loop。
        signal: AbortSignal.timeout(intakeTimeoutMs),
      });
      const text = await resp.text();
      if (resp.status >= 400) {
        const msg = `intake ${resp.status}: ${text.slice(0, 120)}`;
        recordTriggered(r, key, null, msg);
        return { key, outcome: "fail_transient", job_id: null, error: msg };
      }
      // JSON.parse 失敗（2xx 但非 JSON，如代理錯誤頁）會 throw 進下方 catch → fail_transient。
      const parsed = JSON.parse(text || "{}") as {
        ifc_ready_job_id?: string;
        download_status?: string;
      };
      // failed-replay 誠實化：intake 對同 idempotency key 的 replay 不重下載也不重派工。
      // 2xx 回的是 download 已失敗的既有 job → 每輪重試永遠拿同一筆失敗 replay，不會自癒。
      // 標 seen 停止無效重試，失敗誠實記入 last_triggered（帶 job_id；不計 triggered_total）。
      if (parsed.download_status === "failed") {
        const msg = "intake replay: download_status=failed（job 已建、#/conv 可見；replay 不重下載，watcher 停止重試）";
        recordTriggered(r, key, parsed.ifc_ready_job_id ?? null, msg);
        return { key, outcome: "skip_permanent", job_id: parsed.ifc_ready_job_id ?? null, error: msg };
      }
      r.status.triggered_total += 1; // idempotent_replay 也計為觸發（誠實統計），不重複建 job 由 store 保證
      recordTriggered(r, key, parsed.ifc_ready_job_id ?? null, null);
      return { key, outcome: "triggered", job_id: parsed.ifc_ready_job_id ?? null, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      recordTriggered(r, key, null, msg);
      return { key, outcome: "fail_transient", job_id: null, error: msg };
    }
  }

  async function tick(r: WatchRun): Promise<TickSummary> {
    if (r.stopped) return { ran: false, reason: "not_started", listed_count: 0, matched_count: 0, outcomes: [] };
    const summary: TickSummary = { ran: true, listed_count: 0, matched_count: 0, outcomes: [] };
    try {
      const listed = await r.store.listObjects(cfg.prefix);
      const objects = listed.filter((o) => o.key.endsWith(cfg.keySuffix));
      summary.listed_count = listed.length;
      summary.matched_count = objects.length;
      r.status.last_poll_at = new Date().toISOString();
      r.status.poll_count += 1; // 單調遞增：list 成功即計一輪（loop liveness 判斷，免時鐘解析度依賴）
      r.status.last_error = null;
      // baseline_count（純診斷）：首輪符合 key 結構規約的 `*/model.ifc` 數；不 gate 觸發。
      if (r.isFirstRound) {
        r.status.baseline_count = objects.reduce(
          (count, object) =>
            count +
            (deriveIntakeFromKey({ key: object.key, prefix: cfg.prefix, keySuffix: cfg.keySuffix }).ok ? 1 : 0),
          0,
        );
        r.isFirstRound = false;
      }
      // §3.4：對每個 `*/model.ifc` 算 idkey 查持久 ledger 水印——無紀錄→觸發、有紀錄→skip。
      for (const o of objects) {
        if (r.seen.get(o.key) === o.etag) {
          summary.outcomes.push({ key: o.key, outcome: "skip_seen", job_id: null, error: null });
          continue; // 本實例已處理過此 (key,etag)
        }
        const idkey = idempotencyKeyFor(cfg.bucket, o.key, o.etag);
        if (r.observed.get(o.key) !== o.etag) {
          r.observed.set(o.key, o.etag);
          opts.onObjectObserved?.({
            bucket: cfg.bucket,
            key: o.key,
            etag: stripEtagQuotes(o.etag),
            idempotency_key: idkey,
            at: new Date().toISOString(),
          });
        }
        if (opts.isLedgered(idkey)) {
          // 持久 ledger 已有紀錄（含重啟前已落帳、或他途已觸發）→ skip 並入快取。
          r.seen.set(o.key, o.etag);
          summary.outcomes.push({ key: o.key, outcome: "skip_ledgered", job_id: null, error: null });
          continue;
        }
        const outcome = await triggerIntake(r, o.key, o.etag);
        // 自癒語意：只有成功觸發或永久性 skip 才標 seen；暫時性失敗不標 → 下輪重試。
        if (outcome.outcome !== "fail_transient") r.seen.set(o.key, o.etag);
        summary.outcomes.push(outcome);
      }
      r.status.seen_count = r.seen.size;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      r.status.last_error = msg;
      summary.error = msg;
      opts.structLog.anomaly("minioWatch", "minio watch tick failed", {
        anomaly_kind: "retry",
        reason: msg,
        bucket: cfg.bucket,
      });
    } finally {
      // 每輪（auto 與 pollNow）都重排下一輪 auto tick；先清既有 timer 避免 pollNow
      // 疊加孤兒 timer（洩漏 + dispose 清不掉）。pollNow 因此會重置 auto 節奏
      // （剛手動跑完一輪，下一輪自動輪詢從現在起算 interval）——語意上合理且確定。
      if (!r.stopped) {
        if (r.timer) clearTimeout(r.timer);
        r.timer = setTimeout(() => enqueueAutoTick(r), cfg.intervalSeconds * 1000);
      }
    }
    return summary;
  }

  /** 所有 tick（auto 與 pollNow）唯一入口：串上 run.chain，維持永不並發。 */
  function enqueueTick(r: WatchRun): Promise<TickSummary> {
    const p = r.chain.then(() => tick(r));
    r.chain = p.then(
      () => undefined,
      () => undefined, // tick 自身 try/catch 不 throw；此兜底防鏈斷
    );
    return p;
  }

  function enqueueAutoTick(r: WatchRun): void {
    void enqueueTick(r);
  }

  function startIfEnabled(): void {
    // 不變式：idempotent。兩條啟動路徑（"listening" 事件、selfBaseUrl 已設的立即路徑）
    // 共用 run guard 防重複啟動（詳見舊 app.ts startMinioWatcherIfEnabled 註解的時序論證）。
    if (!runtimeEnabled || run) return;
    // 啟動 fail-fast 三守衛（建任何資源前）：intake allowlist（app 注入）、SSRF loopback、
    // keySuffix boundary。任一失敗 throw，不靜默降級。
    opts.assertIntakeReachable();
    const selfBaseUrl = cfg.selfBaseUrl || opts.resolveSelfBaseUrl();
    assertLoopbackSelfBaseUrl(selfBaseUrl);
    assertBoundaryAlignedKeySuffix(cfg.keySuffix);
    const r: WatchRun = {
      store: storeFactory({
        endpoint: cfg.endpoint,
        bucket: cfg.bucket,
        accessKey: cfg.accessKey,
        secretKey: cfg.secretKey,
      }),
      selfBaseUrl,
      status: {
        enabled: true,
        bucket: cfg.bucket,
        prefix: cfg.prefix,
        interval_seconds: cfg.intervalSeconds,
        last_poll_at: null,
        poll_count: 0,
        last_error: null,
        baseline_count: null,
        seen_count: 0,
        triggered_total: 0,
        skipped_malformed_total: 0,
        last_triggered: [],
      },
      seen: new Map(),
      observed: new Map(),
      isFirstRound: true,
      stopped: false,
      timer: null,
      chain: Promise.resolve(),
    };
    run = r;
    // 首輪立即跑（不等一個 interval）：直接 enqueue 上鏈（非 setTimeout(0)），使
    // 「startIfEnabled 後立刻 pollNow」的排序完全確定（pollNow 必排在首輪之後），
    // 消除 macrotask timer 與 chain 的交錯不確定性。
    enqueueAutoTick(r);
  }

  async function disposeRun(r: WatchRun): Promise<void> {
    // 先停排程 → await in-flight tick settle（2s 上限 race，防外部卡住讓 dispose 永不返回）
    // → destroy store。in-flight 的 SDK list / presign / intake POST 在 destroy 前自然收斂，
    // 不產生 unhandled rejection。
    r.stopped = true;
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    const cap = new Promise<void>((resolve) => {
      capTimer = setTimeout(resolve, 2000);
    });
    try {
      await Promise.race([r.chain, cap]);
    } finally {
      if (capTimer) clearTimeout(capTimer);
    }
    await r.store.destroy();
  }

  return {
    configured,
    startIfEnabled,
    async setEnabled(enabled: boolean): Promise<WatchToggleOutcome> {
      if (toggleBusy) return { ok: false, code: "busy" };
      toggleBusy = true;
      try {
        if (enabled) {
          if (!configured()) return { ok: false, code: "not_configured" };
          const noop = run != null;
          runtimeEnabled = true;
          try {
            startIfEnabled(); // 冷啟（含三守衛 fail-fast）
          } catch (e) {
            runtimeEnabled = false; // 回滾 flag，不留半開狀態
            return { ok: false, code: "start_failed", message: e instanceof Error ? e.message : String(e) };
          }
          return { ok: true, noop };
        }
        runtimeEnabled = false;
        if (run) {
          const r = run;
          run = null;
          await disposeRun(r);
        }
        return { ok: true, noop: false };
      } finally {
        toggleBusy = false;
      }
    },
    status(): MinioWatchStatusView {
      if (!runtimeEnabled) {
        return {
          enabled: false,
          bucket: cfg.bucket || null,
          prefix: cfg.prefix || null,
          interval_seconds: cfg.intervalSeconds,
          // 誠實區分三種關閉原因（spec §4.2）：config error / operator runtime 關閉 / env 未 opt-in。
          note: startupConfigError
            ? "未啟用（MINIO_WATCH_ENABLED=true 但 endpoint/bucket/credentials 未完整設定）"
            : cfg.enabled
              ? "已由操作者於 console 關閉（runtime override；coordinator 重啟後回 env 預設）"
              : "未啟用（env MINIO_WATCH_ENABLED opt-in）",
        };
      }
      return run
        ? { ...run.status, last_triggered: [...run.status.last_triggered] }
        : { enabled: true, note: "watcher enabled but not yet started (server not listening)" };
    },
    async pollNow(): Promise<TickSummary> {
      if (!runtimeEnabled) return { ran: false, reason: "disabled", listed_count: 0, matched_count: 0, outcomes: [] };
      const r = run;
      if (!r) return { ran: false, reason: "not_started", listed_count: 0, matched_count: 0, outcomes: [] };
      return enqueueTick(r);
    },
    async dispose(): Promise<void> {
      if (!run) return;
      const r = run;
      run = null;
      await disposeRun(r);
    },
  };
}
