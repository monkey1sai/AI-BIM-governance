## 1. 在 SaaS 路線圖 §1 補入 cross-reference

- [x] 1.1 編輯 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1（現況基線）開頭，加入一段 cross-reference：明確指出 workflow v3（`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`）為「開發流程入口」，本 roadmap 保留為「OpenSpec 候選 / NVIDIA 採用決策 / 硬體配置」權威。
- [x] 1.2 確認新增段落引用的相對路徑（`../PROJECT_DEVELOPMENT_WORKFLOW.md`）在 markdown render 後可開啟，沒有 dead link。
- [x] 1.3 不修改 §2-§13 任何決策內容，只動 §1.0 / §1.1 範圍前的引言段。

## 2. 在 README.md 補入兩份文件分工說明

- [x] 2.1 在 README.md 既有「服務分工與邊界」與「Demo UI 設計守則」之間，新增「核心文件入口」段落，列出 AGENTS.md、workflow v3、SaaS 路線圖、openspec/specs/ 四份 source of truth 的角色與閱讀順序。
- [x] 2.2 確認 README.md 對 workflow v3 與 roadmap 的相對路徑連結可開啟。
- [x] 2.3 不新增任何 demo flow 或服務啟動段落。

## 3. 修正 main roadmap §1.2 / §1.4 staleness（順便範圍）

- [x] 3.1 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1.2 段首把「**9** 個 capability」改為「**10** 個 capability」，並在表格末加 row `runtime-verification-task-status`（對應 v1 Phase 3、v2 Layer 6，狀態 ✓ runtime verification task checklist 語意）。
- [x] 3.2 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1.4 archived change 對照表加 row `2026-05-08-fix-runtime-verification-task-status` → 影響 `runtime-verification-task-status`（新增），摘要：GPU / concurrent runtime checklist 語意不得因 blocker classification 被視為完成。
- [x] 3.3 不修改 §1.3 / §2-§13 任何決策內容；只修正 §1.2 / §1.4 staleness。

## 4. Validate And Review

- [x] 4.1 Run `openspec validate align-workflow-v3-with-saas-roadmap`. ✓ valid（initial spec only）；本 commit 加 staleness fix 後重跑。
- [x] 4.2 確認 PR #8 對應 commit `3e2eedc`（workflow v3 對齊）已 push 到 `cursor/fix/date---feature/fix/issue/project-development-workflow-877a` 分支。
- [x] 4.3 Run `git diff --check`（在 commit 前執行）.
- [x] 4.4 本 change 為 docs only，無需 GitNexus 重新 detect changes（GitNexus hook 提示為知識圖過期，與本 change 無關）。

## 5. Merge Order Coordination

- [x] 5.1 確認 PR #8（workflow v3 對齊，commit `3e2eedc`）**已 merge 進 main**；本 PR 引用 `docs/PROJECT_DEVELOPMENT_WORKFLOW.md` 必須在 main 存在後才能 merge，否則會立刻違反本 PR 自身新增的 `documentation-source-of-truth` capability。
- [x] 5.2 PR #8 merge 後 rebase 本 branch 至最新 main（或重跑 CI），確認 `../PROJECT_DEVELOPMENT_WORKFLOW.md` 相對連結在 main 上成立。
- [x] 5.3 本 PR 與 PR #8 在兩端 PR description 都標註 merge order「PR #8 → PR #23」。

## 6. Archive

- [x] 6.1 PR merge 進 `main` 後執行 `openspec archive align-workflow-v3-with-saas-roadmap`，把 change folder 移至 `openspec/changes/archive/<YYYY-MM-DD>-align-workflow-v3-with-saas-roadmap/`。
- [x] 6.2 Archive 後不再對 `main` 上的 roadmap §1 / README.md 文件分工說明直接 commit；任何後續分工調整都應以對應新 OpenSpec change 處理。
