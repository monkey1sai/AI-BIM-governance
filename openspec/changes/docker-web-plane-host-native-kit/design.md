## Context

現行 fast MVP 已能用 host-native `scripts/start-all.ps1` 啟動 `bim-review-coordinator`、`bim-streaming-server`、`web-viewer-sample`。其中 `8004` coordinator 與 `5173` viewer 是 Node/web plane，不需要 GPU；`49100` / `47998` Kit/WebRTC 與 `49101` host-native conversion authority 仍依賴 Windows host、NVIDIA driver、Kit build output、PowerShell `.ps1` 與 `.bat` semantics。

`compose.runtime-manager.yml` 已包含 coordinator/viewer container，也包含 GPU profile 的 `streaming-server` container。但使用者這次要的是 fast MVP 後的單機標準流程：**Docker 管 8004/5173，NVIDIA/Kit 不進 Docker，只依賴當下作業系統**。因此這個 change 不應推進 Linux Kit GPU container readiness，而是提供一條清楚、可部署、可驗證的 hybrid path。

核心 localhost 分界：

- container 內的 `127.0.0.1` 指 container 自己
- host OS 的 `127.0.0.1` 指 Windows/Linux host
- browser 看到的 `127.0.0.1` 指使用者電腦或部署 endpoint
- container 呼叫 host service 預設用 `host.docker.internal`

核心 artifact 分界：

- `storage/`：本地 smoke / demo 用 source IFC fixture，不是轉檔產物的長期倉庫
- `bim-streaming-server/_cache/host-native-conversion/jobs/`：host-native conversion authority 的 job state，git-ignored
- `bim-streaming-server/_cache/host-native-conversion/artifacts/<conversion_job_id>/`：預設轉檔輸出根目錄，git-ignored
- `STREAMING_CONVERSION_ARTIFACTS_ROOT` / `STREAMING_CONVERSION_JOBS_DIR`：部署者可改到正式資料磁碟或 volume
- `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`：coordinator / viewer 可解析的 artifact URL base

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

選擇：保留 `compose.runtime-manager.yml` 的 Docker GPU profile，新增 hybrid override（例如 `compose.host-kit.yml`）只覆蓋 coordinator/viewer 在 host-native Kit 模式下需要的 environment、ports 與 host bridge。

理由：

- base compose 仍服務 `runtime-manager-docker-kit-mvp` 的 Docker-first GPU goal。
- hybrid path 是另一條部署模式，不能破壞 GPU profile 的 evidence rule。
- override diff 較小，可逆，operator 可明確看出自己跑的是哪條模式。
- `ports` 必須明確 override base mappings，避免 `COORDINATOR_PORT` / `VIEWER_PORT` 被設定後仍同時發布預設 `8004` / `5173`。

替代方案：直接改 base compose 讓 coordinator 永遠指向 `host.docker.internal:49101`。拒絕，因為會破壞 GPU container profile 下的 `streaming-server:49101` 網路語意。

### Decision 2: coordinator container 呼叫 host conversion API 用 host bridge

選擇：hybrid mode 下，coordinator container 的 `STREAMING_CONVERSION_API_BASE` / `CONVERSION_API_BASE` SHALL 指向 host-native conversion authority，例如 `http://host.docker.internal:49101`。

理由：

- conversion authority 必須留在 host，才能呼叫 Windows PowerShell converter 與 Kit/HOOPS prerequisites。
- `streaming-server:49101` 只存在 Docker GPU profile，不適用於本 change。
- `host.docker.internal` 是 operator 最容易理解的 container-to-host bridge；Linux 可用 compose `extra_hosts: host.docker.internal:host-gateway` 補齊。

替代方案：把 conversion authority 包成 container，再 volume mount Windows launcher。拒絕，因為 PowerShell `.ps1`、`.bat`、Kit launcher semantics 與 Windows GPU graphics path 不是可攜 container contract。

### Decision 2A: host bridge profile matrix

選擇：hybrid mode SHALL 文件化並驗證 OS-specific host bridge profiles，而不是把 `host.docker.internal` 當成所有 Docker engine 都可靠的固定規則。

