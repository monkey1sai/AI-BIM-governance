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

Lane G/S 不得弱化 secrets、repo boundaries、GitNexus HIGH/CRITICAL、frontend/browser evidence、真實 IFC、Kit/WebRTC 或 deploy ownership gates。Superpowers project plugin 的實際啟停以 `.claude/settings.json` 與 `claude plugin list` 為 machine truth。

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

## 4. GitNexus 入口

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **AI-BIM-governance** (17817 symbols, 28581 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **Lane F:** impact is optional; use direct source search, targeted tests, and `git diff`.
- **Lane B:** run one task/entry-symbol impact; run `detect_changes()` only when code symbols or execution flows changed.
- **Lane G/S:** run impact before shared/exported symbol edits and `detect_changes({scope: "compare", base_ref: "main"})` before commit.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER use Lane F/B to bypass impact after scope expands into Lane G/S.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit Lane G/S code changes without running `detect_changes()` to check affected scope.

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
