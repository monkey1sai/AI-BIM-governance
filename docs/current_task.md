# 任務：創建新 branch 與理解專案

## Objective (目標)
- 創建新的 Git 分支以進行後續開發。
- 深入理解專案的目錄結構、各模組的職責、資料流向以及驗證方式。

## Plan (執行計畫)
- [x] 1. 建立並切換至新 Git 分支。
- [x] 2. 檢索並閱讀專案核心說明文件（`AGENTS.md`、`README.md`）。
- [x] 3. 深入探索專案結構（各個子模組：`bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample` 等）。
- [x] 4. 進行初步的環境與測試驗證。
- [x] 5. 撰寫專案理解總結。
- [x] 6. 將專案理解、本地環境驗證與 AI Coding 方案寫入本分支的 `docs/PROJECT_UNDERSTANDING.md`。
- [x] 7. 以 OpenSpec 建立 `project-risks-mitigation` 規格，並為 5 個風險給予 Requirement ID。

## Context & Thoughts (上下文與思考)
- 我們已經成功為專案建立 `.venv` 並安裝所有必要的依賴，包括 `fastapi`、`usd-core` (用於 openusd 測試的 `pxr`)、`ifcopenshell` 等。
- 順利跑通了整個 repo 目前現存的所有單元與合約測試。
- 順利建立並寫入了本分支的正式文檔 `docs/PROJECT_UNDERSTANDING.md`。
- 成功透過 `openspec` 建立變更，並將五個風險編寫為具有 Scenario 與 ID 的規格文件。

## Handoff Note (交接說明)
- 任務已全部圓滿完成！所有規格文件、本地驗證測試、以及風險對齊工作皆已到位。
- 分支 `feat/understand-project` 已處於乾淨且準備妥當的開發狀態。
