# AI-BIM Runtime Manager Docker Kit MVP

## Architecture

```txt
ppms upstream
  ↓ IFC-ready source
worker container
  ↓ artifact registration
kit-manager-api container
  ↓ open / close selected USDC set
streaming-server GPU container
  ↓ Kit RTX + WebRTC
viewer container
```

## Runtime policy

Docker Compose is the MVP runtime boundary.

```txt
host_local_runtime_allowed=false
runtime_mode=docker-container
```

## Services

| Service | Role |
|---|---|
| `bim-control` | metadata facade |
| `worker` | RVT→IFC / IFC handoff bridge |
| `coordinator` | session coordination |
| `viewer` | WebRTC viewer |
| `kit-manager-api` | Kit instance selection/open/close API |
| `kit-manager-web` | Kit manager frontend |
| `streaming-server` | GPU Kit / WebRTC container |

## Kit open model

The Kit manager creates a stage composition payload:

```json
{
  "type": "openStageRequest",
  "stage_composition": {
    "primary": {"url": "file:///workspace/storage/a.usdc"},
    "secondary": [{"url": "file:///workspace/storage/b.usdc"}]
  }
}
```

The first selected USDC is primary. The remaining `k-1` files are secondary.
