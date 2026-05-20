## 1. 前置檢查與範圍守門

- [x] 1.1 確認分支為 `codex/openspec/introduce-host-native-conversion-authority-service`，且基底包含 PR `#69`（`@nvidia/omniverse-webrtc-streaming-library` `^5.6.0`）。
- [x] 1.2 編輯前重讀 `AGENTS.md`、`bim-streaming-server/AGENTS.md`、`bim-review-coordinator/AGENTS.md` 與本 change 觸及的現行 specs。
- [x] 1.3 修改 `bim-streaming-server`、`bim-review-coordinator`、`web-viewer-sample` 內任何 function/class/method 前先跑 GitNexus 影響分析；HIGH/CRITICAL 風險先回報。（pre-change impact 全為 LOW；index 已刷新至 0bae19e）
- [x] 1.4 記錄 `bim-streaming-server` 轉檔測試、coordinator 測試與 OpenSpec 驗證的當前基線。

## 2. Host-Native 轉檔權威服務

- [x] 2.1 在 `bim-streaming-server` 新增 host-native 服務進入點，載入既有 conversion authority app 並預設綁定 `127.0.0.1:49101`。（`host_native_conversion_service.py`）
- [x] 2.2 為 host-native 轉檔服務新增 `GET /health`，僅宣告 conversion-only 身分、不宣稱 WebRTC/Kit readiness。（加在 `create_conversion_api_app`）
- [x] 2.3 實作 artifacts root、jobs dir、public artifact URL、host、port 與選用 internal conversion token 的設定，且不編輯真實 `.env` secrets。（`load_config` 只讀 `STREAMING_CONVERSION_*` 環境變數）
- [x] 2.4 實作或接上 converter adapter，呼叫既有 IFC to USDC 轉檔路徑並把輸出正規化為 USDC、mapping、entity index、metadata 與 quality metrics。（`Ifc2UsdcPowershellConverterAdapter`）
- [x] 2.5 對缺少 converter 前置、無效 IFC 輸入、缺輸出、placeholder 輸出與 subprocess 失敗做誠實的 preflight/錯誤處理。（`preflight()` 缺前置時 raise `converter_unavailable`；不產假 ready）
- [x] 2.6 為 health、job 建立、idempotency replay/conflict、token 強制、成功結果與非 ready 失敗案例新增或更新 `bim-streaming-server` 測試。（`tests/test_host_native_conversion_service.py`；含回歸共 19 passed）

## 3. Coordinator 派工與結果 ingestion

- [x] 3.1 確保 `bim-review-coordinator` 把已接受的 `POST /api/external/ifc-ready` job 派工到 `STREAMING_CONVERSION_API_BASE`（預設 `http://127.0.0.1:49101`）。（既有；以 `external-ifc-ready.test.ts` 驗證）
- [x] 3.2 派工失敗時保留 intake 已接受狀態，記錄含 target URL 與診斷的可重試 dispatch 失敗。（既有 `markDispatchFailed`；已驗證）
- [x] 3.3 新增從 `GET /api/conversions/{conversion_job_id}/result` 把結果 ingest 進既有 `/api/internal/conversion-result` 與 callback outbox 路徑。（新增 `fetchConversionResult` + `POST /api/internal/conversions/:id/ingest` + 共用 `ingestConversionReport`；非終結狀態回 409 不誤判 failed）
- [x] 3.4 保留 `conversion_result_ready` 與 `conversion_failed` 的 metadata-only callback 行為，包含 OQ1 endpoint/auth 不可用時的 pending/dead-letter 投遞。（behavior-preserving 抽取；`cloud-callback-outbox.test.ts` 回歸綠）
- [x] 3.5 更新 coordinator 測試：成功派工、服務不可用派工、ready 結果 ingestion、failed 結果 ingestion、非終結狀態、callback 狀態分離。（`tests/host-native-conversion-ingest.test.ts`）
- [x] 3.6 dev proxy 路由與 host-native 轉檔 API 對齊，不引入舊 `_worker` / `_bim-control` runtime 依賴。（未引入 `_worker`/`_bim-control` runtime 依賴）

