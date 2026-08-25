# `tests/contracts/lineage/` — rvt-ifc-usdc-lineage 可執行契約

本目錄是 `openspec/changes/rvt-ifc-usdc-lineage` tasks 2.1–2.7 的機器可讀正本：
七支 JSON Schema（放在上一層 `tests/contracts/`）、363 個 fixture、語意 validator、
wire-protocol validator，以及把它們綁在一起的兩支 runner。

```
tests/contracts/
  model_version_bundle_manifest.json                 # 2.1
  lineage_alignment_report.json                      # 2.2
  pipeline_job_attempt.json                          # 2.3（job/attempt 半邊）
  result_manifest.json                               # 2.3（result 半邊）
  source_bundle_ready.json                           # 2.4
  cloud-lineage-publication-request-v1.schema.json   # 2.5（change 原檔 byte-identical）
  cloud-lineage-publication-response-v1.schema.json  # 2.5（同上）
  lineage/
    test_lineage_contracts.py                        # 2.1–2.5＋2.7 的文件層 runner
    test_cloud_publication_protocol.py               # 2.6＋2.7 的 wire/transport runner
    semantic_validators.py                           # schema 表達不了的不變式（stdlib only）
    protocol_validators.py                           # HMAC／timestamp header／ACK（stdlib only）
    expectations.json                                # 每個 invalid fixture 指名的違規規則
    roundtrip_truth_table.json                       # UUID36 <-> GlobalId22 <-> prim token 真值表
    fixtures/<contract>/{valid,invalid,semantic}/*.json
    fixtures/protocol/*.json                         # HMAC golden vectors、ACK 分類語料
```

跑法：

```
.\.venv\Scripts\python.exe -m pytest tests/contracts/lineage -q -p no:cacheprovider
```

CI job：`.github/workflows/ci.yml` 的 **`root contracts and fakes`**。該 job 只
`pip install pytest jsonschema`，所以本目錄**只能**用 stdlib + pytest + jsonschema。

---

## 1. 命名決策（E-1／E-2）

2.1–2.4 的五支 contract 檔逐字沿用 `tasks.md` 的名稱，**不加 `.schema.json` 後綴**
（`model_version_bundle_manifest.json` 而非 `model-version-bundle-manifest-v1.schema.json`），
與 `tests/contracts/` 既有的 `ifc_ready_payload.json`／`conversion_result_callback.json`
同一風格。檔名是「這份 repo 的契約清單」，不是發佈的 schema URL。

**2.5 的兩支是刻意的例外**：`cloud-lineage-publication-request-v1.schema.json` 與
`...-response-v1.schema.json` 保留 change 目錄的原檔名。理由是它們不是新寫的契約，
而是 `openspec/changes/rvt-ifc-usdc-lineage/contracts/` 的 **byte-identical promotion**；
檔名一致，`test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals`
才讀得出是「同一份檔的搬移」而不是「改名後的另一份」。

`$id` 另外走 change 既有 cloud schema 的 URL 家族
`https://bim-docs.jackshappybot.com/contracts/<name>-v1.schema.json`，
所以「檔名」與「對外識別碼」兩件事分開，改檔名不會動到 `$id`。

`tests/contracts/lineage/` 刻意**不放 `__init__.py`**（E-6）。`semantic_validators.py`
與 `protocol_validators.py` 都由測試用 `importlib.util.spec_from_file_location`
依路徑載入，`spec` 或 `spec.loader` 為 `None` 時直接 `ImportError` 並說明原因，不靜默略過。

## 2. Validator 契約

- `jsonschema.Draft202012Validator`，先 `check_schema()` 再建立實例。
- **不掛 `format_checker`**。`format: date-time` 只當 annotation 留著，
  timestamp 的拒絕責任全部由 `pattern` 承擔——這是 task 2.6 的前置條件。
  `test_utc_timestamp_defs_carry_pattern_and_format` 逐支釘死：
  timestamp 類 `$def` 必須 `pattern` 與 `format` 並存，且 `pattern` 以 `Z$` 收尾。
  2.6 的 `test_format_annotation_is_inert_without_a_plugin` 另外證明前提本身
  （裸 `{"format": "date-time"}` 會放行 `2026-07-16T16:15:31+08:00`）。
- Enum 大小寫逐字照抄 spec（E-3）：`READY`／`NON_READY`／`LEGACY_UNMANAGED`／
  `AVAILABLE`／`WAITING_CAPACITY` 等 wire literal 大寫；
  `manual_correction_required`／`succeeded_with_warnings`／`candidate|active|historical` 小寫。

### 一個 contract 兩支 schema：`cloud_lineage_publication` 的方向路由

`cloud_lineage_publication` 是唯一一個「一個 fixture 目錄、兩支 schema」的契約
（request envelope 與 response body）。Runner 用 `_validator_for(contract, document)`
路由，判定委給 `semantic_validators.cloud_publication_direction()`：

> 文件有 `schema_version` member → request；否則 → response。

判的是**存在**而不是值，所以 `invalid-unknown-schema-version.json`（故意打壞 const）
仍然正確路由到 request；兩個 response body 都是 `additionalProperties: false`
且沒宣告 `schema_version`，因此 response 永遠帶不到這個 member。

路由由三條測試守住，缺一不可：

| 測試 | 守什麼 |
|---|---|
| `test_cloud_expectation_schema_field_matches_the_direction_router` | 每筆 cloud expectation 的 `schema` 欄位（作者宣告的方向）必須等於 router 實際判定 |
| `test_cloud_fixture_is_rejected_by_the_opposite_direction_schema` | 73 個 cloud fixture 每一個都必須被**對向** schema 拒絕；兩個方向不可退化成互相接受 |
| `test_valid_fixture_passes_schema` ×10 | 路由到的那一側必須接受 |

> **Fixture 撰寫規則**：新增 request fixture 一律保留 `schema_version` member
> （值可以打壞），否則會被路由成 response。

### 共用 `$defs`

E-4：共用 `$defs` 逐字複製進各檔，不做跨檔 `$ref`。一致性由四個測試守住：

