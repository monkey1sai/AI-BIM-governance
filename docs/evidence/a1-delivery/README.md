# A1 第十二刀：交付與回歸

承接已合併 PR #830 的逐刀計畫。需求對齊 `docs/plans/AI-BIM 前後端設計文件.dc.html` F2 與 A1 檢核／整改閉環。本刀修補交付接線，不代表前刀尚缺的 GPU 實證已完成。

## 交付契約

- BCF 使用成功 rule-run 的 `model_version_id` query。正式 Issue 必須屬同版本且有 IFC GUID；缺少版本時禁止從 A1 匯出。跨版本原問題仍供整改檢視，不混入本次 BCF。
- Excel、BCF、snapshot 綁 run、版本、來源、Session generation；切來源、A→B→A 或卸載後，舊 success/error/finally 不得下載或更新新畫面。雙擊只啟動一次該項交付。
- `POST /api/review-sessions/:sessionId/issue-snapshot` 以 Session canonical version 為準；caller version（若有）、回傳 run ID、run version 必須一致，且 run 必須 succeeded。來源不符回 `409 issue_snapshot_source_mismatch`；未成功回 `409 issue_snapshot_run_not_succeeded`；governance 失敗仍為 502。拒絕時零 enqueue。省略 caller version 也查 canonical version 的正式 Issue 統計。enqueue 前重查 Session 版本。
- A1 所有來源可在明確選同版本 Session 後回拋。UI 檢查不是授權；後端仍重驗。
- Public outbox summary 保留既有欄位，只將非空 `last_error` 投影為 `callback_delivery_failed`；internal token 保護的詳細 evidence 不變。
- A1 只接受 exact outbox ID、`event=issue_snapshot`、`correlation_id=所選 Session`。202 是入列；pending 未送達，dead_letter 次數耗盡，查詢失敗／最近 200 筆缺席是未知。delivered 必須有有效送達時間，只代表接收端 HTTP 2xx，不證明雲端持久化／業務完成。查詢按鈕不重送。

沒有新增 route、migration、生產依賴、環境變數、排程或部署流程。未修改 frozen `governance-service/app.py`、`routes/governanceProxy.ts`、`conversion_authority.py`，未建立正式 SSO/source ACL。

## 可重跑的真 IFC 驗證

使用者指定許良宇圖書館建築 IFC，52,441,473 bytes，SHA256 `8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce`。原檔唯讀，IFC/USDC 不提交。修正版僅在隔離副本為 68 扇門加入 `VALIDATION_ONLY_NOT_CERTIFIED` 屬性值，保留 6,845 個元素 GUID。用途是 FAIL→PASS 與整改回歸，不作工程防火認證。

命令在本刀乾淨 worktree 執行。prepare 拒絕覆寫；run 讀正式 manifest，經 coordinator 建立真檢核／問題，再為 exact run/hash/Issue 建立有期限的 local-validation policy。此模式沿用已核准的隔離主管驗證權限，不是正式身分認證。

```powershell
.venv/Scripts/python.exe web-viewer-sample/e2e/support/prepare-a1-delivery.py prepare . r1 --original '<owner-provided IFC path>'
# Owner 以 process env 供裝 A1_REMEDIATION_INTERNAL_KEY、A1_REMEDIATION_LOCAL_VALIDATION=true、
# A1_REMEDIATION_LOCAL_POLICY_PATH=<run>/owner-remediation-policy.json；不輸出 secret。
pwsh -NoProfile -File scripts/dev/start-isolated-branch-stack.ps1 -Action start -ChangeId a1-delivery -RunId r1 -Offset 0
.venv/Scripts/python.exe web-viewer-sample/e2e/support/prepare-a1-delivery.py run . r1 --original '<owner-provided IFC path>'
# E2E_REQUIRE_REAL=1、E2E_STACK_MANIFEST=<run>/stack-manifest.json；
# A1_DELIVERY_E2E_FIXTURE 與 A1_REMEDIATION_E2E_FIXTURE=<run>/library-fixture.json。
# 在 web-viewer-sample 執行：
npm exec playwright test -- --config=playwright.a1-delivery.config.ts
```

