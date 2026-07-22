## ADDED Requirements

### Requirement: 兩層 fingerprint SHALL 兜底 GUID churn 且幾何 fallback 命中禁靜默 dedup

同一 IFC 模型連跑兩次審查時第二次 SHALL 產 0 筆新 draft，既有 draft SHALL 更新 `last_seen`；SHALL 沿用 repo `mw_` 前綴 hash 鍵 + ConversionLedger atomic swap 寫入。第一層（精確）SHALL 以 GUID 組合 + 規則 id 精確匹配。第一層 miss 時第二層（幾何 fallback）SHALL 以規則 id + 幾何量化位置 bucket 匹配，命中 SHALL 標記 `guid_churn_suspected`。標記 `guid_churn_suspected` 的第二層命中 SHALL 必路由人審確認，SHALL NOT 自動 suppress/dedup 為同一 finding（防兩個實為不同的 finding 因幾何量化落同 bucket 被誤併而隱藏真實新 finding）。

> Open Question OQ-1：真實 GUID churn 版本回跑（第一層全 miss、第二層全命中）下，suspected 命中是「新 draft」還是「掛既有 draft 的 merge-candidate」、以及 parent 級一鍵確認語意尚未定義，見 proposal.md。

#### Scenario: 同模型重跑

- **WHEN** 同一 IFC 模型連跑兩次審查
- **THEN** 第二次 SHALL 產 0 筆新 draft
- **AND** 既有 draft SHALL 更新 `last_seen`

#### Scenario: 幾何 fallback 命中

- **WHEN** 第一層精確匹配 miss、第二層幾何 bucket 命中
- **THEN** SHALL 標記 `guid_churn_suspected` 並路由人審確認
- **AND** SHALL NOT 自動 suppress/dedup

### Requirement: parent/child 收斂 SHALL 以寫死分群鍵把同鍵命中收斂為一 parent

分群鍵 SHALL 為 `(rule_id, sorted 涉事元素 GUID 集合)`；SHALL NOT 採距離/樓層/系統等啟發式分群。同鍵多命中去重時 SHALL 收斂為 1 parent + children，人審 SHALL 可對 parent 一鍵處置。若 R4.1 第二層幾何 fallback 啟用，分群鍵 SHALL 同步採 fallback 形式（`rule_id` + 幾何量化 bucket 集合）並沿用 `guid_churn_suspected` 人審路由，SHALL NOT 因分群而繞過人審確認。

#### Scenario: 同鍵多 clash 點收斂

- **WHEN** 同一對牆／管線之間 120 個 clash 點同鍵
- **THEN** 佇列 SHALL 顯示 1 parent（child 計數 120）
- **AND** 人審 SHALL 可對 parent 一鍵處置

### Requirement: resolved 延續與 reopen-candidate SHALL 只由人審 accept 觸發狀態轉換並產機器可讀差異報告

新模型版本重跑時 fingerprint 命中已 resolved 的 finding 且幾何已消解 SHALL NOT 重生 draft。fingerprint 命中已 resolved 的 finding 但幾何仍衝突時 SHALL 產 reopen-candidate draft（鏈結原正式 issue + 完整歷史鏈）進 triage 佇列。正式 issue 的 resolved→reopened 狀態轉換 SHALL 僅由人審 accept 該 candidate 觸發；人審 reject 則 SHALL 維持 resolved 並將決策入 ledger。AI SHALL 無任何直接把正式 issue 由 resolved 轉 reopened 的路徑。版本回跑收斂結束 SHALL 產出機器可讀的 resolved-candidate 差異報告（新增/持續/已消解/reopen 四類，JSON 結構化）。

#### Scenario: resolved 且幾何已消解

- **WHEN** 新版本重跑，fingerprint 命中已 resolved 的 finding 且幾何已消解
- **THEN** SHALL NOT 重生 draft

#### Scenario: resolved 但幾何仍衝突

- **WHEN** fingerprint 命中已 resolved 的 finding 但幾何仍衝突
- **THEN** SHALL 產 reopen-candidate draft（鏈結原正式 issue + 歷史鏈）進佇列
- **AND** 正式 issue resolved→reopened SHALL 僅由人審 accept 觸發，reject 維持 resolved 並入 ledger

#### Scenario: 版本回跑差異報告

- **WHEN** 版本回跑收斂結束
- **THEN** SHALL 產出機器可讀 resolved-candidate 差異報告
- **AND** 報告 SHALL 含新增/持續/已消解/reopen 四類 JSON 結構

### Requirement: fingerprint 容差 SHALL 由校準報告訂定且無校準報告不得上線

執行同模型 re-export 的版本對校準時 SHALL 產出 GUID 存活率與幾何容差曲線報告；R4.1 第二層幾何 bucket 大小 SHALL 引用該報告數值訂定，SHALL NOT 使用模糊詞。無校準報告則第二層 bucket 參數 SHALL NOT 上線（比照 Phase 0 硬 gate）。

#### Scenario: 有校準報告訂 bucket

- **WHEN** 對同模型 re-export 版本對執行校準
- **THEN** SHALL 產出 GUID 存活率與幾何容差曲線報告
- **AND** 第二層幾何 bucket 大小 SHALL 引用該報告數值且無模糊詞

#### Scenario: 無校準報告

- **WHEN** 尚無容差校準報告
- **THEN** 第二層幾何 bucket 參數 SHALL NOT 上線
