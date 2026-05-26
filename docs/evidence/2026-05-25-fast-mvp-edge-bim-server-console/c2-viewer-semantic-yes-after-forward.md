# PR #115 archive-closeout Chrome MCP evidence(2026-05-26)

> 對應 `coordinator-forward-quality-metrics-summary` archived,
> 驗證 forward 機制 + 暴露下一個 gap:streaming-server enumeration path 缺
> C1 semantic 欄位。

## 結論

**Forward 機制驗證:✅ 100% 工作**;Semantic=`yes` **未達成** — 因為 conversion
走 `usd_stage_enumeration` path,該 path 沒寫 C1 semantic 欄位(C1 spec 只
require fallback path 寫,enumeration / primary HOOPS 路徑未涵蓋)。

## Test session

- Docker coordinator rebuild + recreate from main(包含 PR #115)
- ifc_ready_job_id:`ifcready_1779762290442_6b9bbf1b`
- conversion_job_id:`stream_conv_20260526022453_73157f6b`
- review_session_id:`review_session_bbde95439429`
- IFC:`許良宇圖書館建築_2026 - 轉檔測試12.ifc`(89MB,via `http://host.docker.internal:8910`)

## A. coordinator stream-config response — forward 機制驗證

`GET /api/review-sessions/review_session_bbde95439429/stream-config` →
`quality_metrics_summary`:

```json
{
  "fixture_name": null,
  "conversion_job_id": "stream_conv_20260526022453_73157f6b",
  "artifact_group_id": null,
  "source_ifc_entity_count": 10872,
  "sidecar_carrier_count": 0,
  "materialization_strategy": "usd_stage_enumeration",
  "coverage_ratio": 0,
  "coverage_status": "warn",
  "conversion_duration_seconds": null,
  "semantic_mapping_fidelity": null,
  "mapping_has_ifc_type": null,
  "mapping_has_ifc_name": null
}
```

**PR #115 forward 邏輯生效**:
- ✅ `source_ifc_entity_count=10872` 從 result.raw.quality_metrics 抽到
- ✅ `materialization_strategy="usd_stage_enumeration"` 對應(streaming-server 真實值)
- ✅ `coverage_status="warn"` 對應(coverage_ratio=0,enumeration path 沒填 mapping count)
- ✅ `conversion_job_id` 對應
- ✅ 三個 C1 欄位明示為 null(不是 undefined),schema stable

**對比 archive 前(舊 PR #114 evidence)**:`quality_metrics_summary` 整個是
null(coordinator `createReviewSessionFromIngest` 直接 set null)。本 PR 之後
所有非 null 欄位都成功 propagate。

## B. viewer chrome MCP DOM 抓 — 三段 ready

```json
{
  "triReadyFile": "File: yes",
  "triReadyRuntime": "Runtime: yes",
  "triReadySemantic": "Semantic: no",
  "stageStatusClass": "stage-truth-panel stage-truth-panel--matched",
  "topbarProject": "project: project_e2e_semantic",
  "topbarVersion": "version: ver_e2e_semantic",
  "topbarSession": "session: review_session_bbde95439429"
}
```

- File=yes ✅
- Runtime=yes ✅(WebRTC started + stageLoadStatus=matched)
- Semantic=**no**(預期,見下方)
- TopBar 全綠(對齊 PR #108 Critical fix)

## C. 為什麼 Semantic 還是 no?

viewer `computeSemanticReady` 在 `web-viewer-sample/src/utils/triReady.ts`:

```typescript
const hasFidelity = typeof summary.semantic_mapping_fidelity === "string" && summary.semantic_mapping_fidelity.length > 0;
const hasType = summary.mapping_has_ifc_type === true;
const hasName = summary.mapping_has_ifc_name === true;
if (hasFidelity && hasType && hasName) return "yes";
if (hasFidelity || hasType || hasName) return "incomplete";
return "no";
```

三個 semantic 欄位都是 null:`hasFidelity=false` / `hasType=false`(`null !== true`)
/ `hasName=false` → return `no`。

**Forward 機制完全正確;真正的 gap 在 streaming-server**:
- C1 `streaming-server-fallback-semantic-mapping` 只動了
  `_run_ifcopenshell_openusd_fallback`(fallback path),寫
  `semantic_mapping_fidelity = "ifc_class_grouped_with_name"` 等
- 但 conversion 實際走 **`usd_stage_enumeration`** path(`_enumerate_usd_stage`
  /` _materialize_sidecars`)時,**沒寫**這三個欄位 → 即使 forward 100% 對,
  viewer 計算仍 no

實際看 conversion result:`materialization_strategy="usd_stage_enumeration"`
代表 primary HOOPS 沒拋 `A3D_LOAD_CANNOT_LOAD_MODEL`(89MB IFC HOOPS 可處理),
走 sidecar enumeration 補 element_mapping。這條 path 不在 C1 範圍。

## D. 下一個建議 OpenSpec change

`streaming-server-enumeration-semantic-mapping`:

- **Scope**:讓 `_materialize_sidecars` / `_enumerate_usd_stage` path 也寫
  `semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`
  (對齊 C1 fallback path)
- **Why**:fast MVP 真實 happy path(HOOPS 成功 + enumeration 補 sidecar)
  比 C1 fallback path 更常觸發,但 Semantic ready 永遠 no,demo 看不到綠
- **Capability**:`streaming-ifc-usdc-conversion-authority` ADD requirement
- 實作方向:`_materialize_sidecars` 讀 element_mapping items,若有 ifc_type
  / ifc_name 寫進 quality_metrics;或 `_enumerate_usd_stage` 拿 IFC parse 結果
  補欄位
- **Non-goals**:不改 C1 fallback 行為、不還原 HOOPS A3D primary support

## E. 整體結論

PR #115 達成它的 spec scope(forward 機制),但 **Semantic ready 全綠閉環**
需要另一個 change 接力。本 evidence 證明:
1. forward chain(streaming-server → coordinator ingest → session → stream-config
   → viewer)完全工作
2. C2 viewer `computeSemanticReady` 規則正確嚴格(不偽宣告)
3. 唯一剩餘 gap = streaming-server enumeration path 沒寫 semantic 欄位
