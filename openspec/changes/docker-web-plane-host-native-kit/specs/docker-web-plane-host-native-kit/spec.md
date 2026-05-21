## ADDED Requirements

### Requirement: Docker web plane SHALL run without containerizing NVIDIA runtime

The system SHALL provide a hybrid single-machine deployment mode where Docker Compose starts `bim-review-coordinator` and `web-viewer-sample`, while `bim-streaming-server` Kit/WebRTC and host-native conversion authority remain on the host operating system.

#### Scenario: Operator starts only the web plane containers

- **WHEN** the operator starts the hybrid Docker web-plane mode
- **THEN** Docker Compose SHALL start `bim-review-coordinator` and `web-viewer-sample`
- **AND** it SHALL NOT start the Docker GPU profile `streaming-server` service
- **AND** it SHALL expose coordinator on host port `8004`
- **AND** it SHALL expose viewer on host port `5173`

#### Scenario: Coordinator container binds externally in Docker mode

- **WHEN** the coordinator runs as a container in hybrid Docker web-plane mode
- **THEN** the container process SHALL bind `0.0.0.0` on port `8004`
- **AND** Docker SHALL publish host port `8004` to the coordinator container
- **AND** host or LAN clients SHALL be able to reach `http://<host-address>:8004/health` when OS firewall and network policy allow it
- **AND** external IFC-ready API access SHALL still require configured service auth and allowlist controls

#### Scenario: Host-local coordinator remains loopback by default

- **WHEN** `bim-review-coordinator` is started directly on the host without explicitly setting `HOST`
- **THEN** it SHALL bind loopback by default instead of `0.0.0.0`
- **AND** exposing it beyond loopback SHALL require an explicit operator setting such as `HOST=0.0.0.0`

#### Scenario: NVIDIA runtime remains host-native

- **WHEN** hybrid Docker web-plane mode is used
- **THEN** `bim-streaming-server` Kit/WebRTC SHALL remain a host-native runtime
- **AND** WebRTC signaling SHALL remain browser-visible on port `49100`
- **AND** the media stream port SHALL remain browser-visible on port `47998` unless explicitly configured otherwise
- **AND** host-native conversion authority SHALL remain reachable on port `49101`

### Requirement: Coordinator container SHALL bridge to host-native conversion authority

The coordinator container SHALL call the host-native conversion authority through a container-to-host bridge instead of a Docker-network `streaming-server` hostname.

#### Scenario: Coordinator container reaches host conversion health

- **WHEN** the coordinator container is running in hybrid Docker web-plane mode
- **THEN** its `STREAMING_CONVERSION_API_BASE` SHALL resolve to the host-native conversion authority
- **AND** a health probe from inside the coordinator container to `${STREAMING_CONVERSION_API_BASE}/health` SHALL reach the host service
- **AND** the returned service identity SHALL identify `authority="bim-streaming-server"` or an equivalent host-native conversion authority identity
- **AND** the check output SHALL identify the active host bridge profile or explicit host address used for the probe

#### Scenario: Linux host gateway profile is explicit

- **WHEN** hybrid Docker web-plane mode is used on Linux Docker Engine
- **THEN** the compose/runbook SHALL provide `host.docker.internal` through `host-gateway` or require an explicit host address
- **AND** the host-native conversion authority SHALL listen on an address reachable from the Docker bridge when loopback-only binding cannot be reached
- **AND** failure to reach `49101` SHALL report whether DNS, route, bind host, or firewall is the likely blocker

#### Scenario: Windows Docker Desktop profile is explicit

- **WHEN** hybrid Docker web-plane mode is used on Windows Docker Desktop
- **THEN** the runbook SHALL prefer `host.docker.internal:49101` for container-to-host conversion access
- **AND** loopback-first host-native conversion binding SHALL be accepted only when the health probe proves it reachable from the coordinator container
- **AND** failure SHALL instruct the operator to use an explicit reachable bind host or verify Docker Desktop host networking behavior

#### Scenario: Docker GPU profile hostname is not required

- **WHEN** the Docker GPU profile is not enabled
- **THEN** the coordinator container SHALL NOT require `http://streaming-server:49101` to exist
- **AND** failure to resolve `streaming-server` SHALL NOT block hybrid web-plane readiness

#### Scenario: Public exposure is outside fast MVP scope

- **WHEN** coordinator is published as `0.0.0.0:8004` in hybrid Docker web-plane mode
- **THEN** the docs SHALL describe this as LAN/single-machine exposure
- **AND** the docs SHALL NOT present it as an Internet-facing production endpoint
- **AND** cross-company or Internet exposure SHALL require a separate edge-security design with TLS or mTLS, firewall allowlist, and service-auth guidance

### Requirement: Stream config SHALL use browser-visible Kit endpoints

The stream config returned to `web-viewer-sample` SHALL use endpoint values that are reachable by the user's browser, not container-local addresses.

#### Scenario: Local browser receives loopback Kit endpoint

