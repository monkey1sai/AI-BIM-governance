# S3 evidence — model file lifecycle（真 stack、181 部署、真站操作）

- Subject: `origin/main` `b849823`（S1 #980 + S2 #981 合併後）；本目錄的 spec 修正 commit 見 `git log`。
- Date: 2026-09-30（UTC 時間戳）。
- Scope: 契約 `docs/plans/model-file-session-lifecycle-contract.md` §7 S3 列——本機真 API 與 runtime、181 canonical 部署、owner Chrome 真站操作、Functional 與 Semantic browser E2E。
- 去識別化：本 repo 為 PUBLIC。真實客戶專案名稱以 `<project-A>`…`<project-D>` 取代、種類以 `<category>` 取代、操作端工作站 IP 以 `<workstation-ip>` 取代；`192.168.20.181` 是 `AGENTS.md` 已載明的開發目標主機。session id、ledger 鍵（`mw_…`、`idem_…`）為不透明識別碼，原樣保留。截圖含真實專案名稱，**不入 repo**（owner 在對話中已看過；部署與清理都在 owner 觀看下於其 Chrome 執行）。

## 檔案

| 檔 | 內容 |
|---|---|
| `01-181-pre-deploy-runtime.json` | 部署前 181 狀態（舊版：紀錄無 `sessions[]`）、守門探針 |
| `02-181-deploy.txt` | `rebuild-test-deploy.ps1 -Build` 結果：tag、時間窗、snapshot、exit |
| `03-181-post-deploy-api.json` | 部署後 181 API：S1 欄位已上線、session 保留 |
| `04-181-cleanup.json` | owner Chrome 上「清理舊紀錄」預覽 15 項 → 確認 → 逐列結果（11 移除、4 個 409 has_descendants） |
| `05-181-post-cleanup-api.json` | 清理後 181 API 核對 |
| `06-local-lifecycle.json` | 本機真 stack：從清單轉檔本機 IFC → 自動建 session → 從清單開啟 → 啟動 A1 3D → 首幀／Stage 證據 |
| `07-local-cleanup-and-restart.json` | 本機清理 71 項 → 重啟 coordinator → 不復活（API 與磁碟） |
| `08-kit-log-excerpt.txt` | 本機 Kit 檔案 log：signaling headers、DataChannel trace accepted、authorized stage load |
| `09-functional-runtime-result.json` | `playwright.functional-runtime.config.ts`（`conv-history.spec.ts`）在乾淨 commit `6c6ad85` 上的結果（`status: passed`、`workspace_clean: true`）。`scripts/tests/verify-functional-runtime-result.ps1` 通過 kind／schema／乾淨 commit／artifact 路徑與 sha256 檢查，停在「artifact is not tracked」——該 gate 要求把 `artifacts/e2e/functional-runtime/conv-history.png` 與 1.8 MB 的 `conv-history-trace.zip` 強制入版控；本 PR 不把 trace 檔加進 PUBLIC repo，兩個 artifact 的 sha256 已記錄在本檔中，屬已知未通過的 validator 尾段檢查 |

## 結論（對照 §7 S3 完成條件）

| 條件 | 結果 |
|---|---|
| 本機真 API 與 runtime：選本機 IFC → 轉檔 → 從清單開啟審查 → Kit 首幀與 Stage 證據 | 通過。`06-local-lifecycle.json`：lease `datachannel_ready=true`、`first_frame_at=2026-09-30T06:16:54.958Z`、`loaded_stage_url == expected_stage_url`、`stage_match=true`、session `stage_open_state=open`；Kit log 見 `08` |
| 清理舊紀錄後三個清單縮短且重啟 coordinator 後不復活 | 通過。`07`：清理 71 項全部「已移除」；重啟後 session 1／可見紀錄 1／`include_removed=1` 65（64 removed）／closed 0／被 purge 的 session GET 404；磁碟 1 個 session json＋7 個 `.purged` 標記 |
| 部署 181（canonical 路徑，freshly fetched `origin/main`） | 通過。`02`：tag `deploy-20260930-639263436478199037-001` → `b849823`，exit 0，CFD run guard 通過，snapshot `20260930T054047Z-effective-env.json` |
| owner 的 Chrome 逐步操作並截圖 | 部分。清理流程（預覽→確認→逐列結果）在 owner Chrome 執行、owner 觀看，截圖已在對話中分享；結果頁截圖因該分頁在背景（`document.hidden=true`）而 CDP 截圖逾時，改以 `04`／`05` 的 DOM 與 API 讀值為證。從清單開啟審查與 3D 首幀在 181 上未於 owner Chrome 完成（見「未完成」） |
| Functional 與 Semantic browser E2E 各一條通過 | Functional：`09`（1 passed）。Semantic：`design-system-semantic-cases.ts` 由 `npm run test:visual:design-system` 執行，S2 PR #981 在 `7b0afe3` 上 13 屏全通過（本目錄不重複收錄，程式碼與 `b849823` 相同） |

## 未完成／限制

- 181 上「從清單開啟審查 → 啟動 3D → 首幀」未在 owner Chrome 完成：該 Chrome 分頁整段期間為背景分頁，WebRTC 首幀需可見分頁才會觸發；補做只需 owner 把分頁切到前景後重複本目錄 `06` 的步驟。
- 4 個已關閉 session 未被清理：伺服器回 409 `review_session_has_descendants`（有重建後代），屬 S1 設計的祖先保護；要清除需先 purge 後代。
- `e2e/ready-review-isolated.spec.ts` 仍未實跑（需隔離 stack）。
- 本機 Kit 在本次開始時未啟動（`_build` launcher 不存在，`scripts/.run/bim-streaming-server.log.err` 記錄 `Streaming launcher not found … Run '.\repo.bat build'`），由 owner 重建後才取得首幀證據；這是本機環境問題，不是產品缺陷。
- Functional E2E 第一次在主 checkout 失敗（seed 進件回 409）：`conv-history.spec.ts` 的 coordinator 只把部分 store 導到 tmp，仍共用 dev ledger，而 dev ledger 中的 `idem_conv_history_001` 剛被清理成墓碑，S1 規則以 `record_removed` 拒絕同鍵進件。本 PR 修正 spec 讓所有 store 路徑都導到 tmp（與 S1 smoke README 清單一致），乾淨 commit 上重跑通過。
