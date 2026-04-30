# _conversion-service

IFC to USDC conversion API and local job manager.

This service owns the conversion API only. It calls the existing Kit headless converter from `../bim-streaming-server/scripts/convert-ifc-to-usdc.ps1`, publishes artifacts into `_s3_storage`, and writes conversion metadata back to `_bim-control`.

## Run Order

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\_s3_storage
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\_bim-control
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\_conversion-service
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload
```

The converter requires `bim-streaming-server` to be built first:

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\bim-streaming-server
.\repo.bat build
```

## API

```txt
GET  /health
GET  /ui
POST /api/conversions
GET  /api/conversions/{job_id}
GET  /api/conversions/{job_id}/result
POST /api/dev/mock-conversion-result
```

Example request:

```json
{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "source_url": "http://localhost:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc",
  "target_format": "usdc",
  "options": {
    "force": true,
    "generate_mapping": true,
    "allow_fake_mapping": false
  }
}
```

## Smoke Test

```powershell
cd C:\Repos\active\iot\AI-BIM-governance\_conversion-service
.\scripts\smoke_conversion.ps1
```

Expected result:

```txt
job status = succeeded
result.usdc_url is not empty
result.mapping_url is not empty
_bim-control returns the same usdc_url
```

## Mapping Coverage

`element_mapping.json` is intentionally conservative:

```txt
metadata_guid             confidence 0.95
metadata_revit_element_id confidence 0.85
unique_name_class_match   confidence 0.50
no_match                  confidence 0.00
```

By default `allow_fake_mapping=false`. Unmatched IFC GUIDs and USD prims are reported in `unmapped_ifc_guids` and `unmapped_usd_prims`. Fake mapping is only available for smoke testing with `-AllowFakeMapping`.

## Failure Notes

- `CONVERTER_PROCESS_FAILED`: inspect `_conversion-service/data/logs/{job_id}.log`; often means `bim-streaming-server` was not built or HOOPS converter extensions are missing.
- `USD_INDEXER_FAILED`: inspect the same log; often means Kit is missing or `model.usdc` could not be opened.
- `_bim-control` update warnings do not fail the conversion job after files are published.

## Demo UI

`GET /ui` serves a browser console for creating conversion jobs, polling status, reading results, and opening published URLs.

`POST /api/dev/mock-conversion-result` is a dev-only fallback. It creates a succeeded job with `"mock": true` and writes placeholder outputs only when the target files do not already exist. It does not run the real converter and must not be treated as a production conversion result.
