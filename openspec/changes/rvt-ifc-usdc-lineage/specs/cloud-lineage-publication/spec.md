## ADDED Requirements

### Requirement: Cloud lineage publication SHALL 使用固定的external Cloud Ingest邊界

受治理的lineage publication SHALL 使用`POST /api/v1/lineage-publications`，方向固定為`edge bim-review-coordinator → external company-cloud bim-control → cloud MySQL`。Coordinator SHALL 作為client；external `bim-control` SHALL host production receiver，且 SHALL 是唯一的cloud MySQL writer。此endpoint MUST NOT 暴露為browser API、producer intake API或由本repo host的production cloud runtime；edge services MUST NOT 直接連接cloud MySQL或持有cloud database credentials。

此endpoint SHALL 只接受`lineage_result_published`與`lineage_result_health_changed`。既有`conversion_result_ready | conversion_failed` workflow callbacks與`POST /api/external/ifc-ready` SHALL 保持不變，且 SHALL NOT 成為第二個受治理lineage-publication authority。

#### Scenario: 正式結果使用external Cloud Ingest API

- **WHEN** coordinator發布受治理的lineage結果
- **THEN** 它 SHALL 將versioned event POST至external `bim-control`的`/api/v1/lineage-publications`
- **AND** 只有external cloud service SHALL commit對應的cloud MySQL transaction

#### Scenario: Source bundle READY不是cloud lineage event

- **WHEN** producer呼叫additive `POST /api/external/source-bundles/ready`，或coordinator reconcile source manifest
- **THEN** coordinator SHALL 針對edge processing重新驗證ready claim
- **AND** 在正式衍生結果通過integrity驗證前，MUST NOT 建立cloud lineage publication

### Requirement: 只有通過integrity驗證的正式結果 SHALL 觸發publication

Coordinator SHALL 只在正式ResultManifest與所有必要result references通過role、ETag、object-version、SHA-256與size驗證後，才建立`lineage_result_published`。當`attempt_outcome`為`succeeded | succeeded_with_warnings | failed | cancelled`時，契約完整的正式結果 MAY 為稽核而發布；publication MUST NOT 改變既有selection rule。`failed | cancelled`結果 SHALL 維持不可選取，且 MUST NOT 成為active、被promote、rollback，或透過`conversion_result_ready`回報。

未發布的暫時output、diagnostic-only logs/manifests與integrity-invalid result artifacts MUST NOT 產生cloud lineage event。

#### Scenario: 成功的正式結果符合資格

- **WHEN** `succeeded`或`succeeded_with_warnings` attempt具有通過integrity驗證的正式ResultManifest
- **THEN** coordinator SHALL 為at-least-once delivery enqueue恰好一個穩定的`lineage_result_published` identity

#### Scenario: 失敗attempt仍有完整正式結果

- **WHEN** `failed`或`cancelled` attempt仍發布契約完整且具備所有必要lineage references的ResultManifest
- **THEN** coordinator SHALL 為稽核發布其locator與summary
- **AND** MUST NOT 讓結果可被選取，或送出`conversion_result_ready`

#### Scenario: 排除只有診斷用途的結果

- **WHEN** attempt只留下暫時logs、partial objects或diagnostic-only manifest
- **THEN** coordinator MUST NOT 將`lineage_result_published`排入佇列

### Requirement: Publication payload SHALL 只包含stable locators與bounded summary

`lineage_result_published` SHALL 攜帶event、edge site、tenant、project、external model version、source bundle、pipeline job、attempt與result的穩定identity，以及`attempt_outcome`、`publication_identity`、`result_manifest_digest`、timestamps與correlation。`edge_site_id` SHALL 只接受與locator authority相同的ASCII `[A-Za-z0-9._-]+`；`external_model_version_id`與`result_id` MUST NOT 含literal `:`。`publication_identity` SHALL 逐byte等於`edge_site_id + ":" + external_model_version_id + ":" + result_id`，最大長度為522 characters。Sender與receiver SHALL 重新計算此canonical tuple encoding，且 MUST 在event identity、publication或receipt mutation前拒絕任何component／identity mismatch。

Payload SHALL 精確包含下列必要的正式references：

```text
result_manifest_ref
lineage_mapping_ref
alignment_report_json_ref
alignment_report_csv_ref
```

