# `tests/contracts/lineage/` — rvt-ifc-usdc-lineage 可執行契約

本目錄是 `openspec/changes/rvt-ifc-usdc-lineage` tasks 2.1–2.4 的機器可讀正本：
五支 JSON Schema（放在上一層 `tests/contracts/`）、286 個 fixture、語意 validator，
以及把三者綁在一起的 `test_lineage_contracts.py`。

```
tests/contracts/
  model_version_bundle_manifest.json     # 2.1
  lineage_alignment_report.json          # 2.2
  pipeline_job_attempt.json              # 2.3（job/attempt 半邊）
  result_manifest.json                   # 2.3（result 半邊）
  source_bundle_ready.json               # 2.4
  lineage/
    test_lineage_contracts.py            # 唯一的 runner
    semantic_validators.py               # schema 表達不了的不變式（stdlib only）
    expectations.json                    # 每個 invalid fixture 指名的違規規則
    roundtrip_truth_table.json           # UUID36 <-> GlobalId22 <-> prim token 真值表
    fixtures/<contract>/{valid,invalid,semantic}/*.json
```

跑法：

```
.\.venv\Scripts\python.exe -m pytest tests/contracts/lineage -q -p no:cacheprovider
```

CI job：`.github/workflows/ci.yml` 的 **`root contracts and fakes`**。該 job 只
`pip install pytest jsonschema`，所以本目錄**只能**用 stdlib + pytest + jsonschema。

---

## 1. 命名決策（E-1／E-2）

五支 contract 檔逐字沿用 `tasks.md` 2.1–2.4 的名稱，**不加 `.schema.json` 後綴**
（`model_version_bundle_manifest.json` 而非 `model-version-bundle-manifest-v1.schema.json`），
與 `tests/contracts/` 既有的 `ifc_ready_payload.json`／`conversion_result_callback.json`
同一風格。檔名是「這份 repo 的契約清單」，不是發佈的 schema URL。

`$id` 另外走 change 既有 cloud schema 的 URL 家族
`https://bim-docs.jackshappybot.com/contracts/<name>-v1.schema.json`，
所以「檔名」與「對外識別碼」兩件事分開，改檔名不會動到 `$id`。

`tests/contracts/lineage/` 刻意**不放 `__init__.py`**（E-6）。`semantic_validators.py`
由測試用 `importlib.util.spec_from_file_location` 依路徑載入，`spec` 或 `spec.loader`
為 `None` 時直接 `ImportError` 並說明原因，不靜默略過。

## 2. Validator 契約

- `jsonschema.Draft202012Validator`，先 `check_schema()` 再建立實例。
- **不掛 `format_checker`**。`format: date-time` 只當 annotation 留著，
  timestamp 的拒絕責任全部由 `pattern` 承擔——這是 task 2.6 的前置條件。
  `test_utc_timestamp_defs_carry_pattern_and_format` 逐支釘死：
  timestamp 類 `$def` 必須 `pattern` 與 `format` 並存，且 `pattern` 以 `Z$` 收尾。
- Enum 大小寫逐字照抄 spec（E-3）：`READY`／`NON_READY`／`LEGACY_UNMANAGED`／
  `AVAILABLE`／`WAITING_CAPACITY` 等 wire literal 大寫；
  `manual_correction_required`／`succeeded_with_warnings`／`candidate|active|historical` 小寫。

### 共用 `$defs`

E-4：共用 `$defs` 逐字複製進各檔，不做跨檔 `$ref`。一致性由兩個測試守住：

| 測試 | 守什麼 |
|---|---|
| `test_shared_defs_are_deep_equal_across_contracts` | 五檔之間同名 `$defs`（實際交集：`utcTimestamp`×5、`sha256`／`locator`×4、`counts`／`identifier`／`metric`×3，以及 `attemptResultPrefix`／`bundleProducer`／`minioObjectRef`／`nullableIdentifier`／`nullableUtcTimestamp`／`publicationState`／`sourceBundleId`／`warningCode`）deep-equal |
| `test_shared_defs_match_cloud_request_schema` | 上述副本與 `openspec/changes/rvt-ifc-usdc-lineage/contracts/cloud-lineage-publication-request-v1.schema.json` 的正本 deep-equal（`counts`／`locator`／`metric`／`sha256`／`utcTimestamp`）；change 目錄不存在時 `skipif`（E-12） |

