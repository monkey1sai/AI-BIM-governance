import type { ConversionQualityMetricsSummary, ExternalIfcReadyEvent } from "../types.js";
import crypto from "node:crypto";

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T3 §4.4）。
 *
 * coordinator 是唯一對外 IFC-ready intake；`bim-streaming-server` 為
 * internal-only 轉檔引擎（T4 正式收斂）。此 client 把外部 B-scheme 事件
 * 映射成 streaming 既有 internal `ifc_ready_event` 形狀並呼叫
 * `POST /api/conversions/ifc-to-usdc`，不重寫 streaming 轉檔核心。
 */

export interface StreamingConversionDispatchResult {
  conversion_job_id: string;
  status: string;
  correlation_id?: string;
  idempotent_replay?: boolean;
  authority?: string;
}

export interface StreamingConversionBinding {
  correlationId: string;
  externalModelVersionId: string;
  /** fast-ifc-link-demo-loop §4.1:coordinator container view path,優先使用。 */
  localPath?: string;
  /** fast-ifc-link-demo-loop §4.1:host view path,streaming-server host-native 用。 */
  hostLocalPath?: string;
  /** Internal-only opt-in;外部 IFC-ready contract 不宣告 profile。 */
  conversionProfile?: string;
}

/**
 * streaming-owned conversion result（host-native `GET /api/conversions/{id}/result`）。
 * coordinator 只消費 metadata refs，不取 `.usdc` 本體（雲端 callback 為
 * metadata-only outbox）。
 */
export interface StreamingConversionResult {
  conversion_job_id: string;
  status: string;
  ready: boolean;
  correlation_id?: string;
  model_status?: string;
  usdc_ref?: string | null;
  element_mapping_ref?: string | null;
  manifest_ref?: string | null;
  reason?: string | null;
  raw: Record<string, unknown>;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * coordinator-auto-poll-streaming-conversion §4:terminal detection 抽 module-level
 * helper,讓 dispatch 端 auto poller 與 internal ingest endpoint 共用同一條判定,
 * 避免雙處硬編字串走偏。
 */
export function isTerminalConversionResult(result: StreamingConversionResult): {
  terminal: boolean;
  failed: boolean;
  ready: boolean;
} {
  const failed =
    result.model_status === "failed" ||
    result.status === "failed" ||
    result.status === "cancelled";
  const ready =
    !failed &&
    (result.ready === true ||
      result.model_status === "ready" ||
      result.status === "succeeded" ||
      result.status === "succeeded_with_warnings");
  return { terminal: failed || ready, failed, ready };
}

export interface PollerHandle {
  cancel: () => void;
}

export interface PollConversionResultOptions {
  intervalMs: number;
  maxAttempts: number;
  /** test 注入;預設用 client.fetchConversionResult。 */
  fetchImpl?: (conversionJobId: string) => Promise<StreamingConversionResult>;
  /** terminal 時(含 poll_timeout)呼叫。實作端應在此 chain 既有 ingest helper。 */
  onTerminal: (result: StreamingConversionResult) => void | Promise<void>;
  /** fetch 失敗時觀察(預設 swallow,下次再試);不影響 schedule 繼續。 */
  onError?: (error: unknown, attempt: number) => void;
}

/**
 * conversion-artifact-id-sanitize（spec 2026-06-11 §4.1）：把外部 model_version_id
 * 轉成通過 conversion 端 `SAFE_ID_RE = ^[A-Za-z0-9_.-]+$` 的 artifact_id 片段。
 *
 * - 純 safe 字元 → 原樣回傳（零行為變化，既有英文 id 的 artifact_id 與現行完全相同）。
 * - 含非 safe 字元 → `${safe}_${sha256hex(raw).slice(0,8)}`（確定性 + 防碰撞）。
 * - safe 為空（全非 safe 字元）→ `mv_${sha256hex(raw).slice(0,8)}`（可讀前綴退化形）。
 *
 * 不放寬 conversion 端規則（id 進檔案路徑 / USD 命名，放寬有路徑安全風險），修在 coordinator 端。
 */
export function sanitizeArtifactIdPart(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, "");
  if (safe === raw) return raw;
  const hash8 = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return safe.length > 0 ? `${safe}_${hash8}` : `mv_${hash8}`;
}

