# 明確建立、開啟與重建 Review Session

此契約對應 B0/A1 逐刀計畫第二刀。來源與 session 狀態由 coordinator 驗證；瀏覽器只保存尚待確認的請求識別碼。

## API 與相容性

既有 `POST /api/conversion/records/:readyModelId/review-session` 新增兩種 strict body：

- `{"mode":"create_new","request_id":"review-<uuid>"}`：建立新的審查。request_id 為 1–128 字元的英數、點、底線、冒號或連字號。
- `{"mode":"open_existing","session_id":"review_session_..."}`：只開啟指定且仍為 created/active、來源匹配的審查。
- 空物件 `{}` 保留 legacy 同模型重用行為，與 explicit create 的 request namespace 分離。未知欄位與錯誤 intent 拒絕。

成功回應保留 `ready_model_id`、`review_session_id`、`session_status`、`session_replay`。來源不可取得回 502；來源、狀態或 request fingerprint 衝突回 409。沿用原 conversion-control 認證，不接受 client 指定 tenant、artifact URL 或 checksum。

## 持久化與重試

request scope 綁 server-resolved tenant/project/request_id，source fingerprint 綁模型、轉檔 job、trace、artifact URL/checksum。相同請求併發、回應遺失、程序重啟後重試取回相同 ID；同模型的不同請求建立不同 ID。同 scope 不同來源拒絕。損壞或隔離的 request state 不得降級為新建。

session 新增 optional `review_request_fingerprint`、`ready_review_source`；舊記錄不需 migration。legacy open 嚴格比對既有 server identity/binding，不能捏造歷史 checksum；帶有部分新 provenance 的記錄不可退回 legacy 路徑。未新增 TTL、清除排程或資料刪除；key 的保存期間等同 session/receipt 保存期間。

`review_session_request_` 記錄在 open 與 viewer claim 都必須具備合法 digest，且 digest 對應該 session ID。`GET /api/runtime/status` 的 session summary 新增 nullable `ready_model_id`，只投影 server-owned identity；前端舊 server 相容型別為 optional nullable，缺值不猜測可開啟的 ready 模型。

目前為單一 coordinator process 管理一個 session store；記憶體 in-flight 合併搭配既有 atomic file persistence，不宣稱多程序共享 store 的分散式 CAS。

## Closed 與 GPU

closed 保持 terminal。同建立 request 的 replay 可回傳原 closed ID，不建立替代 session；open_existing 不得重新啟用 closed。

既有 `POST /api/review-sessions/:sessionId/recreate` 沿用 `Idempotency-Key`，從已驗證來源建立不同 ID，保存 lineage 與獨立 receipt。相同重建 key 在 lost response/restart 後取得相同重建結果，不能與 create request 合併。回應新增 `activation_state: "not_requested" | "configured"`。

重建僅清除新 ready-review request namespace 的內部 digest；既有 create API 的外部 `review_request_id` 保留，receipt replay 同時核對該 correlation ID。若重建目標已 closed，重播仍回該 terminal 結果，UI 不選取或啟用它，並更新封存清單。

explicit create/recreate 初始為 created、無 Kit bindings，不 claim GPU。使用者另外按下啟動 3D，才由既有 viewer-lease claim 路徑配置 binding、取得 lease、持久化 active 狀態並記錄 server-owned `viewerLeaseClaimed`。失敗不得留下錯誤綁定或釋放既有其他 lease。

## UI 與驗收

入口 `/ui/#a1-workbench` 的「建立與開啟審查」：

1. 選擇 ready 模型，按「建立新的審查」，應顯示選取的 session ID，3D 仍需手動啟動。
2. 同模型再次建立，應取得不同 ID；選擇既有 ID 並按「開啟所選審查」應只選取該 ID。
3. 建立或重建的回應遺失後重新整理；UI 保留 sessionStorage 中的原請求，明確重試才送出，不自動 POST。
   若永久失敗，可明確確認停止追蹤；畫面保留原請求識別並提醒可能已建立，不自動另建。
4. 封存後從既有封存清單重建；原 session 保持 closed，新 ID 保存來源關係。儲存空間不可用時在送出前拒絕並顯示錯誤。
5. HTTP LAN 缺少 `crypto.randomUUID` 時，使用相容的 request ID fallback；仍先保存再送出，重試沿用原 key。
6. 既有審查選項精確比對 `ready_model_id`；「重新整理模型」同步更新 runtime sessions，讓其他分頁建立的審查可見，不自動選取或建立。

驗證：coordinator `npm run verify`；viewer `npm run verify`；先 `npm run build:ui` 再 `E2E_DISABLE_WEBSERVER=1 npm run test:e2e -- e2e/ready-review-session-intent.spec.ts e2e/closed-session-recreate.spec.ts`（PowerShell 以 `$env:E2E_DISABLE_WEBSERVER='1'` 設定）。

browser contract fixture 使用實際 coordinator HTTP API、synthetic conversion authority/artifact，只證明上述 session/UI 協定；不是 isolated branch stack、真 IFC 轉檔、部署、Kit/WebRTC、first-frame 或 Stage 證據。後續 ViewerCore 與真實 3D 驗收依各刀計畫處理。