| 測試 | 守什麼 | archive 之後 |
|---|---|---|
| `test_shared_defs_are_deep_equal_across_contracts` | **七份 schema 文件**之間同名 `$defs`（`utcTimestamp`×7、`sha256`×6、`uuid`／`locator`／`counts`／`metric` 等）deep-equal | 照跑 |
| `test_shared_defs_match_cloud_request_schema` | 五支 2.1–2.4 副本與 **change 原檔** deep-equal | `skipif`（E-12） |
| `test_shared_defs_match_the_promoted_cloud_request_schema` | 同上，但比對 `tests/contracts/` 的 **promoted 副本** | 照跑 |
| `test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals` | promoted 兩支與 change 原檔 **raw bytes**（正規化行尾後）相等 | `skipif`（E-12） |

第三、四條是這一輪新增的。原本 E-12 只綁 change 原檔，change 被 archive 之後整條
binding 會消失；改成「promoted 副本無條件比 + 原檔 skipif 比 + 兩者 byte-equal」之後，
archive 之後仍有一條活的 binding，且三者不可能靜默分歧。

Byte 比對前只正規化 `\r\n` → `\n`：行尾由 `core.autocrlf` 逐 checkout 決定，
兩側套同一個正規化。其餘（key 順序、縮排、`$comment` 措辭）全部在比對範圍內——
用 JSON deep-equal 會讓一份重新排版的副本混過去。

deep-equal 比對前遞迴移除 `$comment`。理由：`$comment` 記的是「這一份檔為什麼要留這個副本」，
本來就會逐檔不同（例如 `model_version_bundle_manifest.$defs.locator` 註明 bundle artifact
用的是攤平型 `minioObjectRef`，locator 只作為家族 canonical 形狀保留）。
其餘每一個約束關鍵字仍逐字元比對。

### `additionalProperties: false` 遞迴檢查

`test_object_schemas_close_additional_properties` 走訪**七份 schema 文件**（含 `$defs` 內部），
規則是：

> 凡是**完整的 object 定義**——宣告 `properties`、`type` 含 `"object"`、且沒有 `$ref`
> 兄弟——都必須 `additionalProperties: false`。

三類節點結構性豁免，不進白名單：

1. **partial applicator 底下的子 schema**：`if`／`then`／`else`／`not`／`contains`／
   `propertyNames`（以及它們的後代）。這些是對同一個 instance 的*部分*述詞，
   不是 object 定義；替它們關門會把外層合法的兄弟欄位一起打掉。
   例如 `$defs/resultManifest/properties/artifacts/allOf/*/contains` 只斷言
   「存在一個 `role` 等於 X 的 item」，那個 item 當然還有 ref／sha256 等欄位。
2. **有 `$ref` 兄弟的窄化節點**：關門責任在被 `$ref` 的 `$def`。
   目前只有 `lineage_alignment_report.$defs.alignmentReportJson.properties.metrics`
   底下三支 metric（`{"$ref": "#/$defs/scopedMetric", "properties": {"denominator_scope": {...}}}`）。
3. **`allOf`／`anyOf`／`oneOf` 的裸分支**（本輪新增，`_LIST_NARROWING_APPLICATORS`）：
   分支只宣告 `properties`、既沒有 object `type` 也沒有 `$ref` 兄弟時，它是第 2 類
   豁免的 list 形式——窄化的是外層那個已經關過門的定義，替它關門會打掉外層合法的
   兄弟欄位。旗標**只對直接分支生效，後代 reset**；`prefixItems` 刻意不列入，
   因為它的每個 entry 是完整的 item 定義而不是共享定義的窄化。

第 3 條是 2.5 promotion 的 finding（draft-e F-1）：cloud request schema 的
`oneOf` 兩個分支寫成裸 `{"properties": {"event_type": ..., "payload": ...}}`，
會命中下方的 drift guard。因為 schema 必須 byte-identical，修法只能在 runner 側。
選結構性豁免而不是把 `/oneOf/0`、`/oneOf/1` 寫進 `_OPEN_OBJECT_WHITELIST`：
那個 whitelist 只用 pointer 當 key、對全部 schema 文件生效，而
`model_version_bundle_manifest` 等 style A contract 也有 `/oneOf/0` 這個 pointer。

**實測驗證**：修法前後逐支比對 `(open_objects, unclassified)`——
五支 2.1–2.4 contract 與 response schema 前後皆為 `([], [])` 完全不變，
只有 request schema 從 `([], ['/oneOf/0', '/oneOf/1'])` 轉為 `([], [])`。
反向控制也做過：把一個 `oneOf` 分支改成宣告 `type: object` 又不關門，
`test_object_schemas_close_additional_properties[pipeline_job_attempt]` 仍然紅——
豁免的範圍就是「裸分支」，不會順手放過真正該關門的定義。

`_OPEN_OBJECT_WHITELIST` 這個逃生口留著但**目前是空的**：七份 schema 裡沒有任何
需要指名豁免的節點。日後要加，必須在旁邊寫下理由。
同一個測試另有一條 drift guard：宣告了 `properties` 卻既沒有 object `type`
也沒有 `$ref`、也不是裸分支的節點會直接紅（無法判定該不該關門的節點不准存在）。

### 已知 quirk：`pattern` 的 `$` 會放行單一結尾換行

Python 的 `$` 在字串結尾**或**最後一個 `\n` 之前都會 match，而 `jsonschema` 用
`re.search` 套 `pattern`。實測（jsonschema 4.26.0）：

```
Draft202012Validator(request["$defs"]["utcTimestamp"]).is_valid("2026-07-16T08:15:30Z\n")  ->  True
```

兩支 cloud schema 的每一條 `^…$` pattern 都有這個性質（`utcTimestamp`、`uuid`、
`sha256`、`publication_identity`），而 JSON string 合法地可以帶 `\n`，所以這是
從 wire 可達的。

