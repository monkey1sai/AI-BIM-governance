# 一鍵部屬(Mode C hybrid) Design

> Brainstorming 產出 spec,2026-05-26。
> 路徑:`docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`。
> 下一步:writing-plans 接力產出 implementation plan。

---

## 1. Goal

提供一個 `.\scripts\deploy.ps1`,讓使用者在 Windows host + NVIDIA GPU 機器上,**用一條指令** 啟動 Mode C(hybrid)部屬:Docker compose 跑 coordinator + viewer,host-native PowerShell 跑 conversion-service + Kit streaming。前置條件不對時自動修(限定安全項目),動到別人的活著的 process / 危險動作前先問,完成後印可診斷的 summary。

成功標準:

```
冷啟動(.venv / node_modules / .env / docker image 全空)
→ .\scripts\deploy.ps1
→ 10 分鐘內全部啟好
→ 瀏覽器開 http://127.0.0.1:8004/ui 看到 coordinator UI
→ viewer WebRTC handshake 出畫面
→ 第二次跑 deploy.ps1 < 30 秒(idempotent,全部 skip-already-running)
```

---

## 2. Background

repo 既有三種 startup mode:

| Mode | 入口 | 適用 |
|---|---|---|
| **A — Full host-native** | `scripts\start-all.ps1` | 純 dev 機,全 PowerShell + Start-Process |
| **B — Full Docker(GPU profile)** | `scripts\start-runtime-manager-docker.ps1` | 全 Docker 含 Linux Kit,但 memory 警告 Kit graphics 卡 WSL2 天花板,渲染實際 blocked |
| **C — Hybrid web-plane Docker + host-native Kit** | `scripts\start-web-plane-docker.ps1`(只啟 docker 一半) | Docker 跑管理面、host-native 跑 GPU 需求,符合 memory `kit-gpu-render-needs-windows-native` |

這次 deploy.ps1 **只擔 Mode C**。Mode A 與 Mode B 維持各自入口,deploy.ps1 不替換它們,也不接 `-Mode` 旗標。

依使用者的 memory 與現實:這台機是 Windows host + NVIDIA GPU,Docker/WSL2 無 NVIDIA 繪圖驅動,Kit 渲染只能 host-native;Docker 只跑管理面。Mode C 是技術上能 demo 的路徑。

---

## 3. Decision Summary

brainstorming 過程拍板:

1. **Approach B**:`deploy.ps1` 是薄 orchestrator(100-150 行),所有檢查 / 修復 / 啟動邏輯分到 `scripts\lib\*.ps1` modules。Module 全部 read-only(或在明確 phase 才動手),便於 Pester 單測。
2. **Mode C 唯一**:不接 `-Mode native|docker|hybrid` 多軌切換。
3. **Detect + Auto-fix**:能修的安全項目自動修(venv / .env missing-key / stale PID / 建目錄 / 第一次 docker build / container 衝突);動到活著的別人 process 才問;系統級安裝、改 `.env` 已有 key 實值、改 compose YAML、改 git source state 一律不做。
4. **入口**:新建 `scripts\deploy.ps1`,保留 `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` 原樣;deploy.ps1 在 Phase 4c 直接呼叫 `start-web-plane-docker.ps1`。
5. **Kit ready 判定**:`scripts\.run\bim-streaming-server.log` 出現 `Application started` / `launching Linux Kit` / `Streaming started` 任一關鍵字 + signaling port `:49100` LISTEN 即視為 ready。**不**做 full WebRTC probe(scope 控制)。
6. **Volume 對齊方案 A**:`.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` 是 ground truth;host-native conversion-service 由 deploy.ps1 在啟動子 process 前 export `STREAMING_CONVERSION_WORK_DIR = Split-Path -Parent $RUNTIME_STORAGE_ROOT` 反向對齊。
7. **Container 名稱衝突**自動刪重建(`docker compose rm -f -s coordinator viewer` 後 compose up 重 create),不問使用者。
8. **第一次自動 build**:`docker compose images -q coordinator viewer` 回空 → 自動 `docker compose build`。後續不 build。使用者加 `-Build` 才強制 rebuild。
9. **Partial failure 不自動 rollback**:Phase 4 任一 stage fail 就退非 0,已啟的東西不主動 stop,Summary 印「what's running now」與手動收尾指令。
10. **退出碼**:`0/1/2/3/4/5`,Phase 4 內部 stage 失敗在 log 標 `stage=4a|4b|4c` 區分,但都用 exit 4。

