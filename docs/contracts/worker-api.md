# Historical Worker Artifact And Conversion API

> Phase B status: `_worker` has been removed from product runtime. This file is
> historical/test-double context only. Current IFC-ready intake is
> `bim-review-coordinator` `POST /api/external/ifc-ready`; current IFC→USDC
> conversion authority is `bim-streaming-server`, called internally by the
> coordinator. Do not use this file as a startup, smoke-test, or live demo
> dependency.

Historical base URL:

```txt
http://127.0.0.1:8005
```

Historically, `_worker` was the external file + conversion boundary for local
review flows. In the current Phase B boundary, the external IFC Worker belongs
outside this repo, the coordinator owns the IFC-ready intake, and streaming owns
the conversion result.

## Endpoints

```http
GET  /health
GET  /api/dev/ifc-sources
POST /api/dev/ifc-sources/{source_id}/conversions
POST /api/artifacts
GET  /api/artifact-groups/{artifact_group_id}
GET  /api/artifact-groups/{artifact_group_id}/readiness
POST /api/conversions
GET  /api/conversions/{conversion_job_id}
GET  /api/conversions/{conversion_job_id}/result
GET  /objects/{object_path}
```

## Dev IFC Source Selection

The historical worker demo UI read `.ifc` files from `WORKER_DEV_STORAGE_ROOT`.
By default this resolves to `../storage` from the `_worker` service directory,
which is the workspace `storage/` folder.

`GET /health` includes a source-root status:

```json
{
  "ok": true,
  "service": "_worker",
  "dev_ifc_source_root": {
    "exists": true,
    "readable": true,
    "item_count": 2
  }
}
```

`GET /api/dev/ifc-sources` returns deterministic, path-safe source choices:

```json
{
  "root": {
    "exists": true,
    "readable": true,
    "item_count": 2
  },
  "items": [
    {
      "source_id": "ifcsrc_...",
      "filename": "sample.ifc",
      "relative_path": "samples/sample.ifc",
      "size_bytes": 12345,
      "modified_at": "2026-05-07T09:00:00Z"
    }
  ]
}
```

The response never exposes absolute filesystem paths. The scanner lists regular
`.ifc` files only, ignores symlinks, and rejects stale or out-of-root source ids.

`POST /api/dev/ifc-sources/{source_id}/conversions` creates a source artifact
from the selected file and starts a conversion job:

```json
{
  "tenant_id": "tenant_demo_001",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_system": "dev_storage",
  "uploaded_by": "dev_user_001",
  "target_format": "usdc",
  "generate_mapping": true,
  "options": {
    "auto_complete": true
  }
}
```

Response:

```json
{
  "source_artifact_id": "artifact_src_xxx",
  "artifact_group_id": "ag_xxx",
  "conversion_job_id": "conv_20260507000000_xxxxxxxx",
  "status": "queued",
  "original_filename": "sample.ifc",
  "result_url": "http://127.0.0.1:8005/api/conversions/conv_.../result",
  "readiness_url": "http://127.0.0.1:8005/api/artifact-groups/ag_xxx/readiness"
}
```

## Source Artifact Intake

```json
{
  "tenant_id": "tenant_demo_001",
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_system": "revit",
  "uploaded_by": "dev_user_001",
  "filename": "source.ifc",
  "source_format": "ifc",
  "content_base64": "SVNPLTEwMzAzLTIxOwpFTkQtSVNPLTEwMzAzLTIxOwo="
}
```

Response:

```json
{
  "source_artifact_id": "artifact_src_xxx",
  "artifact_group_id": "ag_xxx",
  "sha256": "...",
  "original_filename": "source.ifc",
  "object_key": "tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/source/revit/artifact_src_xxx/original/abcd1234_source.ifc",
  "object_url": "http://127.0.0.1:8005/objects/tenants/tenant_demo_001/...",
  "status": "uploaded"
}
```

The request must include `tenant_id`, `project_id`, `model_version_id`, `source_system`, uploader identity, filename, and either `content_base64`, `content_text`, `source_url`, or `signed_upload_url`. Missing lineage is rejected so orphan artifacts are not created.

The worker preserves the raw client-provided `filename` as `original_filename`
in source artifact metadata, the source artifact index, source artifact
responses, conversion results, and the `_bim-control` conversion-result callback.
The on-disk object name still uses a sanitized filename for path safety.

## Conversion Job

```json
{
  "source_artifact_id": "artifact_src_xxx",
  "target_format": "usdc",
  "generate_mapping": true,
  "options": {
    "auto_complete": true
  }
}
```

Response:

