## 1. Pre-flight 盤點

- [ ] 1.1 確認 `2026-05-22-fix-ifc-usdc-hoops-load-failure` archive 內 `acceptance.md` 對 evidence path 的全部引用點
- [ ] 1.2 確認 `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/` 對應的 archived change-id（若無對應 archive，本 change 不搬，先留原位）
- [ ] 1.3 確認 `docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md` 的內容已被 `docs/plans/fast-mvp-edge-bim-server-console-design-2026-05-25.md` 吸收（無資訊損失再刪）

## 2. 刪除 `docs/plans/*.html` 與 TEMP plan

- [ ] 2.1 `git rm docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`
- [ ] 2.2 `git rm docs/plans/AI-BIM-governance-next-burn-down-2026-05-19.drive.html`
- [ ] 2.3 `git rm docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md`
- [ ] 2.4 在 `.gitignore` 加 `docs/plans/*.html` 規則
- [ ] 2.5 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 開頭加 metadata 註記：「如需 HTML 檢視，本機跑 doc/規劃 skill 從本檔生成；HTML 不入 repo」

## 3. 搬移 archived change evidence 到 archive sibling

- [ ] 3.1 `git mv docs/evidence/fix-ifc-usdc-hoops-load-failure openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/evidence`
- [ ] 3.2 修正 `openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/acceptance.md` 內所有 `docs/evidence/fix-ifc-usdc-hoops-load-failure/` 引用 → `evidence/`（sibling relative）
- [ ] 3.3 grep 其他 archived change artifact 是否有 `docs/evidence/fix-ifc-usdc-hoops-load-failure/` 引用；若有，同步修正
- [ ] 3.4 若 §1.2 確認 `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/` 有對應 archive，同樣搬移；若無，留原位並在 PR 描述標註

## 4. Stub 化 `.cursor/` 與 `.windsurf/` 四套 opsx mirror

每個 stub 樣板：

```markdown
---
<原 frontmatter 保留>
---

> **Stub**: 內容已 dedupe 到 source-of-truth `.agent/<path>`，本檔僅保留 IDE entry point 命名。
>
> Source: [`.agent/...`](../../../.agent/...)
>
> 任何規範修改 SHALL 改 `.agent/`，不改本 stub。
```

- [ ] 4.1 `.cursor/skills/openspec-propose-change/SKILL.md` → stub（指向 `.agent/skills/openspec-propose/SKILL.md`）
- [ ] 4.2 `.cursor/skills/openspec-explore-change/SKILL.md` → stub（指向 `.agent/skills/openspec-explore/SKILL.md`）
- [ ] 4.3 `.cursor/skills/openspec-apply-change/SKILL.md` → stub（指向 `.agent/skills/openspec-apply-change/SKILL.md`）
- [ ] 4.4 `.cursor/skills/openspec-archive-change/SKILL.md` → stub（指向 `.agent/skills/openspec-archive-change/SKILL.md`）
- [ ] 4.5 `.cursor/commands/opsx-propose.md` → stub（指向 `.agent/workflows/opsx-propose.md`）
- [ ] 4.6 `.cursor/commands/opsx-explore.md` → stub
- [ ] 4.7 `.cursor/commands/opsx-apply.md` → stub
- [ ] 4.8 `.cursor/commands/opsx-archive.md` → stub
- [ ] 4.9 `.windsurf/skills/openspec-propose-change/SKILL.md` → stub
- [ ] 4.10 `.windsurf/skills/openspec-explore-change/SKILL.md` → stub
- [ ] 4.11 `.windsurf/skills/openspec-apply-change/SKILL.md` → stub
- [ ] 4.12 `.windsurf/skills/openspec-archive-change/SKILL.md` → stub
- [ ] 4.13 `.windsurf/workflows/opsx-propose.md` → stub
- [ ] 4.14 `.windsurf/workflows/opsx-explore.md` → stub
- [ ] 4.15 `.windsurf/workflows/opsx-apply.md` → stub
- [ ] 4.16 `.windsurf/workflows/opsx-archive.md` → stub

## 5. 驗證

- [ ] 5.1 `git ls-files docs/plans/*.html`：應為空
- [ ] 5.2 `git ls-files docs/evidence/fix-ifc-usdc-hoops-load-failure/`：應為空（已搬到 archive sibling）
- [ ] 5.3 `ls openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/evidence/`：應有 evidence files
- [ ] 5.4 抽 1-2 個 stub 確認 relative link 路徑正確（可 cat 到對應 `.agent/` source）
- [ ] 5.5 三套 mirror（`.agent`/`.cursor`/`.windsurf`）某一個 opsx workflow body 完成 stub 化後字數預估：`.agent` 完整、`.cursor`/`.windsurf` body 縮為 ~5 行
- [ ] 5.6 `openspec validate trim-docs-and-dedupe-ide-skills`
- [ ] 5.7 `git diff --cached --check`：no trailing whitespace
- [ ] 5.8 `python -m pytest tests -p no:cacheprovider`（純文件 change，預期 PASS；若無 .venv 跳過並標註）

## 6. PR + Archive

- [ ] 6.1 push branch `codex/openspec/trim-docs-and-dedupe-ide-skills`
- [ ] 6.2 開 PR（標題使用繁體中文），description 列出：
  - 刪檔清單 + size 對照
  - Evidence 搬移「舊 path → 新 path」對照表
  - Stub 化 16 個檔的清單
  - `git ls-files docs/plans/*.html` 與 `docs/evidence/fix-ifc-usdc-hoops-load-failure` 前後對照
- [ ] 6.3 等 GitHub Actions PASS、reviewer approve、merge to main
- [ ] 6.4 merge 後在 main 跑 `openspec archive trim-docs-and-dedupe-ide-skills`
- [ ] 6.5 確認 archive 後 spec delta（`documentation-source-of-truth` MODIFY + `agent-doc-context-budget` ADDED）已 sync 進 `openspec/specs/`
