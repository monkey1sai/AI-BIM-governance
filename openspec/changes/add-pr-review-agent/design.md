## 背景

目前 repo 已有 OpenSpec + GitHub workflow 的治理規則：OpenSpec 是需求 / 規格 / 驗收條件，Pull Request 是審查與討論邊界，GitHub Actions 是自動驗證邊界。實際 repo 中 `.github/workflows/` 尚未建立，但 root `scripts/verify-all.ps1` / `scripts/verify-all.sh` 已是跨服務最小驗證入口。

使用者的需求是「AI coding 產生內容太龐大，需要一個可以自動審批程式碼、驗證每次 PR 的 agent」。本設計將「自動審批」收斂為可稽核的 PR review gate：agent 可以給出 `passed` / `blocked` / `failed` / `warning` 結論與審查證據，但不自動 merge、不繞過 branch protection、不取代 CODEOWNERS 或人工 review。

此 change 是 repo workflow / CI capability，不是 BIM runtime capability。它不得改變 `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample`、外部 IFC Worker 或外部公司雲端的責任邊界。

## 目標 / 非目標

**目標：**

- 每個 PR 都自動產生一份人看得懂、可重播、可比對的 review agent report。
- 自動檢查 OpenSpec 對齊、repo 邊界、secrets / `.env` 實值修改、generated tooling 檔案、測試 / build / smoke 結果與 GitNexus 影響範圍。
- 依 changed paths 選出最小必要驗證，避免每個 docs-only PR 都跑完整 runtime / GPU 測試。
- 將 HIGH / CRITICAL 風險、缺少 OpenSpec change、未說明的跨邊界變更、測試失敗與 secrets 風險變成 PR gate blocker。
- 將 agent 結論輸出成 GitHub status check / PR comment / workflow artifact，讓使用者不用從一堆 log 裡猜結果。

**非目標：**

- 不自動 merge PR。
- 不自動 dismiss human review、CODEOWNERS 或 branch protection。
- 不把本機 `.codex/skills`、GitNexus generated skills、Graphify wiki 或特定 agent 安裝狀態變成產品需求。
- 不新增 production runtime dependency。
- 不要求 GPU / Kit / browser E2E 在每個 PR 都執行；硬體相依項目需要被分類成 `blocked`、`deferred` 或 `not_required`，不能冒充 passed。
- 不修改 product runtime API、Socket.IO event、DataChannel payload、storage layout 或 session schema。

## 決策

### 決策 1：GitHub Actions 負責觸發，root scripts 負責產生 review report

PR review agent 由 `.github/workflows/pr-review-agent.yml` 在 `pull_request` 的 `opened`、`synchronize`、`reopened`、`ready_for_review` 事件觸發。Workflow 只負責 checkout、設定 runtime、呼叫 root script、上傳 artifact 與回寫 PR comment / status check。

實際判斷邏輯放在 root `scripts/`，例如 `scripts/pr-review-agent.ps1` 與可選的 POSIX / Python helper。這樣可在本機重跑，不會把審查規則鎖死在 GitHub Actions YAML 裡。

替代方案是只用 GitHub Actions inline shell，但日後很難本機復現，也難以測試 report schema。

### 決策 2：deterministic gates 優先，optional AI review 次之

Agent report 必須先收集可機器驗證的 deterministic gates：

- changed paths / diff summary；
- OpenSpec change id 與 `openspec validate <change-id>`；
- `scripts/verify-all.ps1` / `.sh` 或依路徑縮小後的 service verify；
- GitNexus detect changes 或不可用原因；
- secrets / `.env` / private key / generated tooling path guard；
- repo boundary guard，例如不得把 retired `_worker` / `_bim-control` 當作 runtime dependency 加回來。

LLM / Codex / external AI review 可以作為第二層 reviewer comment，但不得取代 deterministic gates。若 AI adapter 不可用，PR gate 仍能產生 deterministic report；只有明確要求 AI verdict 的設定才將 adapter 不可用標成 blocker。

替代方案是直接讓 LLM 讀 diff 後 approve，但這會把測試、secret scan 與 repo 邊界檢查變成模型主觀判斷，風險太高。

### 決策 3：report schema 必須穩定且 PR 可讀

每次 run 都產生 machine-readable JSON 與 markdown summary。JSON 至少包含：

- `status`: `passed`、`warning`、`blocked`、`failed`；
- `risk_level`: `low`、`medium`、`high`、`critical`；
- `pr_number`、`base_ref`、`head_ref`、`base_sha`、`head_sha`、`run_id`；
- `changed_paths[]`、`openspec_changes[]`、`validation_commands[]`；
- `checks[]`，每個 check 有 `name`、`status`、`owner`、`command`、`summary`、`evidence_path`；
- `blockers[]`、`warnings[]`、`human_review_notes[]`；
- `gitnexus`，記錄 detect changes 結果、stale / unavailable 狀態與是否阻擋。

