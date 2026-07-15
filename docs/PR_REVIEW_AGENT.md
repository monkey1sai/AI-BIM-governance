# PR Review Agent

本文件定義 `pr-review-agent` 的審查規則、報告格式與 rollout 方式。它是 PR gate，不是 merge bot；它幫人先整理風險與驗證證據，但不取代人工審查、CODEOWNERS、branch protection 或 merge 權限。

## 判定狀態

| Status | 意義 | Merge 影響 |
|---|---|---|
| `passed` | 必要 deterministic checks 通過，沒有 blocker | 可進入既有人工審查與 branch protection 流程 |
| `warning` | 必要 checks 通過，但有非阻擋提醒，例如 optional GitNexus tooling unavailable exception 或 GPU E2E 不適用 | 可進入人工審查，但 reviewer 必須看 warning |
| `blocked` | behavior=yes 卻缺 formal requirement source、behavior=no 與明顯 contract diff 矛盾、缺必要 GitNexus evidence，或觸發 secrets/runtime guard | 不應 merge，需補證據或修正 |
| `failed` | 必要命令失敗，或 report 無法產生 | 不應 merge，需修正失敗命令或工具本身 |

## 風險分級

| Risk | 判定方式 |
|---|---|
| `low` | 只有 docs/spec 或低風險 tooling 變更，必要 checks 通過 |
| `medium` | 有 warning、非阻擋 GitNexus/AI/GPU 限制，或需要 reviewer 留意的 workflow 變更 |
| `high` | 測試失敗、GitNexus execution failed、GitNexus unavailable 且沒有明確 tooling-only / rollout exception、未說明的跨 owner 邊界變更 |
| `critical` | secret/private key/real `.env` 風險，或明確破壞 repo runtime boundary |

## 必要報告欄位

每次執行都會產生：

- `pr-review-agent.json`
- `pr-review-agent.md`

JSON 必須包含：

```json
{
  "schema_version": "pr-review-agent/v1",
  "status": "passed",
  "risk_level": "low",
  "pr_number": "123",
  "base_ref": "main",
  "head_ref": "codex/openspec/example",
  "base_sha": "...",
  "head_sha": "...",
  "run_id": "...",
  "changed_paths": [],
  "change_lane": "B",
  "behavior_contract_changed": "no",
  "requirement_source": "existing contract",
  "behavior_contract_signals": [],
  "openspec_changes": [],
  "validation_commands": [],
  "checks": [],
  "blockers": [],
  "warnings": [],
  "human_review_notes": [],
  "gitnexus": {}
}
```

Markdown summary 只保留人要先看的內容：verdict、blockers、warnings、commands、human review notes 與 artifact path。

## Guardrails

- 不印出 secret 值，只回報檔案路徑與風險類型。
- 修改既有 `.env`、private key、token / credential 檔案時一律 blocked；若 PR 只刪除這類檔案，允許進入人工審查但必須以 warning 要求確認 rotation / remediation；`.env.example` 或 `.env.*.example` 可作為 contract 變更進入人工審查。
- 不允許把 retired `_worker`、`_bim-control`、`_s3_storage`、`_conversion-service`、`_conversion-server` 重新寫成 current product runtime dependency。
- Lane F 不強制 GitNexus；Lane B 對 task/entry symbol 跑一次 impact，只有 code symbol/flow 變更才需要 detect_changes；Lane G/S 保留完整 impact/detect_changes。CI 不安裝 GitNexus；本機實際執行失敗不可寫成 passed。
- Formal requirement gate 依 behavior 判定，不依 service/tests/scripts changed path：behavior=yes 或 Lane G/S 必須填 issue、docs/plans、superpowers spec 或 existing contract；behavior=no 不會只因路徑缺 OpenSpec 而 blocker。
- behavior=no 但 diff-line analysis 明顯新增或刪除 public API、frontend route、schema/migration 或 runtime/deploy/security boundary 時，回報 `behavior_contract_mismatch` blocker；F/B 對 Governed trigger 自報降級時回報 `governed_lane_mismatch`。
- OpenSpec archive / formal spec closeout 會跑 `openspec validate --specs --strict`；`openspec/changes/archive/` 不會被當成 active change id。
- Optional AI adapter 不可把 deterministic failure 改成 passed；預設未要求 AI verdict 時只記錄 human note，不把 gate 降成 warning。

## 本機重跑