**處置（coordinator 裁決）：不改 schema。** 這一輪的 schema 必須與 change 原檔
byte-identical，收緊 pattern（`\Z` 或 `(?!\n)$`）是契約變更，屬於 2.5 契約擁有者
而不是測試層。缺口由**語意層封口**：`parse_calendar_strict` 與
`protocol_validators` 的每一道 gate 都用 `\A…\Z` 或 `fullmatch` 絕對錨定，
所以帶結尾換行的值到不了任何 domain mutation。

行為本身在兩個方向都被釘死：`test_wire_timestamp_pattern_tolerates_one_trailing_newline`
與 `test_trailing_newline_gap_is_a_property_of_the_shipped_schema`。日後若有人收緊
schema，這兩條會一起紅並指向要同步更新的本地 pattern 副本。

> **給 3.x runtime validator 的硬要求**：只掛 JSON Schema **不足以**擋住這一類值。
> Runtime 端必須同時掛 `semantic_validators.validate_cloud_publication_scenario`
> 與 `protocol_validators` 的 timestamp／HMAC／ACK gate；只跑 schema 等於接受
> 「結尾換行的 timestamp／UUID／SHA-256」以及所有 calendar-invalid 日期。

## 3. `expectations.json` 與「確定性 leaf 規則」

`expectations.json` 逐一記錄每個 `invalid/` fixture **應該踩到哪一條規則**，
形狀是 `{"<contract>/<file>": {"keyword": ..., "instance_pointer": ...}}`
（`instance_pointer` 是 RFC 6901，root 為空字串 `""`）。
部分條目另有 `intent` 說明字串；cloud 條目另有 `schema`（`request`｜`response`）
與可選的 `must_contain` / `tie_break_note`（見下）。

沒有這張表，「invalid fixture 有錯誤」只證明*有東西*紅了，不能證明紅的是它要打的那條規則。

### 為什麼不用 `best_match`

`oneOf` discriminator 會把 body 的錯誤包進 `context`；`best_match()` 對同深度錯誤
會退回父層的 `oneOf`，指向 union 而不是真正違規的欄位。
因此 `deterministic_leaf_error()` 用下列**確定性**規則，所有 fixture 草稿也是用同一條
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

### 可選欄位 `must_contain`（本輪新增，additive）

第 2 步「丟掉 boolean-schema leaf」是為 style A 的 `{"if":…, "then":…, "else": false}`
設計的。cloud request schema 用的是**裸 `oneOf`**，不匹配分支留下的是**真的**
`const` leaf（`/event_type`、深度 1），第 2 步丟不掉；只要真正的違規也在深度 ≤1 的
`/payload`，字典序 `/event_type < /payload` 就會讓 discriminator 勝出。

處置：這些 fixture 的條目**同時**記實測 leaf（`keyword`/`instance_pointer`，
讓 `test_invalid_fixture_hits_expected_violation` 保持確定性）**與**
`must_contain`（它其實要打的那條規則）。`test_invalid_fixture_contains_declared_target`
只跑有宣告 `must_contain` 的條目，斷言那個 `{keyword, pointer}` 確實存在於 error tree，
並拒絕「`must_contain` 與實測 leaf 相同」這種沒有承重的重複宣告。

既有 182 筆條目沒有 `must_contain`，行為完全不變。目前 6 筆有：

| fixture | 實測 leaf | `must_contain` |
|---|---|---|
| `cloud.../invalid-unknown-event-type.json` | `const @ /event_type` | `enum @ /event_type` |
| `cloud.../invalid-published-payload-element-rows.json` | `const @ /event_type` | `additionalProperties @ /payload` |
| `cloud.../invalid-health-payload-carries-summary.json` | `const @ /event_type` | `additionalProperties @ /payload` |
| `cloud.../invalid-tombstone-without-record-id.json` | `const @ /event_type` | `required @ /payload` |
| `cloud.../invalid-tombstone-id-on-non-tombstone.json` | `const @ /event_type` | `not @ /payload` |
| `pipeline_job_attempt/invalid-audit-force-release-capability.json` | `const @ /body/capability` | `enum @ /body/capability` |

`test_must_contain_declarations_exist` 是 ratchet，擋住這組宣告被無聲清空。

### key 格式的既知不整齊

合併草稿時 key **逐字保留**，所以 `lineage_alignment_report` 的條目是
`<contract>/invalid/<file>`，其餘五支是 `<contract>/<file>`。
`_load_expectations()` 在讀取時把可選的 `invalid/` 區段正規化掉，並在正規化後
撞名時直接 `AssertionError`，不靜默覆蓋。`test_every_invalid_fixture_is_covered_by_expectations`
再確保 fixture 與 expectations 是雙向一一對應（224 對 224），不會有孤兒條目或未宣告的 fixture。

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
  場景、`cloud_lineage_publication` 有 3 個，證明 validator 在自洽文件上會閉嘴，
  而不是看到什麼都開槍。

分派表（`SEMANTIC_DISPATCH`）：

| contract | validator |
|---|---|
| `model_version_bundle_manifest` | `validate_bundle_scenario` |
| `lineage_alignment_report` | `validate_alignment_report` |
| `pipeline_job_attempt` | `validate_job_scenario` |
| `result_manifest` | `validate_result_publication_scenario` |
| `cloud_lineage_publication` | `validate_cloud_publication_scenario` |
| `source_bundle_ready` | 無 semantic fixture（純 intake 宣告，無跨欄位算術） |

`test_semantic_dispatch_covers_every_contract_with_semantic_fixtures` 確保日後某支
contract 長出 semantic fixture 卻忘了接 validator 時會紅。

反方向由 `test_valid_fixtures_carry_no_semantic_contradiction` 守住：五支有 validator
的 contract，**每一個 `valid/` fixture 都必須得到空清單**。`semantic/` 語料證明
validator 該開槍時會開槍，這條證明它其餘時候會閉嘴——少了它，一條寫壞成「見文件就報」
的規則仍然能讓 `semantic/` 全綠。`source_bundle_ready` 沒有 validator，
參數化時直接排除而不是 skip，所以 CI 看到 skip 就一定只代表路徑不存在。

