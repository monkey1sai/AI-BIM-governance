> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：查 CLI 對照表或三端 MCP 設定現況、開工前檢查 GitNexus/worktree health、index stale 需重建、LadybugDB crash 復原、查 re-index 授權邊界時。

# GitNexus Usage（stale 重建與復原）

## 規範本文在哪

GitNexus 規則本文（Always Do / Never Do / CLI 對照 / skill 表）以根目錄 `AGENTS.md` / `CLAUDE.md` 內 `<!-- gitnexus:start -->` … `<!-- gitnexus:end -->` 區塊與 **AGENTS.md §4 CLI-only 政策** 為準。該區塊可能被 `analyze` 覆寫；若覆寫回 MCP 用語，**仍以 AGENTS.md §4 CLI-only 為準**（本 workspace 不啟動 `gitnexus mcp`）。

Lane-aware 核心規則：F 不強制 impact；B 對 task/主要 entry symbol 跑一次 batch impact，且只在實際改到 code symbol/flow 時跑 detect_changes；G/S 對 shared/exported symbol 改前跑 impact、commit 前跑 detect_changes。HIGH 明確回報補強策略後可繼續；CRITICAL 需 reviewer/user sign-off。查詢一律用 shell：`gitnexus impact|context|query|detect-changes|…`（或 `node .gitnexus/run.cjs …`）。

## CLI 對照表（AGENTS.md §4 CLI-only 政策的細節）

| 目的 | CLI |
|------|-----|
| 索引狀態 / 是否 stale | `gitnexus status` 或 `node .gitnexus/run.cjs status` |
| 重索引（禁止注入 agent context） | `gitnexus analyze --index-only` 或 `node .gitnexus/run.cjs analyze --index-only` |
| 已索引 repo 列表 | `gitnexus list` |
| 概念 / 流程搜尋 | `gitnexus query "concept" -r AI-BIM-governance` |
| 符號 360° | `gitnexus context SymbolName -r AI-BIM-governance` |
| 改動前 blast radius | `gitnexus impact SymbolName -d upstream -r AI-BIM-governance` |
| 兩符號最短路徑 | `gitnexus trace From To -r AI-BIM-governance` |
| commit 前 diff 影響 | `gitnexus detect-changes --scope compare --base-ref main` |
| 結構檢查 | `gitnexus check` |
| 原始 Cypher | `gitnexus cypher "MATCH …"` |

index 本機共用（repo `.gitnexus/` + `~/.gitnexus/registry.json`），無需每 agent 長駐一支 MCP process。

### 三端設定現況

- **Grok**：原生不掛 gitnexus MCP；`[compat.claude] mcps` 若開啟也不得再依賴 Claude 側 gitnexus MCP entry。
- **Claude**：user MCP 不得含 `gitnexus` stdio server（hooks / skills 可保留）。
- **Codex**：`[mcp_servers.gitnexus] enabled = false`（entry 可留作日後 re-enable）。

要改回 MCP 必須由使用者明確要求；agent 不得自行 re-enable 或執行 `gitnexus setup` 把 MCP 寫回 editors。

## Read-only health report

從目前 worktree root 執行：

```powershell
node scripts/dev/report-gitnexus-worktree-health.mjs --format json
```

它只讀 Git、`git worktree list` 與 agent board，不讀或修改 repo 外 GitNexus registry/index，也不 fetch、reindex 或清 worktree。沒有 exact-path GitNexus observation 時，linked worktree 的 `current_checkout_trust` 必須是 `unknown`；不得借用另一個 checkout 的 index。exit code：`0=healthy`、`1=warning`、`2=unknown/unhealthy`。

已由當輪明確授權的 GitNexus collector 可將 bounded JSON object 以 `--gitnexus-observation <path>` 注入；格式須符合 `gitnexus-worktree-health-observation.schema.json` 的 `gitnexus` 欄位。完整離線 fixture/診斷則用 `--observation <path>`。兩種模式都只產生 report，不執行 maintenance。

## GitNexus unavailable gate

GitNexus 是 Lane B/G/S code-symbol impact / detect_changes 的權威 gate；不可因為工具慢或不方便就把 required 結果寫成 pass。只有以下情境可進 unavailable gate：

1. GitNexus **CLI** 明確 unavailable、index stale 且重建失敗、registry 找不到 repo、或 linked worktree staged diff 已知失真。（MCP 未啟用不算 unavailable——應改跑 CLI。）
2. 已從 repo root 跑 read-only health report；若當輪另有權限，可再跑既有 local runner 的 `status`。沒有 current-turn 明確授權時不得以 `analyze`、`npx` 安裝或 reindex 當成「最小修復」。
3. 本輪只用 raw source、tests、`git diff --name-only --cached` / `git diff` 當 advisory evidence；不得把這些包裝成 GitNexus passed。

Unavailable gate 的決策：

- Lane B code-symbol 修改：揭露 unavailable，改用 raw source/tests/diff，若影響擴大則升 Lane G 並停止。
- Lane G/S shared-flow 修改：停止並請使用者或 reviewer 提供 sign-off，除非使用者明確接受「GitNexus unavailable」風險。
- docs-only / comments-only / non-code governance 修改：可繼續，但最終回報必須列 `GitNexus unavailable / not applicable` 與原因。
- GitNexus 回傳 HIGH / CRITICAL 或實際執行失敗（不是 unavailable）：不得 downgrade；先回報再繼續。

## 本 repo 的 stale 處理

若 GitNexus index stale，但 re-index 需要匯出或重新分析私有 repo，需遵守當前工具權限與使用者授權；不可自動 export sensitive code。下列命令屬於**另案 maintenance**，只有 current-turn 明確授權 exact target、backup/rollback 與驗證方法後才可執行：

```powershell
node .gitnexus/run.cjs analyze --index-only   # 自動選 runner；無 run.cjs 時 npx gitnexus analyze --index-only（npm 11 crash → npm i -g gitnexus）
node .gitnexus/run.cjs status    # 確認結束 + meta.json 對齊；analyze banner 不算成功
```

已知坑：`detect_changes` 在 linked worktree 看不到 staged（fallback `git diff --name-only --cached` 並揭露）；LadybugDB crash 後的復原順序見 `~/.claude/projects/.../memory/gitnexus-ladybugdb-crash-recovery.md`（agent memory）。
