import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * B-scheme（local-coordinator-ifc-ready-intake-boundary T5 §6.1-6.3）。
 *
 * 轉檔完成/失敗後 coordinator 必 callback 公司雲端 `bim-control`，payload
 * 僅輕量 metadata（**禁傳 `.usdc` 等大型本體**；大檔只在客戶落地端）。
 * 投遞必經 outbox：cloud 不可達不可「call 一次失敗就算了」——保留重試，
 * retry 耗盡進 dead-letter（不靜默丟棄），並記 evidence。
 *
 * callback 投遞狀態與 conversion 成功**分離**：conversion 在本地成功即
 * `ready`，callback 未 ack 不影響本地結果可查詢。
 *
 * 真實公司雲端 endpoint/auth 待 OQ1；未確認前 target 來自凍結契約
 * （tests/contracts/conversion_result_callback.json）/設定，real endpoint
 * 標 pending。投遞以顯式 `deliverPending()` 驅動（無計時器，runtime
 * 排程屬服務 loop；測試可決定性驅動）。
 */

export type CallbackEvent = "conversion_result_ready" | "conversion_failed";
export type CallbackOutboxStatus = "pending" | "delivered" | "dead_letter";

export interface CallbackOutboxEntry {
  outbox_id: string;
  event: CallbackEvent;
  target_url: string | null;
  correlation_id: string;
  external_model_version_id: string;
  conversion_job_id: string | null;
  payload: Record<string, unknown>;
  status: CallbackOutboxStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
  evidence: Array<{ at: string; attempt: number; outcome: string; detail: string }>;
}

export class MetadataOnlyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataOnlyViolation";
  }
}

const FORBIDDEN_KEYS = new Set([
  "usdc",
  "usdc_body",
  "usdc_bytes",
  "model_usdc_body",
  "file_bytes",
  "content_base64",
]);
const USDC_MAGIC = ["PXR-USDC", "PK"];

/**
 * 雲地分離鐵律於程式碼強制：metadata-only callback 不得帶大型/二進位
 * 模型本體（只允許 `*_ref` 參照）。違反即丟 MetadataOnlyViolation。
 */
export function assertMetadataOnly(payload: unknown, pathPrefix = ""): void {
  if (payload === null || payload === undefined) return;
  if (typeof payload === "string") {
    if (payload.length > 4096 && USDC_MAGIC.some((m) => payload.startsWith(m))) {
      throw new MetadataOnlyViolation(
        `metadata-only callback violated: embedded model body at '${pathPrefix.replace(/\.$/, "")}'`,
      );
    }
    return;
  }
  if (Array.isArray(payload)) {
    payload.forEach((item, index) => assertMetadataOnly(item, `${pathPrefix}${index}.`));
    return;
  }
  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        throw new MetadataOnlyViolation(
          `metadata-only callback violated: forbidden key '${pathPrefix}${key}'`,
        );
      }
      assertMetadataOnly(value, `${pathPrefix}${key}.`);
    }
  }
}

export type CallbackDeliverer = (
  targetUrl: string,
  payload: Record<string, unknown>,
) => Promise<void>;

async function defaultDeliverer(
  targetUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!upstream.ok) {
    throw new Error(`cloud callback HTTP ${upstream.status}`);
  }
}

export class CallbackOutbox {
  private readonly entries = new Map<string, CallbackOutboxEntry>();

  constructor(
    private readonly maxAttempts: number = 5,
    private readonly deliverer: CallbackDeliverer = defaultDeliverer,
    private readonly persistencePath: string | null = null,
  ) {
    this.loadPersistedEntries();
  }

