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

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

/**
 * external（B-scheme）→ internal streaming `ifc_ready_event`。
 * streaming 的 conversion_authority 仍以 `model_version_id` / `ifc_artifact`
 * 為輸入；coordinator 在邊界做轉換，外部契約維持 B-scheme。
 */
export function toInternalIfcReadyEvent(
  event: ExternalIfcReadyEvent,
  binding: { correlationId: string; externalModelVersionId: string },
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
  ) {}

  async createConversionJob(
    event: ExternalIfcReadyEvent,
    binding: { correlationId: string; externalModelVersionId: string },
  ): Promise<StreamingConversionDispatchResult> {
    const url = new URL(
      "api/conversions/ifc-to-usdc",
      ensureTrailingSlash(this.baseUrl),
    ).toString();
    const payload = toInternalIfcReadyEvent(event, binding);
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
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
}
