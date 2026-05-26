## Context

C1 / C2 / C3 都對齊用同一份 `quality_metrics_summary` 欄位:

- C1(streaming):`quality_metrics.json` 含 `semantic_mapping_fidelity` 等
- C2(viewer):`computeSemanticReady(streamConfig?.quality_metrics_summary)`
- C3(coordinator `/ui`):`fetchQualitySummaryForJob` 取 stream-config 的同欄位

但 coordinator 自動 ingest 路徑沒 forward。實作 gap 集中在
`bim-review-coordinator/src/app.ts:821-834` `createReviewSessionFromIngest`:
`store.create(..., quality_metrics_summary: null)`。

`StreamingConversionResult.raw` 帶 streaming-server 完整 result body,包含
`quality_metrics` 物件(C1 已 ADD 三個 semantic 欄位)。

## Approach

### D1. types.ts 加 C1 三欄位(additive)

```typescript
export interface ConversionQualityMetricsSummary {
  // 既有
  fixture_name?: string | null;
  conversion_job_id?: string | null;
  artifact_group_id?: string | null;
  source_ifc_entity_count?: number | null;
  sidecar_carrier_count?: number | null;
  materialization_strategy?: string | null;
  coverage_ratio?: number | null;
  coverage_status?: string | null;
  conversion_duration_seconds?: number | null;
  // C1 提供
  semantic_mapping_fidelity?: string | null;
  mapping_has_ifc_type?: boolean | null;
  mapping_has_ifc_name?: boolean | null;
}
```

舊 consumer 不認新欄位也不會 break(全部 optional)。

### D2. 新 helper:從 conversion result 萃取 summary

`bim-review-coordinator/src/services/streamingConversionClient.ts` 或新增獨立
helper(優先放 streamingConversionClient 以共用 `StreamingConversionResult`
type):

```typescript
export function buildQualityMetricsSummary(
  result: StreamingConversionResult,
): ConversionQualityMetricsSummary | null {
  const quality = (result.raw?.quality_metrics ?? null) as Record<string, unknown> | null;
  if (!quality || typeof quality !== "object") return null;
  const num = (k: string) => (typeof quality[k] === "number" ? (quality[k] as number) : null);
  const str = (k: string) => (typeof quality[k] === "string" ? (quality[k] as string) : null);
  const bool = (k: string) => (typeof quality[k] === "boolean" ? (quality[k] as boolean) : null);

  const phaseTimings = (quality.phase_timings as Record<string, unknown> | null) ?? null;
  const conversionTotal =
    phaseTimings && typeof phaseTimings.conversion_total === "object"
      ? (phaseTimings.conversion_total as Record<string, unknown>)
      : null;
  const conversionDuration =
    conversionTotal && typeof conversionTotal.duration_seconds === "number"
      ? (conversionTotal.duration_seconds as number)
      : null;

  return {
    fixture_name: typeof result.raw?.original_filename === "string" ? (result.raw.original_filename as string) : null,
    conversion_job_id: result.conversion_job_id ?? null,
    artifact_group_id: typeof result.raw?.artifact_group_id === "string" ? (result.raw.artifact_group_id as string) : null,
    source_ifc_entity_count: num("source_ifc_entity_count"),
    sidecar_carrier_count: num("sidecar_carrier_count"),
    materialization_strategy: str("materialization_strategy"),
    coverage_ratio: num("coverage_ratio"),
    coverage_status: str("coverage_status"),
    conversion_duration_seconds: conversionDuration,
    semantic_mapping_fidelity: str("semantic_mapping_fidelity"),
    mapping_has_ifc_type: bool("mapping_has_ifc_type"),
    mapping_has_ifc_name: bool("mapping_has_ifc_name"),
  };
}
```

對齊 dev-console.html:1238 的 mapping 風格,且補 C1 三欄位 + `conversion_total`
phase timings(若有)。

### D3. createReviewSessionFromIngest 寫進 session

```typescript
const qualitySummary = buildQualityMetricsSummary(result);
const session = store.create({
  ...,
  quality_metrics_summary: qualitySummary,
});
```

helper 回 null 時 fallback 行為與既有 `null` 等價,不破壞既有 test。

### D4. Test strategy

vitest fixture(`bim-review-coordinator/tests/host-native-conversion-ingest.test.ts`
或新檔 `tests/quality-metrics-summary-forward.test.ts`):

- 給 fake conversion result `raw.quality_metrics` 含 C1 三欄位 + 既有欄位
- 觸發 ingest path(`POST /api/internal/conversions/<id>/ingest` 或 dispatch
  poll 完成)
- assert `GET /api/review-sessions/<sessionId>/stream-config` 回應的
  `quality_metrics_summary` 含全部欄位且值正確
- 加 negative test:result 無 `quality_metrics` → session.quality_metrics_summary
  仍 null,不破壞既有 backward compat

### D5. Archive evidence

- vitest 全綠
- Chrome MCP 重抓 viewer `[data-testid="tri-ready-semantic"]`:對既有 ready
  session 應由 `Semantic: no` 變成 `Semantic: yes`(若 C1 fallback 提供完整
  3 個 semantic 欄位)
- 不需要 GPU/Kit live evidence

## Risks

- helper transform 若漏轉某欄位,影響 viewer / `/ui` 三段 ready 計算 → test
  必須涵蓋每個欄位
- StreamingConversionResult.raw shape 為 Record<string, unknown>;type
  guard 必須 robust(本 change 用 typeof check 不依賴 specific class)
- 已 archived sessions 不會 retroactively 更新 quality_metrics_summary;只有
  新 ingest 後 created session 才有(spec 字面接受,non-goal 明列)
