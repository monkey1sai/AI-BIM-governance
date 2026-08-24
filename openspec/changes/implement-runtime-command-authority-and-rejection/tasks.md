## 1. 基線與治理邊界

- [x] 1.1 記錄 dependency worktree 的 coordinator lease/stage-binding、Kit runtime command、viewer DataChannel/FakeKit與root contract基線
- [x] 1.2 依 `origin/main` `99cd722` 的 archive後真相更新 proposal/design/spec/tasks：除 `viewer-runtime-command-bridge` 外，直接 reconcile canonical `kit-datachannel-protocol`／`embedded-viewer-bridge`／`viewer-viewport` delta，不回寫 archive source或手寫design canon，並通過strict validation
- [x] 1.3 取得fresh GitNexus兩個CRITICAL symbols `createCoordinatorApp` 與 `App._openSelectedAsset` 的dependency-scope明確簽核；記錄HIGH viewer symbols與UNKNOWN Kit handlers的補強gate
- [x] 1.4 記錄使用者裁決：本輪以 `local-dev lab-only` 推進且 `production full=no`
- [x] 1.5 Credential owner最新確認舊 A4/Ornith credential已撤銷（owner 於 2026-08-18 明確回覆「舊的已經被撤銷」；credential owner 為外部動作持有者，此為其最新確認）。任何檔案未記錄實值——本 repo 為 PUBLIC，撤銷事實以本行文字記錄，不附帳號、金鑰、端點或任何可還原的識別值。外部動作已完成，credential hygiene 前置解除；full completion 仍為 no（受 5.6／7.3／7.5 殘項限制）

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
- [x] 5.6 將viewer origin完整失敗態矩陣接到既有i18n keys；本切片已收斂runtime-command-rejection diagnostics、changed-unconfirmed binding、rejected stage-load，以及2026-08-12新收斂的stage-load-timeout（見下方RED/GREEN證據：兩觸發路徑皆有可見overlay/雙語診斷文案/late-result不覆寫證明，並新增`data-stage-failure-reason`狀態專屬test anchor）。2026-08-17兩個切片累計收斂七態：slice-1收no-session、viewer-origin-missing（含refresh動作）、lease-occupied（驗證＋holder-privacy負向斷言）；slice-2收session-preparing（conversion_status非終態→可見note＋#pipeline動作）、gpu-unavailable（kit-manager instances查詢失敗→誠實停用啟動＋#runtime動作）、lease-expired（heartbeat 404 lease拒絕→清lease＋手動re-claim）、first-frame-timeout（90s與stage-load busy-poll上限對齊，逾時→重試＋#runtime診斷）——各含RED→GREEN focused DOM tests（見下方同日期證據）。slice-3（同日）收斂stream-disconnected：viewer `_handleStreamStopped` 對parent發 vg01 `stream_state`（schema oneOf新分支＋contracts pytest正負例）、EmbeddedViewer origin守衛轉發、console pane可見斷線alert＋誠實回退全部streaming證據＋「重新連線」重掛iframe（mount nonce）。**console內嵌側12/12態全數收斂**。checkbox仍維持open：spec要求「Console內嵌viewport與viewer origin頁SHALL各自實作」——standalone viewer origin頁側的逐態盤點（部分態如stage系列已在、no-session/lease系列適用性需裁決）為最後殘項，production/full completion維持no。2026-08-18 slice-4收斂standalone側：6態present（stream-disconnected/first-frame-timeout補`stream-diagnostic-panel`錨點＋t() zh/en i18n＋`viewer-reconnect-stream`動作文案i18n）、4態裁決不適用（職責屬console parent）、2態lab-embed degraded by design（詳spec delta 2026-08-18段）；三條RED→GREEN focused DOM tests（含en接線）。5.6關閉；change整體closeout 7.5仍OPEN，不宣稱production/full completion

## 6. Wiring與可自動合併文件

