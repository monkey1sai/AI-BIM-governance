// web-viewer-sample/src/console/modelData/ModelDataPage.tsx
// 模型庫 · IFC / USDC（側欄同名按鈕的唯一頁面）。把「模型資料與轉檔」與「RVT → IFC → USDC 對齊報表」合成一條流程：
//   ① 選擇模型（左欄檔案樹）→ ② 轉檔成 USDC（ReconversionPanel）→ ③ 檢查對齊結果（AlignmentResultSection）。
// 頁面只做五件事，不重複 pane 的邏輯：
//   (1) 頂端三步驟指引：依選檔、轉檔紀錄與報表狀態告訴使用者現在該做什麼。
//   (2) 主從雙欄：左＝MinioTreePane；右＝未選檔時的引導（最近轉檔結果＋收合的全域佇列）／已選檔時的 ObjectDetailPane。
//   (3) 選檔 state（selectedKey → selectedObj；folder 重載後查無物件則自動回引導，誠實不顯 stale 詳情）。
//   (4) handoff 統一接收（§3.4）：job_id 向 jobs 重驗；minio_key/prefix 向 folder 重驗並導覽，minio_key 驗到後自動開啟；
//       conversion_id 單獨出現時向 records 重驗，與 minio_key 同時出現時代表「要看的那次轉檔」，交給第③步；皆無 → not_applicable。
//   (5) 頁尾收合的說明 Panel（DEMO bucket layout ＋ 與功能頁的關係，DEMO 標示照舊）。
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { Field, Panel, ProvTag } from "../components";
import { useIncomingHandoff, IncomingHandoffBanner } from "../incomingHandoff";
import { useConversionData } from "./useConversionData";
import { useMinioFolder } from "./useMinioFolder";
import { MinioTreePane } from "./MinioTreePane";
import { GlobalConversionPane } from "./GlobalConversionPane";
import { ObjectDetailPane } from "./ObjectDetailPane";
import { RecentReports } from "./RecentReports";
import { deriveWorkflowSteps } from "./stepProgress";
import { WorkflowSteps } from "./WorkflowSteps";
import type { ConvertProgressChange } from "./ReconversionPanel";
import type { ResultProgressChange } from "./AlignmentResultSection";
import "./model-library.css";

type Keyed<T> = { key: string; change: T };

const folderOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);

