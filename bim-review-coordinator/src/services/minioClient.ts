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
      const role: MinioObjectRole = key.endsWith(".ifc")
        ? "source_ifc"
        : key.endsWith(".usdc")
          ? "parsed_usdc"
          : "other";
      const probeSuffix = key.endsWith(".usdc") ? "/model.usdc" : "/model.ifc";
      // badge 解析用完整 key（prefix="" 不剝前綴），spec §2.2：導到 model.ifc 才附帶語意 badge。
      const d = deriveIntakeFromKey({ key, prefix: "", keySuffix: probeSuffix });
      objects.push({
        key,
        etag: (obj.ETag ?? "").replace(/^"+|"+$/g, ""),
        role,
        idempotency_key: idempotencyKeyFor(bucket, key, obj.ETag ?? ""),
        project_id: d.ok ? d.projectId : null,
        project_display_name: d.ok ? d.projectDisplayName : null,
        category: d.ok ? d.category : null,
        version: d.ok ? d.externalModelVersionId : null,
      });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  // 對每個 CommonPrefix probe has_source_ifc（spec §2.5 第 5 點）。序列執行確保測試 stub 依呼叫順序回頁可預測。
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
      const role: MinioObjectRole = key.endsWith(".ifc")
        ? "source_ifc"
        : key.endsWith(".usdc")
          ? "parsed_usdc"
          : "other";
      // 用 .ifc 規約解析三段（同 watcher）；擋路徑穿越（deriveIntakeFromKey 拒空段 / . / ..）
      // .usdc 用 probeSuffix="/model.usdc"；.ifc 用傳入 keySuffix（照 plan Task 4 Step 3）
      const probeSuffix = key.endsWith(".usdc") ? "/model.usdc" : keySuffix;
      const d = deriveIntakeFromKey({ key, prefix, keySuffix: probeSuffix });
      out.push({
        key,
        etag: (obj.ETag ?? "").replace(/^"+|"+$/g, ""),
        role,
        idempotency_key: idempotencyKeyFor(bucket, key, obj.ETag ?? ""),
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