`a1-delivery.spec.ts` 從正式 A1 選原版、檢核、建 Issue／去重、下載 Excel/BCF 解壓核對 topic/title/GUID/version、選同版本 metadata Session、入列／查詢、跨 A2–A4 保留、改選修正版檢核並清除舊交付。metadata Session 不分配 Kit、不造假 artifact；資料庫含另一版本真問題，避免空庫假隔離。

`a1-remediation.spec.ts` 另以同一 IFC 的 for-ifc-ready 問題，操作 local-validation policy 約束的確認、持久歷史、重載、重開及禁止重用舊修正版。兩段 run 身分各自保留，不冒充同一筆。

## 2026-09-13 當輪驗證

產品及測試 subject 為 `ad0199ab1b5d638bb643685612926079924af8bc`，base 為已合併第十一刀 `da775739f5f9760b66a64f85e691939a2df3dc60`。本節後續文件提交不改產品 bytes。官方隔離 stack 使用 `a1-delivery/r2`、offset 1（Viewer 5181、coordinator 8006、governance 49104），harness 關閉。

- Coordinator `npm run verify`：122 files / 2,143 tests，build 通過；Viewer `npm run verify`：135 files / 1,893 tests、typecheck、build 與 structured-log checks 通過；既有 BCF backend tests 12 passed。
- 真 IFC Playwright 2 passed：原版 7,059 次評估、6,991 PASS / 68 FAIL；同 run 建 Issue 68→0。下載的 Excel 含 `xl/workbook.xml`；BCF 2.1 的 68 個 topic 全部比對實際 Issue 標題、GUID、版本及 viewpoint identity，資料庫另有其他版本的 68 個 Issue。
- 修正版 SHA256 `a28d1e465da4311607fb153e6d590fb0eee023b7a358e20a8cc700b527bb85c2`，7,059 PASS / 0 FAIL。測試等待 succeeded 的匯出按鈕後才讀 summary，避免將 running 暫時顯示的 0 誤認通過。
- Playwright outbox `cbk_1789307470931_ce67b800`；Codex IAB 另操作原版 run `rr_6f9174ce33f6`、修正版 run `rr_8f65cd045dc7`、metadata Session `review_session_c30931f51c55`、outbox `cbk_1789307913837_425a7e38`。摘要入列與重新查詢顯示 pending、0/5；A2→A1 保留 run/receipt。IAB 點擊 Excel/BCF 後顯示 artifact；IAB download event 等待逾時，因此下載 bytes 的通過依據是上述 Playwright 實際檔案，不能由畫面標籤推論。
- 整改使用原 run `rr_acae7662e358`、修正版 `rr_898e989461ff`。Playwright Issue `iss_02fed1b96f65` 與 IAB Issue `iss_ca8e42dd0e7b` 分別驗證 resolved、重新載入的持久歷史、reopened、禁止重用已消耗的修正版。actor 明示 `local-library-validation`；測試另驗跨 origin POST 403。
- 真 loopback HTTP receiver 測試先回 503，再回 204，核對兩次相同 payload 與 pending→delivered；不是公司正式 receiver。錯版本／非 succeeded／upstream 延遲期間 Session 換版皆 409 且零 enqueue。UI 測試涵蓋切來源、ABA、舊 success/error/finally、雙擊與 outbox 查詢失败／查無／dead-letter／無效 delivered 時間。
- fixture prepare 在一般 Python 與 `python -O` 各驗 wrong root、`../escape`、既有修正版，6 次均在寫入前拒絕。原檔與主工作區模型未修改，IFC/USDC 不提交。
- 原始失敗紀錄保留：r1 的兩個 E2E assertion 分別未等 run 終態、以及以 GUID 匹配多版本 Issue，已修正後 r2 通過。首次 aggregate 缺少 kit-manager-web dependencies，補齊本 worktree 後該 build 通過。官方 stack 首次因 process PATH 有兩個 Node executable 而 rollback；限定本次 process PATH 後啟動成功，未改全域配置。r2 驗證完成後用相同 helper ownership-gated stop，exit 0。

