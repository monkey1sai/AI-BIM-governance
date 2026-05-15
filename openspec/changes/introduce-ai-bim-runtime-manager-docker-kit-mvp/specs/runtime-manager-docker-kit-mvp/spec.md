## ADDED Requirements

### Requirement: MVP runtime SHALL be Docker-first

The AI-BIM Runtime Manager MVP SHALL use Docker Compose as the primary runtime.

#### Scenario: Host-local runtime is not accepted as MVP pass

- **WHEN** a smoke test records MVP evidence
- **THEN** it records `runtime_mode="docker-container"`
- **AND** `host_local_runtime_allowed=false`

### Requirement: Kit SHALL run in a GPU container

The streaming Kit runtime SHALL run in the Docker Compose GPU profile.

#### Scenario: GPU runtime missing

- **WHEN** GPU container prerequisites are missing
- **THEN** the result is `blocked`
- **AND** host-local Kit MUST NOT be used as a substitute pass

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

### Requirement: New source files SHALL remain small and separated

Each new or modified source file SHALL stay under 500 lines and SHALL keep a
single clear responsibility.

#### Scenario: Source files stay within the MVP size limit

- **WHEN** the MVP source files are reviewed before PR
- **THEN** each new or modified source file is under 500 lines
- **AND** API service, repository, gateway, session state, and UI components remain separated by responsibility
