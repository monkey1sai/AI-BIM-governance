# openspec-lifecycle-ledger-schema Specification

## Purpose
`openspec/lifecycle-ledger.json` 的 change row 以 additive 選填欄位 `subject_binding: "introduction"` 宣告 introduction-resolved binding。缺席維持 legacy commit binding；`subject_commit` 仍是 40-hex watermark。`schema_version` 維持 v1。
## Requirements
### Requirement: subject_binding 選填欄位（introduction sentinel）
`openspec/lifecycle-ledger.json` 的 change row SHALL 允許一個選填欄位 `subject_binding`，其唯一合法值為字串 `"introduction"`。欄位缺席時該 row 為 legacy commit binding，語義與現行完全相同；欄位存在但值非字串 `"introduction"`（含 `null`、其他字串、非字串型別）時，schema 驗證 SHALL 以 `schema_invalid` fail closed。除 `subject_binding` 外，row 的任何未知鍵 SHALL 照舊 fail closed（exact-keys 演進為「十鍵基本形」與「十一鍵含 `subject_binding`」的雙形狀聯集）。

#### Scenario: sentinel row 通過雙 strict 驗證面
- Given ledger 中某 row 含 `"subject_binding": "introduction"`，且十個既有欄位齊備合法
- When 分別以 `validateLedgerShape`（scripts/lib/openspec-machine-truth.mjs）與 `scripts/tests/openspec-lifecycle-ledger.schema.json` 驗證
- Then 兩者皆接受該 row，不產生任何錯誤

#### Scenario: 非法 sentinel 值 fail closed
- Given 某 row 含 `"subject_binding": "commit"`（或 `null`、`0`、`"Introduction"` 等任何非 `"introduction"` 值）
- When 執行 schema 驗證
- Then 驗證以 `schema_invalid` 失敗，錯誤 field 指向該 row 的 `subject_binding`

#### Scenario: 其他未知鍵仍被拒絕
- Given 某 row 除十一個合法鍵外另含未知鍵 `"note"`
- When 執行 schema 驗證
- Then 驗證以 `schema_invalid` 失敗（sentinel 欄位不是開放 row 擴充的先例）

#### Scenario: 既有 legacy rows 完全不受影響
- Given 現行 ledger 的全部既有 rows（皆無 `subject_binding` 欄位）
- When 執行更新後的兩個 strict 驗證面
- Then 全數通過，判定與變更前一致，不要求任何遷移

#### Scenario: previous（base）ledger 同受雙形狀支援（two-phase 危險窗封口）
- Given trusted base 的 previous ledger 含合法 sentinel row（第二波之後的常態）
- When 更新後的 `validateLedgerShape` 以 `previous_ledger` 身分驗證之
- Then 驗證通過；本 requirement 落地前 SHALL NOT 於 main ledger 寫入任何 sentinel row（落地順序見 design 決策 4 危險窗）

### Requirement: subject_commit 維持 40-hex binding watermark
sentinel row 的 `subject_commit` SHALL 仍受 `COMMIT` regex（`/^[0-9a-f]{40}$/`）約束，記錄 reconcile 當下的 PR HEAD SHA，語義降級為 binding watermark（{id, subject_commit} pair 的識別鍵與 `git log -S` 搜尋 needle），不再承諾該 commit 於未來任何 clone 中存活或可達。`subject_commit` SHALL NOT 允許任何 sentinel 字面值或全零 SHA。

#### Scenario: sentinel row 的非法 subject_commit 被拒絕
- Given 某 row 帶 `"subject_binding": "introduction"` 且 `subject_commit` 為 `"introduction"` 或大寫 hex 或 39 位 hex
- When 執行 schema 驗證
- Then 驗證以 `schema_invalid` 失敗，錯誤 field 指向 `subject_commit`

### Requirement: source_observations 契約零變更
`source_observations` 的 exact keys SHALL 維持 `['change_id', 'subject_commit', 'changed_paths']`，且 observation 的 `subject_commit` SHALL 仍必須通過 `COMMIT` regex 並等於對應 ledger row 的 `subject_commit`（sentinel row 亦然——observation 以記錄的 watermark 鍵定錨，而非以解析後的有效 subject 定錨）。

#### Scenario: sentinel row 的 observation 等式不放寬
- Given 一筆 sentinel row 與一筆 `subject_commit` 不等於該 row `subject_commit` 的 source observation
- When 執行 `evaluateOpenSpecMachineTruth`
- Then 以 `source_observation_invalid` fail closed，與 legacy row 行為一致

### Requirement: schema_version 維持 v1 且 PR CI gate 無需語義變更
本演進 SHALL 為 additive：`schema_version` 維持 `openspec-lifecycle-ledger/v1`，不得 bump——additive 選填欄位風險嚴格較低，且 PR CI gate（`scripts/lib/openspec-repository-lifecycle.mjs`）硬釘 v1，bump 迫使同 PR 觸碰另一 mechanism surface 而零收益。該 gate 對 row 僅驗 `id` 與 `status` 的寬容解析行為 SHALL 以回歸測試釘住；gate 若增加 `subject_binding` 驗證，SHALL 僅限 shape-only 值域檢查（no-git 邊界不變）。

#### Scenario: PR CI gate 接受 sentinel ledger
- Given 一份含至少一筆 sentinel row 的合法 ledger
- When 以 `parseLifecycleLedger` 解析
- Then 解析成功並回傳全部 rows 的 id/status，不因 `subject_binding` 產生任何錯誤

#### Scenario: 版本字串遭 bump 時測試失敗
- Given 有人將 ledger 的 `schema_version` 改為 v1 以外的值
- When 執行 gate 與 strict 驗證面
- Then 兩者皆以版本錯誤拒絕（防止經由版本 bump 繞過 additive 約束）
