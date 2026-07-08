# Deploy preflight Python baseline alignment

## Requirement source

Deployment Phase 2 must install and validate the same Python runtime baseline for the host-native conversion service.

`bim-streaming-server/requirements.txt` currently pins:

- `fastapi==0.115.6`
- `starlette==0.41.3`
- `uvicorn[standard]==0.45.0`

`scripts/lib/preflight-host-native.ps1` must accept that same baseline after `scripts/deploy.ps1` runs `pip install -r bim-streaming-server\requirements.txt`.

## Acceptance criteria

- `Test-HostNativePythonDependencies` reports `Status=OK` for `fastapi 0.115.6`, `starlette 0.41.3`, and `uvicorn 0.45.0`.
- Preflight test expectations match the same dependency versions.
- The official deployment checkout remains validated only after merge, because `scripts/dev/rebuild-test-deploy.ps1 -Build` always rebuilds from freshly fetched `origin/main`.

## Verification

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\test-preflight-host-native.ps1`
- Direct `Test-HostNativePythonDependencies` probe against the deployment `.venv` created by the failed pre-merge deploy rebuild.
- `git diff --check`