OpenSpec-only dry run：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 `
  -ChangedPath openspec/changes/add-pr-review-agent/proposal.md `
  -ChangedPath openspec/changes/add-pr-review-agent/design.md `
  -ChangedPath openspec/changes/add-pr-review-agent/specs/pull-request-review-agent/spec.md `
  -ChangedPath openspec/changes/add-pr-review-agent/tasks.md `
  -OutputDir artifacts/pr-review-agent-local
```

完整 PR run 通常由 GitHub Actions 提供 `base_sha` / `head_sha`。本機若要比對兩個 commit：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 `
  -BaseSha origin/main `
  -HeadSha HEAD `
  -OutputDir artifacts/pr-review-agent-local
```

Report-only 模式不會用 exit code 擋流程，適合 draft PR 或 rollout 觀察：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pr-review-agent.ps1 -ReportOnly
```

## GitHub Actions rollout

1. 先讓 workflow 在 PR 上產生 report 與 comment，觀察 false positive / false negative。
2. 確認審查訊號穩定後，再把 `pr-review-agent` status check 加到 branch protection required checks。
3. GitHub-hosted runner provision OpenSpec、pytest 與 coordinator/viewer dependencies；CI 預設跳過 GitNexus install / analyze，避免每個 PR 長時間 bootstrap。GitNexus 仍由本機 agent / MCP 在改 symbol 前與 commit 前提供 evidence；CI 的 skip 只降級為 warning，GitNexus execution failed（若實際執行）不可降級。
4. 若 workflow 造成阻塞，可停用 `.github/workflows/pr-review-agent.yml` 或讓 job 只跑 report-only；不影響 product runtime。

## Required checks

本 repo 要宣稱 Level 5 AI coding governance 時，`main` 的 branch protection / ruleset 應把下列 checks 設為 required：

| Check | Purpose |
|---|---|
| `pr-review-agent` | PR lane/behavior/source、GitNexus/path guard、validation plan、report artifact |
| `agent-governance` | Agent-readable issue template, CODEOWNERS, workflow, PR template, and governance-doc drift check |
| `root contracts and fakes` | External platform contracts plus test-only fakes |
| `coordinator build and tests` | TypeScript build and Vitest for coordinator control plane |
| `governance-service tests` | A1/A2/A3 CPU governance backend tests |
| `viewer build and tests` | Viewer build, Vitest, and structured-log check |
| `kit-manager-api tests` | Kit Manager API Python unit tests |
| `kit-manager-web build` | Operator UI TypeScript/Vite build |
| `docker compose config` | Hybrid compose YAML/env-file config validation |
| `powershell static analysis` | PSScriptAnalyzer `Error` severity gate for scripts |
| `secret pattern scan` | High-signal private key/token pattern smoke |

PR body evidence is enforced inside the `pr-review-agent` workflow. Every PR requires `Change lane`、`Behavior contract changed`、`Requirement source`; the checker reads added/deleted diff lines to catch obvious declaration mismatches and rejects F/B metadata for Governed triggers。其他表格依範圍條件觸發：

- governance paths require the `AI Coding Governance` rows;
- user-facing/frontend paths require the `Frontend Verification` rows;
- runtime/deploy paths require the `Deploy Path Verification` rows.

Workflows that are intended to become required checks must run on every PR and produce a check result. Do not add `paths` / `paths-ignore` filters to `pr-review-agent` or `agent-governance`; if cost control becomes necessary, perform path detection inside the job and emit an explicit no-op success.

Remote-only step：本文件與 `.github/CODEOWNERS` 只能準備 enforcement；真正 required checks、review policy、dismiss stale approvals、禁止 bypass 等規則，仍必須在 GitHub repository settings / rulesets 中啟用並驗證。目前 solo-maintainer 例外保留 Require PR、strict 11 checks、admin enforcement 與無 bypass，但設定 approval=0／CODEOWNER review=false；CODEOWNERS 在此模式只作 ownership／routing，獨立 review trust 仍是公開缺口。

## 人工審查邊界

`pr-review-agent` 的 `passed` 只代表自動 gate 通過。PR 仍必須遵守：

- remote settings 實際要求的 human／CODEOWNERS review（solo-maintainer 例外目前不要求，且不算獨立 review trust）；
- branch protection；
- GitHub Actions 其他 required checks；
- OpenSpec archive / roadmap sync closeout。
