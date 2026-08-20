// bim-review-coordinator/src/services/lineage/sourceBundleReconciler.ts
//
// Governed source-bundle 的 **polling reconciliation**（task 3.2，藍圖 C-11）。
//
// 定位（很重要，別讀成第二條 intake）：主要觸發面是
// `POST /api/external/source-bundles/ready` 的 producer claim。本檔只是**撿漏**——
// producer 打不到 coordinator、或 coordinator 在收下 claim 與落 store 之間掛掉時，
// 讓 MinIO 上已經存在的 governed manifest 仍然能被收斂進 store ＋ 取得 stable job。
// 它走的是**同一條** `validateSourceBundle` ＋ `autoEnqueueGovernedBundle` 路徑，
// 所以「不會建第二個 logical job」是結構保證，不是兩份實作互相約定。
//
// 邊界：
//   - **預設關閉**（`SOURCE_BUNDLE_RECONCILE_ENABLED`，比照 `MINIO_WATCH_ENABLED`
//     的謹慎預設）。
//   - **env 獨立命名**（D-8）：MUST NOT 重用 `MINIO_WATCH_*`。legacy watcher 的
//     `mw_<hash16>` 與 governed 的 `source_bundle_id` 是兩個 MUST NOT 互相取代／
//     抑制／推導的去重空間（design.md §11.2 規則 3），共用 env 等於把兩者接起來。
//   - **不抑制 legacy**（§11.2 規則 5）：本檔完全不碰 `minioWatchSurface`／
//     `ConversionLedger`／`ExternalIfcReadyStore`，同一個 version prefix 底下即使
//     同時有 governed manifest 與 legacy `/model.ifc`，watcher 照常觸發 legacy。
//   - **不做 admission**（D-9）：撿到的 bundle 只落到 `PENDING_ADMISSION`。
import type { StructLogger } from "../../lib/structLog.js";
import {
  autoEnqueueGovernedBundle,
  type AutoEnqueueDeps,
} from "./pipelineJobEnqueue.js";
import { isRefParseFailure, parseMinioRef } from "./minioLocator.js";
import { parseSourceBundleManifest, sha256Hex } from "./sourceBundleManifest.js";
import type {
  SourceBundleObjectPort,
  VersionedObjectSummary,
} from "./sourceBundleObjectPort.js";
import type { SourceBundleRecord, SourceBundleStore } from "./sourceBundleStore.js";
import type { PipelineJobStore } from "./pipelineJobStore.js";
import {
  finalizeAdmissionOutcome,
  MANIFEST_MAX_BYTES,
  validateSourceBundle,
  type Sha256VerifyMode,
} from "./sourceBundleValidator.js";

const LOG_COMPONENT = "source-bundle-reconciler";

/** governed manifest 的規約檔名（**不是** `MINIO_WATCH_KEY_SUFFIX`）。 */
export const GOVERNED_MANIFEST_SUFFIX = "/manifest.json";

export interface SourceBundleReconcilerConfig {
  enabled: boolean;
  intervalMs: number;
  /** `minio://<authority>/<bucket>/<keyPrefix>`；空字串＝未設定＝不掃。 */
  prefix: string;
}

export interface SourceBundleReconcilerDeps {
  /** governed MinIO 未設定時為 null → 永不掃描（誠實停擺，不改用 legacy 憑證）。 */
  objects: SourceBundleObjectPort | null;
  bundles: SourceBundleStore;
  jobs: PipelineJobStore;
  /** 注入以便測試替換；production 一律傳 `validateSourceBundle` 本尊。 */
  validate?: typeof validateSourceBundle;
  sha256Mode: Sha256VerifyMode;
  now: () => string;
  newEventId: () => string;
  config: SourceBundleReconcilerConfig;
  structLog?: StructLogger;
}

export interface ReconcileTickResult {
  /** 這一輪看到的 governed manifest 物件數。 */
  scanned: number;
  /** 新收進 store 並取得 stable job 的 bundle 數。 */
  admitted: number;
  /** 已在 store、但這一輪補上／確認 job 綁定的 bundle 數。 */
  replayed: number;
  /** 本輪刻意略過（快取命中／已完整／NON_READY／identity 不足）的數量。 */
  skipped: number;
  errors: number;
}

