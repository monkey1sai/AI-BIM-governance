# WSL2 NVIDIA Container Toolkit Graphics Blocker — Follow-up (2026-05-20)

## Scope

針對 `docs/verification/2026-05-15-docker-kit-manager-mvp.md` 中
`gpu_runtime_result = blocked: missing libGLX_nvidia.so.0 / NVIDIA graphics-Vulkan
driver libraries in Docker container` 的後續證據補充。

此 follow-up **不開新 OpenSpec change、不改 spec**。它記錄 2026-05-20 在此機
新建 Ubuntu-24.04 WSL distro 與安裝 NVIDIA Container Toolkit 之後重新驗證
`infra/docker/bim-streaming-server-gpu.Dockerfile` GPU runtime 前置依賴的結果，
確認 2026-05-15 觀察到的 blocker 不是配置缺漏，而是 WSL2 架構天花板。

`CODE_GOAL_DOCKER_KIT_MVP.md`「Kit 以 GPU container 運行；不能用 host Kit 假裝
通過」的驗收規矩在此機物理上不可達（仍須走 host-native Kit，與
`memory/kit-gpu-render-needs-windows-native` 一致）。

## Environment Diff vs. 2026-05-15

| 項目 | 2026-05-15 | 2026-05-20 |
|---|---|---|
| WSL default distro | kali-linux (Stopped) | Ubuntu-24.04 LTS (Noble Numbat) |
| WSL distros | kali-linux, docker-desktop | Ubuntu-24.04, docker-desktop（kali-linux 已 `wsl --unregister`，tarball 留底於 `D:\backup\kali-2026-05-20\kali-linux.tar`） |
| Docker engine | Docker Desktop only | Docker Engine 29.5.1 (native, in Ubuntu-24.04) + Docker Desktop (separate distro) |
| Docker Compose | v2.x (Docker Desktop) | docker-compose-plugin v5.1.3 (Ubuntu native) |
| nvidia-container-toolkit | not installed | 1.19.0 (apt `nvidia.github.io/libnvidia-container/stable/deb`) |
| `nvidia-ctk runtime configure --runtime=docker` | not run | run — `/etc/docker/daemon.json` 含 `nvidia` runtime |
| Host NVIDIA driver | 580.97 (Windows side) | 580.97 (unchanged) |
| GPU | RTX 4060 Ti | RTX 4060 Ti (unchanged) |

## Layered Result

| Layer | 2026-05-15 Result | 2026-05-20 Result | Notes |
|---|---|---|---|
| Docker runtime base | pass | pass | Ubuntu 內 `docker --version` 29.5.1, `docker compose version` v5.1.3 |
| Compose syntax — base profile | pass | pass | `docker compose -f compose.runtime-manager.yml config --quiet` exit 0 |
| Compose syntax — gpu profile | pass | pass | `docker compose -f compose.runtime-manager.yml --profile gpu config --quiet` exit 0 |
| GPU runtime — CUDA compute container | not_observed | **pass** | `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi` → RTX 4060 Ti / Driver 580.97 / CUDA 13.0 visible inside container |
| GPU runtime — graphics capability (libGLX_nvidia / Vulkan) | blocked_gpu_runtime_unavailable | **blocked_gpu_runtime_unavailable**（root cause confirmed as WSL2 architectural limit, not toolkit / config gap） | 詳見 Observed Output |
| Kit launcher inside GPU container | blocked before launcher | blocked before launcher | `kit-gpu-entrypoint.sh` line 36 (`ldconfig -p | grep -q "libGLX_nvidia.so.0"`) exit 75 |

## Required Evidence

| Field | Value |
|---|---|
| host_windows_driver | 580.97 |
| wsl_default_distro | Ubuntu-24.04 |
| wsl_systemd | running |
| docker_engine_version | 29.5.1 |
| docker_compose_plugin_version | v5.1.3 |
| nvidia_container_toolkit_version | 1.19.0 |
| nvidia_runtime_registered | true (`/etc/docker/daemon.json` includes `runtimes.nvidia.path = nvidia-container-runtime`) |
| cuda_passthrough_result | pass (container saw GPU 0 = RTX 4060 Ti, driver 580.97, CUDA 13.0) |
| graphics_lib_in_wsl_lib | absent (no `libGLX_nvidia.so.0`, no NVIDIA Vulkan ICD in `/usr/lib/wsl/lib/`) |
| graphics_capability_inside_container_result | blocked (with `NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,video` ldconfig grep returned empty) |
| kit_gpu_entrypoint_runtime_result | unchanged from 2026-05-15: blocked at `libGLX_nvidia.so.0` preflight |
| webrtc_runtime_result | not_observed (still gated behind the same Kit preflight) |
| docker_compose_repo_validate_result | pass — `docker compose -f compose.runtime-manager.yml --profile gpu config --quiet` returned 0 |