/**
 * conversion_authority.py:262-263 對 tenant_id / project_id 也跑 _safe_id，且這兩欄
 * 在 coordinator 端無 SAFE_ID_RE 輸入驗證（authProvider.requiredIdentity 只擋空值），
 * 中文 project / tenant 命名會在 dispatch 時被 conversion 端 _safe_id 擋成 400。
 *
 * 非字串（理論上 undefined / null）原樣透傳，讓 conversion authority 套用其 server-side
 * 預設值（`tenant_demo_001` / `project_demo_001`），維持既有行為。
 */
function sanitizeSafeIdField(value: unknown): unknown {
  return typeof value === "string" ? sanitizeArtifactIdPart(value) : value;
}

/**
 * external（B-scheme）→ internal streaming `ifc_ready_event`。
 * streaming 的 conversion_authority 仍以 `model_version_id` / `ifc_artifact`
 * 為輸入；coordinator 在邊界做轉換，外部契約維持 B-scheme。
 */
export function toInternalIfcReadyEvent(
  event: ExternalIfcReadyEvent,
  binding: StreamingConversionBinding,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    event_type: "ifc_ready",
    // conversion_authority.py:238 對 event_id 也跑 _safe_id（SAFE_ID_RE）。
    // worker-compat normalize 不產 event_id → 走 fallback；correlationId 可能含冒號
    // （worker:project::version::task），未 sanitize 則 dispatch 在 event_id 先炸 400。
    // 外部帶的 event_id 同樣可能非 safe，一律過 sanitize。
    event_id: event.event_id
      ? sanitizeArtifactIdPart(event.event_id)
      : `evt_${sanitizeArtifactIdPart(binding.correlationId)}`,
    // conversion_authority.py:261-264 對 correlation_id / tenant_id / project_id /
    // model_version_id 全跑 _safe_id（SAFE_ID_RE）；coordinator 派生的 correlation_id
    // 可能含冒號（worker:project::version::task），中文 project/tenant/model id 也常見。
    // 內部欄位走 sanitize 避免 dispatch 400；external_model_version_id 保留原始供對帳。
    correlation_id: sanitizeArtifactIdPart(binding.correlationId),
    tenant_id: sanitizeSafeIdField(event.tenant_id),
    project_id: sanitizeSafeIdField(event.project_id),
    // streaming internal 仍用 model_version_id 欄位；以 external id 餵入並由
    // coordinator 保留 external 綁定（shadow / callback 關聯屬 T5/T6）。
    model_version_id: sanitizeArtifactIdPart(binding.externalModelVersionId),
    external_model_version_id: binding.externalModelVersionId,
    external_conversion_task_id: event.external_conversion_task_id ?? null,
    ifc_artifact: {
      artifact_id: `ifc_${sanitizeArtifactIdPart(binding.externalModelVersionId)}`,
      format: event.source_ifc.format || "ifc",
      filename: event.source_ifc.filename || null,
      url: event.source_ifc.ref,
      etag: event.source_ifc.etag,
      // fast-ifc-link-demo-loop §4.1:shared volume 兩種 view path。streaming-server
      // 優先用 local_path / host_local_path,fallback 到 url(HTTP GET)。
      local_path: binding.localPath ?? null,
      host_local_path: binding.hostLocalPath ?? null,
    },
    requested_outputs:
      event.requested_outputs && event.requested_outputs.length > 0
        ? event.requested_outputs
        : ["usdc", "element_mapping", "entity_index", "metadata"],
    // 轉檔結果回拋公司雲端（metadata-only outbox）屬 T5；此處先帶過外部
    // callback_url 作為關聯線索，實際投遞與 outbox 不在 T3 範圍。
    callback_url: event.callback_url ?? null,
  };
  if (binding.conversionProfile) {
    payload.conversion_profile = binding.conversionProfile;
  }
  return payload;
}

