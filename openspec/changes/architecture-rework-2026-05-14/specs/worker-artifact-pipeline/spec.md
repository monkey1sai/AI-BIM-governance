# worker-artifact-pipeline Specification Delta

## MODIFIED Requirements

### Requirement: Worker artifact pipeline separates RVT→IFC bridge from streaming-owned IFC→USDC conversion

`_worker` SHALL remain responsible for source intake metadata and RVT→IFC bridge artifacts, but under B 方案 it SHALL NOT be the authority for IFC→USDC conversion jobs. Derived USDC artifacts, conversion job status, and mapping quality results SHALL be owned by `bim-streaming-server` after the architecture rework.

#### Scenario: Worker receives RVT source

- **WHEN** `_worker` receives an RVT export request
- **THEN** it tracks source RVT artifact and derived IFC artifact lineage
- **AND** it emits `ifc_ready` to `bim-streaming-server` when IFC export succeeds

#### Scenario: Worker does not publish USDC ready in B scheme

- **WHEN** `_worker` has produced an IFC artifact
- **THEN** it MUST NOT mark `model.usdc` ready or answer USDC conversion result as authority
- **AND** downstream USDC readiness is determined by `bim-streaming-server` conversion result

#### Scenario: Historical worker conversion evidence remains historical

- **WHEN** reports mention prior `_worker` real IFC→USDC evidence
- **THEN** they MAY cite it as migration source or historical evidence
- **AND** they MUST NOT classify the new B-scheme streaming conversion authority as passed until new streaming-server-owned evidence exists
