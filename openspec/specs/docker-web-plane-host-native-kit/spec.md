# docker-web-plane-host-native-kit Specification

## Purpose
定義 fast MVP 之後的 hybrid single-machine deployment：Docker 只承載 coordinator/viewer web plane，NVIDIA Kit/WebRTC 與 host-native conversion authority 留在作業系統上，並以可驗證的 health/check scripts 區分 web-plane readiness、host bridge readiness、artifact refs reachability 與 Docker GPU Kit readiness。
## Requirements
### Requirement: Docker web plane SHALL run without containerizing NVIDIA runtime

系統 SHALL 提供 hybrid single-machine deployment mode：Docker Compose 啟動 `bim-review-coordinator` 與 `web-viewer-sample`，而 `bim-streaming-server` Kit/WebRTC 與 host-native conversion authority 維持在 host operating system。

#### Scenario: Operator 只啟動 web plane containers

- **WHEN** operator 啟動 hybrid Docker web-plane mode
- **THEN** Docker Compose 必須啟動 `bim-review-coordinator` 與 `web-viewer-sample`
- **AND** 不得啟動 Docker GPU profile 的 `streaming-server` service
- **AND** 必須在 host port `8004` expose coordinator
- **AND** 必須在 host port `5173` expose viewer

#### Scenario: LAN profile publishes viewer on configured bind host

- **WHEN** operator 使用 LAN demo profile 啟動 hybrid Docker web-plane mode
- **THEN** viewer host port publish address MUST be configurable without source changes
- **AND** LAN profile MUST allow `VIEWER_BIND_HOST=0.0.0.0` or an equivalent explicit host bind
- **AND** local development MAY keep loopback binding when LAN exposure is not requested
- **AND** generated operator output MUST show the configured browser-visible coordinator and viewer URLs

#### Scenario: One-click deploy detects missing Kit runtime build artifacts

- **WHEN** operator runs hybrid deployment without `-SkipKit`
- **AND** `bim-streaming-server\_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat` or `kit\kit.exe` is missing
- **THEN** preflight MUST classify host-native Kit runtime as `NEEDS_BUILD`
- **AND** Phase 2 auto-fix MUST run `.\repo.bat build` from `bim-streaming-server`
- **AND** build failure MUST stop before Phase 4b and point to a persisted build log
- **AND** deploy MUST NOT wait for the Kit readiness timeout merely to discover that the runtime build artifacts are missing

### Requirement: Coordinator container SHALL bridge to host-native conversion authority

Coordinator container SHALL 透過 container-to-host bridge 呼叫 host-native conversion authority，而不是依賴 Docker-network `streaming-server` hostname。

#### Scenario: Coordinator container 可到達 host conversion health

- **WHEN** coordinator container 在 hybrid Docker web-plane mode 中執行
- **THEN** 它的 `STREAMING_CONVERSION_API_BASE` 必須解析到 host-native conversion authority
- **AND** 從 coordinator container 對 `${STREAMING_CONVERSION_API_BASE}/health` 發出的 health probe 必須到達 host service
- **AND** 回傳的 service identity 必須標示 `authority="bim-streaming-server"` 或等價 host-native conversion authority identity
- **AND** check output 必須標示 probe 使用的 active host bridge profile 或 explicit host address

#### Scenario: Linux host gateway profile 必須明確

- **WHEN** 在 Linux Docker Engine 使用 hybrid Docker web-plane mode
- **THEN** compose/runbook 必須透過 `host-gateway` 提供 `host.docker.internal`，或要求 explicit host address
- **AND** 當 loopback-only binding 無法被 Docker bridge 到達時，host-native conversion authority 必須 listen on reachable address
- **AND** 若無法到達 `49101`，必須回報可能 blocker 是 DNS、route、bind host 或 firewall

#### Scenario: Windows Docker Desktop profile 必須明確

- **WHEN** 在 Windows Docker Desktop 使用 hybrid Docker web-plane mode
- **THEN** runbook 必須優先使用 `host.docker.internal:49101` 進行 container-to-host conversion access
- **AND** 只有 health probe 證明 coordinator container 可達時，loopback-first host-native conversion binding 才能被接受
- **AND** failure 必須指示 operator 使用 explicit reachable bind host，或檢查 Docker Desktop host networking behavior

#### Scenario: 不要求 Docker GPU profile hostname

- **WHEN** Docker GPU profile 未啟用
- **THEN** coordinator container 不得要求 `http://streaming-server:49101` 存在
- **AND** `streaming-server` 無法解析不得阻擋 hybrid web-plane readiness

#### Scenario: Public exposure 不在 fast MVP 範圍

- **WHEN** coordinator 在 hybrid Docker web-plane mode 中 publish 為 `0.0.0.0:8004`
- **THEN** docs 必須把它描述為 LAN/single-machine exposure
- **AND** docs 不得把它呈現為 Internet-facing production endpoint
- **AND** cross-company 或 Internet exposure 必須另有 edge-security design，包含 TLS 或 mTLS、firewall allowlist 與 service-auth guidance

### Requirement: Stream config SHALL use browser-visible Kit endpoints

回傳給 `web-viewer-sample` 的 stream config SHALL 使用使用者 browser 可達的 endpoint values，而不是 container-local addresses。

