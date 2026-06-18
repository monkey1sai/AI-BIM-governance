# Design: governance-service-deploy

## Context

`governance-service` is already the loopback authority for A1/A2/A3 governance work. Before this change, a developer had to start it separately from the canonical `deploy.ps1 -Build` flow. That made `deploy.ps1` incomplete for A1/M1 closeout even though the web UI and coordinator proxy expected governance endpoints to be available.

The design keeps governance host-native for the same reason as conversion and Kit: it uses local Python packages and local IFC/file-library state, and it is not a browser-facing service. Docker coordinator accesses it through `host.docker.internal`.

## Goals

- Make `scripts/deploy.ps1 -Build` start a healthy `governance-service` by default.
- Keep `governance-service` loopback-only on the host.
- Make coordinator containers use `HOST_GOVERNANCE_API_BASE` to proxy browser requests.
- Preserve an explicit opt-out for operators who do not need governance in a local run.
- Preserve dry-run auditability.

## Non-Goals

- Do not containerize `governance-service`.
- Do not make browsers call `127.0.0.1:49102` directly.
- Do not change A1/A2/A3 rule-run APIs.
- Do not merge governance into conversion or Kit runtime processes.

## Decisions

### Decision 1: Phase 4 starts governance before the existing runtime chain

Governance becomes Phase 4a. The previous conversion / Kit / Docker stages move to 4b / 4c / 4d. This keeps coordinator startup last, after all host-native services it may proxy are ready.

### Decision 2: Docker coordinator receives a host bridge URL

The host process sets `HOST_GOVERNANCE_API_BASE=http://host.docker.internal:<port>` unless `-SkipGovernance` is used. If the operator passes a non-default governance port, deploy forces a web-plane refresh so the container environment cannot stay stale.

### Decision 3: Host Python sanity check must match real runtime imports

The launcher clears `PYTHONNOUSERSITE` before checking imports because the supported host Python can resolve `uvicorn` through user-site packages. This mirrors the runtime used by `python -m uvicorn app:app`.

## Verification

- PowerShell parse check for deploy / launcher / stop scripts.
- `scripts/tests/test-deploy-governance-static.ps1`
- `scripts/tests/test-deploy-dryrun.ps1`
- `scripts/deploy.ps1 -Build -SkipKit -SkipConversion -StrictPostVerify`
- governance direct health probe: `http://127.0.0.1:49102/health`
- coordinator proxy probe: `http://127.0.0.1:8004/api/governance/files/tree`
- A1/M1 Playwright E2E evidence remains valid through the coordinator proxy.