### 兩套 code 詞彙，是刻意的

- `validate_alignment_report` 與 `validate_cloud_publication_scenario` 吐
  **UPPER_SNAKE**（`RVT_IFC_DENOMINATOR_MISMATCH`、`LOCATOR_AUTHORITY_NOT_EDGE_SITE`…）。
  前者是報表帳務診斷、後者的契約沒有任何 diagnostic wire enum 可借字，而且它把
  `validate_alignment_summary` 的六個 binding 碼**逐字轉發**——同一段算術不會出現
  第二種拼法。
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
| `pipeline_job_attempt` | 27 | 54 | 9 | 2.3 |
| `result_manifest` | 15 | 38 | 6 | 2.3 |
| `source_bundle_ready` | 2 | 13 | 0 | 2.4 |
| `cloud_lineage_publication` | 10 | 41 | 22 | 2.5 |
| **合計** | **69** | **224** | **69** | |

另有 `fixtures/protocol/` 2 個（2.6 的 HMAC golden vectors 與 ACK 分類語料），
不進 `FIXTURE_MINIMUMS`——它們不是 schema fixture，是表驅動語料。

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
| `activation_audit_entry` | `stale_or_missing_authorization_decision` | **（本輪新增，2.7）** 非 system actor 的 `promote`／`rollback` 必須指名授權它的 control-plane decision；null 代表 console 沒有 decision 或重用了 cached 的一份，`lineage-governance-console` 要求這種情形 fail closed 而不是樂觀執行 |

兩條規則的**互斥設計**值得記一筆：restart 事件在 index > 0 且 `created_new_logical_job=true`
時，兩條規則字面上都成立。實作先判 event kind，restart 走 restart 碼，
其餘才走 duplicate 碼——不然一個 restart 缺陷會同時吐兩個診斷，讀者無從判斷根因。

`stale_or_missing_authorization_decision` 為什麼進語意層而不是 schema：
`authorization_decision_ref` 對 system 自己做的 `first_activation` 合法地是 null，
規則是**條件於 actor 種類**的，`if`/`then` 要表達就得把 actor 與 transition 兩軸
交叉展開，而 audit 本來就是 append-only 的「實際發生了什麼」，schema 必須能忠實
記錄一個違約 transition。同理，`activationAuditEntry.target_result_evidence`
也**刻意不在 schema 依 transition 收緊**。

### 2.3 `result_manifest` — `validate_result_publication_scenario`

| document_type | code | 規則 |
|---|---|---|
| `result_manifest` | `manifest_published_before_artifacts` | manifest 的 `published_at` 不得早於任何 artifact 的 `published_at` |
| `result_manifest` | `alignment_summary_denominator_mismatch` | 三個 denominator 與 counts 的綁定，委派給 `validate_alignment_summary`，把它的三個 `*_DENOMINATOR_MISMATCH` 收斂成這一個 wire code |
| `result_manifest` | `result_prefix_not_attempt_scoped` | `result_prefix` 必須是 **canonical** 前綴（object-key 部分非空、恰以一個 `/` 結尾、無空／`.`／`..` segment），且最後一個 path segment 逐字等於 `attempt_id`（design.md §5：每個 attempt 用獨立 result prefix）|
| `result_publication_outcome` | `second_formal_result_for_attempt` | `prior_result_id` 非 null 時必須等於 `result_id` |
| `result_publication_outcome` | `non_idempotent_replay_reported_as_created` | 同一 result 同 digest 重放必須回報 `replay_same_digest`，不得回報 `created` |
| `result_publication_outcome` | `manifest_digest_conflict` | digest 與 prior 不同時必須回報 `conflict_different_digest` |

`result_prefix_not_attempt_scoped` 為什麼是語意層而不是 schema：
`result_prefix` 與 `attempt_id` 是兩個獨立欄位，JSON Schema 表達不了「這個字串的
末段等於另一個欄位」。它也**不是** prefix containment 檢查——`.../attempt-0007/` 對
`attempt-00070` 不算「夠接近」，逐字相等才擋得住兩個 attempt 宣告同一個 prefix、
互相 conditional-create 覆蓋對方 immutable 物件。coordinator 的 registration 層
（`PipelineResultLocationError`）用的是同一個 code；語意層先擋，語料就不會再出現
任何 runtime 都不可能收下的 manifest。反例語料
`semantic/semantic-result-prefix-not-attempt-scoped.json` 是 `valid-result-manifest-full.json`
**只改 `attempt_id` 一欄**的副本，改動即違規本身。

**canonical 前綴是規則的一部分，不是形狀細節**：tail 比較之前，object-key 部分必須
非空、恰以一個 `/` 結尾、且不含空／`.`／`..` segment；違反任一項即發同一個
`result_prefix_not_attempt_scoped`。這條與 coordinator 的 `parseMinioPrefix`
（`bim-review-coordinator/src/services/lineage/minioLocator.ts`）逐條對齊——validator
若在此放寬（例如先丟掉空 segment 再取 tail），語料就會認證一份 runtime 必然拒收的
manifest。反例語料 `semantic/semantic-result-prefix-empty-segment.json` 是
`valid-result-manifest-full.json` **只把 `results/` 與 `attempt-0007/` 之間多插一個 `/`**
的副本：schema 的 `attemptResultPrefix` pattern 仍然通過，語意層必須擋下。

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
這兩條會 skip 而不是假紅。兩條目前仍讀 change 目錄；promotion 之後改讀
`tests/contracts/` 的副本即可讓它們 archive 後照跑，但那會動到 2.4 既有測試的
語意（「與 change 的邊界」變成「與 promoted 副本的邊界」），留給下一輪一次裁決。

### 既有契約凍結

本 change 是 additive，不得改動兩支既有契約。三個測試釘死：

- `test_legacy_ifc_ready_contract_is_frozen`：`contract_version == "1.1.0"`、
  `transport.path == "/api/external/ifc-ready"`。
