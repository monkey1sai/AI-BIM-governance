# Plan — 持久化測試部署區遷移至遠端 Linux 主機

> 文件性質：**working plan**（Lane G）。不是 runtime/API contract，也不是完成證據。
> 與本檔衝突時，以使用者最新口令為準，其次根目錄 `AGENTS.md`，再才是本檔。
> 決策來源：2026-07-31 `/grilling` session（Q1–Q21）＋同日 spike 實測證據。

---

## 1. 目標與非目標

**目標**：把 `product-operability-and-script-contract.md` §6 的**持久化測試部署環境**從本機 Windows（`<WINDOWS_TEST_DEPLOY_ROOT>`）遷移到遠端 Ubuntu 主機，使本機 dev box 不再因部署區常駐而被佔用 GPU 與 port。精確 host、account、network 與 filesystem mapping 僅存 owner-controlled private inventory，不進 public repo。

**非目標（本輪不做）**：

- §8 隔離 branch stack 的遷移（那是暫時性切片，跟著 CI/PR 生滅）
- 官方容器化 Kit（`repo.sh package_container`）— 列為第二階段
- coordinator 反向代理 viewer — 列為第二階段
- 治理腳手架分家到新 GitHub repo — 獨立專案（Q9）

---

## 2. 目標主機事實（實測、public-safe 摘要）

```txt
host            REMOTE_TEST_HOST（精確 hostname / address 見 private inventory）
OS              Ubuntu 24.04.4 LTS, kernel 6.8.0-136-generic
capacity        20-core CPU、96 GB RAM、1.8 TB NVMe（精確 hardware inventory 不公開）
GPU             Blackwell-class NVIDIA GPU、約 16 GiB VRAM
NIC             單一 private interface（名稱、address 與 CIDR 見 private inventory）
boot security   driver spike 所需狀態已驗證；精確 posture 見 private inventory
routing         PRIVATE_CLIENT_SUBNET → PRIVATE_RUNTIME_SUBNET 經受控 L3 route
object storage  OBJECT_STORE_ENDPOINT 由 runtime private config 提供並已驗證可達
```

**共用性警告**：這是 shared host；session、console 與 legacy account 細節留在 private operations record。本計畫只要求專屬服務角色帳號（見 D-11）。

---

## 3. 決策紀錄（Q1–Q21）

