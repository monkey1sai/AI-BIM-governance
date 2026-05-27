## MODIFIED Requirements

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
