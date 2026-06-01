# host-native-conversion-authority-service — Spec Delta (harden-host-native-conversion-service)

> Delta against `openspec/specs/host-native-conversion-authority-service/spec.md`。
> 本 delta 為 host-native conversion service hardening：補足 artifacts serving 防穿越、health 反映 converter preflight、placeholder 全檔掃描、storage sandbox root 顯式化四條外部可觀察行為要求。

## ADDED Requirements

### Requirement: Conversion artifacts SHALL be served through a per-job, traversal-safe route

host-native conversion authority service SHALL 以 per-job scoped route 提供 conversion artifacts，路徑形狀為 `/artifacts/{job_id}/{filename}`。Service MUST 把每個請求 resolve 後驗證仍落在 `artifacts_root/{job_id}` 之內（擋路徑穿越與跨 job 存取），對解析到 root 外、不存在、或非檔案的請求回 `404`。Service MUST NOT 以單一 static mount 把整個 `artifacts_root` 攤平對外，且 artifacts 路由的註冊失敗 MUST NOT 被靜默吞掉（不得以 broad `except: pass` 掩蓋）。

#### Scenario: Completed job artifact is retrievable

- **WHEN** 一個 conversion job 完成並產出 `model.usdc`
- **AND** client 對 `GET /artifacts/{job_id}/model.usdc` 發出請求
- **THEN** service SHALL 回 `200` 並回傳該檔案內容
- **AND** 既有 `_artifact_url` 產生的 URL 形狀（`/artifacts/{job_id}/{filename}`）SHALL 仍有效

#### Scenario: Path traversal attempt is rejected

- **WHEN** client 對 `/artifacts/{job_id}/{filename}` 帶入會 resolve 到 `artifacts_root` 之外的 `filename` 或 `job_id`（例如 `../`、`..\\`、絕對路徑、URL-encoded 變體）
- **THEN** service SHALL 回 `404`
- **AND** SHALL NOT 回傳 `artifacts_root` 以外的任何檔案內容

#### Scenario: Missing job or filename returns 404

- **WHEN** client 請求一個不存在的 `job_id` 或該 job 下不存在的 `filename`
- **THEN** service SHALL 回 `404`
- **AND** SHALL NOT 洩漏 `artifacts_root` 的目錄列表

### Requirement: Health endpoint SHALL reflect converter preflight readiness

`GET /health` SHALL 反映 converter 的實際 preflight 就緒狀態，而非硬寫健康。當 converter preflight 成功時，回應 SHALL 標 `status="ok"` 且 `ifc_to_usdc_conversion=true`；當 converter 未配置或 preflight 失敗時，回應 SHALL 標 `status="degraded"`、`ifc_to_usdc_conversion=false`，並帶可診斷的 `reason`。HTTP 狀態碼 SHALL 維持 `200`（health 為服務身分 introspection，非 liveness probe），且回應 MUST NOT 宣稱 WebRTC、Kit launcher 或 viewport 就緒。

#### Scenario: Converter ready reports ok

- **WHEN** host-native conversion service 啟動且 converter preflight 通過
- **AND** client 請求 `GET /health`
- **THEN** 回應 SHALL 含 `status="ok"` 與 `ifc_to_usdc_conversion=true`
- **AND** 回應 SHALL 維持 `authority="bim-streaming-server"` 的 conversion-only 身分

#### Scenario: Converter not ready reports degraded without lying

- **WHEN** converter 未配置（落到 headless / not-configured）或 converter preflight 拋出 `converter_unavailable`
- **AND** client 請求 `GET /health`
- **THEN** 回應 SHALL 含 `status="degraded"`、`ifc_to_usdc_conversion=false` 與診斷用 `reason`
- **AND** HTTP 狀態碼 SHALL 仍為 `200`
- **AND** service SHALL NOT 回報 `ifc_to_usdc_conversion=true`

### Requirement: Placeholder detection SHALL scan the full published artifact

publish gate 的 placeholder 偵測 SHALL 掃描完整的 `model.usdc`，不得只檢查檔案前綴（如僅前 4096 bytes），以免 placeholder 標記出現在偏移後被放行。Placeholder 標記集合 SHALL 來自單一 source of truth，由 converter adapter 與 publish store 共用同一份；偵測到 placeholder 時 SHALL raise `placeholder_usdc`，錯誤碼與既有 result 形狀保持不變。

#### Scenario: Placeholder marker beyond the prefix is still rejected

- **WHEN** 一個 `model.usdc` 在檔案前 4096 bytes 之後（例如 5KB 偏移）才出現 placeholder 標記
- **THEN** publish gate SHALL 偵測到並 raise `placeholder_usdc`
- **AND** 該 conversion SHALL NOT 被發布為 ready

#### Scenario: Legitimate USDC passes the gate

- **WHEN** 一個真實 `model.usdc` 全檔皆不含 placeholder 標記
- **THEN** publish gate SHALL 放行
- **AND** conversion 結果 SHALL 維持既有 ready 行為

### Requirement: Conversion sandbox root SHALL be explicit and never silently fall back to CWD

converter adapter 的 IFC path-traversal sandbox root SHALL 顯式來自 `STORAGE_ROOT` 設定。當 `STORAGE_ROOT` 未設且未由呼叫端顯式傳入時，adapter SHALL fail honest（建構或 preflight 時 raise `converter_unavailable`），MUST NOT 靜默 fallback 到 `Path.cwd()`。host-native 啟動腳本 SHALL 設定 `STORAGE_ROOT`，使正常啟動路徑具備明確 sandbox root。

#### Scenario: Missing STORAGE_ROOT fails honestly at startup

- **WHEN** host-native conversion service 在未設 `STORAGE_ROOT`（且未顯式傳入 storage_root）的情況下啟動 converter adapter
- **THEN** adapter SHALL 於建構或 preflight 時 raise `converter_unavailable`
- **AND** SHALL NOT 把 sandbox root 靜默退化為當前工作目錄

#### Scenario: Explicit STORAGE_ROOT bounds the sandbox

- **WHEN** `STORAGE_ROOT` 設為某 storage 目錄且 service 啟動
- **THEN** converter adapter 的 path-traversal guard SHALL 以該目錄為 sandbox root
- **AND** 任何 resolve 後落在該 root 之外的 `host_local_path` SHALL 被拒絕
