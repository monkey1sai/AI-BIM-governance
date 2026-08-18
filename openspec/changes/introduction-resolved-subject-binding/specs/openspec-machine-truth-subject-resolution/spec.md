## ADDED Requirements

### Requirement: sentinel row 的有效 subject 解析
machine-truth consumer（`resolveRowSubjectWatermark`，scripts/tests/verify-openspec-machine-truth.mjs）對 `subject_binding: "introduction"` 的 row SHALL 依下列全序解析有效 subject：(1) 若 `subject_commit` 是 checked-out HEAD 的 ancestor，有效 subject 為 `subject_commit` 自身（self-anchored，涵蓋 in-PR 剛 reconcile 的情境）；(2) 否則——無論該 SHA 於本機不存在、或存在但非 HEAD ancestor——一律以 #474 introduction 演算法解析：在 HEAD 歷史中對 `openspec/lifecycle-ledger.json` 以 `-S{subject_commit}` 蒐集 candidates，逐一驗證「該 revision 的 ledger 含 {id, subject_commit} binding 且其 parent 不含」，有效 subject 為唯一的 introduction commit。解析 SHALL 只依賴 HEAD 歷史、trusted base 與 ledger 內容，SHALL NOT 因本機殘留 branch refs 而改變結果（跨 clone deterministic）。

#### Scenario: 一次 squash-merge 後零 follow-up rebind（#589 驗收）
- Given 一筆於 PR 內以 sentinel reconcile 的 row（subject_commit = 當時 PR HEAD），該 PR 已 squash-merge 進 main，pre-merge SHA 已不存在
- When 於 main（HEAD = squash commit 之後）執行 verify CLI
- Then 該 row 的有效 subject 解析為引入該 binding 的 squash commit，無 `subject_unavailable`、無 `subject_not_ancestor`，且不需要任何 rebind PR

#### Scenario: in-PR self-anchored 評估
- Given PR branch 上 HEAD 為 C2，某 sentinel row 於較早的 branch commit C1 reconcile（subject_commit = C1，C1 為 C2 的 ancestor）
- When 於該 branch 執行 verify CLI
- Then 有效 subject 為 C1，C1..C2 之間對該 change owned sources 的變更照常以 `source_changed_since_subject` 紅旗（不因 sentinel 而嘗試 introduction 解析）

#### Scenario: 本機殘留 branch 不改變判定（determinism）
- Given main 上一筆 sentinel row，其 subject_commit 指向已被 squash 丟棄的 pre-merge SHA，但本機仍留有含該 SHA 的舊 branch（SHA 存在、非 HEAD ancestor）
- When 於 main 執行 verify CLI
- Then 解析結果與該 SHA 完全不存在的 clone（如 CI shallow clone）相同：走 introduction 解析並得到同一 squash commit（不得如 legacy row 般硬失敗 `subject_not_ancestor`）

### Requirement: 解析失敗一律 HELD（fail closed）
sentinel row 的 introduction 解析在下列任一情況 SHALL fail closed（丟出 `MachineTruthInputError`，報告 result 為 `input_error`、exit code 3；治理語彙記為 HELD），SHALL NOT round down 為警告或跳過：(a) candidates 超過 `MAX_INTRODUCTION_CANDIDATES`（32）；(b) 合法 introduction 多於一個（rebind-away-and-back 歧義）；(c) 找不到任何 introduction；(d) introduction 不是 trusted base 的 ancestor（candidate-minted binding）。

#### Scenario: rebind-away-and-back 歧義 fail closed
- Given 某 binding 曾被引入、改綁走、再以相同 {id, subject_commit} 重新引入（HEAD 歷史中有兩個 introduction commits）
- When 執行 verify CLI
- Then 解析 fail closed（HELD），不得任選其一而隱藏兩次引入間的 drift

#### Scenario: 未落地的 candidate-minted binding 被拒絕
- Given 某 sentinel row 的 binding 只在非 trusted-base-ancestor 的 commit 中被引入（例如本 PR 自己捏造的 binding）
- When 執行 verify CLI
- Then 解析 fail closed：introduction 的 trusted-base ancestry 檢查拒絕之（信任錨點沿用 #474 現行契約）

### Requirement: trusted base 的 origin/main ancestry 錨（防自我背書）
`assertGitBase` SHALL 補強：當 checkout 存在 `refs/remotes/origin/main` 時，`--base` SHALL 是該 ref 所指 commit 的 ancestor（含相等），否則以 `base_unavailable` class 硬失敗；無該 ref 的環境（如測試 fixture repos）維持現行為，且 CLI SHALL 以註解明文 `--base` 的殘餘信任邊界（caller 誠實屬 trust envelope）。此檢查 SHALL 對 legacy 與 sentinel rows 一體生效。