export interface SourceBundleReconcilerStatus {
  enabled: boolean;
  configured: boolean;
  started: boolean;
  tick_count: number;
  last_tick_at: string | null;
  last_error: string | null;
  last_result: ReconcileTickResult | null;
}

export interface SourceBundleReconciler {
  start(): void;
  stop(): Promise<void>;
  /**
   * 跑一輪 reconciliation。**與 `enabled` 無關**（那是自動排程的開關），
   * 讓測試與運維可以在不開排程的情況下驅動一輪——比照
   * `minioWatchSurface.pollNow()` 的既有語意。
   */
  pollNow(): Promise<ReconcileTickResult>;
  status(): SourceBundleReconcilerStatus;
}

function emptyResult(): ReconcileTickResult {
  return { scanned: 0, admitted: 0, replayed: 0, skipped: 0, errors: 0 };
}

export function createSourceBundleReconciler(
  deps: SourceBundleReconcilerDeps,
): SourceBundleReconciler {
  const validate = deps.validate ?? validateSourceBundle;
  const { config, structLog } = deps;
  /**
   * 本 process 內已經調和過的 `objectKey@versionId`。
   *
   * 只避免「每一輪都把同一份未變的 manifest 重讀一次」，不是持久化狀態：
   * 重啟後重讀一次是正確的（store 才是權威）。**NON_READY 一律不入快取**，
   * 因為 artifact 可能稍後才上傳完整（自癒語意，比照 watcher 的 fail_transient）。
   */
  const reconciled = new Set<string>();

  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let tickCount = 0;
  let lastTickAt: string | null = null;
  let lastError: string | null = null;
  let lastResult: ReconcileTickResult | null = null;

  const configured = (): boolean => deps.objects !== null && config.prefix.length > 0;

  function enqueueDeps(): AutoEnqueueDeps {
    return {
      jobs: deps.jobs,
      bundles: deps.bundles,
      now: deps.now,
      newEventId: deps.newEventId,
      structLog,
    };
  }

  /** 由 manifest 的觀測值組出 governed record（reconciler 沒有 authProvider）。 */
  function recordFromObservation(input: {
    sourceBundleId: string;
    externalModelVersionId: string;
    tenantId: string;
    projectId: string;
    projectDisplayName: string | null;
    modelCategory: string | null;
    manifestRef: string;
    manifestSha256: string;
    producerId: string;
    producerKind: string;
    claimedAt: string;
    observedAt: string;
  }): SourceBundleRecord {
    return {
      source_bundle_id: input.sourceBundleId,
      external_model_version_id: input.externalModelVersionId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      project_display_name: input.projectDisplayName,
      model_category: input.modelCategory,
      manifest_ref: input.manifestRef,
      manifest_sha256: input.manifestSha256,
      bundle_state: "READY",
      integrity_diagnostics: [],
      producer_id: input.producerId,
      producer_kind: input.producerKind,
      claimed_at: input.claimedAt,
      validated_at: input.observedAt,
      pipeline_job_id: null,
      created_at: input.observedAt,
      updated_at: input.observedAt,
    };
  }

  async function reconcileManifest(
    summary: VersionedObjectSummary,
    objects: SourceBundleObjectPort,
    result: ReconcileTickResult,
  ): Promise<void> {
    const cacheKey = `${summary.objectKey}@${summary.versionId}`;
    if (reconciled.has(cacheKey)) {
      result.skipped += 1;
      return;
    }
    const parsedRef = parseMinioRef(summary.ref);
    if (isRefParseFailure(parsedRef)) {
      // 由 port 組出來的 ref 解析失敗＝port 與 locator 契約不一致；記錯不中斷整輪。
      result.errors += 1;
      structLog?.warn(LOG_COMPONENT, "discovered manifest ref is not a governed locator", {
        object_key: summary.objectKey,
      });
      return;
    }

    // reconciler 是**觀察者**不是 claimant：manifest digest 一律實讀，
    // 不從任何 producer 宣告取得（也因此不可能產生 manifest_digest_conflict）。
    const rawBytes = await objects.getBytesVersioned(parsedRef, MANIFEST_MAX_BYTES);
    const observedSha256 = sha256Hex(rawBytes);
    const parsed = parseSourceBundleManifest(rawBytes);
    if (!parsed.ok) {
      result.skipped += 1;
      structLog?.info(LOG_COMPONENT, "discovered manifest is not parseable; left unmanaged", {
        object_key: summary.objectKey,
        diagnostic_codes: parsed.diagnostics.map((item) => item.code),
      });
      return;
    }
    const manifest = parsed.manifest;
    const sourceBundleId = manifest.source_bundle_id;

    const known = deps.bundles.get(sourceBundleId);
    if (known) {
      if (known.pipeline_job_id !== null) {
        // 已收斂完成（store 有紀錄且已綁 stable job）→ 什麼都不做。
        reconciled.add(cacheKey);
        result.skipped += 1;
        return;
      }
      // store 有紀錄但沒 job（3.1 落地的舊紀錄，或落 store 與 enqueue 之間掛掉）
      // → 只補 job，不重跑重驗（bundle 不可變，重驗不會改變結論）。
      const enqueued = autoEnqueueGovernedBundle(known, enqueueDeps());
      reconciled.add(cacheKey);
      result.replayed += 1;
      structLog?.info(LOG_COMPONENT, "bound stable pipeline job to an already-admitted bundle", {
        source_bundle_id: sourceBundleId,
        pipeline_job_id: enqueued.pipeline_job_id,
        created_new_logical_job: enqueued.created,
      });
      return;
    }

    // identity 不足以鑄造 governed 紀錄時**不猜**：ready claim 的 tenant/project 來自
    // 通過驗證的 authProvider，reconciler 只有 manifest 一個來源。缺就留給 producer
    // 走正規 claim，不用空字串頂替（那會製造一筆身分造假的 governed 紀錄）。
    const tenantId = manifest.tenant_id ?? "";
    const projectId = manifest.project_id ?? "";
    if (tenantId.length === 0 || projectId.length === 0) {
      result.skipped += 1;
      structLog?.warn(LOG_COMPONENT, "discovered manifest lacks tenant/project identity", {
        source_bundle_id: sourceBundleId,
        object_key: summary.objectKey,
      });
      return;
    }

    const validation = await validate(
      {
        source_bundle_id: sourceBundleId,
        external_model_version_id: manifest.external_model_version_id,
        manifest_sha256: observedSha256,
        manifest_ref: {
          ref: summary.ref,
          object_version_id: summary.versionId,
          etag: summary.etag,
          sha256: observedSha256,
          size_bytes: summary.sizeBytes,
        },
      },
      { objects, now: deps.now, sha256Mode: deps.sha256Mode, structLog },
    );

    if (validation.bundle_state !== "READY" || validation.manifest_sha256 === null) {
      // 不入快取：artifact 可能還在上傳，下一輪重掃是自癒路徑。
      result.skipped += 1;
      structLog?.info(LOG_COMPONENT, "discovered bundle is not ready; not admitted", {
        source_bundle_id: sourceBundleId,
        bundle_state: validation.bundle_state,
        diagnostic_codes: validation.integrity_diagnostics.map((item) => item.code),
      });
      return;
    }

    const candidate = recordFromObservation({
      sourceBundleId,
      externalModelVersionId: validation.external_model_version_id,
      tenantId,
      projectId,
      projectDisplayName: manifest.project_display_name ?? null,
      modelCategory: manifest.model_category ?? null,
      manifestRef: summary.ref,
      manifestSha256: validation.manifest_sha256,
      producerId: manifest.producer.producer_id,
      producerKind: manifest.producer.producer_kind,
      // producer 自己宣告的發布時間就是這份 bundle 的 claim 時點；
      // reconciler 不是 claimant，不得用「我掃到的時間」冒充。
      claimedAt: manifest.published_at,
      observedAt: validation.observed_at,
    });

    const admitted = deps.bundles.admit(candidate);
    const finalized = finalizeAdmissionOutcome(validation, { outcome: admitted.outcome });
    if (finalized.bundle_state !== "READY") {
      // 同 id 異 digest：READY bundle 不可覆寫，必須開新 source_bundle_id。
      result.skipped += 1;
      structLog?.warn(LOG_COMPONENT, "discovered bundle conflicts with an admitted digest", {
        source_bundle_id: sourceBundleId,
        diagnostic_codes: finalized.integrity_diagnostics.map((item) => item.code),
      });
      return;
    }

    const enqueued = autoEnqueueGovernedBundle(admitted.record, enqueueDeps());
    reconciled.add(cacheKey);
    if (enqueued.created) result.admitted += 1;
    else result.replayed += 1;
    structLog?.info(LOG_COMPONENT, "reconciled a governed bundle discovered in MinIO", {
      source_bundle_id: sourceBundleId,
      pipeline_job_id: enqueued.pipeline_job_id,
      created_new_logical_job: enqueued.created,
      admit_outcome: admitted.outcome,
    });
  }

  async function tick(): Promise<ReconcileTickResult> {
    const result = emptyResult();
    const objects = deps.objects;
    try {
      if (!objects || config.prefix.length === 0) return result;
      let discovered: VersionedObjectSummary[];
      try {
        discovered = await objects.listObjectsUnder(config.prefix);
      } catch (err) {
        result.errors += 1;
        lastError = err instanceof Error ? err.message : String(err);
        structLog?.anomaly(LOG_COMPONENT, "governed reconciliation list failed", {
          anomaly_kind: "retry",
          reason: lastError,
        });
        return result;
      }
      const manifests = discovered.filter((item) =>
        item.objectKey.endsWith(GOVERNED_MANIFEST_SUFFIX),
      );
      for (const summary of manifests) {
        result.scanned += 1;
        try {
          await reconcileManifest(summary, objects, result);
        } catch (err) {
          // 一筆壞掉的 bundle 不得讓整輪停擺（自癒優先）。
          result.errors += 1;
          lastError = err instanceof Error ? err.message : String(err);
          structLog?.anomaly(LOG_COMPONENT, "governed reconciliation entry failed", {
            anomaly_kind: "retry",
            reason: lastError,
            object_key: summary.objectKey,
          });
        }
      }
      return result;
    } finally {
      tickCount += 1;
      lastTickAt = deps.now();
      lastResult = result;
      // 每輪（auto 與 pollNow）都重排下一輪；先清既有 timer 避免 pollNow 疊加
      // 孤兒 timer（洩漏 ＋ stop 清不掉）——逐字沿用 minioWatchSurface 的既有節奏。
      if (started && !stopped) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          void enqueueTick();
        }, config.intervalMs);
      }
    }
  }

  /** 所有 tick 的唯一入口：串上 chain，保證永不並發。 */
  function enqueueTick(): Promise<ReconcileTickResult> {
    const pending = chain.then(() => tick());
    chain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  return {
    start(): void {
      if (started || stopped) return;
      if (!config.enabled) {
        structLog?.info(LOG_COMPONENT, "governed reconciliation disabled", {
          enabled: false,
          configured: configured(),
        });
        return;
      }
      if (!configured()) {
        structLog?.info(LOG_COMPONENT, "governed reconciliation not configured", {
          enabled: true,
          configured: false,
        });
        return;
      }
      started = true;
      // 首輪立即跑（不等一個 interval），與 watcher 的既有語意一致。
      void enqueueTick();
    },

    async stop(): Promise<void> {
      stopped = true;
      started = false;
      if (timer) clearTimeout(timer);
      timer = null;
      // await in-flight tick settle，2s 上限 race（防外部卡住讓 dispose 永不返回）。
      let capTimer: ReturnType<typeof setTimeout> | null = null;
      const cap = new Promise<void>((resolve) => {
        capTimer = setTimeout(resolve, 2000);
      });
      try {
        await Promise.race([chain, cap]);
      } finally {
        if (capTimer) clearTimeout(capTimer);
      }
    },

    pollNow(): Promise<ReconcileTickResult> {
      return enqueueTick();
    },

    status(): SourceBundleReconcilerStatus {
      return {
        enabled: config.enabled,
        configured: configured(),
        started,
        tick_count: tickCount,
        last_tick_at: lastTickAt,
        last_error: lastError,
        last_result: lastResult,
      };
    },
  };
}
