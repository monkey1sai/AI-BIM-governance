# host-native-conversion-authority-service Specification

## Purpose
TBD - created by archiving change introduce-host-native-conversion-authority-service. Update Purpose after archive.
## Requirements
### Requirement: Host-native conversion authority service exposes internal API

`bim-streaming-server` SHALL provide a host-native HTTP conversion authority service that can be started independently from the live Kit/WebRTC runtime. The service SHALL bind to `127.0.0.1:49101` by default, SHALL be addressable through `STREAMING_CONVERSION_API_BASE`, and SHALL expose `GET /health`, `POST /api/conversions/ifc-to-usdc`, `GET /api/conversions/{conversion_job_id}`, and `GET /api/conversions/{conversion_job_id}/result`.

#### Scenario: Service starts on the local conversion port

- **WHEN** the host-native conversion authority service is started with default development settings
- **THEN** `GET http://127.0.0.1:49101/health` returns a healthy service identity
- **AND** the response identifies `authority="bim-streaming-server"` and the service as conversion-only
- **AND** it MUST NOT claim WebRTC, Kit launcher, or viewport readiness

#### Scenario: Coordinator creates an internal conversion job

- **WHEN** `bim-review-coordinator` sends a valid internal conversion request to `POST /api/conversions/ifc-to-usdc`
- **THEN** the service returns `202`
- **AND** the response includes `conversion_job_id`, `status`, `authority="bim-streaming-server"`, `correlation_id`, and `idempotency_key`

#### Scenario: Internal token is enforced when configured

- **WHEN** the service is configured with an internal conversion token and clients are expected to send that configured value in the `X-Internal-Conversion-Token` request header
- **THEN** requests that omit `X-Internal-Conversion-Token` or provide a value that does not match the configured internal conversion token are rejected with `401` or `403`
- **AND** no conversion job is created for rejected requests

### Requirement: Host-native converter adapter publishes only validated artifacts

The host-native conversion authority service SHALL publish a ready result only when validated artifacts are present. If the primary PowerShell/Kit/HOOPS converter fails to import a locally readable IFC, the adapter MAY use an IfcOpenShell + OpenUSD fallback converter, but only when the fallback produces a real `model.usdc`, `element_mapping.json`, `entity_index.json`, `metadata.json`, and quality metrics derived from the source IFC. The fallback output MUST pass the same no-placeholder and openability gates as primary converter output.

#### Scenario: fallback converter produces publishable artifacts

- **WHEN** the primary converter fails with a source IFC import error
- **AND** the fallback converter successfully tessellates source IFC geometry and writes `model.usdc`
- **THEN** `GET /api/conversions/{conversion_job_id}/result` returns `status="succeeded"` or an explicitly allowed warning status
- **AND** `model.status="ready"`
- **AND** `artifacts.model_usdc.url`, `artifacts.element_mapping.url`, `artifacts.entity_index.url`, and metadata refs are present
- **AND** `quality_metrics.materialization_strategy="ifcopenshell_openusd_fallback"`

#### Scenario: fallback converter does not fabricate mappings

- **WHEN** a source IFC entity cannot be represented as a renderable USD prim by the fallback converter
- **THEN** the entity is reported as unmapped, sidecar-only, or omitted according to documented fallback policy
- **AND** the converter MUST NOT create fake GUID-to-prim mappings to inflate coverage
- **AND** `element_mapping.json` MUST identify `mock=false`

#### Scenario: final archive evidence requires real fallback success

- **WHEN** this OpenSpec change is considered for archive
- **THEN** the archived evidence MUST include a real runtime conversion of the user-provided or equivalent 341MB IFC that reaches ready conversion state
- **AND** unit-only or fake converter tests MUST NOT be sufficient archive evidence

### Requirement: Host-native conversion job state is durable enough for local evidence

The service SHALL persist local conversion job state and result metadata so smoke tests and coordinator result ingestion can query conversion outcome after initial dispatch. Persistence MAY be file-based for this MVP, but it MUST preserve `conversion_job_id`, request fingerprint, idempotency data, status, result refs, and error diagnostics.

#### Scenario: Job status remains queryable

- **WHEN** a conversion job has been accepted
- **THEN** `GET /api/conversions/{conversion_job_id}` returns the current job state
- **AND** the response includes enough identifiers for coordinator callback outbox and verification evidence

#### Scenario: Duplicate idempotency request replays the existing job

- **WHEN** the same idempotency key is sent with an equivalent request
- **THEN** the service returns the existing `conversion_job_id`
- **AND** it does not create a second active conversion job

#### Scenario: Conflicting idempotency request is rejected

- **WHEN** the same idempotency key is reused with a different IFC source or request fingerprint
- **THEN** the service rejects the request with a conflict response
- **AND** no new job is created

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

