# 非平凡 / 高風險任務 task-tier 判斷、worker dispatch、evidence labels 契約

> 日期：2026-06-25（本地 commit `f6de50e` 撰寫日）；補開 PR：2026-07-01
> 類型：agent governance doc 新增規則（非 code / 非 runtime）

## 背景與問題

`AGENTS.md` / `CLAUDE.md` 既有的「Karpathy-style 工作守則」只要求非平凡任務先列出假設、成功標準、最小改動面，**沒有**明確定義：

- 如何判斷任務是 trivial / simple / non-trivial / high-risk（task complexity tier）；
- 何時「必須」派 worker/subagent 分工、何時可以不派但要說明理由；
- 每個 worker/reviewer 回報應包含哪些欄位（scope / evidence / finding / uncertainty / risk / next step）；
- 最終回覆是否要把「已驗證事實」「推論」「未驗證風險」分開標示，避免把 stale memory 或 GitNexus/graph 摘要當成 runtime-verified 事實呈現。

本地 commit `f6de50e`（2026-06-25「update agent rules」）已經寫好這批規則,並新增 `docs/agents/advanced-agent-reasoning-contract.md` 作為完整規則的落地檔案,但該 commit 從未 `git push` 到 `origin`,只存在單一開發者本機。結果:`AGENTS.md`/`CLAUDE.md` 的 sub-file 表格若照抄 `f6de50e` 會指向一個從未 commit 過的檔案路徑,造成文件斷連結。PR #267 把 `f6de50e` 的內容(規則本文 + 新檔)整理後正式提交。

## 設計

在 `AGENTS.md`(`### Karpathy-style 工作守則`區塊)與 `CLAUDE.md`(`## Global Claude Code Rules` 對應區塊)各新增一條守則:

> 非平凡 / 高風險任務必須先做 task tier 判斷、worker dispatch 或明確說明不派 worker 的理由,並在最終回覆區分 verified facts / inferences / unverified risks。

並在兩份主檔的 sub-file 對照表各新增一列,指向新檔 `docs/agents/advanced-agent-reasoning-contract.md`。該檔（loaded lazily，非平凡/高風險任務才讀）定義:

1. **Task Complexity Tiers**:trivial / simple / non-trivial / high-risk 四級,依「是否跨架構、多檔案/服務、測試、部署、使用者可見行為、需求不明確、外部工具」與「是否涉及 auth/secrets/production deploy/CI/data deletion/security/Kit-WebRTC runtime/破壞性指令」區分。
2. **Reasoning Effort Routing**:low/medium/high/xhigh 四級,原則是「用滿足任務的最低有效努力」,而非越高越好。
3. **Worker Dispatch Rule**:非平凡任務必須派 worker 或說明理由;列出「必派」情境(2+ 獨立區塊可平行檢查、多層可能根因、security/deploy/data-loss/migration/production risk/Kit-WebRTC runtime/E2E readiness、使用者要求 audit/PR review/architecture review)與「可不派」情境(答案主要來自單一 source-of-truth 檔案、shell/MCP/GitNexus 輸出比模型摘要更快更準確、純唯讀 orientation 且未做實作決策)。
4. **Worker Output Contract**:每個 worker/reviewer 必須回報 Scope / Evidence / Finding / Uncertainty / Risk / Next step,不得只回泛用摘要。
5. **Reviewer Perspectives**:依風險挑 2–5 個視角(正確性、架構/repo 邊界、安全/權限、runtime/deploy/Kit-WebRTC、測試/回歸、UX/使用者可見證據、資料品質、可維護性、成本/context 複雜度)。
6. **Evidence Labels**:最終回覆分 Verified facts / Inferences / Unverified risks / Next action 四段,禁止把文件宣稱、舊記憶、generated wiki、GitNexus/graph 摘要當作 runtime-verified 事實。
7. **Source-of-Truth Priority**:使用者最新指令 > 根目錄 `AGENTS.md` 與已載入的 `docs/agents/*.md` > code 實作 > contracts/specs/tests/CI config > generated wiki/memory/graph 摘要。
8. **Done Gate**:任務完成前必須回報改動檔案(或「無檔案改動」)、已跑驗證、未跑驗證與原因、已知風險、evidence path/輸出摘要、worker dispatch 是否使用或略過;使用者可見改動仍須另外滿足 `docs/agents/product-operability-and-script-contract.md` 更嚴格的前端證據契約。

## 治理護欄 / 不變式

- 本規則**不取代** repo boundary、產品定位、GitNexus、deploy、驗證等既有契約,`docs/agents/advanced-agent-reasoning-contract.md` 第一行已明文聲明此點。
- 純文件變更,不修改任何 `.ts`/`.py`/`.ps1` 程式碼、不改 code symbol、不影響 runtime/deploy/frontend route。
- 兩份主檔行數預算不變:`CLAUDE.md` ≤130(目標≤100)、`AGENTS.md` ≤250(目標≤200),PR 內已量測 CLAUDE.md 124 行、AGENTS.md 217 行,皆在預算內。

## 驗證

依 `docs/CLAUDE.md`:「無自動化 link checker;PR 描述列出新增/修改 doc path 與同步來源即視為 verify pass」。本次人工核對:

- `AGENTS.md` 與 `CLAUDE.md` 的 sub-file 對照表都新增同一列 `docs/agents/advanced-agent-reasoning-contract.md`,兩份主檔集合一致(符合兩檔文件頂部「新增 sub-file 時需同步更新本表與 CLAUDE.md index」的既有規約)。
- `docs/agents/advanced-agent-reasoning-contract.md` 開頭聲明「Source-of-truth: AGENTS.md」,與新增條目互相指涉、無斷連結。
- `git diff --cached --check` 乾淨(PR 驗證段落已列)。
- 無 code symbol 變更,故不需要 `gitnexus impact` / `detect_changes`(PR 的「AI Coding Governance」表格已如實填寫 not needed)。

## 影響與連鎖

- 範圍:僅 `AGENTS.md`、`CLAUDE.md`、新檔 `docs/agents/advanced-agent-reasoning-contract.md`,三份皆為文件,不觸及 code/runtime/frontend。
- 連鎖:即日起,本 repo 內非平凡/高風險任務的最終回覆需依本檔規則分 tier、視情況派 worker、並用 verified facts / inferences / unverified risks 四段回報;既有 `docs/agents/product-operability-and-script-contract.md` 的前端證據契約與 GitNexus impact/detect_changes 契約不受影響、照舊適用。
- Rollback:revert 本 PR 的單一 squash commit 即可,三份文件互相獨立於其餘 code,無 code 依賴、無需額外遷移步驟。
