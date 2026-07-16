## 1. 前置變更與遷移閘門

- [ ] 1.1 確認 active MinIO changes已merge/archive；先執行`npx --no-install openspec validate align-frontend-design-system-reference --strict`，archive `align`並確認`agent-operability-governance`、`demo-fast-mvp-orchestration`、`documentation-source-of-truth`與`unified-governance-console` canonical specs已落地；再完成`migrate-console-to-hifi-design` rebase並撤銷／調和repo外origin與`VerifyOrigin`假設至 `docs/plans/*.html`唯一authority → `migrate` closeout → lineage rebase最新`origin/main`並strict validate。Lineage不得重建`align`目錄或重複宣告其delta；不得只確認兩者closeout而把衝突authority一起archive。
- [ ] 1.2 建立 governed-vs-legacy compatibility matrix，固定 `/model.ifc` watcher 只能產生 legacy intake、`manifest.json` 才能產生 governed `READY`，並列出 rollback/dual-read 期間。
- [ ] 1.3 Predecessor closeout後，對 `minio-watch-auto-intake`、`local-coordinator-ifc-ready-intake-boundary`、`streaming-ifc-usdc-conversion-authority`、`conversion-kit-lifecycle-recovery` 與 `local-artifact-shadow-metadata` 補必要MODIFIED deltas並重新 strict validate；既有`external-cloud-callback-lifecycle`行為保持不變，governed lineage publication由新capability擁有；完成前不得開始runtime接線。

## 2. 根契約與schemas

- [ ] 2.1 在 `tests/contracts/` 建立 `model_version_bundle_manifest.json` 與 validator/negative fixtures，覆蓋 required roles、publish-last、conditional create、etag/SHA-256/size mismatch、replay 與 `LEGACY_UNMANAGED` enrollment。
- [ ] 2.2 建立 `lineage_alignment_report.json`，保留source UUID36字串、固定derived canonical UUID36↔GlobalId22 round-trip、stable root prim、eligible `IfcProduct` scope、三種 ratio 分母／zero-denominator `not_evaluable` 與差異集合。
- [ ] 2.3 建立 `pipeline_job_attempt.json` 與 `result_manifest.json`，覆蓋 coordinator-owned stable job、streaming-owned immutable attempts、`WAITING_CAPACITY`、attempt outcome／publication與result-scoped selection三軸、same-digest replay／different-digest conflict、selectable matrix、`AVAILABLE`、compare、active pointer、activation/promote/rollback audit與retention。
- [ ] 2.4 保持`ifc_ready_payload.json`與`conversion_result_callback.json`既有workflow callback路徑／events不變；additive governed source intake另建`source_bundle_ready` intake payload contract（不得成為cloud event），Cloud Ingest另用`cloud-lineage-publication/v1`，不得形成雙重authority。
- [ ] 2.5 將本change的`contracts/cloud-lineage-publication-request-v1.schema.json`、response schema與valid/invalid examples promotion到`tests/contracts/`可執行fixtures；覆蓋四個stable refs、唯一`?versionId=` query、locator authority等於top-level `edge_site_id`的semantic validator、no-presigned/no-element-rows、三組metrics、zero denominator、bounded warning codes、兩種events與strict `additionalProperties:false`。
- [ ] 2.6 將HMAC raw-body canonicalization、canonical unsigned decimal Unix-seconds timestamp header／非canonical格式拒絕、±300秒skew、header/body event match、201/200 ACK、403/409/422與malformed/202 protocol failure建立contract tests；另驗證pre-validation error可不帶`event_id`、若帶則必須是有效UUID。Reference MySQL 8 DDL保持醒目`REFERENCE ONLY`，不得作repo migration。
- [ ] 2.7 在 repo root 跑 contract schema/fixture tests，並以 malformed UUID、child-mesh mapping、zero denominator、premature/digest-conflict manifest、大小寫presigned-like／額外query locator、cross-edge-site locator、element-row payload、same-health-event/different-body、bad HMAC/ACK、cross-job compare、non-AVAILABLE promotion、stale authorization decision與 unauthorized force release 等 negative cases證明 fail closed。

