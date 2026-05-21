## ADDED Requirements

### Requirement: Fast MVP runbook SHALL include hybrid Docker web-plane path

Fast MVP 文件 SHALL 描述 fast MVP 後的 hybrid path：Docker 只負責 coordinator/viewer web plane，host-native NVIDIA runtime 維持在 Docker 外。

#### Scenario: Operator 可以選擇 hybrid web-plane mode

- **WHEN** operator 閱讀 fast MVP 或 deployment runbook
- **THEN** runbook 必須把 hybrid Docker web-plane mode 列為 `bim-review-coordinator` 與 `web-viewer-sample` 的 supported single-machine path
- **AND** runbook 必須說明這個模式會啟動 containerized `8004` 與 `5173`
- **AND** runbook 必須說明 `49100` / `47998` / `49101` 維持 host-native

#### Scenario: Runbook 區分 hybrid readiness 與 Docker GPU Kit readiness

- **WHEN** runbook 描述 hybrid Docker web-plane mode 的驗證方式
- **THEN** runbook 必須明確說明 `8004` / `5173` container health 與 host-native bridge checks 成功，不等於滿足 `runtime-manager-docker-kit-mvp` GPU-container pass criteria
- **AND** runbook 必須說明 host-native Kit evidence 不得用來把 Docker GPU Kit readiness 標成 passed

#### Scenario: Runbook 文件化 localhost semantics

- **WHEN** runbook 描述 hybrid Docker web-plane mode 的 environment variables 或 compose overrides
- **THEN** runbook 必須區分 container-to-host URLs，例如 `host.docker.internal:49101`，以及 browser-visible Kit endpoints，例如 `127.0.0.1:49100`
- **AND** runbook 必須提醒 container-local `127.0.0.1` 與 browser/host `127.0.0.1` 不是同一個 network endpoint

#### Scenario: Runbook 文件化 OS-specific host bridge profiles

- **WHEN** runbook 描述 hybrid Docker web-plane mode
- **THEN** runbook 必須包含使用 `host.docker.internal` 的 Windows Docker Desktop profile
- **AND** runbook 必須包含使用 `host-gateway` 或 explicit host address 的 Linux Docker Engine profile
- **AND** runbook 必須說明 conversion service bind host、firewall 與 route 必須由 check helper 驗證，不能靠假設
- **AND** runbook 必須將 `0.0.0.0:8004` 標示為 LAN/single-machine exposure，而不是 public Internet exposure

#### Scenario: Runbook 文件化 conversion artifact output management

- **WHEN** runbook 描述已完成的 IFC→USDC conversion
- **THEN** runbook 必須說明 `storage/` 用於 source IFC fixtures，不是 default derived output store
- **AND** runbook 必須指出 host-native conversion artifacts root 與 per-job output layout
- **AND** runbook 必須列出 expected publishable files：`model.usdc`、`element_mapping.json`、`entity_index.json`、`metadata.json`
- **AND** runbook 必須說明 coordinator 與 cloud callback outbox 只攜帶 metadata refs
- **AND** runbook 必須說明如何選擇 `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`，使 artifact refs 對 consuming runtime 可見
- **AND** runbook 必須包含 demo artifacts 與 job state 的 operator cleanup note
