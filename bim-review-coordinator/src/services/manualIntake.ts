// bim-review-coordinator/src/services/manualIntake.ts
// 一鍵手動觸發（spec §3.3）：走「手動 webhook intake 等效路徑」(design §3.3:120 /
// openspec minio-watch-auto-intake delta:11)——不自寫 ledger detected（那是 dead-end：
// 無 consumer 推進、且會 poison watcher 去重水印），而是構 ifc_ready body、loopback
// POST {selfBaseUrl}/api/external/ifc-ready，由既有下載/sanitize/dispatch/callback 鏈處理；
// ledger 由 intake 端落 queued。idempotency/correlation key 與 watcher.triggerIntake 完全同源
// （idempotencyKeyFor/correlationIdFor），故同物件手動觸發後 watcher 命中 ledger 正確 skip
// （非 poisoning，因為此時已有真 dispatch 的 job）。重用 watcher 的 exported 純零件，但不 import
// triggerIntake（它是 startMinioWatcher 內私有 closure）；server-side 生 presigned（不外洩給呼叫端）。
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createMinioS3Client } from "./minioClient.js";
import { deriveIntakeFromKey, idempotencyKeyFor, correlationIdFor } from "./minioWatcher.js";

export interface ManualIntakeConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  keySuffix: string; // 規約：/model.ifc
  // loopback intake base（如 http://127.0.0.1:8004）；route 由 server.address() 算出，
  // 與 watcher selfBaseUrl 同源。手動觸發自打此 base 的 /api/external/ifc-ready。
  selfBaseUrl: string;
  // 既有 webhook secret（config.externalIntakeWebhookSecret）；intake 端 authProvider 驗。
  webhookSecret: string;
  // intake payload 的 tenant_id（config.minioWatchTenantId）。
  tenantId: string;
  // intake POST 逾時（ms），default 10_000（比照 watcher，防 app 不回應而永久 await）。
  intakeTimeoutMs?: number;
}

export type ManualIntakeResult =
  | { ok: true; idempotency_key: string; status: string }
  | { ok: false; reason: string };

/**
 * 對 bucket 下 {prefix}model.ifc 觸發轉檔意圖：驗 key 規約（≥3 段、拒空段/. / ..）→ 算 idempotency_key
 * → server-side 生 presigned GET（不外洩給呼叫端）→ 構 ifc_ready body → loopback POST
 * `{selfBaseUrl}/api/external/ifc-ready`（帶 X-Webhook-Secret / X-Correlation-Id / X-Idempotency-Key）。
 * 由既有 intake 鏈下載/sanitize/dispatch 並落 ledger（status=queued）；本函式不自寫 ledger。
 * 冪等：同 key 同 etag → 同 idempotency_key → intake 端對既有 job 回 idempotent_replay，不重複建 job。
 * 誠實鐵律：回應只表達真實 dispatch 結果（intake 回 4xx/5xx 或 download_status=failed → ok:false）。
 */
export async function triggerManualIntake(
  key: string,
  etag: string,
  cfg: ManualIntakeConfig,
  now: string,
): Promise<ManualIntakeResult> {
  void now; // ledger 落帳已移交 intake 端（用其自身時鐘）；保留參數簽名相容呼叫端，標記未用避免誤解。
  const derived = deriveIntakeFromKey({ key, prefix: "", keySuffix: cfg.keySuffix });
  if (!derived.ok) return { ok: false, reason: derived.reason };

  // presigned 僅供 converter（經 intake 鏈）取檔；本函式不回傳此 URL（誠實鐵律：不外洩簽章）。
  let presignedRef: string;
  const client = createMinioS3Client({ endpoint: cfg.endpoint, accessKey: cfg.accessKey, secretKey: cfg.secretKey });
  try {
    presignedRef = await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: 3600 });
  } catch (err) {
    return { ok: false, reason: `presign failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    client.destroy();
  }

  // idempotency / correlation key 與 watcher.triggerIntake 同源 → 同物件手動觸發後 watcher 命中 ledger skip。
  const idemKey = idempotencyKeyFor(cfg.bucket, key, etag);
  const corrId = correlationIdFor(cfg.bucket, key, etag);
  const etagShort = derived.sourceEtagFrom(etag).slice(0, 8);
  const body = {
    event: "ifc_ready",
    tenant_id: cfg.tenantId,
    project_id: derived.projectId,
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

  const intakeTimeoutMs = cfg.intakeTimeoutMs && cfg.intakeTimeoutMs > 0 ? cfg.intakeTimeoutMs : 10_000;
  try {
    const resp = await fetch(`${cfg.selfBaseUrl}/api/external/ifc-ready`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": cfg.webhookSecret,
        "X-Correlation-Id": corrId,
        "X-Idempotency-Key": idemKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(intakeTimeoutMs),
    });
    const text = await resp.text();
    if (resp.status >= 400) {
      // intake 4xx/5xx（含下載失敗 502 download_status=failed）→ 誠實回失敗，呼叫端 chip 維持原狀。
      return { ok: false, reason: `intake ${resp.status}: ${text.slice(0, 120)}` };
    }
    // 2xx：解析 download_status；非 JSON 視為失敗（誠實，不謊報）。
    let parsed: { download_status?: string } = {};
    try {
      parsed = JSON.parse(text || "{}") as { download_status?: string };
    } catch {
      return { ok: false, reason: `intake 2xx 非 JSON：${text.slice(0, 120)}` };
    }
    if (parsed.download_status === "failed") {
      return { ok: false, reason: "intake replay: download_status=failed（job 已建、#/conv 可見）" };
    }
    // 回 status="queued"（ConversionLedgerStatus 之一）：intake 端落帳即 queued，#/conv 下次刷新亦顯 queued
    //（dispatch_failed 只更新 job store、不動 ledger）。**不**回傳 intake 的 raw job status（如
    // queued_for_conversion）——那不是 ConversionLedgerStatus，前端 narrowConversionStatus() 會 narrow 成
    // null 導致 chip 顯 unknown（coordinatorClient.ts:319-341 契約）。回 ledger 真相值才同時誠實且契約對齊。
    return { ok: true, idempotency_key: idemKey, status: "queued" };
  } catch (err) {
    return { ok: false, reason: `intake post failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
