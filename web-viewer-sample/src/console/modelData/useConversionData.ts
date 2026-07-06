// web-viewer-sample/src/console/modelData/useConversionData.ts
// MD 三頁合一 Task 2：轉檔四源資料層 hook。抽自 pages.tsx ConversionSchedulingPage 的資料抓取邏輯
//（state 宣告、load、loadRecords、mount effect、history effect），原文搬移，僅四處變更：
//  (a) 包成 hook 回傳 ConversionData 物件（供 Task 4/5/6 共用單一份資料）。
//  (b) getConversionRecords(50) → 100（對齊 M 頁上限，去重後單一份 records 三處共用）。
//  (c) 新增衍生值 recordsIncomplete = recordsTruncated || 載入失敗旗標（M 頁 loadRecordsErr 語意併入）。
//  (d) loadRecords 的 catch 同時設 recErr（CV 語意）與 loadRecordsErr 旗標（M 語意）。
// 誠實鐵律語意保留：截斷 → truncated 旗標；成功或失敗都 settle 過才算 loaded；兩端點錯誤互不污染。
import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n";
import {
  coordinatorClient,
  type ConversionRecord,
  type DevConversionRecord,
  type IfcReadyListItem,
  type MinioWatchStatus,
} from "../coordinatorClient";

// Task 4/5/6 依賴的資料介面（欄位順序/命名與 brief §7 逐字一致）。
export interface ConversionData {
  jobs: IfcReadyListItem[];
  jobsErr: string | null;
  jobsTruncated: boolean;
  jobsLoaded: boolean;
  records: ConversionRecord[];
  recErr: string | null;
  recordsTruncated: boolean;
  recordsLoaded: boolean;
  recordsIncomplete: boolean; // = recordsTruncated || 載入失敗
  mw: MinioWatchStatus | null;
  mwErr: string | null;
  history: DevConversionRecord[] | null;
  historyErr: boolean;
  busy: boolean;
  load(): Promise<{ jobsOk: boolean; mwOk: boolean }>; // ifc-ready + watcher（allSettled，錯誤獨立）
  loadRecords(): Promise<void>;                        // ledger（獨立錯誤）
}

