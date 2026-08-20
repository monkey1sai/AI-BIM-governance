import crypto from "node:crypto";
import {
  assertRefAllowed,
  buildMinioRef,
  parseGovernedPrefix,
  SourceBundleObjectTooLargeError,
  versionPrefixesFromObjects,
  type PutIfAbsentOutcome,
  type SourceBundleAllowlist,
  type SourceBundleObjectPort,
  type VersionedObjectHead,
  type VersionedObjectSummary,
} from "../../src/services/lineage/sourceBundleObjectPort.js";
import type { ParsedRef } from "../../src/services/lineage/minioLocator.js";

/**
 * `SourceBundleObjectPort` 的 in-memory fake（seam 的第二個 adapter；production 為
 * `src/services/lineage/sourceBundleObjectPort.ts` 的真 S3 adapter）。
 *
 * 與 `tests/helpers/fakeObjectStore.ts` 同一慣例：**不 `vi.mock` 模組**，
 * governed validator／legacy preview 的編排全走真實碼，只有 S3 存取被替換。
 *
 * 誠實註：分頁（KeyMarker／VersionIdMarker）與 ListObjectVersions 的 XML 解析屬真
 * adapter 的 implementation，fake 不重演。allowlist gate 則刻意共用
 * production 的 `assertRefAllowed`，這樣「fail-closed allowlist」是同一份程式碼
 * 在兩個 adapter 上被驗證，而不是 fake 自己寫一個寬鬆版本。
 */
export interface FakeStoredObject {
  authority: string;
  bucket: string;
  objectKey: string;
  versionId: string;
  /** 未指定時取 `sha256(bytes)` 前 32 hex（形狀近似 MinIO 的 non-multipart ETag）。 */
  etag: string;
  /** 未指定時取 `bytes.length`；顯式指定可製造 size_mismatch 場景。 */
  sizeBytes: number;
  bytes: Buffer;
}

export interface SeedObjectInput {
  authority: string;
  bucket: string;
  objectKey: string;
  versionId: string;
  bytes: Buffer | string;
  etag?: string;
  sizeBytes?: number;
}

export interface FakeSourceBundleObjectPort extends SourceBundleObjectPort {
  objects: FakeStoredObject[];
  headCalls: number;
  sha256Calls: number;
  getBytesCalls: number;
  listCalls: number;
  /** 任何會改變 store 的呼叫都必須讓這個計數器動——preview 的 `mutates_store:false` 靠它當機器證據。 */
  writeCalls: number;
  destroyCalls: number;
  /** 播種一個 object，回傳它的 governed locator 字串。 */
  seed(input: SeedObjectInput): string;
  /** 取一個已播種 object 的 governed locator 字串。 */
  refOf(objectKey: string): string;
}

