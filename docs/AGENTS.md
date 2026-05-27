# docs/ Agent Rules

本檔是 `docs/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`docs/` 是 **workspace 文件總入口**。它收 agent boundary lazy-load sub-files、跨 service contracts、Graphify wiki、operational runbooks、superpowers 等 agent-facing 與人 facing 文件；它不是程式碼或 contract 的權威源 —— 真正權威在程式碼與 OpenSpec spec。

## Owns

- `docs/agents/` — 根目錄 AGENTS.md / CLAUDE.md 的 lazy-load sub-files
- `docs/contracts/` — 跨 sub-repo / 對外平台 contract 描述（與 `tests/contracts/` 對應）
- `docs/wiki/` — Graphify / GitNexus generated wiki（curated corpus）
- `docs/runbooks/` — operational runbook
- `docs/architecture/` — 架構 snapshot / 決策記錄
- `docs/superpowers/` — superpowers skill specs / 設計 doc
- `docs/agent-tooling/` — agent tooling 相關設定 / SOP
- `docs/git/` / `docs/verification/` / `docs/evidence/` / `docs/demo/` / `docs/plans/` / `docs/postman/`
- `docs/PROJECT_*.md`、`docs/PR_REVIEW_AGENT.md`、`docs/gitnexus-validation.md` 等頂層文件
- `docs/current_task.md` — session-scoped working note
- `docs/graphify-corpus/` — Graphify curated corpus 配置（規則見 memory `graphify-curated-corpus-pattern.md`）

## Does Not Own

- 程式碼行為權威（屬於 sub-repo source）
- contract 機械驗證（屬於 `tests/contracts/`）
- OpenSpec spec 權威（屬於 `openspec/specs/<capability>/`）
- 自動生成的 GitNexus wiki dump（屬於 `docs/wiki/gitnexus/`；不要 inline 進 curated corpus）

## Required Boundaries

- MUST 標明文件性質：agent boundary / contract / wiki / runbook / spec design / working note。
- MUST 對齊 source of truth 順序：程式碼 > contracts > AGENTS 邊界 > wiki（規則見根目錄 `AGENTS.md` §3）。
- MUST NOT 把 `docs/` 內任何文件當成 product / API 行為的權威 —— wiki 與實作不一致時以實作為準，並補更新 wiki。
- MUST NOT 把 GitNexus 自動生成的 dump 混進 `docs/graphify-corpus/sources.txt`（規則見 memory `graphify-curated-corpus-pattern.md`）。

## Before Editing

- 先讀目標子目錄的 README 或既有檔案。
- 改 `docs/agents/*.md` MUST 確認 sub-file index 已在根目錄 `AGENTS.md` §2 與 `CLAUDE.md` §2 同步（見 spec `agent-doc-context-budget` Requirement 「Root entrypoint files SHALL maintain a complete sub-file index」）。
- 改 contract 描述 MUST 同步檢查 `tests/contracts/` 與相關 sub-repo public API。
- 改 Graphify curated corpus 配置 MUST 走 `docs/graphify-corpus/sources.txt` + `build_graph.py`；輸出落地 `docs/wiki/graphify/`，不要 `graphify .`。

## Verify

```powershell
# 連結與 markdown 語意（無 hard tool，PR review 把關）
git diff --stat origin/main..HEAD -- docs/
```

無自動化 link checker；PR 描述列出新增 / 修改的 doc path 與「同步來源」即視為 verify pass。

## Done Criteria

- 改動沒有把 `docs/` 變成行為權威。
- agent boundary sub-files 增刪後，根目錄兩份主檔 index 同步。
- contract 描述改動後，PR 描述列出對應 `tests/contracts/` 是否同步。
- 最終回覆列出 changed files、validation、known risks。
