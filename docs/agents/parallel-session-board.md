# Parallel Session Board(多終端機/多 CLI 並行 session 看板)

多個 AI CLI(Claude Code、Codex、Grok)在同一 repo 各自開終端機並行開發時,彼此原生互不可見。本看板是跨 CLI 的「感知層」:每個 session 登錄自己在做什麼,動工前查看他人狀態。

看板**只提供感知,不提供隔離**。實體防撞仍依 `AGENTS.md` §0.1 Lane 規則:Lane G 用 dedicated branch/worktree、Lane B 禁止 parallel writers。看板把每個 session 的 branch/worktree/最近檔案攤開,讓踩線變得可見。

命名注意:本看板與產品領域的 viewer lease/heartbeat(`web-viewer-sample` / coordinator 的 WebRTC 租約)完全無關,勿混用概念。

## 看板位置

- 實體位置:主 checkout 的 `.agents/board/`(`.gitignore` 已忽略 `.agents/`,永不入版控)。
- 解析方式:`git rev-parse --path-format=absolute --git-common-dir` 的上層目錄 + `/.agents/board`。在任何 linked worktree 內執行都會解析回主 checkout,**所有 worktree 共用同一塊看板**。
- 測試/特殊情境可用環境變數 `AGENTS_BOARD_DIR` 覆寫。

## 通用契約(所有 CLI 一體適用)

1. **開工註冊**:session 開始時執行 `node scripts/dev/agents-board.mjs register --agent <claude|codex|grok> [--task "一句話任務"]`。指令會回印 `session=<id>`,同一 session 後續指令沿用該 id(或設 `AGENTS_BOARD_SESSION` 環境變數)。
2. **動工前查看板**:開始編輯檔案前執行 `node scripts/dev/agents-board.mjs status`,確認不與其他 active session 的 branch/檔案相撞;會撞就先協調(換 worktree/branch 或等待),遵循 Lane 規則。診斷器只需 snapshot 時必須加 `--no-prune`，避免讀取動作清除 retention 到期的 session。
3. **任務切換即更新**:`node scripts/dev/agents-board.mjs update --agent <cli> --session <id> --task "新任務"`。
4. **收工標記**:`node scripts/dev/agents-board.mjs done --agent <cli> --session <id>`。
5. 看板寫入失敗不得阻斷開發工作;它是 best-effort 感知層,不是 gate。

## 檔案格式

- `sessions/<agent>--<session>.json`:單一 session 狀態 — `agent`、`session`、`status`(`active`/`idle`/`ended`)、`task`、`cwd`、`branch`、`startedAt`、`updatedAt`、`recentFiles`(最近 5 個編輯檔,repo-relative)。
- `events.jsonl`:append-only 事件流(`register`/`task`/`edit`/`turn-complete`/`session-start`/`session-end`/`done`),超過 512KB 輪替成 `events.1.jsonl`。
- Stale/清理:`updatedAt` 超過 120 分鐘顯示 `(stale)`;`ended` 超過 24 小時或任何 session 超過 72 小時未更新,於 register/status 時自動刪除。

`status --json` 提供機器可讀輸出(sessions + recentEvents)。

## Claude Code 整合

repo `.claude/settings.json` 設定 `disableAllHooks: true` 且不分發 lifecycle command hooks，避免 branch-controlled checkout/session code execution。Claude Code 與其他 CLI 使用同一份明確契約：開工 `register --agent claude`、編輯前 `status`、任務切換 `update`、收工 `done`。看板是 best-effort，因此漏記只降低並行感知，不得被解讀成授權或安全 gate。

## Codex 整合

- 基本盤:Codex 自動讀本 repo `AGENTS.md`,依 §0.1「並行 session 看板」一節執行通用契約(register/status/update/done)。
- 加值自動化(選用,**global 檔由使用者自行套用**,agent 不代改):在 `~/.codex/config.toml` 加 `notify`,每個 turn 結束自動回寫看板(標記 `idle` + 記錄任務;非本 repo 的 turn 會被 script 靜默跳過):

```toml
notify = ["node", "C:\\Repos\\active\\iot\\AI-BIM-governance\\scripts\\dev\\agents-board.mjs", "codex-notify"]
```

- notify payload 欄位(cwd/session id)依 Codex 版本而異,handler 全部 best-effort;缺 cwd 時以 process cwd 判定是否本 repo。

## Grok 整合

- 基本盤:xAI Grok Build 與社群 grok-cli 都自動讀 `AGENTS.md`,同樣執行通用契約,`--agent grok`。
- 不依賴 Claude-compatible hooks；Grok 也明確使用 `register/status/update/done`，避免 checkout 內容自動執行。

## 驗證

```powershell
# 看板總覽(任一終端機/任一 CLI)
node scripts/dev/agents-board.mjs status

# 明確註冊後結束一個測試 session
node scripts/dev/agents-board.mjs register --agent claude --task "board smoke test"

# worktree 共用驗證:在 linked worktree 內跑 status,應指向主 checkout 的 .agents/board
```
