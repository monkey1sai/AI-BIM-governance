# Design — issue-bcf-integrity

## Context

對抗驗證對 Issues-DB + BCF 匯出做強確認，鎖定 11 個資料完整性 finding（ISS-001~004、BCFUSD-1、bcf-002/003/005）。共同主題：**版本溯源綁定**、**並發/重複安全**、**對外誠實 provenance**。本 change 在不改公開端點簽章、不新增生產依賴的前提下，以 SQLite 交易語意與最小驗證收斂這些 finding。

## Decisions

### D1. transition 並發安全用 `BEGIN IMMEDIATE` + 條件式 UPDATE（ISS-003）

舊版「先 `get_issue` 讀 status，再以 `WHERE id=?` UPDATE」是 TOCTOU：兩個並發 transition 各自讀到同一 `open`，都通過 `_ALLOWED` 檢查，寫出兩筆互相矛盾的 transition（resolved + rejected）。

改法：單一連線 `isolation_level=None` 自控交易，`BEGIN IMMEDIATE` 立即取得 write lock 序列化並發者；條件式 `UPDATE ... WHERE id=? AND status=?` 用「讀到的 frm」當守衛，`rowcount==0` 代表狀態已被他人改動，回 `TransitionError("concurrent modification")`。`busy_timeout=5000` 讓等鎖者等而非立即失敗。

替代方案（樂觀鎖版本欄、應用層 mutex）被否決：前者要改 schema，後者在多進程不成立；SQLite write lock 是最小且正確的序列化點。

### D2. 批次建 issue 走單一交易 + 來源冪等（ISS-002 / ISS-004）

新增 `create_issues_batch`：整批包在一個 `BEGIN IMMEDIATE` 內，任一筆失敗 `ROLLBACK`（全有或全無，ISS-004）。每筆若帶 `source_ref`，先查 `(source_type, source_ref)` 是否已存在，存在則 `skipped += 1` 跳過（ISS-002）。

不改既有 `create_issue`：它仍供單筆 manual 建立（無冪等需求）。`from-rule-run` / `from-diff` 改組 dict list 呼叫 batch，回傳新增 `skipped` 欄位，呼叫端契約向後相容（多一個欄位）。

冪等以 in-transaction `SELECT` 判斷而非 DB UNIQUE constraint：避免回溯改 schema 與既有資料；同一交易內序列檢查對單一寫者足夠。

### D3. diff issue 綁 target 版本（ISS-001 / BCFUSD-1）

diff item 代表 **target 模型**相對 base 的變更，故 issue 的 `model_version_id` 綁 `diff_row["target_model_version_id"]`。`from-diff` 先 `get_diff` 取出該欄再傳入 batch。誠實鐵律：缺版本綁定會讓 BCF 匯出 comment 與 diff-impact 統計失去可信溯源。

### D4. BCF IfcGuid 22 字元過濾（bcf-002）

BCF 2.1 XSD 的 `IfcGuid` 是 22 字元 base64-IFC 編碼（字元集 `0-9 A-Z a-z _ $`）。`build_bcfzip` 在既有「kind/空 guid」過濾後，再以 `_IFC_GUID_RE = ^[0-9A-Za-z_$]{22}$` 過濾；不符者 `continue`，避免產出無法被其他 BIM 工具載入的非法 `.bcfzip`。回傳簽章 `(bytes, int)` 不變，`int` 仍為實際匯出 topic 數。

### D5. naive 時間視為 UTC + 缺值不輸出 None（bcf-003 / bcf-005）

- `_iso`：`fromisoformat` 後若 `tzinfo is None`，`replace(tzinfo=utc)` 再 `astimezone(utc)`，避免吃系統本地偏移（bcf-003）。既有 `+00:00` 輸入行為不變。
- `_disp(value)`：`None`/`""` → `"unbound"`，否則 `str(value)`。用於 comment 的 `model_version`/`ifc_guid`/`source` 內插（bcf-005）。值有設時原樣回傳，故既有測試 assert 的 `model_version=mvB`、`ifc_guid=1aB2cD3eF4gH5iJ6kL7mN8` 仍相容。

## Risks / Trade-offs

- `BEGIN IMMEDIATE` 在高並發下會讓後到者等鎖（`busy_timeout=5000`），極端情況可能 timeout；對治理 issue 寫入量級可接受。
- 冪等靠 `(source_type, source_ref)`，依賴來源提供穩定 ref（rule_result / diff_item 皆有 `id`）；manual issue 無 ref 不受冪等約束（符合預期）。

## Migration

無 schema 變更、無資料遷移。API 回傳多 `skipped` 欄位為加法相容。
