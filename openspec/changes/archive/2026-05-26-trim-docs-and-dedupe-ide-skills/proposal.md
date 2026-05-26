## Why

`slim-agents-md-auto-load` change 把 root entrypoint 從 1,341 行縮到 184 行（-86%），但 repo 還有兩條 non-code bloat 來源沒處理：

1. **`docs/plans/` 與 `docs/evidence/` 的大檔**：`saas-roadmap-2026-05.html` (305 KB) 與 `.md` source (230 KB) 同名雙存；`docs/evidence/fix-ifc-usdc-hoops-load-failure/` 整個目錄 ~1.2 MB（PNG / JSON / chrome-events.json 290 KB）已對應 archived change `2026-05-22-fix-ifc-usdc-hoops-load-failure`，卻散落在 root `docs/evidence/` 跟 archive 並排，grep / search 容易撈到舊 evidence；`TEMP-*` 前綴的臨時 plan 已過期未清。
2. **`.agent` / `.cursor` / `.windsurf` 三套 IDE 鏡像 opsx skills 完全重複**：經 diff 比對，三套 `openspec-{propose,explore,apply,archive}/SKILL.md` 內容 **100% 相同（4756 byte × 3）**；workflow 檔（opsx-*.md）只在 frontmatter（IDE 專屬 metadata）有差異，body 完全相同。這代表每次改一條 opsx workflow 規範要動 12 個檔（3 套 mirror × 4 個 workflow），且 agent 在 `find` / `grep` skill 內容時會掃到 3 倍重複。

**現在改的理由**：兩條都會增加 search 噪音、增加維護成本、且都不需要動到 product runtime。一次處理可以把 evidence 與 archive 對齊（檔案管理本身的清晰度），同時降低未來新增 opsx workflow 規範的 12-檔同步成本。

## What Changes

### A. `docs/plans/` — 砍重複格式與過期臨時檔

- **BREAKING**（governance 規則）：`docs/plans/*.html` 從 tracked 改為 **on-demand 生成、不入 repo**；對應的 markdown 為 source-of-truth。`.gitignore` 加 `docs/plans/*.html`。砍掉現有：
  - `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.html`（305 KB）
  - `docs/plans/AI-BIM-governance-next-burn-down-2026-05-19.drive.html`（5 KB）
- 砍 `docs/plans/TEMP-fast-mvp-session-artifact-binding-discussion-2026-05-25.md`（18 KB，TEMP 前綴已過期；其討論結論已併入 `docs/plans/fast-mvp-edge-bim-server-console-design-2026-05-25.md`，無資訊損失）。

### B. `docs/evidence/` — 把 archive change 的 evidence 搬到 archive sibling

- **不刪除 evidence**：搬到對應 archived change 的 sibling location，與 archive 並列：
  - `docs/evidence/fix-ifc-usdc-hoops-load-failure/` → `openspec/changes/archive/2026-05-22-fix-ifc-usdc-hoops-load-failure/evidence/`（~1.2 MB）
  - `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/` → `openspec/changes/archive/2026-05-25-viewer-edge-bim-server-console/evidence/`（25 KB）若該 change 已 archive；否則暫不搬。
- 更新被搬走 evidence 的 archived change `acceptance.md` 內的 path 引用（保持 link 不斷）。
- 之後 archive change 的 evidence SHALL 跟 change artifact 並列，不在 root `docs/evidence/` 落地（governance 規則）。

### C. `.agent` / `.cursor` / `.windsurf` 三套 IDE 鏡像 — Stub 化 dedupe

- **保留 source-of-truth**：`.agent/skills/openspec-{propose,explore,apply,archive}-change/SKILL.md` 與 `.agent/workflows/opsx-{propose,explore,apply,archive}.md`（IDE-neutral）。
- **`.cursor/skills/`、`.windsurf/skills/`、`.cursor/commands/`、`.windsurf/workflows/` 改為 thin stub**：保留 IDE-specific frontmatter（讓 IDE 能掃到），body 改為一行 `> Body content lives in [`.agent/...`](../../.agent/...)；source-of-truth is `.agent/`. 任何規範修改 SHALL 改 `.agent/`，不改 stub。`。
- **不刪檔**（避免 IDE 端突然找不到 skill），改為 stub 形式留命名一致性。

### Non-goals

- 不搬移 `openspec/changes/archive/` 整個 dir 出 repo（另案）。
- 不改 root `AGENTS.md` / `CLAUDE.md` slim 主檔（已在 `slim-agents-md-auto-load` 處理）。
- 不動 `.claude/skills/` 內的 closed-loop 進階 skills（apply-and-verify / openspec-explore-twice / opsx-worktree-guard / opsx-worktree-provision / archive-and-closeout / pr-review-gate / change-id-resolve / gitnexus-blast-radius / closed-loop-orchestrator）— 這些是 Claude-specific 加值層，不是三套 mirror 的重複。
- 不刪除任何 evidence binary（PNG / JSON）— 只搬位置。
- 不引入新的 build / regenerate CI job（HTML on-demand 生成由 owner 手動跑 doc skill，不入 CI）。

## Capabilities

### New Capabilities

- 無新 capability；此 change 是 governance / dedup 改動。

### Modified Capabilities

- `documentation-source-of-truth`: MODIFY `Roadmap HTML is regenerated` requirement — HTML 改為 on-demand、不入 repo；新增 `docs/plans/*.html` ignored 義務。
- `agent-doc-context-budget`: ADDED requirement — IDE skill mirror（`.cursor/` / `.windsurf/`）SHALL stub-only，source-of-truth 在 `.agent/`；root entry `docs/evidence/<topic>/` 不再作為 archived change evidence 落地點。

## Impact

- **改動範圍**：
  - 刪除：`docs/plans/*.html`（2 檔，310 KB），`docs/plans/TEMP-*.md`（1 檔，18 KB）
  - 搬移：`docs/evidence/fix-ifc-usdc-hoops-load-failure/`（~1.2 MB → archive sibling）
  - 改為 stub：`.cursor/skills/openspec-*/SKILL.md` × 4，`.cursor/commands/opsx-*.md` × 4，`.windsurf/skills/openspec-*/SKILL.md` × 4，`.windsurf/workflows/opsx-*.md` × 4（共 16 檔）
  - 新增：`.gitignore` 規則 `docs/plans/*.html`
  - Spec delta：`documentation-source-of-truth`（MODIFY），`agent-doc-context-budget`（ADDED requirements）
- **不影響**：所有 product runtime（coordinator / streaming-server / viewer / tests）；GitHub Actions；GitNexus index；root `AGENTS.md` / `CLAUDE.md`；`.agent/` source-of-truth skills；`.claude/skills/` closed-loop skills；archived change artifacts 本體（只是 evidence 改 path 加入 sibling）。
- **Boundary**：純 documentation / agent-tooling 層，不跨 product repo boundary，不影響 B 方案閉環。
- **節省**：tracked size 預估減 ~330 KB（HTML 305 + TEMP 18 + 細項）；evidence 搬位後 root `docs/evidence/` 體積近零（只留未 archive 的當期 evidence）；opsx skill 維護 N×3 → N×1。
- **依賴**：無新 production dependency；不動 `package.json` / `pyproject.toml` / CI workflow。
