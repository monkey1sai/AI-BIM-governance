// bim-review-coordinator/src/services/minioClient.ts
// minio-closed-loop-phase1 Task 4：共用 S3Client 工廠 + list/role 純函式。
// 不改 minioWatcher.ts；複用 deriveIntakeFromKey 判角色 + 擋路徑穿越。
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { deriveIntakeFromKey, idempotencyKeyFor } from "./minioWatcher.js";

export function createMinioS3Client(cfg: { endpoint: string; accessKey: string; secretKey: string }): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
}

export type MinioObjectRole = "source_ifc" | "parsed_usdc" | "other";

// 最小 logger 介面（avoid 循環 import app；只用 warn）。optional 注入：
// route（app.ts）傳入真 structLog；unit 測試可傳 spy 或省略（warn 變 no-op）。
export interface MinioClientLogger {
  warn: (component: string, msg: string, data?: Record<string, unknown>) => void;
}

export interface MinioObjectView {
  key: string;
  etag: string;
  role: MinioObjectRole;
  project_id: string | null;
  project_display_name: string | null;
  category: string | null;
  version: string | null;
  idempotency_key: string;
}

export interface MinioFolderNode {
  prefix: string;          // CommonPrefix（資料夾節點絕對 prefix）
  has_source_ifc: boolean; // 該 prefix（遞迴）下是否有 .ifc 葉物件（spec §2.5 第 5 點 badge）
}

export interface MinioFolderListing {
  bucket: string;
  prefix: string;
  folders: MinioFolderNode[]; // CommonPrefixes（資料夾節點 + has_source_ifc）
  objects: MinioObjectView[]; // 當層直屬檔（被 roll-up 的子物件不在此）
  count: number;              // objects.length（誠實：非遞迴總數）
}

/**
 * 該 prefix（遞迴，不帶 Delimiter）下是否含 .ifc 葉物件（spec §2.5 第 5 點 folder badge）。
 * CommonPrefix 只回 prefix 字串、不含內容，故須對該 prefix 各發一次 list 才能誠實判定（不臆測）。
 * MaxKeys 不設上限但一旦命中 .ifc 即可早停（while-loop 找到就回 true）。
 *
 * 失敗契約（誠實鐵律，勿改）：probe 的 S3 send() 若拋例外（憑證錯 / 網路斷 / MinIO 5xx）
 * 必須**向上 propagate**，由呼叫端 listMinioFolder → /api/minio/objects route 接住回 502
 * （route 既有 try/catch，app.ts ~1206-1240）。**絕不可在此 try/catch 後回 false**——
 * 那等於把「查不到」謊報成「無 source IFC」，違反「不臆測」。寧可整頁誠實失敗 + 前端重試，
 * 也不部分降級捏造 badge。對應 regression：minio-folder-route.test.ts「probe 失敗（MinIO 5xx）」。
 */
async function prefixHasSourceIfc(client: S3Client, bucket: string, prefix: string): Promise<boolean> {
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    if ((resp.Contents ?? []).some((o) => o.Key?.endsWith(".ifc"))) return true;
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return false;
}

/**
 * 資料夾語意 list（spec §2.1）：帶 Delimiter='/' → CommonPrefixes 為資料夾、Contents 為當層直屬檔。
 * 單層仍處理 IsTruncated（while-loop 全拉，超 1000 子前綴/物件不截斷，AC-D2）。
 * 對每個 .ifc 物件附 idempotency_key 供前端 chip 對 ledger lookup（spec §3.3 路徑 A）。
 * 對每個 CommonPrefix 再 probe 一次取 has_source_ifc（spec §2.5 第 5 點 folder badge）。
 * 永不回 presigned URL（MinioObjectView 無 url 欄）。
 */