**比對前遞迴移除 `$comment`。** 理由：`$comment` 記的是「這一份檔為什麼要留這個副本」，
本來就會逐檔不同（例如 `model_version_bundle_manifest.$defs.locator` 註明 bundle artifact
用的是攤平型 `minioObjectRef`，locator 只作為家族 canonical 形狀保留）。
其餘每一個約束關鍵字仍逐字元比對；目前唯一會被這條規則吸收掉的差異就是
`locator` 與 `minioObjectRef` 的 `$comment` 措辭。

### `additionalProperties: false` 遞迴檢查

`test_object_schemas_close_additional_properties` 走訪整份 schema（含 `$defs` 內部），
規則是：

> 凡是**完整的 object 定義**——宣告 `properties`、`type` 含 `"object"`、且沒有 `$ref`
> 兄弟——都必須 `additionalProperties: false`。

兩類節點結構性豁免，不進白名單：

1. **partial applicator 底下的子 schema**：`if`／`then`／`else`／`not`／`contains`／
   `propertyNames`（以及它們的後代）。這些是對同一個 instance 的*部分*述詞，
   不是 object 定義；替它們關門會把外層合法的兄弟欄位一起打掉。
   例如 `$defs/resultManifest/properties/artifacts/allOf/*/contains` 只斷言
   「存在一個 `role` 等於 X 的 item」，那個 item 當然還有 ref／sha256 等欄位。
2. **有 `$ref` 兄弟的窄化節點**：關門責任在被 `$ref` 的 `$def`。
   目前只有 `lineage_alignment_report.$defs.alignmentReportJson.properties.metrics`
   底下三支 metric（`{"$ref": "#/$defs/scopedMetric", "properties": {"denominator_scope": {...}}}`）。

`_OPEN_OBJECT_WHITELIST` 這個逃生口留著但**目前是空的**：五支 schema 裡沒有任何
需要指名豁免的節點。日後要加，必須在旁邊寫下理由。
同一個測試另有一條 drift guard：宣告了 `properties` 卻既沒有 object `type`
也沒有 `$ref` 的節點會直接紅（無法判定該不該關門的節點不准存在）。

## 3. `expectations.json` 與「確定性 leaf 規則」

`expectations.json` 逐一記錄每個 `invalid/` fixture **應該踩到哪一條規則**，
形狀是 `{"<contract>/<file>": {"keyword": ..., "instance_pointer": ...}}`
（`instance_pointer` 是 RFC 6901，root 為空字串 `""`）。
部分條目另有 `intent` 說明字串，測試只讀 `keyword` 與 `instance_pointer`。

沒有這張表，「invalid fixture 有錯誤」只證明*有東西*紅了，不能證明紅的是它要打的那條規則。

### 為什麼不用 `best_match`

`oneOf` discriminator 會把 body 的錯誤包進 `context`；`best_match()` 對同深度錯誤
會退回父層的 `oneOf`，指向 union 而不是真正違規的欄位。
因此 `deterministic_leaf_error()` 用下列**確定性**規則，三份 fixture 草稿也是用同一條
規則記錄期望值的：

1. 把 error tree 攤平到 leaf（遞迴展開 `err.context`）；
2. 丟掉 boolean-schema leaf（`err.validator is None`）——那是非匹配 `oneOf` 分支的
   `"else": false` discriminator 拒絕，永遠不是真正原因；
3. 取 **instance path 最深**者；同深度再依 **instance path、schema path** 字典序排序，
   取第一個。

第 3 步的 tie-break 有可觀察後果，記錄在此以免日後被當成 fixture 寫錯：
`pipeline_job_attempt/invalid-attempt-selection-without-result-id.json` 檔名講的是
`result_id`，但三個 real leaf（`/body/publication_state`、`/body/result_id`、
`/body/selection_state`）同深度，字典序第一是 `/body/publication_state`，
`expectations.json` 記的就是實測值。若日後想讓「最貼近檔名的欄位」勝出，唯一的改法
是把 tie-break 從 instance path 換成 schema path——那會同時改動其他 contract 的既有
期望，屬於需要一次裁決的變更，不要單點修。

