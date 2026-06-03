# one-click-deploy-hybrid Specification

## Purpose
TBD - created by archiving change add-one-click-deploy-hybrid. Update Purpose after archive.
## Requirements
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

### Requirement: Phase 1 preflight 必須 read-only

deploy.ps1 SHALL 在 Phase 1 只執行 read-only audit,不對檔案系統 / docker / host-native process / .env 內容做任何寫入。

#### Scenario: Preflight 各 module 都是 read-only

- **WHEN** Phase 1 跑 preflight modules
- **THEN** `preflight-docker` / `preflight-host-native` / `preflight-env` / `preflight-ports` / `preflight-volume-alignment` MUST 只回 audit 結構,不動 .env、不殺 process、不動 docker compose
- **AND** audit 結果 MUST 序列化到 `scripts\.run\deploy-audit.json` 供 CI / 人類 review

#### Scenario: Phase 1 偵測到 unfixable hard fail

- **WHEN** preflight 顯示沒裝 Docker / nvidia-smi 不在 PATH / Kit launcher 路徑缺 / Volume `RUNTIME_STORAGE_ROOT` leaf 不是 `storage` / .env 系列全缺其中之一
- **THEN** deploy.ps1 MUST 印 `[fail ]` 與安裝指引或修正路徑,退 1
- **AND** MUST NOT 跑 Phase 2 auto-fix / Phase 4 startup

### Requirement: Phase 2 auto-fix 安全項目邊界

deploy.ps1 SHALL 在 Phase 2 只自動執行安全範疇的修補動作:
- 建 `.venv`、`pip install -r requirements.txt`
- `.env` / `.env.example` 系列的 missing-key append(取 example 預設值)
- `Copy-Item .env.web-plane.host-kit.example -> .env.web-plane.host-kit`
- 對 `.env.web-plane.host-kit` append `RUNTIME_STORAGE_ROOT=<RepoRoot>\storage`(若 key 缺)
- 清 stale `scripts\.run\*.pid`(對應 process 已死)
- 建本地目錄 `scripts\.run\` / `logs\nvstreamer\` / `storage\ifc-cache\`
- `docker compose rm -f -s coordinator viewer`(僅當 web-plane 未 running)
- `docker compose build coordinator viewer`(僅當 image 缺 或 `-Build` 強制)

#### Scenario: .env 已有 key 的實值

- **WHEN** 目標 .env 已存在某 key
- **THEN** Phase 2 MUST NOT 覆寫該 key 的實值,即使值是 placeholder
- **AND** 該 key MUST 不出現在 missing-key audit list

#### Scenario: -DryRun 跑 Phase 2

- **WHEN** deploy.ps1 帶 `-DryRun`
- **THEN** Phase 2 MUST 印 `[skip ] Phase 2 auto-fix DRY-RUN`
- **AND** MUST 不執行任何 fix 動作
- **AND** Phase 4 / 5 MUST 完全跳過
- **AND** 退 0

#### Scenario: web-plane 已 running 跑 deploy.ps1

- **WHEN** `docker compose ps --status running -q coordinator viewer` 回兩個 container id
- **THEN** Phase 2 docker compose rm + build MUST 印 `[skip ]`,不對 already-running container 動手
- **AND** Phase 4c docker compose up MUST 印 `[skip ]`
- **AND** 整體 Phase 2 fixActions count MUST = 0

### Requirement: Phase 3 互動 guard 不誤殺自己的 process

deploy.ps1 SHALL 在 Phase 3 互動前 re-audit ports,並把 Docker Desktop 自己管理的 port forwarder process 與 deploy.ps1 自己 spawn 的 child process 排除出「陌生 PID」候選。

#### Scenario: Docker port forwarder 不被當陌生 PID

- **WHEN** :8004 / :5173 LISTEN owner process name 在 `{wslrelay.exe, com.docker.backend.exe, docker.exe, vpnkit.exe, vpnkit-bridge.exe}` 內
- **THEN** Phase 3 MUST 不要求 Stop-Process
- **AND** Phase 3 MUST 印 `no dangerous action needed`(或對齊的訊息)

#### Scenario: deploy.ps1 自己 spawn 的 child process 不被當陌生 PID

- **WHEN** :49100 LISTEN owner 是 `scripts\.run\bim-streaming-server.pid` 內 PowerShell wrapper 的 child / grand-child(例如 `kit.exe` 透過 `cmd.exe` 啟動,parent chain 回到 wrapper PID)
- **THEN** `Get-PidsFromRunDir` MUST 沿 `Win32_Process.ParentProcessId` 遞迴展開所有子孫
- **AND** Phase 1 audit MUST 標 `ourPidFile=true`、Phase 3 MUST 不問 Stop-Process

#### Scenario: 真正陌生 PID 佔 port

- **WHEN** :49100 LISTEN owner 不在 PID-file 子孫 set 內,且 process name 不在 Docker forwarder whitelist
- **THEN** Phase 3 MUST 問 `Stop-Process? (y/N)`,使用者選 `N` MUST 退 3
- **AND** `-Force` 旗標 MUST 視同 `y` 不再問

### Requirement: Phase 4 嚴格依賴順序

deploy.ps1 SHALL 在 Phase 4 嚴格按 4a → 4b → 4c 順序啟動,因為 coordinator container 啟動時會立刻嘗試 `host.docker.internal:49101/health`,host-native conversion-service 必須先 LISTEN。

#### Scenario: Phase 4a 啟動 host-native conversion-service

- **WHEN** Phase 4a 啟動 conversion-service
- **THEN** deploy.ps1 MUST 在 spawn 子 process 前 export `$env:STORAGE_ROOT = $RuntimeStorageRoot`(對齊 docker bind mount source);MUST export `$env:STREAMING_CONVERSION_WORK_DIR = Split-Path -Parent $RuntimeStorageRoot`
- **AND** MUST 等 `http://127.0.0.1:49101/health` 回 200(timeout 30s);timeout 視為 stage=4a fail,退 4

