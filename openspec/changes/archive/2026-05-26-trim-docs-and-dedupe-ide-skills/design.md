## Context

延續 `slim-agents-md-auto-load` 對 agent context budget 的處理，本 change 砍下兩條剩餘的 non-code bloat：
- `docs/plans/*.html`（roadmap HTML 與 markdown 同名雙存）+ 過期 `TEMP-*` plan
- `docs/evidence/<topic>/` 跟 `openspec/changes/archive/<change-id>/` 並排但分離
- `.agent` / `.cursor` / `.windsurf` 三套 IDE 鏡像 opsx skill 100% 重複（每改一條規範動 12 個檔）

`documentation-source-of-truth` spec 既有 `Roadmap HTML is regenerated` Scenario 已暗示 HTML 是「衍生檢視」、Markdown 是 source-of-truth；本 change 把這條規則推到「衍生檢視 on-demand、不入 repo」。

## Goals / Non-Goals

**Goals:**

- 把 `docs/plans/*.html` 從 tracked 改為 ignored；明確規範 HTML on-demand 生成、不入 repo。
- 把 archived change 的 evidence 搬到 archive sibling location（`openspec/changes/archive/<change-id>/evidence/`），與 archive artifact 並列；root `docs/evidence/` 之後只放未 archive 當期 evidence。
- 砍 `TEMP-*` 過期 plan markdown。
- 三套 IDE skill mirror dedupe：source-of-truth 留 `.agent/`，`.cursor/` / `.windsurf/` 改為 stub（保留檔名命名，body 只留 link）。
- 新增 spec gate：（a）`docs/plans/*.html` 不得 tracked；（b）archived change evidence SHALL 與 change artifact 並列；（c）IDE skill mirror SHALL 為 stub。

**Non-Goals:**

- 不搬移 `openspec/changes/archive/` 出 repo（另案）。
- 不引入 build / CI job 自動 regenerate HTML（owner 手動跑 doc skill）。
- 不刪除任何 evidence binary。
- 不動 `.claude/skills/` 內 Claude-specific closed-loop skills（不是三套 mirror 的重複）。
- 不寫 generator script 同步三套 mirror（stub 形式已夠 DRY，不增 CI 複雜度）。

## Decisions

### Decision 1：HTML 改為 ignored，而非「regenerated」

選擇直接刪 HTML + `.gitignore` `docs/plans/*.html`。

理由：roadmap markdown 已是 source-of-truth；HTML 305 KB 是衍生檢視，git diff / review / search 都不適合處理 monolithic HTML。需要瀏覽時，owner 手動跑 markdown→html skill 在本機生成。

備選：保留 HTML、加 CI job 重新生 → **不採用**，會增加 CI 複雜度且 monolithic HTML diff review 沒實質意義。

### Decision 2：Evidence 搬到 archive sibling，而非刪除或壓縮

選擇 `docs/evidence/<topic>/` → `openspec/changes/archive/<change-id>/evidence/`。

理由：
- archived change 的 `acceptance.md` 已引用 evidence path；搬到 sibling 後相對 path 更短、更語意化。
- archive change 自帶 evidence 比 root `docs/evidence/` + archive 兩個分散位置好維護。
- 後續 archive evidence policy 統一：每個 archived change 自帶 evidence dir。

備選：
- 刪除 evidence → **不採用**，evidence 是 archive change 的審查證據，保留有審查重現價值。
- 壓縮 `.zip` 入 repo → **不採用**，git 對 binary 壓縮無增益，反而 diff/review 更難。
- 搬到外部 git LFS → **不採用**，scope 超出本 change，且本 repo 未啟用 LFS。

### Decision 3：IDE skill mirror 改 stub，不刪檔

選擇 `.cursor/` / `.windsurf/` 改 stub：frontmatter + 一行 link 到 `.agent/`。

理由：
- 直接刪 → Cursor / Windsurf 在 repo 內找不到 opsx skill，使用者體驗變差。
- Stub 留檔名 → IDE 仍能掃到 skill 入口，body 只有 link，內容修改只動 `.agent/` 一處。
- 三套 mirror frontmatter 規則不同（Cursor `name: /opsx-propose` vs Windsurf `name: "OPSX: Propose"`），stub 保留 IDE-specific frontmatter 即可。

備選：
- Generator script 從 `.agent/` 同步 → **不採用**，stub 已夠簡單，generator + CI gate 是過度工程。
- 完全刪 mirror → **不採用**，使用者體驗考量。

### Decision 4：Stub 內容格式

每個 stub 為：

