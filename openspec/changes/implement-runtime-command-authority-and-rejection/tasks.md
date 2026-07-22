## 1. 基線與治理邊界

- [x] 1.1 記錄 dependency worktree 的 coordinator lease/stage-binding、Kit runtime command、viewer DataChannel/FakeKit與root contract基線
- [x] 1.2 依 `origin/main` `99cd722` 的 archive後真相更新 proposal/design/spec/tasks：除 `viewer-runtime-command-bridge` 外，直接 reconcile canonical `kit-datachannel-protocol`／`embedded-viewer-bridge`／`viewer-viewport` delta，不回寫 archive source或手寫design canon，並通過strict validation
- [x] 1.3 取得fresh GitNexus兩個CRITICAL symbols `createCoordinatorApp` 與 `App._openSelectedAsset` 的dependency-scope明確簽核；記錄HIGH viewer symbols與UNKNOWN Kit handlers的補強gate
- [x] 1.4 記錄使用者裁決：本輪以 `local-dev lab-only` 推進且 `production full=no`
- [ ] 1.5 Credential owner最新確認舊 A4/Ornith credential尚未撤銷或輪替；任何檔案不得記錄實值，且在外部完成前不得宣稱credential hygiene或full completion通過

## 2. Coordinator principal與lease authority

- [x] 2.1 先加入failing tests，涵蓋claim在session lookup前authenticate、legacy `user_id` mismatch、missing auth、production pending-IdP fail closed，以及raw lab credential dynamic sentinel不進response/audit/event/log/UI
- [x] 2.2 讓standalone viewer與console client在lab seam帶 `X-User-Token`，但不得把URL user id或header宣稱production credential，且log/test artifact不得洩漏值
- [x] 2.3 實作server-principal claim與principal-bound idempotent replay；local-dev raw carrier先做domain-separated one-way opaque subject、legacy body同法比較，cross-principal nonce重用不得回舊token/lease/detail
- [x] 2.4 將primary conflict改為generic response，將lease status改為authenticated self-only/redacted availability並含caller可見stage-binding resync摘要，補回歸測試
- [x] 2.5 新增internal-token保護的runtime-command authorization route，驗exact session、source client、current primary lease、expiry、lifecycle、event catalog；兩種stage-load event都要求transaction context，正常allow/deny一律HTTP 200 structured decision
- [x] 2.6 補valid、forged、expired、released、spectator、wrong-source、cross-session、blocked lifecycle、malformed、missing internal auth、HTTP status mapping與dynamic credential/token redaction tests

## 3. Server-owned Stage Binding transaction

- [x] 3.1 新增可注入clock的bounded `StageBindingAuthorityStore`，包含server-generated authorization/revision、`pending -> executing -> active|failed` atomic consume、獨立pending/executing deadlines、capacity/eviction、single non-terminal per session、supersede、active/last-good與idempotent completed record
- [x] 3.2 把public stage-binding route改為authenticated primary preauthorization；驗完整ordered artifact ID/role/load order並從session解析exact ready URLs，拒絕browser URL/revision authority；`openStageRequest`與`loadArtifactGroupRequest`都必須使用回傳transaction
- [x] 3.3 新增internal completion route；重新驗current lease/executing tuple/request，success才atomic更新active/last-good並append exactly-once `stageBindingApplied`，runtime failure只轉failed，normal allow/deny用HTTP 200
- [x] 3.4 補pending/executing不可見為active、atomic concurrent replay、interleaved request、slow-load跨pending TTL、executing expiry、tuple tamper、lease turnover、supersede、capacity、restart/missing state、duplicate completion與audit exactly-once tests

## 4. Kit runtime enforcement與terminal outcome

- [x] 4.1 新增可注入bounded runtime-authority transport，使用explicit loopback base、既有internal token、redirect refusal、timeout與secret-safe classified decisions；只把HTTP 200 structured allow/deny當正常decision
- [x] 4.2 對每個allowlisted mutator在任何USD/stage/selection/highlight/pickability/reset mutation前呼叫coordinator，且不做positive cache；production direct open與artifact-group都驗exact transaction，artifact-group只consume一次再以private immutable context進internal open primitive，readonly/video維持原路徑
- [x] 4.3 對well-formed attempt維持一個 `request_id`，success additive echo；拒絕只emit一個含 `runtime_state:unchanged|changed_unconfirmed` 的 `commandRejected`，不得dual-emit legacy unauthorized result
- [x] 4.4 將authority outage表示為 `lease_invalid + retryable:true + detail_code:authority_unavailable`，與真正invalid lease區分；補timeout/network/redirect/non-JSON/non-2xx/malformed與redaction tests
- [x] 4.5 讓 `loadArtifactGroupResult:accepted`保持non-terminal；每attempt用不可由payload偽造的immutable context，artifact-group internal open不得二次authorization，三個observed stage-success path只有在coordinator confirmation成功後才emit `openedStageResult:success`，interleaved/duplicate path不得產生第二個terminal
- [x] 4.6 補artifact-group一次authority call/一次mutation/一次terminal happy path、direct open wrong-session URL、完整composition tamper zero-mutation、atomic replay、confirmation failure、already-open、async open、load-status success與Kit-success/coordinator-failure `changed_unconfirmed` tests