| # | 議題 | 決議 |
|---|---|---|
| D-1 | 遷移範圍 | §6 持久化測試部署環境 → `REMOTE_TEST_HOST`（非 §8 隔離 stack） |
| D-2 | Linux Kit runtime 形態 | **第一階段** host-native Kit ＋ web plane Docker（與現行同構）；官方容器化＝第二階段 |
| D-3 | 本機 `<WINDOWS_TEST_DEPLOY_ROOT>` | 降級為 Windows 平台**按需**驗證點：不常駐、不 canonical |
| D-4 | 跨平台腳本策略 | pwsh 7 **單一 codebase** ＋ platform adapter（`scripts/lib/platform/`） |
| D-5 | 執行序列 | 先 spike、通過才開工（**已完成，見 §4**） |
| D-6 | `:5173` 暴露 | 第一階段 `VIEWER_BIND_HOST=0.0.0.0` ＋ host-firewall approved-source allowlist；反代＝第二階段 |
| D-7 | self-referential bootstrap | 升級為**通用能力** ＋ fixpoint 重驗義務；以 **ledger ＋ 機器檢查**強制；規則須寫成**可攜形式** |
| D-8 | PR 邊界 | **部署目標抽象化**；實作兩個目標，容器化留 schema 空位（不實作） |
| D-9 | 與腳手架分家的關係 | 分家**後置**為獨立專案；新 repo ＝腳手架的家 ＋ 首個示範專案 |
| D-10 | repo 送達 ＋ 觸發 | 遠端 **HTTPS 零憑證 clone**（repo 為 public）＋ 本機**單一 operator 入口** dispatch |
| D-11 | 遠端帳號 | 建**專屬服務角色帳號** `DEPLOY_SERVICE_ACCOUNT`，不共用 legacy interactive account |
| D-12/13 | 單一擁有者 merge 授權 | **擱置** — 由 Codex PR #458 處理，本計畫不介入 |
| D-14 | env 組織 | **per-target env**，本機 canonical，重建時經 SSH 推送 |
| D-15 | 遠端 override | 僅允許 target registry 明確列出的 override allowlist；未知 key 一律拒絕。每個允許 key 必須經 type／enum／range／host-or-path schema 驗證。涉及 public host、listen/bind、port、CORS、credential/token、deployment/data root 或 runtime command 的 sensitive override，必須取得每次明確 owner approval；evidence 只記已驗證 effective config 與 secret key 名／指紋，不記 secret value。 |
| D-16/17 | IFC fixture 權威 | **MinIO `bim-control` 為雙方共同權威**；pin by key＋ETag＋size（＋versionId 若 bucket 有 versioning）；**mismatch fail closed**；本機 `storage/` 降為 ETag 驗證的 cache |
| D-18 | runtime evidence 來源 | **本機 Windows 瀏覽器打遠端**（真實跨網段路徑）；design gate 本就綁 Windows，零改動 |
| D-19 | lane ＋ PR 切分 | **Lane G ＋ 兩個 PR**（PR-A bootstrap 規則 → PR-B 遷移本體） |
| D-20 | Windows 驗證觸發 | **機器判定，三級**（見 §6.3） |
| D-21 | 遠端 sudo | **常態零 sudo**；佈建一次性人工、服務角色取得最小 container-runtime 權限、host firewall 一次設定 |

---

## 4. Spike 證據（2026-07-31 實測）

Spike 全程手動、未修改 repo、未 commit。三個未知全部有答案。

### 4.1 R1 — Kit 106.3 × Blackwell：**PASS**

官方 Technical Requirements 載明 Blackwell 在 Kit `< 106.5.3` 有支援缺口；實測該缺口**僅限 DLSS Ray Reconstruction**，不影響 RTX renderer 初始化或 WebRTC 串流。

```txt
Kit 自報：| Driver Version: 595.84 | Graphics API: Vulkan
          | 0 | NVIDIA GeForce RTX 5080 | Yes: 0 | 16303 MB | 10de | 2c02 |

擴充啟動：omni.kit.renderer.core-1.2.1
          omni.usd.schema.render_settings.rtx-1.0.2
          omni.hydra.rtx.shadercache.vulkan-1.0.0
          omni.hydra.rtx-1.0.3
          omni.kit.livestream.webrtc-10.1.2
          ezplus.bim_review_stream_streaming-0.1.0
          ezplus.bim_review_stream.messaging

啟動後 [error]/[fatal] 計數 = 0
Kit build：BUILD (RELEASE) SUCCEEDED (163.58s)，_build/linux-x86_64/ 完整
```

**結論：不需要升級 Kit SDK。** D-1～D-21 全部維持有效。

### 4.2 W1 — `KIT_STREAM_SERVER=auto` 地雷：**確認為真，已避開**

`bim-review-coordinator/src/config.ts:228` 的 `kitHostFromEnv()` 遇到 `"auto"` 會呼叫 `localIpv4ForStreaming()`，解析**coordinator 自己的** IPv4。coordinator 在容器內時會得到 bridge 網段 `172.x`，對瀏覽器無用；症狀為 signaling 通、畫面全黑。

**對策（必須寫入 per-target env）**：遠端目標一律顯式釘 `KIT_STREAM_SERVER=<REMOTE_TEST_HOST>`，禁用 `auto`；實值只由 private target config 提供。

### 4.3 W2 — 跨網段 WebRTC：**PASS，不需要 STUN/TURN**

