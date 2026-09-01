# Plan: RVT-IFC-USDC Lineage Implementation (spec-to-done)

- Spec: `openspec/changes/rvt-ifc-usdc-lineage/`
- Worktree: `C:\Repos\active\iot\AI-BIM-governance.worktrees\lineage-pr-b-delivery`
- Branch: `feat/lineage-pr-b-delivery`
- Baseline: `033ec31d9405d93a3864b2065a40e8f51f145863`
- Date: `2026-08-31`
- Execution Mode: `full`
- User Facing: `true`

## 1. 任務目標 (Objective)
推進 `rvt-ifc-usdc-lineage` 規格之完整交付，包含：
1. Coordinator 端之 Lineage 讀取模型與 Artifact 下載簽名整合（Task 3.4）。
2. Streaming Server 端之模型元素血統映射（UUID36↔GlobalId22）、對齊率計算與結果清單產出（Task 4）。
3. Dedicated Cloud Lineage Publication Outbox 與 HMAC 簽章合約（Task 7）。
4. Web Viewer Console 之 `#/pipeline` 與 Lineage 狀態展示（Task 8）。
5. 完整整合測試與真實 IFC Chrome E2E 語意驗證（Task 9）。

## 2. 實作任務清單 (Implementation Tasks)

### Task 1: Coordinator Lineage Read Models & Artifact Endpoints (Task 3.4)
- **檔案**：
  - `bim-review-coordinator/src/routes/lineageGovernanceMetadataRoutes.ts`
  - `bim-review-coordinator/src/routes/lineageArtifactDownloadRoutes.ts`
  - `bim-review-coordinator/src/services/lineage/lineageMetadataProjections.ts`
- **實作內容**：
  - 完善 `GET /api/governance/lineage/results/:id/overview` 與 `GET /api/governance/lineage/results/:id/artifacts`。
  - 接線 `createS3LineageArtifactDownloadSigner`，提供短效安全簽名 URL（TTL≤300s）。
- **驗證**：`npm --prefix bim-review-coordinator test tests/lineage/`

### Task 2: Streaming Server Conversion Lineage Alignment & Mapping (Task 4)
- **檔案**：
  - `bim-streaming-server/src/conversion/element_mapping.py`
  - `bim-streaming-server/src/conversion/alignment_report.py`
  - `bim-streaming-server/src/conversion/conversion_authority.py`
- **實作內容**：
  - 支援解析 `schedule.csv` 並與 IFC elements 進行 UUID36↔GlobalId22 比對。
  - 計算三組對齊率比率（RVT→IFC, IFC→USDC, Full Lineage），分母為 0 時回傳 `ratio=null`。
  - 生成 `lineage_alignment_report.json`。
- **驗證**：`pytest tests/conversion/ -v`

### Task 3: Cloud Lineage Publication Outbox & Client Contracts (Task 7)
- **檔案**：
  - `bim-review-coordinator/src/services/lineage/cloudLineagePublicationOutbox.ts`
  - `tests/contracts/cloud-lineage-publication-*.schema.json`
- **實作內容**：
  - 實作原子 JSON Outbox，包含狀態：`DISABLED | PENDING | RETRYING | DELIVERED | DEAD_LETTER`。
  - 實作 HMAC-SHA256 簽章與 canonical header 生成。
- **驗證**：`npm --prefix bim-review-coordinator test tests/lineage/cloud-lineage-publication.test.ts`

### Task 4: Frontend Pipeline & Lineage Outbox Status Display (Task 8)
- **檔案**：
  - `web-viewer-sample/src/console/PipelineDashboard.tsx`
  - `web-viewer-sample/src/console/LineageOverviewCard.tsx`
- **實作內容**：
  - 在 `#/pipeline` 介面呈現 Lineage 處理狀態、對齊比率與下載按鈕。
  - 遵守唯讀向 Coordinator 查詢契約，不直連後端資料庫。
- **驗證**：`npm --prefix web-viewer-sample run typecheck`

### Task 5: End-to-End Verification & Chrome E2E Evidence (Task 9)
- **實作內容**：
  - 執行真實 IFC 模型轉檔與 Lineage 查詢驗證。
  - 執行 Playwright 語意 E2E 測試並產出截圖與 Trace 實證。
- **驗證**：`npm run test:e2e:lineage`

## 3. 完成標準 (Definition of Done)
- [ ] 所有 affected Vitest 與 pytest 測試 100% 通過。
- [ ] `npx --no-install openspec validate rvt-ifc-usdc-lineage --strict` 驗證通過。
- [ ] Chrome Playwright E2E 產出完整可視化證據。
- [ ] 零元治理債務，單一 PR 交付。
