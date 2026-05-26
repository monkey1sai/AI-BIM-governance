## 1. 設計與基礎結構

- [x] 1.1 從 brainstorming 收斂出 Mode C hybrid 入口設計;落地到 `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md`(13 章節,539 行)。
- [x] 1.2 從 spec 收斂出 implementation plan;落地到 `docs/superpowers/plans/2026-05-26-one-click-deploy.md`(13 個 bite-sized task,2700+ 行,含完整 PowerShell code 與 commit 指令)。
- [x] 1.3 確認 repo 不用 Pester(版本 3.4.0 老);測試風格沿用 `scripts\tests\test-pr-review-agent.ps1` 純 PowerShell + 自訂 `Assert-*` helpers。
- [x] 1.4 確認新增 deploy.ps1 不破壞 Mode A(`start-all.ps1`)/ Mode B(`start-runtime-manager-docker.ps1`)/ Mode C 既有 docker entrypoint(`start-web-plane-docker.ps1`);三者完全 0 行改動。

## 2. 共用測試 helper 與輸出模組

- [x] 2.1 新增 `scripts\tests\test-helpers.ps1`:`Assert-True` / `Assert-Equal` / `Assert-Throws` / `New-TestSandbox` / `Remove-TestSandbox` / `Write-TestPass` / `Write-TestFail` 七個 function。
- [x] 2.2 新增 `scripts\lib\deploy-report.ps1`:`Write-DeployTag`(支援 ok/fix/ask/skip/warn/fail 六級 tag,寫 stdout + `scripts\.run\deploy.log`)、`Write-DeployHeader`。
- [x] 2.3 新增 `scripts\tests\test-deploy-report.ps1`,3 個 case(寫 log / 各 tag 接受 + IsFail bit / unknown tag throws)。

## 3. Preflight read-only modules

- [x] 3.1 新增 `scripts\lib\preflight-docker.ps1`:`Test-DockerEnvironment` 回 audit { cliVersion / composeV2 / engineRunning / envFile / ok }。CLI / compose / engine 都接 scriptblock 注入。
- [x] 3.2 新增 `scripts\tests\test-preflight-docker.ps1`,5 個 case(happy / docker missing / engine down / envFile prefers real / fallback .example)。
- [x] 3.3 新增 `scripts\lib\preflight-host-native.ps1`:`Test-HostNativeEnvironment` 回 audit { venv (OK|MISSING|WRONG_VERSION) / kitLauncher (OK|MISSING_PATH) / nvidiaDriver (OK|MISSING) / ok }。Python probe / nvidia probe 都接 scriptblock。
- [x] 3.4 新增 `scripts\tests\test-preflight-host-native.ps1`,5 個 case(happy / venv missing / Python <3.11 → WRONG_VERSION / nvidia-smi missing / Kit launcher missing)。
- [x] 3.5 新增 `scripts\lib\preflight-env.ps1`:`Get-EnvKeyList` / `Get-EnvAudit` / `Test-EnvFiles` 對三個目標檔(root `.env` / `bim-review-coordinator/.env` / `.env.web-plane.host-kit`)做 missing-key audit。
- [x] 3.6 新增 `scripts\tests\test-preflight-env.ps1`,5 個 case(含 invariant 驗證:已有 key 不出現在 missing list)。
- [x] 3.7 新增 `scripts\lib\preflight-ports.ps1`:`Test-PortAvailability` 對 docker(8004 / 5173)+ host-native(49100 / 49101 / 47998)做 listen owner audit。`Get-PidsFromRunDir` 沿 `ParentProcessId` 遞迴展開 wrapper PID 的子孫(因為 :49100 owner 是 `kit.exe` child,wrapper PID file 內只有 PowerShell wrapper)。
- [x] 3.8 新增 `scripts\tests\test-preflight-ports.ps1`,3 個 case(全 FREE / 陌生 PID 佔 / 我們 PID file 內 PID 佔)。
- [x] 3.9 新增 `scripts\lib\preflight-volume-alignment.ps1`:`Test-VolumeAlignment` 對齊 `.env.web-plane.host-kit` 的 `RUNTIME_STORAGE_ROOT`,leaf 必須 = `storage`(否則 host-native conversion-service 寫死「parent 下找 storage/ 子目錄」對不齊),status enum = ALIGNED / MISSING_KEY / WRONG_LEAF。
- [x] 3.10 新增 `scripts\tests\test-preflight-volume-alignment.ps1`,5 個 case(ALIGNED / MISSING_KEY / WRONG_LEAF / 無 env file / relative path resolve)。

## 4. 有副作用模組

