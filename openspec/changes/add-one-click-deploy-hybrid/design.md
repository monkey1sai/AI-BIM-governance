## 為何採用此設計

Mode C hybrid 部屬要把 docker compose 與 host-native PowerShell 兩種 process 模型協調起來:coordinator + viewer 在 docker container,conversion-service 與 Kit streaming 在 host-native(GPU 必需)。設計上的核心約束:

1. **不改既有 startup script**(Mode A `start-all.ps1` / Mode B `start-runtime-manager-docker.ps1` / Mode C 既有 `start-web-plane-docker.ps1`):多模式並存,新入口不能破壞既有。
2. **三層 safety 紅線**(對齊 AGENTS.md §0.1 與 Global Codex Rules):a 紅線 = 不修改 `.env` 已有 key 實值 / 不寫 secret;b 紅線 = 不安裝系統級依賴;c 紅線 = 不動 git / OpenSpec / compose YAML。
3. **idempotent re-run**:第二次跑 deploy.ps1 必須能識別「已 running 的 host-native + docker container 都是上一輪我們自己啟的」並 skip,不破壞正常服務、退 0、總時 < 30 秒(spec §13 #2)。
4. **可診斷**:任一階段失敗都要印 stage tag + log 路徑 + recover 指令,不依賴使用者記憶。

選用 Option B(orchestrator + lib modules)而非 Option A(monolithic deploy.ps1)或 Option C(deploy.ps1 重做完整 launch,不呼叫既有 script):B 模組化讓每個 module 可單測,且 Phase 4c 透過 `Start-Process` 隔離呼叫 `start-web-plane-docker.ps1`,完全沿用既有 docker compose entrypoint 而非 duplicate logic。

## 架構決策

### Phase 流程

```
.\scripts\deploy.ps1
   │
   ├─ Import-Module scripts\lib\deploy-report.ps1
   │
   ├─ Phase 1: Preflight (read-only audit)
   │    ├─ preflight-docker.ps1            (cliVersion / composeV2 / engineRunning / envFile)
   │    ├─ preflight-host-native.ps1       (.venv / kitLauncher / nvidiaDriver)
   │    ├─ preflight-env.ps1               (root .env / coordinator/.env / .env.web-plane.host-kit missing-key)
   │    ├─ preflight-ports.ps1             (8004 / 5173 docker bind + 49100 / 49101 / 47998 host-native)
   │    └─ preflight-volume-alignment.ps1  (RUNTIME_STORAGE_ROOT leaf 必須 = 'storage')
   │
   ├─ Phase 2: Auto-fix (安全項目)
   │    ├─ python -m venv .venv + pip install -r requirements*.txt
   │    ├─ .env missing-key append from .env.example(三個目標檔)
   │    ├─ Copy-Item .env.web-plane.host-kit.example -> .env.web-plane.host-kit
   │    ├─ append RUNTIME_STORAGE_ROOT=<RepoRoot>\storage(missing-key 時)
   │    ├─ 清 stale PID file(對應 process 已死)
   │    ├─ 建本地目錄(scripts\.run / logs\nvstreamer / storage\ifc-cache)
   │    ├─ docker compose rm -f -s coordinator viewer(若 container 未 running)
   │    └─ docker compose build coordinator viewer(image 首次缺,或 -Build 強制)
   │
   ├─ Phase 3: Interactive guard (動到活著的別人 process 才問)
   │    └─ 陌生 PID(非 PID-file 子孫、非 docker forwarder)佔 port → 問 Stop-Process? (y/N)
   │
   ├─ Phase 4: Start(嚴格順序)
   │    ├─ 4a host-native conversion-service (start-host-native-conversion-service.ps1, :49101 /health)
   │    ├─ 4b host-native Kit streaming (start-streaming-server.ps1 -ResetUser, :49100/47998)
   │    │      ready 判定 = port LISTEN + log 內出現 'app ready' 等關鍵字
   │    └─ 4c Start-Process powershell.exe -File start-web-plane-docker.ps1 (隔離子 script)
   │
   └─ Phase 5: Post-start verify (best-effort)
        ├─ coordinator /health 200
        ├─ viewer / 200
        └─ conversion /health 200
```

### 退出碼

| Code | 意義 | 對應階段 |
|---|---|---|
| 0 | 全部 OK 或 -DryRun 完成 | — |
| 1 | preflight 發現 unfixable(沒裝 Docker / nvidia-smi / Kit launcher / Volume leaf 錯) | Phase 1 |
| 2 | auto-fix 失敗(venv / pip / .env merge / docker build) | Phase 2 |
| 3 | 互動 guard 被使用者拒絕 | Phase 3 |
| 4 | startup 任一 stage 失敗 | Phase 4(log 標 stage=4a/4b/4c) |
| 5 | post-start verify 失敗(僅 `-StrictPostVerify`) | Phase 5 |

### Key invariants

1. **Preflight modules 全 read-only**:`preflight-*.ps1` 都不動手,fix 動作集中在 deploy.ps1 Phase 2 一處;`-DryRun` 只要跳過 Phase 2 即可,不必改 module。
2. **Phase 4 依賴順序硬性**:coordinator container 啟動後立刻嘗試 `host.docker.internal:49101/health`,host-native conversion-service 必須先 LISTEN。
3. **不改既有 startup script**:`start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` 0 行改動。
4. **PID 子孫追蹤**:`scripts\.run\*.pid` 紀錄 PowerShell wrapper PID,但 :49100 LISTEN owner 是 `kit.exe` child;`Get-PidsFromRunDir` 用 `Get-CimInstance Win32_Process -Filter "ParentProcessId=X"` 遞迴展開所有子孫,讓「我們自己 spawn 的 child」不被誤判為「陌生」。

### Volume 對齊(方案 A)

```
.env.web-plane.host-kit:
    RUNTIME_STORAGE_ROOT = <絕對路徑,leaf 必須 = 'storage'>

docker compose:
    volumes:
      - ${RUNTIME_STORAGE_ROOT:-./storage}:/workspace/storage   # bind mount

deploy.ps1 啟動 host-native conversion-service 前:
    $env:STORAGE_ROOT = $RuntimeStorageRoot           ← sandbox root,coordinator 給的 host_local_path 必須落在其下
    $env:STREAMING_CONVERSION_WORK_DIR = Split-Path -Parent $RuntimeStorageRoot

→ coordinator container 寫 host_local_path = <RuntimeStorageRoot>\ifc-cache\<job>\source.ifc
→ host-native conversion-service 用 STORAGE_ROOT 驗 host_local_path 在 sandbox 內
```

### 為何沒選

- **Mode B(全 Docker GPU profile)作為部屬目標**:memory `kit-gpu-render-needs-windows-native` 已驗證 Docker / WSL2 無 NVIDIA 繪圖驅動;Kit launcher 可建可起,但渲染 blocked,viewer 黑屏。Mode C 是技術上唯一能 demo 的路徑。
- **deploy.ps1 直接 inline `docker compose up`,不呼叫 start-web-plane-docker.ps1**:會 duplicate logic,違反「不改既有但要復用」邊界。改用 `Start-Process` 隔離子 script,完全沿用其行為。
- **強制 idempotent re-run < 5 秒**:Phase 2 docker rm/build 加 `webPlaneRunning` 條件 skip 已實現 < 10 秒;若再要 < 5 秒,Phase 1 audit 要 cache,違反「Phase 1 永遠 read-only audit」invariant。妥協:idempotent 25 秒(冷啟為主、熱重跑 best-effort)。

### 已知 PowerShell 5.1 trap(實機 fix 集合)

實機驗證過程暴露 10 個 PowerShell 5.1 trap,在 implementation 階段全部修補:

1. `$pid` automatic variable read-only:`param($pid)` 不 bind,rename `$procId`。
2. `$Args` automatic variable:`param($Args)` 不 bind,rename `$ArgList`。
3. `Assert-Equal $null Expected`:Mandatory parameter 不接 `$null`,改用 `Assert-True ($null -eq …)`。
4. `[string] $param = $null` cast 成 empty string:用 `IsNullOrEmpty` 判斷 caller 意圖。
5. `$ErrorActionPreference = 'Stop'` + native cmd stderr promotion:改 `Continue`,exit code 由 `$LASTEXITCODE` 主動檢。
6. `Write-Host` 走 Information stream:test 用 `*>&1` 全 stream redirect 才能 capture。
7. 子 script stderr 污染父流程:用 `Start-Process` 隔離 PowerShell process。
8. Kit log 關鍵字實際是 `app ready`(小寫),加入 keyword list。
9. wrapper PID file 不含 child kit.exe / python.exe:`Get-PidsFromRunDir` 沿 `ParentProcessId` 遞迴展開。
10. `Get-NetTCPConnection.OwningProcess` 回 UInt32 vs hashtable Int32 key type mismatch:統一 `[int]` cast。

## 測試策略

- **Layer 1 unit(repo 風格,非 Pester)**:9 個 test file,每個 lib module 一份。Mock 策略 = 受測函數接 scriptblock 注入(docker CLI / port lookup / nvidia probe / Python version probe / HTTP probe),test 內傳 fake closure。
- **Layer 2 integration**:`-DryRun` 走完 Phase 1 不動真實狀態。
- **Layer 3 manual smoke**:7 步 runbook 在 `docs\runbooks\one-click-deploy-smoke.md`。Step 1-2-5 由 controller 跑(冷啟 / 首次 deploy / idempotent re-run);Step 3-4-6-7 需要瀏覽器目視 / 手動關 Docker Desktop,由 PR review 階段 user 補驗。
- **CI integration**:第一版不進 CI(GitHub Actions windows-latest 無 NVIDIA);Layer 1 進 CI 留 follow-up PR。

## Open questions / Follow-ups

- Phase 1 audit 對 Docker forwarder(wslrelay / com.docker.backend)印 `[ask]` 是 cosmetic(Phase 3 whitelist 過濾),要改成 Phase 1 直接 `[skip - docker forwarder]` 更直覺。
- `-Build` force rebuild 在 image cache 命中時實際很快,test plan 沒明確驗 layer rebuild 真的發生。
- Step 7 fail injection 要程式化 inject(stop Docker Desktop service)較難跨 user 環境,目前 runbook 用人工關 tray。
