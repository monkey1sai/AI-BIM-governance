# CP9a：手動周邊量體的資料與來源身分

本契約承接 [V1／V2 決策](cfd-v1-context-decision-2026-10-02.md)。CP9a 提供 machine contract、canonical 身分與無求解驗證；CP9b 的預覽／共同幾何／估算尚未接線，所以含 `context` 的求解會回 `503 context_not_supported`，不建立或重播 run。沒有 `context` 的舊請求保留原流程；不把舊 run 自動標成「已驗證無周邊基準」。

## 資料與座標

正本為 [cfd-context-v1.schema.json](../../tests/contracts/cfd-context-v1.schema.json)，內嵌於 `cfd-run-request/v1` 的 optional `context`。Draft 驗證可省略 `canonical_sha256`，提交 run 時則必填。未知欄位一律拒絕。

| 欄位 | 定義與界限 |
|---|---|
| `scenario_id`、`revision` | ASCII `[A-Za-z0-9._:-]` ID（1–64 字元），版本整數 1–2147483647。修改幾何、來源或註記應建立新版本；CP9a 不提供持久化版本註冊庫 |
| `source` | `conversion_job_id` 與精確 `model_usdc_sha256`。巢狀 hash 是使用者期望的來源，必須與 conversion 權威回覆一致，不能覆寫 run 的權威來源 |
| `frame` | `space=model`、`units=m`、`up_axis=Y/Z`、`north_reference=project_north`；不是 GIS 或已旋轉至 solver 的座標 |
| `masses` | 0–50 個手動實心方塊；ID 唯一。空清單只代表明確空情境，不代表現況或周邊涵蓋充分 |
| `position_m` | XYZ 的底面中心，單位 m，各分量有限且 ±10⁹ 以內；up 分量就是底部高程 |
| `dimensions_m` | `[長, 寬, 高]`，每項有限、>0 且 ≤10⁶ m。Z-up 的未旋轉長／寬沿 X／Y；Y-up 沿 X／Z；高沿正 up 軸 |
| `rotation_degrees` | 0≤角度<360，繞正 up 軸的右手旋轉。0° 長邊沿正 X；不改北向或來風的既有語意 |
| `provenance` | `kind=measured/drawing/client_supplied/estimated` 與 `note`。註記原文需 1–500 Unicode scalar；拒絕空白、控制字元與孤立 surrogate；逐字保存，保留估計標示 |

輸入界限是軟體資料界限，不能當成物理充分性或可執行成本證明。Schema 驗證形狀與數值界限；runtime 另驗唯一 ID、有限值、註記、canonical hash 和來源權威。

CP9a 的 conversion＋USDC hash 識別主模型的精確轉換版本。既有業務模型版本／session 關聯不由 draft 自行宣告；CP9b 的提交與結果 metadata 仍須保存該關聯、計算幾何 hash 和 run ID。此處尚未建立計算結果。

## Canonical v1 bytes

1. 僅對通過驗證的資料計算；不包含 `canonical_sha256` 自身。欄位名稱與物件 key 順序不進 bytes。
2. `masses` 依 ASCII `id` 遞增排序；註記不做 Unicode normalization，保留原始字碼及前後空白。這可避免不同 runtime 的 Unicode 資料版本改变 hash；外觀相同但字碼不同的註記視為不同來源。所有數值維持 IEEE754 binary64，不做幾何四捨五入；負零正規化為正零。
3. 數值寫成 big-endian 8-byte binary64 的 16 位小寫 hex；註記寫成逐字 UTF-8 bytes 的小寫 hex。`revision` 另用十進位整数字串。
4. 使用以下固定 array 結構，compact JSON（無空白，只有 ASCII）轉 UTF-8，再算 SHA-256 小寫 hex：

```text
[schema, scenario_id, revision_decimal_string, conversion_job_id, model_usdc_sha256,
 [space, units, up_axis, north_reference],
 [[mass_id, [x_hex,y_hex,z_hex], [length_hex,width_hex,height_hex], rotation_hex,
   provenance_kind, note_utf8_hex], ...]]
```

[固定向量](../../tests/contracts/fixtures/cfd-context-canonical-v1.json) 的 SHA 為 `3779668a996f18787cf763d4cc8148a302a273d5e4993440d35dd4980ae33c33`。TS／Python 共用向量與負向案例，另有 U+1E5EE／U+0323 跨 Unicode 版本回歸；key／清單排序、負零不改身分，小數、來源、版本及註記字碼變更會改身分。

## 無求解驗證 API

`POST /api/cfd/contexts/validate` 採現有 CFD operator guard、enabled gate 及 `Cache-Control: no-store`；body 是 draft 本身。成功回：

```json
{"schema":"cfd-context-validation/v1","validation_scope":"source_and_context_identity","context":{"schema":"cfd-context/v1","...":"normalized fields","canonical_sha256":"64 lowercase hex"}}
```

`context` 完整格式以 schema 為準，以上省略號僅為說明。服務讀取 ready conversion 的 hash，回正規化且排序的資料；不存 ledger、不估網格、不啟動 preprocessing／求解。200 只證明資料與來源身分，**不證明 up axis、地面高程、碰撞、通道、實際量體、成本或物理精度已驗證**。

| HTTP／error_code | 意義 |
|---|---|
| 400 `invalid_request` | shape、ID、界限、來源註記等輸入不合法 |
| 400 `context_hash_mismatch` | draft 提供的 hash 不符合內容 |
| 404 `conversion_not_found` | 主模型 conversion 不存在 |
| 409 `source_not_ready`／`source_mismatch` | conversion 未 ready、權威 checksum 缺失或 draft checksum 不符 |
| 502 `cfd_upstream_unavailable` | conversion 權威不可用；不作身分通過 |
| 503 `cfd_disabled` | 現有 CFD gate 關閉 |
| 503 `context_not_supported` | 僅對求解提交：共同幾何尚未支援，排程前拒絕，含空情境也不回播舊結果 |

Streaming 的內部求解入口也核對同一 canonical hash／source，並在 idempotency replay、估算、worker preflight、持久化與 enqueue 前拒絕 context。內部 malformed hash 回 400 `invalid_request`。現有 estimate 契約仍拒絕未知 `context`；CP9b 才擴充共同幾何與估算，不能先沿用單棟估算。

## 後續切片與驗收邊界

CP9a：schema／跨服務來源身分／負向測試／正常交付／181 無求解 API 與既有 viewer 回歸。CP9b：真實模型 frame 核對、已提交／草稿預覽、獨立周邊計算幾何與共同域估算。CP9c：固定區域、同條件比較、共用色階。CP9d：先定實驗與新求解預算，再做數值可信度檢查。CP10 整體留 V2。

本契約不更改 credentials、環境變數、部署流程、排程、Webhook 或 migration。回滾以正常 revert PR 撤回 CP9a 提交及生成物，再依既有 canonical 部署；因本刀沒有 context run 或持久化情境，不需資料遷移。
