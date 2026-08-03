# Plan — 持久化測試部署區遷移至遠端 Linux 主機

> 文件性質：**working plan**（Lane G）。不是 runtime/API contract，也不是完成證據。
> 與本檔衝突時，以使用者最新口令為準，其次根目錄 `AGENTS.md`，再才是本檔。
> 決策來源：2026-07-31 `/grilling` session（Q1–Q21）＋同日 spike 實測證據。

---

## 1. 目標與非目標

**目標**：把 `product-operability-and-script-contract.md` §6 的**持久化測試部署環境**從本機 Windows（`D:\Users\deploy\AI-bim-geo`）遷移到遠端 Ubuntu 主機，使本機 dev box 不再因部署區常駐而被佔用 GPU 與 port。

**非目標（本輪不做）**：

- §8 隔離 branch stack 的遷移（那是暫時性切片，跟著 CI/PR 生滅）
- 官方容器化 Kit（`repo.sh package_container`）— 列為第二階段
- coordinator 反向代理 viewer — 列為第二階段
- 治理腳手架分家到新 GitHub repo — 獨立專案（Q9）

---

## 2. 目標主機事實（實測，非假設）

```txt
host            192.168.20.181  (hostname: ez)
OS              Ubuntu 24.04.4 LTS, kernel 6.8.0-136-generic
board           Gigabyte Z890 EAGLE WIFI7 (chassis type 3 = desktop)
CPU             Intel Core Ultra 7 265K, 20 cores
RAM             96 GB
disk            1.8 TB NVMe
GPU             NVIDIA GeForce RTX 5080 (GB203, PCI 10DE:2C02), 16303 MiB
NIC             enp130s0 單一介面 192.168.20.181/24
Secure Boot     disabled
routing         192.168.10.0/24 → 192.168.20.0/24 為 2-hop、單一 L3 gateway、無 NAT
MinIO           192.168.20.234:9000 同網段可達（remote 10ms / local TCP 可達）
```

**共用性警告**：這台機器有其他使用者（實測期間有來自 `192.168.10.190` 的 session 與 tty1 實體 console 登入），且原本共用同一個 `ubuntu` 帳號。本計畫因此建立專屬服務帳號（見 D-11）。

---

## 3. 決策紀錄（Q1–Q21）

| # | 議題 | 決議 |
|---|---|---|
| D-1 | 遷移範圍 | §6 持久化測試部署環境 → `192.168.20.181`（非 §8 隔離 stack） |
| D-2 | Linux Kit runtime 形態 | **第一階段** host-native Kit ＋ web plane Docker（與現行同構）；官方容器化＝第二階段 |
| D-3 | 本機 `D:\Users\deploy\AI-bim-geo` | 降級為 Windows 平台**按需**驗證點：不常駐、不 canonical |
| D-4 | 跨平台腳本策略 | pwsh 7 **單一 codebase** ＋ platform adapter（`scripts/lib/platform/`） |
| D-5 | 執行序列 | 先 spike、通過才開工（**已完成，見 §4**） |
| D-6 | `:5173` 暴露 | 第一階段 `VIEWER_BIND_HOST=0.0.0.0` ＋ ufw 來源網段白名單；反代＝第二階段 |
| D-7 | self-referential bootstrap | 升級為**通用能力** ＋ fixpoint 重驗義務；以 **ledger ＋ 機器檢查**強制；規則須寫成**可攜形式** |
| D-8 | PR 邊界 | **部署目標抽象化**；實作兩個目標，容器化留 schema 空位（不實作） |
| D-9 | 與腳手架分家的關係 | 分家**後置**為獨立專案；新 repo ＝腳手架的家 ＋ 首個示範專案 |
| D-10 | repo 送達 ＋ 觸發 | 遠端 **HTTPS 零憑證 clone**（repo 為 public）＋ 本機**單一 operator 入口** dispatch |
| D-11 | 遠端帳號 | 建**專屬服務帳號** `bimdeploy`，不共用 `ubuntu` |
| D-12/13 | 單一擁有者 merge 授權 | **擱置** — 由 Codex PR #458 處理，本計畫不介入 |
| D-14 | env 組織 | **per-target env**，本機 canonical，重建時經 SSH 推送 |
| D-15 | 遠端 override | 全部可 override、**不設白名單**；但部署＋驗證當下**快照 effective env**（secret 只留 key 名與指紋） |
| D-16/17 | IFC fixture 權威 | **MinIO `bim-control` 為雙方共同權威**；pin by key＋ETag＋size（＋versionId 若 bucket 有 versioning）；**mismatch fail closed**；本機 `storage/` 降為 ETag 驗證的 cache |
| D-18 | runtime evidence 來源 | **本機 Windows 瀏覽器打遠端**（真實跨網段路徑）；design gate 本就綁 Windows，零改動 |
| D-19 | lane ＋ PR 切分 | **Lane G ＋ 兩個 PR**（PR-A bootstrap 規則 → PR-B 遷移本體） |
| D-20 | Windows 驗證觸發 | **機器判定，三級**（見 §6.3） |
| D-21 | 遠端 sudo | **常態零 sudo**；佈建一次性人工、`bimdeploy` 入 `docker` group、ufw 一次設定 |

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

