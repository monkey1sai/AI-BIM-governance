---
name: apply-and-verify
description: OpenSpec change 的 apply 階段：實作程式碼、同步 artifacts、跑四層驗證、commit、push、開 implementation PR。當 explore 已完成、要開始實作、要進入 verify-and-commit 階段時使用。
allowed-tools: Bash(git*) Bash(gh pr create*) Bash(openspec*) Bash(pytest*) Bash(npm*) Bash(gitnexus detect-changes*) Read Edit Write Grep Glob
---

# Apply and Verify

依 [CLAUDE.md](CLAUDE.md) 驗證順序規範：type check → lint → affected unit tests → integration / E2E only when needed。

## 觸發前提

- `openspec/changes/<change-id>/` 已有完整 proposal/design/tasks/spec-delta
- `openspec validate <change-id> --strict` 已綠燈
- 已跑過 `gitnexus-blast-radius pre-change`，risk_level 非 CRITICAL
- 已在 `codex/openspec/<change-id>` branch

## 執行步驟

### Step 1：依 tasks.md 實作程式碼

讀 `openspec/changes/<change-id>/tasks.md`，逐個 task 實作。

**強制邊界**：依 [AGENTS.md](AGENTS.md) §3 repo 邊界，每個 task 只能在事先宣告的 bounded service 內：
- `_bim-control` = metadata authority
- `_worker` = artifact + conversion facade
- `bim-review-coordinator` = session / collaboration control plane
- `bim-streaming-server` = Kit runtime
- `web-viewer-sample` = browser client

跨邊界改動 → 停止，回 Phase B（OpenSpec explore）重新切 scope。

### Step 2：必要的聯動修改

PR #31 / PR #33 已示範的最小必要檔案集合：

```
openspec/changes/<change-id>/                # 規格
  proposal.md / design.md / tasks.md
  specs/<capability>.delta.md
<bounded-service>/...                        # 程式碼
<bounded-service>/tests/...                  # focused tests
docs/verification/<date>-<change-id>.md     # verification evidence
```

必要時：
- `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` + 同名 HTML（若 active change 升級或 phase status 變動）

### Step 3：四層驗證

#### Layer 1：OpenSpec strict validate

```
!`openspec validate <change-id> --strict`
```

不過 → 修 spec/delta，回 Step 2。

#### Layer 2：focused tests

依 bounded service 跑：

```
# _worker
!`cd _worker && python -m pytest tests/ -x`

# _bim-control
!`cd _bim-control && python -m pytest tests/ -x`

# bim-review-coordinator
!`cd bim-review-coordinator && python -m pytest tests/ -x`

# web-viewer-sample
!`cd web-viewer-sample && npm test`
```

**重要**：必須在各自服務目錄執行（[CLAUDE.md](CLAUDE.md) 規範：避免多個 FastAPI 服務共用 `app` package name 時污染 import cache）。

#### Layer 3：diff 衛生檢查

```
!`git diff --check`
```

阻擋 whitespace / formatting 問題。

#### Layer 4：GitNexus scope drift 驗證

```
!`gitnexus detect-changes --scope staged`
```

呼叫 `gitnexus-blast-radius post-change` skill，比對 `affected_symbols` 是否 ⊆ tasks.md 預期 scope。

### Step 4：Commit

只有四層驗證全綠才 commit。

Commit message 用 Conventional Commits（PR #31/#33/#35 已成熟格式）：

```
<type>(<bounded-service>): <change-id> - <一句話摘要>

<可選的多行 body 說明>
```

`<type>` 範例：
- `feat`：新功能
- `fix`：修 bug
- `docs`：docs / OpenSpec artifacts
- `refactor`：重構（行為不變）
- `test`：只動 tests

### Step 5：Push 與開 PR

```
!`git push -u origin codex/openspec/<change-id>`
```

```
!`gh pr create \
  --base main \
  --head codex/openspec/<change-id> \
  --title "<type>(<bounded-service>): <change-id> - <摘要>" \
  --body-file <generated PR body>`
```

PR body 固定使用：

```markdown
## 變更摘要
<為什麼做 + 一句話結果>

## 修改原因
<roadmap / spec ref>

## 主要變更
- <service>: <檔案/symbol>: <做了什麼>
- ...

## 驗證方式
- [x] `openspec validate <change-id> --strict`
- [x] focused tests: `<command>` ✓
- [x] `git diff --check` ✓
- [x] `gitnexus detect-changes --scope staged` — affected scope: <list>
- [ ] runtime smoke evidence: <link or blocked reason>

## 風險與影響
- risk_level: <LOW|MEDIUM|HIGH|CRITICAL>
- affected processes: <list>
- mitigation: <如何補強>

## 回滾方式
若 merge 後出問題：`gh pr revert <pr-number>` → 開 revert PR。

## 後續建議
- <next change id 或 follow-up>
```

### Step 6：輸出 apply-and-verify report

```yaml
change_id: <id>
implementation_pr: <pr-number>
branch: codex/openspec/<change-id>
validation:
  openspec_strict: passed
  focused_tests:
    - service: <name>
      result: passed
  git_diff_check: passed
  gitnexus_detect_changes:
    affected_scope: [<list>]
    drift: []
commit_sha: <sha>
```

## 安全條款

- 四層驗證任一失敗 → 不 commit，回到對應 Step
- 不跑 `git add -A`，逐 file 確認
- 不在 commit message 寫「fix everything」這種模糊摘要
- 不在 implementation PR 內偷塞 archive 動作

## 參考

- PR #33（fix(worker): canonical batch timeout 診斷）—— 完整四層驗證範例
- PR #29（feat(worker): lineage API）—— focused tests + spec delta 範例
- [AGENTS.md](AGENTS.md) §驗證順序
