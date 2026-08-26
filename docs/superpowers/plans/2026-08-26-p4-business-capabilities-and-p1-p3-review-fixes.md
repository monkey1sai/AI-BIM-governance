# P4 業務能力爆發與 P1~P3 全面 Code Review & Fix 實施計畫

> **Implementation Directive:** 本計畫在單一 Dedicated Worktree 與單一 PR 內同時交付：
> 1. P4 A1~A10 核心業務能力（3D 測量、剖切盒、IFC 構件著色、BCF 議題連動）。
> 2. P1~P3 全面 Code Review 與強化修復（PR Queue 智能 Metadata 自動修補、組件健全度與測試補強）。

---

## 1. 三層交叉對抗驗證分析 (Three-Tier Adversarial Verification)

### 層級 1：實作邊界層 (Implementation & API Boundary Tier)
- **DataChannel 契約**：於 streamMessages.ts 擴充 buildMeasureRequest、buildClipPlaneRequest、buildColoringRequest。
- **USD 樹狀與構件著色**：useUsdStageTree 支援 IFC 類型過濾與色彩標記。
- **治理面板連動**：GovernancePanel 支援 A1~A10 規則檢核統計與違規構件 3D 一鍵高亮聚焦。

### 層級 2：串流狀態機與即時渲染層 (Streaming State Machine Tier)
- **WebRTC 狀態機**：ViewportHost 完整反應 5 態生命週期，提供重連與連線指標。
- **指令閉環追蹤**：DataChannel 訊息附帶 request_id 並對齊 runtimeCommandLifecycles。

### 層級 3：工程治理與產品驗收層 (Governance & Verification Tier)
- **單 PR 交付**：遵循 Lean Governance 減法方針，所有改動在單一 PR 內完成。
- **0 回歸保證**：Coordinator 1573 筆測試、Governance 301 筆測試、架構分層 79 筆測試全綠。

---

## 2. 執行步驟清單 (Plan Checklist)

- [ ] Step 1: 建立 Dedicated Worktree (feat/p4-business-capabilities-and-review-fixes)
- [ ] Step 2: 實作 P4 核心業務能力 (streamMessages 擴充, useUsdStageTree 著色/過濾, GovernancePanel 連動)
- [ ] Step 3: 執行 P1~P3 Code Review 修復 (manage-pr-queue 增強, ViewportHost / ViewerToolbar / healthProbeRoutes 強化)
- [ ] Step 4: 為 P3/P4 組件與擴充功能建立單元測試並執行完整驗證
- [ ] Step 5: 提交 Commit 並 Push 分支至遠端 GitHub
- [ ] Step 6: 開立 PR (Single PR 交付)
- [ ] Step 7: 執行 Blip Approval、驗證 CI 23 項全綠並 Squash Merge
- [ ] Step 8: 收斂分支與清理 Worktree
