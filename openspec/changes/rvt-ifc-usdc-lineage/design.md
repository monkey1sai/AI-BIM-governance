## 背景

現行 B 方案已具備外部 IFC Worker → `bim-review-coordinator` → `bim-streaming-server` → metadata-only callback outbox 的最小閉環，也已在 streaming capability 中定義 stable element root `/World/Elements/<IfcClass>/G_<encoded_guid>`。缺口位於 IFC-ready 前後：source RVT、`schedule.csv`、IFC、USDC、mapping 與多次 conversion result 沒有共同的 version bundle、identity chain、publication transaction 與 active-result governance。

2026-07-14～07-15 的決策要求 MinIO 成為 edge artifact bytes 的唯一持久 authority，但不能奪走外部 company cloud 對 tenant、project/model-version、RBAC 與 enterprise workflow 的 authority。本階段採 contract-only：交付 domain contract、versioned schema/examples、reference-only MySQL DDL 與既有 Outbox 的 tracked HTML 文字契約；production publisher、external cloud/MySQL implementation、production frontend、lineage screens、goldens/rebaseline 與 live E2E 由 tasks 分階段完成。

## 目標／非目標

**目標：**

- 讓每個 governed model version 都能從 source manifest 證明 RVT、schedule 與 IFC 屬於同一 immutable bundle。
- 以可逆 identity chain 串接 version-scoped RVT ID、UUID36、IFC GlobalId22 與既有 stable USD element root。
- 讓 job、attempt、result publication、active result、promotion/rollback 與 retention 可恢復且可稽核。
- 將 conversion runtime admission 與 Kit release 定義為 topology-independent observable contract。
- 讓 lineage UI、下載與高風險操作受 capability 控制，且 design authority 只來自 Git-tracked `docs/plans/*.html`。
- 以獨立、authenticated Cloud Ingest API 將 formal lineage result 的 stable MinIO 位置與輕量摘要送到 external company-cloud `bim-control`，由 cloud service 寫入自己的 MySQL。
- 保持 edge `READY`／`AVAILABLE` 與 cloud delivery 狀態正交，讓 cloud outage 不阻斷 edge conversion/runtime。

**非目標：**

- 不實作 Revit exporter，也不把已退役 `_worker`／`_bim-control` 加回 runtime。
- 不讓 MinIO manifest 取代外部 cloud 的 project/model-version 或 RBAC authority。
- 不固定 queue vendor、database、MinIO prefix 深度、API port 或 deployment topology。
- 不把 local cache、callback delivery、Kit stage-open 或 viewer first-frame 混成 artifact availability。
- 不讓 edge 直接連 cloud MySQL、不在本 repo 保存 cloud DB credentials、不把逐 element mapping/diff rows mirror 到 cloud。
- 不改變既有 `conversion_result_ready|conversion_failed` workflow callback，不把 Cloud Ingest API 當成 browser API或 producer intake API。
- 不在本 spec PR 產生 production code、新 page/route/visual design、golden、cloud migration或 runtime/live-MySQL E2E pass claim；只允許 reference contract artifacts 與既有 Outbox 的 source-only文字狀態。

## 決策

### 1. 按資料類型拆分持久化權責

| 持久資料 | 權威 |
|---|---|
| Tenant、project/model-version、RBAC、企業workflow | external company cloud `bim-control` |
| RVT/CSV/IFC 與正式 derived artifact bytes | customer-edge MinIO |
| Source/result manifest 與 edge bundle lineage | MinIO manifest；coordinator 只保存 minimal shadow/index |
| 穩定logical pipeline job、可持久化orchestration/admission state、active-result pointer、promotion/rollback audit、workflow callback outbox、lineage-publication outbox | `bim-review-coordinator` |
| Immutable attempt、conversion execution、result content 與 result-manifest publication | `bim-streaming-server` conversion authority |
| Formal result locator、bounded lineage summary、event receipt 與 health history | external company-cloud `bim-control` / cloud MySQL |
| Runtime lease/readiness/stage state | streaming/Kit runtime；coordinator/Kit Manager 只持 observable coordination state |
| Browser UI狀態 | `web-viewer-sample` |

本機 `storage/`、shared volume、`ifc-cache` 與 conversion artifact directory 都是 staging/cache。刪除 local cache 不得刪除 MinIO formal availability；反之，local file 存在也不能證明 formal result 已發布。