## 4. Smoke、Evidence 與文件

- [x] 4.1 新增 `host_native_conversion_authority` smoke：啟動或檢查 `127.0.0.1:49101`、建立 job、讀結果、記錄 quality metrics。（`scripts/smoke-host-native-conversion.ps1`；poll 至 terminal、可帶 internal token 與自訂 IFC）
- [x] 4.2 更新 evidence schema/輸出，含 service URL、command、cwd、shell、PID 或 process command、conversion 識別碼、artifact refs、quality 摘要、callback outbox 狀態與 timestamp。（smoke JSON tier + verification 文件）
- [x] 4.3 確保 smoke 對 conversion、callback outbox、Kit launcher、WebRTC、DataChannel 與 browser visual tiers 獨立分層回報。（tier 獨立判定、不升等）
- [x] 4.4 文件化 Windows host-native 啟動命令，並說明涉及 batch launcher 時 `.bat` / Kit repo tooling 應以 PowerShell 啟動，而非 Git Bash。（`start-host-native-conversion-service.ps1` 標頭 + conversion-api.md）
- [x] 4.5 更新 `docs/contracts/conversion-api.md`、平台邊界文件與相關 runbooks 以反映 `127.0.0.1:49101` host-native 服務歸屬。（conversion-api.md host-native 段）

## 5. Viewer Ready-Gate 驗證

- [x] 5.1 確認 `web-viewer-sample` 維持 PR `#69` 相容依賴版本且能從選定基底 build。（`npm run build` — 見 6.3）
- [x] 5.2 新增或更新 viewer 測試/evidence，使非 ready 的 `stream_config.model.status` 不觸發正常 `openStageRequest`。（gate 完好於 `Window.tsx:534`；記錄於 verification 文件，未改 viewer 邏輯 — D5）
- [x] 5.3 新增或更新 ready-flow evidence，使 `openStageRequest` 僅在 model readiness 與 Kit/DataChannel readiness 可用後才嘗試。（verification 文件記錄 `isKitReady && model.status==="ready" && !isBlockedLifecycle` gate）
- [x] 5.4 若 GPU/WebRTC/browser 自動化不可用，把 viewer/render tiers 標為 `blocked`、`deferred` 或 `not_observed`，不標 passed。（WebRTC/Kit/browser = `not_observed`；真實轉檔 runtime = `blocked` — 誠實）

## 6. 驗證與收尾

- [x] 6.1 跑 `python -m pytest bim-streaming-server/tests/test_conversion_authority_api.py` 或轉檔服務變更的最小等效集。（19 passed：conversion-authority 回歸 + host-native）
- [x] 6.2 先跑 `cd bim-review-coordinator && npm test` 或受影響的最小 coordinator 測試集，必要時再擴大。（143 passed；`npm run verify` tsc 0 + tests）
- [x] 6.3 viewer 檔案或 E2E 假設變更時跑 `cd web-viewer-sample && npm run build` 與針對性 viewer 檢查。（vite build ✓；未改 viewer 源碼 — D5）
- [x] 6.4 跑 `openspec validate introduce-host-native-conversion-authority-service --strict` 與 `openspec status --change introduce-host-native-conversion-authority-service`。（valid；4/4 artifacts complete）
- [x] 6.5 commit 前跑 GitNexus detect changes，確認受影響 symbols/flows 與規劃 scope 相符。（detect-changes 無法 introspect linked-worktree staged index — indexed repo 路徑為 main worktree；依 gitnexus-blast-radius Step 3 fallback 用 `git diff --cached --name-only`：所有 staged 檔 ⊆ 宣告 scope，無 drift；已於 PR body 揭露）
- [x] 6.6 開 implementation PR 前更新 task 狀態、evidence 路徑、已知風險與任何 roadmap 參照。（`docs/verification/2026-05-19-introduce-host-native-conversion-authority-service.md`）
