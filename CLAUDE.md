# CLAUDE.md

## 0. 文件目的

本檔是 `AGENTS.md` 的 Claude 鏡像入口。`AI-BIM-governance/` 的 repo 邊界、agent 行為、GitHub workflow、GitNexus 規範、B 方案閉環全部以 [`AGENTS.md`](AGENTS.md) 為 source of truth。

若本檔、generated wiki、generated skills 或任何歷史文件與 `AGENTS.md` 衝突，採用 `AGENTS.md`。

## 1. Claude 行為對齊

優先序：

```txt
使用者最新明確指令
AGENTS.md / repo-local boundary rules
CLAUDE.md
installed skills / generated wiki / generated skills
```

工作守則（精簡）：

- 預設繁體中文；code / API / log / 錯誤訊息保留原語言。
- 編輯前先讀相關檔案與既有模式；不確定 repo 邊界時回到 `AGENTS.md` 與 `docs/agents/repo-boundary-detail.md`。
- 非平凡變更先列出假設、成功標準、最小改動面，再做最小可回復 diff。
- 非平凡 / 高風險任務先做 task tier 判斷、worker dispatch 或說明不派 worker 的理由，最終回覆區分 verified facts / inferences / unverified risks；完整規則見 `docs/agents/advanced-agent-reasoning-contract.md`。
- 不修改 secrets / private keys / `.env` 實際機密值；不新增 production dependency 不解釋。
- 非平凡功能用 superpowers `writing-plans` → `subagent-driven-development` → `verification-before-completion`；不在 `main` 上開發，走 branch → PR → Actions → merge。
- 需求效力序與 A1–A10 建成裁決依 `AGENTS.md` §0.1（docs-plans-README §1 > 互動實作規格 A.1.1 > 對齊矩陣 §4.4）；前端改動前必讀後端凍結契約（前端對齊DS手冊 §1）。user-facing feature 必須可從前端 route 操作並有 browser E2E evidence，backend-only done 不接受。
- deploy / runtime / demo 行為必須回到 `scripts/deploy.ps1` golden path；新增 root-level start / smoke / check script 預設視為邊界風險。
- 測試部署區重建口令固定執行 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`（禁 `-DryRun`；helper 詳規、排除清單與 blocking PID 授權見 `docs/agents/product-operability-and-script-contract.md` §6 與 `AGENTS.md` §0.1）。

開發管線（四套工具不平權，固定「主流程 + 輔助」；完整版見 `AGENTS.md` §0.1）：

```txt
設計/prototype → Superpowers 拆 plan → GitNexus impact → 實作 → gstack UI/E2E/screenshot 驗收 → GitNexus detect_changes → PR
```

- **Superpowers**＝plan / execution governance（主線）；**GitNexus**＝impact / detect_changes；**gstack**＝browser QA / screenshot / E2E（user-facing 驗收唯一證據）；**Matt Pocock skills**＝僅 issue / triage / domain-doc 輔助，不得當主線。
- 分析 code / 陌生模組探索預設先用 GitNexus `query` / `context`；codebase-memory 只能作為並列第二意見或 GitNexus UNKNOWN / crash / unavailable 時的 advisory fallback，不得取代 GitNexus-first discovery。
- 禁止：Matt Pocock 取代 Superpowers plan／Superpowers 宣告 UI 完成卻不跑 gstack／GitNexus 當產品設計依據／gstack 改 backend symbol 跳過 GitNexus impact。
- 誠實鐵律：前端要真能操作、不可只接 mock；無 backend 處 UI 須標 `DEMO DATA`／`NOT BUILT`／`not observed`。

完成任何工作前回報：

```txt
1. 改了哪些 tracked files
2. 執行了哪些最小驗證
3. 哪些測試沒跑以及原因
4. 已知風險或既有問題
```

## 2. Sub-files（lazy-load，與 AGENTS.md 同一組）

| 何時需要 | 讀這份 |
|---|---|
| 跨 sub-repo 決策、workspace 總覽、B 方案架構決策、最重要閉環 | `docs/agents/repo-boundary-detail.md` |
| 查個別 repo 角色、負責/不負責清單、禁止跨界規則 | `docs/agents/repo-boundaries-per-service.md` |
| 查資料類型歸屬、核心資料流、通訊方式、Source of Truth | `docs/agents/repo-data-flow-and-ownership.md` |
| 查 A1–A10、frontend operability、script/deploy contract | `docs/agents/product-operability-and-script-contract.md` |
| 開 PR / 處理 GitHub Actions / branch closeout | `docs/agents/github-workflow.md` |
| 修改 code symbol、跑 impact analysis、commit 前 detect_changes | `docs/agents/gitnexus-usage.md` |
| 跑 sub-repo 驗證（pytest / npm test / build / Cloud VM 啟動） | `docs/agents/sub-repo-verify-commands.md` |
| 非平凡 / 高風險任務分級、worker dispatch、evidence labels、reviewer perspectives | `docs/agents/advanced-agent-reasoning-contract.md` |
| 看舊 PR、了解退役服務與歷史 spec 脈絡 | `docs/agents/history-and-archive.md` |
| 查需求效力序、正典路由 A.1.1、A1–A10 建成裁決（§4.4）、後端凍結契約（§1） | `docs/plans/docs-plans-README.md`（跳板）→ 各 plans 檔 |
| 需要依任務種類／難度選擇 Codex workflow、subagents、模型 lane，或使用 `use agents` / `subagents` / `swarm` 開發 `docs/plans` 需求 | `docs/agents/codex-loop-workflows.md` |

行數預算：本檔 ≤ 130 行（目標 ≤ 100）；AGENTS.md ≤ 250 行（目標 ≤ 200）。預算規範見 spec `agent-doc-context-budget`。

## 3. 驗證入口（一句話）

完整 sub-repo 驗證指令見 `docs/agents/sub-repo-verify-commands.md`；root contracts：

```powershell
python -m pytest tests -p no:cacheprovider
```

（須走 `.venv\Scripts\python.exe`，否則 user-site packages 會撞 FastAPI/Starlette 版本。）

## 4. GitNexus 入口

修改 code symbol 前 MUST 跑 `impact`；commit 前 MUST 跑 `detect_changes`；HIGH / CRITICAL risk 先回報再繼續。規範本文以下方自動維護區塊為準；stale 重建與 crash 復原見 `docs/agents/gitnexus-usage.md`。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **AI-BIM-governance** (17817 symbols, 28581 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/AI-BIM-governance/context` | Codebase overview, check index freshness |
| `gitnexus://repo/AI-BIM-governance/clusters` | All functional areas |
| `gitnexus://repo/AI-BIM-governance/processes` | All execution flows |
| `gitnexus://repo/AI-BIM-governance/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
