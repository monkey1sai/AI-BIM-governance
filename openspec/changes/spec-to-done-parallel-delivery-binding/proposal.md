## Why

目前 Parallel Delivery Fabric 已允許任意數量、以獨立 branch／sibling worktree／touch-set 隔離的 session writer，但 `spec-to-done` 仍只保存單一 slug、worktree、branch 與 state identity，且沒有機器可驗的 Fabric lease／scope 綁定。若直接疊用，任務可能擴張 touch-set、不同切片碰撞同一 state，或在 HELD 後自行釋放／重建執行上下文，造成跨 session 無法收斂。

## What Changes

- 新增 Fabric-managed `spec-to-done` binding contract，將每個 run 綁定到 `plan_id`、`generation`、`task_id`、`lease_id`、`scope_digest`、baseline、branch 與 worktree identity。
- 明定 repo session admission 不設 writer 數量上限；`spec-to-done` 的單一 writer 限制只作用於一個 lease／task 切片內。
- 要求 `spec-to-done` 的 allowed paths 必須是 Fabric touch-set 的子集合，未知或越界一律 fail closed，不得自動擴張 scope。
- 為 Fabric-managed run 建立包含 task／lease identity 的唯一 durable-state path，避免同 slug 的平行切片互相覆寫。
- 明定 HELD 只停止該 run，lease 由 Fabric 保留並轉為 `SUSPECT`；未來恢復必須使用 exact tuple 的 Fabric-verified `RESUME_INTENT`，在 authority 啟用前維持 HELD，`spec-to-done` 不得自行釋放、重建或重置 lease。
- 同步 Claude 程序權威、Codex adapter、machine contract、validator 與 deterministic tests。

非目標：不啟用 `direct_stack`、自動 approve／merge／deploy，不修改 Fabric activation phase，不限制 repo 同時存在的 writer 數量，也不變更產品 API、資料、runtime 或服務邊界。

## Capabilities

### New Capabilities

- `spec-to-done-parallel-delivery-binding`: 定義 Parallel Delivery Fabric 外層 session control plane 與單一 `spec-to-done` delivery slice 之間的 machine-verifiable binding、scope、state 與 recovery 契約。

### Modified Capabilities

無。

## Impact

變更由 repo agent-governance/tooling surface 擁有，影響 `agent-contracts/spec-to-done.contract*.json`、`.claude/.codex` 的 `spec-to-done` adapter、對應 validator/helper、Fabric binding adapter、OpenSpec artifacts 與 deterministic tests。沒有產品 API、事件、storage、browser session、GPU runtime、部署流程或 production dependency 變更；historical lifecycle ledger 保持 byte-identical。