- [x] 6.1 將`COORDINATOR_INTERNAL_API_BASE`與既有internal token經private host-native Kit/deploy env傳入；tracked samples只留空placeholder且log不得顯示值
- [x] 6.2 更新 canonical protocol/embedded/viewport schema與spec、`docs/contracts/streaming-datachannel-events.md`、service README/runbook、coordinator control-plane evidence boundary與rollback說明；不回寫 archived change source、手寫design canon、manifest或visual baseline
- [x] 6.3 執行tracked secret scan，確認lease/internal/auth header/raw response/host path不進event、log、fixture、bundle或sample

## 7. Verification與交付

- [x] 7.1 依同一baseline command跑affected coordinator、Kit、viewer、root contract、typecheck、lint與build，記錄差異
- [x] 7.2 跑controlled browser coverage，證明visible rejection、FakeKit replay、late-token recovery、pending/executing/terminal UI與changed-unconfirmed status resync/block，保存trace/screenshot
- [x] 7.3 跑Windows host-native Kit valid/forged/released/expired/wrong-source/outage/direct-open wrong-session/composition-tamper/concurrent replay evidence，包含first frame、observed stage、DataChannel terminal、request/runtime/session IDs、P95與zero-mutation或changed-unconfirmed proof
- [x] 7.4 跑GitNexus `detect_changes` against `main`、strict OpenSpec validation與independent correctness/security review，揭露production IdP、process-restart、rollback本身也不可達時的authority response-loss與canonical protocol/schema drift residual risk
- [ ] 7.5 Commit、push、開dependency PR、修完required review/CI並merge；之後才rebase A4 convergence worktree與重跑A4-only exact impact

## 2026-07-22 verification evidence

- Coordinator：`npm run verify` 通過，172 個 test suites、676 tests；build/typecheck 通過。
- Kit：`python -m pytest tests -q` 通過，155 tests；affected Python files 的 Ruff gate 通過。
- Viewer：`npm test` 通過，65 個 test files、727 tests；typecheck 與 production build 通過；以 forbidden carrier sentinel 執行 production build後確認 `dist/` 無該值，且 source 不再以 `VITE_LOCAL_USER_TOKEN` 或 dynamic/bare `import.meta.env` 讀取 runtime carrier；整體 changed-file ESLint 為 0 errors、8 個可在基準重現的既存 warnings，本次 review-fix changed files 為 0 errors、4 個既存 warnings。Full-repo lint 仍有 2 個無關既存 errors：`src/console/EdgeConsole.aliasRedirect.test.tsx:51`、`src/console/modelData/useConversionActions.ts:87`。
- Root/contracts：`python -m pytest tests -q -p no:cacheprovider` 通過，113 tests；`npx openspec validate --all --strict` 通過，66 changes、0 failures；`git diff --check` 通過。
- Deploy wiring：`scripts/tests/test-deploy-dryrun.ps1` 通過；tracked sample 只保留空 placeholder，current diff/untracked secret-safe scan 通過，未讀取或輸出真實 `.env` 值。
- Independent correctness/security review 第一輪發現六組 authority／credential／schema／proxy／lease UI／production identity blocker，均已以 focused regression 與負向 secret/bundle probes 修正；後續 review 確認 implementation blockers 已關閉。先前 exact shared-symbol analysis 為已簽核 CRITICAL（221 changed symbols、57 affected processes、45 changed files）；rebase 後 current-tree `detect_changes(scope=compare, base_ref=origin/main)` 兩次皆 `Transport closed`，屬 unavailable、不是 pass。Fresh 7.2 read-only review另發現並驗證修正 FakeStreamer rejection 假 side effect，最後明確接受 7.2 delta與此 GitNexus unavailable residual risk。
- PR #379 review round 發現四個 blocker：unsolicited terminal stage proof、post-mutation failure truth、iframe reload bearer handshake、session proof reset；均已加入 fail-closed regression。修正後 focused viewer 94 tests、Kit composition 24 tests、完整 viewer verify 與 Kit suite通過；本輪 GitNexus current-delta `detect_changes` 可用，結果為 HIGH（13 changed symbols、15 affected processes、8 code/test files）。
- PR #379 第二輪 review 另發現unproven heartbeat保留舊stage、empty pickable被誤拒、authorization response-loss卡executing、standalone lease過期、background task未保留強引用，以及protocol/README/i18n完成度敘述不一致；已補fail-before-mutation rollback、lease heartbeat/expiry fail-closed、task retention與對應回歸，focused coordinator 23、Kit stage/authority 54、viewer 79 tests通過。完整i18n keys刻意保留為5.6 open gap，不宣稱完成。
- Credential gate 維持 OPEN：舊 A4/Ornith credential 尚未由外部 owner 撤銷或輪替；僅限 `local-dev lab-only`，`production full=no`，因此 1.5 保持未完成。
- Controlled browser：在 `web-viewer-sample/` 以 `E2E_VIEWER_PORT=5181` 執行 `npx playwright test e2e/runtime-command-authority.spec.ts --config=playwright.config.ts`，Chromium 2/2 通過。Standalone FakeKit one-shot rejection期間 outbound count與 mock viewport 均維持 zero mutation，只有 explicit retry 才 focus `/World/Site`；embedded flow 證明 late authority只開一次、binding lifecycle為 `pending → executing → terminal (success)`、changed-unconfirmed 阻擋 focus/handoff直到 authenticated matching-revision status resync。兩個 trace與三張 explicit screenshot位於 ignored `artifacts/e2e/_output/`，CI會以 head-SHA artifact `functional-runtime-conv-<head_sha>`保存；current trace scan為raw user UUID 0、unknown lease UUID 0，唯一distinct lease UUID由committed mock route以`crypto.randomUUID()`產生且只出現在該harness流程，4個`X-User-Token` occurrence均鄰接public `[redacted]` carrier，`X-Viewer-Lease-Token` header-name occurrence 2、`Authorization` 0，未輸出任何值。Design fidelity對viewer-origin diagnostic surface為reference-missing，full frontend completion不宣稱；詳見 `docs/evidence/runtime-command-authority/browser-evidence.md`。
- 尚未完成且不得當作 pass：7.3 Windows host-native Kit/GPU runtime evidence、7.5 commit/PR/CI/merge。