```markdown
---
<IDE-specific frontmatter, 原樣保留>
---

> **Stub**: 內容已 dedupe 到 source-of-truth `.agent/<path>`，本檔僅保留 IDE entry point 命名。
>
> Source: [`.agent/.../<filename>`](../../../.agent/<full-path>)
>
> 任何規範修改 SHALL 改 `.agent/`，不改本 stub。
```

備選：stub 連 link 都不放、純導向訊息 → **不採用**，留 link 讓 agent / 人類點得進去。

### Decision 5：Evidence path 引用更新範圍

只更新被本 change 搬到的 archived change 內部 `acceptance.md`（用 sibling relative path 取代 root absolute path）；不更新非 archive 內部文件對 `docs/evidence/` 的引用（若存在，那些屬於當期工作的引用，不在本 change scope）。

## Risks / Trade-offs

- **[風險] HTML 改 ignored 後新人不知道怎麼生** → Mitigation: 在 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` 開頭加 metadata 註記「如需 HTML 檢視，本機跑 doc/規劃 skill 從本檔生成；HTML 不入 repo」。
- **[風險] Evidence 搬到 archive sibling 後，外部連結（PR / commit message / Slack）失效** → Mitigation: 搬移時記錄「舊 path → 新 path」對照表入 PR 描述；archived change 內部 link 同步更新；外部歷史 reference 接受 link rot（已 archived，價值衰減）。
- **[風險] IDE skill stub 後，Cursor / Windsurf 在某些情境下不會展開 link，使用者讀到 stub 不知道內容** → Mitigation: stub 頭部一行明示「Stub：內容在 .agent/」+ 帶 path link；agent 看到 stub 應自動 read 對應 .agent file（與 lazy-load sub-file 模式一致）。
- **[風險] `.gitignore docs/plans/*.html` 規則太廣，誤殺日後其他 HTML** → Mitigation: 規則限定在 `docs/plans/`，不影響其他目錄；review 時 PR description 列出受影響 path。
- **[Trade-off] dedupe 完成後，三套 mirror 不再有獨立內容**，IDE 客製要動 source（`.agent/`）。換來的好處：N×3 維護成本變 N×1，且 search 噪音 -67%。

## Migration Plan

1. **Pre-flight**：確認 `2026-05-22-fix-ifc-usdc-hoops-load-failure` archive 內 `acceptance.md` 對 evidence path 的所有引用點。
2. **HTML 刪除**：`git rm docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html docs/plans/AI-BIM-governance-next-burn-down-2026-05-19.drive.html`；`.gitignore` 加 `docs/plans/*.html`。
3. **TEMP plan 刪除**：`git rm docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md`。
4. **Evidence 搬移**（git mv 保留 history）：`git mv docs/evidence/fix-ifc-usdc-hoops-load-failure openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/evidence`。
5. **Acceptance.md path 修正**：在搬到的 archived change 內 sed/edit `docs/evidence/fix-ifc-usdc-hoops-load-failure/` → `evidence/`（sibling relative）。
6. **IDE skill stub 化**：對 `.cursor/` 與 `.windsurf/` 每個 opsx-related skill / workflow，保留 frontmatter，body 改 stub 樣板。共 16 檔。
7. **Spec delta 寫入**：`documentation-source-of-truth` MODIFY；`agent-doc-context-budget` ADDED requirements。
8. **roadmap.md 加 HTML on-demand 註記**。
9. **驗證**：`openspec validate`、`git diff --cached --check`、`git ls-files docs/plans/*.html` 應為空、`ls openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/evidence/` 應有 evidence files、抽 1-2 個 stub 確認 link 可開。
10. **Rollback strategy**：純文件 / IDE skill / spec 改動，revert PR 即可。

## Open Questions

- (Q1) `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/` 對應的 archived change 是 `2026-05-25-viewer-edge-bim-server-console` 還是 `2026-05-25-fast-mvp-edge-bim-server-console`？
  - 暫定：apply 階段 `ls openspec/changes/archive/` 確認真實 change-id 後再決定搬移目標。若無對應 archive，先留在原位（屬當期 evidence）。
- (Q2) 是否要對 `docs/plans/*.html` 規則加 lint job 在 GitHub Actions 阻擋 PR 把 HTML 加回？
  - 暫定 **不加**：spec scenario 已可被 PR review 直接驗（`git ls-files docs/plans/*.html` 為空）；增 CI 任務超出本 change scope。
- (Q3) 是否要把 `.agent/skills/` source-of-truth path 寫進 root `AGENTS.md`？
  - 暫定 **不寫**：AGENTS.md 已是 slim entry，IDE skill 是 agent-tooling 層細節，本 change 只動 `agent-doc-context-budget` spec 與 `docs/agents/repo-boundary-detail.md` 不需要更動。
