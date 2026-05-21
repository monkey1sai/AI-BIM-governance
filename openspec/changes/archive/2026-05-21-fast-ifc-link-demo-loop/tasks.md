# Tasks — fast-ifc-link-demo-loop

> `/goal` 視這份 tasks.md 為**參考路徑**;acceptance condition 見 `acceptance.md`。任一 task 失敗 stop 給人類。

## 0. Pre-implementation setup

- [x] 0.1 切 worktree + branch(`codex/openspec/fast-ifc-link-demo-loop` from `origin/main`)— 已完成
- [x] 0.2 寫 proposal / design / tasks / acceptance / spec deltas
- [ ] 0.3 GitNexus reindex(`npx gitnexus analyze --embeddings`)— 已 background 完成(Change 1 archive 後)
- [ ] 0.4 Commit scaffold(本 task 完成後)

## 1. GitNexus pre-impact analysis

- [ ] 1.1 `gitnexus_impact({target:"createCoordinatorApp", direction:"upstream"})`
- [ ] 1.2 `gitnexus_impact({target:"normalizeIntakePayload", direction:"upstream"})`
- [ ] 1.3 `gitnexus_impact({target:"ingestConversionReport", direction:"upstream"})`
- [ ] 1.4 `gitnexus_impact({target:"StreamingConversionClient", direction:"upstream"})`(class)
- [ ] 1.5 `gitnexus_context({name:"externalIfcReadyStore"})` 看 store 內 fields callers
- [ ] 1.6 任一回 HIGH/CRITICAL → stop,回報後等使用者裁定

## 2. Coordinator API — IFC download synchronization

- [ ] 2.1 新增 `bim-review-coordinator/src/services/ifcDownloader.ts`:
      `downloadIfcToSharedVolume(sourceRef, jobId, options): Promise<DownloadResult>` — streaming HTTP GET 寫到 `${STORAGE_ROOT}/ifc-cache/<jobId>/source.ifc`,timeout 由 env `IFC_DOWNLOAD_TIMEOUT_SECONDS` 控,失敗清乾淨 partial file
- [ ] 2.2 `bim-review-coordinator/src/services/externalIfcReadyStore.ts`:
      - 加 `download_status` 欄位 (enum: `pending|downloading|downloaded|failed`)
      - 加 `local_path` / `host_local_path` 欄位
      - 加 method `markDownloading(jobId)` / `markDownloaded(jobId, localPath, hostLocalPath)` / `markDownloadFailed(jobId, error)`
- [ ] 2.3 `bim-review-coordinator/src/app.ts` `POST /api/external/ifc-ready`:
      1. existing auth + normalize + idempotency
      2. **新增同步下載**:`externalIfcReadyStore.markDownloading(jobId)` → `downloadIfcToSharedVolume(...)` → `markDownloaded(...)` 或 `markDownloadFailed(...)`
      3. download 失敗 → 502 response `{ detail: "IFC download failed", ifc_ready_job_id, error, download_status:"failed" }`,**不** dispatch
      4. download 成功 → dispatch streaming-server 帶 `local_path` + `host_local_path`,**改回 200**(原 202)
      5. response body 加 `download_status:"downloaded"`, `message`, `local_path`(optional)
- [ ] 2.4 `GET /api/external/ifc-ready/:jobId`:response 加 `download_status` / `viewer_url` / `web_view_session_id` / `download_failure`(optional)
- [ ] 2.5 `bim-review-coordinator/src/config.ts`:加 `ifcDownloadTimeoutSeconds`(env `IFC_DOWNLOAD_TIMEOUT_SECONDS`,default 600)、`publicHost`(env `PUBLIC_HOST`,default `127.0.0.1`)、`storageHostRoot`(optional env `STORAGE_HOST_ROOT`)
- [ ] 2.6 Idempotent replay:既存 job 不重下載,直接回 200 加 `idempotent_replay:true`

## 3. Coordinator — viewer_url / local-web-view spawning

