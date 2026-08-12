# agent-operability-governance — Spec Delta (align-ship-cycle-merge-ancestry)

## MODIFIED Requirements

### Requirement: Agent SHALL 對每個完成的 work item 走 buffered ship-cycle 自動化

Agent 完成一個可驗證的 work item 後 SHALL 依 `.claude/workflows/ship-item.md` 定義的 ship-cycle 自動 commit → push → 開 PR → 觀測 CI 與 reviewer comment → 在官方 gate（pr-review-agent + CodeRabbit）全綠且當前 head 無新 substantive P1/P2 時 merge（merge commit、non-squash，保留 lifecycle `subject_commit` ancestry）並 closeout。Agent SHALL NOT merge 過 production code 的真 P1/P2，SHALL NOT 偽裝 CI 綠；non-production 產物（evidence/docs scaffolding）的 advisory nit 在官方 gate 全綠時 MAY judgment-merge。

#### Scenario: 完成 work item 後自動 ship 並守 buffered gate

- **WHEN** agent 完成一個 work item 並 commit 到 feature branch
- **THEN** agent SHALL push、開 PR、`gh pr checks --watch` 等 CI、再留 ~90-120s reviewer buffer
- **AND** 僅在官方 gate 全綠且當前 head 無新 substantive P1/P2 時 SHALL merge（merge commit、non-squash，保留 lifecycle ancestry）並 closeout
- **AND** 有新 substantive 發現時 SHALL 修復並對每個 push 重跑 buffer cycle，SHALL NOT 只看 check 狀態就 merge

#### Scenario: 不 merge 過 production code 真 P1/P2

- **WHEN** reviewer 在 CI 變綠後對 production code 貼出新的 P1/P2
- **THEN** agent SHALL NOT merge，SHALL 先修復再重跑 ship-cycle