```txt
Kit 側 socket：
  ESTAB  <REMOTE_TEST_HOST>:<KIT_STREAM_PORT>  ←  <WINDOWS_TEST_CLIENT>:<EPHEMERAL_PORT>

瀏覽器 console（@nvidia_omniverse-webrtc-streaming-library）：
  streamReady
  "Message sent to the stream: {config}"                 status 200
  "Message successfully recieved from stream."           status 200   ← 雙向 DataChannel
  "Config message successfully recieved from stream"     status 200
  "Message sent to the stream: {resize 1920x1080}"       status 200

video element（符合既有 healthy 判準：readyState=4 ＋ 影像尺寸 ＋ DataChannel 回應）：
  { id: "remote-video", readyState: 4, paused: false,
    videoWidth: 1920, videoHeight: 1080,
    tracks: [ {kind:"video", readyState:"live", muted:false, enabled:true} ] }
```

2-hop 無 NAT 路由讓 Kit 的 host ICE candidate 直接可達，**不需要 STUN/TURN**。

### 4.4 Spike 額外發現（會改變 PR-B 內容）

| 編號 | 發現 | 影響 |
|---|---|---|
| **F-1** | Linux headless **必須傳 `--no-window`**。缺少時 `carb.windowing-glfw` → `IAppWindow::startup failed` → `omni.kit.livestream.app: Failed to get the default app window` → crash | D-4 platform adapter 的必要平台差異，非可選 |
| **F-2** | Windows 開發的 repo `core.fileMode=false`，clone 到 Linux 後 `*.sh` 全為 `100644`；且 `repo.sh` 內部 `exec tools/packman/python.sh`，故「改用 `bash repo.sh`」**不夠** | D-10 clone 流程必須含 `chmod +x` 步驟 |
| **F-3** | app 自身 `first frame observed` 儀表與實際 WebRTC video 狀態**不一致**：video element 已 `readyState=4`/`1920x1080`/track `live`，儀表仍報 `not_observed`。推測其判定綁在「已載入 USD stage」 | 需查證是設計如此或儀表 bug；若為 bug 會讓未來 evidence 判讀失準 |
| **F-4** | Kit 預設綁 `0.0.0.0:49100` | 跨網段可達無需額外設定 |
| **F-5** | Kit 警告 `CPU performance profile is set to powersave` 與 `IOMMU is enabled` | 部署時應評估 CPU governor 設為 `performance` |
| **F-6** | crashreporter 自動上傳 minidump 至 NVIDIA（`code:200`） | 資料離開機器；評估 `/crashreporter/enabled=false` |

### 4.4.1 實作階段（2026-08-03）新增發現 — 每一條都由一次真實部署失敗揭露

靜態測試全綠、Windows 全綠，這些仍全部存在。共同形狀：**Windows 語意較寬鬆，於是相同程式碼在 Windows 上「看起來能動」**。

