---
name: closed-loop-orchestrator
description: 串接 AI-BIM-governance / OpenSpec / GitNexus 三技能完整 14-step 閉環。當使用者要「開始新 change」、「跑完整閉環」、「自動化 OpenSpec 流程」時使用。本技能不會自動執行 merge / archive，所有不可逆 phase 都會停下來等使用者確認。
disable-model-invocation: true
allowed-tools: Bash(git status*) Bash(git fetch*) Bash(git switch*) Bash(git rev-parse*) Bash(gh pr list*) Bash(gh pr view*) Read Grep Glob Skill
---

# Closed-Loop Orchestrator

依 [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) 與 [AGENTS.md](AGENTS.md) 規範，串接完整的 OpenSpec change 閉環。

## 觸發前提

- `main` 工作樹乾淨
- 上一個 change 的 implementation PR 與 archive PR 都已 merge

如不滿足，停止並回報。

## 14-step 閉環（依 Phase 分批執行）

### Phase A：起點判定（Step 1–3）

呼叫 `change-id-resolve` skill：

```
/change-id-resolve
```

取得 `{ change_id, branch_plan, existing_pr, blockers }`。

**Gate**：
- `blockers` 非空 → STOP 並回報
- 若 `branch_plan == "new"` → `git switch -c codex/openspec/<change-id>`
- 若 `branch_plan == "continue-existing"` → `git switch <branch>` 並 pull rebase

### Phase B：規格收斂（Step 4）

呼叫 `openspec-explore-twice` skill：

```
/openspec-explore-twice <change-id>
```

至少兩輪 explore，直到 `open_questions` 全清。

**Gate**：
- `openspec validate <change-id> --strict` 必須綠燈
- `proposal.md` / `design.md` / `tasks.md` / `specs/*.delta.md` 必須齊全

### Phase C：風險判讀（Step 5）

呼叫 `gitnexus-blast-radius` skill（pre-change 模式）：

```
/gitnexus-blast-radius pre-change <symbol1,symbol2,...>
```

**Gate**：
- `risk_level == CRITICAL` → 必須先拆 change 或取得 reviewer sign-off
- `risk_level == HIGH` → 在 PR body 標記並補額外 tests

### Phase D：實作與驗證（Step 6–9）

呼叫 `apply-and-verify` skill：

```
/apply-and-verify <change-id>
```

包含：
1. apply 程式碼變更
2. 同步 OpenSpec artifacts、focused tests、verification docs
3. 四層驗證（openspec validate / focused tests / `git diff --check` / `gitnexus detect-changes`）
4. commit（Conventional Commits）
5. push + `gh pr create` 開 implementation PR

**Gate**：四層驗證全綠才能 push。

### Phase E：Review Gate（Step 10–12）

**停下來**，由使用者執行：

```
/pr-review-gate <pr-number>
```

該 skill 會：
- 跑 `gh pr checks` 等待 CI 結果
- 列出 review comments
- 若有 blocking risk，自動觸發 `gitnexus-blast-radius post-change` 進入 debug loop
- 全綠後**等待使用者明確同意**才 `gh pr merge --squash --auto --delete-branch`

### Phase F：Archive & Closeout（Step 13–14）

**停下來**，由使用者執行：

```
/archive-and-closeout <change-id>
```

該 skill 會：
1. 建立 `codex/openspec/archive-<change-id>` branch
2. `openspec archive <change-id>`
3. 同步 `openspec/specs/` 正式 specs
4. 更新 [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) 與同名 HTML
5. 開 archive PR → review → merge
6. closeout：刪除 implementation branch（保留 `revert-*` / `release` / `hotfix`）

## 安全條款（強制）

| 條款 | 規則 |
|---|---|
| Branch isolation | 永遠不在 `main` 直接 commit |
| NoSuccessorWhilePredecessorOpen | predecessor 未完整 closeout 前，不開 successor 的 active change |
| Two-PR policy | implementation PR 與 archive PR 必須分開，archive 不得搭便車 |
| Merge confirmation | `gh pr merge` 前必須使用者明確同意 |
| Roadmap sync | archive 後必須同步 roadmap `.md` 與 `.html` |

## 當前 repo 狀態提醒

執行前先確認：

```
!`git status --short --branch`
!`git rev-parse origin/main`
!`gh pr list --state open --limit 5 --json number,title,headRefName,state`
```

讀 [docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md](docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md) 確認下一個 active change id。

## 失敗回滾

任何 Phase 失敗：
- Phase A–C 失敗 → 直接停止，分支可保留
- Phase D 失敗（push 後 review 不過） → 用 GitNexus debug loop 修正，回到 Phase D
- Phase E merge 後出問題 → `gh pr revert <pr-number>` 開 revert PR，不改寫 main
- Phase F archive PR 失敗 → 只關閉 archive PR，implementation commit 已保留