- `test_legacy_callback_contract_is_frozen`：`contract_version == "1.0.0"`、
  `events` 恰為 `{conversion_result_ready, conversion_failed}`。
- `test_legacy_contracts_contain_no_lineage_tokens`：兩檔全文不得出現
  `source_bundle_ready`／`lineage_result_published`／`lineage_result_health_changed`／
  `cloud-lineage-publication`。

## 6. 2.5 `cloud-lineage-publication` 覆蓋

2.5 逐字列出的每一項與它的落點：

| 2.5 要求 | schema 層 | fixture／validator |
|---|---|---|
| **ASCII charset**：`edge_site_id` 與 locator authority 共用 `[A-Za-z0-9._-]+` | `properties.edge_site_id.pattern` 與 `$defs/locator.properties.ref.pattern` 的 authority group | `invalid-edge-site-authority-character.json` |
| **四個 stable refs** | `$defs/publishedPayload.result_refs` 的 `required` ×4 ＋ `additionalProperties:false` | `invalid-missing-alignment-report-csv-ref.json`、`invalid-extra-result-ref.json`、`valid-lineage-result-published.json` |
| **唯一 `?versionId=`** | ref pattern：object key `[^?#\s]+`，query 只有一個 `\?versionId=[A-Za-z0-9._~%-]+$` | `invalid-duplicate-version-id-query.json`、`invalid-locator-without-version-id.json`、`invalid-fragment-in-object-key.json`；值是否等於 `object_version_id` 由 `semantic-locator-version-id-mismatch.json` → `LOCATOR_VERSION_ID_MISMATCH` |
| **locator authority == top-level `edge_site_id`（semantic）** | schema 表達不了 | `LOCATOR_AUTHORITY_NOT_EDGE_SITE`；`semantic-cross-site-health-locator.json`、`semantic-cross-site-published-locator.json` |
| **no-presigned** | ref pattern 的 `not: {"pattern": "[?&][Xx]-[Aa][Mm][Zz]-"}` | `invalid-presigned-health-locator.json`、`invalid-lowercase-presigned-locator.json`（大小寫都擋） |
| **no-element-rows** | 四層 `additionalProperties:false` | `invalid-published-payload-element-rows.json`（payload）、`invalid-summary-diff-id-set.json`（summary）、`invalid-extra-count-field.json`（counts）、`invalid-extra-result-ref.json`（refs） |
| **三組 metrics** | `$defs/summary.metrics` 的 `required` ×3 ＋ `additionalProperties:false` | `invalid-missing-metric-group.json`、`invalid-extra-metric-group.json`；算術由 `validate_alignment_summary` 六碼＋`semantic-ratio-rounded-instead-of-truncated.json`、`semantic-status-complete-while-partial.json` |
| **zero denominator** | `$defs/metric.allOf[0]` 的 `if(den==0) then(num=0, ratio=null, status=not_evaluable) else(...)` | `valid-zero-denominator-summary.json`、`invalid-zero-denominator-ratio-zero.json`、`invalid-nonzero-denominator-null-ratio.json` |
| **bounded warning codes** | `maxItems:64`、`uniqueItems`、`items.pattern`、`warning_code_count` 的 `maximum:64` | `valid-max-warning-codes.json`、`invalid-warning-codes-above-max-items.json`、`invalid-duplicate-warning-code.json`、`invalid-warning-code-lowercase.json`、`invalid-warning-code-count-above-max.json`；count 與 length 一致性走 `semantic-warning-code-count-mismatch.json` |
| **兩種 events** | `properties.event_type.enum` ×2 ＋ `oneOf` 兩個 payload 分支 | 四個 valid request fixture；負向 `invalid-unknown-event-type.json`、`invalid-health-payload-carries-summary.json`、`invalid-single-confirmation-missing-health.json`、`invalid-tombstone-id-on-non-tombstone.json`／`invalid-tombstone-without-record-id.json` |
| **strict `additionalProperties:false`** | envelope、payload、result_refs、summary、metrics、counts、locator、metric、successAck、errorResponse、error | `invalid-extra-envelope-member.json`、`invalid-response-extra-ack-member.json` 及上列各層；另由 `test_object_schemas_close_additional_properties` 逐節點掃過兩支 schema |
| **四欄共用 `utcTimestamp`（request/response deep-equal）pattern＋format** | 兩支 schema 的 `$defs/utcTimestamp` | `test_shared_defs_are_deep_equal_across_contracts`；負向 `invalid-lowercase-z-occurred-at.json`、`invalid-submicrosecond-health-observed-at.json`、`invalid-leap-second-health-observed-at.json`、`invalid-out-of-range-health-observed-at.json` |
| **保留四個 offset negative fixtures** | 同上 | `invalid-offset-occurred-at.json`、`invalid-offset-published-at.json`、`invalid-offset-health-observed-at.json`、`invalid-offset-ack-stored-at.json`（第四個同時證明 response schema 用同一份 `utcTimestamp`） |

`format` 只是 annotation，所以 calendar-valid 那一層（`2026-02-30T09:19:30.000Z`
pattern 過得了）補在語意層：`CALENDAR_INVALID_TIMESTAMP` ＋
`semantic-calendar-invalid-observed-at.json`。

### `validate_cloud_publication_scenario` 的發射順序

fixture 的 `expect` 依此排，`semantic-multiple-diagnostics-emission-order.json`
專門釘死 1→3→7：

1. `PUBLICATION_IDENTITY_MISMATCH`
2. `CALENDAR_INVALID_TIMESTAMP`
3. `LOCATOR_AUTHORITY_NOT_EDGE_SITE` / 4. `LOCATOR_VERSION_ID_MISMATCH`
   （逐 locator；published 依 `result_refs` 宣告順序，health 只有 `result_manifest_ref`）
5. `RESULT_MANIFEST_DIGEST_MISMATCH`
6. `validate_alignment_summary(...)` 全部（published only）
7. `WARNING_CODE_COUNT_MISMATCH`（published only）