## 3. bim-review-coordinator權責

- [ ] 3.1 實作 additive `POST /api/external/source-bundles/ready`、MinIO source manifest discovery/validation、minimal shadow fields 與 explicit legacy preview/confirm enrollment；producer ready claim必須重驗、polling只作reconciliation，既有`/api/external/ifc-ready`保持不變，local `storage/`/`ifc-cache` 僅作 cache。
- [ ] 3.2 由 coordinator以 `source_bundle_id` 建立 durable stable `pipeline_job_id` 與 idempotent auto-enqueue；restart 後可恢復 pending/admission/publication state，streaming restart與 replay不建第二個 logical job。
- [ ] 3.3 實作 active-result pointer、candidate results、`result.compare` read-only compare、capability-gated promote/rollback與append-only activation/transition audit；由coordinator驗證external control-plane authorization decision並執行意圖，`governance-service`不成為lineage RBAC／active-result owner；只接受 `AVAILABLE + succeeded|succeeded_with_warnings` selectable target，拒絕cross-job、failed/cancelled與non-AVAILABLE target。
- [ ] 3.4 擴充 browser-facing coordinator APIs，提供 bundle/artifact/alignment/attempt/audit read models、intent/confirm actions 與短效 presigned individual download，不暴露 MinIO secrets。
- [ ] 3.5 跑 coordinator affected Vitest/integration tests，特別驗證 manifest integrity、restart recovery、idempotency、authorization、Range/resume refs 與 callback outbox separation。

## 4. bim-streaming-server轉換權威

- [ ] 4.1 在 internal request/ledger 導入 coordinator-issued `pipeline_job_id` 與 streaming-issued `attempt_id`，按 failure classification 實作 backoff、same-attempt publish resume；semantic-invalid 原 job進入 `manual_correction_required`，修正必須建立新 source bundle／job。
- [ ] 4.2 解析 `schedule.csv` 並以 UUID36↔GlobalId22 round-trip join；在 `element_mapping.json` additive 寫入 `rvt_element_id`、`ifc_uuid36`、`mapping_status`、`diagnostics[]`，保留既有 `ifc_guid`／`usd_prim_path`。
- [ ] 4.3 強制 mapping 指向現有 `/World/Elements/<IfcClass>/G_<encoded_guid>` stable root，並加入 child-mesh target rejection tests。
- [ ] 4.4 產生 JSON/CSV alignment reports 與三種 ratios；denominator非0時以decimal除法向零截斷至小數第10位，denominator 0輸出 `ratio=null`／`not_evaluable`；partial alignment使用 `succeeded_with_warnings`，並驗證三組numerator／denominator與`eligible_ifc_product_count`、`ifc_usdc_unmapped_count`、`csv_valid_count`、`csv_only_count`、`ifc_only_count`、`full_lineage_matched_count`精確一致，特別要求`ifc_only_count == eligible_ifc_product_count - rvt_ifc_alignment_ratio.numerator`，且full-lineage count不大於RVT→IFC numerator。
- [ ] 4.5 以 attempt-scoped MinIO prefix 先發布 USDC/sidecars/reports、最後 conditional-create result manifest；local artifact directory 僅作 staging/cache。
- [ ] 4.6 跑 streaming affected pytest/API/integration tests，驗證 real USD openability、mapping/index consistency、publication resume、result integrity 與 local-cache rebuild。

## 5. Runtime admission與Kit釋放

- [ ] 5.1 在 conversion dispatch 前建立 topology-independent admission record，包含 `required_runtime_capabilities[]`、profile、`requires_exclusive_runtime`、nullable lease、readiness evidence、blocker codes與 observed time；automatic/manual/retry共用同一路徑，CPU/non-exclusive profile不得建立假 Kit lease。
- [ ] 5.2 實作 `WAITING_CAPACITY` 不配置 attempt、不任意 timeout，並驗證 lease loss/readiness regression 會回到 admission。
- [ ] 5.3 在 Kit Manager/runtime control 實作 cooperative drain/close/release；active viewer/session 阻擋自動 kill。
- [ ] 5.4 實作 `runtime.force_release` capability、reason、confirmation、`stale_lease | runtime_failed | cooperative_release_failed` eligibility與 audit；healthy live-session一律阻擋，並加入 unauthorized/stale-decision/live-session negative tests。
- [ ] 5.5 跑 kit-manager API、streaming runtime 與 coordinator integration tests；Kit/GPU unavailable 時誠實標 blocked，不以 mock 宣稱通過。