- [ ] 3.1 `bim-review-coordinator/src/services/externalIfcReadyStore.ts`:
      - 加 `viewer_url` / `web_view_session_id` 欄位
      - 加 method `setViewerLink(jobId, sessionId, viewerUrl)`
- [ ] 3.2 `bim-review-coordinator/src/app.ts` `ingestConversionReport` terminal `ready` 分支:
      在 `autoCreateOrActivateSession` 完成後,額外:
        a. spawn local-web-view session(沿用 `POST /api/local-web-view/sessions` 邏輯)
        b. 組 `viewer_url = ${publicHost}:${coordinatorPort}/ui/open?session=${lwv.web_view_session_id}`
        c. `externalIfcReadyStore.setViewerLink(jobId, lwv.web_view_session_id, viewerUrl)`
- [ ] 3.3 `POST /api/local-web-view/sessions`(既有):response 加 `viewer_url` 欄位(同 §3.2 b)
- [ ] 3.4 新 endpoint `GET /ui/open?session=<id>`:server-side 302 redirect to `http://127.0.0.1:5173/?session=<id>`;session id 驗證(`^lwv_[A-Za-z0-9_]+$`)

## 4. Coordinator — streaming dispatch payload

- [ ] 4.1 `bim-review-coordinator/src/services/streamingConversionClient.ts`:
      `createConversionJob` payload 加 `local_path` / `host_local_path`(對齊 §2.3 step 4)
- [ ] 4.2 `bim-streaming-server` host-native(non-Docker):
      - read `STORAGE_HOST_ROOT` env,把 dispatch payload 內 `local_path`(container view)轉成 host path
      - 優先用 `host_local_path` 若存在;否則 fallback 用 `STORAGE_HOST_ROOT` 拼 container path 後段
      - 既有 `source_ifc_ref` 保留作 fallback

## 5. Coordinator — /ui 3 卡單欄垂直重做

- [ ] 5.1 `bim-review-coordinator/src/public/dev-console.html`:整 main body 重寫
      - header `BIM 審查雲端 / 快速 Demo`(保留 `審查協調 (Review Coordinator)` 字串通過 dev-console.test 斷言)
      - 卡 ① 提交 ifc-ready 試控台 form
      - 卡 ② 下載/轉檔進度 polling
      - 卡 ③ viewer 連結
      - 移除既有 5 步 stepbar、guided cards、互動實驗室、本場會議資訊卡片(衝突檢討相關已 predecessor 刪)
- [ ] 5.2 `bim-review-coordinator/src/public/dev-console.html` inline script:
      - `submitIfcReady()` — 組 worker compat payload + POST /api/external/ifc-ready
      - `startJobPolling(jobId)` — `setInterval(5000, () => fetch GET .../{jobId})`,更新卡 ②/③ DOM
      - `copyViewerUrl()` / `openViewer()`
- [ ] 5.3 `bim-review-coordinator/tests/dev-console.test.ts` 更新斷言:
      - assert `審查協調` 字串保留
      - assert 卡 ① 三個 form 元素存在(`ifc_path` / `project_id` / `version` / `task_id`)
      - assert 卡 ② polling label 存在
      - assert 卡 ③ viewer_url label 存在
      - assert 「步驟 ③ / 3」/ 衝突檢討字眼仍 absent

## 6. Viewer — query-string auto-attach + 全螢幕

- [ ] 6.1 `web-viewer-sample/src/main.tsx`:解析 `?session=lwv_xxx`
      - 有 session → `bootstrapAutoAttachViewer(session)` helper(新)
      - 沒 session → `renderStaticEntryPrompt()` 顯示「請從 coordinator /ui 建立會議後再點連結」