#### Scenario: --base=HEAD 自我背書被拒絕
- Given 攻擊者於自家 branch 鑄造 sentinel binding，並以 `--base` 指向該 branch tip（非 origin/main 歷史內的 commit）
- When 於含 `refs/remotes/origin/main` 的 checkout 執行 verify CLI
- Then `assertGitBase` 硬失敗，introduction 解析不被執行

#### Scenario: main 上的合法 post-squash run 不受影響
- Given 於 main checkout（HEAD 與 origin/main 同步）以 `--base` = main tip 執行
- When 執行 verify CLI
- Then base 檢查通過（ancestor 含相等），sentinel 解析照常進行

### Requirement: legacy row 行為零變更
無 `subject_binding` 欄位的 row SHALL 維持現行三分支行為：subject 為 HEAD ancestor → 直接使用；subject 不存在 → introduction 救援（#474 現行）；subject 存在但非 HEAD ancestor → `subject_not_ancestor` 硬失敗。本 change SHALL NOT 改變 legacy rows 在任何輸入下的判定（origin/main ancestry 錨屬 `--base` 輸入驗證，非 row 判定變更）。

#### Scenario: legacy exists-not-ancestor 仍硬失敗
- Given 一筆 legacy row，其 subject 存在於本機但非 HEAD ancestor
- When 執行 verify CLI
- Then 照舊以 `subject_not_ancestor` 硬失敗（sentinel 的行為差異僅限明確宣告的 rows）

### Requirement: drift 以有效 subject 為基準且 folded-squash 殘留限制明文保留
sentinel row 的 `source_changed_since_subject` SHALL 以解析後的有效 subject 為 diff 基準（`changedPathsSince(effective..HEAD)`），observation 識別仍用記錄的 `subject_commit`。deliberate residual limit SHALL 照舊明示於規格與程式註解：與 row 同一 squash 單位落地（folded-into-same-squash）的 source edits，僅由該 PR 自己的 pre-merge gate run 與 live task-count 比對把關，squash 後不可重推導，introduction 解析 SHALL NOT 宣稱涵蓋此類 edits。

#### Scenario: introduction 之後的編輯精準紅旗
- Given main 上一筆已解析為 introduction commit W 的 sentinel row，之後某 commit 修改了該 change 的 owned OpenSpec source
- When 執行 verify CLI
- Then 恰好該 row 產生 `source_changed_since_subject` mismatch，其他 rows 不受牽連

#### Scenario: folded edit 不紅旗（固定殘留限制邊界）
- Given 一筆 sentinel row 與其 owned source 的一筆編輯在同一個 squash commit 中一起落地
- When 於 main 執行 verify CLI
- Then 該編輯不產生 `source_changed_since_subject`（fixture 固定此預期行為，防止未來誤修或誤宣稱覆蓋）

### Requirement: 快取限單次執行 memoization（正確性護欄，非效能宣稱）
解析 SHALL 沿用既有的單次執行 memoization（cache key `${id}\n${subject_commit}`）作為同 run 內判定一致性的護欄；`resolveRowSubjectWatermark` 每 row 恰被呼叫一次，本 requirement SHALL NOT 被解讀為效能特性。跨執行的持久化快取 SHALL NOT 於本 change 引入；未來若引入 MUST 在使用前重新驗證 introduction 的存在性與 trusted-base ancestry，且 MUST NOT 以快取結果取代任何 fail-closed 判定。

#### Scenario: 跨執行快取不存在
- Given 兩次獨立的 verify CLI 執行，期間 HEAD 歷史被改寫（rebase）使同一 {id, subject_commit} 的 introduction 不同
- When 分別執行
- Then 兩次各自以當下 HEAD 歷史解析，第二次不得沿用第一次的結果

### Requirement: 容量常數聯合裁決且成長不得機械性爆表
`MAX_UNIQUE_SUBJECTS`（現 64）、全域 rawBudget（10,000 paths／2MB）與「budget 記帳是否移到 owned-path 過濾之後」SHALL 作為單一容量決策由 owner 簽核（proposal openQuestions #1）——per-watermark 的 `changedPathsSince` 對全 repo diff 收 budget，消耗與相異 watermark 數成正比，兩常數在 sentinel 終態下同時到期。裁決後的常數組合 SHALL 保證：ledger 於 row cap（500）內成長、sentinel rows 逐 change 保留獨立 watermark 時，不因 unique subject 數量或 budget 機械性觸發失敗；逐 git 呼叫 timeout 與 candidates cap 照舊生效。

#### Scenario: 大量 sentinel rows 不爆 budget（依裁決後常數）
- Given ledger 含超過 64 個相異 `subject_commit` 值（各 sentinel row 保留自己的 pre-merge SHA），總 rows 不超過 row cap
- When 執行 verify CLI
- Then 不因 unique subject 數量觸發失敗；裁決後的 budget 常數照舊生效且足以涵蓋本情境