Response 文件（successAck／errorResponse）一律回 `[]`：code↔`retryable` 是 schema 的
`if`/`then` const，ACK 與「送出的 event」是否一致是**兩份文件**的比對，
單文件 validator 說不出話。這條是必要的，因為
`test_valid_fixtures_carry_no_semantic_contradiction` 會把 validator 套在**全部**
valid fixture 上，含四個 response fixture。

### 刻意不補的三處（不在 2.5 清單上）

1. **HMAC headers 與 `X-Lineage-Signature-Timestamp`**：不在 body 裡，JSON fixture
   打不到，屬 2.6 的 transport 測試。
2. **HTTP status ↔ `error.code` 三元組**：body 只帶 code 與 `retryable`，status 是
   transport；code/retryable 的矛盾由 `invalid-retryable-deterministic-error.json`／
   `invalid-nonretryable-transient-error.json` 擋住，status 對齊在 2.6。
3. **兩處既知的耦合違規**（不是缺陷）：
   `invalid-colon-publication-identity-component.json` 同時違反 `/result_id` 與
   `/publication_identity` 兩條 pattern（結構上耦合，無法只違反一條）；
   `invalid-presigned-*-locator.json` 的 `ref` 同時踩 `pattern` 與 presign 的 `not`
   （presigned URL 本來就不是 `minio://` locator），leaf 取 `not` 是因為同 instance
   path 下 schema path `.../not` 字典序在 `.../pattern` 之前。

## 7. 2.6 wire protocol 覆蓋（`test_cloud_publication_protocol.py`）

2.1–2.5 測的是**文件**形狀，2.6 測的是把文件送過 edge／cloud 邊界的**傳輸**契約。
261 個 case，逐條對應 2.6 的子句：

| 2.6 子句 | 主要測試 |
|---|---|
| HMAC raw-body canonicalization | `test_signature_matches_the_independently_generated_golden_vector`、`test_signature_is_over_raw_bytes_not_a_reparsed_document`、`test_signature_comparison_is_constant_time` |
| canonical unsigned decimal Unix-seconds timestamp header／非 canonical 拒絕 | `test_signature_timestamp_header_validity`、`test_receiver_must_not_normalize_the_timestamp_before_verifying` |
| ±300 秒 skew | `test_default_skew_window_is_plus_minus_300_seconds`、`test_format_and_range_are_checked_before_skew` |
| header/body event match | `test_event_id_header_must_match_the_body` |
| 201/200 ACK 與 malformed/202 protocol failure | `test_ack_classification_table`、`test_only_200_and_201_can_be_delivered`、`test_a_matching_ack_for_the_wrong_event_is_never_delivered` |
| 四個 wire timestamp path 各自因 `pattern` 拒絕 offset | `test_offset_is_rejected_by_pattern_without_a_format_plugin`、`test_offset_fixtures_isolate_exactly_one_timestamp`、`test_format_annotation_is_inert_without_a_plugin` |
| 表驅動 timestamp 有效／無效 | `test_wire_timestamp_validity_table`、`test_wire_timestamp_table_agrees_with_the_shipped_schema` |
| calendar-invalid 由 semantic parser 拒絕 | `test_parse_calendar_strict_names_the_reason_it_rejected`、`test_parse_calendar_strict_rejects_rather_than_truncating_precision` |
| 九個 canonical HTTP/code/retryable 三元組 | `test_canonical_triples_are_exactly_the_nine_from_the_spec`、`test_response_schema_enumerates_exactly_the_nine_codes` |
| ≥2 個 status/code cross-swap | `test_cross_swapped_triples_are_rejected`（6 個）、`test_at_least_two_status_code_cross_swaps_are_covered` |
| pre-validation error 可不帶 `event_id`，帶則必須合法 | `test_pre_validation_error_event_id_rule`、`test_receiver_must_not_invent_an_event_id` |
| reference MySQL DDL 保持 `REFERENCE ONLY` | `test_mysql_reference_is_not_a_migration`、`test_mysql_reference_contains_no_executable_data_statements` |

四個已記錄的 2.6 判讀（不是缺陷，是需要日後有人反對時才改的取捨）：

1. **±300 秒視為 inclusive**（`abs(delta) <= 300`）。exclusive 讀法會讓文件寫死的
   預設值本身變成不可達。
2. **header/body `event_id` 逐 byte 比對**，不做 casefold。`lineage_event_identities.event_id`
   宣告 `ascii_bin`（大小寫敏感），byte-exact 是與該欄位一致的讀法。
3. **`compute_signature(secret, raw_body, timestamp_header)`** 比任務書多一個參數：
   spec 的公式簽的是 `timestamp + "\n" + body`，timestamp 是必要輸入。
   `canonical_signing_input()` 另外導出，讓串接本身可直接斷言。
4. **兩個 422 code 互換無法從 transport 偵測**（`UNSUPPORTED_SCHEMA` 與
   `PARENT_BINDING_NOT_FOUND` 共用 422，兩個三元組各自都 canonical）。
   由 `test_swapping_the_two_422_codes_is_undetectable_from_transport_alone` 記錄，
   免得被誤當成有覆蓋。

## 8. 2.7 全量 negative 對照表

`tasks.md` 2.7 逐字列出的每一個 negative case，對到證明它 fail closed 的
test／fixture。狀態：**COVERED**＝2.1–2.6 語料已有；**COVERED (new)**＝本輪補的；
**GAP**＝在 2.x 契約面表達不了，附上真正的擁有者。

