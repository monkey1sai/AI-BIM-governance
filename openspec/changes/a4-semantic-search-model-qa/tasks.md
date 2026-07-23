## 1. 前置檢查與基線

- [ ] 1.1 Rebase 到預定的 `origin/main`，確認專用 worktree／branch 除本 change 外乾淨，並記錄 exact cwd、HEAD 與 worktree 證據。
- [ ] 1.2 確認本 change 只修改 `a4-semantic-search`、`edge-console-operator-frontend`、`governance-issue-tracking`，三者均無 active successor conflict；不得重新加入 `unified-governance-console` delta。
- [ ] 1.3 協調 `migrate-console-to-hifi-design` 的 baseline ownership：指定哪個 change 執行最後一次 `workspace.a4.default` capture，防止 fixture-state golden 覆寫，並要求最後一次 token/style migration 後重跑 A4 semantic／visual gates。
- [ ] 1.4 把 `c-m4-runtime-command-bridge` 與後續 shared hardening 視為外部 dependency；A4 branch SHALL NOT 新增 shared event/schema/producer。若 authentic lease 或可信 terminal rejection 尚未由 owner capability 交付，A4 3D／full completion SHALL 為 `no`。
- [ ] 1.5 對 A4 search entrypoints、coordinator governance routes、Issue create/store、canonical A4 dock 與 viewer handoff/mapping bridge 執行 GitNexus impact；若為 HIGH 或 CRITICAL，編輯前停止並回報。
- [ ] 1.6 建立 governance A4 tests、coordinator proxy、viewer A4/component、既有 runtime authorization/result 與 `workspace.a4.default` semantic／visual baseline；既有失敗須與新 regression 分開保存。
- [ ] 1.7 新增或選用小型、非敏感 IFC 與真 mapping fixture，涵蓋 mapped、unmapped、match、non-match 與 truncation；大型／local IFC 維持 ignored 且不得提交。
- [ ] 1.8 由 credential owner 協調 rotate/revoke 已確認曾進入 Git 的 A4/Ornith credential；受影響 sample 只留 placeholder。證據只記 filename、key 與 status，不得把值寫入 log，也不得修改真實 `.env` secret；不把既有非 A4 development defaults 視為本 task 的 credential cleanup。

## 2. Governance Search 契約

> **S4-A complete 2026-07-23（PR #383 merged，result `84bdf5c`）**：只手工收斂 governance §2 search／LLM／proof／API 與 affected tests，保留 main `handoff.py`，並補上 search-issued proof → handoff verifier 的相容性 regression。Review 另補中文 proximity zero-scan、Unicode model binding 與 LLM total-deadline regressions。Targeted search/handoff 為 131 passed, 1 skipped；完整 governance suite 為 246 passed, 2 skipped；全 repo OpenSpec strict 為 63 passed。未呼叫 live Ornith、未接 coordinator proxy／Issue／UI，也未跑 A4 browser/Kit dual gate，故 `Full completion claimed: no`。