### 2. Source bundle 採 manifest-first metadata、publish-last signal

Formal source bundle 的邏輯內容：

```text
<version-prefix>/
  model.rvt
  schedule.csv
  model.ifc
  manifest.json        # 最後寫入
```

`manifest.json` 至少保存 `source_bundle_id`、`external_model_version_id`、display metadata、producer、每個 artifact 的 role/ref/etag/SHA-256/bytes，以及 schema/version timestamps。Object path 只是 locator；bundle identity 與 lineage 由 manifest 決定。

Producer 必須先完成三個 artifact，再 conditional-create manifest。Coordinator 只有在 manifest 可讀、required roles 齊全且 refs/checksums 驗證成功後，才產生 `READY` signal。無 manifest 的舊資料是 `LEGACY_UNMANAGED`；preview 不寫資料，confirm 才建立新 governed version，不在原 bundle 靜默補檔。

Producer 在 manifest publish 後 SHALL 呼叫 additive `POST /api/external/source-bundles/ready`；這只是 ready claim，coordinator仍須自行重驗 manifest/integrity。Polling只作 restart recovery／reconciliation。既有 `POST /api/external/ifc-ready` 保持不變，legacy object observation 不得冒充 governed READY。Source bundle READY 本身不建立 cloud lineage publication；只有 formal result成立後才進入 Cloud Ingest flow。

### 3. Identity chain 保留原始字串並沿用 stable prim contract

```text
schedule.csv.ID
  ↔ schedule.csv.IfcGUID (UUID36)
  ↔ IFC GlobalId22
  ↔ /World/Elements/<IfcClass>/G_<encoded_guid>
```

- `schedule.csv.ID` 以字串保存，僅在 source version 內唯一，不宣稱跨版本 stable。
- Source `IfcGUID` 原字串必須保留；parser 接受合法 UUID36且大小寫不影響 identity，另輸出 derived canonical `ifc_uuid36`。它與 IFC GlobalId22 必須是同一 128-bit identity 的可逆編碼。
- `element_mapping.json` additive 使用 `rvt_element_id`、`ifc_uuid36`、既有 `ifc_guid`、`usd_prim_path`、`mapping_status`、`diagnostics[]`。
- `usd_prim_path` 必須指向既有 stable element root；tessellation child mesh 不得成為 lineage target。

### 4. 三種 coverage/accuracy 不共用含糊分母

| 指標 | 分子 | 分母 |
|---|---|---|
| `ifc_usdc_coverage_ratio` | eligible IFC products mapped to stable USD roots | eligible source `IfcProduct` count（legacy `source_ifc_entity_count` 若保留，必須是此集合的明確 alias） |
| `rvt_ifc_alignment_ratio` | 已解析至IFC products的valid scheduled rows | valid unique `schedule.csv` scheduled elements |
| `rvt_ifc_usdc_lineage_ratio` | 經IFC解析至stable USD roots的valid scheduled rows | valid unique `schedule.csv` scheduled elements |

報告同時列出 CSV total/valid、duplicate ID/GUID、invalid row、CSV-only、IFC-only、IFC→USDC unmapped 與 full-lineage matched。任何 denominator 為 0 時 ratio 必須為 `null`、status 為 `not_evaluable`，不得回報 0% 或 100%。部分 alignment 可產生 `succeeded_with_warnings`，但 lineage UI與獨立 Cloud Ingest summary必須揭露 numerator、denominator、status與 diff counts；既有workflow callback保持不變，且不得以單一 `coverage_ratio` 代表三向 lineage。

### 5. Job、attempt 與 publication 分離

```text
SourceBundle 1 ── 1 PipelineJob
PipelineJob  1 ── N Attempt
Attempt      1 ── 0..1 ResultManifest
PipelineJob  1 ── 0..1 ActiveResultPointer
```

