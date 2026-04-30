# _bim-control

Local fake BIM data authority for conversion result metadata.

## Demo 故事位置

| | |
|---|---|
| **步驟** | ⑤ 紀錄回寫 (Record) |
| **Demo URL** | <http://127.0.0.1:8001> |
| **客戶看到的內容** | 主資料庫已連線、目前示範專案 / 版本、已登錄成果檔數、最近的審查標註紀錄 |
| **設計守則** | [`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](../docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md) |

## Run

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

## API

```txt
GET  /health
GET  /ui
POST /api/dev/reset-seed
GET  /api/projects
GET  /api/projects/{project_id}
GET  /api/projects/{project_id}/versions
GET  /api/model-versions/{model_version_id}
GET  /api/model-versions/{model_version_id}/artifacts
POST /api/model-versions/{model_version_id}/conversion-result
GET  /api/model-versions/{model_version_id}/conversion-result
GET  /api/model-versions/{model_version_id}/review-issues
POST /api/model-versions/{model_version_id}/review-issues
GET  /api/review-sessions/{session_id}/annotations
POST /api/review-sessions/{session_id}/annotations
```

Conversion results are stored as JSON under:

```txt
data/conversion_results
```

`GET /ui` serves a browser demo console with default `project_demo_001` and `version_demo_001` values.
