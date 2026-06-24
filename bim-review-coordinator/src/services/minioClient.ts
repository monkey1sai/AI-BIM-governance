// bim-review-coordinator/src/services/minioClient.ts
// minio-closed-loop-phase1 Task 4：共用 S3Client 工廠 + list/role 純函式。
// 不改 minioWatcher.ts；複用 deriveIntakeFromKey 判角色 + 擋路徑穿越。
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { deriveIntakeFromKey } from "./minioWatcher.js";

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