- `pipeline_job_id` 由 coordinator 建立並綁 immutable `source_bundle_id`，跨 retry 與 streaming restart 不變；streaming authority 只建立該 job 下的 `attempt_id`。
- runtime admission 成功後才配置 immutable `attempt_id`；`WAITING_CAPACITY` 不消耗 attempt。
- transient MinIO/network/dispatch failure 可 backoff；publishing 中斷在同一 attempt 冪等續傳。Semantic-invalid source 讓原 job停在 terminal `manual_correction_required`；修正必須建立新的 `source_bundle_id` 與 `pipeline_job_id`，不得覆寫 READY bundle後從原 job retry。
- 每個 attempt 使用獨立 result prefix，先寫 `model.usdc`、mapping/index/alignment/quality sidecars，最後 conditional-create `result-manifest.json`。
- 只有 manifest 及其 referenced refs/checksums 驗證成功，result 才是 `AVAILABLE`。相同 attempt＋相同 manifest digest replay冪等成功；相同 attempt＋不同 digest 必須 conflict，不得覆寫。
- Attempt outcome（`succeeded | succeeded_with_warnings | failed | cancelled`）、publication state（`UNPUBLISHED | PUBLISHING | AVAILABLE | INVALID`）與 formal-result selection state（`candidate | active | historical`）是三個正交軸。Attempt沒有 formal result時不存在 `selection_state`；failed/cancelled的audit-only formal result即使為`AVAILABLE`也沒有selection state；`AVAILABLE` 不等於 active。Failed/cancelled attempt 若仍建立符合完整 ResultManifest contract、且 required lineage refs/integrity 全部有效的 formal result，可為稽核用途發布 Cloud Ingest locator/summary；diagnostic-only／temporary manifest 不可發布。
- Result可被select/compare/promote/rollback的條件固定為 `publication_state == AVAILABLE` 且 `attempt_outcome in {succeeded, succeeded_with_warnings}`。Failed/cancelled attempt即使留下完整診斷manifest也不得成為active。第一個selectable result可自動成為active，但同樣必須建立append-only activation audit；後續result只能經capability-gated promote。Read-only compare不得改變pointer；rollback建立新audit且不刪除歷史result。

### 6. Runtime admission是可觀測契約，而非queue實作

Admission record 至少包含：

```text
required_runtime_capabilities[]
admission_status
runtime_profile
requires_exclusive_runtime
lease_id                 # CPU/non-exclusive profile 可為 null
readiness_evidence[]
blocker_codes[]
observed_at
```

manual、automatic 與 retry 都走同一 admission。每個 profile都需要 readiness evidence；只有 `requires_exclusive_runtime=true` 的 Kit-backed profile必須取得有效 lease，CPU/non-Kit profile的 `lease_id` 為 null且不得建立假 lease。有 healthy live viewer/session 的 Kit不得被 force release；預設流程是 cooperative drain → close/release。Force release 的 eligible reason為 `stale_lease`、`runtime_failed` 或 `cooperative_release_failed` 任一，且仍需具 `runtime.force_release` 的 operator提供 reason、confirmation與 audit。

### 7. Lineage console只送出意圖，不成為資料權威

UI 提供 Version Overview、Artifacts、Alignment、Attempts、Audit、KPI、diff filters、mapping details、CSV/JSON report 與 individual artifact download。大型 artifact 以短效 presigned URL 支援 Range/resume，不即時組裝 ZIP。

External cloud 仍決定 capabilities；`bim-review-coordinator` 的 browser/action API只驗證 external control-plane authorization decision並執行對應意圖。`governance-service`維持A1/A2/A3 loopback domain authority，不成為lineage RBAC、active-result或Cloud Ingest authority。至少使用：

```text
bundle.read
bundle.publish
artifact.download
alignment.read
conversion.trigger
conversion.prioritize
conversion.cancel
conversion.retry
runtime.release
runtime.force_release
result.promote
result.rollback
result.compare
```

### 8. 所有 design gate 以 repo-tracked HTML 為唯一標準

Design authority set 是每一份 Git-tracked `docs/plans/*.html`；目前為：

```text
docs/plans/AI-BIM 前後端設計文件.dc.html
docs/plans/AI-BIM Console Hi-Fi.dc.html
```

`design-system-reference.manifest.json`、goldens、screens、route inventory 與 semantic cases 只能是由這些 HTML 可重現的 derived evidence。外部 absolute path、capture script hard-code 或 production CSS 都不能成為平行 authority。Lineage surface 在 HTML 增加 approved screen/state 前一律 `reference_missing`，不得宣稱 full design completion。

### 9. Active predecessor以change boundary獨立擁有，採順序整合

