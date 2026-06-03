# edge-console-operator-frontend — Spec Delta (frontend-coordinator-env)

> 對抗複驗 HIGH 部署 finding：console A1/A2/A3 治理 client 讀的 coordinator base env 名
> （`VITE_COORDINATOR_BASE`）與全站／部署正規名（`VITE_COORDINATOR_API_BASE`）不一致，
> 導致非預設 coordinator 部署下治理 client 讀不到值、fallback 寫死預設而全失效。
> 本 delta 規定 console 治理 client SHALL 用與全站／部署一致的 coordinator base env 名。

## ADDED Requirements

### Requirement: console A1/A2/A3 client SHALL 用與全站／部署一致的 coordinator base env 名

Edge Console 的治理 client（A1 rule-run、A2 diff、A3 federation，以及 Issue / BCF 操作）SHALL 以與全站 viewer 及部署鏈一致的正規環境變數名 `VITE_COORDINATOR_API_BASE` 取得 coordinator base，使其 coordinator base 來源與 viewer（`config/env.ts` 的 `reviewEnv.coordinatorApiBase`、AppStream / Window）同源。SHALL NOT 僅讀任何非正規、未被部署腳本 / compose 設定的 env 名（如僅讀 `VITE_COORDINATOR_BASE`）而在部署指向非預設 coordinator 時讀不到值。MAY 保留舊名 `VITE_COORDINATOR_BASE` 為相容 fallback，但正規名 SHALL 優先；未設定任一名時的預設 base SHALL 與 viewer 一致（`http://127.0.0.1:8004`）。

#### Scenario: 部署指向非預設 coordinator 時治理 client 連對位址

- **WHEN** 部署經 `VITE_COORDINATOR_API_BASE`（compose build-arg / `deploy.ps1` 的 `WEB_VIEWER_COORDINATOR_API_BASE`）設定非預設 coordinator base
- **THEN** console 的 A1/A2/A3 + Issue + BCF client SHALL 以該值為 coordinator base
- **AND** SHALL NOT fallback 到寫死預設 `http://127.0.0.1:8004`
- **AND** 其 coordinator base SHALL 與 viewer（AppStream / Window）取得的值同源（同一 env 名）

#### Scenario: 未設定時預設與 viewer 一致

- **WHEN** 環境未設定 `VITE_COORDINATOR_API_BASE` 亦未設定舊名 `VITE_COORDINATOR_BASE`
- **THEN** console 治理 client 的 coordinator base SHALL 為 `http://127.0.0.1:8004`
- **AND** 該預設 SHALL 與 `config/env.ts` 的 viewer coordinator base 預設一致

#### Scenario: 舊名相容但正規名優先

- **WHEN** 環境同時設定 `VITE_COORDINATOR_API_BASE` 與舊名 `VITE_COORDINATOR_BASE`
- **THEN** console 治理 client SHALL 採用正規名 `VITE_COORDINATOR_API_BASE` 的值
- **AND** 僅在正規名未設定時 SHALL 採用舊名 `VITE_COORDINATOR_BASE` 作為 fallback
