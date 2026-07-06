// web-viewer-sample/src/console/modelData/useMinioFolder.ts
// MD 三頁合一 Task 3：左欄檔案樹的 folder 抓取層。原文搬移自 pages.tsx MinioDataPage 的
// folderCacheRef / stalePrefixes / loadGenRef / load / SSE effect / prefix state＋mount effect /
// refreshCurrent，收斂成單一責任 hook（folder 抓取與快取），供受控純呈現的 MinioTreePane 消費。
// 誠實鐵律語意保留：世代守門防競態誤蓋、SSE dirty signal best-effort、error 態可重試、快取命中不重打。
// 註：records / recordsTruncated / loadRecordsErr 屬 Task 2 useConversionData（chip 資料），不在本 hook；
//     由殼層（Task 6）餵入 MinioTreePane 的 props，本 hook 只管 folder 導覽。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  coordinatorClient,
  type MinioChangeEvent,
  type MinioFolderListing,
} from "../coordinatorClient";

export interface MinioFolderState {
  folder: MinioFolderListing | null; prefix: string; loading: boolean; err: string | null;
  stalePrefixes: Set<string>;
  navigate(prefix: string): void;   // enterFolder/goUp 共用（goUp 由 pane 算父層後呼叫）
  refreshCurrent(): void;
}

export function useMinioFolder(): MinioFolderState {
  const [folder, setFolder] = useState<MinioFolderListing | null>(null);
  const [prefix, setPrefix] = useState(""); // 當前層 prefix（spec §2.5：點資料夾換 prefix）
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const folderCacheRef = useRef(new Map<string, MinioFolderListing>());
  const [stalePrefixes, setStalePrefixes] = useState<Set<string>>(() => new Set());

  // 世代守門（quality Important）：掛載時「導覽 effect 的 setPrefix」會與「prefix 變更即重載 effect」併發兩個
  // getMinioFolder（根層＋導覽目標層）。真實 S3 根層需逐一序列 probe 子資料夾 has_source_ifc、通常比葉層慢，
  // 無守門則其晚到的回應會蓋掉已導覽的正確 folder → folder.prefix 退回 ""、verify 假 not_found。每次 load
  // 認領一個遞增世代；回應落地時若已被更新的 load 取代（世代不符）即丟棄，不覆蓋畫面/錯誤/loading。
  const loadGenRef = useRef(0);
  const load = useCallback(async (p: string, options?: { refresh?: boolean }) => {
    const myGen = ++loadGenRef.current;
    if (!options?.refresh) {
      const cached = folderCacheRef.current.get(p);
      if (cached) {
        setFolder(cached);
        setErr(null);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setErr(null);
    try {
      const res = options?.refresh
        ? await coordinatorClient.getMinioFolder(p, { refresh: true })
        : await coordinatorClient.getMinioFolder(p);
      folderCacheRef.current.set(p, res); // 回應對 prefix p 恆為有效資料，無論世代皆可入快取
      if (loadGenRef.current !== myGen) return; // 已被更新的 load 取代 → 不覆蓋當前畫面(防競態誤蓋)
      setFolder(res);
      setStalePrefixes((prev) => {
        if (!prev.has(p)) return prev;
        const next = new Set(prev);
        next.delete(p);
        return next;
      });
    } catch (e) {
      if (loadGenRef.current !== myGen) return; // 過期錯誤不覆蓋較新 load 的成功結果
      setErr(String(e));
    } finally {
      if (loadGenRef.current === myGen) setLoading(false); // 僅最新 load 解除 loading，避免過期 load 提早關閉
    }
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") return undefined;
    const source = new EventSource(coordinatorClient.minioEventsUrl());
    const onChanged = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as MinioChangeEvent;
        if (!Array.isArray(payload.prefixes)) return;
        const prefixes = payload.prefixes.filter((p): p is string => typeof p === "string");
        for (const p of prefixes) folderCacheRef.current.delete(p);
        if (prefixes.length === 0) return;
        setStalePrefixes((prev) => {
          const next = new Set(prev);
          for (const p of prefixes) next.add(p);
          return next;
        });
      } catch {
        // SSE dirty signal 是 best-effort；payload 壞掉時保留現有畫面，手動 refresh 仍可取真實 list。
      }
    };
    source.addEventListener("minio.changed", onChanged);
    return () => {
      source.removeEventListener("minio.changed", onChanged);
      source.close();
    };
  }, []);

  useEffect(() => {
    void load(prefix);
  }, [load, prefix]);

  const refreshCurrent = useCallback(() => {
    folderCacheRef.current.delete(prefix);
    void load(prefix, { refresh: true });
  }, [load, prefix]);

  return {
    folder,
    prefix,
    loading,
    err,
    stalePrefixes,
    navigate: setPrefix, // enterFolder（f.prefix）與 goUp（pane 算父層）共用
    refreshCurrent,
  };
}
