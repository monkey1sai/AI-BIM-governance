## Why

自 `a4-semantic-search-model-qa`（已於 2026-07-29 標 `Status: deferred`）切出的最小可完成切片。2026-07-29 收斂盤點實測發現：A4 的實作已在 `origin/main` 與 `codex/openspec/a4-semantic-search-model-qa-convergence`（下稱 convergence 分支）之間**雙向分岔**，兩側都不是完整實作，且分岔正在隨 main 前進而擴大。

實測數據（2026-07-29，subject `04e49f5`）：

| 檔案 | `origin/main` | convergence 分支 | 領先方 |
|---|---|---|---|
| `web-viewer-sample/src/console/A4SemanticSearchPage.tsx` | 458 行 | **938 行** | convergence |
| `governance-service/search/engine.py` | **1160 行** | 915 行 | main |
| `governance-service/search/proofs.py` | **623 行** | 356 行 | main |

母版 tasks 勾選同樣互補：convergence 獨有已勾 15 項（1.1–1.7、3.8、4.5、4.6、5.1、5.2、5.4、5.5、8.1），main 獨有已勾 5 項（3.1、3.9、6.3、6.4、6.5）。`git merge origin/main` 進 convergence 產生 **126 個衝突 hunk／23 檔**，集中在 `engine.py`(26)、`test_search_model.py`(17)、`proofs.py`(15)、`A4SemanticSearchPage.tsx`(14)、`api.py`(8)、`app.ts`(6)。

分岔的成因是 main 端持續有 A4 後端 PR 落地（#380 handoff backend、#398 session-bound search issues），而前端 live session-scoped Console 停留在未合併分支。結果是 `main` 上的 A4 Console 仍是 fixture 版，使用者看不到真實 A4 能力；而 convergence 分支的前端無法單獨運作，因為它依賴的後端契約已在 main 演進。

本 change 只做一件事：**把分岔收斂成單一 canonical A4 Console 實作並落到 `main`**。不承接母版中受外部條件封鎖的部分（credential rotate、Kit runtime evidence、live Ornith smoke、獨立 review）。

## What Changes

- **收斂前後端契約**：以 `origin/main` 的後端（`engine.py`／`proofs.py`／`api.py`／`a4HandoffRoutes.ts`）為基準，將 convergence 分支的 live session-scoped Console 前端移植上來，逐一調和 126 個衝突點。衝突調和原則：後端契約與 3D handoff 取 main（含 `MAX_A4_PROOF_*` 上限、`degraded_to_deterministic`、6.3–6.5 handoff）；前端 Console 結構與 session binding 取 convergence（5.1／5.2）；兩側皆有的 test 取聯集並確保實跑通過。
- **移除第二套 A4 入口**：`#/workspace?dock=a4` 收斂為唯一 canonical 操作面，`#a4`／`#/a4`／separate semantic-search entry 只保留相容轉址；不得留下兩套實作（承接母版 5.1）。
- **移除 production path mode 與 browser mapping input**：顯示 active-session binding；IFC-ready 相容結果標 `table_only` 並停用 Issue／3D（承接母版 5.2）。
- **補齊 visible states 與 component tests**：idle、loading、success、empty、uninterpreted、semantic error、retrying、retry-failed、source/session unavailable、proof-expired-draft-preserved（承接母版 5.3／5.6 中不依賴未實作 auth 的部分）。
- **驗證方式**：未 merge 期間一律用**隔離 alt-port branch stack**（coordinator `:8005`／governance `:49103`）取得 runtime 證據，不碰測試部署區 `:8004`。`rebuild-test-deploy.ps1` 定義為強制從 freshly fetched `origin/main` 重建，故部署區驗證只在本 change merge 後才適用。

**明確不做**（仍屬 deferred 母版，不得平行實作）：1.8 credential rotate（需 credential owner）、3.2–3.4 `UserAuthProvider` principal 與 lease 綁定、6.2／6.6／6.7 handoff 剩餘語意、7.1–7.7 全部 design/Playwright/Kit/live-smoke evidence gates、8.5／8.7／8.8。因此本 change **不宣稱** A4 semantic/full completion；`Full completion claimed` SHALL 為 `no`。

## Impact

- Affected specs：`a4-semantic-search`（ADDED，沿用母版 Requirement 名稱「Canonical A4 UI SHALL 可操作且接受誠實的 design gate」以利 crosswalk；母版未 archive 故 canonical spec 尚不存在）。
- Affected code：`web-viewer-sample/src/console/`（A4 Console 與 governanceClient）、`governance-service/search/`（衝突調和，不改既有對外契約）、`bim-review-coordinator`（僅衝突調和，不新增 route）。
- **與 deferred 母版的關係**：本 change 承接母版 5.1／5.2／5.3／5.6／8.3／8.4；母版對應 checkbox 於本 change merge 後於 thaw crosswalk 標記由本 change 承接，不得平行實作。
- **資產來源**：convergence 分支已保全於 `origin/codex/openspec/a4-semantic-search-model-qa-convergence`（`e0bac06`）；其前身 `codex/openspec/a4-semantic-search-model-qa` 已確認被 convergence superseded，保全於 origin（`9abb4af`）後場銷本地分支與 worktree。
- **不動凍結面**：不改 `governance-service/app.py`、`bim-streaming-server/conversion_authority.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`。
