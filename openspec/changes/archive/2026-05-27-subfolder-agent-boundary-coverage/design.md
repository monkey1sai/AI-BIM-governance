# Design

## Overview

本 change 把 repo-local agent boundary doc 從目前的 4 個位置（根目錄 + 3 sub-repo）擴展到 10 個位置（再加 6 個 sub-folder），並對既有 3 個 sub-repo 的 `CLAUDE.md` 去重 GitNexus inline block。設計核心是**繼承既有七段 schema、用 lazy-load 而不 inline、保留 GitNexus marker 兼容覆寫機制**。

## Scope of Change

新增（12 個檔）：

| Path | 角色定位 | Verify 入口 |
|---|---|---|
| `scripts/AGENTS.md` + `scripts/CLAUDE.md` | Workspace 驗證 / smoke / deploy / preflight 入口集合 | `pwsh scripts/verify-all.ps1 -TsOnly` |
| `tests/AGENTS.md` + `tests/CLAUDE.md` | Root contracts 與 test-only fakes（B 方案閉環最後 gate） | `.venv\Scripts\python -m pytest tests -p no:cacheprovider` |
| `docs/AGENTS.md` + `docs/CLAUDE.md` | 文件總入口（agents / contracts / wiki / runbooks / superpowers） | markdown 語意檢查 + link 存在 |
| `apps/kit-manager-web/AGENTS.md` + `apps/kit-manager-web/CLAUDE.md` | 獨立 Vite 前端 — Kit Manager UI | `cd apps/kit-manager-web && npm run build` |
| `infra/AGENTS.md` + `infra/CLAUDE.md` | Docker compose 對應的 Dockerfile / 部署資產 | `docker compose -f compose.host-kit.yml config` |
| `openspec/AGENTS.md` + `openspec/CLAUDE.md` | OpenSpec artifacts 自治（含 archive 排除） | `npx openspec validate --all --strict` |

修改（1 個 tracked 檔）：

- `bim-review-coordinator/CLAUDE.md`（54 行，無 GitNexus marker，無 sub-repo 級 `.gitignore` 排除） — 修正過期的根目錄章節指標（`§1.A §10 §11` → §1 + `docs/agents/repo-boundary-detail.md`）、加 sibling `AGENTS.md` 與根目錄 `CLAUDE.md` 的 lazy-load pointer；既有 boundary rules 全保留。

範圍外（兩個檔）：

- `bim-streaming-server/CLAUDE.md` —— 該 sub-repo 自身 `.gitignore` line 64 `/CLAUDE.md` 排除，git untracked，local-only convenience（含 `gitnexus setup` 寫入的 inline block）。本 change 不約束。
- `web-viewer-sample/CLAUDE.md` —— 該 sub-repo 自身 `.gitignore` line 32 `/CLAUDE.md` 排除，同上。本 change 不約束。

## Seven-Segment Schema（每份 sub-folder AGENTS.md 必含）

```
# <folder> Agent Rules

本檔是 `<folder>/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role            (一段話，定位這個 folder 在 workspace 的角色)
## Owns            (條列 — 這個 folder 擁有的責任 / 產物 / 權威)
## Does Not Own    (條列 — 明確排除的責任，避免越界)
## Required Boundaries  (MUST / MUST NOT — hard rules)
## Before Editing  (先讀什麼、檢查什麼)
## Verify          (最小驗證指令 — 一條 command)
## Done Criteria   (回報必含項：changed files / validation / risks)
```

每份 ≤ 100 行；目標 ≤ 80 行；MUST NOT inline 範例 code；MUST NOT 重複根目錄已有的 GitNexus / OpenSpec / B 方案規範，改用 lazy-load 指標。

## CLAUDE.md Mirror Pattern（每份新 sub-folder CLAUDE.md）

```
# <folder> — Claude Mirror Entry

本檔是 `<folder>/AGENTS.md` 的 Claude 鏡像入口。完整規則以 sibling `AGENTS.md` 為準。