每個reference SHALL 包含`ref`、`object_version_id`、`etag`、`sha256`與`size_bytes`。`ref` SHALL 使用不過期且不含credential的形式`minio://{edge_site_id}/{bucket}/{object_key}?versionId={object_version_id}`；locator authority MUST 逐byte等於envelope的`edge_site_id`，object key MUST NOT 含原始`?`或`#`，且唯一query SHALL 是單一`?versionId=`值。Query version與`object_version_id` field MUST 相符，top-level `result_manifest_digest` MUST 等於`result_manifest_ref.sha256`。Cloud receiver MAY 儲存locator，而不必能從edge MinIO下載。

Payloads MUST NOT 包含RVT/IFC/USDC bytes、manifest/report bodies、element mapping rows、diff ID sets、diagnostics、presigned URLs、HTTP bearer URLs、local paths、credentials或base64。完整的`element_mapping.json`、alignment JSON/CSV與diff sets SHALL 留在edge MinIO。

#### Scenario: 有效的結果位置投影

- **WHEN** 四個references全都使用versioned `minio://` locators，並包含相符的integrity metadata
- **THEN** payload SHALL 可進行HMAC signing與delivery

#### Scenario: Publication identity或edge authority不具唯一canonical encoding

- **WHEN** `edge_site_id`含ASCII `[A-Za-z0-9._-]`以外的字元、其餘identity component含literal `:`，或`publication_identity`不等於三個component的canonical colon-join
- **THEN** schema／semantic validation SHALL 在event identity、publication或receipt mutation前拒絕request

#### Scenario: Payload嘗試傳送element rows或presigned URL

- **WHEN** payload包含element mapping array、diff identifier set或`X-Amz-*` presigned query
- **THEN** schema validation SHALL 在enqueue或receiver mutation前fail closed

#### Scenario: Locator指向另一個edge site

- **WHEN** 任一locator authority與top-level `edge_site_id`不同
- **THEN** sender與receiver的semantic validation SHALL 拒絕request
- **AND** publication或receipt SHALL 均不得commit

### Requirement: Alignment summary SHALL 使用精確的metrics與counts

Cloud summary SHALL 只包含：

- `ifc_usdc_coverage_ratio`：已對應至stable USD roots的eligible IFC products／eligible source `IfcProduct` count。
- `rvt_ifc_alignment_ratio`：已解析至IFC的valid scheduled rows／valid unique schedule elements。
- `rvt_ifc_usdc_lineage_ratio`：經IFC解析至stable USD roots的valid schedule rows／valid unique schedule elements。

每個metric SHALL 包含`numerator`、`denominator`、`ratio`與`status`。當denominator大於`0`時，ratio SHALL 以decimal arithmetic計算`numerator / denominator`並向零截斷至小數第10位，trailing zeros MAY 省略；numerator等於denominator時status SHALL 為`complete`，numerator小於denominator時 SHALL 為`partial`。當denominator為`0`時，numerator SHALL 為`0`、ratio SHALL 為`null`，且status SHALL 為`not_evaluable`。

唯一允許的count fields SHALL 是`csv_total_count`、`csv_valid_count`、`eligible_ifc_product_count`、`duplicate_rvt_id_count`、`duplicate_ifc_guid_count`、`invalid_row_count`、`csv_only_count`、`ifc_only_count`、`ifc_usdc_unmapped_count`與`full_lineage_matched_count`。`warning_codes` SHALL 唯一、最多限制為64個versioned codes，並附帶`warning_code_count`。任何count field MUST NOT 以element identifiers list取代。

Sender與receiver semantic validator SHALL 強制`ifc_usdc_coverage_ratio.denominator == eligible_ifc_product_count`、其numerator等於該count減`ifc_usdc_unmapped_count`；`rvt_ifc_alignment_ratio.denominator == csv_valid_count`、其numerator等於該count減`csv_only_count`；`ifc_only_count == eligible_ifc_product_count - rvt_ifc_alignment_ratio.numerator`；`csv_valid_count <= csv_total_count`，且`duplicate_rvt_id_count`、`duplicate_ifc_guid_count`與`invalid_row_count`各自 MUST NOT 大於`csv_total_count - csv_valid_count`（三類 MAY 重疊，不要求總和等式）；`rvt_ifc_usdc_lineage_ratio.denominator == csv_valid_count`、其numerator等於`full_lineage_matched_count`。令A為eligible IFC count、S為RVT→IFC numerator、U為IFC→USDC numerator、F為full-lineage count，則 SHALL 滿足`max(0, S + U - A) <= F <= min(S, U)`。任一cross-field矛盾 MUST 在enqueue或receiver mutation前fail closed。