#### Scenario: Phase 4b 啟動 host-native Kit streaming

- **WHEN** Phase 4b 啟動 Kit
- **THEN** deploy.ps1 MUST 跑 `start-streaming-server.ps1 -ResetUser -SkipAutoLoad`(對齊 memory `webrtc-no-video-reset-user-recovery`)
- **AND** MUST 等 `:49100` LISTEN + log 內出現 `app ready` / `Application started` / `launching Linux Kit` / `Streaming started` 任一 keyword(timeout 90s)
- **AND** timeout 視為 stage=4b fail,退 4

#### Scenario: Phase 4c 啟動 docker web plane

- **WHEN** Phase 4c 啟動 docker compose
- **THEN** deploy.ps1 MUST 透過 `Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',<start-web-plane-docker.ps1>,'-EnvFile',<resolvedEnvFile>) -RedirectStandardOutput <up.log> -RedirectStandardError <up.err.log> -Wait` 隔離子 script
- **AND** 子 process exit code 非 0 視為 stage=4c fail,退 4

#### Scenario: 任一 Phase 4 stage fail 後不自動 rollback

- **WHEN** Phase 4 任一 stage 退非 0
- **THEN** deploy.ps1 MUST NOT 自動 stop 已啟的 host-native conversion-service / Kit / docker container
- **AND** Final Summary MUST 列出 `What might be running` 與每個 PID-file 的 PID,並印手動 stop 指令(`stop-all.ps1` + `docker compose ... down`)

### Requirement: Volume 對齊方案 A

deploy.ps1 SHALL 用 `.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` 作為 docker bind mount source 與 host-native conversion-service `STORAGE_ROOT` 的 ground truth,讓 coordinator container 寫進 dispatch payload 的 `host_local_path` 落在 host-native conversion-service 的 sandbox 內。

#### Scenario: RUNTIME_STORAGE_ROOT 對齊 sandbox

- **WHEN** `.env.web-plane.host-kit` 有 `RUNTIME_STORAGE_ROOT=<絕對路徑>` 且 leaf = `storage`
- **THEN** Phase 1 audit MUST 回 `volumeAlignment.status = ALIGNED`
- **AND** Phase 4a MUST export `$env:STORAGE_ROOT` = `RUNTIME_STORAGE_ROOT` 值
- **AND** coordinator container 內 dispatch host-native conversion 時,`host_local_path = <RUNTIME_STORAGE_ROOT>\ifc-cache\<job>\source.ifc` MUST 落在 sandbox 內,通過 `ifc2usdc_powershell_adapter.py` 的 `storage_root` 驗證

#### Scenario: RUNTIME_STORAGE_ROOT 缺 key

- **WHEN** `.env.web-plane.host-kit` 沒 `RUNTIME_STORAGE_ROOT` key
- **THEN** Phase 1 audit MUST 回 `volumeAlignment.status = MISSING_KEY`
- **AND** Phase 2 MUST append `RUNTIME_STORAGE_ROOT=<RepoRoot>\storage`(絕對路徑)到目標 env file
- **AND** Phase 2 MUST 重 audit 確認變成 `ALIGNED`

#### Scenario: RUNTIME_STORAGE_ROOT leaf 不是 storage

