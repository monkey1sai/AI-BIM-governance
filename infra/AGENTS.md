# infra/ Agent Rules

本檔是 `infra/` 的 repo-local agent 規範。根目錄 `AGENTS.md` 仍是跨 repo 邊界與資料流的上位規範。

## Role

`infra/` 是 **workspace 部署資產集中地**，承載 `compose.host-kit.yml` 與 `compose.runtime-manager.yml` 對應的 Dockerfile、nginx config、container entrypoint script。它不放 runtime 程式碼；只放 image build / container 啟動所需的設定資產。

## Owns

- `infra/docker/bim-streaming-server-gpu.Dockerfile` — host-kit / GPU container 影像
- `infra/docker/kit-manager-api.Dockerfile` / `infra/docker/kit-manager-web.Dockerfile` — Kit Manager 雙端影像
- `infra/docker/web-viewer-sample.Dockerfile` — viewer image
- `infra/docker/node-dev.Dockerfile` / `infra/docker/python-fastapi.Dockerfile` — 共用 base image
- `infra/docker/nginx-kit-manager.conf` — nginx reverse proxy 設定
- `infra/docker/kit-gpu-entrypoint.sh` — GPU container entrypoint

## Does Not Own

- compose YAML 檔本身（根目錄 `compose.host-kit.yml` / `compose.runtime-manager.yml` 屬於 workspace top-level）
- runtime 程式碼（屬於各 sub-repo）
- `.env*` 檔（屬於 workspace top-level，secrets 規則見根目錄 `AGENTS.md` §0.1）
- deploy 腳本（屬於 `scripts/`）

## Required Boundaries

- MUST 在 Dockerfile 內固定 base image tag 或 digest，不用 `latest`。
- MUST 用 `COPY` 進 image，不用 `ADD` 拉遠端 URL。
- MUST 沿用既有 base image（node-dev / python-fastapi）避免重複維護 dependency 安裝步驟。
- MUST NOT 在 Dockerfile / nginx config 內 inline secrets / token；走 build arg + runtime env。
- MUST NOT 把 sub-repo runtime 程式碼搬進 `infra/`；image build 應 mount / COPY sub-repo source。
- MUST NOT 為 NVIDIA Kit container 化（Kit GPU 渲染需 Windows 原生，規則見 memory `kit-gpu-render-needs-windows-native.md`）。

## Before Editing

- 先讀目標 `.Dockerfile` 與 `infra/docker/` 內相關 entrypoint / config。
- 改 image 內容 MUST 確認對應 compose service 引用路徑未斷。
- 改 base image 版本 MUST 跑對應 compose `docker compose -f compose.host-kit.yml config` + image build smoke 驗證。
- 新增 Dockerfile MUST 同步在根目錄 compose YAML 引用，避免孤兒 image。

## Verify

```powershell
docker compose -f compose.host-kit.yml config
docker compose -f compose.runtime-manager.yml config
```

config 命令僅靜態驗證 YAML 與 build context 路徑；完整 build smoke 走 `scripts/check-web-plane-docker.ps1` 與 `scripts/check-runtime-manager-docker.ps1`。

## Done Criteria

- 改動沒有把 `infra/` 變成 runtime 程式碼倉庫。
- `docker compose ... config` 通過，或清楚說明 YAML / build context 不一致原因。
- 若觸及 base image / entrypoint，PR 描述 MUST 列出影像 smoke 結果。
- 最終回覆列出 changed files、validation、known risks。
