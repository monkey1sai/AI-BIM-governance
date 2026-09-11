# spec-to-done-retirement Specification

## Purpose

定義 spec-to-done 退役後的現行工作流程契約：移除技能與 writer，舊入口零派工，新任務按 F/B/G 逐刀 PR 交付，保留歷史資料與共用安全驗證。

## Relationship to the pinned governance source

本規格明確取代 `openspec/specs/ai-coding-governance/spec.md` 中的 `spec-to-done agent routing SHALL have a single source of truth with a deterministic drift gate` Requirement 及其四個 Scenario；取代範圍只限已退役 workflow 的執行與 routing codegen。

原檔作為審查政策的 immutable 來源，保留 base `a0ab7065131914e548e1d79a1c683c8b14b07de4` 與 SHA-256 `27c687fff38b1f791565708090611114970a993bd3b126addf34829cc8e11168`。本退役規格不改動該來源 bytes、checker、source pin、review policy、counted approval、CODEOWNERS 或 main 保護；其餘 issue／PR evidence／remote enforcement Requirements 繼續適用。

## Requirements

### Requirement: Active workflow routing SHALL preserve deterministic drift checks after spec-to-done retirement

已退役的 spec-to-done 技能及 writer SHALL 不再可被 discovery 或用來派工。`std-plan.js`、`std-implement.js`、`std-evidence.js`、`std-evidence-closeout.js`、`plan-next-spec-to-done-aware.js`、`spec-to-done-adversarial-verify.js` SHALL 僅保留零派工相容入口，不再要求生成舊 ROUTING 區塊。仍啟用的 scanner workflow SHALL 繼續以 canonical `routing.json`、`scripts/gen_routing.py` 與 deterministic tests 保證路由不漂移；不得藉退役停用共用 gate。

#### Scenario: Retired workflows cannot dispatch or mutate state

- **GIVEN** 任一已退役 workflow 與任意輸入參數
- **WHEN** 呼叫相容入口
- **THEN** 它 SHALL 固定回傳 `retired_workflow` 與 `agentCallsUsed=0`
- **AND** SHALL 不呼叫 agent、不讀取執行 capability、不建立或追加 run state。

#### Scenario: Active scanner routing drift remains rejected

- **GIVEN** `routing.json` 與仍啟用 scanner 的 codegen ROUTING 區塊
- **WHEN** 區塊或 call-site tier 與 canonical routing 不一致
- **THEN** `scripts/gen_routing.py --check` SHALL exit non-zero，`tests/test_routing_consistency.py` SHALL fail。
- **AND** 已退役入口 SHALL 被 codegen 明確排除，退役行為由 `tests/test_spec_workflow_lean.mjs` 驗證。

#### Scenario: Historical readers do not restore an execution lane

- **GIVEN** 歷史 state、machine/Fabric contract 或 task-packet/v2 的 Lane S 資料
- **WHEN** 保留的 reader 執行格式驗證
- **THEN** SHALL 保留原有拒絕條件，且 SHALL NOT 授予 dispatch、resume、merge 或部署權限。
- **AND** 新任務 SHALL 使用 F/B/G；task-packet CLI 對含 S 的成功結果 SHALL 標示 `retired_lane_validation_only: true` 並維持 `authorization_granted: false`。

#### Scenario: Invalid model/effort combination is rejected before generation

- **GIVEN** `routing.json` declares `allowed_efforts` per model
- **WHEN** a tier declares a model+effort combination outside `allowed_efforts`
- **THEN** `scripts/gen_routing.py` SHALL raise and refuse to generate, so an illegal combination cannot reach a workflow script.
