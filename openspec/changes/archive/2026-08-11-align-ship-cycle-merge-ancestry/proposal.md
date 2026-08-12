## Why

GitHub issue #451 回報 spec 與可執行 workflow 之間的 merge 契約矛盾：`openspec/specs/agent-operability-governance/spec.md`（`Agent SHALL 對每個完成的 work item 走 buffered ship-cycle 自動化` requirement，第 47 行與第 53 行）寫官方 gate 全綠時 SHALL **squash-merge**；但可執行的 `.claude/workflows/ship-item.md`（第 19 行、第 125 行）與 enforcing test `scripts/tests/test-agent-governance-check.ps1`（~875 行）都要求 `gh pr merge ... --merge --match-head-commit <preparedHead>`——即 non-squash merge commit，用以保留 lifecycle `subject_commit` 的 ancestry 可追溯性。三方對照下 spec 是過時、與現況行為不符的一方：workflow 與 enforcing test 互相一致，且 test 直接斷言 ship-item.md 不得含 `--squash --match-head-commit`。

本 change 僅把 spec 的措辭改回與可執行行為一致，不改變任何 runtime / workflow / test 行為。

## What Changes

- `openspec/specs/agent-operability-governance/spec.md`：修訂 `Agent SHALL 對每個完成的 work item 走 buffered ship-cycle 自動化` requirement 內兩處 `squash-merge` 措辭（requirement 本文一處、`完成 work item 後自動 ship 並守 buffered gate` scenario 一處）為 `merge`（merge commit、non-squash、保留 lifecycle ancestry），其餘措辭（官方 gate all-green 條件、不 merge 過 production 真 P1/P2、不偽裝 CI 綠、buffer cycle 規則）維持不變。

## Non-goals

- 不修改 `.claude/workflows/ship-item.md`（已正確，是可執行行為權威）。
- 不修改 `scripts/tests/test-agent-governance-check.ps1`（enforcing test，已正確；此檔屬 `scripts/lib/self-referential-bootstrap.ps1` 分類的驗證機制路徑，不在本 change 編輯範圍）。
- 不修改任何 production runtime 行為；本 change 純粹是 spec 文字對齊，修正 spec 落後於已落地行為的漂移。

## Impact

- Affected capabilities：`agent-operability-governance`（MODIFIED requirement）。
- Affected files：`openspec/specs/agent-operability-governance/spec.md`（經由本 change 的 spec delta 於 archive 時套用）。
- Product / runtime / deploy behavior：無。
- Git / PR workflow：無新行為；本 change 消除 spec 與既有 ship-cycle 執行/驗證行為之間的文字矛盾。
