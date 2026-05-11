# _worker

Local worker facade for dev IFC source selection, source artifact intake,
conversion jobs, versioned object layout, object URLs, and conversion lineage.

## Run

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\_worker
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005
```

## API

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
GET  /objects/{path}
```

`GET /api/dev/ifc-sources` lists regular `.ifc` files under `WORKER_DEV_STORAGE_ROOT` (default: repo `storage/`) without exposing absolute paths.

`POST /api/dev/ifc-sources/{source_id}/conversions` reads the selected IFC, creates a source artifact, starts a conversion job, and returns source/job/readiness identifiers for the demo UI.

`POST /api/artifacts` accepts either `content_base64`, `content_text`, `source_url`, or `signed_upload_url` plus lineage fields. File bytes are stored under `data/objects/tenants/...`.

Source artifact responses, source metadata, source index entries, and completed conversion results include `original_filename`, preserving the raw uploaded or selected IFC filename while keeping the on-disk object name sanitized for path safety.

`POST /api/conversions` creates a queued job. With the default `run_background=true`, FastAPI schedules an inline local adapter conversion that writes `model.usdc`, index JSON, mapping JSON, quality metrics, and `metadata.json`, then posts successful metadata to `_bim-control`.

The production worker adapter uses optional external Python prerequisites:
`ifcopenshell` for IFC geometry extraction and `usd-core` for writing and
reopening OpenUSD stages. These are treated as external prerequisites, not
repo-local installs. If either prerequisite is unavailable, or if the generated
`model.usdc` cannot be reopened with a USD stage reader, the job is marked
`failed` and the artifact group remains non-ready.

`element_mapping.json` is generated from real IFC GUIDs and USD prim paths. Each
entry includes `primary_usd_prim_path` for the current UI focus path and
`usd_prim_paths` for the full one-to-many mapping. P0 coverage is
measure-first: coverage metrics are emitted, but low coverage alone is not a CI
failure until a later baseline is locked.

The opt-in pytest smoke `test_real_ifc_files_convert_to_kit_openable_usdc_when_enabled`
runs only when `WORKER_RUN_REAL_USDC_SMOKE=1` is set and uses repo-local IFC
fixtures from `WORKER_REAL_IFC_STORAGE_ROOT`.