#### Scenario: 分母為零時維持不可評估

- **WHEN** 任一metric denominator為零
- **THEN** 其numerator SHALL 為零、ratio SHALL 為null，且status SHALL 為`not_evaluable`
- **AND** cloud summary MUST NOT 宣稱0%或100%

#### Scenario: Metric與count矛盾

- **WHEN** 任一metric numerator／denominator與其固定count fields不一致
- **THEN** sender與receiver semantic validation SHALL 拒絕request
- **AND** publication、event identity或receipt SHALL 均不得commit

#### Scenario: Valid CSV rows超過total

- **WHEN** `csv_valid_count > csv_total_count`
- **THEN** sender與receiver semantic validation SHALL 拒絕request
- **AND** publication、event identity或receipt SHALL 均不得commit

#### Scenario: CSV diagnostic count超過non-valid row universe

- **WHEN** duplicate RVT ID、duplicate IFC GUID或invalid-row count任一大於`csv_total_count - csv_valid_count`
- **THEN** sender與receiver semantic validation SHALL 拒絕request
- **AND** validator MUST NOT 假設三類彼此互斥或要求其總和等於non-valid rows

#### Scenario: Full lineage落在集合交集可行範圍外

- **WHEN** `full_lineage_matched_count`小於`max(0, S + U - A)`或大於`min(S, U)`
- **THEN** sender與receiver semantic validation SHALL 拒絕request
- **AND** publication、event identity或receipt SHALL 均不得commit

#### Scenario: 完整diff sets留在edge

- **WHEN** alignment包含CSV-only、IFC-only或IFC-to-USDC-unmapped elements
- **THEN** cloud summary SHALL 只包含其非負counts與bounded warning codes
- **AND** 對應的element identifier sets SHALL 留在edge reports

### Requirement: Target、mode與HMAC SHALL 由server控制

Publisher SHALL 只接受下列server-side settings：

```text
CLOUD_LINEAGE_PUBLICATION_MODE=disabled|required
CLOUD_LINEAGE_PUBLICATION_BASE_URL
CLOUD_LINEAGE_PUBLICATION_HMAC_KEY_ID
CLOUD_LINEAGE_PUBLICATION_HMAC_SECRET
```

Producer、browser、manifest與event payload fields MUST NOT 覆寫target URL或key material。`disabled` SHALL 是local/development預設，且 SHALL 不產生enqueue、send或假dead-letter side effect。Production SHALL 明確使用`required`；URL、key ID或secret缺失／無效、mode未知，或production URL不是HTTPS時，SHALL 在startup fail closed。Explicit test profiles MAY 只對loopback fake使用HTTP。

每個request SHALL 攜帶`X-Lineage-Event-Id`、`X-Lineage-Signature-Timestamp`、`X-Lineage-Signature-Key-Id`與`X-Lineage-Webhook-Signature`。`X-Lineage-Signature-Timestamp` SHALL 是UTC Unix epoch seconds的canonical ASCII unsigned base-10字串，且 SHALL 符合`^(?:0|[1-9][0-9]*)$`；除單一`0`外不得有leading zero，也不得使用正負號、小數、milliseconds或RFC 3339。Signature SHALL 是`HMAC-SHA256(secret, exact_signature_timestamp_header + "\n" + raw_request_body)`的`sha256=<lowercase-hex>`。Receiver SHALL 先驗證timestamp格式與可解析範圍，再以epoch seconds套用預設±300秒window，並以constant-time comparison驗證raw bytes、要求header/body event IDs相符；unknown key、signature mismatch、body tamper、格式／範圍錯誤或超窗timestamp都 SHALL 在event identity或domain mutation前拒絕。Receiver MUST NOT normalize timestamp後再驗簽。

Secrets MUST NOT 出現在payload、logs、UI、committed examples或evidence；未來的`.env.example` changes SHALL 只包含空白key names。

#### Scenario: Publication已停用

- **WHEN** mode為`disabled`
- **THEN** coordinator SHALL 在沒有publisher credentials時啟動
- **AND** SHALL 回報`DISABLED`，且不建立outbox entry或dead letter

