---
name: gitnexus-blast-radius
description: 改動前跑 GitNexus impact 與 analyze 算出 blast radius 與 risk_level；改動後跑 detect_changes 驗證 scope 是否超出預期。當要修改 function/class/method 之前、或 PR review 後 reviewer 提出 risk 需要 debug 時使用。Pre-change 與 post-change 兩種模式。
allowed-tools: Bash(gitnexus*) Bash(git diff*) Bash(git status*)
---

# GitNexus Blast Radius

依 [CLAUDE.md](CLAUDE.md) GitNexus Always Do 規範，本 skill 把 GitNexus 包成兩個明確 phase：改前的 blast radius、改後的 scope 驗證。

## 模式判定

從 `$ARGUMENTS` 第一個參數判定模式：
- `pre-change <symbols>` — 改動前 blast radius
- `post-change` — 改動後 scope 驗證

## Pre-change 流程

### Step 1：刷新 index

```
!`gitnexus analyze --embeddings --skills --skip-agents-md`
```

若工具警告 index stale → 重跑一次再進行下一步。`--skip-agents-md` 避免覆蓋 tracked AGENTS / CLAUDE 段落。

### Step 2：對目標 symbols 跑 impact

對使用者指定 / 從 `tasks.md` 解析出的每個 symbol：

```
!`gitnexus impact --target <symbol> --direction upstream`
```

蒐集：
- `direct_callers`
- `affected_processes`
- `risk_level`（LOW / MEDIUM / HIGH / CRITICAL）
- `unexpected_scope`

### Step 3：risk_level 判定

| risk_level | 動作 |
|---|---|
| LOW | 直接通過 |
| MEDIUM | 通過，PR body 標註 |
| HIGH | 警告使用者，PR body 必須說明補強策略（額外 tests / smoke） |
| CRITICAL | **阻擋**。要求拆 change 或取得 reviewer sign-off |

### Step 4：輸出 pre-change report

```yaml
mode: pre-change
analyzed_symbols:
  - name: <symbol>
    direct_callers: [<list>]
    affected_processes: [<list>]
    risk_level: <LOW|MEDIUM|HIGH|CRITICAL>
overall_risk: <max of above>
blockers: []
recommendations:
  - <action>
```

## Post-change 流程

### Step 1：偵測 staged scope

```
!`gitnexus detect-changes --scope staged`
```

蒐集：
- `affected_symbols`
- `affected_processes`
- `risk_level`
- `unexpected_scope`

### Step 2：對齊 OpenSpec tasks 預期 scope

讀 `openspec/changes/<change-id>/tasks.md`，比對：
- `tasks.md` 預期碰到的 symbols / files
- `detect-changes` 實際碰到的 symbols / files

若 `affected ⊄ expected` → scope drift，回報並建議：
1. 拆 scope（移除非預期改動）
2. 或補 OpenSpec task 涵蓋實際改動
3. 不能直接放行進 commit

### Step 3：Fallback 機制（含停損條件）

若 `gitnexus detect-changes` 失敗（resolver 對 worktree index 沒及時刷新）：

```
!`gitnexus analyze --embeddings --skills --skip-agents-md`
!`gitnexus detect-changes --scope staged`
```

仍失敗 → 用 `git diff --name-only` 作 fallback evidence：

```
!`git diff --name-only --cached`
```

在 PR body 明確標註「GitNexus detect-changes failed, using git diff as fallback」，**不能**把 fallback 當永久替代（這是 PR #35 曾真實出現的風險，要明文揭露）。

**停損條件（強制）**：

| 失敗次數 | 動作 |
|---|---|
| 第 1 次失敗 | 跑 `gitnexus analyze --embeddings --skills --skip-agents-md` 後重試 |
| 第 2 次失敗 | 改用 `git diff --name-only --cached` 作 fallback，但在 PR body 標記 ⚠️ |
| **第 3 次失敗（同一 session）** | **停止**：升為 issue（`gh issue create`），標題格式 `gitnexus: detect-changes repeatedly failing on <branch>`，body 附最近 3 次失敗指令與 stderr，並暫停該 change 的 commit / merge 流程，等修復或 reviewer 明確 sign-off「accept git-diff-only fallback for this PR」後再繼續 |

停損的理由：fallback 連續失敗代表 GitNexus index 或 resolver 已有更深層問題，繼續用 fallback 等於放棄改後 scope 驗證；提前升 issue 比累積 technical debt 安全。

### Step 4：輸出 post-change report

```yaml
mode: post-change
detect_changes:
  affected_symbols: [<list>]
  affected_processes: [<list>]
  risk_level: <LOW|MEDIUM|HIGH|CRITICAL>
scope_match:
  expected_files: [<from tasks.md>]
  actual_files: [<from detect-changes or git diff>]
  drift: []           # 應為空
fallback_used: false  # 若 true 必須在 PR body 揭露
verdict: <pass|drift|critical>
```

## Reviewer Comment → Debug Target 轉換

當 PR reviewer 提出風險評論：

1. 把 comment 文字摘要成 `debug_target`（例如：「callback retry 靜默丟棄」→ `bim-review-coordinator/src/services/callbackOutbox.ts` 的 `deliverPending`）
2. 對該 symbol 跑 `gitnexus impact --target <symbol>` 找實際 blast radius
3. 補 focused tests，再回 Phase D 重跑 verify

## 邊界與限制

- 此 skill **不**修改程式碼（只診斷）
- 不能跳過 CRITICAL 風險直接 commit
- Fallback 用 `git diff` 時必須在 PR body 揭露
- 不重複跑 analyze，除非工具明確報 stale

## 參考

- [CLAUDE.md](CLAUDE.md) GitNexus Always Do / Never Do
- [GitNexus Impact Analysis](https://www.mintlify.com/abhigyanpatwari/GitNexus/skills/impact-analysis)
- [GitNexus Guardrails](https://contextqmd.com/libraries/gitnexus/versions/1.4.10/pages/GUARDRAILS)
