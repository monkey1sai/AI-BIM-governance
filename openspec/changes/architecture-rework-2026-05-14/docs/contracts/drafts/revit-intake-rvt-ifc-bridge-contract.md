# Draft Contract: Revit intake → RVT→IFC bridge

## Owner boundaries

```txt
_bim-control = fake Revit/RVT intake facade
_worker      = RVT→IFC export bridge
```

## `_bim-control` endpoint

```http
POST /api/revit-intake/rvt-uploads
```

Request:

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "filename": "model.rvt",
  "source_reference": "file://storage/project_demo_001/version_demo_001/model.rvt",
  "idempotency_key": "idem_project_demo_001_version_demo_001_model_rvt"
}
```

Response:

```json
{
  "source_artifact_id": "artifact_rvt_demo_001",
  "status": "accepted",
  "event_id": "evt_rvt_20260514_001",
  "correlation_id": "corr_20260514_001"
}
```

## `_bim-control` → `_worker` event

```json
{
  "event_type": "rvt_uploaded",
  "event_id": "evt_rvt_20260514_001",
  "correlation_id": "corr_20260514_001",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact": {
    "artifact_id": "artifact_rvt_demo_001",
    "format": "rvt",
    "filename": "model.rvt",
    "url": "file://storage/project_demo_001/version_demo_001/model.rvt"
  },
  "requested_outputs": ["ifc"]
}
```

## `_worker` export result

Success:

```json
{
  "export_job_id": "rvt_ifc_20260514_001",
  "status": "ifc_ready",
  "export_mode": "real_revit_export",
  "correlation_id": "corr_20260514_001",
  "ifc_artifact": {
    "artifact_id": "artifact_ifc_demo_001",
    "format": "ifc",
    "filename": "model.ifc",
    "url": "http://127.0.0.1:8005/objects/project_demo_001/version_demo_001/model.ifc"
  }
}
```

Blocked:

```json
{
  "export_job_id": "rvt_ifc_20260514_001",
  "status": "blocked",
  "blocker": {
    "code": "REVIT_RUNTIME_UNAVAILABLE",
    "message": "Revit runtime or license is unavailable; enable fake fixture mode or run on licensed host."
  }
}
```