## 6. Callback與external control-plane邊界

- [ ] 6.1 保持既有`conversion_result_ready`只服務成功workflow completion、`conversion_failed`服務既有失敗workflow，且不新增Cloud Ingest fields；formal result locator/三組alignment summary只由獨立`lineage_result_published`傳送。
- [ ] 6.2 保持 callback metadata-only、durable retry/dead-letter 與 conversion success separation；external company cloud 仍擁有 tenant/project/model-version/RBAC/workflow authority。
- [ ] 6.3 更新 test fake 與 cross-service contract tests，actor chain 僅為 external IFC Worker → coordinator → streaming → callback outbox → external company cloud；不得啟動 `_worker`／`_bim-control` runtime。
- [ ] 6.4 保持既有`conversion_result_ready|conversion_failed` endpoint/auth/path語意不變；不得透過legacy`callback_url`重新導向Cloud Ingest，也不得把`source_bundle_ready`或`lineage_result_*`塞進舊callback。

## 7. Cloud lineage publication交付

- [ ] 7.1 新增server-side-only `CLOUD_LINEAGE_PUBLICATION_MODE=disabled|required`、base URL、HMAC key ID/secret設定；disabled不得enqueue或產生假dead-letter，production required缺設定／非HTTPS須startup fail closed，loopback HTTP只限explicit test profile。
- [ ] 7.2 實作dedicated atomic JSON outbox：stable event/publication identity/body digest、`DISABLED|PENDING|RETRYING|DELIVERED|DEAD_LETTER|CONFLICT`、restart recovery、corrupt-store quarantine與每edge site單一active dispatcher；shared queue/HA不在本階段。
- [ ] 7.3 在formal ResultManifest與四個refs完整驗證後，以不含`:`的`edge_site_id`／`external_model_version_id`／`result_id`逐byte建立並重新驗證canonical colon-joined`publication_identity`，再enqueue`lineage_result_published`；failed/cancelled contract-complete formal result也發布稽核locator/summary但維持non-selectable，diagnostic/temp/invalid result排除，source READY不發布。
- [ ] 7.4 實作`POST /api/v1/lineage-publications` HMAC raw-body client與strict 200/201 exact ACK；signature timestamp只接受canonical ASCII unsigned decimal Unix epoch seconds，exact header string參與簽章且receiver不得normalize；receiver transaction先建立／檢查全域immutable event ledger，同event/different raw body回409；published另以RFC 8785 JCS projection計算`publication_content_sha256`，只有identity／manifest／content digest全同才replay；另實作403/422 binding與retryable/non-retryable分類，202/empty/mismatched 2xx不得標DELIVERED。
- [ ] 7.5 實作預設5次exponential backoff＋jitter、transient dead-letter cooldown auto-reconcile、deterministic manual replay，以及`VERIFIED|MISSING|INTEGRITY_FAILED|TOMBSTONED` append-only health events；health `observed_at`只接受uppercase UTC `Z`、年份`1000–9999`、秒`00–59`與最多6位小數秒，receiver只可右補零、不得接受offset、leap second、MySQL範圍外年份或round/truncate；current health在無event時衍生為VERIFIED、其後依exact microsecond與deterministic append-order tie-break衍生，late older event只留history且不得update publication row；tombstone ID只允許且必填於TOMBSTONED；每次accepted delivery append receipt row，missing/integrity需兩次獨立確認，restore可回VERIFIED。
- [ ] 7.6 擴充test-only cloud fake與contract/integration tests，模擬201 commit、200 replay、bad HMAC、signature timestamp的leading-zero／sign／fraction／milliseconds／RFC3339／out-of-window拒絕、ambiguous／mismatched publication identity、同event ID異raw body 409、同identity／manifest異canonical content 409、403 tenant mismatch、422 missing parent、malformed ACK、lost ACK/restart、late older health event、equal-observed-at tie-break、offset／sub-microsecond／leap-second／out-of-range observed-at rejection、health restore/tombstone、non-tombstone tombstone ID rejection與每條metric/count公式（包含isolated `ifc_only_count`）的獨立矛盾；fake不得被寫成production runtime或真MySQL evidence。
- [ ] 7.7 將logical tables與`REFERENCE ONLY` DDL交付external `bim-control` owner對接；驗證health／receipt以`publication_identity + manifest_digest` composite FK綁定publication，所有digest columns採case-sensitive ASCII collation；本repo不得執行migration、持DB credentials、直接SQL或宣稱cloud MySQL已寫入。

