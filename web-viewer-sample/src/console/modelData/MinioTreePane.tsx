// web-viewer-sample/src/console/modelData/MinioTreePane.tsx
// MD 三頁合一 Task 3：左欄檔案樹（受控純呈現）。原文搬移自 pages.tsx MinioDataPage 的左欄 Panel：
// 麵包屑 / 上一層 / Refresh / cache 標示 / stale 警示 / loading / err（可重試）/ 兩種 empty 態 /
// 資料夾鈕（含 has_source_ifc badge，localeCompare('zh-TW') 排序）/ 物件列（roleLabel 徽章、三段語意
// badge、ledger chip）。狀態一律由 props 進來（fs=useMinioFolder、records/recordsIncomplete=useConversionData）。
// 變更點（brief §Step 3）：
//  (a) 物件列的「觸發轉檔」「轉檔 →」「A1 檢核 →」三鈕移除（觸發/跳轉移至單檔詳情，Task 5）；改為
//      source_ifc 檔名鈕可點選檔（onSelect）＋ data-selected 反白鉤子 ＋ data-testid=md-tree-select-<idk>。
//  (b) goUp 父層計算留在 pane，算完呼 props.fs.navigate(parent)。
// 合併畫面（模型庫第①步）：資料夾只顯示本層名稱（完整路徑放 title）、IFC 只顯示檔名與轉檔狀態、
// 其他檔案收在預設收合的區塊；bucket、cache 等技術資訊收進 Panel 說明提示。
// 誠實鐵律：error 態顯真實原因＋可重試；empty 態 (a) 未設定 vs (b) 已設定當前層空 文案嚴格區分；
//          chip 經 ledgerChipStatus 退 indeterminate/untracked，不把「看不到」誤報「未轉」。
import { t } from "../i18n";
import { Btn, Panel } from "../components";
import { ledgerChipStatus, MINIO_CHIP_LABEL, roleClass, roleLabel } from "./conversionShared";
import type { ConversionRecord, MinioObject } from "../coordinatorClient";
import type { MinioFolderState } from "./useMinioFolder";