目前 active MinIO watcher/intake changes、`align-frontend-design-system-reference` 與 `migrate-console-to-hifi-design` 已擁有其 capability、HTML machine contract、token migration或baseline工作。本 lineage change只建立六個新 capabilities，不宣告predecessor-owned canonical MODIFIED deltas。本PR另含`align-frontend-design-system-reference`本身的contract repair，涵蓋`agent-operability-governance`、`demo-fast-mvp-orchestration`、`documentation-source-of-truth`與`unified-governance-console`；這四組delta只由`align` change擁有、獨立strict validate並隨`align` archive，同一PR不代表lineage change接管ownership。Lineage rebase MUST NOT 重建`align`目錄或重複宣告這四組delta。

此spec可對tracked HTML做 `design_source_update_only` 的既有Outbox文字契約，但不得同PR修改production frontend、manifest/goldens或宣稱design pass。Apply gate固定為：先 closeout `align`並確認上述四組canonical specs已落地，再讓 `migrate` rebase並以 `docs/plans/*.html` 唯一權威撤銷／調和 repo 外 origin與 `VerifyOrigin` 假設，接著 closeout `migrate`，最後才讓 lineage rebase最新main。之後再為 `minio-watch-auto-intake`、`local-coordinator-ifc-ready-intake-boundary`、`streaming-ifc-usdc-conversion-authority`、`conversion-kit-lifecycle-recovery` 與 `local-artifact-shadow-metadata` 補必要MODIFIED deltas；`external-cloud-callback-lifecycle`保持不變，新lineage publisher由獨立capability擁有。

現行 `/model.ifc` watcher在過渡期仍可作 legacy intake，但不得標成 governed `READY`。現行 generic `coverage_ratio` 保留 IFC→USDC 意義，不得重命名成 RVT lineage。

### 10. Cloud lineage publication是獨立的edge-to-cloud契約

> **Cloud API 專用方向（不得誤接）：`edge bim-review-coordinator → external company-cloud bim-control → cloud MySQL`。**
> `POST /api/v1/lineage-publications` 是本 repo 對外部公司雲端的 outbound Cloud Ingest API contract；不是 browser API、不是 external producer intake、不是既有 workflow callback，且 production receiver不由本 repo host。

既有 `conversion_result_ready | conversion_failed` callback保持原路徑與語意。新 endpoint只接受：

```text
lineage_result_published
lineage_result_health_changed
```

`source_bundle_ready` 不送 cloud。只有 coordinator驗證 formal ResultManifest 與四個 required refs完整後才建立 `lineage_result_published`。只要是 contract-complete formal result，`failed|cancelled` attempt也可發布稽核 locator/summary；它仍不得 active/promote/rollback/selectable，也不得觸發 `conversion_result_ready`。Unpublished temp output、diagnostic-only manifest與 integrity-invalid result一律排除。

#### 10.1 Cloud payload只保存結果位置與輕量摘要

Publication identity由 `edge_site_id + ":" + external_model_version_id + ":" + result_id` 穩定決定；三個component均不得含literal `:`，sender與receiver必須逐byte重新計算，任何component或identity不符合此canonical encoding都在event ledger／domain mutation前fail closed。最大長度為522 characters，reference DDL對logical key與三個component使用MySQL 8 NO PAD binary collation。Payload至少包含 tenant/project/model-version、source bundle、pipeline job、attempt/result、attempt outcome、event/correlation/time、manifest digest，以及下列四個 formal locator：

```text
result_manifest_ref
lineage_mapping_ref
alignment_report_json_ref
alignment_report_csv_ref
```

每個 locator必須包含：

```text
ref = minio://{edge_site_id}/{bucket}/{object_key}?versionId={object_version_id}
object_version_id
etag
sha256
size_bytes
```

`ref` 必須 stable、non-expiring、credential-free；authority必須逐字等於envelope `edge_site_id`，object key不得含raw `?`／`#`，且唯一query只能是 `?versionId=`。不得是 presigned URL、HTTP bearer URL、local path或只靠 mutable object key。Cloud只保存 locator並可完全不具下載 edge MinIO的網路／credential權限。