- [x] 2.1 先加入 failing tests，驗證 server-computed coverage 與不變量：`complete => schema_valid && usable && unresolved_terms=[]`、`schema_valid=false => complete=false && usable=false`、`usable=false => scanner not called`；deterministic 與 Ornith 都須包含遺漏 proximity constraint 的案例。
- [x] 2.2 實作明確的 `deterministic`／`semantic`／`auto` truth table；第一次 request 不得執行任何 `complete=false` candidate，schema-invalid／unusable candidate 永遠不得呼叫 IFC scanner。
- [x] 2.3 對可安全執行但不完整的 deterministic candidate，先回傳零 rows 的 `partial_fallback_confirmation_required`，顯示 exact filters／`unresolved_terms`，並發出短效、session／principal／model／artifact／binding-bound `partial_fallback_id`。只有另次明確確認 exact candidate 才 MAY 執行，且結果 SHALL 為 `partial_table_only`、`degraded_to_deterministic=true`、`partial_execution_confirmed=true`，不得發 proof 或啟用 Issue／3D。
- [x] 2.4 讓 `complete`、`usable`、`unresolved_terms` 由 governance-service validator 依原 query、normalized filters 與 consumed spans 計算；不得信任 Ornith 自報的 execution flags。
- [x] 2.5 Ornith client SHALL 回傳 sanitized served model、latency、finish reason 與 structured error class；empty、invalid、schema-breaking、length-truncated／non-terminal 與 incomplete/unusable output 都不得直接執行或外露 raw completion。
- [x] 2.6 `A4_LLM_ENABLED` 未設定時預設 `false`，不得因 key 存在而自動啟用。啟用時 URL、model、bounded timeout、credential、profile 與 transport mode 必須全部明確有效；`A4_*`／`ORNITH_*` aliases normalized 值衝突時 SHALL 回 `llm_config_invalid` 且 zero outbound。
- [x] 2.7 實作 transport matrix：`verified_https` 必須驗 hostname／CA；`loopback_tunnel` 只接受 `127.0.0.1`／`::1`；`trusted_lab_http` 只限明確 local-dev/lab profile、allow-insecure 與 allowlisted host。Production non-loopback HTTP SHALL fail closed，禁止 skip-verify。
- [x] 2.8 新增 per-attempt opaque `query_id`、optional `retry_of_query_id`、sanitized trusted session binding、structured interpretation/model metadata、secret-safe Evidence Trace，以及完整且合格 rows 的短效 governance-signed proof；不得建立 query-history store。
- [x] 2.9 新增專用 server-only signing keyring：唯一 active `kid`、previous verify-only key、missing/invalid config fail closed、不得提交 default key，也不得重用 Ornith token。
- [x] 2.10 結果統計 SHALL 誠實區分完整 candidate 的 `scanned`／`matched`／`not_matched`、limited `returned`、returned-row `mapped`／`unmapped` 與 `truncated`；fake/rejected mapping 不得取得 highlight eligibility。
- [x] 2.11 擴充 unit／contract tests，證明 schema-invalid、`complete=false usable=true`、`usable=false`、timeout、HTTP error、empty/truncated、未確認 partial fallback 都不呼叫 scanner、不發 proof，也不開 Issue／3D eligibility；另證明確認後只執行 exact bound deterministic candidate。
- [x] 2.12 Sanitized `GET /api/search/llm-status` 只回 `checked_at`、probe/query/config source、transport class、model、freshness/TTL 與 error code；endpoint、token、Authorization header、remote error body、raw probe／completion SHALL NOT 出現。

## 3. Coordinator Session 與安全邊界

- [x] 3.1 先加入 failing tests，涵蓋 active／missing／closed／incomplete session、server-side source/mapping/model/stage resolution，以及 browser `ifc_source_path`／`element_mapping_path` override rejection。
- [ ] 3.2 所有 session-scoped A4 search、Issue、handoff、consume、retry 與 viewer-lease claim SHALL 先由 `UserAuthProvider` 產生 server-authenticated principal；body `user_id`／actor 不得建立 authority，若 legacy 欄位與 principal 不一致 SHALL 拒絕。
- [ ] 3.3 Lease SHALL 綁定 authenticated principal。每次 Issue create、handoff create/consume、initial command authorization 與 retry 都須驗 session active、同一 principal、active unexpired primary lease、lease capability、primary artifact 與 `active_binding_revision`。
- [ ] 3.4 `local-dev` provider MAY 留在明確 lab profile，但 evidence SHALL 標 `auth_scope=local_dev_lab`；production 使用 `local-dev` 或 `sso_binding=pending_oq5` 時 SHALL 停用 A4 mutation/full-completion routes 或 startup fail closed。
- [x] 3.5 Harden `POST /api/governance/search/model/for-session/:sessionId`，先 authorize active session／principal，再從 coordinator-owned session/artifact state resolve 全部 host fields，最後才 forward-only proxy。
- [x] 3.6 Gate／disable generic `/api/governance/search/model` 的 production browser access；若仍需 internal test seam，只可 loopback/internal-gated、須有 path containment，且不得有 production UI caller。
- [x] 3.7 `for-ifc-ready/:jobId` 維持明確 `table_only` 相容 flow，移除 client mapping override／session proof，並回足夠 scope metadata 讓 UI 停用 Issue／3D／full completion。
- [ ] 3.8 新增 session-scoped A4 Issue proxy route，重新授權 session/principal，forward trusted non-overridable identity，並在 governance persistence 前拒絕 inactive／unauthorized／cross-session request。
- [x] 3.9 Coordinator integration tests SHALL 證明 byte-identical query controls、server-resolved fields、principal mismatch／stolen lease rejection、header 無法提權、governance authority 不變、actionable errors，以及無 secret/path leakage。