## 2026-07-31 Task 5.6 partial-progress and corrective-review evidence

- #448 source head `956e9109c6a447127fb4bd471671231e65d731f7` 的commandRejected partial progress：`npm test -- --run src/console/windowParentMessage.dom.test.tsx` 通過82/82 tests；`npm run verify`通過typecheck、production build、78個test files／970 tests及23個structured-log tests；`git diff --check`通過。該切片已以merge commit `097540cfc1d0c9a19908857f9b40a86a36540099`進入main。
- #448 controlled browser：`E2E_VIEWER_PORT=5181 npx playwright test e2e/runtime-command-authority.spec.ts --config=playwright.config.ts` Chromium 2/2通過；它回歸既有runtime-command authority流程，不構成stage-load-timeout完成證據。兩個trace與三張explicit screenshot位於ignored `artifacts/e2e/_output/`。
- #448 design/deploy：`verify-design-system-reference.ps1`通過（13 screens、26 golden files）；`Window.tsx`同時命中approved `edge-console` surface與reference-missing routes，故`design gate status=mixed`、`full completion claimed=no`。`scripts/deploy.ps1 -DryRun`通過，未執行Phase 2或修改deployment state。
- #450 corrective review曾加入兩條timeout文案與focused tests，短暫達84/84與78個test files／972 tests；後續Luna／Terra／Sol交叉對抗審查指出visible overlay、late-result與單語technical diagnostic並未由測試證實，因此該code/tests已還原至main baseline，84/972不得作為Task 5.6 completion evidence。先前no-finding判定亦由此最終審查取代。
- GitNexus對#448的indexed exact impact：`App._handleCustomEvent`為HIGH（23 impacted、2 processes、4 modules）；四檔舊隔離index的MEDIUM delta（10 symbols、4 affected flows）只屬#448 source head，不是#450 final diff pass。#450最終修正為spec、tasks、ledger-only，依Lane政策不宣稱code-symbol detect-changes pass。
- 此切片不關閉5.6；完整失敗態矩陣、credential owner gate 1.5、Windows host-native Kit/GPU evidence 7.3與本change整體closeout 7.5仍OPEN，change保持active且不得宣稱production/full completion。