#### Scenario: Required mode設定錯誤

- **WHEN** mode為`required`，但URL/HMAC settings缺失，或production URL不是HTTPS
- **THEN** coordinator startup SHALL 在接受工作前fail closed

#### Scenario: 簽署後body被變更

- **WHEN** receiver發現raw body、event ID或timestamp不符合signature contract
- **THEN** receiver SHALL 拒絕request，且不異動receipt或publication

#### Scenario: Signature timestamp不是canonical epoch seconds

- **WHEN** `X-Lineage-Signature-Timestamp`含leading zero、sign、fraction，使用milliseconds／RFC 3339，無法解析，或落在允許window外
- **THEN** receiver SHALL 在event identity、receipt、health或publication mutation前拒絕request
- **AND** receiver MUST NOT normalize該header後重新計算signature

### Requirement: Receiver commit與ACK SHALL 同步且冪等

Delivery SHALL 採at-least-once，並依event type套用不同的idempotency。`lineage_result_published` SHALL 以publication identity加manifest digest作為logical key；首次commit SHALL 回傳`201`，相同identity、digest與immutable publication content則 SHALL 回傳`200`、`replay=true`與原registration identity。Sender transport retry MUST 重用穩定的event ID與raw body；相同identity/digest但immutable content改變，或相同event ID搭配另一個event type、publication identity或raw-body digest時，SHALL 回傳`409`且不進行mutation。

Receiver SHALL 在任何publication、health或receipt mutation前，於同一transaction建立／檢查以`event_id`為primary key的immutable event identity，保存first accepted `event_type + publication_identity + raw-body lowercase SHA-256` tuple。相同event ID搭配不同tuple field MUST 回傳`409`且整個transaction不異動；只有完整tuple相同才可繼續event-type-specific replay判定。Publication first-event row與每筆health row SHALL 以`event_id + event_type + publication_identity + raw_body_sha256` composite binding逐欄匹配該event tuple；每筆receipt亦 SHALL 使用相同四欄binding，並以`publication_identity + manifest_digest + registration_id`逐欄匹配原publication。Direct import或reconciliation不得繞過任一binding。

#### Scenario: Domain row嘗試繞過event ledger

- **WHEN** publication first-event row或health row缺少對應的immutable event tuple，或任一tuple field與ledger不符
- **THEN** receiver transaction與reference DDL composite FK SHALL 拒絕domain mutation
- **AND** direct import或reconciliation MUST NOT 產生可見publication或current health

對`lineage_result_published`，receiver SHALL 對`schema_version`、`event_type`、`edge_site_id`、`tenant_id`、`project_id`、`external_model_version_id`、`result_id`、`publication_identity`、`result_manifest_digest`與完整published `payload`組成的projection做RFC 8785 JCS並計算lowercase SHA-256，保存為`publication_content_sha256`；projection MUST 排除transport-specific `event_id`、`occurred_at`與`correlation_id`。相同identity／manifest digest只有在此digest相同時才是replay；不同時 SHALL 回傳`409`且不異動。

`lineage_result_health_changed` SHALL NOT 只使用publication identity/digest作為replay key。每個新的health transition SHALL 使用新event ID、append新health row，並回傳`201`；只有相同event ID加相同event type、publication identity與raw-body digest才 SHALL 回傳`200`與`replay=true`。相同health event ID搭配任一不同tuple field時 SHALL 回傳`409`且不進行mutation。兩種event type的success body SHALL 精確包含`registration_id`、`event_id`、`publication_identity`、`manifest_digest`、`stored_at`與`replay`。

Sender SHALL 只在status為`200`或`201`、body符合response schema，且回傳的event/publication/digest values與送出的event完全一致時，將狀態標記為`DELIVERED`。HTTP `202`、empty/malformed body、unexpected 2xx或mismatched ACK SHALL 視為protocol failure。

