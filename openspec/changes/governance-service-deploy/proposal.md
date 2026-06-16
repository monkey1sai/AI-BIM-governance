# Proposal: governance-service-deploy

## Why

PR #215 changes the canonical deploy path: `scripts/deploy.ps1 -Build` no longer starts only conversion, Kit, and the Docker web plane. It now also starts the loopback `governance-service` so A1/M1 closeout can use the real governance file tree and rule-run authority through the coordinator proxy without a second terminal.

This is a behavior / workflow change to the one-click deployment contract, so it needs explicit OpenSpec evidence for the PR review gate.

## What Changes

- `deploy.ps1` gains a governance stage before conversion / Kit / Docker compose startup:
  - default port `49102`
  - opt-out flag `-SkipGovernance`
  - custom port flag `-GovernancePort`
  - direct health probe `http://127.0.0.1:<port>/health`
- `deploy.ps1` exports `HOST_GOVERNANCE_API_BASE` for the Docker coordinator so browser-facing `/api/governance/*` routes continue through `:8004`.
- `deploy.ps1` refreshes the Docker web plane when the governance API base changes, preventing a running coordinator container from keeping stale governance configuration.
- `stop-all.ps1` knows about `governance-service`.
- Dry-run and static tests cover the new deploy contract.

## Impact

- Affected capability: `one-click-deploy-hybrid`
- Affected files:
  - `scripts/deploy.ps1`
  - `scripts/lib/host-native-launcher.ps1`
  - `scripts/stop-all.ps1`
  - `scripts/tests/test-deploy-dryrun.ps1`
  - `scripts/tests/test-deploy-governance-static.ps1`
- Non-goals:
  - no change to `governance-service` rule-run semantics
  - no change to browser direct-access boundary; browser still uses coordinator proxy
  - no public / internet exposure of `governance-service`
  - no change to Kit or conversion authority behavior