- [x] 4.1 新增 `scripts\lib\host-native-launcher.ps1`:`Test-AlreadyRunning` / `Remove-StalePidFile` / `Start-HostNativeService`(Start-Process + PID file)/ `Wait-HostNativeHealth` / `Resolve-ConversionParentRoot` / `Start-HostNativeConversion`(export `STORAGE_ROOT` + `STREAMING_CONVERSION_WORK_DIR`)/ `Start-HostNativeKit`(`-ResetUser` + `-SkipAutoLoad`)。從 `start-all.ps1` copy-once Start-LocalService / Wait-Health 邏輯,既有 script 不動。
- [x] 4.2 新增 `scripts\tests\test-host-native-launcher.ps1`,6 個 case(pure-logic 部分)。
- [x] 4.3 新增 `scripts\lib\kit-log-probe.ps1`:`Test-KitReadyFromLog` keyword scan(`app ready` / `Application started` / `launching Linux Kit` / `Streaming started` 四個 keyword 任一 match)+ `Wait-KitReady`(LISTEN + log 雙重判定 poll loop,90s timeout)。
- [x] 4.4 新增 `scripts\tests\test-kit-log-probe.ps1`,7 個 case。

## 5. Orchestrator deploy.ps1

- [x] 5.1 新增 `scripts\deploy.ps1`(薄 orchestrator,~500 行)。
- [x] 5.2 實作 Phase 1 preflight + audit JSON 落地到 `scripts\.run\deploy-audit.json`;hard-fail 條件(沒 Docker / 沒 nvidia-smi / Kit launcher 缺 / Volume WRONG_LEAF / .env 系列全缺)直接退 1。
- [x] 5.3 實作 Phase 2 auto-fix:venv / pip / .env missing-key merge / RUNTIME_STORAGE_ROOT append / Copy-Item .env.example→.env / 清 stale PID / 建本地目錄 / docker compose rm(若 web-plane 已 running 則 skip)/ docker compose build(image 缺或 -Build 才跑,web-plane 已 running 時 skip)/ docker compose pull(僅 -Pull)。`-DryRun` 退 0 不執行。
- [x] 5.4 實作 Phase 3 interactive guard:re-audit ports + whitelist Docker forwarder(wslrelay / com.docker.backend / docker.exe / vpnkit)+ 過濾 ourPidFile 後仍是「陌生 PID」才問 Stop-Process;Python `.venv` WRONG_VERSION 才問 recreate;`-Force` 全自動 y。
- [x] 5.5 實作 Phase 4 嚴格順序啟動:4a host-native conversion-service(Wait-HostNativeHealth `http://127.0.0.1:49101/health` timeout 30s)→ 4b host-native Kit(Wait-KitReady timeout 90s)→ 4c `Start-Process powershell.exe -File start-web-plane-docker.ps1` 隔離子 script;already-running 視同 `[skip]`。任一 stage fail 退 4,log 標 stage=4a/4b/4c。
- [x] 5.6 實作 Phase 5 post-start verify(coordinator / viewer / conversion 三個 URL),預設 warn 不 fail,`-StrictPostVerify` 才退 5。
- [x] 5.7 實作 `Print-FinalSummary`(在 Phase 1 之前定義,任何階段都可呼叫):成功印 Next 區塊與 stop 指令,失敗印「What might be running」與 recover 指令。

## 6. Layer 2 integration test

- [x] 6.1 新增 `scripts\tests\test-deploy-dryrun.ps1`,6 個 case(`-DryRun` exit 0 / Phase 1 header printed / audit lines 出現 / DRY-RUN marker / deploy-audit.json 落地 / Phase 4 不進入)。
- [x] 6.2 修正 `Write-Host` 走 Information stream:test 用 `*>&1` 全 stream redirect。

## 7. Layer 3 手動 smoke

- [x] 7.1 新增 `docs\runbooks\one-click-deploy-smoke.md`,7 步 checklist + Smoke Pass Log 表。
- [x] 7.2 實機跑 Step 1(cold start)+ Step 2(first deploy,`1m 42s` 全綠)+ Step 5(idempotent re-run,`5s` Phase 4 全 skip)。蓋章在 Smoke Pass Log 記 `2026-05-26 monkey1sai + Claude @ 2b9715b`。
- [x] 7.3 Step 3(coordinator UI)/ Step 4(viewer WebRTC 畫面)/ Step 6(`-Build` force rebuild)/ Step 7(失敗注入)在 PR review 階段由人類目視補驗。

## 8. 實機 fix iterations