> S4-B（2026-07-23，branch `feat/a4-s4b-session-search-proxy`，commit `1915d40` 已建立 PR #384；後續 head／checks／merge state 以 GitHub machine truth 為準）：以獨立 `a4SearchRoutes` 在 frozen `governanceProxy` 前攔截三條 A4 search route；完成 3.1／3.5／3.6／3.7／3.9。Session path 以 authenticated principal、current primary lease 與 exact active binding server-side resolve model／artifact／source／mapping；host-kit transport 使用 exact-origin allowlist、server-only token、read-only artifact mount，以及 coordinator-visible／host-native 雙 namespace containment。Pre-PR local review 未發現新的 P1/P2；PR review 後續找出 web-plane repeated reconcile P2，本切片以 effective-config signature + regression 修正並待 PR gates 重驗。3.4 尚未勾選：production pending local-dev 已 fail closed，但 coordinator→governance 既有 trusted-context schema仍使用 `auth_scope=lab`，尚未收斂為 spec 字面要求的 `local_dev_lab`。GitNexus `detect_changes` 因 `Transport closed` 且 index stale 維持 UNKNOWN；Issue／UI／live model／browser／Kit／design gates 均不在本切片，Full completion claimed: no。

## 4. A4 Issue 來源證據

- [ ] 4.1 新增 additive、schema-versioned persistence field/table 保存 immutable `a4_evidence_snapshot`；歷史 Issues 仍可讀，且不需要 fabricated backfill。
- [ ] 4.2 定義三個不同 digest：`snapshot_hash` 綁 immutable A4 evidence；`proof_digest` 是 exact signed proof envelope bytes 的 SHA-256；`creation_request_hash` 是 server-normalized canonical create payload 的 SHA-256，必須包含初始 title／description／severity／assignee、IFC GUID、accepted prim、model/artifact/revision、`snapshot_hash` 與 `proof_digest`。
- [ ] 4.3 首次 consume SHALL 驗 signature、`kid`、expiry、current session/principal 與 `snapshot_hash`，並把 Issue、snapshot、proof ID、`proof_digest`、`creation_request_hash` 在同一 transaction 寫入；proof ID 為 unique idempotency key，`source_ref=query_id` 不得阻止同 query 的不同 rows 各自建立 Issue。
- [ ] 4.4 已 consumed proof replay SHALL 先重新驗 current session/principal，再 constant-time 比對三個 digest；完全相同時，即使 proof 過期或 signing key 已退休也回原 Issue。任一不符回 409，且不得形成 proof-existence oracle。
- [ ] 4.5 未 consumed proof 過期 SHALL 回 `a4_proof_expired`、`retryable=true`、`recovery=rerun_query`、`draft_preserved=true`。UI 只在 browser memory 保留 draft，重跑原 query/mode 後要求使用者重新核對 current row/binding，不得自動換 proof 或寫 partial DB row。
- [ ] 4.6 正常 rotation SHALL 保留 previous key 至最後一張 proof expiry 加 clock skew；emergency revocation MAY 立即拒絕未 consumed proof 並要求 rerun。已 consumed exact replay 只依 persisted digests，不依賴退休 key。
- [ ] 4.7 Tests SHALL 涵蓋 exact replay before/after expiry、old key removal、altered draft、不同 proof bytes、concurrent identical requests、same query different rows、unauthorized replay、expired-draft recovery、canonical JSON/Unicode normalization 與既有 source backward compatibility。

## 5. Canonical A4 UI 與 Issue 確認