## 2026-08-12 Task 5.6 stage-load-timeout closure evidence（doc-drift reconciliation + additive test anchor）

- **Doc-drift發現**：`fix(viewer): terminalize stage timeout after late success (#463)`（merged 2026-08-04，commit `688543e2ad285995cf26253bf708efa269e07658`）與其後續`test(viewer): guard stale artifact terminal races (#468)`（commit `0639baa7029af6291a53da4b912e6d4fa36e1ed8`）已在#450 revert之後、本輪之前，重新把stage-load-timeout的可見overlay/雙語診斷文案/late-result不覆寫行為（`Window.tsx` `stageLoadTimeoutPresentation`與`_scheduleStageLoadTimeout`/`_failStageLoad`）與對應focused DOM tests一併落地進main，但`tasks.md`／`specs/viewer-viewport/spec.md`未同步勾選或更新，導致code與OpenSpec ledger不一致（判進度以code為準的既有教訓）。本輪RED階段即是對此既有實作的獨立重驗，非重造輪子。
- **既有覆蓋確認（本輪執行前即綠，非本輪產出）**：`npx vitest run src/console/windowParentMessage.dom.test.tsx` baseline 168/168 tests通過，含兩條`it.each`雙語（zh/en）test（45s排程deadline與90×1s busy-poll上限兩觸發路徑）驗證title/target/diagnostic/guidance可見文案，以及一條late-result test證明timeout terminal後的late `openedStageResult:success`不覆寫已顯示的失敗overlay（`renderToString`前後DOM逐字相等、`loadedStageUrl`維持null、lifecycle outcome維持`timed-out`）。
- **本輪新增缺口與RED→GREEN**：spec要求「每態SHALL有穩定測試錨點（data-uc／data-testid）」，但兩個stage-load-timeout觸發路徑先前只共用泛用`data-testid="stage-load-failure"`（與其他11態的stage-load失敗共用，例如authorizationFailed/missingUrl/invalidStage），無state-specific錨點。RED：新增3條test（`src/console/windowParentMessage.dom.test.tsx`，45s路徑／90×1s poll路徑／負向驗證「非timeout失敗不得誤標」）斷言新屬性`data-stage-failure-reason="stage-load-timeout"`，執行確認全部因屬性不存在而失敗（`AssertionError: expected ... to contain 'data-stage-failure-reason="generic"'`）。GREEN：`Window.tsx`新增私有欄位`stageLoadFailureReason`（僅`"stage-load-timeout" | null`）、`_failStageLoad`新增第5個optional參數`reasonCode`並在兩個timeout callsite傳入、於`_beginStageAttempt`/`_invalidateStageAttempt`(x2)/`_completeStageLoad`成功路徑鏡射既有`stageLoadFailureActive=false`重置點清空該欄位、render新增additive屬性`data-stage-failure-reason`（timeout態顯示`"stage-load-timeout"`、其餘stage-load失敗顯示`"generic"`，非failure時為`undefined`，不影響既有`data-testid="stage-load-failure"`）。3條新test轉綠。
- **回歸驗證**：`npx vitest run src/console/windowParentMessage.dom.test.tsx` 171/171 tests通過（168 baseline+3新增，零回歸）；`npx vitest run`（全套）78 test files／1072 tests通過（baseline 1069→1072，僅新增3條，零回歸、零既有test改動）；`npm run typecheck`（`tsc --noEmit`）通過、無錯誤；`npx eslint src/Window.tsx src/console/windowParentMessage.dom.test.tsx --ext ts,tsx --report-unused-disable-directives`（changed-file scope）0 errors／0 warnings；`git diff --check`通過（無trailing whitespace）。變更範圍純additive：新optional參數預設`undefined`、四個既有reset點鏡射清空、render新增獨立屬性，既有12個`_failStageLoad` call site與既有render屬性行為zero behavior change（由1072/1072零回歸與typecheck佐證）。
- **GitNexus**：本worktree index為stale且屬另一branch(`fix/close-linux-test-deploy-verifier-hardening`)/commit(`e3664b1`≠current`3f50bd1`)快照；`node scripts/dev/report-gitnexus-worktree-health.mjs --format json`回報`gitnexus_observation_missing`（未借用其他checkout index）。依`docs/agents/gitnexus-usage.md` unavailable gate：本輪current-turn未取得reindex授權，改以raw source/tests為advisory evidence——已手動grep並逐一讀過`_failStageLoad`全部14個call site與`stageLoadFailureActive`全部4個reset點，確認新增為純additive、不改變既有呼叫語意。此為已知揭露的殘留risk，非GitNexus pass。
- **範圍裁決**：5.6原文要求「viewer origin完整失敗態矩陣」，本輪僅收斂stage-load-timeout一態（矩陣12態中的第4態，前3態於2026-07-31已收斂）；no-session、session-preparing、viewer-origin-missing、lease-occupied、stream-disconnected、lease-expired、gpu-unavailable、first-frame-timeout共8態未經本輪驗證，狀態未知（非「未做」也非「已做」，僅誠實標記unverified）。5.6 checkbox維持open、`task_ledger`不從31→32（因5.6條目本身仍未整條達成），僅更新`current_slice`/`last_verified`/`subject_commit`反映本次進度。production/full completion維持no。

