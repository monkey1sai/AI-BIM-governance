## Why

`viewer-edge-bim-server-console`(2026-05-25 archived,PR #108)落地後,viewer
`computeSemanticReady` 嚴格依 `stream_config.quality_metrics_summary` 的
`semantic_mapping_fidelity` / `mapping_has_ifc_type` / `mapping_has_ifc_name`
判定 Semantic ready。`/ui` 三段 ready badge 也依同欄位來源(C3 PR #109)。

`streaming-server-fallback-semantic-mapping`(2026-05-25 archived,PR #106)
fallback 已產出 `quality_metrics.json` 帶上述三欄位。但 coordinator 自動 ingest
streaming conversion 結果建立 review session 時(`createReviewSessionFromIngest`,
`bim-review-coordinator/src/app.ts:833`)直接 set `quality_metrics_summary: null`,
從不從 conversion result 萃取 quality summary。viewer / `/ui` 永遠拿到 null
summary,Semantic ready 永遠標 `no`。

2026-05-26 C2 viewer Chrome MCP evidence(`docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-chrome-mcp-evidence.md`)實測:即使 C1 fallback
已成功 + viewer 顯示 stage matched + WebRTC started,Semantic 仍 `no` — 因為
coordinator 沒把 quality summary forward。

## What Changes

- 修改 `bim-review-coordinator/src/services/streamingConversionClient.ts` 或
  抽新 helper:把 `StreamingConversionResult.raw.quality_metrics` 與相關欄位
  (`conversion_job_id` / `artifact_group_id` / `original_filename`)萃取成
  `ConversionQualityMetricsSummary`。
- 修改 `bim-review-coordinator/src/types.ts` 的 `ConversionQualityMetricsSummary`
  加 C1 已提供的三個欄位:
  - `semantic_mapping_fidelity?: string | null`
  - `mapping_has_ifc_type?: boolean | null`
  - `mapping_has_ifc_name?: boolean | null`
- 修改 `bim-review-coordinator/src/app.ts`:`createReviewSessionFromIngest`
  把萃取後的 summary 寫進 `store.create({ quality_metrics_summary })`,
  讓後續 `GET /api/review-sessions/:id/stream-config` 自動 forward。
- 既有 explicit `POST /api/review-sessions` caller(input.quality_metrics_summary
  從外部帶入)行為不變(此路徑已 forward)。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `conversion-webhook-lifecycle`:
  - ADD requirement「Coordinator forwards streaming conversion quality summary
    into review session stream-config」covering ingest path、欄位 mapping、
    backward-compat(missing quality_metrics 仍 null)、與 C1 三個 semantic
    欄位 propagation

## Impact

- Owner repo / folder:`bim-review-coordinator/src/`、`bim-review-coordinator/tests/`、
  `openspec/changes/coordinator-forward-quality-metrics-summary/`
- Runtime boundary:不改 streaming-server / viewer / callback outbox 邊界;純
  coordinator 內部 ingest 路徑補 forwarding。
- API:`GET /api/review-sessions/:id/stream-config` response shape 為 **additive**
  變更(原本 `quality_metrics_summary` 可能 null,此 change 後若 conversion
  result 帶 quality_metrics 則該欄位填入;既有 nullable schema 不變)。
- Data:`SessionStore` schema 已有 slot,不需 migration。
- Dependencies:無新增。
- Non-goals:
  - 不改 streaming-server 端 quality_metrics 內容
  - 不改 callback outbox metadata-only 原則(quality summary 已在 ingest 路徑,
    不需走 callback)
  - 不改 viewer / `/ui` 三段 ready 計算規則(C2 / C3 既有規則直接消費)
  - 不引入新 production dependency
