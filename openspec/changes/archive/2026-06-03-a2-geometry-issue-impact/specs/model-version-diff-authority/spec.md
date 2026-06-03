# model-version-diff-authority — Spec Delta (a2-geometry-issue-impact)

> 對既有 capability `model-version-diff-authority` 新增 geometry_changed（opt-in）與 issue-impact。

## ADDED Requirements

### Requirement: diff SHALL 支援可選的 geometry_changed 偵測

`governance-service` 的 diff SHALL 支援以幾何比對偵測 `geometry_changed`。因 tessellation 較重，此 SHALL 為 opt-in（預設關閉）；啟用時 SHALL 用 ifcopenshell 幾何 signature（bbox / vertex count / volume）比對已配對構件，SHALL 對無幾何 representation 的構件安全略過（不誤判）。

#### Scenario: opt-in 啟用 geometry_changed

- **WHEN** diff 以 `include_geometry=true` 執行
- **THEN** 已配對且幾何 signature 不同的構件 SHALL 標 `geometry_changed`
- **AND** 無 representation 或無法 tessellate 的構件 SHALL 安全略過（geometry hash 為 null，不標變更）

#### Scenario: 預設不計算 geometry（誠實標示）

- **WHEN** diff 以 `include_geometry=false`（預設）執行
- **THEN** SHALL NOT 計算 geometry_changed
- **AND** SHALL 於 warnings 誠實標示 geometry 未計算（僅 placement/pset）

### Requirement: diff SHALL 提供與 Issue DB 交叉比對的 issue-impact

`governance-service` SHALL 能對一個 diff 計算 issue-impact：把本 diff 的變更構件（removed/moved/geometry_changed/property_changed）與 base model version 的 issue 以 `ifc_guid` 交叉比對，回報 `possibly_addressed` / `still_open` / `new`。`possibly_addressed` SHALL 明確標示為**啟發式**，SHALL NOT 自動把 issue 轉為 resolved。

#### Scenario: issue-impact 分類

- **WHEN** 對一個 base model version 有既有 issue 的 diff 計算 issue-impact
- **THEN** 其構件在本 diff 有變更的 issue SHALL 列為 `possibly_addressed`
- **AND** 其構件未變更的 issue SHALL 列為 `still_open`
- **AND** 有變更但無既有 issue 的構件 SHALL 計入 `new`
- **AND** 回應 SHALL 標明 `possibly_addressed` 為啟發式、需人工確認，SHALL NOT 自動轉 resolved