  enqueue(input: {
    event: CallbackEvent;
    targetUrl: string | null;
    correlationId: string;
    externalModelVersionId: string;
    conversionJobId: string | null;
    payload: Record<string, unknown>;
  }): CallbackOutboxEntry {
    // metadata-only 鐵律：入列前強制檢查（禁 .usdc 本體）。
    assertMetadataOnly(input.payload);
    const now = new Date().toISOString();
    const id = `cbk_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const entry: CallbackOutboxEntry = {
      outbox_id: id,
      event: input.event,
      target_url: input.targetUrl,
      correlation_id: input.correlationId,
      external_model_version_id: input.externalModelVersionId,
      conversion_job_id: input.conversionJobId,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      max_attempts: this.maxAttempts,
      last_error: null,
      created_at: now,
      updated_at: now,
      delivered_at: null,
      evidence: [],
    };
    this.entries.set(id, entry);
    this.persist();
    return entry;
  }

  /** 嘗試投遞單一 entry 一次；失敗累加 attempts，耗盡→dead_letter。 */
  async attemptDelivery(outboxId: string): Promise<CallbackOutboxEntry | undefined> {
    const entry = this.entries.get(outboxId);
    if (!entry || entry.status !== "pending") return entry;
    entry.attempts += 1;
    const at = new Date().toISOString();
    if (!entry.target_url) {
      // OQ1 未確認：無真實 cloud endpoint → 視為不可達，保留重試/最終 dead-letter，
      // 絕不靜默丟棄（real endpoint pending）。
      entry.last_error = "cloud callback endpoint pending (OQ1 unresolved)";
      entry.evidence.push({ at, attempt: entry.attempts, outcome: "retry", detail: entry.last_error });
    } else {
      try {
        await this.deliverer(entry.target_url, entry.payload);
        entry.status = "delivered";
        entry.delivered_at = at;
        entry.last_error = null;
        entry.updated_at = at;
        entry.evidence.push({ at, attempt: entry.attempts, outcome: "delivered", detail: entry.target_url });
        this.persist();
        return entry;
      } catch (error) {
        entry.last_error = error instanceof Error ? error.message : String(error);
        entry.evidence.push({ at, attempt: entry.attempts, outcome: "retry", detail: entry.last_error });
      }
    }
    if (entry.attempts >= entry.max_attempts) {
      entry.status = "dead_letter";
      entry.evidence.push({
        at,
        attempt: entry.attempts,
        outcome: "dead_letter",
        detail: `retries exhausted (${entry.attempts}/${entry.max_attempts}); last_error=${entry.last_error}`,
      });
    }
    entry.updated_at = at;
    this.persist();
    return entry;
  }

  /** 對所有 pending entry 各嘗試一次（runtime loop / 測試決定性驅動）。 */
  async deliverPending(): Promise<CallbackOutboxEntry[]> {
    const touched: CallbackOutboxEntry[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status === "pending") {
        const updated = await this.attemptDelivery(entry.outbox_id);
        if (updated) touched.push(updated);
      }
    }
    return touched;
  }

  get(outboxId: string): CallbackOutboxEntry | undefined {
    return this.entries.get(outboxId);
  }

  listByCorrelation(correlationId: string): CallbackOutboxEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.correlation_id === correlationId);
  }

  list(): CallbackOutboxEntry[] {
    return Array.from(this.entries.values());
  }

  private loadPersistedEntries(): void {
    if (!this.persistencePath || !fs.existsSync(this.persistencePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.persistencePath, "utf-8")) as {
        entries?: unknown;
      };
      if (!Array.isArray(parsed.entries)) return;
      for (const raw of parsed.entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as CallbackOutboxEntry;
        if (typeof entry.outbox_id === "string" && entry.outbox_id.length > 0) {
          this.entries.set(entry.outbox_id, entry);
        }
      }
    } catch {
      // A corrupt local outbox file should not crash the coordinator at boot;
      // new entries continue in memory and the bad file is overwritten on next mutation.
      this.entries.clear();
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    const dir = path.dirname(this.persistencePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.persistencePath}.tmp`;
    const payload = {
      schema_version: "callback-outbox/v1",
      entries: Array.from(this.entries.values()),
    };
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf-8");
    fs.renameSync(tmp, this.persistencePath);
  }
}
