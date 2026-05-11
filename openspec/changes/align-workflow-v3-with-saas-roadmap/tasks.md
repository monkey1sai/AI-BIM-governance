## 1. 在 SaaS 路線圖 §1 補入 cross-reference

- [x] 1.1 編輯 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md` §1（現況基線）開頭，加入一段 cross-reference：明確指出 workflow v3（`docs/PROJECT_DEVELOPMENT_WORKFLOW.md`）為「開發流程入口」，本 roadmap 保留為「OpenSpec 候選 / NVIDIA 採用決策 / 硬體配置」權威。
- [x] 1.2 確認新增段落引用的相對路徑（`../PROJECT_DEVELOPMENT_WORKFLOW.md`）在 markdown render 後可開啟，沒有 dead link。
- [x] 1.3 不修改 §2-§13 任何決策內容，只動 §1.0 / §1.1 範圍前的引言段。

## 2. 在 README.md 補入兩份文件分工說明

- [x] 2.1 在 README.md 既有「服務分工與邊界」與「Demo UI 設計守則」之間，新增「核心文件入口」段落，列出 AGENTS.md、workflow v3、SaaS 路線圖、openspec/specs/ 四份 source of truth 的角色與閱讀順序。
- [x] 2.2 確認 README.md 對 workflow v3 與 roadmap 的相對路徑連結可開啟。
- [x] 2.3 不新增任何 demo flow 或服務啟動段落。

## 3. Validate And Review

- [x] 3.1 Run `openspec validate align-workflow-v3-with-saas-roadmap`. ✓ valid
- [x] 3.2 確認 PR #8 對應 commit `3e2eedc`（workflow v3 對齊）已 push 到 `cursor/fix/date---feature/fix/issue/project-development-workflow-877a` 分支，兩個 PR 並行 review。
- [ ] 3.3 Run `git diff --check`（在 commit 前執行）.
- [x] 3.4 本 change 為 docs only，無需 GitNexus 重新 detect changes（GitNexus hook 提示為知識圖過期，與本 change 無關）。

## 4. Archive

- [ ] 4.1 PR merge 進 `main` 後執行 `openspec archive align-workflow-v3-with-saas-roadmap`，把 change folder 移至 `openspec/changes/archive/<YYYY-MM-DD>-align-workflow-v3-with-saas-roadmap/`。
- [ ] 4.2 Archive 後不再對 `main` 上的 roadmap §1 / README.md 文件分工說明直接 commit；任何後續分工調整都應以對應新 OpenSpec change 處理。