---

## 4. Out of Scope

| 項目 | 為什麼不做 |
|---|---|
| Mode A / Mode B 的一鍵部屬 | 使用者第二輪確認只擔 Mode C |
| Production 部屬(Windows Service / Task Scheduler / NSSM autostart) | 不是 dev 一鍵範圍 |
| 跨主機部屬(把 coordinator / streaming 拆到不同 host) | 同上 |
| 安裝 Docker Desktop / NVIDIA driver / Node / Python / Kit Launcher 本身 | preflight 偵測到缺 → 退 1 + 印官方安裝網址;不下載 installer |
| 改 `compose.runtime-manager.yml` / `compose.host-kit.yml` 內容 | compose YAML 是 source-of-truth |
| 改 `start-all.ps1` 等既有 script 行為 | 向後相容 |
| 自動 stop(`stop-all` / `stop-runtime-manager-docker`) | 停服務歸 stop scripts,deploy 不接管 |
| 一鍵 stop / restart | 沒在這次 scope;之後可加 `stop-deploy.ps1` |
| docker registry login / push image | secret 邊界 |
| CI workflow yml(`.github/workflows/deploy-unit-test.yml`) | Layer 1 Pester 進 CI 留 follow-up PR,避免本次 PR 過大 |

---

## 5. Architecture

### 5.1 Phase 流程

```
.\scripts\deploy.ps1
   │
   ├─ Import-Module scripts\lib\deploy-report.ps1
   │
   ├─ Phase 1: Preflight (read-only audit)
   │    ├─ preflight-docker.ps1
   │    ├─ preflight-host-native.ps1
   │    ├─ preflight-env.ps1
   │    ├─ preflight-ports.ps1
   │    └─ preflight-volume-alignment.ps1
   │
   ├─ Phase 2: Auto-fix(只做安全項目)
   │
   ├─ Phase 3: Interactive guard(動到活著的別人 process 才問)
   │
   ├─ Phase 4: Start(嚴格順序)
   │    ├─ 4a host-native conversion-service (:49101)
   │    ├─ 4b host-native Kit streaming    (:49100/47998)
   │    └─ 4c docker compose up coordinator + viewer (:8004/:5173)
   │
   └─ Phase 5: Post-start verify(best-effort)
```

### 5.2 Module 分工

```
scripts\
├── deploy.ps1                          # 100-150 行薄 orchestrator(Mode C 專用)
├── lib\
│   ├── deploy-report.ps1               # 統一 [ok]/[fix]/[ask]/[skip]/[warn]/[fail]
│   ├── preflight-docker.ps1            # docker / compose v2 / engine running / .env.web-plane.host-kit
│   ├── preflight-host-native.ps1       # .venv / Kit launcher / nvidia-smi
│   ├── preflight-env.ps1               # root .env / coordinator .env / .env.web-plane.host-kit missing-key audit
│   ├── preflight-ports.ps1             # 8004/5173 (docker bind) + 49100/49101/47998 (host-native)
│   ├── preflight-volume-alignment.ps1  # RUNTIME_STORAGE_ROOT leaf 必須 = 'storage'
│   ├── host-native-launcher.ps1        # Start-HostNativeConversion / Start-HostNativeKit / Wait-...
│   └── kit-log-probe.ps1               # :49100 LISTEN + log keyword scan
├── start-all.ps1                       # 原樣保留(Mode A 入口)
├── start-runtime-manager-docker.ps1    # 原樣保留(Mode B 入口)
├── start-web-plane-docker.ps1          # 原樣保留(deploy Phase 4c 呼叫)
├── check-web-plane-docker.ps1          # 原樣保留(deploy Phase 5 部份邏輯復用)
└── stop-runtime-manager-docker.ps1     # 原樣保留
```

### 5.3 Key Invariants

