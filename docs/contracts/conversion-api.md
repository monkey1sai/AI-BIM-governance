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

`usd_index.json.prims[*]` may include conversion-service enrichment when the Kit inspector did not provide semantic metadata:

```json
{
  "path": "/model/.../IFCWALL/tn__115cm551956_...",
  "ifc_class": "IfcWall",
  "identifier_candidates": [
    { "source": "path", "key": "revit_element_id", "value": "551956" }
  ]
}
```

`element_mapping.json.items[*].mapping_method` values are conservative. `path_revit_element_id` is valid only when `(ifc_class, revit_element_id)` is unique in both IFC and USD indexes:

```json
{
  "ifc_guid": "19nzyxtx5CXwVzdF_4phxj",
  "ifc_class": "IfcColumn",
  "revit_element_id": "401627",
  "usd_prim_path": "/model/.../IFCCOLUMN/tn__75x120cm401627_...",
  "mapping_method": "path_revit_element_id",
  "mapping_confidence": 0.7
}
```

Fake mappings must use `mapping_method="fake_for_smoke_test"`, low confidence, and must not be accepted as mapping correctness evidence.

The conversion service posts the result to `_bim-control` so the coordinator and web viewer can discover the ready USDC artifact.
