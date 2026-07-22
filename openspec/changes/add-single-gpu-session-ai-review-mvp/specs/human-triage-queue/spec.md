## ADDED Requirements

### Requirement: triage UI SHALL 為 accept/reject/edit 唯一轉正入口且 AI 無直建路徑

reviewer 開 console 疊加的 triage 頁（既有 dist-ui 體系，build:ui 交付）執行單筆/批量 accept・reject・edit 時，accept SHALL 經既有 issues store 寫入正式 issue；正式 issue 的建立/關閉/指派 SHALL 只能由人在此觸發，AI SHALL 無任何直建路徑。

#### Scenario: 批量 triage

- **WHEN** reviewer 批量 reject 低信心 30 筆、accept 3 個 parent
- **THEN** 正式 issues SHALL 淨增 3
- **AND** 操作者與時間戳 SHALL 入 ledger

### Requirement: 每筆 triage 操作 SHALL 記錄稽核 ledger 含 AI 版本標記與原始證據包

每筆 accept/reject/edit SHALL 記錄操作者、時間、AI 版本標記與原始證據包，以為未來 golden 基準集累積標註資料（MVP SHALL 只收集，不建門檻自動化）。

> Open Question OQ-6：ledger 與 draft store 的持久化落點須在 rebuild/`git clean -fdx` 洗除範圍外（掛載卷或 MinIO），否則一次 docker 重建即摧毀人審軌跡使法遵防禦歸零；重載後權威（檔案 vs 記憶體）須明確，見 proposal.md。

#### Scenario: 記錄一筆 accept

- **WHEN** reviewer accept 一筆 draft
- **THEN** ledger SHALL 記錄操作者、時間、AI 版本標記與原始證據包

### Requirement: draft store 併發一致性 SHALL 以單一寫入者加版本號 409 加欄位所有權保證零遺失

(a) 單一寫入者：draft store 所有變更（AI 重跑 ingest 與人審 accept/reject/edit）SHALL 一律經 coordinator store service in-process 序列化；atomic swap SHALL 僅為持久化機制，非併發控制。(b) per-draft 版本號：版本號 SHALL 存於檔內，提交比對不符 SHALL 回 409 要求重讀（optimistic lock，MVP 不做自動合併策略）。(c) 欄位所有權：AI SHALL 僅可寫 `evidence`/`last_seen`/`occurrence` 類欄位，SHALL NOT 觸碰已有 triage 狀態的人審欄位，違反即 fail-loud。AI 重跑與人審並行操作同一筆 draft 後，人審標註 SHALL 零遺失。

#### Scenario: 版本號衝突

- **WHEN** 提交時 per-draft 版本號比對不符
- **THEN** SHALL 回 409 要求重讀
- **AND** SHALL NOT 自動合併

#### Scenario: AI 觸碰人審欄位

- **WHEN** AI 重跑試圖寫入已有 triage 狀態的人審欄位
- **THEN** SHALL fail-loud 拒絕
- **AND** AI SHALL 僅能寫 `evidence`/`last_seen`/`occurrence` 類欄位

#### Scenario: 並行操作零遺失

- **WHEN** AI 重跑 ingest 與人審 accept/reject/edit 並行操作同一筆 draft
- **THEN** 所有變更 SHALL 經 in-process 序列化
- **AND** 人審標註 SHALL 零遺失
