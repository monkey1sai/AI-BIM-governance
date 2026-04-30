# _bim-control

Local fake BIM data authority for conversion result metadata.

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
