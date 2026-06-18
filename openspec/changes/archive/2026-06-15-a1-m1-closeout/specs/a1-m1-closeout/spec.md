# a1-m1-closeout

## ADDED Requirements

### Requirement: `#/a1` SHALL 由整頁單一 reducer 驅動五步 stepper 且證據型更新

`A1GovernanceWorkbenchPage` SHALL 由整頁單一 reducer（`a1Machine`）驅動五步狀態機 `idle→picked→running→scored→issued→delivered`；步驟圓點樣式 SHALL 反映當前 state（已完成=綠勾、當前=綠圈、未到=灰，終態 `delivered` 五點皆綠勾）。state SHALL 只在伺服器確認後前進（證據型更新，SHALL NOT 樂觀更新）；任一步重跑 SHALL 清下游記分 state 但 SHALL NOT 清除已落地 artifact（已開 Issue 數等保留可見）。`#/a1` SHALL NOT 再內嵌 `IssuesRuleCenterPage`（其仍由 `#/issues` 路由獨立服務）。3D highlight SHALL 維持待建 disabled，SHALL NOT 提供假按鈕。

#### Scenario: 上傳完成自動亮步驟2

- **WHEN** operator 鎖定模型路徑（dispatch `PICK_FILE`）使 state 進 `picked`
- **THEN** stepper 第 1 點 SHALL 顯示已完成、第 2 點「自動檢核」鈕 SHALL enable（從 `idle` 的 disabled 轉為可按）

#### Scenario: 重跑檢核清下游但保留已開 Issue artifact

- **WHEN** state 已達 `issued`（`issueCount` 非空）後重新觸發檢核（dispatch `RUN`）
- **THEN** state SHALL 回到 `running`、`run`/`failed` 記分 SHALL 清空，且先前 `issueCount` artifact SHALL 保留可見

#### Scenario: 檢核失敗可重試不前進

- **WHEN** rule-run 流程失敗（dispatch `RUN_FAIL`）
- **THEN** state SHALL 留在 `running` 並標 `runError`、SHALL NOT 前進到 `scored`，且重試成功（`RUN_DONE`）後 `runError` SHALL 清回 false

### Requirement: governance-service SHALL 提供按規則分組、分頁、補樓層的 failures 端點

`GET /api/rule-runs/{run_id}/failures` SHALL 取既有失敗結果（內部 status `fail`）、依 `rule` query 過濾並以 `limit`/`offset` 分頁；因 `rule_results` 表未持久化 `ifc_name`/`ifc_type`/`storey`，端點 SHALL 開 IFC model 一次（per request）以 `by_guid` + `_spatial_chain` 補 `ifc_name`/`ifc_type`/`storey`。無容器構件 storey SHALL 降級 `null`（誠實，SHALL NOT 捏造）。未知 run SHALL 回 404。`/results`、`/export` 與 `get_results` 回傳形狀 SHALL 維持不變。

#### Scenario: 按規則分組與分頁

- **WHEN** 對已 succeeded 的 run 呼叫 `GET .../failures?rule=<code>&limit=1&offset=0`
- **THEN** 回傳 `items` SHALL 全屬該 `rule_code`、長度 SHALL ≤ 1，且 `total` SHALL 反映該規則過濾後總數

#### Scenario: storey enrichment 有 / 無容器降級

- **WHEN** 失敗構件指派於某 `IfcBuildingStorey`（如 `FL1`）vs 未指派任何樓層
- **THEN** 前者 `storey` SHALL 為該樓層名、後者 `storey` SHALL 為 `null`；每筆 SHALL 含 `ifc_guid`/`ifc_name`/`ifc_type`/`storey` 鍵

### Requirement: `#/a1` 記分板 SHALL 可逐規則展開命中構件含樓層

`#/a1` scored 步驟的記分板 SHALL 把失敗結果依 `rule_code` 聚合為「規則→失敗數」清單；每條失敗規則 SHALL 可點擊展開，懶載入分頁呼叫 `getFailures` 顯示命中構件的 `ifc_guid`+`ifc_name`+`storey`，GUID SHALL 可一鍵複製。失敗數為 0 的規則 SHALL NOT 出現於可展開清單（全過不可展開）。

#### Scenario: 展開失敗規則看 GUID / 名稱 / 樓層 + 複製

- **WHEN** operator 在記分板點擊某條失敗規則的展開 toggle
- **THEN** SHALL 懶載入並顯示該規則命中構件表（含 `ifc_guid`、`ifc_name`、`storey` 欄與 GUID 複製鈕），分頁超量時 SHALL 提供「載入更多」

#### Scenario: 全過規則不列入可展開清單

- **WHEN** rule-run 結果某規則零失敗
- **THEN** 該規則 SHALL NOT 出現於 `a1-failures-by-rule` 的可展開規則列
