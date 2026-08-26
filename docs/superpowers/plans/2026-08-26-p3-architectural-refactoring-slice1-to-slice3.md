# P3: 巨石單檔領域架構重構實施計畫 (Slice 1 to Slice 3)

> **Implementation authorization:** 本計畫落實 P3 階段之巨石單檔領域架構重構，涵蓋 Slice 1 (Coordinator 路由模組化)、Slice 2 (Viewer USD 樹與視圖容器抽離) 與 Slice 3 (Viewer 治理面板與工具列抽離)。依照 Superpowers 生命週期執行：Plan -> Worktree -> Implement & Verify -> PR -> Review & Merge。

**目標:**
1. **Slice 1: Coordinator 後端解耦**：將 bim-review-coordinator/src/app.ts (4.6k行) 拆解為 src/routes/ 下的 streamRoutes, healthRoutes, sessionRoutes, conversionRoutes，並確保 1573 筆測試全綠。
2. **Slice 2: Viewer USD 樹與視圖容器抽離 (Issue #609, #607)**：實作 useUsdStageTree Hook 與 ViewportHost 組件。
3. **Slice 3: Viewer 治理面板與工具列抽離 (Issue #608, #605)**：實作 ViewerToolbar 與 GovernancePanel 組件。

## 執行進度清單
### Slice 1: Coordinator 路由模組化
- [ ] Step 1.1: 建立 streamRoutes.ts 處理 WebRTC 串流端點與 Token 驗證
- [ ] Step 1.2: 建立 healthRoutes.ts 處理健康檢查與 Artifact 探針
- [ ] Step 1.3: 建立 sessionRoutes.ts 處理 Review Session 協同與生命週期
- [ ] Step 1.4: 建立 conversionRoutes.ts 處理 IFC 轉檔派發與佇列控制
- [ ] Step 1.5: 收斂 app.ts 並全通 bim-review-coordinator 全部 1573 筆測試

### Slice 2: Viewer USD 樹與視圖容器抽離 (Issue #609, #607)
- [ ] Step 2.1: 抽離 useUsdStageTree Hook (Issue #609)
- [ ] Step 2.2: 抽離 ViewportHost 組件 (Issue #607)

### Slice 3: Viewer 治理面板與工具列抽離 (Issue #608, #605)
- [ ] Step 3.1: 抽離 ViewerToolbar 組件 (Issue #605)
- [ ] Step 3.2: 抽離 GovernancePanel 組件 (Issue #608)

### 驗證與交付
- [ ] Step 4.1: 本機 Preflight 與全套測試驗證
- [ ] Step 4.2: 提交 Commit、開立 PR、審批與 Merge