輕量摘要只包含 section 4 的三組 metric（各自的 `numerator`、`denominator`、`ratio`、`status`）、固定 count欄與最多64個 bounded warning codes。Denominator非0時，ratio以decimal arithmetic計算後向零截斷至小數第10位；numerator等於denominator時status為 `complete`，小於denominator時為 `partial`。Denominator為0時numerator必須為0、ratio為 `null`、status為 `not_evaluable`。固定 counts為：

```text
csv_total_count
csv_valid_count
eligible_ifc_product_count
duplicate_rvt_id_count
duplicate_ifc_guid_count
invalid_row_count
csv_only_count
ifc_only_count
ifc_usdc_unmapped_count
full_lineage_matched_count
```

Semantic validator必須把metric與counts綁成同一份summary truth：IFC→USDC denominator等於`eligible_ifc_product_count`、numerator等於該count減`ifc_usdc_unmapped_count`；RVT→IFC denominator等於`csv_valid_count`、numerator等於該count減`csv_only_count`；三向lineage denominator等於`csv_valid_count`、numerator等於`full_lineage_matched_count`，且full-lineage count不得大於RVT→IFC numerator。任一矛盾在enqueue與cloud mutation前fail closed。

Cloud payload MUST NOT 包含 RVT/IFC/USDC bytes、manifest body、逐 element mapping rows、CSV/JSON report body、diff ID sets、diagnostics、presigned query、credentials或base64。完整 `element_mapping.json`、alignment JSON/CSV與差異集合只存在edge MinIO。

#### 10.2 Target與HMAC只能由server-side config決定

Lineage publisher只讀下列server-side設定；producer/browser/manifest/event payload不得覆寫URL或key：

```text
CLOUD_LINEAGE_PUBLICATION_MODE=disabled|required
CLOUD_LINEAGE_PUBLICATION_BASE_URL
CLOUD_LINEAGE_PUBLICATION_HMAC_KEY_ID
CLOUD_LINEAGE_PUBLICATION_HMAC_SECRET
```

`disabled` 是dev/local預設：不enqueue、不send、不產生假dead-letter，UI顯示「未啟用」。Production必須明確設 `required`；missing URL/key ID/secret、unsupported mode或non-HTTPS target均 startup fail closed。只有explicit test profile的loopback fake可使用HTTP。

Request headers固定為：

```text
X-Lineage-Event-Id
X-Lineage-Signature-Timestamp
X-Lineage-Signature-Key-Id
X-Lineage-Webhook-Signature
```

Signature值為 `sha256=<lowercase-hex>`，計算式固定為：

```text
HMAC-SHA256(secret, signature_timestamp + "\n" + raw_request_body)
```

Cloud receiver MUST 以raw bytes驗簽、constant-time compare、要求header/body `event_id`一致，並預設拒絕超出±300秒skew、unknown key、tampered body或signature mismatch。Retry可換timestamp/signature，但 `event_id`、raw body與digest不得改變。Secret不得出現在payload、log、UI、test evidence或committed example；`.env.example`未來只列blank key names。

#### 10.3 Receiver commit ACK與idempotency是同步contract

Sender採at-least-once delivery，冪等規則依event type分開：

- `lineage_result_published` 的logical key是 `publication_identity + manifest_digest`。首次transaction commit回 `201`；相同identity、digest與immutable publication內容回 `200`、`replay=true`及原registration。Sender的transport retry必須重用stable `event_id`與raw body；相同identity/digest但immutable內容不同，或同event ID而raw-body digest不同，回 `409`且不得mutation。
- `lineage_result_health_changed` 的每次新transition必須使用新 `event_id`並回 `201`，即使publication identity與manifest digest相同也不得視為replay。只有同event ID且同raw-body digest才回 `200`、`replay=true`；同event ID但raw-body digest不同回 `409`。
- authoritative parent不存在回 `422`；tenant/project/model-version binding mismatch回 `403`；不得由MinIO path自動建立cloud authority。

成功ACK body必須精確包含：

```text
registration_id
event_id
publication_identity
manifest_digest
stored_at
replay
```

Edge只有在status為200/201、JSON schema有效且ACK event/identity/digest逐字匹配時才能標 `DELIVERED`。`202`、空body、malformed/mismatched 2xx皆是protocol failure。Network/timeout/408/429/5xx可retry；auth、schema、binding與digest conflict等 deterministic 4xx需要人工修正後manual replay，不得silent drop。

