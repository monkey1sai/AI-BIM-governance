// bim-review-coordinator/src/services/manualIntake.ts
// 一鍵手動觸發（spec §3.3）：重用 watcher 的 exported 純零件，但不 import triggerIntake
//（它是 startMinioWatcher 內私有 closure）。server-side 生 presigned、寫持久 ledger。
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createMinioS3Client } from "./minioClient.js";
import { deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";
import type { ConversionLedger } from "./conversionLedger.js";

export interface ManualIntakeConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  keySuffix: string; // 規約：/model.ifc
}

export type ManualIntakeResult =
  | { ok: true; idempotency_key: string; status: string }
  | { ok: false; reason: string };

/**
 * 對 bucket 下 {prefix}model.ifc 觸發轉檔意圖：驗 key 規約（≥3 段、拒空段/. / ..）→ 算 idempotency_key
 * → server-side 生 presigned GET（不外洩給呼叫端）→ upsert 持久 ledger（status=detected）。
 * 冪等：同 key 同 etag → 同 idempotency_key → upsert 命中既有不重建。
 */
export async function triggerManualIntake(
  key: string,
  etag: string,
  cfg: ManualIntakeConfig,
  ledger: ConversionLedger,
  now: string,
): Promise<ManualIntakeResult> {
  const derived = deriveIntakeFromKey({ key, prefix: "", keySuffix: cfg.keySuffix });
  if (!derived.ok) return { ok: false, reason: derived.reason };
  const client = createMinioS3Client({ endpoint: cfg.endpoint, accessKey: cfg.accessKey, secretKey: cfg.secretKey });
  try {
    // presigned 僅供 converter 取檔；本函式不回傳此 URL（誠實鐵律：不外洩簽章）。
    await getSignedUrl(client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: 3600 });
  } catch (err) {
    return { ok: false, reason: `presign failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    client.destroy();
  }
  const idkey = idempotencyKeyFor(cfg.bucket, key, etag);
  const rec = ledger.upsert(
    {
      idempotency_key: idkey,
      correlation_id: null,
      project_id: derived.projectId,
      project_display_name: derived.projectDisplayName,
      category: derived.category,
      external_model_version_id: derived.externalModelVersionId,
      conversion_job_id: null,
      status: "detected",
      object_key: key,
      bucket: cfg.bucket,
    },
    now,
  );
  return { ok: true, idempotency_key: rec.idempotency_key, status: rec.status };
}