| 編號 | 發現 | 為何 Windows 看不到 |
|---|---|---|
| **F-7** | `python3 -m venv` 先建 `bin/python` 才跑 ensurepip，缺 `python3-venv` 時留下通過存在性檢查、卻在 `pip install` 才爆的半殘 venv | Windows venv 不分離 ensurepip |
| **F-8** | 三個 launcher 各自硬編 `.venv\Scripts\python.exe`，Linux 永不命中 → 落到裸 `python`（目標只有 `python3`） | Windows 路徑正好是硬編值 |
| **F-9** | pip 安裝與否由「五個固定套件」的 import 探測決定，新增 requirements 檔完全無效 → 改用 requirements **內容 sha256 指紋** | Windows 部署區歷史上手動裝過，缺口不會浮現 |
| **F-10** | `powershell.exe`／`-ExecutionPolicy`／`-WindowStyle` 皆為 Windows-only | 同上 |
| **F-11** | PowerShell 單元素陣列回傳時會解包 → `'-NoProfile' + @(...)` 變字串串接 → `-NoProfile-File`。**而用 `,@()` 修正會造成巢狀陣列，`Start-Process -ArgumentList` 直接拒絕** | Windows 前綴有三元素，永不解包 |
| **F-12** | 所有 TCP/UDP listener 探測用 `Get-NetTCPConnection`／`Get-NetUDPEndpoint` → Linux 一律回答「沒人在聽」。**port preflight 因此把每個埠都判為 FREE，從來不可能偵測衝突** | 這兩個 cmdlet 只有 Windows 有 |
| **F-13** | Kit launcher 內 `WindowsIdentity::GetCurrent`（Linux 直接丟例外）、`Get-NetTCPConnection`、以及硬編 `windows-x86_64` 的 `.bat` launcher | 同上 |
| **F-14** | hybrid compose 經 coordinator 的 `depends_on` 連帶啟動**容器版** kit-manager-api，與 host-native 版搶同一個 `127.0.0.1:8010` | Windows `SO_REUSEADDR` 允許第二個 socket 綁同一 addr:port，兩邊都「成功」，誰在回應未定義 |
| **F-15** | **host-native 服務在 SSH 斷線後全滅。** 真因不是 SIGHUP：pwsh 由 snap 安裝，子行程落在 `user@<uid>.service` 底下的 scope，systemd 在最後一個 session 結束時停掉該 unit。`setsid` 改的是 POSIX session、不是 cgroup，擋不住。解法＝`loginctl enable-linger`（已納入 provisioning，且 deploy 對其缺席 hard fail） | 本機部署的 session 不會結束 |
| **F-16** | governance／kit-manager-api 硬編 `--host 127.0.0.1`，dockerised coordinator 經 bridge 連不到（`/api/governance/files/tree` → 502）。conversion 綁 `0.0.0.0` 所以一直正常 | Docker Desktop 經 VM 把 `host.docker.internal` 代理進 loopback |

**方法論教訓**：F-16 診斷過程中，容器內以 `wget` 探測回報三個端點全不可達，差點導向「跨 bridge 網段不通」的錯誤結論——實際上該 image 沒有 `wget`。改用 `node` 對 owner-private target-scoped bridge 實測才得到 HTTP 200。**探測工具本身不存在時的失敗，與「服務不可達」在輸出上無法區分。**
### 4.5 風險登記修正

- **R8 撤銷**：service-manager unit state 不等於 effective firewall policy；spike 已改以 effective policy 與實際連線測量裁決。live host policy/state 只記錄於 private operations record。
- **R20 新增**：見 F-2（exec bit）。

---

## 5. PR-A — Self-Referential Change Bootstrap（先行）

### 5.1 為何必須先行

PR-B 改的正是**驗證機制本身**（deploy path）。§6 明文禁止測試部署區「驗證未 merge branch」，於是形成死結：新 deploy path 要驗證 → 只能在部署區驗 → 部署區只驗 `origin/main` → 得先 merge → 但沒驗過不該 merge。

§8 隔離 stack 補不了這個洞（明文「只管理 governance/coordinator」且「evidence 不得推論 Kit/WebRTC、GPU」）。

**若把規則與用法塞進同一個 PR，等於用自己剛定義的規則替自己發證** — 一開始就毀掉新機制的公信力。故必須分兩個 PR。

**PR #458（Codex 進行中）恰好是同模式的第二個實例**：它的 Known Risks 自陳「owner must manually post the exact canonical comment, then approvals must change from 1 to 0 ... before exact-head merge」。這證明本規則不是為本次遷移量身訂做的特例。

### 5.2 規則內容（可攜寫法，不含 AI-BIM 專有名詞）

**觸發（通則）**

> 當一個 PR 的變更對象**包含驗證機制本身** — deploy path、evidence harness、gate script、或決定 evidence 是否成立的契約 — 該 PR 無法用「變更前的機制」取得代表「變更後行為」的證據。此時允許以 `stack_kind=self_referential_bootstrap` 在該 branch 上取證。

**義務（三條，缺一則 evidence 視為未閉合）**

