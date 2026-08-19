# a4-semantic-search Specification

## Purpose
TBD - created by archiving change a4-console-convergence. Update Purpose after archive.
## Requirements
### Requirement: Canonical A4 UI SHALL 可操作且接受誠實的 design gate

`#/workspace?dock=a4` SHALL 是 canonical production A4 surface，並 SHALL render 真實 session-scoped API flow。Legacy `#a4`、`#/a4` 與 `#semantic-search` SHALL 在保留 valid session context 下 redirect 到 canonical dock，或在 caller migration 後移除；它們 SHALL NOT mount 第二套 fixture/live implementation。

Canonical surface SHALL 提供 visible idle、source/session unavailable、loading、success、empty、uninterpreted、semantic error、retrying、retry-failed 與 proof-expired-draft-preserved states。它 SHALL 顯示 validated filters、interpretation source、model/degradation status、Evidence Trace 與 mapped/unmapped/truncated counts。Fixed result counts、fabricated law citations 與 fake success states SHALL NOT 出現在 live flow。Console SHALL NOT host WebRTC/video 或送 DataChannel message。

本 change 的 scope 限於前後端收斂：後端契約（response 上限常數、`degraded_to_deterministic`、session-bound issue 持久化、handoff backend）SHALL 以 `origin/main` 為基準不得回退；前端 Console 結構與 session binding SHALL 以 convergence 分支的 live session-scoped 實作為基準。收斂 SHALL NOT 改變既有對外 response shape，且 SHALL NOT 觸碰凍結面（`governance-service/app.py`、`bim-streaming-server/conversion_authority.py`、`bim-review-coordinator/src/routes/governanceProxy.ts`）。

本 change SHALL NOT 宣稱 A4 semantic 或 full completion：design rebaseline、Windows Chromium pixel/semantic gates、Playwright coverage、Kit runtime evidence 與 live Ornith smoke 仍屬 deferred 母版，未於本 change 交付者 SHALL 於 PR body 以 `Full completion claimed: no` 與 known gaps 誠實揭露。

**備註（決策原因）:** 兩個獨立 A4 實作分別停在不同分支，會讓 `main` 長期只有 fixture 版 Console，而未合併分支的前端因後端契約已演進而無法單獨運作。先收斂成單一可運作實作，才能讓後續 evidence gates 有唯一的驗證對象；把 evidence gates 留在母版則避免在環境未就緒時偽造完成證據。

#### Scenario: Canonical route 呈現 live states 而非 fixture counts

- **GIVEN** browser 具有 valid active Review Session
- **WHEN** operator 開啟 `#/workspace?dock=a4` 並執行 query
- **THEN** UI SHALL 呼叫 session-scoped A4 API，render returned `query_id`、filters、stats 與 evidence
- **AND** SHALL NOT render fixed `5 / 7`、fabricated citations 或 local-only success

#### Scenario: Legacy A4 routes 不得保留第二套 implementation

- **WHEN** operator 開啟 `#a4`、`#/a4` 或 `#semantic-search`
- **THEN** frontend SHALL 在保留 valid session context 下 redirect/converge 到 `#/workspace?dock=a4`
- **AND** legacy route SHALL NOT mount separate A4 state、fixture 或 API client behavior

#### Scenario: Empty 與 error states 提供 truthful recovery

- **WHEN** query 回 zero matches、無法 interpretation、失去 session binding 或收到 semantic/runtime error
- **THEN** UI SHALL render distinct state、cause 與 next action
- **AND** retryable states SHALL 提供保留 explicit user input 的 Retry action
- **AND** retry SHALL NOT silently change `interpret_mode` 或 filters

#### Scenario: 收斂不得回退 main 既有後端契約

- **GIVEN** `origin/main` 已具備 response 上限常數、`degraded_to_deterministic` 欄位與 session-bound issue 持久化
- **WHEN** convergence 分支的前端被移植進來並解衝突
- **THEN** 上述後端行為 SHALL 維持不變，既有 response shape SHALL NOT 改變
- **AND** 收斂後的 governance-service 與 coordinator 測試通過數 SHALL NOT 低於收斂前的 baseline

#### Scenario: 未交付的 evidence gates SHALL 誠實標示為未完成

- **WHEN** 本 change 提交 PR
- **THEN** PR body SHALL 標示 `Full completion claimed: no`
- **AND** SHALL 列出未涵蓋範圍（design rebaseline／pixel/semantic gates、Playwright coverage、Kit runtime evidence、live Ornith smoke、session auth principal 與 lease 綁定）仍屬 deferred 母版
- **AND** SHALL NOT 以隔離 alt-port stack 的 runtime evidence 推論 design gate 或 semantic completion 已通過
