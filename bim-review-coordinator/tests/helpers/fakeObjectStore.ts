import { createHash } from "node:crypto";
import {
  DEFAULT_GET_OBJECT_MAX_BYTES,
  ObjectTooLargeError,
  type ObjectStorePort,
  type ObjectStreamDigest,
  type ObjectVersionHead,
} from "../../src/services/minioObjectStore.js";

/**
 * ObjectStorePort 的 in-memory fake（seam 的第二個 adapter；production 為
 * services/minioObjectStore.ts 的真 S3 adapter）。watcher/toggle 測試以此取代舊的
 * 「vi.mock 整個 minioWatcher 模組」與「本地 XML S3 stub + 真 SDK」兩種替身：
 * 啟停編排、tick 語意、intake POST 全走真 surface，只有 S3 存取被替換。
 *
 * 誠實註：分頁（continuation token）與 XML 解析屬真 adapter 的 implementation，
 * 由 minio-object-store.test.ts 以真 SDK + XML stub 覆蓋；fake 不重演。
 *
 * L3b 加性擴充：entry 多了選用的 versionId／bytes，並實作 headObjectVersioned／
 * getObjectBytes／streamSha256。既有 6 個方法（listObjects／listFolder／
 * hasKeyWithSuffix／headEtag／presign／destroy）逐字未動，既有 watcher 測試零修改。
 * 副作用備註：未設 versionId／bytes 的 entry 行為與擴充前完全相同；有設時，list 系
 * 方法的 `{ ...o }` 會一併帶出這些欄位，但 port 型別只暴露 key／etag，消費端讀不到。
 */
export interface FakeObjectEntry {
  key: string;
  /** etag 可含或不含外層引號，與 ListObjectsV2 原始值同形。 */
  etag: string;
  /** 版本控管語意：同一個 key 可放多筆不同 versionId；未設 → 該 entry 視為無版本。 */
  versionId?: string;
  /** 物件內容。未設 → getObjectBytes／streamSha256 直接拋（不以空 Buffer 冒充「有」）。 */
  bytes?: Uint8Array;
}

export interface FakeObjectStore extends ObjectStorePort {
  /** 測試直接增刪（etag 可含或不含外層引號，與 ListObjectsV2 原始值同形）。 */
  objs: FakeObjectEntry[];
  listCalls: number;
  destroyCalls: number;
  /** 模擬 list 整輪失敗（tick 應記 last_error、不 crash、續排下一輪）。 */
  failListWith: Error | null;
  /**
   * 模擬物件讀取（head/get/sha256）整輪失敗。與 failListWith 分開，才不會動到既有
   * list 測試的行為；用來驗「上游錯誤 propagate，不被謊報成 not_found」。
   */
  failObjectReadWith: Error | null;
  /** 模擬 destroy 延遲（撐開 toggle busy 鎖窗口的測試 seam）。 */
  destroyDelayMs: number;
}

export function createFakeObjectStore(
  initial: FakeObjectEntry[] = [],
): FakeObjectStore {
  /** versionId 省略 → 取該 key 的第一筆（＝「當前版本」的 fake 語意）。 */
  function findEntry(key: string, versionId?: string): FakeObjectEntry | undefined {
    return store.objs.find(
      (o) => o.key === key && (versionId === undefined || o.versionId === versionId),
    );
  }
  function readBytesOrThrow(key: string, versionId?: string): Uint8Array {
    const hit = findEntry(key, versionId);
    if (!hit || !hit.bytes) {
      // 對齊真 adapter：這兩個方法的回傳型別不含 null，缺物件／缺內容一律 throw。
      throw new Error(`fake object store: no bytes for ${key}${versionId ? `@${versionId}` : ""}`);
    }
    return hit.bytes;
  }
  const store: FakeObjectStore = {
    objs: [...initial],
    listCalls: 0,
    destroyCalls: 0,
    failListWith: null,
    failObjectReadWith: null,
    destroyDelayMs: 0,
    async listObjects(prefix: string) {
      store.listCalls += 1;
      if (store.failListWith) throw store.failListWith;
      return store.objs.filter((o) => (prefix ? o.key.startsWith(prefix) : true)).map((o) => ({ ...o }));
    },
    async listFolder(prefix: string, delimiter: string) {
      store.listCalls += 1;
      if (store.failListWith) throw store.failListWith;
      const inPrefix = store.objs.filter((o) => (prefix ? o.key.startsWith(prefix) : true));
      if (!delimiter) {
        return { commonPrefixes: [], contents: inPrefix.map((o) => ({ ...o })) };
      }
      // 語意對齊 S3 Delimiter：去 prefix 後含 delimiter 的 key roll-up 成 CommonPrefix。
      const commonPrefixes: string[] = [];
      const contents: Array<{ key: string; etag: string }> = [];
      for (const o of inPrefix) {
        const rest = o.key.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx >= 0) {
          const cp = prefix + rest.slice(0, idx + delimiter.length);
          if (!commonPrefixes.includes(cp)) commonPrefixes.push(cp);
        } else {
          contents.push({ ...o });
        }
      }
      return { commonPrefixes, contents };
    },
    async hasKeyWithSuffix(prefix: string, suffix: string) {
      if (store.failListWith) throw store.failListWith;
      return store.objs.some((o) => o.key.startsWith(prefix) && o.key.endsWith(suffix));
    },
    async headEtag(key: string) {
      const hit = store.objs.find((o) => o.key === key);
      return hit ? hit.etag.replace(/^"+|"+$/g, "") : null;
    },
    async headObjectVersioned(key: string, versionId?: string): Promise<ObjectVersionHead | null> {
      if (store.failObjectReadWith) throw store.failObjectReadWith;
      const hit = findEntry(key, versionId);
      if (!hit) return null;
      return {
        etag: hit.etag.replace(/^"+|"+$/g, ""),
        // 未備 bytes → size 不明，回 null（不以 0 冒充「空物件」，同真 adapter）。
        sizeBytes: hit.bytes ? hit.bytes.byteLength : null,
        versionId: hit.versionId ?? null,
      };
    },
    async getObjectBytes(key: string, versionId?: string, maxBytes?: number): Promise<Buffer> {
      if (store.failObjectReadWith) throw store.failObjectReadWith;
      const bytes = readBytesOrThrow(key, versionId);
      const limit = maxBytes ?? DEFAULT_GET_OBJECT_MAX_BYTES;
      if (bytes.byteLength > limit) throw new ObjectTooLargeError(key, limit, bytes.byteLength);
      return Buffer.from(bytes);
    },
    async streamSha256(key: string, versionId?: string): Promise<ObjectStreamDigest> {
      if (store.failObjectReadWith) throw store.failObjectReadWith;
      const bytes = readBytesOrThrow(key, versionId);
      // fake 的內容本來就已在記憶體，無從重演串流；摘要值與 size 必須與真 adapter 逐位元組
      // 相同（parity 由 tests/lineage/object-store-governed.test.ts 直接比對兩個 adapter）。
      return { sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength };
    },
    async presign(key: string, expiresInSeconds: number) {
      // 形狀對齊真 presigned GET URL：含物件 key 與 X-Amz-Signature query（多個既有
      // 斷言以此判「watcher 真的簽了 URL」）。
      return `http://fake-minio.local/bim-control/${key}?X-Amz-Expires=${expiresInSeconds}&X-Amz-Signature=fakesig`;
    },
    async destroy() {
      store.destroyCalls += 1;
      if (store.destroyDelayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, store.destroyDelayMs));
      }
    },
  };
  return store;
}