1. **標示** — evidence 必須標 `stack_kind=self_referential_bootstrap`，**不得**被引用為 deploy-target evidence 或 `isolated_branch_stack` evidence。
2. **理由** — 必須具體說明「為何既有機制取不到此證據」，不接受泛稱。
3. **fixpoint 重驗** — merge 後必須以**變更後的正規機制**重跑同一驗證並回貼結果。（編譯器 bootstrap 的 fixpoint：用舊機制建新機制，再用新機制重建自己。）

### 5.3 強制方式：ledger ＋ 機器檢查

- 新增 bootstrap 欠帳 **ledger**（格式屬腳手架、內容屬產品 — 分家時可乾淨切分）
- PR body 增加對應欄位
- **ledger 有未閉合欠帳時，擋下一個觸發同規則的 PR**（不擋無關 PR）
- 清除欠帳的唯一方式＝commit fixpoint 證據，該 commit 本身可 review

### 5.4 PR-A 任務清單

- [x] A1 — 定義 ledger schema 與檔案落點（`scripts/self-referential-bootstrap-ledger.json`）
- [x] A2 — 撰寫規則正文（`docs/agents/self-referential-bootstrap.md`；可攜、無產品專有名詞）
- [x] A3 — check：`scripts/lib/self-referential-bootstrap.ps1` 接入 `check-pr-body-evidence.ps1`（債務閘門 fail closed）
- [x] A4 — PR body evidence 欄位（`Self-referential bootstrap` / `Bootstrap ledger entry` / `Bootstrap reason`；template 已更新）
- [x] A5 — 測試：`scripts/tests/test-self-referential-bootstrap.ps1`（ledger 完整性 ×9、body gate ×10、E2E 接線 ×2）＋ agent-governance workflow step
- [x] A6 — 本 plan 文件（本檔）

---

## 6. PR-B — 遷移本體

### 6.1 部署目標抽象化（D-8）

目前「部署目標」不是一個變數，而是散落至少 5 個檔案的硬編常數 ＋ 17 處測試 fixture：

| 位置 | 硬編內容 |
|---|---|
| `scripts/deploy.ps1:54-57` | legacy local-host literal（實值不在 public plan 重複）、`FixedTestDeployRoot`、`DefaultEdgeSiteId`、`DefaultEdgeRuntimeDataRoot` |
| `scripts/dev/run-runtime-command-authority-host-native-evidence.ps1:7-8` | `FixedTestDeploymentRoot` ＋ DataRoot |
| `scripts/dev/find-deploy-blockers.ps1:1-2` | 路徑過濾字串 |
| `scripts/dev/rebuild-test-deploy.ps1:3`、`docs/plans/NOW.md`、`.claude/workflows/plan-test-deploy-and-tidy.js` | 文件與 workflow |
| `bim-review-coordinator/tests/config.test.ts`(×9)、`artifact-health-ledger.test.ts`(×2)、`governance-rule-run-for-session.test.ts`、`bim-streaming-server/tests/test_conversion_authority_api.py`(×2)、`scripts/tests/test-preflight-volume-alignment.ps1` | 測試 fixture |

`site_local_deploy` 顯示 repo 內已有 "site" 概念雛形，抽象化有現成著力點。

**Registry 需涵蓋**：target id、kind（`windows_host_native` / `linux_host_native` / *容器化留空位*）、連線方式、deploy root、data root、public host、port 拓撲、env 檔名、fixture 來源。

### 6.2 Platform adapter（D-4）

實測 canonical deploy path（`deploy.ps1` 1575 行 ＋ `scripts/lib/` 29 檔）真正綁 Windows 的只有三類原語、約 10 個呼叫點：