- [x] 8.1 `$pid` automatic variable trap:`param($pid)` → `param($procId)`(preflight-ports.ps1 + plan range)。
- [x] 8.2 `$Args` automatic variable trap:`param($Args)` → `param($ArgList)`(preflight-docker.ps1)。
- [x] 8.3 `Assert-Equal $null Expected` Mandatory 限制:改 `Assert-True ($null -eq …)`。
- [x] 8.4 `[string]` cast `$null` → empty string:用 `IsNullOrEmpty` 區分。
- [x] 8.5 `$ErrorActionPreference='Stop'` + native cmd stderr promotion:改 `Continue`,主動檢 `$LASTEXITCODE`。
- [x] 8.6 `.env.web-plane.host-kit` Copy 後 `$resolvedEnvFile` 沒重 resolve:Phase 2 內 inline re-resolve + re-audit volume。
- [x] 8.7 子 script `start-web-plane-docker.ps1` stderr promotion:`Start-Process` 隔離 PowerShell process。
- [x] 8.8 Kit log 關鍵字實際 `app ready`(小寫):加入 keyword list 首位。
- [x] 8.9 Phase 3 用 Phase 1 stale port 資料 + 沒 whitelist Docker forwarder:Phase 3 開頭 re-audit + whitelist `wslrelay.exe` / `com.docker.backend.exe` / `docker.exe` / `vpnkit*.exe`。
- [x] 8.10 host-native PID file 不含 child kit.exe / python.exe:`Get-PidsFromRunDir` 沿 ParentProcessId 遞迴展開 + `[int]` cast 解決 `Get-NetTCPConnection.OwningProcess` UInt32 vs Int32 type mismatch。
- [x] 8.11 idempotent re-run Phase 2 多餘 docker rm/build:`webPlaneRunning` conditional skip。
- [x] 8.12 host-native conversion-service `invalid_ifc_input` 因為 `STORAGE_ROOT` 沒 set(`ifc2usdc_powershell_adapter.py` line 75-76):deploy.ps1 啟 conversion 前 `$env:STORAGE_ROOT = $RuntimeStorageRoot`。

## 9. 驗證

- [x] 9.1 9 個 Layer 1 unit test + 1 個 Layer 2 dry-run test 全綠(`pwsh -NoProfile -File scripts\tests\test-*.ps1` 全 `ALL PASSED`)。
- [x] 9.2 實機冷啟 deploy.ps1:`1m 42s`,Phase 1-5 全 `[ok]`,Kit 抓 `app ready`,Phase 5 verify coordinator / viewer / conversion 全 200。
- [x] 9.3 實機 idempotent re-run:`5s`,Phase 2 docker rm/build 全 `[skip]`,Phase 4a/4b/4c 全 `[skip already running]`,Phase 5 verify 全 200。
- [x] 9.4 實機 IFC-ready end-to-end:`POST /api/external/ifc-ready` → conversion `status=ready` → `model.usdc` / `metadata.json` 200 → viewer_url `http://127.0.0.1:8004/ui/open?session=<id>` 跟 redirect 200(NVIDIA web-viewer-sample HTML)。
- [x] 9.5 `gitnexus analyze --embeddings`:5,260 nodes / 9,419 edges(+218);`detect_changes scope=compare base=main` → `risk_level: low` / `affected_processes: 0`。
- [x] 9.6 `git diff --name-only main...HEAD` = 22 個檔(deploy.ps1 + 8 lib + 10 tests + 3 docs)+ OpenSpec change(本檔)。`start-all.ps1` / `start-web-plane-docker.ps1` / `start-runtime-manager-docker.ps1` / `compose.*.yml` 完全沒動。
- [x] 9.7 `git diff --check`:無 trailing whitespace(僅 LF/CRLF 正規化 warning,Windows host 預期行為)。
- [ ] 9.8 PR #124 reviewer 在 GitHub UI 補驗 Step 3 / 4 / 6 / 7(瀏覽器目視 / `-Build` / 關 Docker Desktop fail injection)。

Validation notes:

- 實機 12 個 fix iteration 已 commit 在 branch `docs/one-click-deploy-design-2026-05-26` 內,逐個對應 PowerShell 5.1 + WSL2 Docker + Omniverse Kit 的具體 trap。
- spec / plan 文件已對齊實機修補(`$Args` / `Assert-Equal $null` / `*>&1` stream capture 等都已 sync 進 plan 範例)。
- Layer 3 smoke runbook `docs\runbooks\one-click-deploy-smoke.md` 第一次蓋章 row 為 `2026-05-26 monkey1sai + Claude @ 2b9715b`;Step 3/4/6/7 留 PR review 補。
- 後續 follow-up:Phase 1 cosmetic 把 Docker forwarder 標 `[skip - docker forwarder]` 而非 `[ask]`;`scripts\stop-all.ps1` line 122 StrictMode 對空 `*.pid` 集合的 `.Count` 取用 issue(非本 PR scope)。