- [ ] 6.2 `web-viewer-sample/src/clients/coordinatorClient.ts`:加 method `getLocalWebViewSession(sessionId)` → `GET /api/local-web-view/sessions/{id}`(若 endpoint 尚未支援 GET,改 `GET /api/review-sessions/{sessionId}/stream-config`)
- [ ] 6.3 `web-viewer-sample/src/App.tsx` / `AppStream.tsx`:全螢幕版面
      - 移除 NVIDIA `Forms.*` 切換邏輯(只剩 Stream / StreamOnly)
      - `headerHeight` 36px,加 footer 36px
      - top HUD:project name + session id + 重連
      - bottom HUD:kit instance id + WebRTC status + fps + diagnostic
- [ ] 6.4 `web-viewer-sample/scripts/verify-session-first-contract.mjs` 加新 assertion:
      - assert `main.tsx` 含 `URLSearchParams(location.search).get("session")`
      - assert `App.tsx` 不再 import `AppOnlyForm / ServerURLsForm / ApplicationsForm`(設計移除多 Forms)
      - assert footer HUD 元素存在

## 7. Postman collection

- [ ] 7.1 `docs/postman/fast-ifc-link-demo.postman_collection.json`(v2.1):
      - Submit ifc-ready POST(worker compat body, 600s timeout)
      - Poll ifc-ready job GET(Test 內 setNextRequest loop until viewer_url)
      - Open viewer GET(info only)
      - Environment variables: coordinator_base_url / webhook_secret / ifc_path / project_id / version / task_id
- [ ] 7.2 `docs/postman/README.md`:導入步驟、env 配置、Runner 跑法、debug tips

## 8. 邊界文字 carve-out

- [ ] 8.1 `AGENTS.md` §3.4 加 carve-out(允許 coordinator 同步下載 IFC 至 shared volume 作臨時通道)
- [ ] 8.2 `bim-review-coordinator/CLAUDE.md` MUST NOT 段加同樣 carve-out

## 9. OpenSpec spec deltas finalize

- [ ] 9.1 `openspec/changes/fast-ifc-link-demo-loop/specs/local-coordinator-ifc-ready-intake-boundary/spec.md`:## MODIFIED Requirements 加同步下載 + viewer_url 出現條件
- [ ] 9.2 `openspec/changes/fast-ifc-link-demo-loop/specs/conversion-webhook-lifecycle/spec.md`:## MODIFIED Requirements 加 dispatch payload local_path / host_local_path
- [ ] 9.3 `openspec/changes/fast-ifc-link-demo-loop/specs/demo-fast-mvp-orchestration/spec.md`:## MODIFIED Requirements 加 3 步 /ui runbook + Postman collection
- [ ] 9.4 `openspec/changes/fast-ifc-link-demo-loop/specs/documentation-source-of-truth/spec.md`:## MODIFIED Requirements 加 carve-out 記錄
- [ ] 9.5 `npx openspec validate fast-ifc-link-demo-loop --strict`:綠燈
- [ ] 9.6 `npx openspec validate --specs --strict`:整體仍綠

## 10. L1 unit verification

- [ ] 10.1 `cd bim-review-coordinator && npm run verify`(build + vitest)
- [ ] 10.2 `cd web-viewer-sample && npm run build && npm run test:session-first`
- [ ] 10.3 `python -m pytest tests -p no:cacheprovider`
- [ ] 10.4 `cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q`(baseline + 加 local_path / host_local_path 處理測試)

## 11. L3 GitNexus post-change

- [ ] 11.1 `gitnexus_detect_changes({scope:"all"})` 確認影響面 = §2 / §3 / §4 / §5 / §6 預期 file set
- [ ] 11.2 任一新出現的 unexpected file → stop debug

## 12. L4 container & network

