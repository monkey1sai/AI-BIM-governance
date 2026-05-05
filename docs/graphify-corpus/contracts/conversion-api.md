# IFC To USDC Conversion API

Base URL:

```txt
http://127.0.0.1:8003
```

Naming compatibility:

```txt
_conversion-server is treated as an alias name for _conversion-service.
Do not duplicate service code; point CONVERSION_API_BASE or local runbooks at the single _conversion-service instance.
```

## Endpoints

```http
GET  /health
POST /api/conversions
GET  /api/conversions/{job_id}
GET  /api/conversions/{job_id}/result
```

## Create Conversion

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "source_url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc",
  "target_format": "usdc",
  "options": {
    "force": true,
    "generate_mapping": true,
    "allow_fake_mapping": false
  }
}
```

Successful jobs publish these outputs under `_s3_storage/static/projects/{project_id}/versions/{model_version_id}/`:

```txt
source.ifc
model.usdc
ifc_index.json
usd_index.json
element_mapping.json
```

The conversion service posts the result to `_bim-control` so the coordinator and web viewer can discover the ready USDC artifact.