## 2026-08-17 Task 5.6 no-session／viewer-origin-missing／lease-occupied 三態收斂證據

- **範圍**：`ReviewSessionViewerPane.tsx`（review-room／a1-inline／a2-overlay 三模式共用）矩陣12態中的no-session、viewer-origin-missing、lease-occupied；純additive，不動claim gate、lease/heartbeat effects、highlight/batch邏輯與任何既有testid。
- **RED→GREEN**：新增3條focused DOM tests（`ReviewSessionViewerPane.test.tsx`）——(1) 空session顯示`data-testid="review-room-no-session"`專屬文案「尚未附掛 review session」且session input＋datalist候選仍可行動、manual start disabled；(2) runtime/status無`viewer.browser_url_base`時顯示`review-room-viewer-origin-missing`（role=alert、zh/en文案）＋新增`review-room-viewer-origin-refresh`重新整理動作，重fetch成功後note消失、manual start恢復；(3) 有效session不顯示no-session note。RED階段2條新test因anchor不存在而失敗（no-session note缺席、origin-missing只在lease後分支render）；GREEN後13/13。
- **實作**：新增`runtimeReady` state與`refreshRuntimeStatus` callback（原單次fetch抽出，`runtimeAliveRef`沿用alive語意）；origin-missing note改為常駐頂層條件render（`runtimeReady && !runtimeErr && !viewerOrigin`）並移除lease分支的重複testid render點；no-session note於`sid === ""`時additive顯示。lease-occupied既有實作（generic 409文案不洩holder、手動retry、不自動搶佔）本輪以強化斷言驗證：occupied note文案負向斷言不得命中`/lease_|viewer_|nonce|stream|display_name|holder/`。
- **回歸驗證**：focused 13/13；全套`npx vitest run` 79 test files／1083 tests全過（零回歸）；`npm run typecheck`（tsc --noEmit）通過；`npx eslint`（changed 2檔）0 errors／4 warnings且與main基線逐項相同（fast-refresh×2＋既有effect exhaustive-deps×2，零新增）。
- **GitNexus**：`gitnexus impact "Function:web-viewer-sample/src/console/ReviewSessionViewerPane.tsx:ReviewSessionViewerPane" -d upstream`＝HIGH（6 impacted、3 direct callers：A1GovernanceWorkbenchPage／pages.tsx／VersionDiffPage），exact epistemic；已依HIGH警示流程揭露並以純additive設計＋全套迴歸緩解。
- **範圍裁決**：本輪收斂3態（累計7/12）；session-preparing（需conversion status判定接線）、stream-disconnected（需WebRTC斷線偵測）、lease-expired（heartbeat失敗目前被靜默吞掉，需失效偵測）、gpu-unavailable（需kit-manager instances查詢）、first-frame-timeout（需啟動計時器）共5態需要新行為，未經本輪驗證，5.6維持open、production/full completion維持no。

