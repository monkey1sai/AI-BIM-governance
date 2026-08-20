# openspec-machine-truth-reconcile-ratchet Specification

## Purpose
相對 trusted base 的 previous ledger，新 row 與被改寫 `subject_commit` 的 row 必須帶 `subject_binding: "introduction"`，或符合 P2b 精確 normalization。ratchet 只在 machine-truth comparator 執行面強制，不由 required PR CI 承擔語義。
## Requirements
### Requirement: 新寫入的 binding 永不懸空（ratchet）
verify CLI SHALL 以 trusted base 的 previous ledger（`previousLedgerAtBase`）為基準，對 base→head 的 row 差異強制：(a) **base 中不存在的新 row**——其 binding 必須帶 `subject_binding: "introduction"`，或 `subject_commit ∈ ancestry(trusted base)`（只可能把 watermark 錨在更舊的落地歷史，方向安全、只會多報 drift）；(b) **`subject_commit` 與 base 版本不同的被改寫 row**——其新 binding 必須帶 `subject_binding: "introduction"`，或新值**恰等於「base 版 binding 的 resolved introduction commit」**（以同一 #474 演算法解析驗證；此即 P2b opportunistic normalization 的精確機器定義）。兩者皆不滿足時 SHALL 以 fail-closed 硬錯誤 `subject_binding_required` 終止（error code 定案，`openspec-machine-truth-report.schema.json` enum 同步），SHALL NOT round down 為警告。

#### Scenario: legacy 式 rebind-to-PR-HEAD 被擋下
- Given 某 PR 將一筆 row 的 `subject_commit` 改寫為 PR HEAD（非 trusted base ancestor、非舊 binding 的 introduction）且未加 `subject_binding`
- When 執行 verify CLI
- Then 以 `subject_binding_required` fail closed

#### Scenario: 任意 base-ancestor rewrite 被擋下（drift laundering 封死）
- Given 某 PR 將一筆累積了 `source_changed_since_subject` 的 stale row，其 `subject_commit` 改寫為 trusted base tip（是 base ancestor，但不等於舊 binding 的 introduction commit），未加 sentinel
- When 執行 verify CLI
- Then 以 `subject_binding_required` fail closed（把 watermark 前移以無聲歸零累積 drift 的路徑機器不可行）

#### Scenario: P2b 精確 normalization 通過（並存性）
- Given 某 PR 將一筆懸空 legacy row 的 `subject_commit` 改寫為「該 row base 版 binding 的 resolved introduction commit」，未加 sentinel
- When 執行 verify CLI
- Then ratchet 通過（P2b opportunistic normalization 為合法過渡，本 change 不設落日），watermark 語義前後等價

#### Scenario: sentinel reconcile 通過
- Given 某 row 的 subject 改寫附帶 `"subject_binding": "introduction"`
- When 執行 verify CLI
- Then ratchet 通過，該 row 進入正常解析與 drift 計算

#### Scenario: 新增 row 同受 ratchet
- Given 某 PR 新增一筆 base 中不存在的 row，`subject_commit` 為 PR HEAD 且無 sentinel
- When 執行 verify CLI
- Then 以 `subject_binding_required` fail closed；加上 sentinel 後通過

### Requirement: in-PR reconcile 契約與 sentinel 相容
sentinel row 於 in-PR reconcile 時 SHALL 記錄 `subject_commit = PR HEAD` 作為 observation 錨點：既有「`--subject` 必須等於 checked-out HEAD」（`assertGitSubject`）、「`sourceObservations === null` 時所有 rows 的 subject 必須等於 trustedSubject」與「observation.subject_commit 必須等於 row.subject_commit」三項契約 SHALL 全部原樣保留；sentinel 欄位 SHALL NOT 放寬其中任何一項。被 reconcile 的 sentinel row 在該 run 內經 self-anchored 分支以 PR HEAD 為有效 subject，drift 歸零。

#### Scenario: reconcile 後同 run 收斂
- Given agent 於 PR HEAD H 將某 change 的全部 owned drift 修正並把該 row 以 sentinel reconcile 至 subject_commit = H
- When 於 H 執行 verify CLI
- Then 該 row 無 `source_changed_since_subject` mismatch，subject 等式契約全數滿足

#### Scenario: sentinel 不繞過 subject 等式
- Given `sourceObservations === null` 的呼叫路徑，且某 sentinel row 的 subject_commit 不等於 trustedSubject
- When 執行 `evaluateOpenSpecMachineTruth`
- Then 照舊以 `source_observation_invalid` fail closed（sentinel 不是等式契約的豁免）

### Requirement: ratchet 的邊界條件
previous ledger 於 trusted base 不存在（bootstrap-era）時，ratchet SHALL 不套用（該情境由既有 baseline 機制把關）；base 中已存在且本 PR 未改寫 `subject_commit` 的 rows（含現有全部 legacy rows）SHALL 免疫 ratchet——本 change SHALL NOT 強制任何一次性遷移。

#### Scenario: 未觸碰的 legacy rows 免疫
- Given 某 PR 只新增一筆 sentinel row，未觸碰其餘既有 legacy rows（多筆 subject 已懸空）
- When 執行 verify CLI
- Then ratchet 只審視被新增/改寫的 row；既有 rows 走各自的 legacy 解析路徑，不因 ratchet 產生新錯誤

#### Scenario: base 無 ledger 時不套用
- Given trusted base 上 `openspec/lifecycle-ledger.json` 不存在（previous ledger 為 null）
- When 執行 verify CLI
- Then 不執行 ratchet 檢查（沿用既有 bootstrap 基線行為），其餘驗證照常

### Requirement: 強制面誠實界定
ratchet SHALL 於 machine-truth comparator 的一切執行面生效：agent 端 evidence 迴圈（spec-to-done／std-evidence）、post-merge fixpoint 重驗、以及任何手動 CLI 執行。required PR CI SHALL NOT 承擔 ratchet 語義（openspec gate 維持 no-git 邊界為明示 non-goal）；PR CI 對 `subject_binding` 至多做 shape-only 值域驗證。不經 comparator 的手寫 ledger 編輯由 code review 與 post-merge fixpoint 兜底，本 change 的文件與主張 SHALL NOT 宣稱 required CI 強制 ratchet。

#### Scenario: 強制面聲明與機器現實一致
- Given `.github/` 下沒有任何 workflow 呼叫 verify CLI 對真實 ledger 執行 ratchet
- When 審視本 change 的文件主張與驗收條件
- Then 一切「機器不可行」表述均限定於 comparator 執行面，無一處宣稱 required CI 強制
