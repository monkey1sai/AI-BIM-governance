# _s3_storage

Local fake object storage for BIM conversion smoke tests.

## Run

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

Files are served from:

```txt
_s3_storage/static
```

The conversion smoke fixture is expected at:

```txt
static/projects/project_demo_001/versions/version_demo_001/source.ifc
```
