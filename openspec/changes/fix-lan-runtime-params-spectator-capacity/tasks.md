# Tasks

## 1. OpenSpec

- [x] 1.1 建立 isolated worktree 與 branch `codex/openspec/fix-lan-runtime-params-spectator-capacity`
- [x] 1.2 撰寫 proposal / design / spec deltas / tasks
- [x] 1.3 跑 `openspec validate fix-lan-runtime-params-spectator-capacity --strict`

## 2. LAN Public Handoff Parameters

- [x] 2.1 更新 `compose.host-kit.yml`，傳入 `PUBLIC_HOST`、`COORDINATOR_PUBLIC_BASE_URL`、`VIEWER_PUBLIC_BASE_URL`、viewer bind host、viewer coordinator API/socket bases
- [x] 2.2 更新 `.env.web-plane.host-kit.example`，提供 local 與 LAN demo 參數註解
- [x] 2.3 更新 `scripts/start-web-plane-docker.ps1` 輸出，顯示 configured public coordinator/viewer URL，而非固定 `127.0.0.1`
- [x] 2.4 更新 `scripts/deploy.ps1` summary，讓 operator 直接看到 LAN 驗證 URL

## 3. Spectator Capacity

- [x] 3.1 在 coordinator config 加入 `KIT_SPECTATOR_COUNT`、port start、stride parsing 與 endpoint generation；hybrid deploy/compose 預設 5 個 spectator slots
- [x] 3.2 更新 host-native launcher / deploy path，將 spectator ports 傳給 Kit start script
- [x] 3.3 保留 explicit `KIT_INSTANCE_ENDPOINTS` 多 endpoint override，不追加 default spectators
- [x] 3.4 確認 stream-config 回傳 primary + spectator bindings 且 `viewport_sharing.spectator_ready=true`

## 4. Tests and Validation

- [x] 4.1 補 coordinator config unit tests：default 5 spectators、custom count、explicit multi-endpoint override
- [x] 4.2 補或更新 script/unit validation，確認 deploy default spectator ports 與 public URL output
- [x] 4.3 跑 affected test suite
- [ ] 4.4 跑 GitNexus detect changes before commit（attempted：MCP/CLI 目前只看主工作區索引，對此 git worktree 回報 no changes / not a git repository；已用 `git diff --stat` + `git diff --check` fallback）

## 5. Kit Build Preflight

- [x] 5.1 `Test-HostNativeEnvironment` 檢測 host-native Kit runtime build artifacts：streaming launcher 與 `kit.exe`
- [x] 5.2 `deploy.ps1` 在 artifacts 缺失且未 `-SkipKit` 時於 Phase 2 自動執行 `bim-streaming-server\repo.bat build`
- [x] 5.3 build 失敗時早停並指向 `scripts\.run\kit-repo-build.log`，避免 Phase 4b timeout 才暴露問題
- [x] 5.4 補 script-level tests 覆蓋 `NEEDS_BUILD` 與 happy path

## 6. Documentation / Handoff

- [x] 6.1 回報 LAN client 應開啟的 URL 形態：`http://<server-ip>:8004/ui/open?session=<review_session_id>`
- [x] 6.2 回報多人觀看驗證方式：primary page + `stream=spectator` page(s)，同 session、不同 WebRTC endpoint
- [x] 6.3 記錄已知 blocker：firewall、artifact public base、GPU/Kit runtime readiness