#### Scenario: Local browser 收到 loopback Kit endpoint

- **WHEN** local single-machine browser 請求 review session stream config
- **THEN** 回傳的 Kit signaling endpoint 必須是 browser-visible 的 `127.0.0.1:49100`，或 explicit configured host address 與 signaling port
- **AND** 回傳 endpoint 不得使用 container-local `127.0.0.1`
- **AND** 回傳 endpoint 不得要求 browser 解析 Docker-only service names

#### Scenario: Deployed operator 設定 public host address

- **WHEN** hybrid web plane 部署在 browser clients 不在同一台機器的環境
- **THEN** operator 必須能設定 browser-visible Kit host address，而不需要修改 product source code
- **AND** coordinator stream config 必須使用該 configured host address 作為 viewer-facing Kit endpoint fields

#### Scenario: LAN runtime parameters are applied consistently

- **WHEN** operator sets a browser-visible LAN host such as `192.168.10.105`
- **THEN** coordinator redirect base, viewer coordinator API/socket bases, Kit signaling/media host fields, and artifact public base MUST be configurable from deployment parameters
- **AND** the deployed config MUST NOT silently mix LAN viewer URLs with `127.0.0.1` coordinator, Kit, or artifact URLs unless the consuming runtime is explicitly host-local
- **AND** runtime status or validation output MUST identify any remaining loopback value that would make a LAN client connect to itself

### Requirement: Hybrid validation SHALL distinguish web-plane readiness from GPU-container readiness

Hybrid validation SHALL 分別回報 Docker coordinator/viewer 與 host-native bridge 的 readiness，不得混同 Docker GPU Kit readiness。

#### Scenario: Hybrid health check 回報必要 tiers

- **WHEN** operator 執行 hybrid Docker web-plane check
- **THEN** check 必須驗證 host 可到達 `http://127.0.0.1:8004/health`
- **AND** check 必須驗證 host 可到達 `http://127.0.0.1:5173`
- **AND** check 必須驗證 coordinator-container 可到達 host-native `${STREAMING_CONVERSION_API_BASE}/health`
- **AND** 當預期 Kit runtime 正在執行時，check 必須驗證 host/browser-visible Kit signaling port `49100` 可達
- **AND** 當 succeeded conversion result 可用時，check 必須驗證 runtime-visible artifact refs

#### Scenario: Hybrid pass 不代表 Docker GPU Kit pass

- **WHEN** hybrid Docker web-plane checks pass
- **THEN** evidence 必須標示 runtime mode 是 hybrid web plane plus host-native runtime
- **AND** evidence 不得把 `runtime_image_kit_launcher` 標為 passed
- **AND** evidence 不得宣稱 Docker GPU profile readiness，除非 Docker GPU profile 已由自己的 capability 明確 build 並 validate

### Requirement: Host-native conversion artifacts SHALL have a documented storage boundary

Hybrid deployment SHALL 定義 completed IFC→USDC outputs 寫在哪裡、如何被 reference，以及哪個 service 擁有 lifecycle。

#### Scenario: Artifact refs 對 runtime 可見

- **WHEN** conversion result 包含 `model.usdc`、`element_mapping.json` 與 `metadata.json` refs
- **THEN** refs 必須使用 `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` 或等價 configured public artifacts base
- **AND** local single-machine refs 只有在 consuming runtime 位於同一 host 時才可以使用 loopback
- **AND** LAN 或 remote viewer deployments 必須設定 consuming runtime 可解析的 host 或 DNS name
- **AND** 若 refs 已產生但無法從 expected consumer perspective fetch，validation helper 必須回報 blocked

#### Scenario: LAN artifacts base is explicit

- **WHEN** operator enables LAN demo handoff
- **THEN** `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` MUST be set or derived to a URL reachable by the consuming Kit/runtime perspective
- **AND** `/ui` SHOULD surface the expected stage URL so operator can see whether it still points to client-loopback
- **AND** validation MUST NOT treat a ready conversion as browser-renderable until the expected stage URL has been proven loadable by Kit

### Requirement: Hybrid deployment SHALL preserve B-scheme boundaries

Hybrid Docker web-plane mode SHALL 保留 `AGENTS.md` 定義的 B-scheme ownership boundaries。

#### Scenario: External platform 維持在 runtime 外

- **WHEN** 使用 hybrid Docker web-plane mode
- **THEN** `_worker` 與 `_bim-control` 不得作為 product runtime services 啟動
- **AND** external IFC Worker behavior 必須繼續由 `tests/fakes` 或 explicit test clients 表示
- **AND** external company-cloud callback behavior 必須透過 coordinator callback outbox 或 test doubles 維持 metadata-only

#### Scenario: Service responsibilities 維持分離

- **WHEN** coordinator、viewer 與 host-native streaming runtime 在 hybrid mode 溝通
- **THEN** `bim-review-coordinator` 必須持續負責 IFC-ready intake、review sessions 與 callback outbox
- **AND** `bim-streaming-server` 必須持續負責 IFC→USDC conversion authority、Kit runtime、WebRTC 與 DataChannel scene operations
- **AND** `web-viewer-sample` 必須持續負責 browser UI 與 user interaction