當published identity搭配另一個manifest digest、相同identity/digest但immutable publication content改變，或任一event ID被重用且搭配另一個event tuple field時，receiver SHALL 回傳`409`且不進行mutation。Authoritative parent model-version不存在時適用`422`；tenant/project/model-version binding不符時適用`403`。它 MUST NOT 從MinIO path建立cloud authority。Canonical error三元組 SHALL 精確為：400/`INVALID_REQUEST`/false、422/`UNSUPPORTED_SCHEMA`/false、401/`HMAC_AUTH_FAILED`/false、403/`TENANT_BINDING_MISMATCH`/false、422/`PARENT_BINDING_NOT_FOUND`/false、409/`PUBLICATION_DIGEST_CONFLICT`/false、429/`RATE_LIMITED`/true、503/`TRANSIENT_UNAVAILABLE`/true、500/`INTERNAL_ERROR`/true。Response schema MUST 拒絕code/boolean矛盾，sender MUST 將HTTP/code mismatch視為protocol failure。Network errors、timeouts、`408`、`429`與`5xx` SHALL 可retry；schema/auth/binding/conflict等deterministic `4xx` SHALL 要求manual correction/replay。

清理過的error response SHALL 只要求`error`；當request的`event_id`缺失、格式錯誤，或因解析／驗證失敗而尚不可採信時，MAY 省略`event_id`。Receiver MUST NOT 捏造ID；若有提供，`event_id` SHALL 是從已解析request context取得的有效UUID。Success ACK requirements保持不變。

#### Scenario: 首次commit與replay

- **WHEN** receiver commit新的有效publication
- **THEN** 它 SHALL 回傳`201`與`replay=false`
- **AND** 已發布且identity、digest、content皆相同的replay SHALL 回傳`200`、`replay=true`與相同registration identity

#### Scenario: 相同identity使用不同digest

- **WHEN** receiver已儲存相同publication identity，但其manifest digest不同
- **THEN** 它 SHALL 回傳`409`，且不改變publication、receipt或health history

#### Scenario: 新health transition共用publication digest

- **WHEN** 已知publication收到具相同publication identity與manifest digest的新health event ID
- **THEN** receiver SHALL append transition，並回傳`201`與`replay=false`
- **AND** MUST NOT 將其合併至較早的health event

#### Scenario: Health event ID搭配另一個body被重用

- **WHEN** health event ID已存在，但raw-body digest不同
- **THEN** receiver SHALL 回傳`409`，且不異動publication、health或receipt

#### Scenario: ACK不完整

- **WHEN** receiver回傳`202`、empty body，或event ID、publication identity、manifest digest不同的ACK
- **THEN** sender SHALL 將delivery視為protocol failure
- **AND** MUST NOT 將outbox item標記為`DELIVERED`

#### Scenario: Cloud parent binding不具權威性

- **WHEN** model-version parent無法解析，或tenant binding不符
- **THEN** receiver SHALL 分別回傳`422`或`403`
- **AND** MUST NOT 從object paths推斷或建立parent

#### Scenario: Error code與retryable矛盾

- **WHEN** deterministic code帶`retryable=true`，或transient code帶`retryable=false`
- **THEN** response schema validation SHALL 拒絕body
- **AND** sender MUST NOT 以該矛盾欄位啟動automatic retry或標記delivery成功

#### Scenario: HTTP status與error code矛盾

- **WHEN** error body code／retryable有效，但transport status不等於canonical三元組的HTTP status
- **THEN** sender SHALL 將response視為protocol failure
- **AND** body MUST NOT 覆寫transport分類或使outbox進入`DELIVERED`

### Requirement: Edge publication outbox SHALL 可持久化、可恢復，且不依賴availability

Coordinator SHALL 在send前，將穩定的event ID、publication identity、raw body與body digest持久化至atomic local outbox JSON。Restart SHALL 恢復相同event，而非建立另一個logical publication。同一edge site同一時間，至多一個coordinator dispatcher MAY 處於active；shared queue/HA dispatch不在此contract範圍內。損毀的outbox state SHALL fail safe並被隔離，絕不可靜默清除或覆寫。

Wire states SHALL 為`DISABLED | PENDING | RETRYING | DELIVERED | DEAD_LETTER | CONFLICT`。Default delivery SHALL 使用最多五次bounded attempts，並採exponential backoff與jitter。Transient dead letters SHALL 在cooldown後自動reconcile/re-enqueue；semantic/security/deterministic 4xx與conflicts SHALL 等待manual correction/replay，且 MUST NOT 被靜默丟棄。

Cloud delivery state SHALL 與source `READY`、result `AVAILABLE`、active-result selection與runtime admission正交。Cloud outage MUST NOT 阻擋edge conversion或撤銷正式edge availability。

#### Scenario: ACK遺失後restart

