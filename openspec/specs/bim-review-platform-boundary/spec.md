# bim-review-platform-boundary Specification

## Purpose
TBD - created by archiving change architecture-rework-2026-05-14. Update Purpose after archive.
## Requirements
### Requirement: `bim-review-platform` is a deployment boundary, not a nested repo

`bim-review-platform` SHALL represent the integrated deployment boundary for `bim-review-coordinator`, `bim-streaming-server`, and `web-viewer-sample` within the existing single root repo. It SHALL NOT require nested Git repositories, submodules, or subtree-managed service directories.

#### Scenario: Platform profile starts existing service folders

- **WHEN** a local platform run profile is used
- **THEN** it starts or references the existing service folders for coordinator, streaming server, and viewer
- **AND** each service retains its own source directory and responsibility boundary

#### Scenario: No nested Git repository is introduced

- **WHEN** the platform boundary is implemented
- **THEN** no `.git` directory is created under service folders
- **AND** no submodule entry is added for `bim-review-platform`

### Requirement: Platform deployment exposes clear service health

`bim-review-platform` SHALL provide a combined readiness view while preserving per-service health status.

#### Scenario: One service is down

- **WHEN** coordinator or viewer or streaming server is not healthy
- **THEN** the platform readiness view reports the failing service separately
- **AND** it MUST NOT claim the whole platform is passed

#### Scenario: Streaming conversion passes but WebRTC is blocked

- **WHEN** `bim-streaming-server` conversion API passes but the Kit/WebRTC endpoint is unavailable
- **THEN** conversion readiness MAY be `passed`
- **AND** WebRTC / viewport readiness remains `blocked` or `not_observed`
