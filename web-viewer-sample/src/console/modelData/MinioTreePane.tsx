// web-viewer-sample/src/console/modelData/MinioTreePane.tsx
// MD 三頁合一 Task 3：左欄檔案樹（受控純呈現）。原文搬移自 pages.tsx MinioDataPage 的左欄 Panel：
// 麵包屑 / 上一層 / Refresh / cache 標示 / stale 警示 / loading / err（可重試）/ 兩種 empty 態 /
// 資料夾鈕（含 has_source_ifc badge，localeCompare('zh-TW') 排序）/ 物件列（roleLabel 徽章、三段語意
// badge、ledger chip）。狀態一律由 props 進來（fs=useMinioFolder、records/recordsIncomplete=useConversionData）。
// 變更點（brief §Step 3）：
//  (a) 物件列的「觸發轉檔」「轉檔 →」「A1 檢核 →」三鈕移除（觸發/跳轉移至單檔詳情，Task 5）；改為
//      source_ifc 檔名鈕可點選檔（onSelect）＋ data-selected 反白鉤子 ＋ data-testid=md-tree-select-<idk>。
//  (b) goUp 父層計算留在 pane，算完呼 props.fs.navigate(parent)。
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

  return (
    <Panel
      title={t("MinIO Bucket 逐層資料夾（真實 list）", "MinIO bucket folder navigation (real list)")}
      sub={folder?.bucket ? `bucket=${folder.bucket} · GET /api/minio/objects?delimiter=/` : t("GET /api/minio/objects?delimiter=/（MinIO watch 未設定時回 count=0）", "GET /api/minio/objects?delimiter=/ (returns count=0 when MinIO watch is not configured)")}
      prov="asbuilt"
    >
      {/* 麵包屑：目前層 prefix（空＝bucket 根）＋ 上一層鈕（prefix 非空才顯） */}
      <div className="ec-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        {prefix ? (
          <Btn data-testid="minio-go-up" caption="prefix --" onClick={() => goUp()}>{t("⬑ 上一層", "⬑ Up")}</Btn>
        ) : null}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 }}>{prefix || "/"}</span>
        <Btn data-testid="minio-refresh" caption="GET /api/minio/objects?refresh=1" onClick={() => fs.refreshCurrent()}>
          {t("重新整理", "Refresh")}
        </Btn>
        {folder?.cache ? (
          <span data-testid="minio-cache-state" className="ec-note">
            {folder.cache.hit ? t("cache hit", "cache hit") : t("live list", "live list")}
          </span>
        ) : null}
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
        <p className="ec-note">{t("載入中…（GET /api/minio/objects）", "Loading… (GET /api/minio/objects)")}</p>
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
        // populated：資料夾鈕（含 source IFC badge）＋ 當層直屬物件列。
        <div>
          {sortedFolders.length > 0 ? (
            <div className="ec-tree">
              {sortedFolders.map((f) => (
                <div key={f.prefix} className="ec-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Btn data-testid={`minio-folder-open-${f.prefix}`} caption={t("點入此資料夾", "open folder")} onClick={() => fs.navigate(f.prefix)}>{f.prefix}</Btn>
                  {f.has_source_ifc ? (
                    <span data-testid={`minio-folder-badge-${f.prefix}`} className="ec-prov artifact">
                      {t("含 source IFC", "has source IFC")}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {folder && folder.objects.length > 0 ? (
            <ul className="ec-tree" style={{ listStyle: "none", paddingLeft: 0 }}>
              {folder.objects.map((obj) => {
                const idk = obj.idempotency_key;
                const st = ledgerChipStatus(idk, records, recordsIncomplete);
                return (
                  <li key={obj.key} className="ec-row" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {/* role label（與 intake 三段脫鉤，純副檔名） */}
                    <span className={roleClass(obj.role)}>{roleLabel(obj.role)}</span>
                    {/* 變更點 (a)：source_ifc 檔名改為可點鈕（onSelect → 殼層切單檔詳情）；data-selected 反白鉤子、
                        data-testid 供 E2E/單測穩定選取。非 source_ifc 維持純文字（無單檔詳情可切）。 */}
                    {obj.role === "source_ifc" ? (
                      <button
                        type="button"
                        className="ec-btn"
                        data-testid={`md-tree-select-${idk}`}
                        data-selected={selectedKey === obj.key}
                        onClick={() => onSelect(obj)}
                        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
                      >
                        {obj.key}
                      </button>
                    ) : (
                      <span className="ec-tree-file" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{obj.key}</span>
                    )}
                    {/* 三段語意 badge：有才顯（≥3 段才有，malformed 不掛）。各掛 data-testid 供 AC-badge
                        精準定位（避免 textContent 子字串誤判：如 category=main 撞 prefix 路徑字串）。 */}
                    {obj.project_display_name ? <span data-testid={`minio-badge-project-${idk}`} className="ec-prov">{obj.project_display_name}</span> : null}
                    {obj.category ? <span data-testid={`minio-badge-category-${idk}`} className="ec-prov">{obj.category}</span> : null}
                    {obj.version ? <span data-testid={`minio-badge-version-${idk}`} className="ec-prov">{obj.version}</span> : null}
                    {/* 僅 source_ifc 物件掛 ledger 狀態 chip（無紀錄＝未轉、載入失敗/截斷＝狀態未明，不臆測）。
                        觸發/跨頁跳轉三鈕已移除，改由單檔詳情（Task 5）承接。 */}
                    {obj.role === "source_ifc" ? (
                      <span data-testid={`minio-chip-${idk}`} className="ec-prov">
                        {MINIO_CHIP_LABEL[st] ?? st}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
