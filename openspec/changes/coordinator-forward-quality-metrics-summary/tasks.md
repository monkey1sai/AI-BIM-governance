# Tasks — coordinator-forward-quality-metrics-summary

## 0. Setup

- [x] 0.1 Create branch `codex/openspec/coordinator-forward-quality-metrics-summary`
      from latest `main`.
- [x] 0.2 Inspect coordinator's existing `quality_metrics_summary` plumbing.
- [x] 0.3 Create OpenSpec scaffold(proposal / design / tasks / spec delta)。

## 1. Failing tests first

- [ ] 1.1 新增 `tests/quality-metrics-summary-forward.test.ts`(vitest):
      Scenario A(C1 三欄位 + 既有欄位 → stream-config 帶全)、Scenario B
      (phase_timings.conversion_total.duration_seconds → conversion_duration_seconds)、
      Scenario C(無 quality_metrics → summary=null,viewer Semantic 仍 no)。
- [ ] 1.2 跑 `npm test` → 三個新 test FAIL。

## 2. Implementation

- [ ] 2.1 修改 `src/types.ts`:`ConversionQualityMetricsSummary` 加
      `semantic_mapping_fidelity?` / `mapping_has_ifc_type?` / `mapping_has_ifc_name?`。
- [ ] 2.2 修改 `src/app.ts:88-94` `qualityMetricsSummarySchema` zod schema 加同欄位。
- [ ] 2.3 `src/services/streamingConversionClient.ts` 新增
      `buildQualityMetricsSummary(result): ConversionQualityMetricsSummary | null`。
- [ ] 2.4 修改 `src/app.ts` `createReviewSessionFromIngest`:把
      `quality_metrics_summary: null` 改成
      `quality_metrics_summary: buildQualityMetricsSummary(result)`。
- [ ] 2.5 `npm run build` 通過。

## 3. Verify

- [ ] 3.1 `npm test` 全綠(三新 + 既有)。
- [ ] 3.2 `npm run build` 通過。
- [ ] 3.3 `npm run verify` 通過。
- [ ] 3.4 `openspec validate coordinator-forward-quality-metrics-summary --strict`。
- [ ] 3.5 `openspec validate --specs --strict`。

## 4. Commit / PR

- [ ] 4.1 `git diff --cached --check`。
- [ ] 4.2 Commit:`feat(coordinator): auto-ingest 把 quality_metrics_summary forward 進 stream-config`。
- [ ] 4.3 Push branch + 開 PR(zh-TW)。

## 5. Archive(post-merge)

- [ ] 5.1 Sync local main。
- [ ] 5.2 `openspec archive coordinator-forward-quality-metrics-summary`。
- [ ] 5.3 Sync delta into `openspec/specs/conversion-webhook-lifecycle/spec.md`。
- [ ] 5.4 Update roadmap MD + HTML。
- [ ] 5.5 Re-run Chrome MCP viewer evidence:tri-ready-semantic 從 `no` 變 `yes`,
      存 `docs/evidence/2026-05-25-fast-mvp-edge-bim-server-console/c2-viewer-semantic-yes-after-forward.md`。
- [ ] 5.6 Closeout per `AGENTS.md`。
