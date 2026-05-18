# Docker Kit Manager MVP Verification - 2026-05-15

## Scope

Change id: `introduce-ai-bim-runtime-manager-docker-kit-mvp`

Worktree:

```txt
C:\Repos\active\iot\AI-BIM-governance\.worktrees\introduce-ai-bim-runtime-manager-docker-kit-mvp
```

MVP evidence is Docker-first. Host-local Kit, Windows `_build`, `repo.bat`, and PowerShell launchers were not used as pass evidence.

## Layered Result

| Layer | Result | Evidence |
|---|---|---|
| Core Docker runtime | pass | `.\scripts\start-runtime-manager-docker.ps1 -Build`; `.\scripts\check-runtime-manager-docker.ps1` returned `core_endpoints_ok` |
| Kit Manager UI | pass | `npx playwright screenshot --wait-for-timeout=2000 http://127.0.0.1:5174 .tmp\kit-manager-5174.png` |
| Web viewer Docker engine contract | pass | Node `v18.20.8`, npm `10.9.8`, `engine-strict=true` |
| Linux Kit Docker build | pass | GPU Dockerfile ran Linux `./repo.sh build`, then `./repo.sh package --name ai_bim_streaming_server` |
| GPU runtime | blocked_gpu_runtime_unavailable | `nvidia-smi` works, but NVIDIA graphics/Vulkan driver library `libGLX_nvidia.so.0` is not mounted in the container |
| WebRTC runtime | not_observed | WebRTC cannot be observed because the GPU runtime preflight exits before launching Kit |
| Kit control gateway | blocked | open / close recorded `blocked_runtime_control_unavailable` while GPU runtime was blocked |

## Required Evidence

| Field | Value |
|---|---|
| docker_build_started | yes |
| linux_kit_build_command | `./repo.sh build` |
| linux_kit_package_command | `./repo.sh package --name ai_bim_streaming_server` |
| linux_kit_build_result | pass |
| linux_launcher_path | `/workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh` |
| linux_launcher_exists | true |
| runtime_image_launch_result | blocked before launcher: `blocked_gpu_runtime_unavailable` |
| gpu_runtime_result | blocked: missing `libGLX_nvidia.so.0` / NVIDIA graphics-Vulkan driver libraries in Docker container |
| webrtc_runtime_result | not_observed |
| web_viewer_node_version | `v18.20.8` |
| web_viewer_npm_version | `10.9.8` |
| web_viewer_engine_strict_result | `true` |
| kit_manager_api_pytest_result | `7 passed in 0.17s` |
| gitnexus_detect_changes_result | compare scope: risk `critical` for full PR vs `main`; staged increment: risk `medium` |

## Validation Commands

```powershell
npx openspec validate introduce-ai-bim-runtime-manager-docker-kit-mvp --strict
docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker config
docker compose -f compose.runtime-manager.yml --env-file .env.runtime-manager.docker --profile gpu config
docker build -f infra/docker/web-viewer-sample.Dockerfile --progress=plain -t ai-bim-web-viewer-sample-test .
docker run --rm --entrypoint node ai-bim-web-viewer-sample-test -v
docker run --rm --entrypoint npm ai-bim-web-viewer-sample-test -v
docker run --rm --entrypoint npm ai-bim-web-viewer-sample-test config get engine-strict
docker build -f infra/docker/bim-streaming-server-gpu.Dockerfile --progress=plain -t ai-bim-streaming-server-gpu-test .
docker run --rm --entrypoint bash ai-bim-streaming-server-gpu-test -lc "test -x /workspace/bim-streaming-server/_build/linux-x86_64/release/ezplus.bim_review_stream_streaming.kit.sh"
python -m compileall services\kit-manager-api\app
python -m pytest services\kit-manager-api\tests -q
.\scripts\start-runtime-manager-docker.ps1 -Build
.\scripts\check-runtime-manager-docker.ps1
.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu
.\scripts\check-runtime-manager-docker.ps1 -WithGpu
npx playwright screenshot --wait-for-timeout=2000 http://127.0.0.1:5174 .tmp\kit-manager-5174.png
```

## Observed Output

Core check:

```txt
[ok] core_endpoints_ok
[ok] web_viewer_engine_contract_passed node=v18.20.8 npm=10.9.8 engine-strict=true
[blocked] kit_control_blocked control=blocked_runtime_control_unavailable
```

GPU check:

```txt
[ok] linux_kit_build_passed launcher_and_kit_binary_exist
[blocked] gpu_runtime_blocked blocked_gpu_runtime_unavailable
```

GPU runtime logs:

```txt
[blocked_gpu_runtime_unavailable] NVIDIA graphics/Vulkan driver libraries not mounted in container
[blocked_gpu_runtime_unavailable] Missing libGLX_nvidia.so.0
```

Kit Manager API open / close smoke:

```txt
ArtifactId   : usdc_docker-kit-manager-smoke.usdc
OpenStatus   : blocked
OpenControl  : blocked_runtime_control_unavailable
CloseStatus  : blocked
CloseControl : blocked_runtime_control_unavailable
```

## Review Findings

- GitNexus Finding 1 handled: `web-viewer-sample` Dockerfile uses Node 18, installs npm 10, and enables `engine-strict` before install.
- Engine-strict exposed that `@nvidia/omniverse-webrtc-streaming-library@5.6.0` requires Node >=19; the viewer dependency is pinned to `4.4.2` to keep the existing Node 18 package engines contract.
- GitNexus Finding 2 handled: `services/kit-manager-api/tests/test_kit_service_runtime_status.py` covers `sent`, `blocked*`, `failed*`, and unknown control status mapping.

## GitNexus

```txt
gitnexus analyze .
Repository indexed successfully: 4,886 nodes | 10,072 edges | 212 clusters | 256 flows

gitnexus detect-changes --repo <worktree> --scope compare --base-ref main
Changes: 32 files, 43 symbols
Affected processes: 18
Risk level: critical

gitnexus detect-changes --repo <worktree> --scope unstaged
Changes: 15 files, 32 symbols
Affected processes: 3
Risk level: medium

gitnexus detect-changes --repo <worktree> --scope staged
Changes: 18 files, 51 symbols
Affected processes: 3
Risk level: medium
```

Focused Kit Manager API impact:

```txt
KitInstanceService upstream impact: LOW, direct importer main.py
open_artifacts upstream impact: LOW, direct caller open_selected
close_instance upstream impact: LOW, direct caller close_instance route
_runtime_status upstream impact: LOW, direct callers open_artifacts and close_instance
```

## Notes

- `storage/docker-kit-manager-smoke.usdc` is local smoke data only and remains untracked.
- `.env.runtime-manager.docker` is local runtime input and must not be committed.
- GPU runtime is not marked passed. The Linux Kit launcher is produced by Docker build, but the local Docker runtime does not mount NVIDIA graphics/Vulkan libraries required by Kit.
