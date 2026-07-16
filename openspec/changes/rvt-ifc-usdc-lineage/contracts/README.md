# 雲端Lineage發布契約v1

> **給外部公司雲端 API 的專用契約：`edge bim-review-coordinator → external company-cloud bim-control → cloud MySQL`。**
>
> `POST /api/v1/lineage-publications` 不是 browser API、不是 producer intake、不是既有 `conversion_result_ready|conversion_failed` callback，也不是本 repo host 的 production endpoint。

## 本階段邊界

這些檔案是 `rvt-ifc-usdc-lineage` 的 contract-only reference：

- `cloud-lineage-publication-request-v1.schema.json`：兩種 outbound events。
- `cloud-lineage-publication-response-v1.schema.json`：commit ACK 與 sanitized error。
- `examples/valid-*.json`：應通過對應 schema。
- `examples/invalid-*.json`：應被對應 schema 或 semantic validator拒絕。
- `cloud-lineage-publication-mysql8-reference.sql`：external cloud logical model的 **REFERENCE ONLY** mapping。

本目錄不包含publisher runtime、external `bim-control` receiver、MySQL migration、DB credentials或live database evidence。Reference DDL的utf8mb4 composite keys以MySQL 8 InnoDB 16 KiB page與`ROW_FORMAT=DYNAMIC`為physical adoption prerequisite；最大ACK binding為2,952／3,072 bytes。External owner必須在migration前驗證live settings／DDL；較小page size須fail preflight或採等價且collision-safe、不截斷logical identity的physical key設計。Implementation階段才會把schema/fixtures promotion到`tests/contracts/`並擴充test-only fake。

## 請求契約

端點：

```text
POST /api/v1/lineage-publications
Content-Type: application/json
```

事件：

```text
lineage_result_published
lineage_result_health_changed
```

`source_bundle_ready` 不送cloud。只有integrity-valid formal ResultManifest可建立published event；failed/cancelled attempt若有contract-complete formal result可發布稽核位置，但維持non-selectable且不送ready callback。Diagnostic-only/temp/invalid output排除。

### 僅保存結果位置

Cloud只保存下列四個formal locators及integrity metadata：

```text
result_manifest_ref
lineage_mapping_ref
alignment_report_json_ref
alignment_report_csv_ref
```

URI固定：

```text
minio://{edge_site_id}/{bucket}/{object_key}?versionId={object_version_id}
```

每個locator同時帶`object_version_id`、`etag`、`sha256`、`size_bytes`。它是stable location，不是presigned URL；cloud可完全無法直接下載edge MinIO。

Cloud不收RVT/IFC/USDC bytes、manifest/report body、mapping rows、diff ID sets、diagnostics、credentials、local path或base64。完整`element_mapping.json`、alignment JSON/CSV與diff sets只留edge MinIO。

### 輕量摘要

Cloud summary固定三組metrics與十個counts；沒有逐element arrays。每組metric帶`numerator`、`denominator`、`ratio`、`status`。Denominator 0固定為`numerator=0`、`ratio=null`、`status=not_evaluable`。`warning_codes` unique且最多64個，`warning_code_count`須由semantic validator確認與array length一致。

JSON Schema可拒絕形狀與enum錯誤；下列cross-field規則仍須由sender/receiver semantic validator驗證：

- locator query `versionId`逐字等於`object_version_id`。
- `edge_site_id`固定為ASCII `[A-Za-z0-9._-]+`，與locator authority使用同一字元集合；每個locator authority逐字等於top-level `edge_site_id`，object key無raw `?`／`#`，且query只有唯一`?versionId=`。
- top-level `result_manifest_digest`逐字等於`result_manifest_ref.sha256`。
- nonzero denominator時，以decimal arithmetic計算`numerator / denominator`，再向零截斷至小數第10位作為`ratio`；trailing zeros可省略。
- `ifc_usdc_coverage_ratio.denominator == eligible_ifc_product_count`，且其`numerator == eligible_ifc_product_count - ifc_usdc_unmapped_count`。
- `rvt_ifc_alignment_ratio.denominator == csv_valid_count`，且其`numerator == csv_valid_count - csv_only_count`。
- `ifc_only_count == eligible_ifc_product_count - rvt_ifc_alignment_ratio.numerator`。
- `csv_valid_count <= csv_total_count`。
- `duplicate_rvt_id_count`、`duplicate_ifc_guid_count`與`invalid_row_count`各自`<= csv_total_count - csv_valid_count`；三類可重疊，不要求總和等式。
- `rvt_ifc_usdc_lineage_ratio.denominator == csv_valid_count`，且其`numerator == full_lineage_matched_count`。
- `full_lineage_matched_count <= rvt_ifc_alignment_ratio.numerator`。
- `full_lineage_matched_count <= ifc_usdc_coverage_ratio.numerator`。
- `full_lineage_matched_count >= max(0, rvt_ifc_alignment_ratio.numerator + ifc_usdc_coverage_ratio.numerator - eligible_ifc_product_count)`。
- ratio 1對應`complete`；0≤ratio<1對應`partial`。
- `warning_code_count == warning_codes.length`。
- `edge_site_id` MUST 符合`^[A-Za-z0-9._-]+$`；`external_model_version_id`與`result_id` MUST NOT 含literal `:`。`publication_identity`必須逐byte等於`edge_site_id + ":" + external_model_version_id + ":" + result_id`，sender與receiver都須重新計算並拒絕不一致值。