- **WHEN** cloud已commit，但edge在持久化ACK前restart
- **THEN** coordinator SHALL replay相同event ID/body/digest
- **AND** 完全一致的replay ACK SHALL 使item收斂至`DELIVERED`

#### Scenario: Transient delivery用盡五次attempts

- **WHEN** network/timeout/408/429/5xx在bounded attempts期間持續發生
- **THEN** item SHALL 進入`DEAD_LETTER`
- **AND** reconciler SHALL 在cooldown後重新enqueue，且不改變正式result identity

#### Scenario: Deterministic conflict需要介入

- **WHEN** receiver回傳identity/digest conflict或不可retry的security/semantic response
- **THEN** item SHALL 進入`CONFLICT`或manual `DEAD_LETTER`
- **AND** automatic retry MUST 停止，直到完成correction或authorized replay

#### Scenario: Result有效但cloud無法使用

- **WHEN** result為`AVAILABLE`，但無法連線Cloud Ingest
- **THEN** edge conversion/runtime與active-result semantics SHALL 繼續運作
- **AND** 只有publication delivery status SHALL 降級

### Requirement: Health events SHALL 保留immutable publication history

`lineage_result_health_changed` SHALL 只使用`VERIFIED | MISSING | INTEGRITY_FAILED | TOMBSTONED`。它 SHALL 攜帶已知的`publication_identity`，以及原始result ID、result-manifest reference與manifest digest，但 SHALL NOT 重複alignment summary。Receiver SHALL 以`publication_identity + manifest_digest` join `lineage_publications`，逐byte比對這些immutable bindings後才append health event；reference DDL SHALL 以相同composite key約束health與receipt rows，禁止同identity搭配另一digest。原始summary只留在publication row。Health events與accepted-delivery receipts SHALL 採append-only；health event MUST NOT 改寫原始publication。`observed_at` SHALL 使用uppercase `Z`的UTC date-time，年份 SHALL 為`1000–9999`、秒 SHALL 為`00–59`，小數秒可省略或為1–6位；receiver只可右補零至microsecond，offset、leap second、MySQL範圍外年份或超過6位精度 MUST 在event identity或domain mutation前拒絕，MUST NOT round／truncate。Current health SHALL 由該exact microsecond最大的accepted transition衍生；完全相同的observation time SHALL 以deterministic receiver-assigned append order tie-break，arrival order MUST NOT 超越不同的observation time。延遲送達的較舊transition SHALL 保留在history但 MUST NOT 覆寫較新current health；尚無health event時，通過integrity驗證的publication SHALL 衍生為`VERIFIED`。

`MISSING`與`INTEGRITY_FAILED` SHALL 要求edge reconciler至少兩次獨立觀察後才能送出。已復原且通過integrity驗證的object set MAY 回到`VERIFIED`。`TOMBSTONED` SHALL 要求正式retention/revocation record與非空`tombstone_record_id`，且 MUST NOT 從transient list miss推斷；`VERIFIED`、`MISSING`與`INTEGRITY_FAILED` MUST NOT 攜帶`tombstone_record_id`。

#### Scenario: 重複觀察到缺失

- **WHEN** reconciler在兩次獨立檢查中確認相同正式結果缺失
- **THEN** coordinator SHALL 送出append-only `MISSING` health event
- **AND** 原始locator、digest、summary與edge availability history SHALL 保持immutable

#### Scenario: 缺失的結果已復原

- **WHEN** 先前缺失的objects恢復，且所有integrity checks通過
- **THEN** coordinator SHALL 送出`VERIFIED`
- **AND** cloud history SHALL 保留兩次transitions

#### Scenario: 較舊health observation延遲送達

- **WHEN** 較新的`observed_at` transition已接受，之後才收到不同event ID的較舊transition
- **THEN** receiver SHALL 將較舊transition append至history
- **AND** current health SHALL 維持較新的observation；只有exact `observed_at`相同時才可由receiver append order tie-break

#### Scenario: Health observed_at不是canonical microsecond UTC

- **WHEN** health event的`observed_at`含timezone offset、leap second、MySQL範圍外年份或超過6位小數秒
- **THEN** schema／semantic validation SHALL 在event identity、health或receipt mutation前拒絕request

#### Scenario: 正式tombstone

- **WHEN** authorized retention/revocation record將result標記為tombstone
- **THEN** coordinator SHALL 送出`TOMBSTONED`
- **AND** transient object-list miss MUST NOT 產生該state

