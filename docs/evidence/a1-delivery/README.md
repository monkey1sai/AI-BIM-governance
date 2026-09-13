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

當輪測試／Codex IAB 結果、IDs、截圖／trace、V1–V8 對照另寫驗證紀錄；執行前為尚未驗證。正式公司接收端、MinIO intake/conversion、真 GPU first-frame／Stage／DataChannel／ACK 不由這組 CPU/交付測試替代。

## 回滾

新 revert PR 撤回本刀並保留既有 Issue/run/outbox evidence。沒有 migration 或模型原檔寫入要回滾；測試 stack 以同一 launcher 的 `-Action stop` 核對 ownership 後停止。
