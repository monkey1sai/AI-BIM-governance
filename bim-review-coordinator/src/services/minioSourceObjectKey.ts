/**
 * 從 intake job 的 `source_ifc_ref` 還原 MinIO object key。
 *
 * 為何需要這一層：ConversionLedger 的 `object_key` 在 Phase 1 就宣告可為 null（見
 * conversionLedger.ts 型別註解），而落地的 ledger 紀錄實際上全為 null。列表端點若只讀
 * ledger，`source_object_key` 便恆為 null，前端無從把 MinIO 物件對回 intake job。
 *
 * 支援兩種落地形狀（presigned 簽章已由 maskPresignedRef 剝除，origin+pathname 保留）：
 *   - path-style：`http(s)://<endpoint>/<bucket>/<key>`（MinIO 預設，181 實際採用）
 *   - scheme-style：`minio://<bucket>/<key>`（ifc_ready_payload 契約範例採用）
 *
 * 誠實：只在 ref 確實落在指定 bucket 底下時才還原；其餘（非 URL、別的 bucket、
 * virtual-host 形狀、壞的 percent-encoding、空 key）一律回 null——寧可缺值，不猜。
 * 呼叫端必須把 null 當「未知」而非「不相符」。
 */
export function minioObjectKeyFromSourceRef(
  ref: string | null | undefined,
  bucket: string | null | undefined,
): string | null {
  if (!ref || !bucket) return null;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null; // 非 URL（如 devstorage:filename）：無 bucket/key 結構可還原
  }
  const rawKey = url.protocol === "minio:"
    // URL 會把 authority 正規化成小寫；S3/MinIO bucket 名本就限小寫，故比對前一併下轉。
    ? (url.hostname === bucket.toLowerCase() ? url.pathname.replace(/^\//, "") : "")
    : (url.pathname.startsWith(`/${bucket}/`) ? url.pathname.slice(bucket.length + 2) : "");
  if (!rawKey) return null;
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return null; // 壞的 percent-encoding：不回吐半解碼字串
  }
}