## 8. docs/plans HTML權威與lineage console

- [x] 8.1 Contract-only階段只更新Git-tracked兩份`docs/plans/*.html`：architecture/API/data model與既有`#/pipeline` Outbox的Cloud Ingest方向＋純文字status；不新增route/page/button/component，不修改production frontend、manifest或goldens，並誠實標為`design_source_update_only`／尚未rebaseline。
- [ ] 8.2 `align-frontend-design-system-reference`與`migrate-console-to-hifi-design` closeout後，依其HTML-only machine metadata格式更新existing Pipeline screen state；從tracked HTML重建source/contract digest、semantic cases與兩個viewport Pipeline goldens，不另創metadata dialect。
- [ ] 8.3 另行在Git-tracked HTML補齊lineage Version Overview、Artifacts、Alignment、Attempts、Audit的UX/IA/visual/semantic states；未完成前五個broader lineage surfaces持續`reference_missing`，不得成為cloud publisher acceptance gate。
- [ ] 8.4 在不改HTML／不rebaseline的product lane，於production既有Outbox實作read-only文字狀態並另行實作五個lineage surfaces、loading/empty/success/warning/failure/retry、filters/details、downloads與capability-gated actions；瀏覽器只打coordinator。
- [ ] 8.5 跑Windows Chromium DPR1 1440×900＋1920×1080 pixel≤1%／semantic 100% changed-surface design gate與獨立functional fake-cloud flow；status只有exact ACK後可顯示「已登錄」，涉及Kit另留first-frame/stage/DataChannel evidence。

## 9. 整合、遷移與durable docs

- [ ] 9.1 用真實且gitignored的同版本RVT/schedule/IFC fixture跑source manifest → job/admission → attempt → result manifest → active result →既有callback＋fake Cloud Ingest的CPU pipeline E2E；大型RVT/IFC/USDC不得commit，fake結果不得宣稱真MySQL。
- [ ] 9.2 驗證local cache刪除後可由MinIO重建、formal availability不變；驗證manifest/checksum缺失才會non-available，cloud outage/dead-letter不撤銷edge READY/AVAILABLE。
- [ ] 9.3 驗證read-only compare不改active pointer、首次自動activation與promote/rollback皆有audit、retention不刪formal artifacts，以及缺失／過期／未授權decision與cloud identity/digest conflict均fail closed。
- [ ] 9.4 同步AGENTS/README/data-flow/ownership/runbook與API docs，特別標示`edge coordinator → external company-cloud bim-control → cloud MySQL`是cloud-only API用法；明列MinIO edge bytes authority、cloud僅存結果位置＋摘要、legacy migration與不復活retired services。
- [ ] 9.5 跑`npx openspec validate rvt-ifc-usdc-lineage --strict`、JSON Schema valid/invalid fixture validation與affected service tests；修改shared/exported symbol前先跑GitNexus impact，commit前跑`detect_changes({scope: "compare", base_ref: "main"})`，再跑PR local preflight；未具真Kit/WebRTC/design evidence時不得宣稱full-system completion。
- [ ] 9.6 完成報告明列contract-only邊界、external cloud repo/migration owner待接手、未使用真DB credentials、未連接／驗證cloud MySQL，並分開回報fake-cloud protocol evidence與真實external persistence缺口。
