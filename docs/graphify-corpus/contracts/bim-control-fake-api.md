# Fake BIM Control API

Base URL:

```txt
http://127.0.0.1:8001
```

`_bim-control` is the fake BIM data authority for local development. It stores metadata, not model file bytes.

## Endpoints

```http
GET  /health
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

## Seed Records

```txt
project_demo_001
version_demo_001
artifact_ifc_demo_001
artifact_usdc_demo_001
ISSUE-DEMO-001
```

Artifact `status` is `ready` after conversion posts a succeeded conversion result, otherwise it may be `missing`.