## Validation Commands

```bash
# In Ubuntu-24.04 WSL distro, current user (member of docker group)
docker --version
docker compose version
nvidia-ctk --version
sudo cat /etc/docker/daemon.json
sudo systemctl is-active docker

ls /usr/lib/wsl/lib/

# CUDA compute container — passes
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi

# Graphics capability container — still empty
docker run --rm --gpus all \
  -e NVIDIA_DRIVER_CAPABILITIES=graphics,utility,compute,video \
  nvidia/cuda:12.4.1-base-ubuntu22.04 \
  bash -c "ldconfig -p | grep -E 'libGLX_nvidia|libnvidia-glcore|libvulkan' || echo '(no graphics libs found)'"

# Repo compose validation
cd /mnt/c/Repos/active/iot/AI-BIM-governance
docker compose -f compose.runtime-manager.yml config --quiet
docker compose -f compose.runtime-manager.yml --profile gpu config --quiet
```

## Observed Output

`/usr/lib/wsl/lib/` 內容（WSL2 host paravirtualized libraries）：

```txt
libcuda.so
libcuda.so.1
libcuda.so.1.1
libcudadebugger.so.1
libd3d12.so
libd3d12core.so
libdxcore.so
libnvcuvid.so
libnvcuvid.so.1
libnvdxdlkernels.so
libnvidia-encode.so
libnvidia-encode.so.1
libnvidia-gpucomp.so
libnvidia-gpucomp.so.580.76.04
libnvidia-ml.so.1
libnvidia-ngx.so.1
libnvidia-opticalflow.so
libnvidia-opticalflow.so.1
libnvoptix.so.1
libnvoptix_loader.so.1
```

關鍵：**沒有 `libGLX_nvidia.so.*`、沒有 NVIDIA Vulkan ICD（`libGLX_nvidia.so.0` /
`libnvidia-glcore.so.*` / `libnvidia-rtcore.so.*` 一概不存在）**。NVIDIA Container
Toolkit `graphics` capability 啟用後仍只能 mount host 已有的 lib；host 沒有提供
就無法 mount。

CUDA passthrough 容器輸出（pass）：

```txt
NVIDIA-SMI 580.76.04   Driver Version: 580.97   CUDA Version: 13.0
GPU 0  NVIDIA GeForce RTX 4060 Ti   8188MiB   ...
```

Graphics capability 容器輸出（blocked / 一致）：

```txt
(no graphics libs found)
```

## Conclusion

1. 2026-05-15 標記的 `blocked_gpu_runtime_unavailable` 根因確認為 **WSL2 host 不提供
   Linux 格式 NVIDIA graphics driver libraries**（Vulkan ICD / GLX）。Windows NVIDIA
   驅動透過 `dxgkrnl` 把 GPU paravirtualize 進 WSL2 只暴露 CUDA / NVENC / OptiX /
   D3D12 stub，**從未** mount Linux GLX / Vulkan driver lib。
2. NVIDIA Container Toolkit 1.19.0 + `nvidia-ctk runtime configure` + `NVIDIA_DRIVER_CAPABILITIES=graphics,...`
   配置正確（`/etc/docker/daemon.json` 含 nvidia runtime；CUDA 容器可見 GPU）。
   但 toolkit 只能將 host 已有的 lib 進入容器；**它不能憑空產生 Linux 格式 graphics driver**。
3. `CODE_GOAL_DOCKER_KIT_MVP.md`「Kit 以 GPU container 運行；不能用 host Kit 假裝
   通過」**在此機物理上不可達**。要照 goal 跑 Docker GPU 需另一台原生 Linux GPU
   主機 / 雲端 GPU host；本機仍須走 host-native Kit (`bim-streaming-server\repo.bat
   build` → host-native streaming server)。
4. CUDA compute 範圍的 GPU container workload（例如未來 ML inference、CUDA-加速
   IFC 後處理）**現在可在 Ubuntu-24.04 WSL distro 內跑通**，可作為非渲染 GPU 工作
   的 host environment。

## Notes

- 此 follow-up 為 docs-only，不修改 spec、不修改 runtime code、不改 Dockerfile / compose。
- `kali-linux` distro 已 `wsl --unregister`，整 distro tarball 留底於 `D:\backup\kali-2026-05-20\kali-linux.tar`（重要 dotfiles / SSH key / hermes-agent untracked conversation log 已備份於 `D:\backup\kali-2026-05-20\dotfiles\` 與 `D:\backup\kali-2026-05-20\hermes-agent\`）。
- 後續若要把此機定位為「CUDA compute container」用途，建議另開 OpenSpec change
  正式記錄 host environment 與 supported workload 範圍（不在此 follow-up 範圍內）。
