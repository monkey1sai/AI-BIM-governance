## Context

舊 SaaS roadmap 同時承擔「長線技術規劃」、「OpenSpec 候選編號」、「NVIDIA 採用決策」、「硬體配置」與「功能需求」等角色，後續又被 `documentation-source-of-truth` spec 固化為 source of truth。現在使用者明確指定功能需求改以設計規格與 prototype 為主，因此文件治理必須拆清楚：

- 產品功能需求與 UI 驗收語意：`docs/plans/ai-bim-governance-設計規格.md`
- 可點擊需求原型：`docs/plans/ai-bim-governance-prototype.html`
- 行為正確性：程式碼、contracts、`openspec/specs/`
- 開發流程：`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`
- Demo 編排：`docs/demo/fast-mvp-demo-recap.md`

## Design

1. **設計規格成為 repo-local product requirement source**
   - 在 `AGENTS.md` 與 `docs/agents/product-operability-and-script-contract.md` 明確列出新兩檔。
   - 在設計規格 metadata 說明它取代舊 roadmap 的需求權威角色。

2. **prototype HTML 作為 source artifact 例外追蹤**
   - 保留 `.gitignore` 對 generated `docs/plans/*.html` 的防線。
   - 只 unignore `docs/plans/ai-bim-governance-prototype.html`。
   - 更新 `documentation-source-of-truth` spec，使 `git ls-files docs/plans/*.html` 只允許該 prototype。

3. **雲端 / 落地端分離寫入治理規則**
   - 設計規格、AGENTS、product-operability doc 都明確指向外部設計站「01 系統架構」的 cloud-edge separation。
   - 不改既有 repo runtime 邊界：`bim-review-coordinator` 仍是對外 IFC-ready intake；`bim-streaming-server` 仍是 internal IFC→USDC + Kit runtime。

4. **舊 roadmap references 收斂**
   - README / workflow / demo runbook / non-archive docs 不再連到被刪除的 roadmap。
   - 歷史文件只保留 legacy 說明，不再把舊 roadmap 當現行入口。

5. **開發工具規範對齊 Claude Code**
   - `.codex/skills` 以 `.claude/skills` 作為本機 skill inventory 對齊來源，兩者維持 ignored，不提交 skill 本體。
   - OpenSpec / opsx closed-loop skills 已退役；新開發或調整走 Superpowers `writing-plans` / `subagent-driven-development` / `verification-before-completion`。
   - `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 與 fast MVP 計畫文件只描述 Superpowers + GitHub PR workflow；歷史 OpenSpec artifact 保留為歷史，不作為新工作入口。

## Risks

- `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 仍含大量 2026-05 roadmap-era 候選語言。此 change 只移除斷連與權威宣稱，不嘗試重寫整份歷史流程文件。
- OpenSpec CLI 在目前 worktree 以 `npx openspec validate docs-design-spec-source-of-truth --strict` 失敗為 `npm error could not determine executable to run`；需要在 CI 或可用 CLI 環境補跑 strict validation。

## Validation Strategy

- `rg` 確認非 archive 文件不再指向 deleted roadmap path。
- `rg` 確認現行 workflow 文件不再以 `/openspec new` / `/openspec apply` 作為新開發入口。
- `.codex/skills` vs `.claude/skills` top-level dirs / file count / retired skills 檢查。
- `git diff --check` 確認文件無 whitespace / conflict marker 問題。
- `git ls-files docs/plans/*.html` 預期只列 `docs/plans/ai-bim-governance-prototype.html`。
- `npx openspec validate docs-design-spec-source-of-truth --strict` 與 `npx openspec validate --all --strict` 在 CLI 可用環境補跑。