| Profile | Intended host | Container-to-host conversion URL | Host-native conversion bind expectation |
|---|---|---|---|
| `windows-docker-desktop` | Windows + Docker Desktop | `http://host.docker.internal:49101` | 若 health check 證明可達，default 可維持 loopback-first；否則 operator 明確設定可達 bind host |
| `linux-host-gateway` | Linux Docker Engine | `http://host.docker.internal:49101` with compose `extra_hosts: host.docker.internal:host-gateway` | loopback-only 不可達時，service SHALL listen on Docker bridge 可達的 host interface |
| `explicit-host-address` | LAN / deployment-specific | `http://<configured-host>:49101` | route、firewall、bind host configuration 由 operator 負責 |

理由：

- Windows Docker Desktop 與 Linux Docker Engine 對 host loopback 的暴露方式不同。
- 單一 hard-coded rule 不是對 Windows local demo 太寬鬆，就是對 Linux deployment 太脆弱。
- Check scripts 可以把猜測轉成具體 pass / blocked diagnosis。

安全邊界：

- Docker/hybrid mode 的 `0.0.0.0:8004` 只是 LAN/single-machine exposure mechanism，不是 production Internet contract。
- Public 或 cross-company exposure 需要另一個 edge design：reverse proxy、TLS/mTLS 或等價 service auth、firewall allowlist、operational logging。
- Fast MVP docs SHALL NOT 指示 operator 把未認證 coordinator endpoint 直接暴露到 Internet。

### Decision 3: stream config 使用 browser-visible endpoint

選擇：coordinator 回給 viewer/browser 的 Kit endpoint SHALL 是 browser-visible host，例如 `127.0.0.1:49100`（local single-machine）或部署者明確設定的 LAN/DNS host，而不是 `host.docker.internal` 或 container-local hostname。

理由：

- WebRTC 是 browser 連 Kit，不是 container 連 Kit。
- `host.docker.internal` 對 browser 未必可解析，也不是跨平台部署者應暴露的 public endpoint。
- 這個分界是避免「container 裡能 ping，browser 不能連」的主要設計點。
- `web-viewer-sample` 由 coordinator/session config 取得 stream endpoint；hybrid compose 不應保留未被 viewer 讀取的 `VITE_KIT_*` env，以免 operator 誤以為它們會影響 viewer。

### Decision 4: validation 分成四個 tier

選擇：hybrid check script 應至少輸出五個 tier：

1. `docker_web_plane_config`：compose config/build for coordinator/viewer
2. `docker_web_plane_health`：host can reach `8004/health` and `5173`
3. `container_to_host_conversion`：coordinator container can reach host `49101/health`
4. `host_native_kit_probe`：host/browser-visible `49100` reachable when Kit is expected
5. `runtime_visible_artifact_refs`：conversion result refs resolve to the artifact URLs that the consuming runtime/viewer will use

理由：

- `8004/5173 OK` 不代表 conversion bridge OK。
- `49100 listening` 不代表 WebRTC media/datachannel fully passed，但它是 hybrid deployment readiness 的 minimum host-native runtime probe。
- `conversion succeeded` 不代表 `model.usdc` / mapping / manifest refs are reachable from the runtime that will load them。
- runtime evidence tier 必須保留「不等於 Docker GPU Kit pass」的文字。
- 若 conversion result payload 缺少 artifact member，check script 應輸出 `blocked` / `missing=<ref>`，不得因 `Set-StrictMode -Version Latest` 的 missing property dereference 直接中止。

### Decision 5: 轉檔輸出由 streaming host-native authority 管理，coordinator 只保存 refs

選擇：hybrid mode 下，轉檔完成後的 derived artifacts SHALL 留在 host-native conversion authority 的 artifacts root，以 `<artifacts_root>/<conversion_job_id>/` 隔離；每個 succeeded job 至少發布：

- `model.usdc`
- `element_mapping.json`
- `entity_index.json`
- `metadata.json`

authority 對外回傳 metadata refs / URLs，例如：

- `usdc_ref = <public_artifacts_url>/<conversion_job_id>/model.usdc`
- `element_mapping_ref = <public_artifacts_url>/<conversion_job_id>/element_mapping.json`
- `manifest_ref = <public_artifacts_url>/<conversion_job_id>/metadata.json`

理由：