## 2026-08-17 Task 5.6 slice-2：session-preparing／gpu-unavailable／lease-expired／first-frame-timeout 四態收斂證據

- **範圍**：`ReviewSessionViewerPane.tsx` 矩陣第8–11態；additive（新增3個state、1個derived flag、2個timer/probe effect、4個可見區塊），不動claim/highlight/batch既有邏輯與testid。
- **資料源與行為**：session-preparing讀runtime summary的`conversion_status`（非null且非`succeeded`即顯示status原文＋`#pipeline`連結）；gpu-unavailable由`kitInstanceCurrent()`（`/api/kit/instances/current`）查詢失敗觸發，manual start誠實disabled＋caption＋`#runtime`連結，refresh動作同步重測；lease-expired由heartbeat catch分類（`/404/`＋`/viewer lease/i`對應coordinator「Viewer lease not found or token invalid」）→清lease＋`*-lease-reclaim`手動re-claim，其他heartbeat失敗維持既有沉默重試不誤標；first-frame-timeout以`firstFrameTimeoutMs`（預設90_000，與stage-load-timeout的90×1s busy-poll上限對齊）計時，首幀到達即清除，逾時顯示`*-first-frame-retry`＋`#runtime`診斷連結。
- **測試縫**：`heartbeatDelayFn` prop預設綁定f4統一政策`viewerLeaseHeartbeatDelayMs`（結構不變式測試改釘default綁定原文）；`firstFrameTimeoutMs` prop供測試注入。A1/A2模式測試檔補`kitInstanceCurrent` mock。
- **RED→GREEN**：6條新focused DOM tests（preparing正負、gpu-unavailable、lease-expired過期→re-claim恢復、fftimeout逾時→retry、首幀到達防誤報）RED階段4條因行為不存在而失敗；GREEN後pane suite 19/19。
- **回歸驗證**：全套`npx vitest run` 80 files／1093 tests全過；`tsc --noEmit`零錯；eslint changed files 0 errors／5 warnings（基線4＋新增1條與既有兩條同類的刻意窄依賴`exhaustive-deps`，narrow deps by design避免timer每render重掛）。
- **除錯教訓（已入memory）**：python字串`''`經shell heredoc注入成字面backspace（0x08）使regex永不匹配且grep/sed顯示隱形——控制字元regex一律顯式`chr(92)+'b'`寫入並以repr驗證。
- **範圍裁決**：累計11/12態；stream-disconnected需viewer→parent的WebRTC斷線協定訊息（`Window.tsx`＋`EmbeddedViewer`＋datachannel契約文件），5.6維持open、production/full completion維持no。

## 2026-08-17 Task 5.6 slice-3：stream-disconnected 收斂證據（console 側矩陣 12/12 完成）

