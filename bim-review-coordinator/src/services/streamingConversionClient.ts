import type { ExternalIfcReadyEvent } from "../types.js";

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
 * external（B-scheme）→ internal streaming `ifc_ready_event`。
 * streaming 的 conversion_authority 仍以 `model_version_id` / `ifc_artifact`
 * 為輸入；coordinator 在邊界做轉換，外部契約維持 B-scheme。
 */
export function toInternalIfcReadyEvent(
  event: ExternalIfcReadyEvent,
  binding: {
    correlationId: string;
    externalModelVersionId: string;
    /** fast-ifc-link-demo-loop §4.1:coordinator container view path,優先使用。 */
    localPath?: string;
    /** fast-ifc-link-demo-loop §4.1:host view path,streaming-server host-native 用。 */
    hostLocalPath?: string;
  },
): Record<string, unknown> {
  return {
    event_type: "ifc_ready",
    event_id: event.event_id || `evt_${binding.correlationId}`,
    correlation_id: binding.correlationId,
    tenant_id: event.tenant_id,
    project_id: event.project_id,
    // streaming internal 仍用 model_version_id 欄位；以 external id 餵入並由
    // coordinator 保留 external 綁定（shadow / callback 關聯屬 T5/T6）。
    model_version_id: binding.externalModelVersionId,
    external_model_version_id: binding.externalModelVersionId,
    external_conversion_task_id: event.external_conversion_task_id ?? null,
    ifc_artifact: {
      artifact_id: `ifc_${binding.externalModelVersionId}`,
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
    binding: {
      correlationId: string;
      externalModelVersionId: string;
      /** fast-ifc-link-demo-loop §4.1:coordinator container view path,寫進 payload。 */
      localPath?: string;
      /** fast-ifc-link-demo-loop §4.1:host view path,streaming-server host-native 用。 */
      hostLocalPath?: string;
    },
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
