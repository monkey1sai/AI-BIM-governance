# one-click-deploy-hybrid — Spec Delta (stop-all-single-pid-cleanup)

## MODIFIED Requirements

### Requirement: Final Summary 可診斷性

deploy and closeout scripts SHALL keep failure / recovery output diagnosable under strict mode. Shutdown cleanup MUST NOT emit strict-mode collection-shape errors when the runtime directory contains zero, one, or many `.pid` files.

#### Scenario: stop-all handles exactly one pid file

- **WHEN** `scripts\.run\` contains exactly one expected service `.pid` file
- **THEN** `scripts\stop-all.ps1` MUST treat the pid-file enumeration as a collection
- **AND** it MUST NOT emit a strict-mode error such as `The property 'Count' cannot be found on this object`
- **AND** it MUST continue to remove stale pid files and stop matching workspace processes according to the existing service ownership rules
