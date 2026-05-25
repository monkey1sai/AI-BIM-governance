## Context

`web-viewer-sample/src/Window.tsx` 目前 1,809 行,有 stage-truth-panel、
DemoControlPanel(360 寬,含 ConversionSummaryCard、mapping 操作、issue 試標)、
ReviewLauncher + PresencePanel + ArtifactPanel(300 寬)、USDAsset 下拉、USDStage tree
等元件。

筆記 2026-05-25 指明:fast MVP 主畫面應重新定位為「Edge BIM Data Server Console」,
弱化 collaboration / multi-user / issue / repo map / Interaction lab,加強三段 ready
分層與 BIM 語意驗收。

## Approach

### D1. 漸進重排(B approach)

不重寫整個 Window.tsx 一次到位;保留 state machine 與 AppStream lifecycle,逐 commit
刪除 / 新增 / 重排:

```text
commit 1:OpenSpec scaffold
commit 2:擴 types/review.ts:
  - ConversionQualityMetricsSummary 加 semantic_mapping_fidelity /
    mapping_has_ifc_type / mapping_has_ifc_name
  - ReviewLifecycleStatus 加 queued_for_conversion / dropped_on_restart
commit 3:刪 ReviewLauncher / PresencePanel / ArchitectureOverview 元件
        + Window.tsx 對應 import + render 區段
commit 4:USDAsset 下拉 + USDStage tree 條件渲染(僅 ?debug=1)
commit 5:新增 EdgeConsoleLayout / TopBar / BottomEvidenceStrip 元件 + 套入 Window
commit 6:三段 ready 計算 helper + 顯示;DemoControlPanel 拆出 mapping verification
commit 7:跑 npm run build + verify scripts
```

PR diff 累積但每 commit 都可獨立驗證。

### D2. types/review.ts 擴充

```typescript
export interface ConversionQualityMetricsSummary {
  // 既有欄位:fixture_name / conversion_job_id / artifact_group_id /
  // source_ifc_entity_count / sidecar_carrier_count / materialization_strategy /
  // coverage_ratio / coverage_status / conversion_duration_seconds
  // 新增(C1 提供)
  semantic_mapping_fidelity?: string | null;
  mapping_has_ifc_type?: boolean | null;
  mapping_has_ifc_name?: boolean | null;
}

export type ReviewLifecycleStatus =
  | "created" | "active" | "closing" | "closed" | "failed"
  | "blocked_conversion" | "queued_for_instance"
  | "queued_for_conversion"    // 新(C4 對齊)
  | "dropped_on_restart";      // 新(C4 對齊)
```

### D3. 三段 ready 計算 helper

```typescript
// web-viewer-sample/src/utils/triReady.ts 或內聯到 Window.tsx
export type TriReadyState = "yes" | "no" | "incomplete";

export function computeFileReady(streamConfig: ReviewStreamConfig | null): TriReadyState {
  if (!streamConfig?.model) return "no";
  if (streamConfig.model.status === "ready" && streamConfig.model.url) return "yes";
  return "no";
}

export function computeRuntimeReady(
  webrtcLifecycle: string,
  stageLoadStatus: string,
): TriReadyState {
  if (webrtcLifecycle === "started" && stageLoadStatus === "matched") return "yes";
  if (webrtcLifecycle === "started" && stageLoadStatus === "pending") return "incomplete";
  return "no";
}

export function computeSemanticReady(
  summary: ConversionQualityMetricsSummary | null | undefined,
): TriReadyState {
  if (!summary) return "no";
  const hasFidelity = typeof summary.semantic_mapping_fidelity === "string"
    && summary.semantic_mapping_fidelity.length > 0;
  const hasType = summary.mapping_has_ifc_type === true;
  const hasName = summary.mapping_has_ifc_name === true;
  if (hasFidelity && hasType && hasName) return "yes";
  if (hasFidelity || hasType || hasName) return "incomplete";
  return "no";
}
```

### D4. EdgeConsoleLayout 元件結構

```
EdgeConsoleLayout
├─ TopBar (project_id · version · review_session_id · 3 ready 標籤)
├─ MainArea
│  ├─ Stream3DArea (既有 AppStream + stage-truth-panel)
│  └─ RightInspector
│     ├─ Section1 BindingPanel (本機資料包)
│     ├─ Section2 ConversionQualityPanel (轉檔品質,含 ConversionSummaryCard 升級)
│     ├─ Section3 MappingVerificationPanel (BIM 語意對照)
│     └─ Section4 TechnicalDetailsPanel (debug,折疊;?debug=1 展開)
└─ BottomEvidenceStrip (webhook | conversion | stage | WebRTC)
```

### D5. 刪除策略

- `ReviewLauncher`、`PresencePanel`、`ArchitectureOverview`:整檔刪除 + import 解除
- `DemoControlPanel` 內 collaboration / issue 試標 / Socket.IO log 區段:剪除;
  保留 mapping verification 操作但移到 MappingVerificationPanel
- `reviewSocket.ts` 殘留 collaboration handler:檢查 + 刪除(若存在)
- 注意:`remove-conflict-review-from-fast-mvp` 已先刪過大部分;這次補完

### D6. `?debug=1` 機制

```typescript
function isDebugQueryEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get("debug") === "1";
}
```

只控 UI 渲染(不改 fetch / event handler logic),debug 元件條件 render:

```tsx
{isDebugQueryEnabled() && <TechnicalDetailsPanel ... />}
```

### D7. Test strategy

- 新增 `verify-tri-ready-states.mjs`:fixture 三組 streamConfig(file only /
  file+runtime / all three),assert tri-ready label 對應
- 新增 `verify-edge-console-layout.mjs`:mount Window.tsx with mock state,
  assert TopBar / 4 層 Inspector / Bottom Evidence Strip 存在
- 既有 `verify-conversion-summary-card.mjs` 不破壞
- `npm run build`(tsc + vite build)通過
- `npm run verify`(若有)通過

### D8. Archive evidence gate

- 依賴 C1 + C4 merged + sync。Semantic ready 與 queued_for_conversion 顯示
  才有真資料源。
- Chrome E2E 在 archive 前驗證:從 coordinator `/ui` 開 viewer,人工驗證:
  - TopBar 顯示 project_id / version / session
  - 三段 ready 標籤對齊 stream_config 與 quality_metrics_summary
  - 沒 `?debug=1` 時 USDAsset / USDStage / DataChannel log 不可見
  - Inspector 四層按設計顯示;BottomEvidenceStrip 顯示 webhook / conversion /
    stage / WebRTC 四段
- 在 C1/C4 merge 前可先驗 `?debug=1` toggle 行為與三段 ready 計算邏輯(用
  mock data 跑 verify script)

## Risks

- Window.tsx 1,809 行,重排破壞 state machine / AppStream lifecycle 的風險;
  漸進 commit + 每 commit 跑 `npm run build` 緩解
- 三段 ready 計算的 source field 從 C1/C4 來,C1/C4 未 merge 前 viewer 仍會
  正確顯示 Semantic ready=no(因新欄位未填)
- 既有 verify-conversion-summary-card.mjs 若 hardcode 舊 ConversionQualityMetricsSummary
  欄位,擴 schema 後仍 backward compatible(新欄位 optional)
- `?debug=1` query 對 URL bookmark 影響:operator 開啟 `?debug=1` viewer 後
  仍可正常運作,只是多顯示 debug 區