- **協定**：`Window.tsx` `_handleStreamStopped`（stopped/terminated 終態處理器）新增 `_postToParent({type:"stream_state",state:"disconnected",kind})`——複用既有 origin 白名單守衛；`tests/contracts/vg01-postmessage-v1.schema.json` oneOf 新增 `viewer-to-console: stream_state` 分支（additionalProperties:false、kind enum、state const）；`tests/test_runtime_command_contracts.py` 新增正負例（缺 kind／未知 state／token 滲入均 fail-closed），24 passed。
- **轉發**：`EmbeddedViewer` 新增 `StreamStateMessage` type＋`onStreamState` prop＋switch case；origin 守衛負例測試（evil origin 不轉發），18/18。
- **Pane**：`streamDisconnected` state＋`viewerMountNonce`；onStreamState(disconnected)→可見 alert（`*-stream-disconnected`）＋誠實回退（firstFrame/dataChannelReady/loadedStageUrl/stageProof 全清→highlight gate 立即回封鎖、evidence grid 回 not_observed=「不再顯示 Streaming 指示」）；「重新連線」（`*-stream-reconnect`）以 key nonce 重掛 iframe、不重新 claim；新 first_frame 到達自動清除。事件驅動即時轉入（優於 spec 的 5 秒內）。
- **RED→GREEN**：viewer 側於既有 stopped 測試加 stream_state 斷言（RED）→ 實作後 171/171；pane 2 條新測試 RED → GREEN 21/21。
- **回歸**：全套 80 files／1096 tests；typecheck 零錯；lint:baseline trusted=18/current=18/regressions=0。
- **範圍裁決**：console 內嵌側 12/12 全數收斂。5.6 不勾：spec 措辭「Console內嵌viewport**與viewer origin頁**SHALL各自實作」——standalone 側逐態盤點（stage-load 系列四態已於 standalone 收斂；no-session/session-preparing/lease 系列在 /ui/open 進入模式的適用性需 spec 裁決）為最後殘項。

## 2026-08-18 Task 5.6 slice-4 closeout evidence（standalone viewer origin 頁）

- 盤點方法：對 spec 12 態逐一核對 `Window.tsx` 實作面（handler／state／render 分支／錨點）與職責邊界（standalone 直開 vs console embed）；結論表落在 spec delta 2026-08-18 段（6 present／4 not-applicable／2 lab-embed degraded）。
- RED→GREEN：`windowParentMessage.dom.test.tsx` 新 describe「task 5.6 standalone 失敗態可見面（slice-4）」三條——RED（2 failed：`stream-diagnostic-panel` 錨點不存在，received HTML 證明行為面已在僅缺錨點）→ 加 `data-testid="stream-diagnostic-panel"`＋i18n 化後 GREEN 174/174。
- i18n 接線：`_handleStreamStopped`／`_handleStreamStartTimeout` 診斷、`loadingText`、MockViewport reconnect 按鈕改走既有 `t()`（zh/en）；en 模式測試斷言 Endpoint／Reconnect WebRTC 且不含中文標籤。
- 全套：`npx vitest run` 80 files／1099 tests 全過；`npm run typecheck` 零錯；`npm run lint:baseline` trusted=18／current=18／regressions=0（rules-of-hooks 對 use 前綴 helper 的誤判以測試結構調整消解，不動 baseline）。
- GitNexus：`impact _handleStreamStartTimeout -d upstream`＝impactedCount 5／direct 1；`detect-changes --scope compare`＝3 files／5 symbols risk high（`App.render` 內 additive testid＋t() 包裝所致，已於 PR 揭露；1099 tests 零回歸緩解）。
- 殘留誠實聲明：stage-mismatch 沿用共用 `stage-load-failure` 錨點（以診斷文字區辨）；lease 兩態之 lab-embed degraded 呈現為 by design 裁決非缺陷；7.5 closeout 仍 OPEN。

## 2026-08-24 Task 7.3 host-native evidence

- Run id：`runtime-authority-e2e-2b758381aeae49a482cff0bc15ff31c1`（Windows host-native isolated Kit，一次完整輪）。
- Latency：P95 = 130.27 ms（20 樣本，閾值 500 ms）。
- Zero-mutation proof：`all_pre_mutation_denials_preserved_stage = true`、`outage_preserved_stage = true`、baseline stage 保持不變。
