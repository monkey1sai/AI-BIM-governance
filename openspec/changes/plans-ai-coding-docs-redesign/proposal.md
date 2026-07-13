## Why

`docs/plans/` 的六份舊正本以增補層與跨檔效力序演化，已形成重複現況宣告、斷鏈風險與 AI coding 讀取成本。使用者已核准以兩份 tracked prototype 為產品樣貌錨，將 plans 重整為 TRUTH／TARGET／PROCESS 三類，並要求既有凍結契約、路由、互動卡與誠實邊界零損。

現行 `documentation-source-of-truth` capability 仍 SHALL 要求已刪除的單一「設計規格」存在，且只允許一份 tracked prototype；若不先更新 formal contract，README、workflow 與新 plans 體系會互相矛盾。

## What Changes

- 以 `docs/plans/docs-plans-README.md` 作唯一入口：
  - `TRUTH.md` 只記 runtime 現況與 evidence；
  - `TARGET-contracts.md`／`TARGET-shell.md`／`TARGET-viewer.md` 只記目標契約；
  - `BACKLOG.md` 排序 gap／OPEN 決策；
  - `PROCESS.md` 定義 built DoD、evidence 與防腐 gate。
- 保留 `ai-bim-governance-prototype.html` 與 `ai-bim-geo-viewer-prototype.html` 兩份 tracked product prototype；其他 generated `docs/plans/*.html` 仍禁止提交。
- 修改 workflow v3、README、active OpenSpec deltas、agent workflow prompts、demo 與 SaaS keep docs 的 active pointers；archive-managed canonical specs 不在 implementation PR 直接改寫，merge 後由 OpenSpec archive closeout 落地；歷史 archive/evidence 不回寫，改由新 README 的救援表導讀。
- 刪除六份舊正本前，必須通過契約／路由／IX／AC 計數、active dead-reference、TARGET purity、行數與 tracked evidence gates。
- 本 change 只改 documentation/governance contract；不改四服務 route/API、runtime code、storage/session ownership 或 deployment boundary。

## Impact

- Owning folder：`docs/plans/`、`openspec/changes/plans-ai-coding-docs-redesign/`；canonical specs 由 merge 後 archive closeout 更新。
- Active consumers：`README.md`、`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`、`AGENTS.md`／`CLAUDE.md`、`docs/agents/`、`.claude/skills/`、`.claude/workflows/`、`.github/ISSUE_TEMPLATE/`、demo/SaaS docs 與相關 active OpenSpec deltas。
- API/data/event/storage/session/runtime boundary：全部不變。
- Validation：`npx openspec validate plans-ai-coding-docs-redesign --strict`、`npx openspec validate --all --strict`、dead-reference/count/purity/line-budget gates、workflow `node --check`、repo governance checks。
- Non-goals：不重寫 prototypes、不實作任何 A1–A10 runtime gap、不搬移歷史 archive/evidence、不修改 secrets 或 env values。
