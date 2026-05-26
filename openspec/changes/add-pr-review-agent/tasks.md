## 1. Review Policy And Report Contract

- [x] 1.1 新增 PR review agent policy 文件，明確定義 `passed`、`warning`、`blocked`、`failed` 與 `low`、`medium`、`high`、`critical` 的判定規則。
- [x] 1.2 定義 review report JSON schema 與 markdown summary 格式，欄位至少包含 PR identity、changed paths、OpenSpec changes、validation commands、checks、blockers、warnings、human review notes 與 GitNexus evidence。
- [x] 1.3 定義 secrets / `.env` / private key / generated tooling path guard，不得輸出 secret 值本體。
- [x] 1.4 定義 human approval boundary，確認 agent 只能產生 gate verdict / comment / check result，不自動 merge、不取代 CODEOWNERS 或 branch protection。

## 2. Local Review Agent Script

- [x] 2.1 在 root `scripts/` 新增可本機重跑的 PR review agent script，不新增 production dependency。
- [x] 2.2 實作 changed-path planner，依 `openspec/`、`bim-review-coordinator/`、`web-viewer-sample/`、`bim-streaming-server/`、`tests/`、`scripts/`、docs-only 變更選擇最小必要驗證。
- [x] 2.3 實作 OpenSpec detection：PR 含 `openspec/changes/<change-id>/` 時執行 `openspec validate <change-id>`；行為或邊界變更沒有 change id 時回報 blocker。
- [x] 2.4 實作 repo boundary guard：偵測 retired `_worker`、`_bim-control`、`_s3_storage`、`_conversion-service`、`_conversion-server` 被重新寫成 current runtime dependency 的變更。
- [x] 2.5 實作 GitNexus detect changes integration；若 code / script 變更時 GitNexus stale、unavailable 或 failed，除明確 docs/tooling exception 外回報 blocker。
- [x] 2.6 實作 deterministic check runner，記錄 command、working directory、exit code、summary 與 evidence path。
- [x] 2.7 產生 JSON report 與 markdown summary，並在 report 產生失敗時 fail closed。

## 3. Automated Workflow Integration

- [x] 3.1 新增 `.github/workflows/pr-review-agent.yml`，在 `pull_request` 的 `opened`、`synchronize`、`reopened`、`ready_for_review` 事件執行。
- [x] 3.2 設定 workflow 最小權限：`contents: read`、`pull-requests: write`、`checks: write`；fork PR 不暴露 secret。
- [x] 3.3 將 review report JSON / markdown 上傳為 workflow artifact。
- [x] 3.4 將 markdown summary 回寫到 PR comment 或 check summary，摘要只保留 verdict、blockers、warnings、commands 與 artifact link。
- [x] 3.5 第一版 workflow 預設 deterministic gate 可運作；optional AI adapter 若未被 policy 要求，必須記錄 skipped note 而不是產生假通過或預設 warning。

## 4. Tests And Fixtures

- [x] 4.1 新增 scripts-level unit 或 dry-run 測試，覆蓋 docs-only PR、OpenSpec PR、service code PR、secret-like path PR、retired runtime reintroduction PR。
- [x] 4.2 新增 report schema fixture，驗證 JSON report 包含必要欄位且 markdown summary 可讀。
- [x] 4.3 新增 GitNexus unavailable fixture，驗證 code changes fail closed、docs-only exception 可記錄 warning。
- [x] 4.4 新增 path planner fixture，驗證 affected folders 對應到正確 owner 與最小驗證命令。

## 5. Documentation And Rollout

- [x] 5.1 更新 `README.md` 或 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 的 PR workflow 說明，加入 PR review agent gate 的角色與限制。
- [x] 5.2 文件中說明如何本機重跑 review agent script，以及如何解讀 `blocked`、`failed`、`warning`。
- [x] 5.3 文件中說明 branch protection / required check 的 rollout 建議：先 report-only 觀察，再升為 required check。
- [x] 5.4 明確記錄 rollback 方式：停用 workflow trigger 或刪除 workflow，不影響 product runtime。

## 6. Validation

- [x] 6.1 執行 `openspec validate add-pr-review-agent`。
- [x] 6.2 執行 review agent script dry-run，使用目前 change 作為 OpenSpec-only PR fixture。
- [x] 6.3 執行 scripts-level tests / parse checks，確認 report schema 與 path planner 行為。
- [x] 6.4 執行 `gitnexus_detect_changes()` 或等價 GitNexus detect changes；若工具 unavailable，記錄確切原因與 docs/spec-only exception。
- [x] 6.5 確認 `git diff` 只包含此 OpenSpec change 與必要 workflow / docs / scripts 變更。

Validation notes:

- `gitnexus detect-changes` without `--repo` was ambiguous because this machine has multiple indexed repositories.
- `gitnexus detect-changes --repo AI-BIM-governance` completed with `No changes detected`, but warned that the selected index belongs to `C:\Repos\active\iot\AI-BIM-governance` and the current `d67f` worktree is a sibling clone ahead of the indexed commit; treat this as stale/sibling evidence, not a clean current-worktree GitNexus pass.
- `git status --short --branch` showed only this OpenSpec change plus necessary `.github/workflows/`, `docs/`, `scripts/`, `README.md`, and `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` changes.
- Follow-up PR review fixes on 2026-05-26:
  - changed-path detection now uses merge-base semantics instead of base/head tip comparison;
  - retired runtime guard now blocks dependency/startup wiring instead of any guard-list text mention;
  - GitHub-hosted rollout can record missing OpenSpec / GitNexus tools as warning rather than self-blocking;
  - report generation fallback now works even when the library fails to load.
- Re-validation after the follow-up fixes:
  - `openspec validate add-pr-review-agent` passed.
  - `openspec status --change add-pr-review-agent` showed artifacts complete.
  - PowerShell parse checks passed for `scripts/pr-review-agent.ps1`, `scripts/lib/pr-review-agent.ps1`, and `scripts/tests/test-pr-review-agent.ps1`.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-pr-review-agent.ps1` passed.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 -OutputDir artifacts\pr-review-agent-local-fix -AllowGitNexusUnavailable -AllowUnavailableCommands` completed with `status=warning risk=medium`, with only the optional AI adapter warning.
  - `git diff --check` passed with only LF/CRLF normalization warnings.
  - `gitnexus detect-changes --repo AI-BIM-governance` completed with `No changes detected`, while retaining the stale/sibling worktree warning.
- PR review feedback fixes on 2026-05-26:
  - optional AI adapter is now recorded as a human review note by default, not a warning, unless `PR_REVIEW_AGENT_REQUIRE_AI` makes it mandatory;
  - working-tree changed-path fallback now parses `git status --porcelain=v1 -z`, including rename/copy records with spaces or shell-special path characters;
  - secret path tests now assert that no blocker message leaks token/password-like values.
- Re-validation after PR review feedback fixes:
  - `openspec validate add-pr-review-agent` passed.
  - PowerShell parse checks passed for `scripts/pr-review-agent.ps1`, `scripts/lib/pr-review-agent.ps1`, and `scripts/tests/test-pr-review-agent.ps1`.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-pr-review-agent.ps1` passed.
  - `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 -OutputDir artifacts\pr-review-agent-local-review-fix -AllowGitNexusUnavailable -AllowUnavailableCommands` completed with `status=passed risk=low`.
  - `git diff --check` passed with only LF/CRLF normalization warnings.
  - `gitnexus detect-changes --repo AI-BIM-governance` completed with `No changes detected`, while retaining the stale/sibling worktree warning.
