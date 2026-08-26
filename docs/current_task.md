# 任務：跨 Session 待辦任務佇列與治理交接樞紐 (Active Handoff Hub)

## Objective (目標)
- 統籌當前主分支（`main` Commit `dc8c373`）後續待辦任務佇列。
- 確保 **AGY CLI (Antigravity)** 與 **Codex CLI** 於下次啟動 Session 時能直接無縫接續推進。
- 維護單一真相源：技能、看板、同步腳本與 AGENTS.md 治理全體一致。

## Pending Task Queue (依序執行之待辦任務清單)
- [x] **任務 1：推進與處置 PR #705 (服務啟動設定納管)**
  - 範疇：納管 `.claude/launch.json`（現役 3 大服務 `coordinator:8004`, `viewer:5173`, `streaming:49100`），嚴格排除已退役之 `_worker`, `_bim-control`。
  - 處置成果：全數 23 項 CI 檢查通過（包含 `rebuild-test-deploy contracts`、`design-semantic-visual` 等），已自動核准並於 Commit `ed09921` 成功合入 main。
- [ ] **任務 2：推進與處置 PR #704 (spec-to-done NEW_RUN 邊界強化)**
  - 範疇：更新 trusted-git 解析器與 durable-state lock，修復 Windows runner 權限相容性。
- [ ] **任務 3：Unified Console S2 產品主線推進**
  - 範疇：接續 `unified-console-runtime-truth` Slice 2，將真資料串接與轉檔佇列深化綁定至 `/ui` 介面。
- [ ] **任務 4：A4 語意搜尋與檢核切片 (S4-C / S4-D)**
  - 範疇：依據 `docs/plans/NOW.md` 與設計文件 §07/§08，推進 A4 議題持久化與高保真 UI 整合。

## Context & Thoughts (跨 CLI 治理與架構上下文)
1. **主工作區絕對乾淨與強制 Worktree 隔離（永久記憶鐵律）**：
   - 主工作區 (`AI-BIM-governance/`) 永遠保持 `main == origin/main` 且無 dirty files。
   - 任何變更/新增受版控檔案或 code 一律在獨立 Worktree（`AI-BIM-governance.worktrees/<name>`）實作。
   - 所有 Task 必須經由真實測試與 **Chrome E2E 語意驗證（Playwright / Agent in Chrome）** 驗收；無實證數據絕不宣稱完成。全體 Agent（Codex、Claude、AGY、Grok）一體嚴格遵守。
2. **治理與規則共用**：AGY CLI 與 Codex CLI 均遵循根目錄 [`AGENTS.md`](file:///C:/Repos/active/iot/AI-BIM-governance/AGENTS.md)（含四大車道 Lane F/B/G/S、Lean Governance 減法方針、Single PR 交付、:8004 唯一後端等鐵律）。
3. **技能樹同步**：專案 Canonical 技能維護於 [`.agents/skills/`](file:///C:/Repos/active/iot/AI-BIM-governance/.agents/skills)，自動同步至 `.codex/skills/` 與 `.claude/skills/`，AGY 亦自 `.gemini/config/skills` 與 `.agents/skills` 載入完整 Superpowers。
4. **安全同步與看板**：開工/收工一律經由 `scripts/dev/agents-board.mjs` 感知並調用 `sync-main-safely`，並自動觸發進程垃圾回收（`cleanup-orphan-dev-processes`）。
5. **自主 PR 佇列與 Hook 引擎**：已建立 `scripts/dev/manage-pr-queue.mjs` 與看板/Git Hooks 雙向串接，實現多 Session 並行時全自動多 PR 追蹤、智慧解衝突、預檢修復、Blip 審批與快進合入。

## Handoff Note for Next Session (下個 Session 啟動指引)
1. **開工登記**：執行 `node scripts/dev/agents-board.mjs register --agent agy`（或 `codex`）。
2. **狀態確認**：執行 `node scripts/dev/manage-pr-queue.mjs status` 檢查 PR 佇列。
3. **任務接續**：依上述 **Pending Task Queue** 由「任務 2 (PR #704)」接續推進！
