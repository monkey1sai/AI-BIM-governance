## Why

A1 治理產出的 issue 需要能交給其他 BIM 工具（Revit / Navisworks / Solibri / BIMcollab 等）追蹤。**BCF（BIM Collaboration Format）** 是 buildingSMART 的開放標準，正是跨工具 issue 交換的業界共通格式。本 change 讓 `governance-service` 把正式 issue 匯出為 BCF 2.1 `.bcfzip`，使治理結果可離開本平台、進入客戶既有協作流程。

授權考量：`ifctester` 附帶的 `bcf-client` 為 **GPLv3**，直接 import 會把 copyleft 義務傳染到此專有服務。BCF 本身是開放 XML 標準，故本 change 以 Python stdlib（`zipfile` + `xml.etree`）自行 author markup/viewpoint，**不依賴 `bcf-client`**，避免授權污染。

## What Changes

- `governance-service/bcf/bcf_writer.py`：純 stdlib 產生 BCF 2.1 `.bcfzip`（`bcf.version` + 每 topic 的 `markup.bcf` + `viewpoint.bcfv`）。
- `governance-service/bcf/api.py`：`GET /api/bcf/export`（可選 `model_version_id` / `status` 過濾）→ 串流 `.bcfzip`；無正式 issue 時誠實回 404。
- `app.py` 掛載 bcf router；rule-run 的 `?fmt=bcf` 由 501 改為 400 並導引正確流程（先 from-rule-run 建 issue 再匯出）。
- coordinator：`GET /api/governance/bcf/export` 二進位透傳。
- 前端 Issue Center：「匯出 BCF 2.1」按鈕（fetch → blob 下載；無正式 issue 時顯示 404 誠實訊息）。

## Capabilities

### New Capabilities

- `governance-bcf-export`：把正式 issue 匯出為 buildingSMART BCF 2.1 `.bcfzip`。

### Modified Capabilities

- None.

## Impact

- Owner repo / folder:
  - `governance-service/bcf/`（writer + api + __init__）、`app.py`（掛載 + fmt=bcf 訊息）、`tests/test_bcf.py`。
  - `bim-review-coordinator/src/routes/governanceProxy.ts`（bcf 二進位透傳）。
  - `web-viewer-sample/src/console/`（governanceClient `bcfExportUrl` + Issue Center 匯出按鈕）。
- API / data shape:
  - 新增 `GET /api/bcf/export`（governance-service）與 `GET /api/governance/bcf/export`（coordinator）；回 `application/octet-stream`（`.bcfzip`）。
- Dependencies:
  - **不新增生產依賴**（刻意以 stdlib 自寫，避免 `bcf-client` GPLv3 污染）。純 CPU。
- BCF 政策對齊（`docs/.../BCF結合USD開發原則.md`）：
  - rule 3：viewpoint 的 `Component` 以 `IfcGuid`（IFC GlobalId）定位。
  - rule 4：comment 帶 `model_version`，issue 綁版本。
  - rule 10：只匯出 `kind=issue` 且有 `ifc_guid` 者；annotation / 無 guid 不視為正式 BCF issue。
- Non-goals:
  - 不做 BCF **匯入**（只匯出）；不產生 PNG snapshot viewpoint（僅 component selection）；不依賴 GPLv3 bcf-client。