| # | 2.7 requirement 原文 | covering test / fixture | 狀態 |
|---|---|---|---|
| 1 | malformed wire UUID | `cloud_lineage_publication/invalid-malformed-request-event-id.json`（request 側，本輪補）＋`invalid-error-event-id.json`（response 側）＋`test_error_with_malformed_event_id_is_rejected_by_pattern` | COVERED (new) |
| 1b | malformed ledger UUID | `lineage_alignment_report/invalid/full-lineage-uuid36-not-canonical-case.json`、`...-globalid22-illegal-character.json`、`...-globalid22-too-short.json`；event-identity ledger 那一側由 #1 與 `test_shared_identity_defs_match_the_local_copies` 綁定 | COVERED |
| 2 | 三個 valid request fixture event IDs 互異 | `test_three_valid_cloud_request_fixtures_have_distinct_event_ids`（讀 `valid-lineage-result-published/health-changed/tombstoned.json`，另驗每個都是 schema-valid UUID 且路由到 request） | COVERED (new) |
| 3 | child-mesh mapping | `lineage_alignment_report/invalid/full-lineage-prim-path-child-mesh.json`、`unmapped-child-target-missing-observed-path.json`、`unmapped-observed-path-is-element-root.json`；語意層 `OBSERVED_CHILD_PRIM_ROOT_MISMATCH` | COVERED |
| 4 | zero denominator | `lineage_alignment_report/invalid/metric-zero-denominator-non-null-ratio.json`、`metric-zero-denominator-status-partial.json`；`result_manifest/invalid-manifest-zero-denominator-with-ratio.json`、`...-complete-status.json`；`cloud.../invalid-zero-denominator-ratio-zero.json`、`invalid-nonzero-denominator-null-ratio.json`；正面 `valid-zero-denominator-summary.json`、`clean-zero-denominator.json` | COVERED |
| 5 | premature manifest | `result_manifest/semantic/semantic-manifest-before-artifacts.json`（`manifest_published_before_artifacts`）、`model_version_bundle_manifest/semantic/semantic-manifest-published-before-created.json` | COVERED |
| 5b | digest-conflict manifest | `result_manifest/semantic/semantic-same-attempt-different-digest-conflict.json`、`invalid-publication-conflict-marked-replay.json`；`model_version_bundle_manifest/semantic/semantic-validation-digest-conflict-marked-replay.json`；`cloud.../semantic-result-manifest-digest-mismatch.json` | COVERED |
| 6 | 大小寫 presigned-like locator | `cloud.../invalid-presigned-health-locator.json`＋`invalid-lowercase-presigned-locator.json`（`?X-Amz-` 與 `?x-amz-` 兩種都擋）；`model_version_bundle_manifest/invalid-manifest-presigned-locator-ref.json`、`result_manifest/invalid-manifest-presigned-ref.json`、`source_bundle_ready/invalid-manifest-ref-presigned.json` | COVERED |
| 6b | 額外 query locator | `cloud.../invalid-duplicate-version-id-query.json`、`invalid-fragment-in-object-key.json`、`invalid-locator-without-version-id.json`；`result_manifest/invalid-manifest-result-prefix-with-query.json`、`pipeline_job_attempt/invalid-attempt-result-prefix-with-query.json` | COVERED |
| 7 | cross-edge-site locator | `cloud.../semantic-cross-site-health-locator.json`、`semantic-cross-site-published-locator.json` → `LOCATOR_AUTHORITY_NOT_EDGE_SITE`；同 authority 家族的 `model_version_bundle_manifest/semantic/semantic-manifest-cross-authority-artifacts.json` | COVERED |
| 8 | element-row payload | `cloud.../invalid-published-payload-element-rows.json`（含 `must_contain: additionalProperties @ /payload`）、`invalid-summary-diff-id-set.json`；`result_manifest/invalid-manifest-embedded-usdc-base64.json` | COVERED |
| 9 | same-health-event / different-body | `test_same_health_event_id_with_a_different_body_is_a_receiver_side_conflict`（本輪補：兩個 health fixture 共用 event ID、body 不同、各自 schema-valid 且語意乾淨 → 單文件層看不到，必須由 receiver 的 event-identity ledger 以 `409`/`PUBLICATION_DIGEST_CONFLICT` 擋）＋`fixtures/protocol/ack-classification-cases.json` 的 `conflict_error_409`、`mismatched_manifest_digest_201` | COVERED (new) |
| 10 | bad HMAC | `test_signature_rejects_a_body_tampered_after_signing`、`test_signature_covers_the_timestamp_header`、`test_signature_verification_rejects_non_string_or_unprefixed_values`、`hmac-signing-vectors.json` 六組 golden vector | COVERED |
| 10b | bad ACK | `test_ack_classification_table`（29 列）、`test_a_matching_ack_for_the_wrong_event_is_never_delivered`、`cloud.../invalid-incomplete-ack.json`、`invalid-response-extra-ack-member.json` | COVERED |
| 11 | 四欄 wire timestamp 非 canonical | `test_offset_is_rejected_by_pattern_without_a_format_plugin`（`/occurred_at`、`/payload/published_at`、`/payload/observed_at`、`/stored_at` 各一）＋四個 `invalid-offset-*.json`＋`test_wire_timestamp_validity_table`（lowercase `z`、年份 0999、hour 24、minute/second 60、7 位小數） | COVERED |
| 12 | cross-job compare | `pipeline_job_attempt/semantic/semantic-compare-cross-job-fail-closed.json` → `compare_cross_job_rejected` | COVERED |
| 13 | non-AVAILABLE promotion | `pipeline_job_attempt/semantic/semantic-promote-non-selectable-target.json` → `promote_target_not_selectable`；`invalid-pointer-non-available-result.json`、`invalid-compare-non-available-side.json`、`invalid-pointer-failed-outcome.json` | COVERED |
| 14 | stale authorization decision | `pipeline_job_attempt/semantic/semantic-stale-authorization-decision-promote.json` → `stale_or_missing_authorization_decision`（本輪補規則＋fixture）；相鄰的 `semantic-second-success-does-not-auto-replace-active.json` 覆蓋 system actor 那一半 | COVERED (new) |
| 15 | unauthorized force release | **部分**：`pipeline_job_attempt/invalid/invalid-audit-force-release-capability.json`（本輪補）證明 2.x 契約唯一的 capability 詞彙是 `result.promote`／`result.rollback`／`null`，`runtime.force_release` 塞不進來，所以這條路徑無法被用來記錄或授權一次 force release；相鄰的 `invalid-audit-promote-without-capability.json` 覆蓋「無 capability 的 pointer mutation」 | GAP（見下） |
| 16 | ACK/error echo request ID 不得誤算為 request event 重用 | `test_ack_or_error_echo_is_not_a_second_request_event`（本輪補：`valid-created-ack.json`／`valid-conflict-error.json` 都 echo published event 的 `event_id`；三重證明——router 判 response、request schema 拒絕、request 側語意規則靜默）＋`test_receiver_must_not_invent_an_event_id` | COVERED (new) |

