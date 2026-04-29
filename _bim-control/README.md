# _bim-control

Local fake BIM data authority for conversion result metadata.

## Run

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

## API

```txt
POST /api/model-versions/{model_version_id}/conversion-result
GET  /api/model-versions/{model_version_id}/conversion-result
```

Conversion results are stored as JSON under:

```txt
data/conversion_results
```