export class StreamingConversionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly requestTimeoutMs: number = 10000,
    // host-native service 啟用 internal_conversion_token 時，coordinator 必須
    // 帶 X-Internal-Conversion-Token，否則 dispatch / result 取得會被 401/403。
    private readonly internalToken?: string,
  ) {}

  private authHeaders(extra: Record<string, string>): Record<string, string> {
    return this.internalToken
      ? { ...extra, "X-Internal-Conversion-Token": this.internalToken }
      : extra;
  }

  async createConversionJob(
    event: ExternalIfcReadyEvent,
    binding: StreamingConversionBinding,
  ): Promise<StreamingConversionDispatchResult> {
    const url = new URL(
      "api/conversions/ifc-to-usdc",
      ensureTrailingSlash(this.baseUrl),
    ).toString();
    const payload = toInternalIfcReadyEvent(event, binding);
    const upstream = await fetch(url, {
      method: "POST",
      headers: this.authHeaders({
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      throw new Error(`streaming conversion API ${upstream.status}: ${text.slice(0, 256)}`);
    }
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const conversionJobId = parsed.conversion_job_id;
    if (typeof conversionJobId !== "string" || conversionJobId.length === 0) {
      throw new Error("streaming conversion API returned no conversion_job_id");
    }
    return {
      conversion_job_id: conversionJobId,
      status: typeof parsed.status === "string" ? parsed.status : "queued",
      correlation_id:
        typeof parsed.correlation_id === "string" ? parsed.correlation_id : undefined,
      idempotent_replay:
        typeof parsed.idempotent_replay === "boolean" ? parsed.idempotent_replay : undefined,
      authority: typeof parsed.authority === "string" ? parsed.authority : undefined,
    };
  }

  /**
   * 主動向 host-native conversion service 取結果（B-scheme：coordinator 拉
   * `GET /api/conversions/{id}/result`，再餵進既有 internal ingestion + 雲端
   * metadata-only callback outbox）。只抽 metadata refs，不取大型檔案本體。
   */
  /**
   * coordinator-auto-poll-streaming-conversion §3:dispatch 成功後自動啟動的
   * in-process polling chain。setTimeout 序列(非 setInterval,避免 overlap)。
   * 終態時 caller 透過 `onTerminal` 接手既有 ingest 路徑;達 maxAttempts 仍 non-terminal
   * 視為 `poll_timeout` failed-equivalent(轉成 fake failed result 餵 onTerminal,
   * 讓 ingest helper 走 failed callback 路徑,維持單一 ingest contract)。
   * 回傳 `cancel()` 清 pending timer(已 in-flight 的 fetch 不取消,自然 settle)。
   */
  pollConversionResult(
    conversionJobId: string,
    options: PollConversionResultOptions,
  ): PollerHandle {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const fetchOne =
      options.fetchImpl ?? ((id: string) => this.fetchConversionResult(id));

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      let result: StreamingConversionResult | null = null;
      try {
        result = await fetchOne(conversionJobId);
      } catch (err) {
        options.onError?.(err, attempts);
      }
      if (cancelled) return;
      if (result) {
        const { terminal } = isTerminalConversionResult(result);
        if (terminal) {
          await options.onTerminal(result);
          return;
        }
      }
      if (attempts >= options.maxAttempts) {
        const fakeTimeoutResult: StreamingConversionResult = {
          conversion_job_id: conversionJobId,
          status: "failed",
          ready: false,
          model_status: "failed",
          usdc_ref: null,
          element_mapping_ref: null,
          manifest_ref: null,
          reason: "poll_timeout",
          raw: { reason: "poll_timeout", attempts },
        };
        await options.onTerminal(fakeTimeoutResult);
        return;
      }
      timer = setTimeout(() => {
        void tick();
      }, options.intervalMs);
    };

    timer = setTimeout(() => {
      void tick();
    }, options.intervalMs);

    return {
      cancel: () => {
        cancelled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  async fetchConversionResult(conversionJobId: string): Promise<StreamingConversionResult> {
    const url = new URL(
      `api/conversions/${encodeURIComponent(conversionJobId)}/result`,
      ensureTrailingSlash(this.baseUrl),
    ).toString();
    const upstream = await fetch(url, {
      method: "GET",
      headers: this.authHeaders({ Accept: "application/json" }),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      throw new Error(
        `streaming conversion result API ${upstream.status}: ${text.slice(0, 256)}`,
      );
    }
    const parsed = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const model = (parsed.model as Record<string, unknown> | undefined) ?? {};
    const artifacts = (parsed.artifacts as Record<string, unknown> | undefined) ?? {};
    const errorInfo = (parsed.error as Record<string, unknown> | undefined) ?? {};
    const refOf = (key: string): string | null => {
      const entry = artifacts[key] as Record<string, unknown> | undefined;
      const value = entry?.url;
      return typeof value === "string" ? value : null;
    };
    return {
      conversion_job_id:
        typeof parsed.conversion_job_id === "string"
          ? parsed.conversion_job_id
          : conversionJobId,
      status: typeof parsed.status === "string" ? parsed.status : "unknown",
      ready: parsed.ready === true || model.status === "ready",
      correlation_id:
        typeof parsed.correlation_id === "string" ? parsed.correlation_id : undefined,
      model_status: typeof model.status === "string" ? model.status : undefined,
      usdc_ref: refOf("model_usdc"),
      element_mapping_ref: refOf("element_mapping"),
      manifest_ref: refOf("metadata"),
      reason: typeof errorInfo.message === "string" ? errorInfo.message : null,
      raw: parsed,
    };
  }
}

/**
 * coordinator-forward-quality-metrics-summary:從 terminal streaming conversion
 * result 萃取 `ConversionQualityMetricsSummary`,供 coordinator auto-ingest 寫進
 * review session 的 `quality_metrics_summary` slot。viewer / `/ui` 依此計算
 * Semantic ready;C1 fallback 三個 semantic 欄位(`semantic_mapping_fidelity` /
 * `mapping_has_ifc_type` / `mapping_has_ifc_name`)在這條路徑被 propagate。
 *
 * Best-effort:result 無 `quality_metrics` 區段時回 `null`,caller 不阻擋 session
 * 建立(與既有 `quality_metrics_summary: null` 行為等價,backward compatible)。
 */
export function buildQualityMetricsSummary(
  result: StreamingConversionResult,
): ConversionQualityMetricsSummary | null {
  const raw = result.raw as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const quality = raw.quality_metrics as Record<string, unknown> | undefined;
  if (!quality || typeof quality !== "object") return null;

  const str = (key: string): string | null => {
    const v = quality[key];
    return typeof v === "string" ? v : null;
  };
  const num = (key: string): number | null => {
    const v = quality[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const bool = (key: string): boolean | null => {
    const v = quality[key];
    return typeof v === "boolean" ? v : null;
  };

  // phase_timings.conversion_total.duration_seconds(對齊 dev-console.html 的
  // fallback 取法)
  const phaseTimings = quality.phase_timings as Record<string, unknown> | undefined;
  let conversionDuration: number | null = null;
  if (phaseTimings && typeof phaseTimings === "object") {
    const ct = phaseTimings.conversion_total as Record<string, unknown> | undefined;
    if (ct && typeof ct === "object") {
      const d = ct.duration_seconds;
      if (typeof d === "number" && Number.isFinite(d)) conversionDuration = d;
    }
  }

  const fixtureName =
    typeof raw.original_filename === "string" ? (raw.original_filename as string) : null;
  const artifactGroupId =
    typeof raw.artifact_group_id === "string" ? (raw.artifact_group_id as string) : null;

  return {
    fixture_name: fixtureName,
    conversion_job_id: result.conversion_job_id ?? null,
    artifact_group_id: artifactGroupId,
    source_ifc_entity_count: num("source_ifc_entity_count"),
    sidecar_carrier_count: num("sidecar_carrier_count"),
    materialization_strategy: str("materialization_strategy"),
    coverage_ratio: num("coverage_ratio"),
    coverage_status: str("coverage_status"),
    conversion_duration_seconds: conversionDuration,
    semantic_mapping_fidelity: str("semantic_mapping_fidelity"),
    mapping_has_ifc_type: bool("mapping_has_ifc_type"),
    mapping_has_ifc_name: bool("mapping_has_ifc_name"),
  };
}
