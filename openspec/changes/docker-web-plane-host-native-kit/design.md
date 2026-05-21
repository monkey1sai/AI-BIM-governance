## Context

現行 fast MVP 已能用 host-native `scripts/start-all.ps1` 啟動 `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample`。其中 `8004` coordinator 與 `5173` viewer 是 Node/web plane，不需要 GPU；`49100` / `47998` Kit/WebRTC 與 `49101` host-native conversion authority 仍依賴 Windows host、NVIDIA driver、Kit build output、PowerShell `.ps1` 與 `.bat` semantics。

`compose.runtime-manager.yml` 已包含 coordinator/viewer container，也包含 GPU profile 的 `streaming-server` container。但使用者這次要的是 fast MVP 後的單機標準流程：**Docker 管 8004/5173，NVIDIA/Kit 不進 Docker，只依賴當下作業系統**。因此這個 change 不應推進 Linux Kit GPU container readiness，而是提供一條清楚、可部署、可驗證的 hybrid path。

核心 localhost 分界：

- container 內的 `127.0.0.1` 指 container 自己
- host OS 的 `127.0.0.1` 指 Windows/Linux host
- browser 看到的 `127.0.0.1` 指使用者電腦或部署 endpoint
- container 呼叫 host service 預設用 `host.docker.internal`

## Goals / Non-Goals

**Goals:**

- 建立 `Docker Web Plane + Host-native NVIDIA Runtime` 的 OpenSpec contract。
- 讓 operator 可用 Docker Compose 啟動 coordinator/viewer，並保持 host-native Kit/WebRTC/conversion authority。
- 明確規格化 coordinator container 到 host conversion API 的橋接方式。
- 明確規格化 browser-facing stream endpoint 的 address semantics。
- 提供最小可驗證 helper script / runbook：compose config、container health、container-to-host `49101`、host/browser-to-Kit `49100`。
- 保持 B 方案 repo 邊界：coordinator 是唯一外部 IFC-ready intake，streaming server 是 conversion + Kit runtime authority，viewer 只做 browser client。

**Non-Goals:**

- 不把 `bim-streaming-server` Kit/WebRTC 或 converter 放進 Docker。
- 不修改 Docker GPU Kit MVP 的 pass criteria，不把 host-native Kit 算成 `runtime_image_kit_launcher=passed`。
- 不新增 real `_bim-control` 或 real IFC Worker runtime。
- 不新增 production dependency 或新資料庫。
- 不把 `.env` 實際機密值寫進 docs、compose 或 logs。

## Decisions

### Decision 1: 新增 compose override，而不是重寫 base compose

選擇：保留 `compose.runtime-manager.yml` 的 Docker GPU profile，新增 hybrid override（例如 `compose.host-kit.yml`）只覆蓋 coordinator/viewer 在 host-native Kit 模式下需要的 environment 與 host bridge。

理由：

- base compose 仍服務 `runtime-manager-docker-kit-mvp` 的 Docker-first GPU goal。
- hybrid path 是另一條部署模式，不能破壞 GPU profile 的 evidence rule。
- override diff 較小，可逆，operator 可明確看出自己跑的是哪條模式。

替代方案：直接改 base compose 讓 coordinator 永遠指向 `host.docker.internal:49101`。拒絕，因為會破壞 GPU container profile 下的 `streaming-server:49101` 網路語意。

### Decision 2: coordinator container 呼叫 host conversion API 用 host bridge

選擇：hybrid mode 下，coordinator container 的 `STREAMING_CONVERSION_API_BASE` / `CONVERSION_API_BASE` SHALL 指向 host-native conversion authority，例如 `http://host.docker.internal:49101`。

理由：

- conversion authority 必須留在 host，才能呼叫 Windows PowerShell converter 與 Kit/HOOPS prerequisites。
- `streaming-server:49101` 只存在 Docker GPU profile，不適用於本 change。
- `host.docker.internal` 是 operator 最容易理解的 container-to-host bridge；Linux 可用 compose `extra_hosts: host.docker.internal:host-gateway` 補齊。

替代方案：把 conversion authority 包成 container，再 volume mount Windows launcher。拒絕，因為 PowerShell/.bat/Kit launcher semantics 與 Windows GPU graphics path 不是可攜 container contract。

### Decision 3: stream config 使用 browser-visible endpoint

選擇：coordinator 回給 viewer/browser 的 Kit endpoint SHALL 是 browser-visible host，例如 `127.0.0.1:49100`（local single-machine）或部署者明確設定的 LAN/DNS host，而不是 `host.docker.internal` 或 container-local hostname。

理由：

- WebRTC 是 browser 連 Kit，不是 container 連 Kit。
- `host.docker.internal` 對 browser 未必可解析，也不是跨平台部署者應暴露的 public endpoint。
- 這個分界是避免「container 裡能 ping，browser 不能連」的主要設計點。

### Decision 4: validation 分成四個 tier

選擇：hybrid check script 應至少輸出四個 tier：

1. `docker_web_plane_config`：compose config/build for coordinator/viewer
2. `docker_web_plane_health`：host can reach `8004/health` and `5173`
3. `container_to_host_conversion`：coordinator container can reach host `49101/health`
4. `host_native_kit_probe`：host/browser-visible `49100` reachable when Kit is expected

理由：

- `8004/5173 OK` 不代表 conversion bridge OK。
- `49100 listening` 不代表 WebRTC media/datachannel fully passed，但它是 hybrid deployment readiness 的 minimum host-native runtime probe。
- runtime evidence tier 必須保留「不等於 Docker GPU Kit pass」的文字。

## Risks / Trade-offs

- **Risk: `host.docker.internal` 在不同 Docker engine 行為不同。** Mitigation: runbook SHALL document Windows Docker Desktop default path and Linux `host-gateway` override; check script SHALL fail with an explicit container-to-host diagnostic.
- **Risk: operator 誤把 hybrid pass 當成 Docker GPU Kit pass。** Mitigation: spec/runbook/check output SHALL label this as `hybrid_web_plane_host_native_runtime` and SHALL NOT update `runtime_image_kit_launcher` to passed.
- **Risk: browser-facing endpoint 與 container-facing endpoint 被混用。** Mitigation: compose env names and docs SHALL separate `HOST_CONVERSION_API_BASE` from `KIT_SIGNALING_HOST` / browser stream config.
- **Risk: host-native services are not running when Docker web plane starts.** Mitigation: start script MAY allow web plane to start, but check script SHALL report `container_to_host_conversion=blocked` or `host_native_kit_probe=blocked` with next command.
- **Risk: local `.env` secrets leak into docs/logs.** Mitigation: templates SHALL use `.env.*.example`; scripts SHALL print variable names/status only, not secret values.

## Migration Plan

1. Add hybrid compose override and `.env` example with non-secret defaults.
2. Add start/check helper scripts for Docker web plane hybrid mode.
3. Update fast MVP runbook to include this path as post-fast-MVP deployable single-machine standard flow.
4. Validate compose config and health checks locally.
5. Keep existing host-only `scripts/start-all.ps1` and Docker GPU profile intact.

Rollback: stop the hybrid compose stack and remove the override/scripts/docs introduced by this change. Since no data schema or public API changes are introduced, rollback is file-level only.

## Open Questions

- Whether Linux host deployments should require `STREAMING_CONVERSION_HOST=0.0.0.0` for host-native `49101`, or whether `host-gateway` plus host firewall settings are enough in the target environment. The implementation should document the chosen local default and surface failures clearly rather than guessing.