- [ ] 5.1 以 live session-scoped component 取代 `#/workspace?dock=a4` fixture，並收斂 `#a4`、`#/a4` 與 separate semantic-search entry，不得建立第二套 A4。
- [ ] 5.2 移除 production path mode 與 browser mapping input；顯示 active-session binding，IFC-ready 相容結果須標 `table_only` 並停用 Issue／3D。
- [ ] 5.3 實作 idle、loading、success、empty、uninterpreted、semantic error、partial-confirmation-required、confirmed partial、retrying、retry-failed、source/session unavailable、proof-expired-draft-preserved 與 handoff creating/expired/rejected states；Retry 必須保留 explicit query/mode 並關聯 prior query ID。
- [ ] 5.4 移除 compliance copy、固定 `5 / 7` 與 fabricated citation；改顯示 query-match wording、sanitized LLM readiness、real filters、interpretation/served-model state、Evidence Trace 與 truthful counts。
- [ ] 5.5 實作 row selection、editable Issue draft 與 explicit confirmation；每個 row 使用自己的 signed proof 做 independent request，顯示 Issue ID 與 honest partial outcomes，且 proof expiry recovery 不得遺失 draft 或自動提交。
- [ ] 5.6 Component tests SHALL 涵蓋 canonical route convergence、所有 visible states、partial confirmation、no host path control、neutral labels、no fixture counts、retry/proof-expiry semantics、Console zero DataChannel send 與 select/edit/confirm/no-auto-Issue。

## 6. Primary-only 3D Handoff、Focus 與 Highlight

> **S1 done 2026-07-21（PR #365）**：governance 端 `verify_handoff_evidence` / proof-set 驗證權威已 merge main。
>
> **S2 done 2026-07-22（PR #380）**：session-scoped coordinator create／consume store、principal／lease／binding 重驗已 merge main。
>
> **S3 code complete 2026-07-23（PR #382；branch `codex/a4-s3-trusted-handoff`）**：session viewer 已加入 strict trusted-intent consumer、current session/model/artifact/revision/stage/DataChannel gates、single focus/highlight send、matching terminal correlation、10 秒 timeout 與 linked explicit retry。每次 command attempt 都重新讀 current session、stream config 與 caller-bound lease status；principal／lease／binding 漂移 zero-send。Mock authorized path 與 fail-closed path 有 unit/DOM evidence；正式 mounted resolver 仍回 `a4_authentic_lease_unavailable`，未跑 browser/Kit dual gate，故 `Full completion claimed: no`。

- [x] 6.1 新增 session-scoped coordinator handoff create／consume routes；governance 驗 proof/snapshot/model/mapping/accepted prim，coordinator 重新授權 current principal/primary 並比較 current artifact/revision，invalid multi-row set atomic reject，`expires_at` 取 configured TTL 與全部 proof expiry 的最小值，只存 opaque transient intent。
- [ ] 6.2 Mapped row click 只建立一個 `focus` handoff；明確 Highlight button 才建立 selected-set `highlight` handoff。只能導向 returned `/ui/open?session=...&a4_handoff=...`，URL 不得含 query/evidence/prim/proof，unmapped/spectator control 必須 disabled 並附原因。
- [x] 6.3 Session viewer 只消費 authorized trusted intent，比對 coordinator-bound model/artifact/revision 與 loaded stage，等待 DataChannel ready 後只送一個 `focusPrimRequest` 或 `highlightPrimsRequest`；不得假設 `console/unified/*` 已有 `mappingCache`，Console 不得送 WebRTC/DataChannel。
- [x] 6.4 沿用 unique `request_id` 做 ack correlation，顯示 pending/succeeded/rejected/timed-out，並以新 `request_id` + `retry_of_request_id` 做 linked retry；不得從 navigation/message send 推論成功。
- [x] 6.5 Initial send 與每次 retry 前都 SHALL 重新驗 authenticated principal、session、active primary lease、lease expiry/status、current artifact/revision；viewer 再驗 loaded stage 與 DataChannel readiness。任一變動必須 zero-send fail closed，過期 handoff/proof/lease 必須重新取得 authorized handoff。
- [ ] 6.6 A4 viewer 只消費 shared owner 已正式定義的 terminal result/rejection，不在本 change 新增 `commandRejected` schema、Kit/fakeKit producer 或 dual-emission rollout。Authentic lease／可信 rejection 未由 shared capability 提供時，Full completion SHALL 為 `no`。
- [ ] 6.7 Tests SHALL 涵蓋 handoff create/consume/expiry/atomic invalid set/replay/cross-session/cross-principal/wrong-binding、focus vs highlight、mapped/unmapped/truncated、no Console send、timeout 後 stage/lease/principal 改變、unchanged retry linkage、stale cache、capability tampering 與 spectator rejection。

