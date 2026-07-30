# openspec/ Agent Rules

本檔是 `openspec/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`openspec/` 是 **spec-driven development artifact 倉庫**。它存放 active change proposals、design、tasks、spec deltas，以及 archive 後落地的完整 capability spec。本 folder 自治 —— 規範自己怎麼被修改，不放程式碼，不放 contract test。

OpenSpec 入口：`npx openspec`（list / validate / show / archive / new）。

## Owns

- `openspec/config.yaml` — OpenSpec runtime 設定（schema / context / rules）
- `openspec/lifecycle-ledger.json` — current + archive lifecycle/task/evidence machine truth；`docs/plans/NOW.md` 只投影 `scope: current`
- `openspec/changes/<active-id>/` — active change artifacts（proposal / design / tasks / specs delta）
- `openspec/specs/<capability>/spec.md` — archive 後的 capability spec（source of truth）

## Does Not Own

- **`openspec/changes/archive/`** — immutable historical state；本 spec 與七段 schema 不回溯約束 archive 內 30+ 個已歸檔 change
- 程式碼實作（屬於各 sub-repo）
- contract test（屬於 `tests/contracts/`）
- OpenSpec CLI 本身（external dependency）

## Required Boundaries

- MUST 把每個 OpenSpec change 隔離到 `codex/openspec/<change-id>` branch + `.worktrees/<change-id>/` worktree；不得在 `main` 上開發 OpenSpec change。
- MUST 在 active change 寫好後 `npx openspec validate <id> --strict` 通過再開 PR。
- MUST 在 PR merge 後跑 `npx openspec archive <change-id>` 落地 spec；archive 後 active change 目錄消失、`specs/<capability>/spec.md` 出現。
- MUST 將 deferred change 保留在 `openspec/changes/<change-id>/`，並在 `proposal.md` 頂部使用 canonical `Status: deferred <日期>` 標記、理由與重啟條件；deferred 不構成 active capability owner，也不得為了 WIP 計數移入 archive。`--skip-specs` 只會跳過 canonical spec 同步，**不是** deferred state。
- MUST 僅 archive 已完成的 change：所有 task checkbox 均已結案；若原工作由明確、非重疊且已接受的 successor 完整承接，須先把原 checkbox 改成已勾選的 terminal disposition 並記錄 successor，不得留下 unchecked task。delta specs 已同步 canonical specs，或已由 successor 明確 supersede。單純 warning、known gap、使用者確認繼續或 `--skip-specs` 均不得把 unfinished/deferred change 重新分類為 completed。
- MUST 先更新 `lifecycle-ledger.json` 再更新 NOW projection；不得由 unchecked checkbox 推論 active。`subject_commit` 表示 proposal/tasks/evidence 被觀察的 source snapshot，full verifier 會要求這些 source 自該 commit 起未改動。
- MUST 將既有歷史 archive 的 unchecked／unsupported checkbox 只記為 typed `archive_debt`（owner + review due）；這是 migration debt disclosure，不是完成證據，也不得用於新的 archive。
- MUST 用繁體中文撰寫 proposal / design / tasks / spec；保留 OpenSpec parser 必要標頭（`## ADDED Requirements` / `## MODIFIED Requirements` / `### Requirement:` / `#### Scenario:` 等）為原文。
- MUST NOT 修改 `openspec/changes/archive/` 內任何檔案；歷史 correction 需獨立 PR 並在 PR 描述標示。
- MUST NOT 把 `openspec/AGENTS.md` 或 `openspec/CLAUDE.md` 視為 spec 或 change —— `npx openspec validate` scope 限 `changes/` 與 `specs/` 子目錄。
- MUST NOT 平行開兩個改同一 capability 的 active change（NoSuccessorWhilePredecessorOpen gate）。

## Before Editing

- 先讀 `openspec/config.yaml` 與既有 change（範例：`fix-lan-runtime-params-spectator-capacity/`）。
- 新建 active change 前 `npx openspec list` 確認 no successor 衝突。
- 改 spec delta 前先讀對應 `openspec/specs/<capability>/spec.md`，確認用 `## ADDED` / `## MODIFIED` / `## REMOVED` 正確區分。
- 完整 OpenSpec / GitHub workflow 見根目錄 `docs/agents/github-workflow.md`。

## Verify

```powershell
npx openspec validate <change-id> --strict
npx openspec validate --all --strict
node scripts/tests/verify-openspec-machine-truth.mjs --repo-root . --ledger openspec/lifecycle-ledger.json --now docs/plans/NOW.md --github-state <repo-contained-raw-github-json> --openspec-list <repo-contained-openspec-list-json> --subject <observed-source-sha> --base <trusted-base-sha>
```

## Done Criteria

- 改動沒有越過 archive 邊界。
- deferred change 不在 archive；archive 內沒有未被完整 successor 承接的 in-scope 未完成工作。
- `openspec validate --strict` 通過；新 capability 至少含一條 Requirement + 至少一個 Scenario。
- PR 描述附 `openspec validate` 輸出。
- 最終回覆列出 changed files、validation、known risks。