```json
{
  "conversion_job_id": "conv_20260507000000_xxxxxxxx",
  "job_id": "conv_20260507000000_xxxxxxxx",
  "status": "queued",
  "artifact_group_id": "ag_xxx"
}
```

`GET /api/conversions/{id}` tracks `queued`, `running`, `succeeded`, and `failed`. `GET /api/conversions/{id}/result` returns `ready=false` while the job is not complete.

For IFC `target_format=usdc`, historical `_worker` used an internal converter adapter. The
adapter expected external `ifcopenshell` and `usd-core`
Python packages. Missing prerequisites, converter errors, placeholder output,
non-openable USDC, or missing required index/mapping files produce a failed job
and do not mark the artifact group ready.

Succeeded result:

```json
{
  "conversion_job_id": "conv_20260507000000_xxxxxxxx",
  "status": "succeeded",
  "ready": true,
  "artifact_group_id": "ag_xxx",
  "source_artifact_id": "artifact_src_xxx",
  "usdc_artifact_id": "artifact_usdc_20260507000000_xxxxxxxx",
  "original_filename": "source.ifc",
  "usdc_url": "http://127.0.0.1:8005/objects/tenants/.../derived/conv_.../usdc/model.usdc",
  "ifc_index_url": "http://127.0.0.1:8005/objects/tenants/.../ifc_index.json",
  "usd_index_url": "http://127.0.0.1:8005/objects/tenants/.../usd_index.json",
  "mapping_url": "http://127.0.0.1:8005/objects/tenants/.../element_mapping.json",
  "metadata_url": "http://127.0.0.1:8005/objects/tenants/.../metadata.json",
  "converter": {
    "name": "ifcopenshell-openusd",
    "ifcopenshell_version": "0.8.5",
    "usd_core_version": "26.5",
    "external_prerequisite": true
  },
  "quality_metrics": {
    "duration_seconds": 189.15,
    "source_ifc_element_count": 7362,
    "usd_prim_count": 6949,
    "mapped_count": 6998,
    "unmapped_count": 364,
    "coverage_ratio": 0.950557,
    "threshold_status": "measure_only",
    "minimum_coverage_baseline_locked": false,
    "hard_quality_gates": {
      "usdc_openable": true,
      "has_renderable_prims": true,
      "placeholder_output": false
    }
  },
  "lineage": {
    "source_artifact_id": "artifact_src_xxx",
    "source_object_key": "tenants/...",
    "derived_object_prefix": "tenants/.../derived/conv_.../usdc"
  }
}
```

Failed result:

```json
{
  "conversion_job_id": "conv_20260507000000_xxxxxxxx",
  "status": "failed",
  "ready": false,
  "artifact_group_id": "ag_xxx",
  "source_artifact_id": "artifact_src_xxx",
  "usdc_url": null,
  "ifc_index_url": null,
  "usd_index_url": null,
  "mapping_url": null,
  "metadata_url": null,
  "error": {
    "code": "ConversionAdapterUnavailable",
    "message": "IfcOpenShell is unavailable. Install ifcopenshell to run real IFC conversion."
  }
}
```

Mapping entries support one IFC GUID to many USD prim paths:

```json
{
  "ifc_guid": "1eWqc$0zjELO5mD9AONs0i",
  "ifc_class": "IfcSite",
  "primary_usd_prim_path": "/World/IfcSite_1eWqc_0zjELO5mD9AONs0i",
  "usd_prim_paths": [
    "/World/IfcSite_1eWqc_0zjELO5mD9AONs0i",
    "/World/IfcSite_1eWqc_0zjELO5mD9AONs0i_2"
  ],
  "mapping_method": "ifcopenshell_geometry_guid_to_usd_mesh",
  "mapping_confidence": 0.95
}
```

## Object Layout

```txt
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/source/{source_system}/{source_artifact_id}/original/{sha8}_{filename}
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/source/{source_system}/{source_artifact_id}/metadata.json
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/derived/{conversion_job_id}/usdc/model.usdc
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/derived/{conversion_job_id}/usdc/ifc_index.json
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/derived/{conversion_job_id}/usdc/usd_index.json
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/derived/{conversion_job_id}/usdc/element_mapping.json
tenants/{tenant_id}/projects/{project_id}/versions/{model_version_id}/artifact-groups/{artifact_group_id}/derived/{conversion_job_id}/usdc/metadata.json
```

## Boundary Notes

- `_worker` no longer owns current runtime file bytes, object layout, conversion jobs, or conversion lineage.
- No current caller should depend on `_worker` or `_bim-control` as local runtime services.
- Current demo callers use coordinator `:8004`, streaming conversion `:49101`, WebRTC `:49100`, and viewer `:5173`.