### key 格式的既知不整齊

合併三份草稿時 key **逐字保留**，所以 `lineage_alignment_report` 的條目是
`<contract>/invalid/<file>`，其餘四支是 `<contract>/<file>`。
`_load_expectations()` 在讀取時把可選的 `invalid/` 區段正規化掉，並在正規化後
撞名時直接 `AssertionError`，不靜默覆蓋。`test_every_invalid_fixture_is_covered_by_expectations`
再確保 fixture 與 expectations 是雙向一一對應（182 對 182），不會有孤兒條目或未宣告的 fixture。

## 4. `semantic/` fixture 格式（E-14）

```json
{
  "payload": { "...一份完整、schema-valid 的文件..." },
  "expect": { "diagnostic_codes": ["..."] }
}
```

硬規則：

- 頂層恰好只有 `payload` 與 `expect`；`expect` 恰好只有 `diagnostic_codes`；
  `diagnostic_codes` 是不重複的字串陣列（`test_every_semantic_fixture_declares_expect`）。
- `payload` **必須 schema-valid**。semantic fixture 的用途是隔離出「schema 過得了、
  語意過不了」的那一層；payload 若本來就 schema 紅，這個 fixture 什麼都沒證明。
  `test_semantic_scenario` 先驗 schema 再比 codes。
- 回傳的 codes **逐字（含順序）**等於 `expect.diagnostic_codes`。
- 空清單是合法且**有承重**的期望值：`lineage_alignment_report` 有 5 個 `clean-*`
  場景，證明 validator 在自洽文件上會閉嘴，而不是看到什麼都開槍。

分派表（`SEMANTIC_DISPATCH`）：

| contract | validator |
|---|---|
| `model_version_bundle_manifest` | `validate_bundle_scenario` |
| `lineage_alignment_report` | `validate_alignment_report` |
| `pipeline_job_attempt` | `validate_job_scenario` |
| `result_manifest` | `validate_result_publication_scenario` |
| `source_bundle_ready` | 無 semantic fixture（純 intake 宣告，無跨欄位算術） |

`test_semantic_dispatch_covers_every_contract_with_semantic_fixtures` 確保日後某支
contract 長出 semantic fixture 卻忘了接 validator 時會紅。

反方向由 `test_valid_fixtures_carry_no_semantic_contradiction` 守住：四支有 validator
的 contract，**每一個 `valid/` fixture 都必須得到空清單**。`semantic/` 語料證明
validator 該開槍時會開槍，這條證明它其餘時候會閉嘴——少了它，一條寫壞成「見文件就報」
的規則仍然能讓 `semantic/` 全綠。`source_bundle_ready` 沒有 validator，
參數化時直接排除而不是 skip，所以 CI 看到 skip 就一定只代表路徑不存在。

### 兩套 code 詞彙，是刻意的

- `validate_alignment_report` 吐 **UPPER_SNAKE**（`RVT_IFC_DENOMINATOR_MISMATCH`…）。
  那是報表帳務診斷，不會出現在 wire 上。
- 其餘三支吐 **lower_snake**（`missing_required_role`、`manifest_digest_conflict`…），
  因為這些字就是契約自己已經帶著的 wire enum
  （`integrity_diagnostics[].code`、`diagnostics[].code`）；語意層不該替同一個診斷
  再發明第二種拼法。

## 5. 逐 contract fixture 期望表

數量門檻寫在 `FIXTURE_MINIMUMS`（E-13），由 `test_fixture_minimum_counts` 當 ratchet
擋住無聲縮水。目前值即現況：

