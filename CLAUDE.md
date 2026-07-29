# CLAUDE.md

## 0. 文件目的

本檔是 `AGENTS.md` 的 Claude 鏡像入口。`AI-BIM-governance/` 的 repo 邊界、agent 行為、GitHub workflow、GitNexus 規範、B 方案閉環全部以 [`AGENTS.md`](AGENTS.md) 為 source of truth。

若本檔、generated wiki、generated skills 或任何歷史文件與 `AGENTS.md` 衝突，採用 `AGENTS.md`。

## 1. Claude 行為對齊

日常任務預設使用 Lane F 或 Lane B。不得因任務非平凡、文字含「完成」、或 touched path 位於 code/tests 就自動呼叫 Superpowers；只有使用者明確要求完整 Superpowers / `spec-to-done`，或明確符合 Lane S 觸發句型時，才啟動完整 lifecycle。

| Lane | Claude routing |
|---|---|
| F | single coordinator；無 Superpowers/spec/plan/subagent；targeted tests；不自動 ship |
| B | single coordinator + inline checklist；必要時一個 debugger，完成後最多一個 read-only reviewer；禁止 parallel writers |
| G | dedicated branch/worktree + concise plan；可按需使用單一 planning/verification skill，但不得自動串起完整 Superpowers lifecycle |
| S | 明確 opt-in 的完整 Superpowers / spec-to-done P0–P7 |

Lane G/S 不得弱化 secrets、repo boundaries、GitNexus HIGH/CRITICAL、frontend/browser evidence、真實 IFC、Kit/WebRTC 或 deploy ownership gates。Superpowers repo-local skill inventory 以 `agent-skills-manifest.json` 為 machine truth；project plugin 的實際啟停則以 `.claude/settings.json` 與 `claude plugin list` 為準。

`AGENTS.md` 的 Superpowers invocation policy 同樣適用 Claude：重流程 skill 為 explicit-only，單一 skill 不得自動串接下一階段。

## 2. Sub-files（lazy-load，與 AGENTS.md 同一組）
| workspace / boundary | `docs/agents/repo-boundary-detail.md` |
| service boundaries | `docs/agents/repo-boundaries-per-service.md` |
| data flow / ownership | `docs/agents/repo-data-flow-and-ownership.md` |
| product / frontend / deploy contract | `docs/agents/product-operability-and-script-contract.md` |
| PR / Actions workflow | `docs/agents/github-workflow.md` |
| GitNexus stale / unavailable gate | `docs/agents/gitnexus-usage.md` |
| sub-repo verification | `docs/agents/sub-repo-verify-commands.md` |
| advanced reasoning overlay | `docs/agents/advanced-agent-reasoning-contract.md` |
| Superpowers invocation / no-auto-chain / subagent budget | `docs/agents/superpowers-invocation-policy.md` |
| archive / retired services | `docs/agents/history-and-archive.md` |
| 查需求入口、服務邊界、route IA、API 契約、時序、資料模型、實作分期、AI Coding 交付守則 | `docs/plans/docs-plans-README.md`（入口）→ `AI-BIM 前後端設計文件.dc.html` §01–§08 |
| 需要依任務種類／難度選擇 Codex workflow、subagents、模型 lane，或使用 `use agents` / `subagents` / `swarm` 開發 `docs/plans` 需求 | `docs/agents/codex-loop-workflows.md` |
| 多終端機／多 CLI 並行 session 看板（互相感知） | `docs/agents/parallel-session-board.md` |
| domain vocabulary、GitHub issue workflow、triage labels | `docs/agents/domain.md`、`docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |

## 4. GitNexus 入口

完整 CLI-only 政策（Grok / Claude / Codex）以 [`AGENTS.md`](AGENTS.md) §4 為準：**不啟動** `gitnexus mcp`，圖譜查詢一律用 shell CLI。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence (CLI-only)

This project is indexed by GitNexus as **AI-BIM-governance**. **Do not use GitNexus MCP tools or `gitnexus://` resources.** Query the graph via shell CLI (`gitnexus` or `node .gitnexus/run.cjs`).

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus impact SymbolName -d upstream -r AI-BIM-governance` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run detect-changes before committing** to verify your changes only affect expected symbols and execution flows. For regression review: `gitnexus detect-changes --scope compare --base-ref main`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus query "concept" -r AI-BIM-governance` to find execution flows instead of grepping.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus context SymbolName -r AI-BIM-governance`.
- Prefer CLI over MCP even if an editor still has a disabled gitnexus MCP entry.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus impact` on it (Lane B/G/S as scoped in AGENTS.md).
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with blind find-and-replace when call-graph impact is required — use impact/context CLI first, then coordinated edits.
- NEVER commit changes without running `gitnexus detect-changes` when Lane policy requires it.
- NEVER start `gitnexus mcp` or re-add gitnexus MCP solely to satisfy these rules.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools / schema reference (map MCP names → CLI) | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in this repo (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
