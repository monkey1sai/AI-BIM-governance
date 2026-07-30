import type { ObjectStorePort } from "../../src/services/minioObjectStore.js";

/**
 * ObjectStorePort 的 in-memory fake（seam 的第二個 adapter；production 為
 * services/minioObjectStore.ts 的真 S3 adapter）。watcher/toggle 測試以此取代舊的
 * 「vi.mock 整個 minioWatcher 模組」與「本地 XML S3 stub + 真 SDK」兩種替身：
 * 啟停編排、tick 語意、intake POST 全走真 surface，只有 S3 存取被替換。
 *
 * 誠實註：分頁（continuation token）與 XML 解析屬真 adapter 的 implementation，
 * 由 minio-object-store.test.ts 以真 SDK + XML stub 覆蓋；fake 不重演。
 */
export interface FakeObjectStore extends ObjectStorePort {
  /** 測試直接增刪（etag 可含或不含外層引號，與 ListObjectsV2 原始值同形）。 */
  objs: Array<{ key: string; etag: string }>;
  listCalls: number;
  destroyCalls: number;
  /** 模擬 list 整輪失敗（tick 應記 last_error、不 crash、續排下一輪）。 */
  failListWith: Error | null;
  /** 模擬 destroy 延遲（撐開 toggle busy 鎖窗口的測試 seam）。 */
  destroyDelayMs: number;
}

export function createFakeObjectStore(
  initial: Array<{ key: string; etag: string }> = [],
): FakeObjectStore {
  const store: FakeObjectStore = {
    objs: [...initial],
    listCalls: 0,
    destroyCalls: 0,
    failListWith: null,
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