Markdown summary 要保留同樣結論，但用人話呈現：這個 PR 改了哪裡、跑了什麼、哪裡擋住、哪些風險要人工看。

### 決策 4：只在 safety-critical 條件下 fail closed

Review gate MUST block when：

- tests / build / required OpenSpec validation failed；
- PR 修改 secrets、private keys 或既有 `.env` 實值；
- code change 沒有可接受的 GitNexus detect changes 結果，且不是 docs-only / spec-only exception；
- HIGH / CRITICAL risk 沒有 mitigation 或人工 override note；
- PR 重新引入 retired runtime dependency，或改變核心 repo 邊界但沒有 OpenSpec requirement / design 說明；
- report 產生失敗，導致 reviewer 無法知道 agent 實際檢查了什麼。

Review gate MAY return `warning` when optional AI adapter、GPU / Kit E2E、browser evidence 或外部服務不可用，前提是該 PR 的 changed paths 不要求該層 evidence。

### 決策 5：path-based validation planner 保持 PR feedback 快速

Review agent 先分類 changed paths，再選擇最小必要檢查：

- `openspec/**`：`openspec validate <change-id>`；
- `bim-review-coordinator/**`：`npm run verify` in coordinator；
- `web-viewer-sample/**`：`npm run verify` 或既有 viewer build / test command；
- `bim-streaming-server/**`：conversion authority API tests 或 stage-loading contract smoke；
- `tests/**`：repo root pytest；
- `scripts/**`：script parse / unit checks；
- docs-only：OpenSpec / docs consistency checks，不要求 GPU runtime；
- root boundary docs：確認 `AGENTS.md`、`README.md`、workflow / roadmap cross-reference 沒有互相矛盾。

若 path planner 不確定，回退到 `scripts/verify-all.ps1` / `.sh`，並在 report 記錄為 broad validation。

### 決策 6：permissions 與 secrets 採最小化

GitHub Actions workflow 預設使用最小權限：`contents: read`、`pull-requests: write`、`checks: write`。需要外部 AI service 時，必須透過 GitHub Actions secrets 設定，且 workflow 不得在 fork PR 暴露 secret。Fork PR 可跑 deterministic read-only checks，AI adapter 自動跳過並在 report 記錄原因。

Rollback 方式：停用或刪除 `.github/workflows/pr-review-agent.yml`，保留 scripts / docs 也不影響 product runtime。

## 風險 / 取捨

- [Risk] Agent 被誤解成可以完全取代人類審查 → Mitigation: spec 明確要求不可自動 merge、不可取代 CODEOWNERS / branch protection，輸出只作 gate 與 evidence。
- [Risk] 每個 PR 都跑完整驗證太慢 → Mitigation: path-based planner 先選最小必要 checks，不確定才回退 broad validation。
- [Risk] GitNexus index stale 或 CLI unavailable 造成 workflow 不穩 → Mitigation: report 必須記錄 stale / unavailable；code changes 預設 blocked，docs-only exception 必須明確標示。
- [Risk] LLM reviewer hallucinate 或忽略測試結果 → Mitigation: deterministic gates 決定 pass/block，AI review 只能補充風險摘要與建議。
- [Risk] Fork PR 無法安全使用 secrets → Mitigation: fork PR 只跑 read-only deterministic checks，AI adapter 跳過並輸出 warning。
- [Risk] Report 太長沒人看 → Mitigation: PR comment 只保留摘要、blockers、commands 與 artifact link；完整 JSON / markdown 放 workflow artifact。

## 遷移計畫

1. 新增 `pull-request-review-agent` spec 與 task checklist。
2. 後續 apply 時先實作本機 dry-run script 與 schema 測試。
3. 新增 GitHub Actions workflow，先以 non-blocking 或 required check 候選方式觀察一到兩個 PR。
4. 確認 false positive / false negative 後，再把 `pr-review-agent` status check 設為 branch protection required check。
5. 若 workflow 造成阻塞，停用 workflow trigger 或將 gate mode 改為 report-only，產品 runtime 不需 rollback。

## 待釐清問題

- 是否要讓 agent 寫 GitHub review `APPROVE`，或只寫 status check `passed`？本 change 預設只要求 status / comment gate，不要求 GitHub review approval。
- 是否要把 external AI adapter 納入第一版 apply？本 change 預設 deterministic gate 先落地，AI adapter 可作 follow-up。
