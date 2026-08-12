# Tasks — align-ship-cycle-merge-ancestry

## 1. Spec delta

- [x] 1.1 於 `openspec/changes/align-ship-cycle-merge-ancestry/specs/agent-operability-governance/spec.md` 寫 `## MODIFIED Requirements`，完整重寫 `Agent SHALL 對每個完成的 work item 走 buffered ship-cycle 自動化` requirement 全文（含兩個既有 Scenario），把兩處 `squash-merge` 改為 `merge`（merge commit、non-squash、保留 lifecycle ancestry），其餘措辭不變。
- [x] 1.2 確認未觸碰 `.claude/workflows/ship-item.md`、`scripts/tests/test-agent-governance-check.ps1`、`openspec/changes/archive/` 既有內容。

## 2. 驗證與 archive

- [x] 2.1 `npx openspec validate align-ship-cycle-merge-ancestry --strict` 通過。
- [x] 2.2 `npx openspec archive align-ship-cycle-merge-ancestry` 落地 spec，確認 `openspec/specs/agent-operability-governance/spec.md` 兩處已改為 `merge`、grep 該 requirement 無 `squash-merge` 殘留。
- [x] 2.3 更新 `openspec/lifecycle-ledger.json` 新增本 change 的 archived row（欄位形狀比照既有 archived 範例）。
- [x] 2.4 跑 `node --test scripts/tests/test-openspec-machine-truth.mjs`、`node --test scripts/tests/test-ai-coding-metrics.mjs`、`scripts/tests/verify-openspec-lifecycle.ps1 -BaseRef origin/main`、`scripts/tests/test-openspec-lifecycle-archive-diff.ps1`、`scripts/tests/test-openspec-ledger-reconciliation.ps1`、`scripts/tests/test-agent-governance-check.ps1`，全綠或誠實回報。