| contract | valid | invalid | semantic | task |
|---|---|---|---|---|
| `model_version_bundle_manifest` | 9 | 30 | 8 | 2.1 |
| `lineage_alignment_report` | 6 | 48 | 24 | 2.2 |
| `pipeline_job_attempt` | 27 | 53 | 8 | 2.3 |
| `result_manifest` | 15 | 38 | 5 | 2.3 |
| `source_bundle_ready` | 2 | 13 | 0 | 2.4 |
| **合計** | **59** | **182** | **45** | |

逐檔的「這個 fixture 打哪條規則」對照表，機器正本是 `expectations.json`
（invalid）與各 fixture 自己的 `expect` 區段（semantic）；下面只列語意層的規則定義。

### 2.1 `model_version_bundle_manifest` — `validate_bundle_scenario`

`source_bundle_manifest`：

| code | 規則 |
|---|---|
| `missing_required_role` | `source_rvt`／`schedule_csv`／`source_ifc` 三個 role 齊備 |
| `duplicate_role` | 且各只出現一次 |
| `presigned_locator_forbidden` | ref 不得帶 `X-Amz-` 樣式的 presign 參數 |
| `unversioned_locator` | ref 的 `?versionId=` 必須與 `object_version_id` 逐字相等 |
| `artifact_incomplete` | `size_bytes` 為 0 = object 存在但還沒寫完 |
| `semantic_contract_violation` | 同一 bundle 的所有 artifact 必須同一個 MinIO authority |
| `manifest_published_before_artifacts` | `published_at` 不得早於 `created_at`（manifest 最後發布） |

`legacy_unmanaged_preview`：同上前六條，套用在
`candidate_metadata.candidate_artifacts`——湊不齊三個 role 的 grouping 不得被呈現為可升格。

`source_bundle_validation_result`：

| code | 規則 |
|---|---|
| `semantic_contract_violation` | `conditional_create.attempted` 與 `outcome` 必須一致（`not_attempted` iff `attempted=false`） |
| `manifest_digest_conflict` | `conflict_different_digest` 不可能同時是同 bytes 的 `replay` |
| `immutable_bundle_overwrite_rejected` | `replay=true` 卻回報 `created` = 宣稱覆寫了不可變 bundle |

`legacy_enrollment_confirmation` 的兩條規則 schema 已用 if/then 表達完，語意層不再重複。
**刻意未實作**：`artifact_not_found`／`etag_mismatch`／`sha256_mismatch`／`size_mismatch`
需要對 object store 做 HEAD，光看文件無法判定，留給 runtime 驗證。

### 2.2 `lineage_alignment_report` — `validate_alignment_report`

tasks 4.4 的算術正本，共 30 餘個 UPPER_SNAKE code：metric／count 綁定六碼、
row accounting 四碼、集合代數三碼、ratio truncation 與 status 各三碼、
`<SET>_SET_EXCEEDS_COUNT` 七碼，以及 identity 鏈
（`GUID_ROUNDTRIP_FAILED`／`PRIM_TOKEN_MISMATCH`／`PRIM_TOKEN_LENGTH_INVALID`／
`UUID36_CANONICALIZATION_MISMATCH`／`OBSERVED_CHILD_PRIM_ROOT_MISMATCH`／兩個 OVERLAP）
與 `CSV_COLUMN_CONTRACT_MISMATCH`。
`validate_alignment_summary(metrics, counts)` 被抽出來，是 2.2／2.3／2.5 共用的
**單一實作**，producer／result manifest／cloud publication 因此不可能各自漂移。

E-9／E-10：round-trip 只指 UUID36↔GlobalId22（雙向都測）；prim token 是**單向**
推導 `usd_guid_token(GlobalId22) == token`。長度 24 的檢查放在 validator，
schema pattern 維持 `G_[A-Za-z0-9_]+` 不釘長度。

### 2.3 `pipeline_job_attempt` — `validate_job_scenario`

