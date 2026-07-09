# Spec: A1 inline review session fix + local-first PR preflight governance

## 背景與需求來源

PR #319 修 A1「治理與模型檢核」的真實使用流程：MinIO IFC 必須能直接在 A1 頁選檔、選 IDS、執行 rule-run，並從 A1 建立 / 選擇 3D review session 後直接送出 highlight，不要求使用者跳到 Review Room 或手動 attach。使用者在同一 PR CI 修復期間進一步要求：**GitHub workflow 能本機檢查的 gate 必須先本機跑，不得把 CI 當第一輪錯誤發現工具**；跳過這件事造成多輪 CI 等待，視為嚴重開發時間浪費。

## 變更範圍（最小 diff）

Runtime / UI 修復範圍：

- `bim-review-coordinator`：修正 MinIO IFC conversion idempotency、downloaded IFC-ready retry context、artifact health canonicalization、review-session/control-plane routes。
- `governance-service` proxy path：IDS path 僅允許 `rules/<basename>.ids`，避免 server-local path 泄露或被硬寫進 UI。
- `bim-streaming-server`：conversion authority 支援 A1 inline review-session 所需 artifact / mapping readiness。
- `web-viewer-sample`：A1 頁直接建立 / 選擇 review session、claim viewer lease、等待 first frame / DataChannel / stage match，並送 highlight。

Governance 修復範圍：

- `AGENTS.md`：新增 CI 本機先行鐵律。
- `docs/agents/github-workflow.md`、`docs/agents/sub-repo-verify-commands.md`、`.claude/workflows/ship-item.*`：把 local PR preflight 寫成 push / CI watch 前硬 gate。
- `scripts/dev/check-pr-local-preflight.ps1`：封裝本機 preflight；預設用本機 `origin/main...HEAD` changed paths 檢查 PR body evidence，並可執行本機 PR review agent / viewer verify，避免等 GitHub 才發現可本機重現的錯。

## 不變式

- 不把 MinIO IFC 或大型 viewer artifacts commit 進 repo；E2E 截圖保留為本機 evidence。
- 不改 secrets / `.env` 實際值。
- 不把 GitHub Actions 綠燈偽裝成本機驗證；本機可跑的 gate 要先有本機通過證據。
- PR body-only 修正不可只 `gh run rerun`；必須本機 preflight 綠後 push 新 commit 觸發新的 `pull_request.synchronize` payload。

## 成功標準

- A1 deployed E2E：MinIO IFC -> rule-run -> A1 inline 3D session -> first frame / DataChannel / stage match -> highlight ack。
- `web-viewer-sample npm run verify` 本機通過。
- `scripts/tests/check-pr-body-evidence.ps1` 對 Frontend / Deploy / AI Coding Governance tables 本機通過。
- `scripts/pr-review-agent.ps1` 可在 repo-local temp 目錄下本機跑出與 CI 等效的 review verdict；若本機環境缺工具，必須明確標為 unavailable，不得等 CI 才發現。

## 已知風險

- 本機 preflight 會增加 agent ship 前成本；但它取代的是更慢的 GitHub CI 往返，且能提早抓到 PR body/event payload 問題。
- `pr-review-agent` 會執行多個 sub-repo verify；本機缺依賴時要先修本機環境或明確記錄 unavailable，不能直接跳到 GitHub。