| 類別 | 呼叫點 | Linux 對應 |
|---|---|---|
| Process tree | `Get-CimInstance Win32_Process` ×2（`host-native-launcher.ps1:62`、`preflight-ports.ps1:14`） | `/proc/*/stat` ppid 或 `pgrep -P` |
| Port listener owner | `Get-NetTCPConnection` ×4（`kit-log-probe.ps1:40`、`preflight-ports.ps1:62`、`smoke-evidence.ps1:145`） | `ss -ltnp` / `/proc/net/tcp` inode→pid |
| 路徑與 binary | `repo.bat` ×12、`_build\windows-x86_64\...\kit.exe`、`.venv\Scripts\python.exe`、`cmd.exe` | `repo.sh`（**需 exec bit，見 F-2**）、`_build/linux-x86_64/...`、`.venv/bin/python` |
| Docker 偵測 | `com.docker.backend.exe`/`vpnkit.exe`/`wslrelay.exe`/`hub.exe` | `dockerd` / systemd |
| Kit 啟動參數 | （Windows 無） | **`--no-window`（F-1，必要）** |
| `-WindowStyle Hidden` ×4 | | Linux 需條件化 |

**ownership 語意等價性必須證明而非假設**：Windows 用 `Win32_Process.CreationDate` ＋ PID 防 PID reuse；Linux 對應為 `/proc/<pid>/stat` field 22 (starttime) ＋ `/proc/<pid>/exe` ＋ `cmdline`。這是安全閘門，需附等價性論證與測試。

### 6.3 契約改寫

| 檔案 / 章節 | 改寫內容 |
|---|---|
| §6 Script Contract | 部署目標由 registry 決定；operator 入口 `.\scripts\dev\rebuild-test-deploy.ps1 -Build` **措辭不變**；「freshly fetch `origin` with `+refs/heads/main:refs/remotes/origin/main`、不得 stale」**逐字保留**（遠端 clone 上可真實執行） |
| §5 Real IFC E2E | fixture 權威從「主工作區 local `storage/`」改為「MinIO `bim-control` 指定物件，以 manifest pin」；**同時修掉既有漂移**（文件列的 `storage\270_0dac5239-...ifc` 實際不存在；本機實為 `demo_lib_2026.ifc` / `fixture-bytes.ifc` / `許良宇圖書館建築_2026.ifc`，三者皆 89,394,282 bytes 同內容） |
| §3 Frontend Dual-Gate | 明確拆開 design gate（綁 Windows runner，**不變**）與 runtime evidence（來源為本機 Windows 瀏覽器打遠端目標） |
| §8 隔離 stack | 補述與新 `self_referential_bootstrap` kind 的關係與互不推論邊界 |
| `VIEWER_BIND_HOST` 原則 | 「viewer `:5173` 不可當**初始**入口，但允許作為 `/ui/open` 302 handoff 的 LAN 可達目標」（`consoleRoutes.ts:44-69` 證實 302 行為） |

### 6.4 Windows 按需驗證的三級觸發（D-20）

| 觸發路徑 | 要求的 Windows evidence | 成本 |
|---|---|---|
| `scripts/lib/platform/**` | Windows 分支單元／契約測試 | 秒級 |
| `scripts/deploy.ps1`、`scripts/lib/**`、`compose*.yml` | `.\scripts\deploy.ps1 -DryRun` 通過 | 分鐘級 |
| `bim-streaming-server/**`（Kit source／`.kit`／`repo.toml`） | 完整 Windows host-native 啟動 ＋ GPU evidence | 重（此類改動罕見） |

### 6.5 MinIO fixture pinning（D-16/17）

- manifest 記錄 `bucket/key` ＋ ETag ＋ size（＋ `versionId` 若 bucket 有 versioning）
- 取用前 `HEAD` 比對；**不一致即停止並明確報 fixture drift**，絕不以不同資料續跑
- 本機 `storage/` 保留為 cache，取用前以 ETag 驗證有效性

### 6.6 遠端佈建（已於 spike 完成，PR-B 需腳本化）