**對策（必須寫入 per-target env）**：遠端目標一律顯式釘 `KIT_STREAM_SERVER=192.168.20.181`，禁用 `auto`。

### 4.3 W2 — 跨網段 WebRTC：**PASS，不需要 STUN/TURN**

```txt
Kit 側 socket：
  ESTAB  192.168.20.181:49100  ←  192.168.10.105:49825   users:(("kit",pid=30313))

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

### 4.5 風險登記修正

- **R8 撤銷**：先前判定「ufw active、port 全被擋」為**誤判** — 混淆了 `systemctl is-active ufw`（unit 在跑）與 `ufw status`（實際 `inactive`）。遠端目前無任何 port 被擋。
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
| `scripts/deploy.ps1:54-57` | `DefaultPublicHost='192.168.10.105'`（**本機 IP**）、`FixedTestDeployRoot`、`DefaultEdgeSiteId='site_local_deploy'`、`DefaultEdgeRuntimeDataRoot` |
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
✅ 專屬帳號 bimdeploy (uid 1001, groups: bimdeploy, docker)
✅ NVIDIA nvidia-driver-595-open（ubuntu-drivers 推薦值）
   — nouveau refcount=0 可直接 rmmod，無需 reboot、不影響其他使用者
   — nouveau 黑名單已存在，reboot 後不復返
✅ Docker CE 29.7.0 ＋ Compose v5.3.1
✅ PowerShell 7.6.4（snap）
✅ Node 20.20.2 ＋ npm 10.8.2（snap，符合 viewer engines ^20/^10）
✅ repo HTTPS 零憑證 clone → ~bimdeploy/AI-bim-geo
✅ ufw 13 條規則已暫存（8004/5173/49100/49110-49150 tcp、47998/48008-48048 udp
   × 192.168.10.0/24 ＋ 192.168.20.0/24，加 22/tcp lockout guard）
   ⚠️ 防火牆維持 inactive — 啟用會改變共用機器安全態勢，屬獨立決策
```

### 6.7 PR-B 任務清單

