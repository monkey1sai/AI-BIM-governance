# rebuild-test-deploy wrapper wait hang fix

## Problem

`.\scripts\dev\rebuild-test-deploy.ps1 -Build` rebuilt the deployment checkout and `scripts\deploy.ps1 -Build` reached healthy services, but the wrapper could still hang until the caller timed out. The observed deployment log reached Phase 5 health checks, while the wrapper failed to return an exit code.

## Scope

This is a deployment-wrapper bugfix only.

- Keep the canonical command: `.\scripts\dev\rebuild-test-deploy.ps1 -Build`.
- Keep the deployment checkout target: `D:\Users\deploy\AI-bim-geo`.
- Keep `scripts\deploy.ps1 -Build` as the command executed inside the deployment checkout.
- Do not change runtime ports, Docker compose files, Kit launch arguments, viewer routes, env schema, or storage layout.

## Design

`Invoke-TestDeployRebuild` should call a small helper for the deploy step. The helper must avoid `Start-Process -Wait` against `powershell.exe` because `deploy.ps1` intentionally leaves host-native runtime services running after the deploy script has completed.

The deploy helper should route stdout and stderr to files under `scripts\.run\` and wait only for the direct launcher process so long-lived child services cannot keep the agent or CI output pipe open.

Missing or indeterminate deploy exit codes must fail closed with a non-zero value.

## Verification

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\tests\test-rebuild-test-deploy.ps1`
- `.\scripts\dev\rebuild-test-deploy.ps1 -Build`
- Fresh HTTP probes for coordinator, viewer, coordinator UI, governance proxy, governance service, conversion service, and public conversion health.