- `.usdc` 可能很大，不應由 coordinator 複製、回拋或塞進 callback outbox。
- B 方案要求公司雲端 callback 是 metadata-only；真正檔案本體仍屬 data-plane / streaming authority。
- per-job directory 讓 demo、debug、清理、重跑比「全部丟在 storage 根目錄」更可控。
- 預設 `_cache/` 可避免本機 demo 產物污染 git working tree；正式部署再用 env 指到 durable disk / volume。

檔案管理規則：

- `storage/` 只放 source IFC fixture；derived output 不回寫到 `storage/`。
- 每個 `conversion_job_id` 的 output directory 視為該 job 的 immutable publish root；成功後不得用同一路徑悄悄覆蓋另一個 model version。
- cleanup 預設為 operator-driven；runbook SHALL 說明 artifacts root、jobs dir、如何查目前磁碟占用、如何刪除 demo 產物。實作若新增自動 retention，必須先避免刪除仍被 review session / callback outbox 引用的 artifacts。
- 文件與 logs SHALL 顯示路徑與 ref，但不得把大型 artifact bytes 或 secret token 輸出到 log。

## Risks / Trade-offs

- **Risk: `host.docker.internal` 在不同 Docker engine 行為不同。** Mitigation：runbook SHALL document Windows Docker Desktop default path and Linux `host-gateway` override；check script SHALL fail with an explicit container-to-host diagnostic。
- **Risk: Linux container 無法連到只 bind loopback 的 host service。** Mitigation：Linux profile SHALL include `host-gateway` or explicit host address guidance，且 check output 必須說明目標機器是否需要 widen `STREAMING_CONVERSION_HOST`。
- **Risk: operator 誤把 hybrid pass 當成 Docker GPU Kit pass。** Mitigation：spec/runbook/check output SHALL label this as `hybrid_web_plane_host_native_runtime`，且 SHALL NOT update `runtime_image_kit_launcher` to passed。
- **Risk: browser-facing endpoint 與 container-facing endpoint 被混用。** Mitigation：compose env names and docs SHALL separate `HOST_CONVERSION_API_BASE` from `KIT_SIGNALING_HOST` / browser stream config。
- **Risk: artifact refs 使用只有單一 process 可解析的 localhost base。** Mitigation：runbook SHALL explain `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` as a runtime-visible URL，且 check script SHALL test at least `model.usdc`、mapping、manifest refs when a conversion result exists。
- **Risk: Docker web plane 啟動時 host-native services 尚未啟動。** Mitigation：start script MAY allow web plane to start，但 check script SHALL report `container_to_host_conversion=blocked` or `host_native_kit_probe=blocked` with next command。
- **Risk: local `.env` secrets leak into docs/logs。** Mitigation：templates SHALL use `.env.*.example`；scripts SHALL print variable names/status only，不印 secret values。
- **Risk: 重複 demo conversion 讓 artifacts 累積並填滿磁碟。** Mitigation：runbook/check output SHALL identify `STREAMING_CONVERSION_ARTIFACTS_ROOT` and document manual cleanup / retention expectations；自動刪除不在本 change 範圍，除非能證明沒有 active session/outbox reference。
- **Risk: `0.0.0.0:8004` 被誤認為 production public exposure。** Mitigation：docs SHALL label it LAN/single-machine exposure only，public/cross-company exposure defer 到 separate edge-security design。

## Migration Plan

1. Add hybrid compose override and `.env` example with non-secret defaults。
2. Add start/check helper scripts for Docker web plane hybrid mode。
3. Update fast MVP runbook to include this path as post-fast-MVP deployable single-machine standard flow。
4. Validate compose config and health checks locally。
5. Keep existing host-only `scripts/start-all.ps1` and Docker GPU profile intact。

Rollback：停止 hybrid compose stack，移除本 change 新增的 override/scripts/docs。因為沒有 data schema 或 public API 變更，rollback 只需要 file-level revert。

## Open Questions

- Current hybrid single-machine scope 沒有未決問題。Linux host bridge 已收斂為 profile matrix：使用 `host-gateway` 或 explicit host address，再由 check script 回報 loopback-only binding 在該機器是否足夠，或是否需要 widen `STREAMING_CONVERSION_HOST`。
- Public Internet / cross-company exposure 刻意不納入本 change；若需要，應另開 edge-security OpenSpec change。