export function MinioTreePane(props: {
  fs: MinioFolderState;
  records: ConversionRecord[]; recordsIncomplete: boolean;
  selectedKey: string | null;
  onSelect(obj: MinioObject): void;   // 點 source_ifc 物件 → 殼層切單檔詳情
}): JSX.Element {
  const { fs, records, recordsIncomplete, selectedKey, onSelect } = props;
  const { folder, prefix, loading, err, stalePrefixes } = fs;

  // 變更點 (b)：goUp 父層計算留在 pane（原文搬移自 MinioDataPage 的 goUp），算完呼 fs.navigate(parent)。
  const goUp = () => {
    if (!prefix) return;
    const trimmed = prefix.replace(/\/$/, "");
    const idx = trimmed.lastIndexOf("/");
    fs.navigate(idx >= 0 ? trimmed.slice(0, idx + 1) : "");
  };

  // folders 為 Array<{ prefix; has_source_ifc }>；對中文使用者以 localeCompare('zh-TW') 重排（spec §2.1 中文排序）。
  const sortedFolders = folder ? [...folder.folders].sort((a, b) => a.prefix.localeCompare(b.prefix, "zh-TW")) : [];
  // empty 態 (b)：已設定但當前層無物件（無 note）。empty 態 (a)＝後端回 note（未設定）。
  const showFolderEmpty = !!folder && folder.folders.length === 0 && folder.objects.length === 0;
  // folder 回應的 note（後端未設定時回 200 + note；MinioFolderListing.note? 已對齊 wire shape）。
  const folderNote = folder?.note;
  const currentPrefixStale = stalePrefixes.has(prefix);
  const cacheNote = folder?.cache ? ` · ${folder.cache.hit ? "cache hit" : "live list"}` : "";
  const sourceObjects = folder?.objects.filter((obj) => obj.role === "source_ifc") ?? [];
  const otherObjects = folder?.objects.filter((obj) => obj.role !== "source_ifc") ?? [];
  const nameOf = (key: string) => key.slice(key.lastIndexOf("/") + 1);

  return (
    <Panel
      title={t("① 選擇模型", "① Pick a model")}
      sub={folder?.bucket
        ? t(`MinIO 真實資料夾（bucket=${folder.bucket}${cacheNote}）· GET /api/minio/objects?delimiter=/`, `Live MinIO folders (bucket=${folder.bucket}${cacheNote}) · GET /api/minio/objects?delimiter=/`)
        : t("MinIO 真實資料夾 · GET /api/minio/objects?delimiter=/（MinIO watch 未設定時回 count=0）", "Live MinIO folders · GET /api/minio/objects?delimiter=/ (returns count=0 when MinIO watch is not configured)")}
      prov="asbuilt"
    >
      {/* 麵包屑：目前層 prefix（空＝bucket 根）＋ 上一層鈕（prefix 非空才顯） */}
      <div className="ec-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {prefix ? (
          <Btn data-testid="minio-go-up" caption="prefix --" onClick={() => goUp()}>{t("⬑ 上一層", "⬑ Up")}</Btn>
        ) : null}
        <span className="md-tree-path">{prefix || t("（最上層）", "(top level)")}</span>
        <Btn data-testid="minio-refresh" caption="GET /api/minio/objects?refresh=1" onClick={() => fs.refreshCurrent()}>
          {t("重新整理", "Refresh")}
        </Btn>
      </div>

      {currentPrefixStale ? (
        <div
          data-testid="minio-stale-note"
          className="ec-warn-note"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}
        >
          <span>{t("MinIO 監控偵測到此層可能有新變更。", "MinIO watcher detected possible changes in this level.")}</span>
          <Btn data-testid="minio-stale-refresh" caption="GET /api/minio/objects?refresh=1" onClick={() => fs.refreshCurrent()}>
            {t("重新整理", "Refresh")}
          </Btn>
        </div>
      ) : null}

      {loading ? (
        <p className="ec-note">{t("載入中…", "Loading…")}</p>
      ) : err ? (
        // error 態：誠實顯原因 + 可重試（不假裝有資料）。refreshCurrent＝delete cache + refresh 重打，等價原 retry。
        <div className="ec-warn-note" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{t("讀取 MinIO 失敗：", "Failed to read MinIO: ")}{err}</span>
          <Btn data-testid="minio-tree-retry" caption="GET /api/minio/objects" onClick={() => fs.refreshCurrent()}>
            {t("重試", "Retry")}
          </Btn>
        </div>
      ) : folderNote ? (
        // empty 態 (a)：MinIO 未設定（後端回 note，200）。
        <p className="ec-note">{t("MinIO 未設定（", "MinIO not configured (")}{folderNote}{")"}</p>
      ) : showFolderEmpty ? (
        // empty 態 (b)：已設定但當前 prefix 無物件——不可誤用「未設定」文案。
        <p className="ec-note">{t("此層無物件（資料夾為空）。", "This level has no objects (empty folder).")}</p>
      ) : (
        // populated：資料夾鈕（本層名稱＋含 IFC badge）＋ 當層 IFC（可選）＋ 收合的其他檔案。
        <div>
          {sortedFolders.length > 0 ? (
            <ul className="md-tree-list">
              {sortedFolders.map((f) => (
                <li key={f.prefix}>
                  <Btn data-testid={`minio-folder-open-${f.prefix}`} title={f.prefix} onClick={() => fs.navigate(f.prefix)}>
                    {f.prefix.startsWith(prefix) ? f.prefix.slice(prefix.length) : f.prefix}
                  </Btn>
                  {f.has_source_ifc ? (
                    <span data-testid={`minio-folder-badge-${f.prefix}`} className="ec-prov artifact">
                      {t("含 IFC 模型", "has IFC model")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {folder && sourceObjects.length > 0 ? (
            <ul className="md-tree-list">
              {sourceObjects.map((obj) => {
                const idk = obj.idempotency_key;
                // Match explicit reconversions by the confirmed source, not the original watcher ID.
                const attempts = records.filter(record => record.object_key === obj.key
                  && record.bucket === folder.bucket && record.source_etag === obj.etag)
                  .sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));
                const st = ledgerChipStatus(attempts[0]?.idempotency_key ?? idk, records, recordsIncomplete);
                return (
                  <li key={obj.key}>
                    {/* source_ifc 檔名鈕可點選（onSelect → 殼層切單檔詳情）；data-selected 反白鉤子、
                        data-testid 供 E2E/單測穩定選取；完整 key 放 title。 */}
                    <button
                      type="button"
                      className="ec-btn md-tree-model"
                      data-testid={`md-tree-select-${idk}`}
                      data-selected={selectedKey === obj.key}
                      title={obj.key}
                      onClick={() => onSelect(obj)}
                    >
                      {nameOf(obj.key)}
                    </button>
                    {/* ledger 狀態 chip（無紀錄＝未轉、載入失敗/截斷＝狀態未明，不臆測）。 */}
                    <span data-testid={`minio-chip-${idk}`} className="ec-prov">
                      {MINIO_CHIP_LABEL[st] ?? st}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {otherObjects.length > 0 ? (
            <details className="op-inline-help" data-testid="minio-other-files">
              <summary>{t(`其他檔案（${otherObjects.length}）`, `Other files (${otherObjects.length})`)}</summary>
              <ul className="md-tree-list">
                {otherObjects.map((obj) => (
                  <li key={obj.key} title={obj.key}>
                    <span className={roleClass(obj.role)}>{roleLabel(obj.role)}</span>
                    <span className="md-tree-file">{nameOf(obj.key)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