### #15 的 GAP 說明

**force release 的正向規則在 2.x 契約面沒有承載面**。`conversion-runtime-admission`
spec 要求的 `eligible_reason ∈ {stale_lease, runtime_failed, cooperative_release_failed}`、
operator 的 `runtime.force_release` capability、reason／confirmation／append-only audit、
以及「仍有 healthy active viewer/session 時一律拒絕」，都需要一個
2.1–2.5 沒有定義的 document type：`admissionRecord` 只有 `lease_id`／`blocker_codes`／
`readiness_evidence`，`activationAuditEntry` 的 capability 詞彙只涵蓋 result 指標移動。

`tasks.md` 自己把這組 negative test 指派給 **5.4**
（「實作 `runtime.force_release` capability、reason、confirmation、eligibility 與 audit；
healthy live-session 一律阻擋，並加入 unauthorized/stale-decision/live-session
negative tests」）。本輪只補了契約面能誠實表達的那一半——
**force release 不得從 activation audit 這條路進來**——其餘留給 5.4，
不在這裡捏造一個沒有 schema 支撐的 fixture 來充數。

## 9. A／B 兩種 body 窄化風格（已知差異，非缺陷）

四支帶 envelope 的 2.1–2.3 contract 用 `document_type` 窄化 `body`，但寫法有兩種，
再加上 2.5 promotion 帶進來的第三種：

| 風格 | 用在 | 寫法 |
|---|---|---|
| **A：`oneOf` ＋ discriminator 短路** | `model_version_bundle_manifest`、`pipeline_job_attempt`、`result_manifest` | 每個分支寫成 `{"if": {document_type const X}, "then": {body: {$ref …}}, "else": false}` |
| **B：`allOf` ＋ `if`/`then`** | `lineage_alignment_report` | `allOf: [{"if": {document_type const X}, "then": {body: {$ref …}}}, …]` |
| **C：裸 `oneOf`** | `cloud-lineage-publication-request-v1` | 分支寫成 `{"properties": {"event_type": {const X}, "payload": {$ref …}}}`，沒有 `else: false` |

三者語意等價（分支彼此互斥），差別只在錯誤樹形狀：

- 純 `oneOf`（沒有 `else: false`）會讓不匹配分支也對 body 產生錯誤；加上
  discriminator 短路之後，不匹配分支只留下一個 boolean-schema leaf，
  確定性 leaf 規則第 2 步會把它丟掉。
- `allOf` ＋ `if`/`then` 根本不進 `context`，錯誤直接就是 leaf。
- **C 型是 2.5 的原檔形狀，不可改（byte-identical）**。它的不匹配分支留下的是
  *真的* `const` leaf，第 2 步丟不掉——這正是 §3 `must_contain` 存在的原因，
  也是 §2 walker 第 3 類豁免存在的原因。

`deterministic_leaf_error()` 對三種形狀都給出同一個答案，224 個 invalid fixture
全部通過，所以**目前不需要統一**。若日後要統一，改的是 schema 不是測試，
且必須重跑 `test_invalid_fixture_hits_expected_violation` 全表確認 expectations 沒有位移。

另有兩處相關的 `$defs` 冗餘，同樣是刻意保留的：

- `lineage_alignment_report.$defs.metric` 逐字保留但未被引用，實際用的是
  `scopedMetric`（多一個 `denominator_scope`）。`metric` 宣告 `additionalProperties: false`，
  沒有任何 `allOf`／`$ref` 組合能加第五個成員，所以擴充只能整份重寫；
  保留原版是為了讓 `test_shared_defs_match_cloud_request_schema` 有得比。
- `$defs/locator`（object 形狀）與 `$defs/minioObjectRef`（攤平的 ref 字串）並存：
  bundle／result 的 artifact 是把 locator 欄位攤平後再加 `role`／`filename`／
  `content_type`，無法 `$ref` 一個 `additionalProperties: false` 的 object。

## 10. 加規則時要動哪裡

| 想加什麼 | 動哪裡 | 附帶要做的 |
|---|---|---|
| 新的 schema 級規則 | 對應 `tests/contracts/<contract>.json` | 加一個 `invalid/` fixture ＋ `expectations.json` 一筆 |
| 新的語意規則 | `semantic_validators.py` | 加一個 `semantic/` fixture，`expect.diagnostic_codes` 逐字列出 |
| 新的 wire/transport 規則 | `protocol_validators.py` | 在 `test_cloud_publication_protocol.py` 加表列或 case；跨 change 目錄的斷言一律掛 `skipif`（E-12） |
| 新的 fixture | `fixtures/<contract>/<kind>/` | invalid 一定要有 expectations 條目（否則 `test_every_invalid_fixture_is_covered_by_expectations` 紅） |
| 新的 cloud fixture | `fixtures/cloud_lineage_publication/<kind>/` | request 側務必保留 `schema_version` member；expectations 條目要填 `schema` 欄位 |
| 裸 `oneOf` 分支害 leaf 指到 discriminator | 不要改 leaf 規則 | 在 expectations 條目加 `must_contain` ＋ `tie_break_note` |
| 新的共用 `$def` | 逐檔複製 | deep-equal、cloud 原檔比對、promoted 副本比對三測會自動涵蓋 |
| 調整 fixture 數量門檻 | `FIXTURE_MINIMUMS` | 只准往上，往下等於自願放棄覆蓋率 |
| 修改兩支 promoted cloud schema | **先改 change 原檔**再重新 promote | 否則 `test_promoted_cloud_schemas_are_byte_equal_to_the_change_originals` 會紅；這是刻意的單一 authority |
