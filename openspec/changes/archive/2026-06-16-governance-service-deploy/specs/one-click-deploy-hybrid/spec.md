# one-click-deploy-hybrid — Spec Delta (governance-service-deploy)

## MODIFIED Requirements

### Requirement: Phase 4 嚴格依賴順序

deploy.ps1 SHALL 在 Phase 4 嚴格按 host-native governance-service → host-native conversion-service → host-native Kit → Docker web plane 順序啟動。Coordinator container 啟動時會代理 governance 與 conversion endpoints，因此 governance-service 與 conversion-service MUST 先於 Docker coordinator ready。

#### Scenario: Phase 4a 啟動 host-native governance-service

- **WHEN** deploy.ps1 未帶 `-SkipGovernance`
- **THEN** deploy.ps1 MUST 啟動 host-native `governance-service`，並以 `uvicorn app:app` 綁定 `127.0.0.1:<GovernancePort>`
- **AND** default `GovernancePort` MUST be `49102`
- **AND** deploy.ps1 MUST 等 `http://127.0.0.1:<GovernancePort>/health` 回 200；timeout 視為 stage=4a fail，退 4
- **AND** deploy.ps1 MUST set `HOST_GOVERNANCE_API_BASE=http://host.docker.internal:<GovernancePort>` for the Docker coordinator unless governance is skipped
- **AND** browser access MUST still go through coordinator `/api/governance/*`, not directly to `governance-service`

#### Scenario: -SkipGovernance explicitly opts out

- **WHEN** deploy.ps1 帶 `-SkipGovernance`
- **THEN** Phase 4a governance startup MUST be skipped
- **AND** deploy audit MUST record `governanceSkipped=true`
- **AND** deploy.ps1 MUST NOT set a Docker governance API base

#### Scenario: custom governance port refreshes Docker coordinator configuration

- **WHEN** deploy.ps1 receives `-GovernancePort <port>` or resolves a non-default governance port
- **THEN** dry-run audit MUST record the resolved governance port
- **AND** `HOST_GOVERNANCE_API_BASE` MUST use that port
- **AND** an already-running Docker web plane MUST be refreshed before post-verify so coordinator cannot keep stale governance proxy configuration