## HMAC

設定只能來自server：

```text
CLOUD_LINEAGE_PUBLICATION_MODE=disabled|required
CLOUD_LINEAGE_PUBLICATION_BASE_URL
CLOUD_LINEAGE_PUBLICATION_HMAC_KEY_ID
CLOUD_LINEAGE_PUBLICATION_HMAC_SECRET
```

標頭：

```text
X-Lineage-Event-Id
X-Lineage-Signature-Timestamp
X-Lineage-Signature-Key-Id
X-Lineage-Webhook-Signature: sha256=<lowercase-hex>
```

`X-Lineage-Signature-Timestamp`固定為UTC Unix epoch seconds的canonical ASCII unsigned base-10字串，格式為`^(?:0|[1-9][0-9]*)$`。除單一`0`外不得有leading zero，也不得有正負號、小數、毫秒值或RFC 3339 timestamp。Sender以header中的exact string作為簽章輸入；receiver先按此格式驗證，再解析為epoch seconds並套用預設±300秒clock-skew window，任何格式、範圍或window錯誤都必須在event identity或domain mutation前拒絕。例如`1760000000`格式有效；`01760000000`、`+1760000000`、`1760000000.0`、`1760000000000`與`2026-07-16T08:15:30Z`格式或秒值語意無效。

簽章標準輸入：

```text
HMAC-SHA256(secret, signature_timestamp + "\n" + raw_request_body)
```

Sender先serialize一次body，再以同一raw bytes簽名與傳送。Retry保持`event_id`、body與body digest不變；timestamp/signature可更新。Receiver以raw bytes及constant-time compare驗簽、要求header/body event ID一致，預設clock skew為±300秒。

禁止在payload、log、UI、examples或evidence放secret。Production `required`只准HTTPS；HTTP只可用於explicit test profile的loopback fake。

## ACK與錯誤

| 條件 | HTTP | 必要行為 |
|---|---:|---|
| 首次transaction commit | 201 | 精確ACK，`replay=false` |
| 已發布相同identity、digest與immutable content | 200 | 回傳原始registration，`replay=true` |
| 新health event ID且publication digest相同 | 201 | 附加transition，`replay=false` |
| 相同health event ID與相同raw-body digest | 200 | 精確replay，`replay=true` |
| 相同event ID但event type／publication identity／raw-body digest任一不同 | 409 | 不得變更，需人工修正 |
| 相同publication identity但manifest digest不同 | 409 | 不得變更，需人工修正 |
| Tenant綁定不一致 | 403 | 不得變更；不得從MinIO path建立authority |
| Parent model-version不存在 | 422 | 不得變更；需人工修正 |
| 網路／逾時／408／429／5xx | 視情況而定 | 有限次retry |
| 202、empty/malformed/mismatched 2xx | 2xx | protocol failure；不得標`DELIVERED` |

Sanitized error的HTTP status、code與retryability固定如下；任何交叉不一致都屬protocol failure：

| `error.code` | HTTP | `retryable` |
|---|---:|---:|
| `INVALID_REQUEST` | 400 | `false` |
| `UNSUPPORTED_SCHEMA` | 422 | `false` |
| `HMAC_AUTH_FAILED` | 401 | `false` |
| `TENANT_BINDING_MISMATCH` | 403 | `false` |
| `PARENT_BINDING_NOT_FOUND` | 422 | `false` |
| `PUBLICATION_DIGEST_CONFLICT` | 409 | `false` |
| `RATE_LIMITED` | 429 | `true` |
| `TRANSIENT_UNAVAILABLE` | 503 | `true` |
| `INTERNAL_ERROR` | 500 | `true` |

成功ACK必須精確包含：

```text
registration_id
event_id
publication_identity
manifest_digest
stored_at
replay
```

Sender只有在200/201且event/identity/digest逐字匹配時標`DELIVERED`。Delivery是at-least-once，不宣稱exactly-once。

Receiver在任何publication、health或receipt mutation前，須於同一transaction建立／檢查以`event_id`為primary key的immutable event ledger，保存first accepted `event_type + publication_identity + raw_body_sha256` tuple。相同`event_id`搭配任一不同tuple field一律`409`且不異動；完整tuple相同才可繼續event-type-specific replay判定。Reference DDL以四欄composite FK強制publication的first-event tuple與每筆health row逐欄等於ledger tuple，防止direct import／reconciliation繞過reservation；每次accepted first delivery／replay仍另append receipt row，receipt也以相同四欄綁定ledger，並以`publication_identity + manifest_digest + registration_id`綁定原publication ACK identity。

