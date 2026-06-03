## Why

對抗驗證對 Issues-DB 與 BCF 匯出做強確認，找出 11 個資料完整性／誠實 provenance finding：

- **ISS-001 / BCFUSD-1**：`from-diff` 建 issue 時漏綁 `model_version_id`，使 diff issue 失去版本溯源，後續 BCF 匯出與 diff-impact 統計斷裂。
- **ISS-002**：rule-run / diff 來源批次建 issue 無冪等保護，重複呼叫會灌出重複 issue。
- **ISS-003**：`transition` 為「先讀後寫」兩段式，並發轉換存在 TOCTOU race，可寫出自相矛盾的雙 transition。
- **ISS-004**：批次建 issue 非單一交易，部分失敗會留下半套資料。
- **bcf-002**：BCF viewpoint 的 `IfcGuid` 未驗證 22 字元 base64-IFC 格式，可產出違反 BCF 2.1 XSD 的 `.bcfzip`。
- **bcf-003**：`_iso` 對 naive 時間戳套用系統本地時區偏移，匯出時間漂移。
- **bcf-005**：缺值（如未綁版本）時 comment 直接內插 Python `None` 字面，違反誠實 provenance。

誠實鐵律：issue 必綁 `model_version_id`，缺版本綁定會讓跨工具溯源不可信；對外 BCF 文字不得洩漏 Python 內部 `None`。

## What Changes

- `governance-service/issues/store.py`：
  - `transition` 改為單一連線 + `BEGIN IMMEDIATE` + 條件式 UPDATE（`WHERE id=? AND status=?`，`rowcount==0` 視為並發衝突），序列化並發轉換（ISS-003）。
  - 新增 `create_issues_batch`：單一交易（全有或全無，ISS-004）+ 來源冪等（同 `source_type`/`source_ref` 不重複建，ISS-002）。
- `governance-service/issues/api.py`：
  - `from-diff` 讀出 diff_row 後綁 `target_model_version_id`（ISS-001/BCFUSD-1）。
  - `from-rule-run` / `from-diff` 改用 `create_issues_batch`，回傳新增 `skipped`。
- `governance-service/bcf/bcf_writer.py`：
  - `_iso`：naive 時間戳視為 UTC（bcf-003）。
  - 新增 `_disp`：缺值輸出 `unbound` 而非 `None`（bcf-005）。
  - `build_bcfzip`：以 `_IFC_GUID_RE`（22 字元）過濾非法 IfcGuid（bcf-002）。
- 測試：`tests/test_issues.py` + `tests/test_bcf.py` 新增 7 個覆蓋上述 finding 的測試。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `governance-issue-tracking`：issue 必綁 model_version（diff issue 綁 target 版本）、來源冪等、批次 atomic、transition 並發安全。
- `governance-bcf-export`：IfcGuid 22 字元合規、naive 時間視為 UTC、缺值不輸出 None 字面。

## Impact

- Owner repo / folder：
  - `governance-service/issues/store.py`、`governance-service/issues/api.py`、`governance-service/bcf/bcf_writer.py`、`governance-service/tests/test_issues.py`、`governance-service/tests/test_bcf.py`。
- API / data shape：
  - `POST /api/issues/from-rule-run/{run_id}` 與 `POST /api/issues/from-diff/{diff_id}` 回傳新增 `skipped` 欄位；`created`/`issue_ids` 語意不變（同來源重複呼叫不再重複建）。
  - diff issue 的 `model_version_id` 改為 diff 的 `target_model_version_id`（先前為 null）。
- Dependencies：
  - **不新增生產依賴**（純 stdlib `re` + SQLite 交易語意）。純 CPU。
- Non-goals：
  - 不改 `create_issue`（仍供單筆 manual 建立）；不改 BCF 匯出端點簽章；不做 BCF 匯入。