1. **Preflight modules 全部 read-only**:`preflight-docker.ps1` / `preflight-host-native.ps1` / `preflight-env.ps1` / `preflight-ports.ps1` / `preflight-volume-alignment.ps1` 一律只 audit、不動手,回傳結構化結果。Fix 動作集中在 `deploy.ps1` Phase 2 一處,這樣 `-DryRun` 只要跳過 Phase 2 即可,不必改 module 本身。`host-native-launcher.ps1`(啟 process)與 `deploy-report.ps1`(寫 log)不是 preflight,有副作用是預期的。
2. **依賴順序硬性**:host-native conversion(4a)→ host-native Kit(4b)→ Docker web plane(4c)。理由:coordinator container 啟動會立刻嘗試 `host.docker.internal:49101/health`,若 host-native conversion-service 未就緒,coordinator 會狂洗 error log,誤導 post-verify。
3. **host-native launcher 抽到 lib**:從 `start-all.ps1` copy-once 出 `Start-HostNativeConversion` / `Start-HostNativeKit`,deploy.ps1 與未來其他入口共用;start-all.ps1 本身不動。
4. **Docker 路徑復用 start-web-plane-docker.ps1**:Phase 4c 直接呼叫 `& "$PSScriptRoot\start-web-plane-docker.ps1" -Build:$Build -EnvFile $resolvedEnv`,不自己 inline docker compose。

---

## 6. Execution Flow

### 6.1 參數

```
.\scripts\deploy.ps1
  [-DryRun]              # Phase 1 跑、Phase 2 印 plan 但不執行、Phase 3-5 跳過
  [-Force]               # Phase 3 互動 guard 全部視同 y
  [-Build]               # 強制 docker compose build(即使 image 已存在)
  [-Pull]                # docker compose pull(預設關)
  [-EnvFile <path>]      # 指定 .env.web-plane.host-kit 路徑(預設自動找)
  [-SkipKit]             # 跳過 Phase 4b(host-native Kit)
  [-SkipConversion]      # 跳過 Phase 4a(host-native conversion-service)— rare,debug 用
  [-SkipDocker]          # 跳過 Phase 4c(docker compose up)— 只跑 host-native 半邊
  [-KitSignalPort 49100]
  [-KitMediaPort 47998]
  [-StrictPostVerify]    # Phase 5 任一 warn 改成 fail 退 5
```

### 6.2 Phase 1 — Preflight audit result 物件

回傳的物件 shape(以一個「混合 ok / 需 fix」場景為例,所有欄位都是實際值):

```json
{
  "docker": {
    "cliVersion": "27.x",
    "composeV2": true,
    "engineRunning": true,
    "envFile": ".env.web-plane.host-kit"
  },
  "hostNative": {
    "venv": "OK",
    "kitLauncher": "OK",
    "nvidiaDriver": "OK"
  },
  "envFiles": [
    { "file": ".env", "missing": ["CALLBACK_OUTBOX_STORE_PATH"] },
    { "file": "bim-review-coordinator/.env", "missing": [] },
    { "file": ".env.web-plane.host-kit", "missing": ["RUNTIME_STORAGE_ROOT"] }
  ],
  "ports": {
    "docker":     [{ "port": 8004,  "status": "FREE" },
                   { "port": 5173,  "status": "FREE" }],
    "hostNative": [{ "port": 49100, "status": "OCCUPIED", "pid": 12345,
                     "name": "kit.exe", "ourPidFile": true },
                   { "port": 49101, "status": "FREE" },
                   { "port": 47998, "status": "FREE" }]
  },
  "volumeAlignment": {
    "runtimeStorageRoot": null,
    "leaf": null,
    "status": "MISSING_KEY"
  }
}
```

欄位 enum:

- `hostNative.venv` ∈ `OK | MISSING | WRONG_VERSION`
- `hostNative.kitLauncher` ∈ `OK | MISSING_PATH`
- `hostNative.nvidiaDriver` ∈ `OK | MISSING`
- `ports.*.status` ∈ `FREE | OCCUPIED`
- `volumeAlignment.status` ∈ `ALIGNED | MISSING_KEY | WRONG_LEAF`

invariant:`envFiles[i].missing` 含 `RUNTIME_STORAGE_ROOT` ⇔ `volumeAlignment.status == "MISSING_KEY"`。兩處同步維護,避免 audit 自我矛盾。

