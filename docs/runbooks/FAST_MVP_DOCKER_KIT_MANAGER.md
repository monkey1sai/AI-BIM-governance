# Fast MVP Docker Kit Manager Runbook

## Goal

第一版 MVP 以 Docker container 運作。原本 host-local 啟動方式不再作為 MVP 驗收。

## Start

```powershell
Copy-Item .env.runtime-manager.docker.example .env.runtime-manager.docker
.\scripts\start-runtime-manager-docker.ps1 -Build
.\scripts\check-runtime-manager-docker.ps1
```

GPU profile:

```powershell
.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu
.\scripts\check-runtime-manager-docker.ps1 -WithGpu
```

## Use

1. 放 `.usdc` 到 `storage/`。
2. 開 `http://127.0.0.1:5174`。
3. 選 k 個 USDC。
4. 按 `Open selected in Kit`。
5. 按 `Close instance` 關閉目前 instance state。
6. 開 `http://127.0.0.1:5173` 檢查 viewer。

## Evidence rules

- `streaming-server` 沒有 Linux Kit launcher 時，結果是 `blocked`。
- GPU container 看不到 GPU 時，結果是 `blocked`。
- 不可用 host-local Kit 取代 Docker GPU Kit。
- 不可把 `recorded_only` 或 `blocked_runtime_control_unavailable` 寫成 pass。