#### Scenario: 非tombstone health event攜帶tombstone record

- **WHEN** `VERIFIED`、`MISSING`或`INTEGRITY_FAILED` event含`tombstone_record_id`
- **THEN** schema validation SHALL 在event identity、health或receipt mutation前拒絕request

### Requirement: Cloud persistence SHALL 只包含normative logical metadata

External cloud logical model SHALL 包含`lineage_publications`、`lineage_publication_health_events`、`lineage_event_identities`與`lineage_event_receipts`。它 SHALL 保留publication identity／manifest／canonical content digest、全域event ID／first raw-body digest uniqueness、append-only health history、每次接受的首次delivery或replay所append的一筆receipt row，以及四個locators與bounded summary。Reference DDL SHALL 對publication宣告case-sensitive的`publication_identity + manifest_digest` health key與`publication_identity + manifest_digest + registration_id` receipt key；publication first-event row、每筆health row與receipt另 SHALL 各自以`event_id + event_type + publication_identity + raw_body_sha256` composite FK綁定immutable event ledger。所有event IDs與SHA-256 columns SHALL 使用case-sensitive ASCII collation，registration/publication identities SHALL 使用`utf8mb4_0900_bin`，使exact ACK與lowercase-hex constraints不依賴database default collation。Current health SHALL 依observation time衍生；immutable publication row不得包含mutable health field。Event identity rows與receipt rows MUST NOT 被更新為replay counters。它 MUST NOT 定義或要求per-element lineage tables。

本change SHALL 提供MySQL 8 `REFERENCE ONLY` DDL，作為不可執行的mapping輔助。DDL MUST 聲明最大2,952-byte ACK composite key的physical adoption prerequisite為16 KiB InnoDB page與`ROW_FORMAT=DYNAMIC`；external `bim-control` owner SHALL 在migration前驗證live settings、key limits與DDL，不相容環境 MUST fail preflight或採等價且collision-safe、不截斷normative logical identity的physical key。External `bim-control`仍擁有physical migrations與credentials，本repo MUST NOT 宣稱DDL已套用或真實MySQL已驗證。Test fake MAY 模擬transaction/idempotency行為，但 SHALL 維持test-only。

#### Scenario: 審查contract-only交付

- **WHEN** 本change已驗證並merge
- **THEN** reviewers SHALL 能找到normative logical model、reference DDL與protocol fixtures
- **AND** MUST NOT 推斷已發生external migration、database connection或live MySQL E2E

#### Scenario: 提議新增element-row table

- **WHEN** implementation嘗試新增cloud storage以保存per-element RVT↔IFC↔USDC mapping rows
- **THEN** 它 SHALL 違反此capability
- **AND** 完整rows SHALL 留在edge MinIO artifacts

### Requirement: 既有Outbox SHALL 顯示純文字cloud publication status

Git-tracked `docs/plans/*.html` authority SHALL 只擴充既有`#/pipeline` Callback Outbox surface，增加read-only文字status欄。它 SHALL 對應`DISABLED → 未啟用`、`PENDING → 待送`、`RETRYING → 重試中`、`DELIVERED → 已登錄`、`DEAD_LETTER → 待人工處理`與`CONFLICT → 衝突`，並 SHALL 將方向標示為`edge coordinator → external bim-control Cloud Ingest API → cloud MySQL`。

在contract-only階段，此capability MUST NOT 新增route、page、button、new visual component或production frontend implementation。Text SHALL NOT 暴露secrets、target URL、full payload或artifact bodies；在確認cloud commit ACK完全一致前，local deliver action MUST NOT 顯示`已登錄`。

#### Scenario: 停用local mode

- **WHEN** publication mode已停用
- **THEN** 既有Outbox status text SHALL 顯示`未啟用`
- **AND** cloud delivery action SHALL 不得被暗示

#### Scenario: Delivery已確認

- **WHEN** outbox item收到通過schema驗證且完全一致的`200`或`201` ACK
- **THEN** 文字status MAY 顯示`已登錄`
- **AND** 只按下local deliver action MUST NOT 產生該state

#### Scenario: Contract-only UI範圍

- **WHEN** 本spec更新Git-tracked HTML authority
- **THEN** 它 SHALL 只修改既有Outbox text/state contract
- **AND** production UI、manifest/goldens與其他lineage screens SHALL 保留為依序執行的獨立工作
