# Draft Contract: bim-streaming-server IFC→USDC conversion authority

## Owner boundary

```txt
bim-streaming-server = conversion API + job store + result authority + headless converter boundary
_worker              = upstream IFC provider only
_bim-control         = metadata authority / callback target
```

## Create conversion job

```http
POST /api/conversions/ifc-to-usdc
```

Request:

```json
{
  "event_type": "ifc_ready",
  "event_id": "evt_ifc_20260514_001",
  "correlation_id": "corr_20260514_001",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_rvt_artifact_id": "artifact_rvt_demo_001",
  "ifc_artifact": {
    "artifact_id": "artifact_ifc_demo_001",
    "format": "ifc",
    "filename": "model.ifc",
    "url": "http://127.0.0.1:8005/objects/project_demo_001/version_demo_001/model.ifc"
  },
  "requested_outputs": ["usdc", "element_mapping", "entity_index", "quality_metrics"],
  "options": {
    "force": false,
    "allow_placeholder_ready": false,
    "allow_fake_mapping": false
  }
}
```

Response:

```json
{
  "conversion_job_id": "conv_stream_20260514_001",
  "authority": "bim-streaming-server",
  "status": "queued",
  "stage": "queued",
  "correlation_id": "corr_20260514_001"
}
```

## Get status

```http
GET /api/conversions/{conversion_job_id}
```

```json
{
  "conversion_job_id": "conv_stream_20260514_001",
  "authority": "bim-streaming-server",
  "status": "running",
  "stage": "converting_ifc_to_usdc",
  "progress": {
    "current": 42,
    "total": 100,
    "message": "Running headless converter"
  }
}
```

## Get result

```http
GET /api/conversions/{conversion_job_id}/result
```

```json
{
  "conversion_job_id": "conv_stream_20260514_001",
  "authority": "bim-streaming-server",
  "status": "succeeded",
  "derived_artifacts": {
    "usdc": { "artifact_id": "artifact_usdc_demo_001", "url": "http://127.0.0.1:49100/artifacts/model.usdc" },
    "element_mapping": { "artifact_id": "artifact_mapping_demo_001", "url": "http://127.0.0.1:49100/artifacts/element_mapping.json" },
    "entity_index": { "artifact_id": "artifact_entity_index_demo_001", "url": "http://127.0.0.1:49100/artifacts/entity_index.json" }
  },
  "quality_metrics_summary": {
    "source_ifc_entity_count": 1604773,
    "mapped_count": 1604771,
    "unmapped_count": 2,
    "coverage_ratio": 0.9999987537178155,
    "coverage_status": "warn",
    "materialization_strategy": "sidecar",
    "sidecar_carrier_count": 1597773,
    "minimum_coverage_baseline_locked": false
  }
}
```