function fakeEtag(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

export function createFakeSourceBundleObjectPort(
  allow: SourceBundleAllowlist,
): FakeSourceBundleObjectPort {
  const port: FakeSourceBundleObjectPort = {
    objects: [],
    headCalls: 0,
    sha256Calls: 0,
    getBytesCalls: 0,
    listCalls: 0,
    writeCalls: 0,
    destroyCalls: 0,

    seed(input: SeedObjectInput): string {
      const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes, "utf-8");
      const stored: FakeStoredObject = {
        authority: input.authority,
        bucket: input.bucket,
        objectKey: input.objectKey,
        versionId: input.versionId,
        etag: input.etag ?? fakeEtag(bytes),
        sizeBytes: input.sizeBytes ?? bytes.length,
        bytes,
      };
      port.objects.push(stored);
      return buildMinioRef({
        authority: stored.authority,
        bucket: stored.bucket,
        objectKey: stored.objectKey,
        versionId: stored.versionId,
      });
    },

    refOf(objectKey: string): string {
      const hit = port.objects.find((object) => object.objectKey === objectKey);
      if (!hit) throw new Error(`fake object store has no object with key ${objectKey}`);
      return buildMinioRef({
        authority: hit.authority,
        bucket: hit.bucket,
        objectKey: hit.objectKey,
        versionId: hit.versionId,
      });
    },

    async headVersioned(ref: ParsedRef): Promise<VersionedObjectHead | null> {
      port.headCalls += 1;
      assertRefAllowed(ref, allow);
      const hit = find(port.objects, ref);
      if (!hit) return null;
      return { etag: hit.etag, sizeBytes: hit.sizeBytes, versionId: hit.versionId };
    },

    async sha256Versioned(ref: ParsedRef): Promise<string> {
      port.sha256Calls += 1;
      assertRefAllowed(ref, allow);
      const hit = find(port.objects, ref);
      if (!hit) throw new Error(`fake object store has no object version ${ref.versionId}`);
      return crypto.createHash("sha256").update(hit.bytes).digest("hex");
    },

    async getBytesVersioned(ref: ParsedRef, maxBytes: number): Promise<Buffer> {
      port.getBytesCalls += 1;
      assertRefAllowed(ref, allow);
      const hit = find(port.objects, ref);
      if (!hit) throw new Error(`fake object store has no object version ${ref.versionId}`);
      if (hit.bytes.length > maxBytes) {
        throw new SourceBundleObjectTooLargeError(ref.objectKey, maxBytes);
      }
      return Buffer.from(hit.bytes);
    },

    async putIfAbsent(
      ref: Omit<ParsedRef, "versionId">,
      body: Buffer,
      _contentType: string,
    ): Promise<PutIfAbsentOutcome> {
      port.writeCalls += 1;
      assertRefAllowed(ref, allow);
      const existing = port.objects.find(
        (object) =>
          object.authority === ref.authority &&
          object.bucket === ref.bucket &&
          object.objectKey === ref.objectKey,
      );
      // conditional create（If-None-Match: *）：已存在就衝突，絕不覆寫。
      if (existing) return { outcome: "conflict_existing_manifest" };
      const versionId = `v-fake-${port.objects.length + 1}`;
      port.objects.push({
        authority: ref.authority,
        bucket: ref.bucket,
        objectKey: ref.objectKey,
        versionId,
        etag: fakeEtag(body),
        sizeBytes: body.length,
        bytes: Buffer.from(body),
      });
      return { outcome: "created", versionId };
    },

    async listVersionPrefixes(prefix: string): Promise<string[]> {
      return versionPrefixesFromObjects(await port.listObjectsUnder(prefix));
    },

    async listObjectsUnder(prefix: string): Promise<VersionedObjectSummary[]> {
      port.listCalls += 1;
      const parsed = parseGovernedPrefix(prefix.replace(/\/$/, ""));
      assertRefAllowed(parsed, allow);
      const keyPrefix = prefix.endsWith("/")
        ? `${parsed.keyPrefix}/`.replace(/\/+$/, "/")
        : parsed.keyPrefix;
      return port.objects
        .filter(
          (object) =>
            object.authority === parsed.authority &&
            object.bucket === parsed.bucket &&
            object.objectKey.startsWith(keyPrefix),
        )
        .map((object) => ({
          ref: buildMinioRef({
            authority: object.authority,
            bucket: object.bucket,
            objectKey: object.objectKey,
            versionId: object.versionId,
          }),
          authority: object.authority,
          bucket: object.bucket,
          objectKey: object.objectKey,
          versionId: object.versionId,
          etag: object.etag,
          sizeBytes: object.sizeBytes,
        }))
        .sort((a, b) => a.objectKey.localeCompare(b.objectKey));
    },

    destroy(): void {
      port.destroyCalls += 1;
    },
  };
  return port;
}

function find(objects: FakeStoredObject[], ref: ParsedRef): FakeStoredObject | undefined {
  return objects.find(
    (object) =>
      object.authority === ref.authority &&
      object.bucket === ref.bucket &&
      object.objectKey === ref.objectKey &&
      object.versionId === ref.versionId,
  );
}