## 7. Design、Browser、Runtime 與 Model QA

- [ ] 7.1 最後一次 Hi-Fi token/style migration 後，套用核可的 A4 copy/state correction，並只用 `node web-viewer-sample/scripts/capture-design-system-reference.mjs --rebaseline --confirm-rebaseline` 重新 capture `workspace.a4.default`；不得手改 golden。
- [ ] 7.2 執行 `pwsh -NoProfile -File .\scripts\tests\verify-design-system-reference.ps1 -VerifyOrigin`、Windows Chromium DPR1 1440×900／1920×1080 visual+semantic tests，以及 `pwsh -NoProfile -File .\scripts\tests\verify-design-system-visual-result.ps1 -TargetCommit HEAD -AllowUntrackedArtifacts`；要求 pixel diff ≤1% 且 semantic 100%。
- [ ] 7.3 修復 legacy A4 Playwright coverage，禁止 conditional skip false-pass；證明 canonical route、main actions、real coordinator API、deterministic fixture、全部 visible/recovery states、Console-to-viewer navigation、Issue confirmation、screenshot、trace、console 與 network evidence。
- [ ] 7.4 在 Windows host-native Kit 驗證 current first frame、stage、DataChannel、handoff ID、trusted mapped prim、shared authentic lease/capability、focus/highlight terminal result 與 forged spectator rejection；這是 external dependency gate，不授權 A4 branch 修改 shared runtime producer。
- [ ] 7.5 至少執行一次 authorized live lab smoke，透過 coordinator session route 使用 governance-service 明確 server-side configuration（`A4_LLM_BASE_URL`、`A4_LLM_MODEL`、transport/profile 與 injected credential）。缺值／衝突 SHALL fail closed；只使用 non-sensitive fixture/query，驗證 observed served model 是 `Ornith-1.0-35B`，artifact 只記 timestamp、sanitized query ID、served model、interpretation source、latency、finish reason、structured filters、status、config-source key names 與 secret-scan result。
- [ ] 7.6 驗證 live-smoke artifact、browser bundle、test output、support/deploy bundle 與 git diff 不含 token、Authorization header、raw completion、endpoint、absolute host path、internal SSH/deploy metadata 或 sensitive query；若 model unavailable，semantic/full completion SHALL 為 `no`，deterministic 結果另列。
- [ ] 7.7 `trusted_lab_http` 只可算 lab semantic integration evidence；只有 `verified_https` 或受信 `loopback_tunnel` evidence 才可滿足 production transport readiness。

## 8. 最終驗證、文件與 Review

- [ ] 8.1 從 `governance-service` 執行 `& "C:\Program Files\Python312\python.exe" -m pytest tests/ -v`；skipped evidence script 另列。
- [x] 8.2 從 `bim-review-coordinator` 執行 `npm test`、`npm run build`、`npm run verify`。
- [ ] 8.3 從 `web-viewer-sample` 執行受影響 unit/session tests 與 `npm run build`；A4 Playwright/design 必須另跑，不得以 build 取代 user-facing evidence。
- [ ] 8.4 Code-flow edits 後執行 GitNexus `detect_changes` 對 `main`，誠實處理 UNKNOWN/stale linked-worktree output，commit 前解決 HIGH/CRITICAL affected path。
- [ ] 8.5 更新 design/API docs 與 archive 後的 `edge-console-operator-frontend` Purpose，使 A4 依 evidence 標 live/partial、A5–A10 保持 roadmap；legacy A4 numbering 另案處理，不修改 `unified-governance-console` capability。
- [x] 8.6 執行 `npx openspec validate a4-semantic-search-model-qa --strict`、全 repo OpenSpec validation、`git diff --check`、secret scan 與 `git status`；generated caches/runtime artifacts 不得進入 change。
- [ ] 8.7 取得 correctness、security-boundary、user-facing operability/design 與 repo-hygiene 獨立 review；finding 必須修正或以具體 residual risk 記錄。
- [ ] 8.8 產出 machine-truth handoff：Frontend route、main buttons、fixture、backend API、observed runtime/query/request IDs、visible states、E2E command、screenshot/trace、design gate/screen/manifest/visual result、reference-missing scope、semantic/live-model/transport/auth gates、known gaps 與 `Full completion claimed`。