- **WHEN** `.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` leaf 不是 `storage`(例:`D:\bim-share\ifc-bucket`)
- **THEN** Phase 1 audit MUST 回 `volumeAlignment.status = WRONG_LEAF`
- **AND** deploy.ps1 MUST 退 1,印明確 hint 指向修 .env(或改 leaf 名為 `storage`)
- **AND** MUST NOT 跑 Phase 2 / Phase 4

### Requirement: Idempotent re-run

deploy.ps1 SHALL 支援熱重跑:第二次跑時若 host-native + docker container 都還是上一輪我們自己啟的,Phase 2 / Phase 4 全部 `[skip ]`,Phase 5 verify 全 200,退 0,總時 < 30 秒。

#### Scenario: 重跑 deploy.ps1 不破壞已 running 服務

- **WHEN** 上一輪 deploy.ps1 成功,所有服務還活著,使用者再跑一次 deploy.ps1
- **THEN** Phase 1 MUST 標 host-native ports 為 `ourPidFile=true`(透過子孫 PID 展開)、Docker bind ports 不要求互動
- **AND** Phase 2 docker rm / build / Phase 4a / 4b / 4c MUST 全部 `[skip ]`
- **AND** Phase 5 verify coordinator / viewer / conversion MUST 全 200
- **AND** 退 0、Elapsed < 30 秒

### Requirement: 退出碼語意

deploy.ps1 SHALL 用結構化退出碼讓 CI / 自動化系統能解析失敗階段。

#### Scenario: 退出碼對應

- **WHEN** deploy.ps1 結束
- **THEN** 退出碼 MUST 符合:`0` = 全 OK 或 `-DryRun` 完成;`1` = Phase 1 unfixable;`2` = Phase 2 auto-fix 失敗(venv / pip / .env merge / docker build);`3` = Phase 3 互動 guard 被使用者拒絕;`4` = Phase 4 任一 stage 失敗;`5` = Phase 5 strict verify 失敗(僅 `-StrictPostVerify`)
- **AND** Phase 4 內部 stage 失敗時 log MUST 標 `stage=4a` / `stage=4b` / `stage=4c`

### Requirement: 三層 safety 紅線

deploy.ps1 SHALL 嚴格遵守 `AGENTS.md §0.1` 與 `CLAUDE.md` 規範的三層 safety:A 自動做(安全項目)/ B 問才做(動到活著的別人 process)/ C 永遠不做。

#### Scenario: C 永遠不做的紅線

- **WHEN** deploy.ps1 跑任何 phase
- **THEN** MUST NOT 修改 `.env` 已有 key 的實值
- **AND** MUST NOT 寫任何 secret / credential / private key 到 `.env` 系列
- **AND** MUST NOT 安裝 Docker Desktop / NVIDIA driver / Node / Python / Kit Launcher 本身
- **AND** MUST NOT 修改 `compose.runtime-manager.yml` / `compose.host-kit.yml`
- **AND** MUST NOT 刪 docker named volume 或 `storage\` 內 IFC / USDC bytes
- **AND** MUST NOT 動 git(add / commit / push / stash)
- **AND** MUST NOT 修改 `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1`
- **AND** MUST NOT kill PID-file 內 process 或 docker compose down(屬於 stop scripts 職責)
- **AND** MUST NOT 即使 `-Force` 旗標也突破以上紅線

### Requirement: Final Summary 可診斷性

deploy.ps1 SHALL 印結構化 Final Summary,成功 / 失敗兩種情況都有對應的「下一步」指令給使用者。失敗時 deploy.ps1 SHALL 走到 Print-FinalSummary 才退出,MUST NOT 因 strict-mode（`Set-StrictMode -Version Latest`）下 build / probe 失敗路徑的未初始化變數觸發 `VariableNotDefined` terminating error 而繞過 Final Summary。

Final Summary 與 idempotent re-run 路徑 SHALL 對空 / 缺失的 `scripts\.run\*.pid` 與 runtime signature 檔（如 `bim-streaming-server.params.json` / `bim-streaming-conversion-service.params.json`）做 null-safe 讀取:對「空檔 / 不存在檔」`Get-Content` 回 `$null` 時 MUST NOT 直接呼叫 `.Trim()`（strict-mode 下對 `$null` 的方法呼叫為 terminating error;`-ErrorAction SilentlyContinue` 只壓 `Get-Content` cmdlet 自身錯誤,壓不住後續對 `$null` 的方法呼叫）。失敗診斷的「What might be running」清單對空 / 缺 `.pid` SHALL 顯示佔位字串（如 `(empty)`）而非 crash;runtime signature 比對對「存在但空」的 signature 檔 SHALL 視為不相符（回 `$false`,走重寫 signature 路徑）而非在印出診斷前 throw。

#### Scenario: 成功完成

- **WHEN** deploy.ps1 退 0
- **THEN** Final Summary MUST 印 `=== Deploy Summary ===` 標題、`Mode: hybrid (web-plane Docker + host-native Kit)`、Elapsed、EnvFile、Storage root + status
- **AND** MUST 印 `Next:` 區塊含 coordinator UI URL `http://127.0.0.1:8004/ui`、tail Kit log 指令、stop all 指令

