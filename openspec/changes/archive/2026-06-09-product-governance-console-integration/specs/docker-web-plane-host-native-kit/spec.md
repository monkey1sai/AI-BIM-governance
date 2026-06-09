## ADDED Requirements

### Requirement: Rebuild and E2E Evidence for Product Console
The integration SHALL preserve build and runtime evidence for the web console and host-native Nvidia Kit path.

#### Scenario: Web console bundle is rebuilt
- **WHEN** the implementation is complete
- **THEN** `web-viewer-sample` builds a `/ui/` bundle and the evidence records the command, result, and bundle visibility

#### Scenario: Browser E2E verifies operator interaction
- **WHEN** the rebuilt console is served locally
- **THEN** browser automation opens the console, navigates key pages, records screenshot evidence, and checks for severe console errors

#### Scenario: Docker and Kit runtime validation is attempted
- **WHEN** Docker web plane and Nvidia Kit / OS runtime validation commands are available
- **THEN** the implementation runs them or records the exact blocker, preserving logs as evidence and not claiming full Kit E2E if first-frame/runtime proof is missing
