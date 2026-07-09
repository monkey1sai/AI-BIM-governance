# docs/ Agent Rules

本檔是 `docs/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`docs/` 是 **workspace 文件總入口**。它收 agent boundary lazy-load sub-files、跨 service contracts、operational runbooks、superpowers specs/plans、verification evidence 等 agent-facing 與 human-facing 文件；它不是 runtime 行為權威源。現行行為以程式碼、可執行 tests / contracts 為準；`docs/plans/` 定義目標需求與驗收語意；歷史 OpenSpec / generated wiki 只在明確標示為現行時才可當 gate。

## Owns

- `docs/agents/` — 根目錄 AGENTS.md / CLAUDE.md 的 lazy-load sub-files
- `docs/contracts/` — 跨 sub-repo / 對外平台 contract 描述（與 `tests/contracts/` 對應）
- `docs/wiki/` — 若未來生成 GitNexus wiki，只作 generated artifact；目前 checkout 不存在，不得當入口引用
- `docs/runbooks/` — operational runbook
- `docs/architecture/` — 架構 snapshot / 決策記錄
- `docs/superpowers/` — superpowers skill specs / 設計 doc
- `docs/agent-tooling/` — agent tooling 相關設定 / SOP
- `docs/git/` / `docs/verification/` / `docs/evidence/` / `docs/demo/` / `docs/plans/` / `docs/postman/`
- `docs/PROJECT_*.md`、`docs/PR_REVIEW_AGENT.md`、`docs/gitnexus-validation.md` 等頂層文件
- `docs/current_task.md` — session-scoped working note

## Does Not Own

- 程式碼行為權威（屬於 sub-repo source）
- contract 機械驗證（屬於 `tests/contracts/`）
- active code/test 行為權威（屬於 sub-repo source 與 tests）
- generated GitNexus wiki dump（若存在，屬 generated artifact，不屬本檔 ownership）

## Required Boundaries

- MUST 標明文件性質：agent boundary / contract / wiki / runbook / spec design / working note。
- MUST 對齊根目錄 `AGENTS.md` §3 的兩條優先序：agent instruction priority 與 runtime/product behavior truth 不得混用。
- MUST NOT 把 `docs/` 內任何文件或舊 evidence 當成 runtime/API 已完成證據；docs 與實作不一致時以實作為準，並把差異標成 implementation gap 或 historical evidence。

## Before Editing

- 先讀目標子目錄的 README 或既有檔案。
- 改 `docs/agents/*.md` MUST 確認 sub-file index 已在根目錄 `AGENTS.md` §2 與 `CLAUDE.md` §2 同步（見 spec `agent-doc-context-budget` Requirement 「Root entrypoint files SHALL maintain a complete sub-file index」）。
- 改 contract 描述 MUST 同步檢查 `tests/contracts/` 與相關 sub-repo public API。

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