| document_type | code | 規則 |
|---|---|---|
| `pipeline_job` | `restart_created_second_logical_job` | `streaming_restart`／`coordinator_restart` 事件在**任何**位置都不得 `created_new_logical_job=true` |
| `pipeline_job` | `duplicate_logical_job_for_source_bundle` | 其餘 kind 只有 ledger **第一筆**可以建立 logical job；replay 又建一個即違規 |
| `pipeline_job` | `semantic_invalid_source_retried_same_job` | 已進 terminal `manual_correction_required` 的 job 不得再有 in-flight attempt 或 `retry` ledger entry |
| `admission_record` | `lease_loss_consumed_attempt` | 非 `ADMITTED` 且 `blocker_codes` 含 `lease_lost` 時 attempt counter 不得增加 |
| `admission_record` | `waiting_capacity_consumed_attempt` | 其餘非 `ADMITTED` 原因的同一條 counter 規則 |
| `result_compare` | `compare_cross_job_rejected` | 兩側與 body 必須同一個 `pipeline_job_id`，跨 job compare fail closed |
| `activation_audit_entry` | `promote_target_not_selectable` | `promote`／`rollback` 的 `target_result_evidence` 必須 `AVAILABLE` ∧ outcome ∈ {succeeded, succeeded_with_warnings} |
| `activation_audit_entry` | `auto_promotion_of_subsequent_result` | system actor 發起且 `authorization_decision_ref=null` 的 promote = 自動取代 active |

兩條規則的**互斥設計**值得記一筆：restart 事件在 index > 0 且 `created_new_logical_job=true`
時，兩條規則字面上都成立。實作先判 event kind，restart 走 restart 碼，
其餘才走 duplicate 碼——不然一個 restart 缺陷會同時吐兩個診斷，讀者無從判斷根因。

`activationAuditEntry.target_result_evidence` **刻意不在 schema 依 transition 收緊**：
audit 是 append-only 的「實際發生了什麼」，必須能忠實記錄一個違約 transition；
selectable-matrix 綁定由這支 validator 執行。

### 2.3 `result_manifest` — `validate_result_publication_scenario`

| document_type | code | 規則 |
|---|---|---|
| `result_manifest` | `manifest_published_before_artifacts` | manifest 的 `published_at` 不得早於任何 artifact 的 `published_at` |
| `result_manifest` | `alignment_summary_denominator_mismatch` | 三個 denominator 與 counts 的綁定，委派給 `validate_alignment_summary`，把它的三個 `*_DENOMINATOR_MISMATCH` 收斂成這一個 wire code |
| `result_publication_outcome` | `second_formal_result_for_attempt` | `prior_result_id` 非 null 時必須等於 `result_id` |
| `result_publication_outcome` | `non_idempotent_replay_reported_as_created` | 同一 result 同 digest 重放必須回報 `replay_same_digest`，不得回報 `created` |
| `result_publication_outcome` | `manifest_digest_conflict` | digest 與 prior 不同時必須回報 `conflict_different_digest` |

**判斷順序是規格的一部分**：`second_formal_result_for_attempt` 先判、且單獨成立。
一旦 prior result 是「另一個 result」，後面的 digest 比較是在比兩份不同文件，
對冪等性說不出任何話；把兩個診斷一起吐出來只會遮蔽根因。
（同理，時間一律用 `_parse_utc` 解析成 instant 再比，不用字串比大小——
`...:00Z` 與 `...:00.000Z` 是同一刻，字串序卻相反。）

### 2.4 `source_bundle_ready` 的邊界

2.4 的重點不是欄位，是**不得形成第二個 publication authority**。三層表達：
`additionalProperties: false`、顯式 `not: {anyOf: [required …]}` 逐一列出禁用欄位
（`schema_version`／`event_type`／`publication_identity`／`result_manifest_digest`／
`edge_site_id`／`callback_url`／`result_refs`／`alignment_summary`），加上兩個跨 schema 反例：

| 測試 | 斷言 |
|---|---|
| `test_source_bundle_ready_rejects_cloud_publication_example` | change 的 `contracts/examples/valid-lineage-result-published.json` 必須被 `source_bundle_ready.json` 拒絕，且 leaf 為 `additionalProperties` |
| `test_cloud_request_schema_rejects_source_bundle_ready_example` | `valid-source-bundle-ready-minimal.json` 必須被 cloud request schema 拒絕 |

兩者都 `skipif(not path.exists())`（E-12）：change 目錄被 archive 之後，
這兩條會 skip 而不是假紅。

