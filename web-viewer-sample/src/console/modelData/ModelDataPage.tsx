// web-viewer-sample/src/console/modelData/ModelDataPage.tsx
// MD 三頁合一 Task 6：殼層（EdgeConsole 唯一入口，spec §3、§3.4）。只做四件事，不重複 pane 的邏輯：
//   (1) 組主從雙欄（左＝MinioTreePane 檔案樹；右＝未選檔 GlobalConversionPane / 已選檔 ObjectDetailPane）。
//   (2) 選檔 state（selectedKey → selectedObj；folder 重載後查無物件則自動回總覽，誠實不顯 stale 詳情）。
//   (3) handoff 統一接收（§3.4）：job_id/conversion_id 向 jobs/records 重驗（CV 語意，搬 pages.tsx CV 頁原文）；
//       minio_key/prefix 向 folder 重驗（M 語意，搬 pages.tsx M 頁原文）＋導覽 effect；皆無 → not_applicable。
//   (4) 頁尾兩個說明 Panel（DEMO bucket layout ＋ 與功能頁的關係，搬自 M 頁全文，DEMO 標示照舊）。
import { useEffect, useState } from "react";
import { t } from "../i18n";
import { Field, Panel, ProvTag } from "../components";
import { useIncomingHandoff, IncomingHandoffBanner } from "../incomingHandoff";
import { useConversionData } from "./useConversionData";
import { useMinioFolder } from "./useMinioFolder";
import { MinioTreePane } from "./MinioTreePane";
import { GlobalConversionPane } from "./GlobalConversionPane";
import { ObjectDetailPane } from "./ObjectDetailPane";

