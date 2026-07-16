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

本目錄不包含publisher runtime、external `bim-control` receiver、MySQL migration、DB credentials或live database evidence。Implementation階段才會把schema/fixtures promotion到`tests/contracts/`並擴充test-only fake。

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
- 每個locator authority逐字等於top-level `edge_site_id`，object key無raw `?`／`#`，且query只有唯一`?versionId=`。
- top-level `result_manifest_digest`逐字等於`result_manifest_ref.sha256`。
- nonzero denominator時`ratio == numerator / denominator`。
- ratio 1對應`complete`；0≤ratio<1對應`partial`。
- `warning_code_count == warning_codes.length`。
- `publication_identity`對應`edge_site_id + external_model_version_id + result_id`。

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
| 相同event ID但raw-body digest不同 | 409 | 不得變更，需人工修正 |
| 相同publication identity但manifest digest不同 | 409 | 不得變更，需人工修正 |
| Tenant綁定不一致 | 403 | 不得變更；不得從MinIO path建立authority |
| Parent model-version不存在 | 422 | 不得變更；需人工修正 |
| 網路／逾時／408／429／5xx | 視情況而定 | 有限次retry |
| 202、empty/malformed/mismatched 2xx | 2xx | protocol failure；不得標`DELIVERED` |

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

Sanitized error body只必填`error`。當request ID缺失、malformed或尚未通過可採信的解析／驗證時，receiver MUST NOT 捏造`event_id`；若error body提供`event_id`，它仍必須是已解析request context中的有效UUID。Success ACK的`event_id`維持必填。

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

`MISSING`／`INTEGRITY_FAILED`需至少兩次edge observation；restore可回`VERIFIED`；`TOMBSTONED`只接受formal retention/revocation record。Health payload不重送summary；receiver以`publication_identity` join原publication並逐字驗證original result ID/ref/digest。Health history與每次accepted delivery/replay receipt均append-only，receipt不得update成replay counter。

Current health不儲存在immutable publication row：尚無health event時衍生為`VERIFIED`；其後以最新accepted append-only health transition為準，health event不得update `lineage_publications`。

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
| `invalid-incomplete-ack.json` | 回應 | 無效 |
| `invalid-error-event-id.json` | 回應 | 無效 |

Valid schema結果只證明contract artifact一致；不代表production publisher、external receiver或cloud MySQL已實作／執行。