持久測試入口與 fixture preparer 隨本 PR 保存。當輪大檔證據在 ignored `artifacts/e2e/a1-delivery/r2/`：`library-fixture.json`、`stack-manifest.json`、`iab-complete.json`，及 `playwright-output/884ba9d7-261b-4a9c-b62d-b768e7ce25c7/` 內的 `library.xlsx`、`library.bcfzip`、兩段 `trace.zip` 與四張操作截圖。Codex IAB 的 `slice12-iab-{outbox,confirmed,reopened,revised}.txt`、截圖與 `slice12-real-evidence.json` 保存於本次外部視覺化目錄；不將自動 IAB holder 的獨立頁面 screenshot 當成人工操作證據。

## PR #831 第三輪 review 修補

- 保留 opaque `model_version_id` 的原值，只以 `trim()` 拒絕全空白；不再單方面改寫 Session、run、BCF 或 snapshot 的版本身分。含前後空白的同版本成功；空白不同的版本、全空白與缺版本均拒絕交付。新增案例先重現 coordinator 4 個、UI 2 個失敗，再驗證修補。
- fixture preparer 的 GUID、原檔 digest、run succeeded、run source digest、tenant、68→0 FAIL、68 個 Issue 與發布 policy 前 digest 檢查，全部使用不受 `python -O` 影響的 `require`。`python web-viewer-sample/e2e/support/test_prepare_a1_delivery.py` 在正常與 `-O` interpreter 分別測 6 種 invalid evidence，12 組均拒絕且 fixture/policy bytes 不變；修補前 `-O` 可錯誤發布。
- Coordinator 完整 `npm run verify`：122 files / 2,149 tests；Viewer：135 files / 1,896 tests、typecheck/build、23 structured-log checks 通過。
- 新 receipt 設計由 Console Hi-Fi 的 `a1-delivery-state-reference` 定義，涵蓋 loading、pending、delivered、dead_letter、查詢失敗、查無與送達證據不完整。補充 manifest 為 [receipt-state-reference.json](receipt-state-reference.json)，含 source hashes、瀏覽器版本、DPR 1、兩 viewport 的 reference/current PNG 與 GET-only retry 紀錄。來源 hash 識別當次 worktree 內容，`subject_head` 是其 parent，不能誤稱乾淨 HEAD capture。
- `npx playwright test --config=playwright.a1-outbox-design.config.ts`：2 passed；14 個 state/viewport 配對的文字完全一致、按鈕狀態正確；每個 viewport 僅 36 pixels 差異，低於原主 manifest 的 1% 容差。重試只新增一個 `GET /api/callback-outbox/summary?limit=200`，沒有 POST。四張圖可直接比較：[1440 reference](receipt-states/1440x900-reference.png)、[1440 current](receipt-states/1440x900-current.png)、[1920 reference](receipt-states/1920x1080-reference.png)、[1920 current](receipt-states/1920x1080-current.png)。
- Codex in-app browser 另操作相同 production component 的 test-only loopback fixture，確認查詢失敗→重試→pending，並取得七狀態 DOM。外部證據 `slice12-r3-iab-retry.{txt,png}`、`slice12-r3-iab-states-dom.txt`、`slice12-r3-iab-states.png`。這是設計狀態證據；不是公司 receiver 或真 Kit evidence。
- 保留原 13-screen idle golden、主 design manifest、generic runner 與 threshold。本補充 state manifest 不擴充原 required pixel runner 的 coverage。原 runner 的 default/offline 綠燈與新增 receipt 狀態驗證分開計。
- GitNexus stale 重建失敗：`Failed calling LOWER: Invalid UTF-8`；health report 為 UNKNOWN。scoped detect 雖輸出 low，但索引未對齊 HEAD，不能當 pass，也不降低先前 HIGH。同第三輪 reviewer 已接受以 source/tests/exact diff 取代 unavailable gate 的限定風險程序；不是 GitHub human approval。
- 修補 subject `4a9172e04b06d4be2b013070b55947505456dcf8` 在乾淨 worktree 重跑官方 `a1-delivery/r3`。prepare 與 run 均用 `python -O`：原版 run `rr_15a9dcebac39` 為 6,991 PASS / 68 FAIL，修正版 `rr_4473344b0f5d` 為 7,059 PASS / 0 FAIL；修正版 SHA256 `049c263974b074b09cc60ac7a2a3243b9a1d85a39d74bb382504d6d1d67f182c`，原檔 SHA 與 6,845 個 GUID 保持不變。有效資料可正常發布限定 policy。
- 修補後真 IFC Playwright **2 passed**：Excel/BCF、68 topics 的逐項身分、版本隔離、snapshot、整改確認／reload 歷史／reopen 通過。下載與兩段 trace 位於 `artifacts/e2e/a1-delivery/r3/playwright-output/05c2cc8f-361d-4ad7-8ece-8c189e94f974/`；outbox=`cbk_1789312518457_d4c78a6f`。
- 修補後 Codex IAB 真 A1 另跑 `rr_4d85bd41584e`，選 Session `review_session_f0211a3e7626`，建立 Issue 並回拋 `cbk_1789312677506_0c70948d`；重新查詢仍為 pending 0/5，A2→A1 保留相同 receipt。實際 IAB DOM／畫面存於外部 `slice12-r3-iab-real-{dom.txt,outbox.txt,outbox.png}`；官方 holder 1 passed 只證明生命週期／guard，holder 的獨立頁面不是 IAB 操作截圖。r3 已由同一官方 helper ownership-gated stop，exit 0。