result 同時寫到 `scripts\.run\deploy-audit.json`(machine-readable,CI 可 parse;此版可選做,人類使用為主)。

### 6.3 退出碼

| Code | 意義 | 對應 stage |
|---|---|---|
| 0 | 全部 OK,服務都起來了(或 -DryRun 完成) | — |
| 1 | preflight 發現 unfixable(沒裝 Docker / nvidia-smi 不在 / Volume leaf 錯) | Phase 1 |
| 2 | auto-fix 過程中失敗(npm/pip/.env merge/docker build) | Phase 2 |
| 3 | 互動 guard 被使用者拒絕 | Phase 3 |
| 4 | startup 任一 stage 失敗 | Phase 4(log 標 stage=4a/4b/4c) |
| 5 | post-start verify 失敗(僅 -StrictPostVerify) | Phase 5 |

---

## 7. Safety Boundaries

三層紅線。Phase 2 動的是 A,Phase 3 動的是 B,C 永遠不動。

### 7.1 A. 自動做(Phase 2,印 `[fix ]`)

| 動作 | 觸發 |
|---|---|
| `python -m venv .venv` + `pip install -r requirements*.txt` | `.venv\Scripts\python.exe` 不存在 |
| `.env` missing-key merge(root `.env` / `bim-review-coordinator\.env` / `.env.web-plane.host-kit`) | example 有的 key,目標沒有 → append 預設值;已有 key 不動 |
| `Copy-Item .env.web-plane.host-kit.example → .env.web-plane.host-kit` | 目標檔不存在 |
| append `RUNTIME_STORAGE_ROOT=<RepoRoot>\storage`(絕對路徑) | `.env.web-plane.host-kit` 沒 `RUNTIME_STORAGE_ROOT` key |
| 清 stale `scripts\.run\*.pid` | PID file 存在但對應 process 已死 |
| 建缺的本地目錄(`scripts\.run\` / `logs\nvstreamer\` / `storage\ifc-cache\`) | 目錄不存在 |
| `docker compose build coordinator viewer` | `docker compose images -q coordinator viewer` 回空(image 從未 build 過) |
| `docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml rm -f -s coordinator viewer` | container 名稱衝突(舊 deploy 殘留) |
| `docker compose pull`(僅在 -Pull 時) | 使用者顯式 |

### 7.2 B. 會問你才做(Phase 3,印 `[ask ]`)

| 情境 | 問法 |
|---|---|
| Port `8004` / `5173` / `49100` / `49101` / `47998` 被不認識的 PID 佔(該 PID **不在** `scripts\.run\*.pid`) | `Port X occupied by PID Y (name.exe). Stop-Process? (y/N)` |
| `.venv` 已存在但 Python 版本 < 3.11 | `Recreate? (will delete .venv) (y/N)` |
| `bim-review-coordinator\node_modules` 與 lockfile mtime 不一致 | `npm ci (will delete node_modules)? (y/N)` |

`-Force` 旗標 → 全部視同 y。

### 7.3 C. 永遠不做(即使 `-Force`)

| 項目 | 理由 |
|---|---|
| 修改 `.env` 已有 key 的**實值** | AGENTS.md §0.1 + CLAUDE.md + Global Codex Rules 紅線 |
| 寫任何 secret 到 `.env` 系列 | 同上 |
| 安裝 Docker / NVIDIA driver / Node / Python / Kit Launcher 本身 | 退 1 + 印官方安裝網址 |
| 註冊 Windows Service / Task Scheduler / autostart | 不在 Mode C scope |
| 改 `compose.runtime-manager.yml` / `compose.host-kit.yml` | compose YAML 是 source-of-truth |
| `docker registry login` / 改 `~/.docker/config.json` | secret 邊界 |
| 刪 docker named volume / `storage\` 內 IFC/USDC bytes | 大檔 / 持久資料邊界 |
| 動 git(add / commit / push / stash) | 不在 scope |
| 改 `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` | 向後相容是核心決定 |
| Kill PID file 內的 process / `docker compose down` | 停服務歸 stop scripts |

### 7.4 Volume 對齊(方案 A)

Ground truth = `.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT`(使用者可設外接 / 共享磁碟)。

```
deploy.ps1 在 Phase 4a Start-HostNativeConversion 子 process 啟動前:

  $runtimeStorageRoot = (Read .env.web-plane.host-kit).RUNTIME_STORAGE_ROOT
  $leaf = Split-Path -Leaf $runtimeStorageRoot

  if ($leaf -ne 'storage') {
      Phase 1 preflight 已 [fail ] 退 1,不會到這
      理由:host-native conversion-service 寫死「parent 下找 storage/ 子資料夾」
            (start-all.ps1 line 101-125 Resolve-ConversionWorkDir 行為)
            修這個耦合不在這次 scope
  }

  $env:STREAMING_CONVERSION_WORK_DIR = Split-Path -Parent $runtimeStorageRoot
  # → host-native conversion-service 看的 root 對齊 RUNTIME_STORAGE_ROOT 的 parent
```

---

## 8. Error Handling & Reporting

### 8.1 輸出格式

每行統一 6 級 tag + 顏色:

```
[ok   ] coordinator container running (id=ai-bim-runtime-manager-coordinator-1)
[fix  ] .env: appending RUNTIME_STORAGE_ROOT=C:\Repos\active\iot\AI-BIM-governance\storage
[ask  ] port 49100 occupied by PID 12345 (kit.exe). Stop-Process? (y/N) _
[skip ] Kit streaming (--SkipKit)
[warn ] container_to_host_conversion blocker=route-or-firewall
[fail ] docker compose build failed (stage=4c, see scripts\.run\deploy.log line 220)
```

| Tag | 色 | 意義 |
|---|---|---|
| `[ok   ]` | 綠 | 該 step 成功通過 |
| `[fix  ]` | 青 | 做了一個 auto-fix 動作 |
| `[ask  ]` | 黃 | 等使用者輸入 y/N |
| `[skip ]` | 灰 | 因旗標 / 條件跳過 |
| `[warn ]` | 黃 | best-effort 失敗(預設不退非 0) |
| `[fail ]` | 紅 | hard 失敗(會退非 0) |

每行 tag 後跟一個 grep-able 英文短句 + key=value pair。與 `check-runtime-manager-docker.ps1` / `check-web-plane-docker.ps1` 既有風格一致。

### 8.2 結尾 Summary

成功版:

```
=== Deploy Summary ===
Mode:         hybrid (web-plane Docker + host-native Kit)
Elapsed:      2m 18s
EnvFile:      .env.web-plane.host-kit
Storage root: C:\Repos\active\iot\AI-BIM-governance\storage (aligned)

Phase 1 preflight       : ok
Phase 2 auto-fix        : ok (5 actions; see deploy.log:48-92)
Phase 3 interactive     : not triggered
Phase 4a conversion     : ok (:49101 /health 200)
Phase 4b kit streaming  : ok (:49100 LISTEN + 'Application started')
Phase 4c docker compose : ok (coordinator, viewer running)
Phase 5 post-verify     : ok (5/5 checks; container→host bridge ok)

Next:
  ▸ open http://127.0.0.1:8004/ui            (coordinator UI / WebRTC entry)
  ▸ tail scripts\.run\bim-streaming-server.log -Wait
  ▸ stop all:
      .\scripts\stop-runtime-manager-docker.ps1
      .\scripts\stop-all.ps1 -SkipCoordinator -SkipViewer
```

失敗版(Phase 4c):

```
=== Deploy Summary ===
Mode:         hybrid
Elapsed:      1m 02s
Status:       FAILED (exit 4, stage=4c docker compose)

Phase 1 preflight       : ok
Phase 2 auto-fix        : ok (3 actions)
Phase 3 interactive     : not triggered
Phase 4a conversion     : ok
Phase 4b kit streaming  : ok
Phase 4c docker compose : FAIL (see scripts\.run\deploy.log line 312)
  → stderr: Error response from daemon: ports are not available:
            listen tcp 0.0.0.0:8004: bind: address already in use

What's running now (NOT auto-rolled-back):
  ▸ host-native conversion-service  PID 8412   :49101
  ▸ host-native kit streaming       PID 12340  :49100

To recover:
  ▸ figure out what's holding :8004 (Get-NetTCPConnection -LocalPort 8004)
  ▸ stop partial deploy: .\scripts\stop-all.ps1 -SkipCoordinator -SkipViewer
  ▸ then re-run: .\scripts\deploy.ps1 -Force
```

### 8.3 落地物

| 物 | 路徑 | 內容 |
|---|---|---|
| Deploy 主 log | `scripts\.run\deploy.log` | 所有 `[ok/fix/ask/skip/warn/fail]` 行 + 每個 fix 的 stdout/stderr |
| docker compose stdout | `scripts\.run\docker-compose-up.log` | `docker compose up -d` 的 raw stdout/stderr |
| host-native conversion log | `scripts\.run\bim-streaming-conversion-service.log` / `.log.err` | 沿用既有 |
| host-native Kit log | `scripts\.run\bim-streaming-server.log` / `.log.err` | 沿用既有 |
| Preflight audit JSON | `scripts\.run\deploy-audit.json` | Phase 1 audit result 物件(machine-readable,本版可選做) |

### 8.4 失敗時的「不做」

| 不做 | 理由 |
|---|---|
| 自動 rollback(不 stop 已啟的 host-native / 不 docker compose down) | §3 紅線。Summary 打印 partial state 並指引手動 stop |
| 重試(各 stage 第一次 fail 就退) | 重試該由使用者明確 `.\scripts\deploy.ps1 -Force` 重跑 |
| `[fail ]` 吞 `[warn ]`(顯示假成功) | 一律以 Phase 4 任一 stage 為準;Phase 5 是 best-effort |

---

## 9. Testing Strategy

### 9.1 Layer 1 — Unit (Pester)

範本沿用 `scripts\tests\test-pr-review-agent.ps1`(PR #120 帶進來)。每個 lib module 一份:

```
scripts\tests\
├── test-deploy-report.ps1
├── test-preflight-docker.ps1
├── test-preflight-host-native.ps1
├── test-preflight-env.ps1
├── test-preflight-ports.ps1
├── test-preflight-volume-alignment.ps1
├── test-host-native-launcher.ps1
└── test-kit-log-probe.ps1
```

關鍵測試 case 至少包:

| Case | Module |
|---|---|
| 缺 `.venv` → 回傳 `MISSING` | preflight-host-native |
| `.venv` 在但 Python <3.11 → 回傳 `WRONG_VERSION` | preflight-host-native |
| nvidia-smi 不在 PATH → 回傳 `MISSING` | preflight-host-native |
| `.env.example` 有 5 個 key,`.env` 只有 3 個 → 回傳 missing list 含 2 個 | preflight-env |
| `.env` 已有 key 值 → **不** 出現在 missing list(invariant) | preflight-env |
| `RUNTIME_STORAGE_ROOT` leaf=`storage` → ALIGNED + parent 路徑正確 | preflight-volume-alignment |
| `RUNTIME_STORAGE_ROOT` leaf=`ifc-bucket` → WRONG_LEAF | preflight-volume-alignment |
| `RUNTIME_STORAGE_ROOT` missing key → MISSING_KEY | preflight-volume-alignment |
| Port 被 PID file 內 process 佔 → `ourPidFile=true`(不互動) | preflight-ports |
| Port 被陌生 PID 佔 → `ourPidFile=false`(進 B 區) | preflight-ports |
| Kit log 含 `Application started` → ready=true | kit-log-probe |
| Kit log 只含 `launching Linux Kit` → ready=true(OR) | kit-log-probe |
| Kit log 空 → ready=false(timeout 才回) | kit-log-probe |
| `[ok ] foo` 顏色 / log line 解析正確 | deploy-report |

Mock 策略:

- Docker:`Mock docker { ... }` 攔截 CLI,回 fixture stdout/exit
- Process / Port:`Mock Get-NetTCPConnection` / `Mock Get-Process`
- 檔案系統:Pester `TestDrive` 臨時 sandbox

### 9.2 Layer 2 — Integration `-DryRun`

```powershell
# scripts\tests\test-deploy-dryrun.ps1
Describe 'deploy.ps1 -DryRun' {
    It 'completes with exit 0 on a clean tree' {
        $output = & "$PSScriptRoot\..\deploy.ps1" -DryRun 2>&1
        $LASTEXITCODE | Should -Be 0
        $output | Should -Match '\[ok\s+\] Phase 1 preflight'
        $output | Should -Match 'Phase 2 auto-fix.*DRY-RUN'
        $output | Should -Not -Match '\[fix\s+\] '
    }

    It 'detects missing .venv and reports plan without creating it' {
        & "$PSScriptRoot\..\deploy.ps1" -DryRun
        Test-Path "$PSScriptRoot\..\..\.venv" | Should -Be $false
    }
}
```

`-DryRun` 不能動真實狀態(不啟 process、不動 docker、不寫檔)。

### 9.3 Layer 3 — Smoke checklist(手動)

寫進 `docs\runbooks\one-click-deploy-smoke.md`,deploy.ps1 第一次合進去之後跑一次蓋章:

1. **冷啟動**:`stop-all` + `stop-runtime-manager-docker` + 刪 `.venv` / `node_modules` / `.env.web-plane.host-kit`
2. 跑 `.\scripts\deploy.ps1`,預期 5-6 個 `[fix ]`(建 .venv / pip / 複製 .env / build docker image),全程 < 10 分鐘
3. 開 `http://127.0.0.1:8004/ui`,確認 coordinator UI 載入
4. Viewer WebRTC handshake 有畫面(`readyState=4` + 影像尺寸 > 0,memory `webrtc-no-video-reset-user-recovery` 已記錄判定)
5. **熱重跑**:`.\scripts\deploy.ps1`,預期 0 個 fix、0 個 ask、Phase 4 全 `[skip - already running]`、退 0、總時 < 30 秒(idempotent)
6. **加 `-Build`**:預期 docker image 重 build、container recreate、host-native 不重啟(若 PID 仍活)、最終全 OK
7. **失敗注入**:故意 `Stop-Service docker`(關 Docker Desktop),跑 deploy.ps1;預期 Phase 1 `[fail ]` preflight-docker engineRunning=false,退 1,不動 host-native

### 9.4 CI 邊界

第一版不進 CI。理由:Layer 1 可進(GitHub windows-latest);Layer 2 需要 docker / nvidia-smi;Layer 3 需要 GPU。

建議:本次 PR 把 `scripts\tests\test-*.ps1` 寫到、合進 repo;CI workflow yml(`.github/workflows/deploy-unit-test.yml`)留 follow-up PR,避免本次 PR 過大。

---

## 10. Risks

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| host-native conversion-service 啟動成功但內部錯(例如 Kit launcher 路徑錯,但 `:49101/health` 還是 200) | 中 | Phase 4a 通過、Phase 4c coordinator 連 conversion API 後段才壞 | Phase 5 container→host bridge probe + warn;v2 可加 deeper probe |
| 使用者改了 compose YAML 卻沒同步 `.env.web-plane.host-kit` | 低 | docker compose up 失敗,Phase 4c [fail ] | Phase 1 preflight-docker 在 envFile 階段檢查必填 key;但 compose 本身改動不偵測(scope 邊界) |
| Docker Desktop 還在啟動中 → `docker info` timeout | 中 | Phase 1 [fail ] engineRunning=false,使用者要等 Docker 起來再重跑 | preflight-docker 退 1 + 印「Docker Desktop is starting? wait and retry」 |
| 第一次 `docker compose build` 拉 NVIDIA base image 失敗(network / rate-limit) | 低 | Phase 2 fix [fail ] 退 2 | log 印 docker build 完整 stderr;使用者自行 retry / 設 mirror |
| Kit launcher 寫死「parent 下找 storage/ 子資料夾」的耦合,讓 RUNTIME_STORAGE_ROOT leaf 必須是 `storage` | 高(已知設計限制) | 使用者想用 `D:\bim-share\ifc-bucket` 失敗 | Phase 1 preflight-volume-alignment 退 1 + 明確錯誤;v2 改 host-native conversion-service 用直接 STORAGE_ROOT |
| WSL2 / Docker Desktop 將 8004 / 5173 透過 `host.docker.internal` exposing 但 firewall 擋掉外網存取 | 低 | demo URL 在本機 OK、外網不行 | 不在這次 scope;memory `webrtc-1on1-entrypoint-via-coordinator-ui` 已紀錄 LAN IP 使用 |
| Phase 4c container 名稱衝突的自動 rm 對 demo 中的 running container 動手 | 低 | 別人正在用的 demo 被中斷 | 動作前在 deploy-report 印 `[fix ] removing existing container (was: running)`,警告 |

---

## 11. Open Questions / Follow-ups

brainstorming 過程使用者沒明確拍板的小細節,留實作時定:

1. **退出碼是否再細分 Phase 4 內 stage(41/42/43)?**
   - 目前:Phase 4 各 stage 都退 4,在 log 標 `stage=4a/4b/4c`
   - 若 CI 要解析,可改 41/42/43
   - 預設先用單一 4,簡化
2. **`Start-Transcript` 全程 log 自動 capture?**
   - 目前:手寫關鍵行進 `deploy.log`,deploy-report.ps1 統一管
   - Transcript 比較全(含 ANSI 顏色 escape),長且難讀
   - 預設不用
3. **`deploy-audit.json` 第一版做?**
   - CI 用得到,人不太用
   - 預設先做(成本低,Phase 1 audit 物件序列化即可)
4. **失敗 Summary 自動印 `Get-NetTCPConnection -LocalPort X` 偵測佔用者**
   - v2 加;v1 只印「figure out what's holding :X」
5. **`-Verbose` 旗標讓 deploy.log 同步 tail 到 stdout?**
   - v2 加
6. **Layer 1 Pester 進 CI workflow yml**
   - 本次 PR 不做,follow-up PR 加 `.github/workflows/deploy-unit-test.yml`
7. **第一版要不要做對應的 `stop-deploy.ps1`?**
   - 目前沒;停用 `stop-all` + `stop-runtime-manager-docker` 組合
   - 使用者沒明確要求,先不做

---

## 12. Glossary

| Term | 定義 |
|---|---|
| Mode A | 全 host-native PowerShell 啟動(`scripts\start-all.ps1`) |
| Mode B | 全 Docker 含 Linux Kit GPU(`scripts\start-runtime-manager-docker.ps1`) |
| Mode C | Hybrid:web-plane Docker + host-native Kit(本 spec scope) |
| coordinator | `bim-review-coordinator/`,Node service,port 8004,Docker 跑 |
| viewer | `web-viewer-sample/`,Node Vite dev server,port 5173,Docker 跑 |
| conversion-service | `bim-streaming-server/scripts/start-host-native-conversion-service.ps1`,Python,port 49101,host-native 跑 |
| Kit streaming | `bim-streaming-server/scripts/start-streaming-server.ps1 -ResetUser`,Omniverse Kit,port 49100/47998,host-native 跑 |
| RUNTIME_STORAGE_ROOT | `.env.web-plane.host-kit` 變數,docker compose `volumes:` bind mount 來源,Mode C volume 對齊 ground truth |
| STREAMING_CONVERSION_WORK_DIR | host-native conversion-service env,deploy.ps1 設為 `Split-Path -Parent $RUNTIME_STORAGE_ROOT` 反向對齊 |
| Ground truth(volume) | 方案 A:`.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT` 是權威,host-native 配合它 |
| Application started | Kit log 關鍵字之一,出現在 `scripts\.run\bim-streaming-server.log` 表示 Kit ready |

---

## 13. Acceptance Criteria

deploy.ps1 第一版被視為完成需滿足:

1. ✅ 冷啟動(.venv / node_modules / .env / docker image 全空)→ 一條指令 → 10 分鐘內全啟好
2. ✅ 熱重跑 → < 30 秒、0 fix / 0 ask / Phase 4 全 skip
3. ✅ `-DryRun` 不動任何真實狀態,可預覽 fix plan
4. ✅ `-Build` 強制 rebuild docker image
5. ✅ `.env` 已有 key 的實值在所有路徑下都不被覆寫
6. ✅ Layer 1 Pester 8 個 module test 全綠
7. ✅ Layer 2 dry-run integration test 綠
8. ✅ Layer 3 smoke checklist 7 步手動跑過,蓋章寫進 `docs\runbooks\one-click-deploy-smoke.md`
9. ✅ Summary 在成功 / 失敗兩種情況都印出可診斷的完整資訊
10. ✅ `start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` 全部 0 行改動(向後相容)