export function ModelDataPage(): JSX.Element {
  const data = useConversionData();
  const fs = useMinioFolder();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // selectedObj 由當前 folder.objects 導出：folder 重載後查無（物件被刪）→ null 自動回總覽（brief 明定，
  // 誠實不顯 stale 詳情）。selectedKey 仍保留，若使用者重新導覽回該層且物件仍在，詳情可再現。
  const selectedObj = fs.folder?.objects.find((o) => o.key === selectedKey) ?? null;

  // handoff 統一接收（spec §4.2 接收端重驗鐵律）：selfAxis="minio"。四分支各守門原文（分支優先序照列：
  // job_id → conversion_id → minio_key → prefix）；查無且該來源窗被截斷 → 誠實 indeterminate（未明），
  // 查無且未截斷 → 誠實 not_found，絕不靜默 fallback。皆無 → not_applicable（中性，非警示）。
  const incoming = useIncomingHandoff("minio", (h) => {
    // job_id → jobs（ifc-ready）重驗（CV 語意，搬 pages.tsx ConversionSchedulingPage 原文）。
    if (h.job_id) {
      if (!data.jobsLoaded) return "indeterminate";
      if (data.jobs.some((j) => j.ifc_ready_job_id === h.job_id || j.conversion_job_id === h.job_id)) return true;
      return data.jobsTruncated ? "indeterminate" : false;
    }
    // conversion_id → records（ledger）重驗（CV 語意，搬 pages.tsx ConversionSchedulingPage 原文）。
    if (h.conversion_id) {
      if (!data.recordsLoaded) return "indeterminate";
      if (data.records.some((r) => r.conversion_job_id === h.conversion_id)) return true;
      return data.recordsTruncated ? "indeterminate" : false;
    }
    // minio_key → folder.objects 重驗（M 語意，搬 pages.tsx MinioDataPage 原文；先由下方 effect 導覽到該層）。
    if (h.minio_key) {
      if (fs.folder === null) return "indeterminate"; // 該層尚未載入 → 中性 indeterminate，不誤閃 not_found
      return fs.folder.objects.some((o) => o.key === h.minio_key);
    }
    // prefix → folder 重驗（M 語意，搬 pages.tsx MinioDataPage 原文；保留能力，供未來「純資料夾回看」）。
    if (h.prefix) {
      if (fs.folder === null) return "indeterminate";
      return fs.folder.prefix === h.prefix && (fs.folder.folders.length > 0 || fs.folder.objects.length > 0);
    }
    // 無 job_id/conversion_id/minio_key/prefix ＝無欄位可查 ＝ not_applicable（p5-critic honesty regression）。
    return "not_applicable";
  });

  // minio_key/prefix 導覽 effect（搬 M 頁原文，navigate 改 fs.navigate）：導覽到「來源資料夾」一次，讓
  // folder 真的載入該層再由上方 predicate 重驗。job_id/conversion_id 分支不產生 target（undefined）→ 不導覽、
  // 不自動選檔（佇列高亮已足，避免雙重挾持）。依「導覽目標值」為 dep：hash 不變則只跑一次，之後交還使用者手動導覽。
  const incomingTargetPrefix = incoming.handoff
    ? incoming.handoff.prefix ??
      (incoming.handoff.minio_key
        ? incoming.handoff.minio_key.slice(0, incoming.handoff.minio_key.lastIndexOf("/") + 1)
        : undefined)
    : undefined;
  useEffect(() => {
    if (incomingTargetPrefix !== undefined) fs.navigate(incomingTargetPrefix);
    // fs.navigate 為 useMinioFolder 的 setPrefix（stable）；僅以導覽目標值為 dep，確保 hash 不變只跑一次、
    // 不與使用者手動 goUp/enterFolder 打架（比照 M 頁原文 effect）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingTargetPrefix]);

  return (
    <>
      <h1>{t("模型資料與轉檔", "Model Data & Conversion")}</h1>
      <IncomingHandoffBanner testId="md-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <p className="ec-lead">
        {t(
          "唯讀 intake 來源視圖 ＋ 轉檔排程一頁合一。左欄像 MinIO 網頁一樣逐層資料夾導覽（真實 S3 list，帶 Delimiter='/'）；右欄未選檔時看全域轉檔佇列與摘要，選一個 model.ifc 後看該檔的轉檔生命週期與動作。此頁不是 metadata 權威——專案 / 種類 / 版本語意的權威在外部 ",
          "A read-only intake source view combined with conversion scheduling on one page. The left column browses the bucket level-by-level like the MinIO web UI (real S3 list with Delimiter='/'); the right column shows the global conversion queue and summary when no file is selected, and the per-file conversion lifecycle and actions once a model.ifc is chosen. This page is not the metadata authority — the authority for project / category / version semantics is the external ",
        )}
        <code>bim-control · MySQL</code>
        {t("，不由本頁決定。", "; this page does not decide it.")}
      </p>

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
              object={selectedObj}
              data={data}
              onBack={() => setSelectedKey(null)}
              onGoToFolder={(p) => { fs.navigate(p); }}
            />
          ) : (
            <GlobalConversionPane
              data={data}
              onLocateObject={(key) => { fs.navigate(key.slice(0, key.lastIndexOf("/") + 1)); setSelectedKey(key); }}
              highlightJobId={incoming.handoff?.job_id ?? null}
            />
          )}
        </div>
      </div>

      {/* 頁尾說明 Panel（spec §4 #6/#7，搬自 M 頁全文，DEMO 標示照舊）。 */}
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
        </div>
      </Panel>

      <Panel title={t("與功能頁的關係", "Relationship to feature pages")} prov="asbuilt">
        <Field k="A1" v={t("rule-run 讀檔案庫選定的 IFC（version.path → ifc_source_path）", "rule-run reads the IFC selected from the file library (version.path → ifc_source_path)")} prov="asbuilt" />
        <Field k="A2" v={t("versions / diff compare 需要版本路徑與 model_version_id", "versions / diff compare need the version path and model_version_id")} prov="asbuilt" />
        <Field k="A3" v={t("federation 需要多專業 USD layer / stage paths", "federation needs multi-discipline USD layer / stage paths")} prov="asbuilt" />
        <Field k="3D Viewer" v={t("openStage 使用 generated model.usdc / model.usd URL", "openStage uses the generated model.usdc / model.usd URL")} prov="asbuilt" />
      </Panel>
    </>
  );
}