```txt
✅ 專屬服務角色帳號（exact name / uid / groups 見 private inventory）
✅ NVIDIA nvidia-driver-595-open（ubuntu-drivers 推薦值）
   — nouveau refcount=0 可直接 rmmod，無需 reboot、不影響其他使用者
   — nouveau 黑名單已存在，reboot 後不復返
✅ Docker CE 29.7.0 ＋ Compose v5.3.1
✅ PowerShell 7.6.4（snap）
✅ Node 20.20.2 ＋ npm 10.8.2（snap，符合 viewer engines ^20/^10）
✅ repo HTTPS 零憑證 clone → <REMOTE_DEPLOY_ROOT>
✅ host-firewall 規則已按 required service roles 與 approved private source ranges 準備
   ⚠️ exact ports, source CIDRs, activation state 與 shared-host impact 由 owner-controlled private runbook 管理
```

### 6.7 PR-B 任務清單

- [x] B1 — deploy target registry schema ＋兩個行為 descriptor（`scripts/deploy-target-registry.json`，schema `deploy-target-registry/v1`；`canonical_target=canonical-linux`；`reserved_kinds=[linux_container]` 留空位不實作）。canonical Linux 的 exact host/account/network/path mapping 僅由 repo-external owner inventory 注入；公開 registry 不保留實值。`local-windows.build_command` 保留 `.\repo.bat` 形式：既有測試斷言此形，裸檔名有 PATHEXT 失敗史，因此改 registry 而非改測試
- [x] B2 — `scripts/lib/platform/platform-adapter.ps1`：單一程式碼庫以 `$IsWindows`/`$IsLinux` 分派 process tree、listener owner、路徑解析、Kit 啟動參數（`--no-window` 由 registry 的 `extra_launch_args` 提供）。另含 `Resolve-PlatformSystemPython`——遠端只有 `python3`，裸 `& python` 在首次真實 Linux 部署靜默 no-op，故此函式必須只回傳 shell 真的叫得動的名稱
- [x] B3 — ownership 語意跨平台等價性論證 ＋ 測試：論證見 §5「ownership 語意」段（Windows `Win32_Process.CreationDate`＋PID ↔ Linux `/proc/<pid>/stat` field 22 starttime＋`/proc/<pid>/exe`）；可執行證據為 `scripts/tests/test-platform-adapter.ps1`（同一套斷言兩平台皆須通過）。Windows 與 Linux owner-private target 均已實跑通過，公開證據只保留去識別化結果。
- [ ] B4 — 收斂 §6.1 表列的 5 檔硬編常數 ＋ 17 處測試 fixture 到 registry
- [ ] B5 — clone 流程含 exec bit 修復（F-2）
- [ ] B6 — per-target env ＋ SSH 推送（D-14）；實作 registry-derived override allowlist、unknown-key fail-closed、per-key type／enum／range／schema validation，以及 sensitive override 的 explicit owner approval 與 redacted effective-config evidence（D-15）
- [ ] B7 — MinIO fixture pinning，fail closed（D-16/17）
- [ ] B8 — 遠端佈建腳本化（§6.6）
- [ ] B9 — 契約改寫（§6.3，含修掉 §5 既有漂移）
- [ ] B10 — Windows 三級觸發 changed-path classifier（D-20）
- [x] B11 — 取得 `stack_kind=self_referential_bootstrap` evidence（依 PR-A 規則）：PR #467 的 bootstrap evidence 位於 `docs/evidence/remote-linux-deploy-target/self-referential-bootstrap/`；formal preflight 的 inherited-open-ledger 自鎖由使用者核准一次性例外，例外不涵蓋 review、CI、approval 或 merge
- [x] B12 — merge 後 fixpoint 重驗並回貼（PR-A 義務三）：#459 squash `ad7a50cf` 為 mechanism_commit，8 個 verification_contract command 於 main 實跑 EXIT=0，attestation 依 `self-referential-fixpoint-attestation/v1` 產出，entry 經 #470 關閉
- [x] B13 — 部署 tag（owner 追加，2026-08-05）：每次對 canonical 目標**成功**部署後，operator dispatch 在「target 實際 checkout 的 commit」上打 annotated tag 並推送 origin，命名 `deploy-<yyyyMMdd>-<UtcTicks>-<NNN>`（日期＋timer ticker＋當日序號）。純函式 `Get-DeployTagName` 可測；序號以當日既有 tag 計數、碰撞自動遞增重試；push 失敗為硬錯誤（不留只在本機的 tag）；DryRun 與失敗部署不打 tag；tag 名與訊息不含 host/account/network（政策 A）
- [ ] B14 — fixpoint closure 接手程序（owner 追加，2026-08-05；取代 #471 的 suites-only 關帳）：(1) private-input root 齊備（InventoryPath／CanonicalEnvPath／IdentityFile 於 owner 私有目錄，ACL 限縮，schema/resolver/SSH 驗證 PASS）；(2) 遠端 `<runtime_data_root>/target.local.json` 由 **owner 明示授權後**另行 provision（transport 依契約絕不上傳/覆寫私有 topology）、chmod 600、不回顯任何 topology/帳號/token/env/key；(3) 以 **無 BootstrapRef** 的正規 rebuild 實跑部署；(4) 依 ledger `verification_contract` **原序執行全部 12 個 command**，不得重排或替換；(5) 全數通過後恰好三檔關帳：ledger open→closed、fixpoint/summary.md、fixpoint/attestation.json，保留 mechanism_commit `591f930b` 與不可變 contract digest；(6) PR body bootstrap 三列填 no/not applicable，exact-PR local preflight，正常 push（禁 force），CI/review/merge 後驗證 main 已含 closure。Ledger 在所有 gate 通過前保持 OPEN；經 agents-board 協調（codex→claude handoff 08-05）