export async function listMinioFolder(
  client: S3Client,
  bucket: string,
  prefix: string,
  delimiter: string,
  logger?: MinioClientLogger,
): Promise<MinioFolderListing> {
  const prefixSet: string[] = [];
  const objects: MinioObjectView[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        Delimiter: delimiter || undefined,
        ContinuationToken: token,
      }),
    );
    for (const cp of resp.CommonPrefixes ?? []) {
      if (cp.Prefix) prefixSet.push(cp.Prefix);
    }
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const key = obj.Key;
      // q3-pipe-guard：key 含 '|' 與 idempotencyKeyFor 的 bucket|key|etag 分隔符衝突
      // （minioWatcher.ts:22-28 precondition），可能撞 hash → idempotent_replay 靜默丟棄。
      // 對齊 watcher precondition：跳過該物件 + warn，不讓壞 key 進回應誤導前端 chip 對帳。
      if (key.includes("|")) {
        logger?.warn("minioClient", "skip object key containing '|' (idempotency key collision risk)", {
          bucket,
          key,
        });
        continue;
      }
      const role: MinioObjectRole = key.endsWith(".ifc")
        ? "source_ifc"
        : key.endsWith(".usdc")
          ? "parsed_usdc"
          : "other";
      // etag 統一去引號一次，同一值同時供 etag 欄位與 idempotency_key（idempotencyKeyFor 內部
      // 的 stripEtagQuotes 對已去引號值冪等，hash 不變；避免 line 之間「去/未去引號」雙狀態陷後人）。
      const etag = (obj.ETag ?? "").replace(/^"+|"+$/g, "");
      // badge 解析三路分流（spec §2.2：只對 .ifc / .usdc 導到 model.* 才附語意 badge）：
      // role='other' 直接 ok:false 跳過 deriveIntakeFromKey，不用 /model.ifc 強行解析（意圖明確、
      // 防未來改 probeSuffix 邏輯時 other 物件意外拿到 badge）。prefix="" → 用完整 key 解析。
      const d = role === "source_ifc"
        ? deriveIntakeFromKey({ key, prefix: "", keySuffix: "/model.ifc" })
        : role === "parsed_usdc"
          ? deriveIntakeFromKey({ key, prefix: "", keySuffix: "/model.usdc" })
          : { ok: false as const };
      objects.push({
        key,
        etag,
        role,
        idempotency_key: idempotencyKeyFor(bucket, key, etag),
        project_id: d.ok ? d.projectId : null,
        project_display_name: d.ok ? d.projectDisplayName : null,
        category: d.ok ? d.category : null,
        version: d.ok ? d.externalModelVersionId : null,
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  // 對每個 CommonPrefix probe has_source_ifc（spec §2.5 第 5 點）。
  // 設計決定＝序列：(1) 測試 stub 依呼叫順序回頁可預測；(2) 真實生產頂層資料夾數量小且穩定
  // ——spec §1.1 實測 bim-control 頂層僅 7 個（洲際好宅 / 測試建案0329 / 東勢區許良宇紀念圖書館 /
  // IOTTEST / Demo展示社區-1 / 測試建案0321 / annotations），≤7 次序列 probe（命中即早停）延遲可接受
  // （spec §2.4 已誠實量化，未承諾 probe 延遲上限）。可接受上限約 10-15 個；**頂層資料夾數若可能 >10-15
  // 才改 Promise.all**（屆時測試 stub 須由「依呼叫序號分頁」改為「以 prefix 為 key dispatch」，因 parallel 後順序不定）。
  const folders: MinioFolderNode[] = [];
  for (const p of prefixSet) {
    folders.push({ prefix: p, has_source_ifc: await prefixHasSourceIfc(client, bucket, p) });
  }
  return { bucket, prefix, folders, objects, count: objects.length };
}

export async function listMinioObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  keySuffix: string,
  logger?: MinioClientLogger,
): Promise<MinioObjectView[]> {
  const out: MinioObjectView[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      const key = obj.Key;
      // q3-pipe-guard：key 含 '|' 與 idempotencyKeyFor 的 bucket|key|etag 分隔符衝突
      // （minioWatcher.ts:22-28 precondition），可能撞 hash → idempotent_replay 靜默丟棄。
      // 對齊 watcher precondition：跳過該物件 + warn。
      if (key.includes("|")) {
        logger?.warn("minioClient", "skip object key containing '|' (idempotency key collision risk)", {
          bucket,
          key,
        });
        continue;
      }
      const role: MinioObjectRole = key.endsWith(".ifc")
        ? "source_ifc"
        : key.endsWith(".usdc")
          ? "parsed_usdc"
          : "other";
      // etag 統一去引號一次，同一值同時供 etag 欄位與 idempotency_key（idempotencyKeyFor 內部
      // 的 stripEtagQuotes 對已去引號值冪等，hash 不變；避免「去/未去引號」雙狀態陷後人）。
      const etag = (obj.ETag ?? "").replace(/^"+|"+$/g, "");
      // 解析三段（同 watcher）；擋路徑穿越（deriveIntakeFromKey 拒空段 / . / ..）。
      // 三路分流：.ifc 用傳入 keySuffix（照 plan Task 4 Step 3）、.usdc 用 /model.usdc、
      // role='other' 直接 ok:false 跳過 deriveIntakeFromKey（不用 keySuffix 強行解析）。
      const d = role === "source_ifc"
        ? deriveIntakeFromKey({ key, prefix, keySuffix })
        : role === "parsed_usdc"
          ? deriveIntakeFromKey({ key, prefix, keySuffix: "/model.usdc" })
          : { ok: false as const };
      out.push({
        key,
        etag,
        role,
        idempotency_key: idempotencyKeyFor(bucket, key, etag),
        project_id: d.ok ? d.projectId : null,
        project_display_name: d.ok ? d.projectDisplayName : null,
        category: d.ok ? d.category : null,
        version: d.ok ? d.externalModelVersionId : null,
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}