## 5. Viewer與FakeKit consumer

- [x] 5.1 對每個runtime mutator自動補unique `request_id`，並確保real/FakeKit success與rejection維持correlation
- [x] 5.2 在viewer解析固定六值 `commandRejected`、retry與runtime-state fields，顯示persistent aria-live terminal state；`changed_unconfirmed`標stage unproven並阻擋盲retry/handoff直到authenticated status resync，raw credential不得進UI/log
- [x] 5.3 新增FakeKit deterministic one-shot rejection replay；證明production build不能只靠query啟用harness
- [x] 5.4 trusted `viewer_lease_token`晚到時，只在embedded、stage未matched、selected asset仍可開啟時重排既有deferred-open timer
- [x] 5.5 補visible rejection、retryable outage、changed-unconfirmed resync/block、one-shot replay、late-token單次恢復、timer replacement與matched-stage不重開tests

## 6. Wiring與可自動合併文件

- [x] 6.1 將`COORDINATOR_INTERNAL_API_BASE`與既有internal token經private host-native Kit/deploy env傳入；tracked samples只留空placeholder且log不得顯示值
- [x] 6.2 更新 canonical protocol/embedded/viewport schema與spec、`docs/contracts/streaming-datachannel-events.md`、service README/runbook、coordinator control-plane evidence boundary與rollback說明；不回寫 archived change source、手寫design canon、manifest或visual baseline
- [x] 6.3 執行tracked secret scan，確認lease/internal/auth header/raw response/host path不進event、log、fixture、bundle或sample

## 7. Verification與交付

- [x] 7.1 依同一baseline command跑affected coordinator、Kit、viewer、root contract、typecheck、lint與build，記錄差異
- [ ] 7.2 跑controlled browser coverage，證明visible rejection、FakeKit replay、late-token recovery、pending/executing/terminal UI與changed-unconfirmed status resync/block，保存trace/screenshot
- [ ] 7.3 跑Windows host-native Kit valid/forged/released/expired/wrong-source/outage/direct-open wrong-session/composition-tamper/concurrent replay evidence，包含first frame、observed stage、DataChannel terminal、request/runtime/session IDs、P95與zero-mutation或changed-unconfirmed proof
- [x] 7.4 跑GitNexus `detect_changes` against `main`、strict OpenSpec validation與independent correctness/security review，揭露production IdP、process-restart、atomic-consume response-loss與canonical protocol/schema drift residual risk
- [ ] 7.5 Commit、push、開dependency PR、修完required review/CI並merge；之後才rebase A4 convergence worktree與重跑A4-only exact impact

## 2026-07-22 verification evidence

- Coordinator：`npm run verify` 通過，63 個 test files、673 tests；build/typecheck 通過。
- Kit：`python -m pytest tests -q` 通過，146 tests；affected Python files 的 Ruff gate 通過。
- Viewer：`npm test` 通過，65 個 test files、707 tests；typecheck 與 production build 通過；以 forbidden carrier sentinel 執行 production build 後確認 `dist/` 無該值，且 source 不再以 `VITE_LOCAL_USER_TOKEN` 或 dynamic/bare `import.meta.env` 讀取 runtime carrier；changed-file ESLint 為 0 errors、6 個已存在於 `HEAD` 的 warnings。Full-repo lint 仍有 2 個無關既存 errors：`src/console/EdgeConsole.aliasRedirect.test.tsx:51`、`src/console/modelData/useConversionActions.ts:87`。
- Root/contracts：`python -m pytest tests -q -p no:cacheprovider` 通過，109 tests；`npx openspec validate --all --strict` 通過，62 changes、0 failures；`git diff --check` 通過。
- Deploy wiring：`scripts/tests/test-deploy-dryrun.ps1` 通過；tracked sample 只保留空 placeholder，current diff/untracked secret-safe scan 通過，未讀取或輸出真實 `.env` 值。
- Independent correctness/security review 第一輪發現六組 authority／credential／schema／proxy／lease UI／production identity blocker，均已以 focused regression 與負向 secret/bundle probes 修正；第二輪確認無剩餘 implementation blocker。先前 exact shared-symbol analysis 為已簽核 CRITICAL（221 changed symbols、57 affected processes、45 changed files），但 post-fix current working tree 的 `detect_changes(scope=compare, base_ref=main)` 連續三次 `Transport closed`，屬 unavailable、不是 pass；reviewer 已明確接受此 exact pre-rebase snapshot 的殘餘風險，該接受在 rebase 或後續 code change 後失效。
- Credential gate 維持 OPEN：舊 A4/Ornith credential 尚未由外部 owner 撤銷或輪替；僅限 `local-dev lab-only`，`production full=no`，因此 1.5 保持未完成。
- Browser baseline：`npx playwright test e2e/viewer-harness.spec.ts e2e/runtime-command-bridge.spec.ts` 通過 2 tests，並產生 harness screenshot/trace；但 7.2 所要求的 rejection/retry、late-token recovery、pending/executing/terminal 與 changed-unconfirmed resync 全覆蓋仍未完成，故 7.2 保持未勾選。
- 尚未完成且不得當作 pass：7.3 Windows host-native Kit/GPU runtime evidence、7.5 commit/PR/CI/merge。