- [ ] 12.1 `docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml --env-file .env.web-plane.host-kit.example up -d --build coordinator viewer`
- [ ] 12.2 `netstat -ano | grep -E ":(8004|5173|49100|49101)"`:5173 → 127.0.0.1, 8004 → 0.0.0.0, 49100/49101 host-native
- [ ] 12.3 `docker exec coordinator node -e "fetch('http://127.0.0.1:8004/health')"`:status=ok
- [ ] 12.4 `docker exec coordinator node -e "fetch POST /api/external/ifc-ready"`(用本機 fixture 或 worker compat payload):200 + download_status:downloaded
- [ ] 12.5 `docker exec coordinator node -e "fetch GET /api/external/ifc-ready/{jobId}"`:polling 看 viewer_url 出現(needs streaming-server real run + fixture)
- [ ] 12.6 `curl http://127.0.0.1:8004/ui/open?session=lwv_test` → 302 redirect to `http://127.0.0.1:5173/?session=lwv_test`

## 13. L5 真實 UI / client(mcp__claude-in-chrome)

- [ ] 13.1 `tabs_context_mcp` 取 tab 狀態
- [ ] 13.2 `tabs_create_mcp` 開新 tab navigate `http://127.0.0.1:8004/ui`
- [ ] 13.3 `read_page` 確認 3 卡單欄垂直 layout
- [ ] 13.4 `get_page_text` 確認卡 ① 三個 input + 卡 ② polling indicator + 卡 ③ viewer_url
- [ ] 13.5 `form_input` 填 ifc_path / project_id / version / task_id
- [ ] 13.6 `find` 「送出 ifc-ready」按鈕 + click
- [ ] 13.7 等卡 ② polling 顯示 downloaded → conversion ready
- [ ] 13.8 click 卡 ③「開啟 viewer」→ 自動跳轉 `127.0.0.1:5173/?session=...`
- [ ] 13.9 `read_page` viewer 頁面 全螢幕 stream HUD(top + bottom)
- [ ] 13.10 `read_console_messages` 無 unhandled error
- [ ] 13.11 `gif_creator` 錄整段 → `docs/verification/evidence/2026-05-21-fast-ifc-link-demo-loop/full-happy-path.gif`
- [ ] 13.12 Postman Collection Runner 跑通同樣 happy path(若 Postman 可用)

## 14. Commit / Push / PR / Merge

- [ ] 14.1 `git -C ".worktrees/fast-ifc-link-demo-loop" status` 確認 staged file set = §2-§9 expected
- [ ] 14.2 `git add` 指定路徑(不用 `-A` 避免誤加 *.ifc / node_modules)
- [ ] 14.3 `git commit` message(繁中,涵蓋 §2-§9 + verification summary)
- [ ] 14.4 `git push -u origin codex/openspec/fast-ifc-link-demo-loop`
- [ ] 14.5 `gh pr create`(繁中 title + description + gif evidence link)
- [ ] 14.6 GitHub Actions CI 全綠
- [ ] 14.7 Reviewer approves
- [ ] 14.8 `gh pr merge --squash`

## 15. Post-merge sync + archive

- [ ] 15.1 切回 main 工作目錄,`git fetch origin --prune` + `git pull --ff-only origin main`
- [ ] 15.2 切 archive branch:`git switch -c codex/openspec/archive-fast-ifc-link-demo-loop`
- [ ] 15.3 `git mv openspec/changes/fast-ifc-link-demo-loop/ openspec/changes/archive/<YYYY-MM-DD>-fast-ifc-link-demo-loop/`
- [ ] 15.4 把 spec delta(4 個 capability)併進 `openspec/specs/<capability>/spec.md`(模仿 predecessor archive PR #91 流程)
- [ ] 15.5 `npx openspec validate --specs --strict` 綠燈
- [ ] 15.6 更新 `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`(AGENTS.md §1.6):加 archive 摘要、Phase 進度更新
- [ ] 15.7 commit + push + open archive PR + merge
- [ ] 15.8 worktree closeout:`git worktree remove .worktrees/fast-ifc-link-demo-loop` + `git branch -D` local
- [ ] 15.9 `npx gitnexus analyze --embeddings`(GitNexus reindex final)

## 16. Goal done

- [ ] 16.1 §0 ~ §15 全 check
- [ ] 16.2 通知使用者 Change 2 archived;fast-mvp loop end-to-end 達成
