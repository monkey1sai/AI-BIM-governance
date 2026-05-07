# Worker Artifact And Conversion API

Base URL:

```txt
http://127.0.0.1:8005
```

`_worker` is the external file + conversion boundary for new flows. During this rollout it is a facade over local object layout and compatibility behavior; `_s3_storage` and `_conversion-service` remain runnable compatibility paths for the existing demo.

## Endpoints

```http
GET  /health
POST /api/artifacts
GET  /api/artifact-groups/{artifact_group_id}
GET  /api/artifact-groups/{artifact_group_id}/readiness
POST /api/conversions
GET  /api/conversions/{conversion_job_id}
GET  /api/conversions/{conversion_job_id}/result
GET  /objects/{object_path}
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
  "object_key": "tenants/tenant_demo_001/projects/project_demo_001/versions/version_demo_001/artifact-groups/ag_xxx/source/revit/artifact_src_xxx/original/abcd1234_source.ifc",
  "object_url": "http://127.0.0.1:8005/objects/tenants/tenant_demo_001/...",
  "status": "uploaded"
}
```

The request must include `tenant_id`, `project_id`, `model_version_id`, `source_system`, uploader identity, filename, and either `content_base64`, `content_text`, `source_url`, or `signed_upload_url`. Missing lineage is rejected so orphan artifacts are not created.

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

Succeeded result:

```json
{
  "conversion_job_id": "conv_20260507000000_xxxxxxxx",
  "status": "succeeded",
  "artifact_group_id": "ag_xxx",
  "source_artifact_id": "artifact_src_xxx",
  "usdc_artifact_id": "artifact_usdc_20260507000000_xxxxxxxx",
  "usdc_url": "http://127.0.0.1:8005/objects/tenants/.../derived/conv_.../usdc/model.usdc",
  "ifc_index_url": "http://127.0.0.1:8005/objects/tenants/.../ifc_index.json",
  "usd_index_url": "http://127.0.0.1:8005/objects/tenants/.../usd_index.json",
  "mapping_url": "http://127.0.0.1:8005/objects/tenants/.../element_mapping.json",
  "metadata_url": "http://127.0.0.1:8005/objects/tenants/.../metadata.json",
  "lineage": {
    "source_artifact_id": "artifact_src_xxx",
    "source_object_key": "tenants/...",
    "derived_object_prefix": "tenants/.../derived/conv_.../usdc"
  }
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

- `_worker` owns file bytes, worker object layout, conversion jobs, and conversion lineage.
- `_worker` reports conversion metadata to `_bim-control`; it does not own project, model version, issue, annotation, or review intent authority.
- `_conversion-service` remains a compatibility API on port `8003`; new callers should prefer `_worker` on port `8005`.