## V1–V8 證據對照與保留缺口

對照原需求 §6；本刀可送審，不宣稱 full-system E2E complete。前刀合併只證明 code 已落地，不能取代當輪 runtime。

| 驗收 | 當輪證據 | 結論與保留項 |
|---|---|---|
| V1 來源／版本 | 正式 library selector、原版與修正版 SHA、run version、BCF scope、snapshot server 重驗 | library 路徑已驗；MinIO ETag、cache drift、用途報表 PDF/CSV 本刀未重跑 |
| V2 轉換／retry | 本刀不觸發 conversion；aggregate 的 conversion functional 測試另明示 external stub | 真 MinIO→USDC、retry／重啟與用途判定尚未做本刀 exact-head 全程驗收 |
| V3 Session／lease | 明確選取同版本 metadata Session，不分配 Kit、不 claim lease；錯版拒絕 snapshot | 真 Kit 建立／occupied／refresh／release 本刀未驗，不能由 metadata Session 代替 |
| V4 Dock／來源切換 | 真 A1→A2→A3→A4→A1 保留 CPU 結果／receipt；改選修正版清除；DOM ABA／晚到回覆負向 | CPU 與交付狀態通過；active Viewer、lease 與 Stage 跨 Dock 保留未驗 |
| V5 觀看工具 | 無 Kit 時高亮／剖切／量測停用、沒有假距離；本刀無 runtime command | 真 first frame、正確 Stage、DataChannel、ACK、多色／剖切／量測及 SDK input 隔離仍缺；第十一刀 2.300m ±0.020m 仍是待核准提案 |
| V6 規則檢核 | 真原版 68 FAIL、修正版 0 FAIL、rule/source digest／GUID；成功終態後交付；切版本負向 tests | 本刀 CPU 規則及交付接線通過 |
| V7 Issue／BCF／outbox | 真同 run 去重、Excel/BCF bytes 與 68 topic/GUID/version；精確 outbox pending；loopback 503→204 | 本刀交付及本機 HTTP transport 通過；正式公司 receiver 收件／持久化／業務 ACK 尚未驗 |
| V8 整改／歷史 | 真 IFC 保留 GUID，兩筆獨立 UI 確認、重載、重開、舊修正版拒絕、跨 origin 拒絕 | 授權的本地主管驗證通過；正式公司 SSO／來源 ACL 依既有決議延期 |

本刀合併後，才可在 freshly fetched `origin/main` 與既有 owner 授權範圍內執行 canonical 測試部署及整合回歸。CPU、歷史證據、model approval 與 merge 皆不補足上表未驗項。

## 回滾

新 revert PR 撤回本刀並保留既有 Issue/run/outbox evidence。沒有 migration 或模型原檔寫入要回滾；測試 stack 以同一 launcher 的 `-Action stop` 核對 ownership 後停止。