---

## 7. 執行序列與阻塞

```txt
① spike                                    ✅ 已完成（R1/W1/W2 全 PASS）
② PR #458 單一擁有者 merge 治理             ✅ 已完成
③ PR-A #459 ＋ fixpoint #470                ✅ 已完成
④ PR-B #467 遷移本體                        🔵 review/repair 中
⑤ #467 merge 後首次以 canonical 身分         ⏸ ← 緊接正常 merge 的 fixpoint
    從 origin/main 重建
```

**目前收斂規則**：#467 只取得 orphan-ledger formal-preflight 的一次性例外；仍須通過 exact-head review、CI、正常 approval 與受保護分支 merge，且 merge 後立即由 freshly fetched `origin/main` 建立 fixpoint closure PR。

---

## 8. 待使用者決定的殘留項

1. **BLOCKING — legacy privileged credential remediation** — 該 credential 視為已 compromise；刪檔、residue scan 與改用專屬服務角色／key auth 都不構成撤銷。依目前核准範圍，PR-B 部署與 shared-host cutover 必須維持 HELD，直到 credential owner 在 repo 外完成 **credential-only rotate/revoke**（不得藉此停用 legacy account），並提交不含 secret／account／host raw value 的 attestation。attestation 最少記錄 `schema_version`、`private_incident_record_id`、`private_record_digest_sha256`、`target_role`、`credential_role`、`credential_kind`、optional `credential_fingerprint_sha256`、`remediation_action=rotated|revoked`、`legacy_account_state`、`performed_by_role`、UTC `performed_at_utc`、`old_credential_rejected=true`、`active_sessions_disposition`、`replacement_service_account_auth_verified=true`、`replacement_privilege_scope_verified=true`、`shared_host_impact_verified=true`、`lockout_guard_verified=true`、`rollback_channel_verified=true`、`verification_method`、`attestor`、UTC `attested_at_utc`、`status` 與 `secret_values_recorded=false`。舊 credential 不得作 rollback；僅可使用已驗證的 out-of-band recovery channel 簽發另一份新 credential。未具 attestation 不得勾選完成或宣告安全收尾。
2. **host firewall 是否啟用** — required allowlist 與 lockout guard 已設計；live state 與 shared-host impact 由 owner 在 private runbook 決定。
3. **憑證持久化位置** — operator credential store 受本機權限限制；禁止放入任何會被 repository 或 tooling backup 收集的路徑。精確位置只留 private inventory。
4. **F-3 儀表落差是否為 bug** — 需查證。