衝突時依根目錄 `CLAUDE.md` §1 優先序解析：
使用者最新明確指令 > 根目錄 AGENTS.md / repo-local boundary > 根目錄 CLAUDE.md > OpenSpec artifacts > installed skills

## Verify 入口

<one-line command from sibling AGENTS.md>
```

≤ 30 行；不複製 boundary rules。

## GitNexus Marker Handling（升級 3 個 sub-repo CLAUDE.md）

`gitnexus setup` 命令會覆寫 `<!-- gitnexus:start --> ... <!-- gitnexus:end -->` marker 範圍內的內容。為避免本 change 改動的 lazy-load pointer 被下次 `gitnexus setup` 覆蓋：

**選項 A（採用）** — 保留 marker、改寫 marker 內內容為 short pointer：

```markdown
<!-- gitnexus:start -->
# GitNexus — Code Intelligence

> 完整規範見根目錄 `AGENTS.md` §4 與 `docs/agents/gitnexus-usage.md`。
> 此區塊保留以兼容 `gitnexus setup`；該 CLI 若覆寫，會以最新 block 內容為準。
<!-- gitnexus:end -->

## Local Boundary Rules
...（保留 marker 外原內容）
```

實作後 SHALL 跑一次 `npx gitnexus setup` dry test（若無 dry-run 旗標則手動 stash 後跑），確認覆寫行為與設計一致；不一致則改用選項 B。

**選項 B（備案）** — 把 boundary rules 整段移到檔案最前面，gitnexus marker 推到檔尾；若 setup 覆寫整段則 boundary rules 不受影響。

`bim-review-coordinator/CLAUDE.md` 沒有 marker（純手寫），僅加 lazy-load 頭部，不需處理 marker。

## OpenSpec Artifact Layout

```
openspec/changes/subfolder-agent-boundary-coverage/
├── proposal.md
├── design.md (本檔)
├── tasks.md
└── specs/
    └── subfolder-agent-boundary-coverage/
        └── spec.md      (capability delta — 整份 ADDED Requirements)
```

archive 後 `openspec/specs/subfolder-agent-boundary-coverage/spec.md` 將出現完整 spec。

## Risk and Mitigation

| Risk | Likelihood | Mitigation |
|---|---|---|
| `gitnexus setup` 覆寫 lazy-load pointer | Mid | 採用選項 A 並跑 dry test；不一致則切到選項 B |
| `openspec validate` 誤掃 `openspec/AGENTS.md` | Low | 已確認 CLI scope 限 `changes/` 與 `specs/` 子目錄 |
| 新規範回溯約束 archive 內 30 個歷史 change | Low | `openspec/AGENTS.md` "Does Not Own" 明寫排除 |
| 行數預算被未來 PR 突破 | Mid | spec 加 Requirement "Sub-folder AGENTS.md SHALL ≤ 100 行"，依 `agent-doc-context-budget` 模式由 PR review 把關 |
| 跨工作區 GitNexus index 看不到 worktree staged change | Mid | 已知問題（memory `opsx-worktree-closeout-gotchas`），改用 `git diff --stat` + `git diff --cached --check` fallback |

## Validation Strategy

- L1 schema: `openspec validate subfolder-agent-boundary-coverage --strict`
- L2 行數預算: 對 9 個 sub-folder/sub-repo doc 跑 `wc -l`，確認 ≤ 100（AGENTS.md）/ ≤ 30（新 CLAUDE.md mirror）。
- L3 marker 完整性: `grep -c '<!-- gitnexus:start -->\|<!-- gitnexus:end -->'` 對 3 個 sub-repo CLAUDE.md 確認 marker 配對。
- L4 root contracts 未受影響: `.venv\Scripts\python -m pytest tests -p no:cacheprovider`（doc-only change，預期 pass）。
- L5 GitNexus scope check: `git diff --stat origin/main..HEAD` 確認只動到 doc 檔。