export function ModelDataPage(): JSX.Element {
  const data = useConversionData();
  const fs = useMinioFolder();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // selectedObj 由當前 folder.objects 導出：folder 重載後查無（物件被刪）→ null 自動回引導（誠實不顯 stale 詳情）。
  // selectedKey 仍保留，若使用者重新導覽回該層且物件仍在，詳情可再現。
  const selectedObj = fs.folder?.objects.find((o) => o.key === selectedKey) ?? null;

  // handoff 統一接收（spec §4.2 接收端重驗鐵律）：selfAxis="minio"。分支優先序：
  // job_id → minio_key → prefix → conversion_id；查無且該來源窗被截斷 → 誠實 indeterminate（未明），
  // 查無且未截斷 → 誠實 not_found，絕不靜默 fallback。皆無 → not_applicable（中性，非警示）。
  const incoming = useIncomingHandoff("minio", (h) => {
    // job_id → jobs（ifc-ready）重驗（CV 語意）。
    if (h.job_id) {
      if (!data.jobsLoaded) return "indeterminate";
      if (data.jobs.some((j) => j.ifc_ready_job_id === h.job_id || j.conversion_job_id === h.job_id)) return true;
      return data.jobsTruncated ? "indeterminate" : false;
    }
    // minio_key → folder.objects 重驗（M 語意；先由下方 effect 導覽到該層）。
    if (h.minio_key) {
      if (fs.folder === null) return "indeterminate"; // 該層尚未載入 → 中性 indeterminate，不誤閃 not_found
      return fs.folder.objects.some((o) => o.key === h.minio_key);
    }
    // prefix → folder 重驗（M 語意；保留能力，供「純資料夾回看」）。
    if (h.prefix) {
      if (fs.folder === null) return "indeterminate";
      return fs.folder.prefix === h.prefix && (fs.folder.folders.length > 0 || fs.folder.objects.length > 0);
    }
    // conversion_id（未帶 minio_key）→ records（ledger）重驗（CV 語意）。
    if (h.conversion_id) {
      if (!data.recordsLoaded) return "indeterminate";
      if (data.records.some((r) => r.conversion_job_id === h.conversion_id)) return true;
      return data.recordsTruncated ? "indeterminate" : false;
    }
    // 無 job_id/conversion_id/minio_key/prefix ＝無欄位可查 ＝ not_applicable（p5-critic honesty regression）。
    return "not_applicable";
  });

  // minio_key/prefix 導覽 effect：導覽到「來源資料夾」一次，讓 folder 真的載入該層再由上方 predicate 重驗。
  // 依「導覽目標值」為 dep：hash 不變則只跑一次，之後交還使用者手動導覽。
  const incomingTargetPrefix = incoming.handoff
    ? incoming.handoff.prefix ?? (incoming.handoff.minio_key ? folderOf(incoming.handoff.minio_key) : undefined)
    : undefined;
  useEffect(() => {
    if (incomingTargetPrefix !== undefined) fs.navigate(incomingTargetPrefix);
    // fs.navigate 為 useMinioFolder 的 setPrefix（stable）；僅以導覽目標值為 dep，確保 hash 不變只跑一次、
    // 不與使用者手動 goUp/enterFolder 打架。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingTargetPrefix]);

  // minio_key 驗到存在後自動開啟該模型（每個連結只開一次；使用者按返回後不再強制選回）。
  const handoffKey = incoming.handoff?.minio_key ?? null;
  const handoffKeyFound = handoffKey !== null && (fs.folder?.objects.some((o) => o.key === handoffKey) ?? false);
  const appliedHandoffKey = useRef<string | null>(null);
  useEffect(() => {
    if (handoffKeyFound && appliedHandoffKey.current !== handoffKey) {
      appliedHandoffKey.current = handoffKey;
      setSelectedKey(handoffKey);
    }
  }, [handoffKeyFound, handoffKey]);
  const preferredConversionId = handoffKey !== null && handoffKey === selectedObj?.key
    ? incoming.handoff?.conversion_id ?? null
    : null;

  // 全域佇列預設收合；從佇列相關頁面帶 job_id／conversion_id 過來時展開，讓高亮列看得到。
  const [queueOpen, setQueueOpen] = useState(() => Boolean(incoming.handoff?.job_id || (incoming.handoff?.conversion_id && !handoffKey)));

  // 子元件回報的進度帶上所屬模型，換模型後舊回報自動失效（子元件的 effect 先於本頁執行，不能靠重設）。
  const [convert, setConvert] = useState<Keyed<ConvertProgressChange> | null>(null);
  const [result, setResult] = useState<Keyed<ResultProgressChange> | null>(null);
  const convertNow = selectedObj && convert?.key === selectedObj.key ? convert.change : null;
  const resultNow = selectedObj && result?.key === selectedObj.key ? result.change : null;
  const steps = deriveWorkflowSteps({
    selectedName: selectedObj?.key ?? null,
    convert: selectedObj ? convertNow?.progress ?? "loading" : null,
    result: selectedObj ? resultNow?.progress ?? "loading" : null,
    resultLabel: resultNow?.label,
  });

  const locate = (key: string) => { fs.navigate(folderOf(key)); setSelectedKey(key); };

  return (
    <>
      <h1>{t("模型庫 · IFC / USDC", "Models · IFC / USDC")}</h1>
      <IncomingHandoffBanner testId="md-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">
        {t(
          "照三個步驟做：選模型、轉成 USDC、檢查 RVT／IFC／USDC 有沒有對上。完成後到 3D 工作區開啟同一個模型審查。",
          "Follow three steps: pick a model, convert it to USDC, and check that RVT, IFC and USDC line up. Then open the same model in the 3D workspace.",
        )}
      </p>
      <WorkflowSteps steps={steps} />

      <div className="md-split">
        <div className="md-split-tree">
          <MinioTreePane
            fs={fs}
            records={data.records}
            recordsIncomplete={data.recordsIncomplete}
            selectedKey={selectedKey}
            onSelect={(o) => setSelectedKey(o.key)}
          />
        </div>
        <div className="md-split-main">
          {selectedObj ? (
            <ObjectDetailPane
              key={selectedObj.key}
              object={selectedObj}
              data={data}
              bucket={fs.folder?.bucket ?? null}
              preferredConversionId={preferredConversionId}
              onConvertProgress={(change) => setConvert({ key: selectedObj.key, change })}
              onResultProgress={(change) => setResult({ key: selectedObj.key, change })}
              onBack={() => setSelectedKey(null)}
              onGoToFolder={(p) => { fs.navigate(p); }}
            />
          ) : (
            <>
              <section className="md-step-section md-empty-guide" data-testid="md-empty-guide">
                <header className="md-step-head">
                  <h2><span className="md-step-n" aria-hidden="true">①</span> {t("先選一個模型", "Pick a model first")}</h2>
                  <p>
                    {t(
                      "在左側資料夾一路點進去，找到 model.ifc 後點它。選好之後，這裡會出現轉檔按鈕（②）與對齊結果（③）。",
                      "Open folders on the left until you find a model.ifc, then select it. The conversion button (②) and alignment result (③) appear here.",
                    )}
                  </p>
                </header>
                <RecentReports onOpen={locate} />
              </section>
              <details
                className="op-help md-queue"
                data-testid="md-queue-details"
                open={queueOpen}
                onToggle={(event) => setQueueOpen(event.currentTarget.open)}
              >
                <summary>{t("進階：全部模型的轉檔佇列與自動偵測", "Advanced: conversion queue and watcher for all models")}</summary>
                <GlobalConversionPane
                  data={data}
                  onLocateObject={locate}
                  highlightJobId={incoming.handoff?.job_id ?? null}
                />
              </details>
            </>
          )}
        </div>
      </div>

      <details className="op-help"><summary>{t("資料來源與技術說明（非操作步驟）", "Data sources and technical reference (not operating steps)")}</summary>
      <p className="ec-note">{t("專案、種類與版本來自外部 bim-control；此頁只顯示來源資訊，不修改其定義。", "Project, category and version are supplied by external bim-control; this page does not redefine them.")}</p>
      <Panel title={t("Bucket layout（規約說明 — 示意，非實況）", "Bucket layout (convention — illustration, not live)")} sub={t("bim-control private bucket · 三層 key 規約示意（DEMO，非真實資料）", "bim-control private bucket · three-level key convention illustration (DEMO, not real data)")} prov="demo">
        <p className="ec-note">
          <strong>[DEMO]</strong> {t("此 Panel 為 MinIO bucket key 規約示意，非真實 list 資料。 真實物件由上方 Panel 顯示。", "This panel illustrates the MinIO bucket key convention, not real list data. Real objects are shown in the panel above.")}
        </p>
        <div className="ec-tree">
          <div>bim-control/</div>
          <div className="indent">{"{project_display_name}"}/</div>
          <div className="indent two">{"{root}"}/{"{category}"}/{"{version}"}/</div>
          <div className="indent three"><span className="ec-tree-file">model.ifc</span> <span className="ec-prov artifact">{t("來源 IFC", "Source IFC")}</span></div>
          <div className="indent three"><span className="ec-tree-file">model.usdc</span> <span className="ec-note">{t("轉檔產物（Phase 2 回填）", "Conversion output (backfilled in Phase 2)")}</span> <ProvTag prov="p1" /></div>
          <div className="indent three"><span className="ec-tree-file">schedule.csv</span> <span className="ec-note">{t("Revit 元件清單（對齊結果的 RVT 端）", "Revit element list (the RVT side of the alignment)")}</span></div>
          <div className="indent three"><span className="ec-tree-file">lineage-reports/</span> <span className="ec-note">{t("每次轉檔的對齊報表", "Alignment report of every conversion")}</span></div>
        </div>
      </Panel>

      <Panel title={t("與功能頁的關係", "Relationship to feature pages")} prov="asbuilt">
        <Field k="A1" v={t("rule-run 讀檔案庫選定的 IFC（version.path → ifc_source_path）", "rule-run reads the IFC selected from the file library (version.path → ifc_source_path)")} prov="asbuilt" />
        <Field k="A2" v={t("versions / diff compare 需要版本路徑與 model_version_id", "versions / diff compare need the version path and model_version_id")} prov="asbuilt" />
        <Field k="A3" v={t("federation 需要多專業 USD layer / stage paths", "federation needs multi-discipline USD layer / stage paths")} prov="asbuilt" />
        <Field k="3D Viewer" v={t("openStage 使用 generated model.usdc / model.usd URL", "openStage uses the generated model.usdc / model.usd URL")} prov="asbuilt" />
      </Panel>
      </details>
    </>
  );
}
