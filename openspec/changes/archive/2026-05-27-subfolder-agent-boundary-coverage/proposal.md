# subfolder-agent-boundary-coverage

## Summary

把 repo-local agent boundary 從目前只覆蓋根目錄與三個 sub-repo（`bim-review-coordinator/`、`bim-streaming-server/`、`web-viewer-sample/`），擴展到所有 agent 經常觸碰的頂層 sub-folder（`scripts/`、`tests/`、`docs/`、`apps/kit-manager-web/`、`infra/`、`openspec/`），並升級既有 3 個 sub-repo 的 `CLAUDE.md` 去掉與根目錄重複的 inline GitNexus block，全面對齊「七段 schema、行數預算、lazy-load 而不 inline」三條 hard rule。

## Problem

當 agent 進到 sub-folder 工作時，遇到三個既有問題：

1. **缺乏 sub-folder anchor**：6 個被 agent 經常觸碰的 sub-folder 沒有 repo-local `AGENTS.md`，agent 進去後沒有 Role / Owns / Does Not Own 的邊界錨點，必須回根目錄反查或自行猜邊界。
2. **雙頭資訊（部分）**：`bim-review-coordinator/CLAUDE.md` 的 lazy-load 指標仍指向已過期的根目錄 `AGENTS.md §1.A §10 §11` 章節（現已改 lazy-load 化）。`bim-streaming-server/CLAUDE.md`（142 行）與 `web-viewer-sample/CLAUDE.md`（149 行）的開頭 1–101 行雖是完整 inline GitNexus block，但這兩個檔已被各 sub-repo `.gitignore` 排除（local-only convenience），不在 git history 內，本 change 不約束。
3. **架構漂移**：`_worker` / `_bim-control` 已於 2026-05-18 退役（B 方案），新增的 `apps/kit-manager-web/`、`infra/`、`compose.host-kit.yml` 沒有對應的 boundary doc 收錄，agent 改這些檔時沒有 hard rule。

這違反根目錄 `AGENTS.md` 的「lazy-load 而不 inline」原則，也踩到 CLAUDE.md complete guide 的「Don't inline all examples」與「Never pruning old rules」反模式。

## Goals

- 為 6 個 sub-folder 各新增一份 `AGENTS.md`（七段 schema：Role / Owns / Does Not Own / Required Boundaries / Before Editing / Verify / Done Criteria）與 `CLAUDE.md`（≤ 30 行最小鏡像）。
- 升級 **1 個 tracked sub-repo `CLAUDE.md`**（`bim-review-coordinator/CLAUDE.md`）：修正過期的根目錄章節指標、加上 sibling `AGENTS.md` lazy-load pointer。另外兩個 sub-repo（`bim-streaming-server/`、`web-viewer-sample/`）的 `CLAUDE.md` 在各自 `.gitignore` 內（`/CLAUDE.md`），為 local-only convenience（含 `gitnexus setup` 寫入的 block），不在 git history、不在本 change 範圍。
- 所有新／改的 sub-folder `AGENTS.md` SHALL ≤ 100 行（目標 ≤ 80 行）；`CLAUDE.md` mirror SHALL ≤ 30 行。
- `openspec/AGENTS.md` 明寫排除 `openspec/changes/archive/`，避免新規範回溯約束 30 個已歸檔的 historical change。

## Non-Goals

- 不改動根目錄 `AGENTS.md` 與 `CLAUDE.md` 的七段架構與行數預算（已由 spec `agent-doc-context-budget` 規範，繼續適用）。
- 不新增、不修改 `docs/agents/*.md` 五份 sub-file 的內部內容（本 change 只新增引用）。
- 不引入新的 directory-scoped frontmatter loading 機制（圖片參考的 `.claude/rules/*.md` paths frontmatter 不導入）。
- 不改動 OpenSpec parser 必要標頭（`## MODIFIED Requirements` / `### Requirement:` / `#### Scenario:` 等）。
- 不回溯約束 `openspec/changes/archive/` 內 30 個已歸檔 change。
- 不修改 secrets / `.env` 實際值；不引入 production dependency。

## Assumptions

- `bim-streaming-server/CLAUDE.md` 與 `web-viewer-sample/CLAUDE.md` 在各自 sub-repo `.gitignore` 排除規則下為 local-only file（per-machine convenience），不參與 git history、不被 PR review 約束。`gitnexus setup` 寫入 GitNexus block 的影響限於 local file，不會進入 commit。
- `bim-review-coordinator/CLAUDE.md` 為 tracked file（無 sub-repo 級 `.gitignore` 排除），本 change 對其進行最小升級：更新過期章節指標、加 sibling `AGENTS.md` lazy-load pointer。
- `npx openspec validate` 與 `npx openspec archive` 的掃描範圍是 `openspec/changes/<id>/` 與 `openspec/specs/<id>/`，不掃 `openspec/AGENTS.md` 或 `openspec/CLAUDE.md`，因此在 `openspec/` 放 agent boundary 檔不會被誤判為 spec 或 change。
- archive 子目錄是 immutable historical state，`openspec list` 預設不列出，新規範不需修改 archive 內容。
- 既有 3 個 sub-repo 的 `AGENTS.md` 七段 schema 已穩定，本 change 不重寫它們。

## Success Criteria

- `openspec validate subfolder-agent-boundary-coverage --strict` 通過。
- 6 份新 `AGENTS.md` 與 6 份新 `CLAUDE.md` 落地於：`scripts/`、`tests/`、`docs/`、`apps/kit-manager-web/`、`infra/`、`openspec/`。
- 1 份 tracked sub-repo `CLAUDE.md`（`bim-review-coordinator/CLAUDE.md`）完成升級：更新過期章節指標、加 sibling `AGENTS.md` 與根目錄 lazy-load pointer。
- 另兩個 sub-repo（`bim-streaming-server/`、`web-viewer-sample/`）的 `CLAUDE.md` 在本 change 範圍外（local-only `.gitignore` 排除），spec 明寫此邊界。
- 每份新 sub-folder `AGENTS.md` `wc -l` ≤ 100；新 sub-folder `CLAUDE.md` `wc -l` ≤ 30。
- `openspec/AGENTS.md` 在 "Does Not Own" 與 "Required Boundaries" 明寫排除 `openspec/changes/archive/`。
- 根目錄 `AGENTS.md` §2 sub-files index 與 `CLAUDE.md` §2 index 不變（本 change 不動根目錄文件）。
- PR 描述含本 change 的 9 個檔案 diff 摘要與 `openspec validate --strict` 輸出。