### 既有契約凍結

本 change 是 additive，不得改動兩支既有契約。三個測試釘死：

- `test_legacy_ifc_ready_contract_is_frozen`：`contract_version == "1.1.0"`、
  `transport.path == "/api/external/ifc-ready"`。
- `test_legacy_callback_contract_is_frozen`：`contract_version == "1.0.0"`、
  `events` 恰為 `{conversion_result_ready, conversion_failed}`。
- `test_legacy_contracts_contain_no_lineage_tokens`：兩檔全文不得出現
  `source_bundle_ready`／`lineage_result_published`／`lineage_result_health_changed`／
  `cloud-lineage-publication`。

## 6. A／B 兩種 body 窄化風格（已知差異，非缺陷）

四支帶 envelope 的 contract 用 `document_type` 窄化 `body`，但寫法有兩種：

| 風格 | 用在 | 寫法 |
|---|---|---|
| **A：`oneOf` ＋ discriminator 短路** | `model_version_bundle_manifest`、`pipeline_job_attempt`、`result_manifest` | 每個分支寫成 `{"if": {document_type const X}, "then": {body: {$ref …}}, "else": false}` |
| **B：`allOf` ＋ `if`/`then`** | `lineage_alignment_report` | `allOf: [{"if": {document_type const X}, "then": {body: {$ref …}}}, …]` |

兩者語意等價（分支彼此互斥），差別只在錯誤樹形狀：

- 純 `oneOf`（沒有 `else: false`）會讓三個不匹配分支也對 `body` 產生錯誤，
  expectations 會指到錯誤分支的欄位；加上 discriminator 短路之後，
  不匹配分支只留下一個 boolean-schema leaf，第 2 步規則會把它丟掉。
- `allOf` ＋ `if`/`then` 根本不進 `context`，錯誤直接就是 leaf。

藍圖 §2.1 對 bundle manifest 指定 `oneOf`，§2.2 對 alignment report 沒有指定，
兩位 worker 因此各自選了對自己 contract 最乾淨的形狀。
`deterministic_leaf_error()` 對兩種形狀都給出同一個答案，182 個 invalid fixture
全部通過，所以**目前不需要統一**。若日後要統一成一種，改的是 schema 不是測試，
且必須重跑 `test_invalid_fixture_hits_expected_violation` 全表確認 expectations 沒有位移。

另有兩處相關的 `$defs` 冗餘，同樣是刻意保留的：

- `lineage_alignment_report.$defs.metric` 逐字保留但未被引用，實際用的是
  `scopedMetric`（多一個 `denominator_scope`）。`metric` 宣告 `additionalProperties: false`，
  沒有任何 `allOf`／`$ref` 組合能加第五個成員，所以擴充只能整份重寫；
  保留原版是為了讓 `test_shared_defs_match_cloud_request_schema` 有得比。
- `$defs/locator`（object 形狀）與 `$defs/minioObjectRef`（攤平的 ref 字串）並存：
  bundle／result 的 artifact 是把 locator 欄位攤平後再加 `role`／`filename`／
  `content_type`，無法 `$ref` 一個 `additionalProperties: false` 的 object。

## 7. 加規則時要動哪裡

| 想加什麼 | 動哪裡 | 附帶要做的 |
|---|---|---|
| 新的 schema 級規則 | 對應 `tests/contracts/<contract>.json` | 加一個 `invalid/` fixture ＋ `expectations.json` 一筆 |
| 新的語意規則 | `semantic_validators.py` | 加一個 `semantic/` fixture，`expect.diagnostic_codes` 逐字列出 |
| 新的 fixture | `fixtures/<contract>/<kind>/` | invalid 一定要有 expectations 條目（否則 `test_every_invalid_fixture_is_covered_by_expectations` 紅） |
| 新的共用 `$def` | 五檔逐字複製 | deep-equal 與 cloud 比對兩測會自動涵蓋 |
| 調整 fixture 數量門檻 | `FIXTURE_MINIMUMS` | 只准往上，往下等於自願放棄覆蓋率 |
