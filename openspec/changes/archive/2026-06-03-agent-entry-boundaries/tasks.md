# Tasks — agent-entry-boundaries

## 1. Repo positioning and agent boundary

- [x] 1.1 查證設計站 A1-A10 與「06 操作介面總覽」定位。
- [x] 1.2 更新 root `AGENTS.md` / `CLAUDE.md`，加入產品定位與 frontend-operable done。
- [x] 1.3 新增 lazy-loaded product operability / script contract doc。
- [x] 1.4 更新 subfolder agent files，使職責符合 folder 內涵。

## 2. Frontend operability contract

- [x] 2.1 定義 user-facing feature 不接受 backend/API-only done。
- [x] 2.2 定義最終回報必須包含 frontend URL、button、fixture、visible result、E2E command、evidence path。
- [x] 2.3 更新 PR workflow / verification docs。
- [x] 2.4 新增 PR template 的 Frontend Verification table。

## 3. Script contract

- [x] 3.1 新增 `scripts/SCRIPT_CONTRACT.md`。
- [x] 3.2 新增 `scripts/script-registry.json`，登記現有 root scripts 與 role。
- [x] 3.3 更新 `scripts/AGENTS.md` / `scripts/CLAUDE.md`。
- [x] 3.4 新增 PR template 的 Deploy Path Verification table。

## 4. Validation

- [x] 4.1 `git diff --check origin/main..HEAD` 通過。
- [x] 4.2 `python -m json.tool scripts\script-registry.json` 通過。
- [x] 4.3 `gitnexus detect-changes --repo AI-BIM-governance --scope compare --base-ref origin/main` 回 `No changes detected`。
- [x] 4.4 PR Review Agent required OpenSpec evidence：本 change 補齊 `openspec/changes/agent-entry-boundaries`。
