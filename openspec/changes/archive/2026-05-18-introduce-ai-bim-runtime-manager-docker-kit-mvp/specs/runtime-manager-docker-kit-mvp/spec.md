## ADDED Requirements

### Requirement: MVP runtime SHALL be Docker-first

The AI-BIM Runtime Manager MVP SHALL use Docker Compose as the primary runtime.

#### Scenario: Host-local runtime is not accepted as MVP pass

- **WHEN** a smoke test records MVP evidence
- **THEN** it records `runtime_mode="docker-container"`
- **AND** `host_local_runtime_allowed=false`

### Requirement: Kit SHALL run in a GPU container

The streaming Kit runtime SHALL run in the Docker Compose GPU profile.

#### Scenario: GPU runtime external prerequisite missing

- **WHEN** NVIDIA runtime, GPU, license/auth, or NVIDIA package/network external prerequisites are unavailable
- **THEN** the result is `blocked`
- **AND** host-local Kit MUST NOT be used as a substitute pass

#### Scenario: GPU image builds Linux Kit app during Docker build

- **WHEN** the streaming-server GPU Docker image is built
- **THEN** the Docker build runs `./repo.sh build` inside the Linux build environment
- **AND** the Docker build packages the Linux app with `./repo.sh package` before assembling the runtime stage
- **AND** the runtime image contains `/workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh`
- **AND** the runtime stage uses the Linux build artifact produced by the Docker builder stage

#### Scenario: Missing Linux launcher is a build failure

- **WHEN** the Docker build completes without a Linux Kit launcher
- **THEN** the result is `failed_linux_kit_build`
- **AND** the result is not `blocked_missing_linux_kit_launcher`
- **AND** host-local Windows `_build`, `repo.bat`, PowerShell launchers, or host-local Kit launchers are not accepted as MVP pass evidence

#### Scenario: Build pipeline missing is not runtime blocked

- **WHEN** the Dockerfile does not execute the Linux Kit build pipeline
- **THEN** the result is `failed_linux_kit_build`
- **AND** GPU runtime blocked is reserved for external runtime or NVIDIA dependency failures

### Requirement: Kit Manager UI SHALL open and close k selected USDC files

The MVP SHALL provide a Kit Manager frontend where a user selects k `.usdc` files
and sends open / close commands to one Kit instance.

#### Scenario: Open k selected files

- **WHEN** the user selects one or more `.usdc` files
- **AND** clicks `Open selected in Kit`
- **THEN** the first file is primary
- **AND** the remaining selected files are secondary
- **AND** the Kit instance state records the open command

#### Scenario: Close instance

- **WHEN** the user clicks `Close instance`
- **THEN** the Kit instance state clears selected and opened files

### Requirement: Web viewer container SHALL match package engine contract

The web-viewer-sample container SHALL use Node and npm versions compatible with
`web-viewer-sample/package.json`.

#### Scenario: Web viewer Docker engine contract

- **WHEN** the web-viewer-sample Docker image installs dependencies
- **THEN** it uses a Node version compatible with `node: ^18.0.0`
- **AND** it uses npm compatible with `npm: ^10.0.0`
- **AND** engine-strict validation is enabled before dependency install

### Requirement: Kit Manager API runtime status mapping SHALL be tested

The Kit Manager API runtime status mapping SHALL have automated pytest coverage.

#### Scenario: Runtime status mapping regression coverage

- **WHEN** Kit control returns `sent`
- **THEN** open maps to `open`
- **AND** close maps to `closed`
- **WHEN** Kit control returns a `blocked*` status
- **THEN** open and close map to `blocked`
- **WHEN** Kit control returns `failed*` or an unknown status
- **THEN** open and close map to `recorded_only`

### Requirement: New source files SHALL remain small and separated

Each new or modified source file SHALL stay under 500 lines and SHALL keep a
single clear responsibility.

#### Scenario: Source files stay within the MVP size limit

- **WHEN** the MVP source files are reviewed before PR
- **THEN** each new or modified source file is under 500 lines
- **AND** API service, repository, gateway, session state, and UI components remain separated by responsibility
