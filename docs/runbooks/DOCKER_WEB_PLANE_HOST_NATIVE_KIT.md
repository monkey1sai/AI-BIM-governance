# Docker Web Plane + Host-native Kit Runbook

> Source of truth: `AGENTS.md` B-scheme boundary. This runbook is a single-machine hybrid deployment path. Docker runs only the web plane (`bim-review-coordinator` and `web-viewer-sample`); NVIDIA Kit/WebRTC and IFC to USDC conversion remain host-native.

## Scope

This mode starts:

| Tier | Runtime | Port |
|---|---|---|
| Coordinator web/control plane | Docker container | `8004` |
| Viewer web app | Docker container | `5173` |
| Kit/WebRTC signaling | Host-native `bim-streaming-server` | `49100` |
| Kit/WebRTC media | Host-native `bim-streaming-server` | `47998` |
| Conversion authority API | Host-native `bim-streaming-server` conversion-only service | `49101` |

This mode does not start Docker GPU service `streaming-server` and does not prove `runtime_image_kit_launcher`. A green hybrid check is not Docker GPU Kit readiness.

`0.0.0.0:8004` in this runbook is LAN/single-machine exposure only. Public Internet or cross-company exposure needs a separate edge-security design with TLS or mTLS, firewall allowlist, logging, and service-auth guidance.

## Startup Order

Run from repo root in PowerShell.

1. Start the host-native conversion authority:

```powershell
pwsh -File bim-streaming-server/scripts/start-host-native-conversion-service.ps1
```

2. Start host-native Kit/WebRTC when visual streaming is expected:

```powershell
pwsh -File scripts/run-single-kit-demo.ps1
```

3. Start the Docker web plane:

```powershell
pwsh -File scripts/start-web-plane-docker.ps1 -Build
```

The start helper uses `.env.web-plane.host-kit` when present. If that file is absent, it uses the committed non-secret `.env.web-plane.host-kit.example`.

4. Check the hybrid deployment:

```powershell
pwsh -File scripts/check-web-plane-docker.ps1
```

Expected web-plane checks:

```txt
docker_web_plane_health:coordinator -> http://127.0.0.1:8004/health
docker_web_plane_health:viewer      -> http://127.0.0.1:5173
```

If host-native conversion or Kit is not running, the check reports `blocked` / `not_observed` with the next command. That is an honest blocker, not a Docker GPU failure.

## Endpoint Semantics

The main rule is that each caller sees a different network namespace.

| Caller | Use | Example |
|---|---|---|
| Coordinator container -> host conversion API | Container-to-host URL | `http://host.docker.internal:49101` |
| Browser -> coordinator | Browser-visible URL | `http://127.0.0.1:8004` |
| Browser -> Kit/WebRTC | Browser-visible Kit endpoint | `127.0.0.1:49100` |

Do not use container-local `127.0.0.1` for host services. Do not return Docker-only service names to the browser.

Hybrid env variables:

```txt
HOST_CONVERSION_API_BASE=http://host.docker.internal:49101
# optional; defaults to http://127.0.0.1:${COORDINATOR_PORT}
# WEB_VIEWER_COORDINATOR_API_BASE=http://127.0.0.1:8004
KIT_SIGNALING_HOST=127.0.0.1
KIT_SIGNALING_PORT=49100
KIT_MEDIA_HOST=127.0.0.1
KIT_MEDIA_PORT=47998
```

`compose.host-kit.yml` maps these into coordinator and viewer container environments. In hybrid mode, coordinator uses `STREAMING_CONVERSION_API_BASE` / `CONVERSION_API_BASE` from `HOST_CONVERSION_API_BASE`, not `http://streaming-server:49101`.

## Host Bridge Profiles

| Profile | Intended host | Conversion URL | Notes |
|---|---|---|---|
| `windows-docker-desktop` | Windows + Docker Desktop | `http://host.docker.internal:49101` | Preferred local path. If blocked, check Docker Desktop host networking and host service bind address. |
| `linux-host-gateway` | Linux Docker Engine | `http://host.docker.internal:49101` with `host-gateway` | `compose.host-kit.yml` provides `extra_hosts`. Host service may need to bind an address reachable from Docker bridge. |
| `explicit-host-address` | LAN or deployment-specific | `http://<host-address>:49101` | Operator owns firewall, route, bind host, and DNS/LAN reachability. |

When `49101` is unreachable, `scripts/check-web-plane-docker.ps1` separates likely blockers into DNS, route/firewall, or bind-host/service-down categories where possible.

## Conversion Artifacts

`storage/` is for source IFC fixtures used by demo/smoke inputs. It is not the default derived output store.

Host-native conversion output is owned by `bim-streaming-server` conversion authority:

```txt
STREAMING_CONVERSION_ARTIFACTS_ROOT=./bim-streaming-server/_cache/host-native-conversion/artifacts
STREAMING_CONVERSION_JOBS_DIR=./bim-streaming-server/_cache/host-native-conversion/jobs
STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL=http://127.0.0.1:49101/artifacts
```

Succeeded jobs publish a per-job directory:

```txt
<artifacts_root>/<conversion_job_id>/
  model.usdc
  element_mapping.json
  entity_index.json
  metadata.json
```

Coordinator stores only metadata refs such as `usdc_ref`, `element_mapping_ref`, and `manifest_ref`. The cloud callback outbox remains metadata-only and must not include `.usdc` bytes or large artifact bodies.

Choose `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` for the consumer that will fetch the artifacts:

| Consumer | Safe example |
|---|---|
| Same host single-machine demo | `http://127.0.0.1:49101/artifacts` |
| LAN viewer/runtime | `http://<host-lan-ip>:49101/artifacts` |
| Remote deployment | DNS/reverse proxy endpoint owned by deployment design |

Loopback refs are valid only when the consuming runtime is on the same host.

Cleanup is operator-driven for this change. Before deleting demo artifacts, confirm no active review session or callback outbox entry still references those artifact URLs.

## Validation Matrix

| Tier | Command / check | Pass means |
|---|---|---|
| `docker_web_plane_config` | `docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example config coordinator viewer` | Compose YAML and service selection are valid |
| `docker_web_plane_health` | `scripts/check-web-plane-docker.ps1` | Host can reach `8004/health` and `5173` |
| `container_to_host_conversion` | `scripts/check-web-plane-docker.ps1` | Coordinator container can reach `${STREAMING_CONVERSION_API_BASE}/health` |
| `host_native_kit_probe` | `scripts/check-web-plane-docker.ps1` | Browser-visible `49100` TCP endpoint is reachable |
| `runtime_visible_artifact_refs` | `scripts/check-web-plane-docker.ps1 -ConversionJobId <id>` | Published result refs can be fetched from the expected consumer perspective |

Hybrid validation must not update Docker GPU Kit readiness. Keep `runtime_image_kit_launcher`, browser visual, and WebRTC render tiers separate unless their own evidence exists.

## B-scheme Boundary

Do not start `_worker` or `_bim-control` as product runtime. External IFC Worker behavior remains represented by `tests/fakes` or explicit test clients. Company-cloud callback behavior remains metadata-only through coordinator callback outbox or test doubles.
