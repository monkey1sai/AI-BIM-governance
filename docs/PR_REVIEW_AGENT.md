# PR Review Agent

本文件定義 `pr-review-agent` 的審查規則、報告格式與 rollout 方式。它是 PR gate，不是 merge bot；它幫人先整理風險與驗證證據，但不取代人工審查、CODEOWNERS、branch protection 或 merge 權限。

## 判定狀態

| Status | 意義 | Merge 影響 |
|---|---|---|
| `passed` | 必要 deterministic checks 通過，沒有 blocker | 可進入既有人工審查與 branch protection 流程 |
| `warning` | 必要 checks 通過，但有非阻擋提醒，例如 optional AI adapter 未設定或 GPU E2E 不適用 | 可進入人工審查，但 reviewer 必須看 warning |
| `blocked` | PR 缺少 OpenSpec、GitNexus evidence、repo boundary 說明，或觸發 secrets / runtime guard | 不應 merge，需補證據或修正 |
| `failed` | 必要命令失敗，或 report 無法產生 | 不應 merge，需修正失敗命令或工具本身 |

## 風險分級

| Risk | 判定方式 |
|---|---|
| `low` | 只有 docs/spec 或低風險 tooling 變更，必要 checks 通過 |
| `medium` | 有 warning、非阻擋 GitNexus/AI/GPU 限制，或需要 reviewer 留意的 workflow 變更 |
| `high` | 測試失敗、GitNexus unavailable 且沒有明確 tooling-only / rollout exception、未說明的跨 owner 邊界變更 |
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
- 修改既有 `.env`、private key、token / credential 檔案時一律 blocked；`.env.example` 或 `.env.*.example` 可作為 contract 變更進入人工審查。
- 不允許把 retired `_worker`、`_bim-control`、`_s3_storage`、`_conversion-service`、`_conversion-server` 重新寫成 current product runtime dependency。
- Code 或 script 變更需要 GitNexus detect changes evidence；若 unavailable，除 docs-only / tooling-only / rollout exception 外 fail closed。
- Optional AI adapter 不可把 deterministic failure 改成 passed。

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
3. 第一版 GitHub-hosted runner 若缺 OpenSpec / GitNexus 等本機工具，workflow 會把工具缺失記為 warning；等 runner provisioning 穩定後，再移除 exception 並升級為 hard gate。
4. 若 workflow 造成阻塞，可停用 `.github/workflows/pr-review-agent.yml` 或讓 job 只跑 report-only；不影響 product runtime。

## 人工審查邊界

`pr-review-agent` 的 `passed` 只代表自動 gate 通過。PR 仍必須遵守：

- human review；
- CODEOWNERS；
- branch protection；
- GitHub Actions 其他 required checks；
- OpenSpec archive / roadmap sync closeout。