#### Scenario: 任何階段失敗

- **WHEN** deploy.ps1 退非 0
- **THEN** Final Summary MUST 印 `Status: FAILED (exit <code>, <FailedPhase>)`
- **AND** MUST 列出 `scripts\.run\*.pid` 內仍活著的 process,印 `What might be running (NOT auto-rolled-back)` 段落
- **AND** MUST 印 `To recover:` 區塊含 stop scripts 與 re-run 指令(含 `-Force`)

#### Scenario: Build 或 probe 失敗不得繞過 Final Summary

- **WHEN** Phase 2/4 的 build(`repo.bat build` / docker build)或 process probe 失敗,使對應 exit-code / id 變數(如 `$kitBuildExit` / `$buildExit` / `$runningIds`)在 `Set-StrictMode -Version Latest` 下可能未賦值就被讀取
- **THEN** deploy.ps1 SHALL 對這些變數提供 fail-safe 初始化(失敗以非零值 / 空集表示),使失敗路徑仍走到 Print-FinalSummary 並以非零 exit 回報
- **AND** MUST NOT 因 `VariableNotDefined` terminating error 在印出 Final Summary 之前 crash,吃掉失敗診斷摘要

#### Scenario: 空或缺失的 .pid / signature 檔不得讓診斷路徑 null-deref crash

- **WHEN** Print-FinalSummary 失敗分支列 `scripts\.run\*.pid` 時遇到空 / 只含空白的 `.pid` 檔,或 idempotent re-run 比對 runtime signature 時遇到「存在但空」的 signature 檔
- **THEN** deploy.ps1 SHALL 對 `Get-Content` 回傳值做 null/empty guard（空 / 缺值落到佔位字串或空字串）後才呼叫 `.Trim()`,MUST NOT 對 `$null` 直接呼叫 `.Trim()` 觸發 strict-mode terminating error
- **AND** Print-FinalSummary 對空 / 缺 `.pid` MUST 仍印出該行 summary（PID 顯示為 `(empty)` 等佔位字串）而非在印出失敗診斷前 crash
- **AND** runtime signature 比對對「存在但空」的 signature 檔 MUST 回 `$false`（視為不相符,走重寫 signature 路徑）而非 throw

### Requirement: Stage allowed-hosts SHALL be configurable with an explicit empty-value warning

coordinator / conversion authority 載入 HTTP stage 時所允許的來源 host 清單(`BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS`)SHALL 可由部署設定推導:`start-streaming-server.ps1` SHALL 接受 `-AllowedStageHosts` 參數,並 SHALL 在「參數非空 → 既有 env → 否則內建預設」三分支間選擇來源。當 allowed-hosts 最終落到內建預設(operator 未經參數或 env 設定)時,系統 SHALL 發出告警(PowerShell `Write-Warning` / Python `carb.log_warn`),提示 env 未設、正使用 localhost-only 預設、coordinator 非 localhost 時須顯式設定,MUST NOT 靜默 fallback。內建預設清單 SHALL 只含現役 host-native conversion authority(`127.0.0.1:49101` / `localhost:49101`),MUST NOT 含已退役服務的 port。host 強制檢查的拒絕語意(來源不在清單即拒載)SHALL 維持不變。

#### Scenario: Empty allowed-hosts env emits a warning instead of silent fallback

- **WHEN** `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` 未設且未經 `-AllowedStageHosts` 參數提供
- **THEN** 系統 SHALL 發出告警(`Write-Warning` / `carb.log_warn`),提示正使用 localhost-only 內建預設、coordinator 非 localhost 時須設定
- **AND** SHALL NOT 靜默套用預設而不告警

#### Scenario: Built-in default excludes retired service ports

- **WHEN** allowed-hosts 落到內建預設(env 與參數皆未提供)
- **THEN** 預設清單 SHALL 只含現役 host-native conversion authority host(`127.0.0.1:49101` / `localhost:49101`)
- **AND** MUST NOT 含已退役 `_worker` 的 `:8005`

#### Scenario: Explicit configuration overrides the default

- **WHEN** operator 經 `-AllowedStageHosts` 參數或 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` env 提供非空清單
- **THEN** 系統 SHALL 採用該清單作為 allowed-hosts
- **AND** stage 載入對清單外 host 的拒絕語意 SHALL 維持不變

