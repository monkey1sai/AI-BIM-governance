# AI-BIM Runtime Manager — Docker Kit Manager MVP package

本包把第一版 MVP 改成 Docker-first：

- Docker Compose 是唯一 MVP 驗收入口。
- 原 host-local `uvicorn` / `npm run dev` / host Kit launcher 降級為 legacy/debug。
- 新增 Kit 管理前端 `apps/kit-manager-web`。
- 新增 Kit 管理 API `services/kit-manager-api`。
- 一個 Kit instance 可選 k 個 `.usdc` 檔案，建立 open/close session state。
- GPU Kit container 以 `runtime` profile 啟動；若 Linux Kit launcher 尚未存在，狀態必須是 `blocked`，不能 fallback host-local。

套用方式：

```powershell
cd C:\Repos\active\iot\AI-BIM-governance
git switch main
git pull --ff-only
git switch -c codex/openspec/introduce-ai-bim-runtime-manager-docker-kit-mvp

# 將本包內容複製到 repo root，保留路徑
Copy-Item -Recurse .\* C:\Repos\active\iot\AI-BIM-governance\

Copy-Item .env.runtime-manager.docker.example .env.runtime-manager.docker
.\scripts\start-runtime-manager-docker.ps1 -Build -WithGpu
.\scripts\check-runtime-manager-docker.ps1 -WithGpu
```

進入 Kit 管理前端：

```txt
http://127.0.0.1:5174
```
