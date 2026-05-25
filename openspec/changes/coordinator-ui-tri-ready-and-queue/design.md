## Context

`bim-review-coordinator/src/public/dev-console.html` 是 `/ui` runtime dashboard 的
後端 HTML 模板(vanilla HTML + inline CSS / JS,1,434 行)。fast-ifc-link-demo-loop +
fix-ifc-usdc-hoops-load-failure 已把 `/ui` 從 demo 操作頁升級為 closed-loop runtime
dashboard,顯示 IFC-ready intake / download / conversion / artifact / session /
Kit-WebRTC / viewer 等欄位。

但 2026-05-25 觀察筆記指出仍有三個缺口:
1. 沒有 File / Runtime / Semantic 三段 ready 分層,只有「conversion_status /
   download_status / model.status」分散欄位
2. 並發 POST 後的 dispatch queue(由 C4 落地)沒有可視化清單
3. Step 文案仍偏審查 demo;legacy `/api/assets` 沒有 disclaimer

## Approach

### D1. 三段 ready 計算規則(對齊 viewer)

```javascript
function computeFileReady(job) {
  // job 來自 GET /api/external/ifc-ready/:id
  if (!job?.download_status) return "no";
  if (job.download_status === "downloaded" &&
      job.conversion_status === "ready") return "yes";
  return "no";
}

function computeRuntimeReady(job, session) {
  // session 來自 review_session(若 spawned)
  if (!session) return "no";
  if (session.kit_instance_bindings?.length > 0 &&
      job?.viewer_url) return "yes";
  if (session.lifecycle_status === "queued_for_instance") return "incomplete";
  return "no";
}

function computeSemanticReady(qualitySummary) {
  if (!qualitySummary) return "no";
  const hasFidelity = typeof qualitySummary.semantic_mapping_fidelity === "string"
    && qualitySummary.semantic_mapping_fidelity.length > 0;
  const hasType = qualitySummary.mapping_has_ifc_type === true;
  const hasName = qualitySummary.mapping_has_ifc_name === true;
  if (hasFidelity && hasType && hasName) return "yes";
  if (hasFidelity || hasType || hasName) return "incomplete";
  return "no";
}
```

判定規則與 viewer `src/utils/triReady.ts` 一致;邏輯同 source(JavaScript inline 與
TypeScript util)。

### D2. Conversion Dispatch Queue section

新增區段顯示 dispatch queue 狀態:

```html
<section data-testid="dispatch-queue-section">
  <h3>② 產生本機 USDC 資料包 — Conversion Dispatch Queue</h3>
  <div class="queue-current">
    In-flight: <span data-field="queue-in-flight-job">—</span>
  </div>
  <ol class="queue-pending">
    <!-- queued jobs with queue_position -->
  </ol>
  <div class="queue-dropped" hidden>
    <strong>注意:</strong>coordinator restart 已丟棄佇列中尚未派工的 job。
    operator 須重新 POST(in-memory queue,非 disk-persistent)。
  </div>
</section>
```

資料源:`GET /api/external/ifc-ready` list,filter by `status`:
- in-flight = `status === "dispatched"` && `conversion_status` 仍是 `queued` /
  `running`(streaming-server 還沒 succeed)
- queued = `status === "queued_for_conversion"`(C4 lifecycle)
- dropped = `status === "dropped_on_restart"`

### D3. Step rename

把 dashboard 內 4 個 step header 改為:

```
① 接收 IFC-ready webhook
② 產生本機 USDC 資料包
③ 啟動 Kit / WebRTC 串流
④ 驗證 BIM 語意對照
```

不再使用「審查問題 / 標註 / 多人協作」字樣。

### D4. Legacy `/api/assets` disclaimer

既有 dashboard 有 legacy demo asset picker(或顯示區)。加 disclaimer:

```html
<div class="legacy-assets-disclaimer" data-testid="legacy-assets-disclaimer">
  <strong>注意:</strong>此區為 <code>/api/assets</code> 舊 demo asset,
  <strong>不代表</strong> 當前 session model。操作此區屬 debug 行為。
</div>
```

### D5. Test strategy

`bim-review-coordinator/tests/dev-console.test.ts` 加 vitest test:
- DOM presence:`data-testid="tri-ready-badges"` / `dispatch-queue-section` /
  `legacy-assets-disclaimer` 存在
- Step rename:HTML 含「① 接收 IFC-ready webhook」/「④ 驗證 BIM 語意對照」字樣
- 三段 ready 計算規則(inline JS):靜態 source-level grep 確認 `computeFileReady`
  / `computeRuntimeReady` / `computeSemanticReady` function 存在,且引用
  `mapping_has_ifc_type` / `mapping_has_ifc_name` / `semantic_mapping_fidelity`

### D6. Archive evidence gate

- `smoke-bscheme-intake.ps1` 一次完整 happy path → `/ui` 顯示三段 ready 標籤
- 並發 ifc-ready smoke(依賴 C4 merged):兩個並發 POST → `/ui` queue 區顯示
  queued / in-flight 區別
- legacy `/api/assets` 區帶 disclaimer 文字截圖
- 不需要 GPU / Kit live evidence

## Risks

- 三段 ready 計算規則漂移 — spec 必須 require coordinator inline JS 與 viewer
  TypeScript 用同一份欄位來源(`stream_config.quality_metrics_summary`)
- `/ui` 是後端 HTML 模板,test 用 DOM presence + source grep 驗證;不啟動 React
  renderer
- C1 / C4 未 merge 前,三段 ready 與 queue 區顯示仍會用「no」/「未取得」placeholder,
  spec 允許 incomplete 顯示