- **WHEN** a local single-machine browser requests a review session stream config
- **THEN** the returned Kit signaling endpoint SHALL be browser-visible as `127.0.0.1:49100` or an explicitly configured host address and signaling port
- **AND** the returned endpoint SHALL NOT use a container-local `127.0.0.1`
- **AND** the returned endpoint SHALL NOT require the browser to resolve Docker-only service names

#### Scenario: Deployed operator configures public host address

- **WHEN** the hybrid web plane is deployed where browser clients are not on the same machine
- **THEN** the operator SHALL be able to configure the browser-visible Kit host address without changing product source code
- **AND** coordinator stream config SHALL use that configured host address for viewer-facing Kit endpoint fields

### Requirement: Hybrid validation SHALL distinguish web-plane readiness from GPU-container readiness

Hybrid validation SHALL report readiness for Docker coordinator/viewer and host-native bridge separately from Docker GPU Kit readiness.

#### Scenario: Hybrid health check reports required tiers

- **WHEN** the operator runs the hybrid Docker web-plane check
- **THEN** the check SHALL verify host access to `http://127.0.0.1:8004/health`
- **AND** it SHALL verify host access to `http://127.0.0.1:5173`
- **AND** it SHALL verify coordinator-container access to host-native `${STREAMING_CONVERSION_API_BASE}/health`
- **AND** it SHALL verify host/browser-visible access to Kit signaling port `49100` when Kit runtime is expected to be running
- **AND** it SHALL verify runtime-visible artifact refs when a succeeded conversion result is available

#### Scenario: Hybrid pass does not imply Docker GPU Kit pass

- **WHEN** hybrid Docker web-plane checks pass
- **THEN** evidence SHALL identify the runtime mode as hybrid web plane plus host-native runtime
- **AND** evidence SHALL NOT mark `runtime_image_kit_launcher` as passed
- **AND** evidence SHALL NOT claim Docker GPU profile readiness unless the Docker GPU profile is explicitly built and validated by its own capability

### Requirement: Host-native conversion artifacts SHALL have a documented storage boundary

The hybrid deployment SHALL define where completed IFC→USDC outputs are written, how they are referenced, and which service owns their lifecycle.

#### Scenario: Conversion authority writes per-job artifacts

- **WHEN** a host-native conversion job succeeds
- **THEN** `bim-streaming-server` conversion authority SHALL write derived artifacts under a configured artifacts root
- **AND** the default local artifacts root SHALL be git-ignored and outside `storage/`
- **AND** the job output directory SHALL be scoped by `conversion_job_id`
- **AND** the publishable output set SHALL include `model.usdc`, `element_mapping.json`, `entity_index.json`, and `metadata.json`

#### Scenario: Conversion result returns metadata refs

- **WHEN** coordinator ingests a succeeded conversion result
- **THEN** the result SHALL expose refs or URLs for the USDC model, element mapping, and manifest metadata
- **AND** coordinator SHALL store those refs as metadata only
- **AND** coordinator SHALL NOT copy `.usdc` bytes into its own store
- **AND** cloud callback outbox SHALL send metadata refs only, not large artifact bodies

#### Scenario: Artifact refs are runtime-visible

- **WHEN** a conversion result includes `model.usdc`, `element_mapping.json`, and `metadata.json` refs
- **THEN** the refs SHALL use `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` or an equivalent configured public artifacts base
- **AND** local single-machine refs MAY use loopback only when the consuming runtime is on the same host
- **AND** LAN or remote viewer deployments SHALL configure a host or DNS name that the consuming runtime can resolve
- **AND** the validation helper SHALL report blocked if refs are generated but cannot be fetched from the expected consumer perspective

#### Scenario: Operator can configure durable artifact roots

- **WHEN** the operator prepares hybrid mode for repeated demo or deployable single-machine use
- **THEN** the runbook SHALL document the default artifacts root and jobs directory
- **AND** the operator SHALL be able to configure artifacts root, jobs directory, and public artifacts URL without changing product source code
- **AND** the check or runbook SHALL explain how to inspect and clean demo artifacts without deleting active review-session or callback-outbox references

### Requirement: Hybrid deployment SHALL preserve B-scheme boundaries

Hybrid Docker web-plane mode SHALL preserve the B-scheme ownership boundaries defined by `AGENTS.md`.

#### Scenario: External platform remains outside runtime

- **WHEN** hybrid Docker web-plane mode is used
- **THEN** `_worker` and `_bim-control` SHALL NOT be started as product runtime services
- **AND** external IFC Worker behavior SHALL continue to be represented by `tests/fakes` or explicit test clients
- **AND** external company-cloud callback behavior SHALL remain metadata-only through coordinator callback outbox or test doubles

#### Scenario: Service responsibilities remain separated

- **WHEN** coordinator, viewer, and host-native streaming runtime communicate in hybrid mode
- **THEN** `bim-review-coordinator` SHALL remain responsible for IFC-ready intake, review sessions, and callback outbox
- **AND** `bim-streaming-server` SHALL remain responsible for IFC→USDC conversion authority, Kit runtime, WebRTC, and DataChannel scene operations
- **AND** `web-viewer-sample` SHALL remain responsible for browser UI and user interaction