- [ ] B1 — deploy target registry schema ＋ 兩個目標定義（容器化留空位不實作）
- [ ] B2 — `scripts/lib/platform/` adapter：process tree、listener owner、路徑解析、Kit 啟動參數（含 `--no-window`）
- [ ] B3 — ownership 語意跨平台等價性論證 ＋ 測試（`CreationDate` ↔ `/proc/<pid>/stat` starttime）
- [x] B4 — 收斂 4 檔硬編常數到 registry（deploy.ps1、rebuild lib（含第三個常數 TestDeployEdgeSiteId）、run-runtime evidence harness、find-deploy-blockers）；test harness 改注入 sandbox registry 資料而非文字重寫 deploy.ps1。測試 fixture 的 D: 路徑為任意示例值、非漂移源，判定不收斂
- [x] B5 — clone 流程含 exec bit 修復（F-2）：New-RemoteRebuildScript（clone-if-missing、契約 refspec fresh fetch、reset+clean 保留 env、restore-exec-bits）
- [x] B6 — per-target env ＋ SSH 推送（D-14）＋ effective env 快照（D-15）：base 推送＋遠端 override（runtime_data_root/env.local，git clean 清不到）＋單一 merge 實作（遠端經 pwsh 呼叫同一 lib 函式）＋ secret 遮罩快照（sha256-8 指紋，值不落地）；operator 入口 -TargetId 預設 canonical。live SSH 待 B8 憑證佈建
- [x] B7 — MinIO fixture pinning（D-16/17）：manifest schema＋comparePin fail-closed＋cache sidecar 判定（multipart ETag 不可本地重算，靠下載時 sidecar）；live HEAD 重用 coordinator @aws-sdk/client-s3（createRequire，無第二 S3 實作）。manifest 初生為空，enrol 需 MinIO 憑證
- [x] B8 — 遠端佈建腳本化：`scripts/dev/provision-linux-deploy-target.sh`（idempotent；每個套件都對應一次真實部署失敗，含 python3-venv/ensurepip；NVIDIA driver 與 ufw 啟用刻意不含，理由寫在腳本內）
- [x] B9 — 契約改寫：§1 viewer 302 handoff 原則、§3 design-gate/runtime-evidence 兩機器切分、§5 fixture 權威改 MinIO pinned（並修掉指向不存在檔案的漂移）、§6 部署目標改 registry（operator 入口與 fresh-fetch 契約逐字保留）、§8 三種 stack kind 互不推論邊界表
- [x] B10 — Windows 三級觸發 changed-path classifier（D-20）：`scripts/lib/windows-verification-scope.ps1`（highest-tier-wins ＋ 明確豁免 docs/tests）＋ 接進 PR body 檢查＋template＋CI；自檢 PR-B 欠 tier `deploy_dryrun`，已實跑 `deploy.ps1 -DryRun` exit 0（解析到 Windows profile，佐證 B4 零行為漂移）
- [x] B11 — bootstrap 取證能力＋ledger 欠帳：`-BootstrapRef` 由 `Assert-BootstrapRefAllowed` 把關（entry 必須存在／open／宣告 deploy.ps1）；ledger entry `remote-linux-deploy-target` 已開（涵蓋全部 11 條 mechanism paths）；無 ref 時 script 與先前 byte-identical。首次 bootstrap 派工 EXIT=0，遠端 checkout 至 10e8068、exec bits 恢復、effective env 9 keys
- [ ] B12 — merge 後 fixpoint 重驗並回貼（PR-A 義務三）

---

## 7. 執行序列與阻塞

```txt
① spike                                    ✅ 已完成（R1/W1/W2 全 PASS）
② Codex PR #458 單一擁有者 merge 治理       🔴 進行中 — 阻塞 ③④
③ PR-A  bootstrap 規則 ＋ ledger ＋ check   ⏸
④ PR-B  遷移本體                           ⏸
⑤ merge 後首次以 canonical 身分             ⏸ ← PR-A 義務三的 fixpoint
    從 origin/main 重建
```

**阻塞說明**：`main` 目前 `required_approving_review_count=1` ＋ `enforce_admins=true`，而 repo 實質只有一位人類擁有者，GitHub 禁止 approve 自己的 PR → 死鎖。Codex 正以 PR #458「single-owner merge consent」處理。本計畫**不介入該決策**。

---

## 8. 待使用者決定的殘留項

1. **`ubuntu` 密碼是否輪替** — spike 期間因 sudo helper 的 stdin 覆蓋缺陷，密碼曾被寫入兩個 `644` 檔案約 3 分鐘（`/etc/apt/sources.list.d/docker.list`、`/etc/apt/keyrings/docker.asc`），已刪除且 `/etc` 全域掃描無殘留。既然已改用 `bimdeploy` ＋ 金鑰，輪替是低成本收尾。
2. **ufw 是否啟用** — 規則已暫存含 SSH lockout guard，但啟用會影響共用機器上的其他使用者。
3. **憑證持久化位置** — `C:\Users\IOT\.ssh\` 被本機權限設定擋住（Write 與 `ssh-keygen` 皆 denied）。`~/.claude` 不可用（在 claude-toolbox 備份範圍內，會被 commit）。
4. **F-3 儀表落差是否為 bug** — 需查證。
