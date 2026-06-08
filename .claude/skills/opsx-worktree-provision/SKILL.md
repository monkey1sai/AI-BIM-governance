---
name: opsx-worktree-provision
description: OpenSpec apply 前置——把 `codex/openspec/<change-id>` 分支放進 `<repo>/.worktrees/<change-id>/` 並回傳 manifest。當 `change-id-resolve` 已給出 change-id、要進入 `apply-and-verify` 之前使用。
allowed-tools: Bash(git worktree*) Bash(git fetch*) Bash(git rev-parse*) Bash(git status*) Bash(git branch*) Bash(git worktree list*) Bash(cp*) Bash(test*) Bash(mkdir*) Bash(stat*) Read Glob
---

# opsx-worktree-provision

依 [docs/agent-tooling/opsx-worktree-provision.md](../../../docs/agent-tooling/opsx-worktree-provision.md) 規範執行 worktree provisioning。**本文件只列 skill 互動規則，完整設計留底在上述 doc。**

## 觸發前提

- 由 `closed-loop-orchestrator` Phase A 或 `/opsx:apply` Step 0 呼叫
- 上游已執行 `change-id-resolve`，輸入 `{ change_id, branch_plan }` 可用
- 當前 cwd = main worktree（top-level）

## 輸入

```yaml
change_id: <required>
branch_plan: new | continue-existing   # 來自 change-id-resolve
```

## 七步流程

### Step 1：cwd 驗證

```
git rev-parse --show-toplevel
git rev-parse --git-common-dir
```

若 cwd 不是 main worktree（top-level path 與 git-common-dir 不對應）→ STOP `cwd-not-main`。

### Step 2：同步 origin

```
git fetch origin --prune
```

### Step 3：解析目標

```yaml
repo_root: <git rev-parse --show-toplevel 結果>
target_path: <repo_root>/.worktrees/<change_id>
branch: codex/openspec/<change_id>
```

### Step 4：衝突偵測（任一觸發即 STOP）

| Gate | 偵測 | 失敗 reason |
|---|---|---|
| main-dirty | `git status --porcelain` 非空 | `main-dirty` |
| branch-bound-elsewhere | `git worktree list --porcelain` 顯示 branch 在另一 path | `branch-bound-elsewhere` |
| worktree-dirty | target_path 存在且 `git -C <target_path> status --porcelain` 非空 | `worktree-dirty` |

### Step 5：建立或重用

```
git rev-parse --verify --quiet refs/heads/<branch>              # local_exists
git rev-parse --verify --quiet refs/remotes/origin/<branch>     # remote_exists
```

| target_path 存在? | local_exists | remote_exists | 動作 |
|---|---|---|---|
| ✓ | * | * | 重用，`created_new = false` |
| ✗ | ✓ | * | `git worktree add <target_path> <branch>` |
| ✗ | ✗ | ✓ | `git worktree add <target_path> -b <branch> origin/<branch>` |
| ✗ | ✗ | ✗ | `git worktree add <target_path> -b <branch> main` |

`base_ref` 對應記在 manifest。

### Step 6：env copy

掃描清單：

```
.env
bim-review-coordinator/.env
bim-streaming-server/.env
web-viewer-sample/.env
```

B 方案下，`_bim-control` / `_worker` / `_conversion-service` / `_s3_storage`
已自 product runtime 退役；worktree provisioning 不複製這些 retired service 的
`.env`，避免把 historical/test-double context 誤當現行 runtime。

對每個來源（main worktree）：

- 來源不存在 → 跳過。
- 目標已存在於 worktree → 加進 `skipped`，**不覆蓋**。
- 否則 `cp "<repo_root>/<path>" "<target_path>/<path>"`，加進 `copied`。

**絕不**：
- echo 任何 `.env` 內容到 log
- `git add` `.env`
- 建 symlink（用 hard copy）

### Step 7：輸出 manifest

把以下 YAML 印到工作流程輸出，供 `apply-and-verify` 與 `closed-loop-orchestrator` 後續 Phase 讀取：

```yaml
change_id: <id>
worktree_path: <abs>
branch: codex/openspec/<id>
base_ref: main | origin/codex/openspec/<id> | reused
created_new: <bool>
cwd_hint: <abs>
env_copied:
  copied: [<list>]
  skipped: [<list>]
venv_strategy: per-service-self-bootstrap
warnings:
  - ".env 是 main 快照，main 後續變動不會同步"
  - "首次 apply 需在 worktree 內各服務自建 venv"
  - ".claude / .codex 不在 worktree 內 (預期)"
```

## 後續使用約定

下游 skill（如 `apply-and-verify`）必須遵守：

- 所有 git 動作用 `git -C "<cwd_hint>" ...` 或 `cd "<cwd_hint>" && ...`
- 各服務測試 `cd "<cwd_hint>/<service>" && <test cmd>`
- 不在 main worktree (`<repo_root>`) 內做任何 edit / commit
- gh 指令認 branch 不認 cwd，可在任何位置呼叫

## apply 結束後

不自動清。在工作流程結尾印 `cleanup_hint`：

```bash
git worktree remove "<worktree_path>"
git branch -d codex/openspec/<change_id>
```

由使用者人工執行。

## 安全條款

- 四個 Gate 任一觸發 → STOP，回報 reason，**不嘗試自動修復**
- 不修改 main worktree 內任何檔案（包括 `.gitignore`、tracked code）
- continue-existing 不自動 `pull --rebase`；由使用者決定
- 不偵測或清理 `.codex/worktrees/*` 殘留（屬於獨立 follow-up change）

## 參考

- [docs/agent-tooling/opsx-worktree-provision.md](../../../docs/agent-tooling/opsx-worktree-provision.md)：完整設計留底
- [AGENTS.md](../../../AGENTS.md)：repo 邊界與 source-of-truth 順序
- [CLAUDE.md](../../../CLAUDE.md) §Git 與本機 agent 產物：branch / PR 政策
- [.claude/skills/change-id-resolve/SKILL.md](../change-id-resolve/SKILL.md)：上游 skill
- [.claude/skills/apply-and-verify/SKILL.md](../apply-and-verify/SKILL.md)：下游 skill