#### 10.4 Outbox/reconciliation不阻擋edge availability

Lineage publication outbox wire states固定為：

```text
DISABLED | PENDING | RETRYING | DELIVERED | DEAD_LETTER | CONFLICT
```

Coordinator必須先以atomic local outbox JSON保存stable event/body digest再send，restart後延續同一event ID。單一edge site同時只允許一個active coordinator dispatcher；shared queue/HA dispatcher不在本階段範圍。Corrupt store必須fail safe/quarantine，不得清空後覆寫。

預設最多5次bounded delivery attempts，使用exponential backoff＋jitter。Transient dead-letter在cooldown後由reconciler自動重新enqueue；semantic/security/deterministic 4xx與conflict只能人工修正／replay。Cloud outage或dead-letter只改publication delivery state，不得撤銷edge `READY`、`AVAILABLE`、active pointer或runtime admission。

既有 Outbox UI只增加read-only文字欄，對應：

| Wire state | 顯示文字 |
|---|---|
| `DISABLED` | 未啟用 |
| `PENDING` | 待送 |
| `RETRYING` | 重試中 |
| `DELIVERED` | 已登錄 |
| `DEAD_LETTER` | 待人工處理 |
| `CONFLICT` | 衝突 |

它不得新增page/route/button/visual system，也不得把「已按送出」冒充「cloud transaction已commit」。

#### 10.5 Health event只投影formal result位置健康度

`lineage_result_health_changed` 固定使用 `VERIFIED | MISSING | INTEGRITY_FAILED | TOMBSTONED`。每筆event攜帶既有 `publication_identity`、original result ID/ref/digest，但不重送summary；receiver必須以publication identity join既有 `lineage_publications`，逐字驗證result ID/ref/digest後才append health event。原始summary只保存在immutable publication row，health event絕不改寫它。`observed_at`必須是UTC uppercase `Z`、年份`1000–9999`、秒`00–59`且最多6位小數秒；receiver只可右補零，不得接受offset、leap second、MySQL範圍外年份或round/truncate超微秒值。Current health依此exact microsecond最新值衍生；完全相同時間才以receiver-assigned append order決定。Dead-letter/retry造成的較舊event可保留在history，但不得覆寫較新的observation。

`MISSING` 與 `INTEGRITY_FAILED` 必須由edge reconciler至少兩次獨立觀察確認後才送；artifact恢復並驗證成功可回到 `VERIFIED`。`TOMBSTONED` 只能由正式retention/revocation record觸發且必須攜帶`tombstone_record_id`；`VERIFIED`、`MISSING`與`INTEGRITY_FAILED`不得攜帶該欄位。Health change不刪cloud history，也不改 formal edge availability。

#### 10.6 Cloud persistence只定義logical model

External `bim-control` 是唯一cloud MySQL writer，且應在receiver transaction內維護：

```text
lineage_publications
lineage_publication_health_events
lineage_event_identities
lineage_event_receipts
```

`lineage_publications`只保存identities、四個result locators、manifest digest、receiver計算的canonical `publication_content_sha256`與bounded summary；`lineage_event_identities`以全域`event_id`保存first accepted raw-body digest，阻擋同ID異body。Current health在尚無event時衍生為`VERIFIED`，其後依observation time衍生，不在immutable publication row保存mutable projection。Health events與receipts均append-only。Schema MUST NOT 定義逐 element lineage table。本 change附MySQL 8 `REFERENCE ONLY` DDL，僅表達logical constraints；不提供migration、DB connection、credentials或「已執行／已驗證真MySQL」宣稱。Test fake只模擬protocol transaction/idempotency，不是production cloud runtime。

## 資料與控制流程

```text
[外部customer-edge IFC Worker]
  -> 將model.rvt／schedule.csv／model.ifc上傳至MinIO
  -> 最後發布source manifest
  -> coordinator驗證governed READY並建立stable pipeline job
  -> runtime admission / lease
  -> streaming-server建立immutable attempt並執行轉換
  -> 上傳USDC、sidecars與reports
  -> 最後發布result manifest
  -> coordinator驗證AVAILABLE並管理active pointer／audit
  -> 既有workflow callback outbox
  -> [外部company cloud workflow]
  -> 獨立HMAC lineage-publication outbox
  -> POST /api/v1/lineage-publications
  -> [外部company-cloud bim-control]
  -> cloud MySQL只儲存result locators與bounded summary

瀏覽器
  -> coordinator-only APIs
  -> lineage views／authorized intents／presigned downloads
```

