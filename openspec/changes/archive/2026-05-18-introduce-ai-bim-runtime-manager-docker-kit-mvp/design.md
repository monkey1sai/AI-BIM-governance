# Design: Docker-first Kit Manager MVP

## Decision

MVP runtime boundary is Docker Compose.

```txt
compose.runtime-manager.yml
  core services: bim-control, worker, coordinator, viewer, kit-manager-api, kit-manager-web
  gpu profile: streaming-server
```

## Kit Manager

`kit-manager-api` owns the MVP open/close command state for a single Kit instance.
It scans `/workspace/storage/**/*.usdc`, exposes the list to `kit-manager-web`,
and builds stage composition payloads.

## Open k USDC files

The first selected file becomes primary. Remaining files become secondary layers.

## Control status

If `KIT_CONTROL_URL` cannot be reached, the API records command state and reports
`blocked_runtime_control_unavailable`. This is not a viewport pass.

## File structure

New code is split by responsibility:

```txt
services/kit-manager-api/app/settings.py
services/kit-manager-api/app/models.py
services/kit-manager-api/app/usdc_repository.py
services/kit-manager-api/app/kit_gateway.py
services/kit-manager-api/app/kit_service.py
services/kit-manager-api/app/main.py
apps/kit-manager-web/src/api/KitManagerClient.ts
apps/kit-manager-web/src/components/*.tsx
```
