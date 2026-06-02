## MODIFIED Requirements

### Requirement: Mode C hybrid 一鍵部屬入口

本 repository SHALL 提供 `scripts\deploy.ps1` 作為 Mode C(web-plane Docker + host-native Kit)的一鍵部屬入口,在 Windows host + NVIDIA GPU 環境用一條指令把 coordinator、viewer、host-native conversion-service、host-native Kit streaming 四個服務全部帶到 demo-ready。

`deploy.ps1` 解析 env file 時,當正式 `.env.web-plane.host-kit` 不存在而 fallback 到 `.env.web-plane.host-kit.example` SHALL 發出 `Write-Warning`(非靜默 fallback),且當連 `.example` 都不存在時 SHALL 明確 `throw` 失敗,MUST NOT 帶不存在的 `--env-file` 讓 docker compose 以空值啟動誤配置拓樸。既有 startup 入口 `start-web-plane-docker.ps1` 不在本 requirement 改動範圍(維持 0 行改動)。

#### Scenario: 冷啟動跑 deploy.ps1

- **WHEN** 使用者在 cold tree(.venv / node_modules / .env.web-plane.host-kit / docker image 任一缺)上跑 `.\scripts\deploy.ps1`
- **THEN** deploy.ps1 MUST 依 Phase 1 → 2 → 3 → 4 → 5 順序執行
- **AND** Phase 4 MUST 嚴格按 4a(host-native conversion-service)→ 4b(host-native Kit)→ 4c(docker compose up coordinator + viewer)順序啟動
- **AND** 全部 ready 後印 Final Summary 與 Next 區塊(viewer 入口 URL)並退 0

#### Scenario: deploy.ps1 不替換既有 startup 入口

- **WHEN** deploy.ps1 加入 repository
- **THEN** `scripts\start-all.ps1`(Mode A)、`scripts\start-runtime-manager-docker.ps1`(Mode B)、`scripts\start-web-plane-docker.ps1`(Mode C 既有 docker entrypoint)、`scripts\stop-all.ps1`、`scripts\stop-runtime-manager-docker.ps1`、`compose.runtime-manager.yml`、`compose.host-kit.yml` MUST 完全 0 行改動
- **AND** Phase 4c MUST 透過 `Start-Process powershell.exe -File start-web-plane-docker.ps1` 隔離呼叫既有 docker entrypoint,完全沿用其行為

#### Scenario: Env file fallback warns and missing example fails

- **WHEN** deploy.ps1 解析 env file,正式 `.env.web-plane.host-kit` 不存在而 fallback 到 `.env.web-plane.host-kit.example`
- **THEN** deploy.ps1 SHALL 發 `Write-Warning`(提示 dev/demo only、應設正式 `.env`),MUST NOT 靜默 fallback
- **AND** 當連 `.example` 都不存在時 deploy.ps1 SHALL `throw` 明確失敗,MUST NOT 帶不存在的 `--env-file` 讓 docker compose 用空值啟動誤配置 `PUBLIC_HOST`/`STORAGE_ROOT` 拓樸
- **AND** 此 env fallback 行為僅約束 `deploy.ps1`(及 diagnostic `check-web-plane-docker.ps1`),既有 `start-web-plane-docker.ps1` 維持 0 行改動