Published event另計算`publication_content_sha256`：對`schema_version`、`event_type`、`edge_site_id`、`tenant_id`、`project_id`、`external_model_version_id`、`result_id`、`publication_identity`、`result_manifest_digest`與完整published `payload`組成的projection做RFC 8785 JCS，再取lowercase SHA-256；明確排除transport-specific `event_id`、`occurred_at`與`correlation_id`。相同identity／manifest digest只有在此digest也相同時才是`200 replay`，否則`409`。

Sanitized error body只必填`error`。當request ID缺失、malformed或尚未通過可採信的解析／驗證時，receiver MUST NOT 捏造`event_id`；若error body提供`event_id`，它仍必須是已解析request context中的有效UUID。Success ACK的`event_id`維持必填。

`error.retryable`不是advisory：`INVALID_REQUEST | UNSUPPORTED_SCHEMA | HMAC_AUTH_FAILED | TENANT_BINDING_MISMATCH | PARENT_BINDING_NOT_FOUND | PUBLICATION_DIGEST_CONFLICT`固定為`false`；`RATE_LIMITED | TRANSIENT_UNAVAILABLE | INTERNAL_ERROR`固定為`true`。Response schema拒絕code/boolean矛盾，sender亦不得用矛盾body覆寫HTTP與domain分類。

## Outbox與健康狀態

Wire狀態：

```text
DISABLED | PENDING | RETRYING | DELIVERED | DEAD_LETTER | CONFLICT
```

UI文字：

```text
未啟用 | 待送 | 重試中 | 已登錄 | 待人工處理 | 衝突
```

Default最多5次exponential backoff＋jitter；transient dead-letter在cooldown後auto-reconcile，deterministic 4xx/conflict需人工修正／replay。Cloud delivery不阻擋edge `READY`／`AVAILABLE`。

健康狀態：

```text
VERIFIED | MISSING | INTEGRITY_FAILED | TOMBSTONED
```

`MISSING`／`INTEGRITY_FAILED`需至少兩次edge observation；restore可回`VERIFIED`；`TOMBSTONED`只接受formal retention/revocation record且必須攜帶`tombstone_record_id`，其他health states MUST NOT 攜帶該欄位。Health payload不重送summary；receiver以`publication_identity + manifest_digest` join原publication並逐字驗證original result ID/ref/digest，reference DDL亦以相同composite key約束health與receipt rows。Health history與每次accepted delivery/replay receipt均append-only，receipt不得update成replay counter。

Current health不儲存在immutable publication row：尚無health event時衍生為`VERIFIED`；其後依`observed_at DESC`排序，完全相同的observation time再以receiver-assigned append order做deterministic tie-break。`observed_at`必須是uppercase `Z`的UTC timestamp，年份限`1000–9999`、秒限`00–59`，小數秒可省略或為1–6位；receiver只可右補零至microsecond，MUST NOT 接受offset、leap second、MySQL範圍外年份、超過6位精度、round或truncate。延遲送達的較舊observation只append history，不得覆寫較新current health；health event不得update `lineage_publications`。

## 範例預期結果

| 範例 | Schema | 預期結果 |
|---|---|---|
| `valid-lineage-result-published.json` | 請求 | 有效 |
| `valid-lineage-result-health-changed.json` | 請求 | 有效 |
| `valid-created-ack.json` | 回應 | 有效 |
| `valid-conflict-error.json` | 回應 | 有效 |
| `valid-auth-error-without-event-id.json` | 回應 | 有效 |
| `invalid-presigned-health-locator.json` | 請求 | 無效 |
| `invalid-lowercase-presigned-locator.json` | 請求schema | 無效 |
| `invalid-cross-site-health-locator.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-colon-publication-identity-component.json` | 請求schema | 無效 |
| `invalid-edge-site-authority-character.json` | 請求schema | 無效（`edge_site_id`含locator authority字元集合外的`/`） |
| `invalid-mismatched-publication-identity.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-inconsistent-ifc-usdc-counts.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-inconsistent-rvt-ifc-counts.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-inconsistent-ifc-only-count.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-csv-valid-exceeds-total.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-inconsistent-alignment-counts.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-full-lineage-exceeds-rvt-ifc.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-full-lineage-exceeds-ifc-usdc.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-full-lineage-below-set-intersection.json` | semantic validator | 無效（JSON shape有效） |
| `invalid-offset-health-observed-at.json` | 請求schema | 無效 |
| `invalid-submicrosecond-health-observed-at.json` | 請求schema | 無效 |
| `invalid-leap-second-health-observed-at.json` | 請求schema | 無效 |
| `invalid-out-of-range-health-observed-at.json` | 請求schema | 無效 |
| `valid-lineage-result-tombstoned.json` | 請求 | 有效 |
| `invalid-tombstone-id-on-non-tombstone.json` | 請求schema | 無效 |
| `invalid-incomplete-ack.json` | 回應 | 無效 |
| `valid-transient-error.json` | 回應 | 有效 |
| `invalid-error-event-id.json` | 回應 | 無效 |
| `invalid-retryable-deterministic-error.json` | 回應 | 無效 |
| `invalid-nonretryable-transient-error.json` | 回應 | 無效 |

Valid schema結果只證明contract artifact一致；不代表production publisher、external receiver或cloud MySQL已實作／執行。