export function useConversionData(): ConversionData {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  // 持久 ConversionLedger 資料（getConversionRecords），獨立於 ifc-ready jobs。
  const [records, setRecords] = useState<ConversionRecord[]>([]);
  const [recErr, setRecErr] = useState<string | null>(null);
  const [mw, setMw] = useState<MinioWatchStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mwErr, setMwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // jobs（listIfcReady 50）與 records（getConversionRecords 100）都有回傳窗上限；count（slice 前總數）>
  // items.length 即被截斷。截斷時接收端查無 key 應退 indeterminate（可能有但看不到），不誤報 not_found。
  const [jobsTruncated, setJobsTruncated] = useState(false);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  // jobsLoaded/recordsLoaded：明確標記「至少 settle 過一次（成功或失敗皆算）」，未 settle 前一律
  // indeterminate；否則 mount 後第一個 render 的空狀態會與「已查過、確認不存在」不可分。
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  // 變更點 (c)(d)：M 頁 loadRecordsErr 語意併入——records 載入失敗旗標，與 recErr 各自獨立記錄。
  // 對外併成 recordsIncomplete = recordsTruncated || loadRecordsErr，避免把「看不到」當「沒轉」。
  const [loadRecordsErr, setLoadRecordsErr] = useState(false);

  // 回傳兩端點各自抓取成功與否（jobsOk / mwOk）：呼叫端（Task 4 runAction）用它判斷控制動作後的證據型
  // 刷新是否真取得新狀態。load() 自身對兩端點 allSettled 不 throw（避免 mount/Refresh 未捕捉），故以
  // 回傳值（非 throw）讓呼叫端可辨「POST 成功但重抓失敗」這條分支。
  const load = useCallback(async (): Promise<{ jobsOk: boolean; mwOk: boolean }> => {
    setBusy(true); setErr(null); setMwErr(null);
    // 兩個端點獨立 settle：minio-watch/status 失敗不污染 ifc-ready；各自有獨立錯誤 state。
    const [jobsRes, mwRes] = await Promise.allSettled([
      coordinatorClient.listIfcReady(50),
      coordinatorClient.minioWatchStatus(),
    ]);
    const jobsOk = jobsRes.status === "fulfilled";
    const mwOk = mwRes.status === "fulfilled";
    if (jobsRes.status === "fulfilled") {
      setJobs(jobsRes.value.items);
      // count（slice 前總數）> items.length 即被回傳窗上限截斷 → 供接收端重驗誠實退 indeterminate。
      setJobsTruncated(jobsRes.value.count > jobsRes.value.items.length);
    } else setErr(`${t("未連線 coordinator /api/external/ifc-ready：", "Not connected to coordinator /api/external/ifc-ready: ")}${String(jobsRes.reason)}`);
    setJobsLoaded(true); // 成功或失敗都算 settle 過一次；接收端重驗不再誤把「還沒抓完」當「查無」
    if (mwRes.status === "fulfilled") setMw(mwRes.value);
    else setMwErr(`${t("未連線 coordinator /api/external/minio-watch/status：", "Not connected to coordinator /api/external/minio-watch/status: ")}${String(mwRes.reason)}`);
    setBusy(false);
    return { jobsOk, mwOk };
  }, []);
  // 獨立抓取 ConversionLedger，不阻塞 load() 流程。setRecErr(null) 在本 callback 開頭清；不與 setErr
  //（ifc-ready 錯誤）共用，誤差各自獨立。
  const loadRecords = useCallback(async (): Promise<void> => {
    setRecErr(null);
    try {
      const res = await coordinatorClient.getConversionRecords(100); // 變更點 (b)：50 → 100，對齊 M 頁上限
      setRecords(res.items);
      // records 被回傳窗上限截斷（count > items.length）→ 查無 key 時退 indeterminate 而非 not_found。
      setRecordsTruncated(res.count > res.items.length);
      setLoadRecordsErr(false); // 成功載入 → 清除前次失敗旗標
    } catch (e) {
      // 變更點 (d)：同時設 recErr（CV 誠實錯誤訊息）與 loadRecordsErr 旗標（M chip 退 indeterminate）。
      setRecErr(`未連線 coordinator /api/conversion/records：${String(e)}`);
      setLoadRecordsErr(true);
    } finally {
      setRecordsLoaded(true); // 成功或失敗都算 settle 過一次，接收端重驗才有依據判斷「真的查無」
    }
  }, []);
  // mount 時同時觸發 load()（ifc-ready + watcher）與 loadRecords()（ledger），獨立並行。
  useEffect(() => { void load(); void loadRecords(); }, [load, loadRecords]);
  // 轉檔歷史 panel 資料源，獨立於 ledger/ifc-ready，讀既有 GET /api/dev/conversions（conversion service
  // 側 job 歷史 pass-through，非 coordinator ledger）。historyErr 與 recErr/err 各自獨立：失敗只影響本
  // panel 誠實顯示「未取得」，不污染其他 Panel。
  const [history, setHistory] = useState<DevConversionRecord[] | null>(null);
  const [historyErr, setHistoryErr] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getConversionsHistory()
      .then((r) => { if (alive) { setHistory(r.items); setHistoryErr(false); } })
      .catch(() => { if (alive) { setHistory(null); setHistoryErr(true); } });
    return () => { alive = false; };
  }, []);

  // 變更點 (c)：recordsIncomplete = recordsTruncated || 載入失敗（M 頁 L1855 recordsTruncated||loadRecordsErr）。
  const recordsIncomplete = recordsTruncated || loadRecordsErr;

  return {
    jobs, jobsErr: err, jobsTruncated, jobsLoaded,
    records, recErr, recordsTruncated, recordsLoaded, recordsIncomplete,
    mw, mwErr,
    history, historyErr,
    busy,
    load, loadRecords,
  };
}