## 風險／取捨

- **[既有watcher使用`/model.ifc`作為trigger]** → predecessor archive前明確維持legacy；之後再加入manifest-ready整合，且不得形成雙重權威。
- **[現行queue可能在restart時遺失pending work]** → pipeline job/attempt契約要求durable logical identity；apply tasks在production cutover前加入recovery tests。
- **[現行callback使用legacy workflow refs]** → callback契約保持不變；governed MinIO result locators與三組metrics摘要只能走專用Cloud Ingest channel，不形成雙重權威。
- **[既有goldens來自外部來源]** → design-gate apply必須由`docs/plans/*.html`重建derived evidence；完成前gate是migration-incomplete，不是passed。
- **[HTML尚未包含lineage screens]** → console capability維持`reference_missing`；domain/API可誠實實作，但不得宣稱完整UI。
- **[Cloud ACK被任意2xx誤判]** → dedicated publisher只接受schema-valid 200/201 exact ACK；202、empty/mismatched ACK視為protocol failure。
- **[At-least-once可能重複或lost-ACK]** → persist stable event/body digest before send；published依identity/digest/content冪等，health transition依event/body digest冪等，conflict fail closed，reconciler重放同event。
- **[Edge直接連MySQL會破壞雲地邊界]** → target只能是external Cloud Ingest API；本repo不得持DB credentials或執行DDL/migration。
- **[同時修改HTML與production/baseline形成moving target]** → 本spec只做source-only文字契約且標migration-incomplete；等`align`／`migrate` closeout後另走rebaseline/product lane。
- **[大型IFC/USDC上傳與hash檢查耗費I/O]** → 以streaming方式計算checksums、使用object metadata／conditional writes，且不得把大型body載入callback或browser control APIs。
- **[Force release可能中斷使用者]** → 必須具備capability、reason、confirmation、session/lease evidence與append-only audit。

## 遷移計畫

1. Merge/archive active MinIO predecessors；先以`npx --no-install openspec validate align-frontend-design-system-reference --strict`驗證並archive `align`，確認其四組delta已落入canonical specs；再完成`migrate-console-to-hifi-design` rebase/reconcile至 `docs/plans/*.html` 唯一權威（移除repo外origin／`VerifyOrigin`平行authority）→ `migrate` closeout → lineage rebase最新main。Lineage rebase不得重建`align`目錄或重複宣告其delta。
2. 將reference schemas/examples提升為source manifest、result manifest、alignment report、pipeline job/attempt及Cloud Ingest request/ACK/error的executable contract fixtures；既有workflow callback保持不變。
3. 在legacy watcher旁新增additive `POST /api/external/source-bundles/ready`，驗證MinIO refs/checksums並建立durable stable jobs；polling只作reconciliation。
4. 新增streaming mapping enrichment、attempt-scoped result prefixes與result-manifest publication。
5. 新增active pointer、promotion/rollback audit、cache reconstruction，以及專用lineage publication outbox/HMAC/strict ACK/retry/reconcile/health producer；更新test-only cloud fake，但不得宣稱真MySQL。
6. 新增runtime admission/release enforcement與negative tests。
7. 先以source-only方式更新兩份`docs/plans/*.html`既有architecture/API/Outbox文字；lineage五個新screens仍維持`reference_missing`。Predecessor closeout後才由tracked HTML重建manifest/goldens。
8. 在不再修改HTML的product lane實作既有Outbox文字狀態與broader lineage console，補browser/runtime/design evidence；只有migration evidence全綠後才能移除legacy intake。

Rollback時保留immutable source/result objects與audit records。Deployment可停用governed auto-enqueue並退回legacy intake visibility，但 MUST NOT 把legacy data重新標為governed READY，也不得刪除formal objects。

## 待決問題

- MinIO physical prefix命名可沿用external platform既有hierarchy；契約刻意以manifest IDs而非path depth作為identity key。
- Presigned URL的確切TTL與failed-diagnostic retention duration維持deployment policy；authorization、不得暴露secret及不得刪除formal artifact則固定不變。
