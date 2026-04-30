# _s3_storage

Local fake object storage for BIM conversion smoke tests.

## Demo 故事位置

| | |
|---|---|
| **步驟** | ① 上傳建模 (Upload) |
| **Demo URL** | <http://127.0.0.1:8002> |
| **客戶看到的內容** | 雲端倉庫已連線、示範專案的檔案目錄樹（IFC 原始檔 / USDC 可審查模型 / 元件對照表）+ 號誌狀態 |
| **設計守則** | [`docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md`](../docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md) |

## Run

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --reload
```

Files are served from:

```txt
_s3_storage/static
```

## Demo UI

```txt
GET /ui
GET /api/dev/files
GET /api/dev/demo-files
```

`GET /ui` opens a browser file browser for demo artifacts. `GET /api/dev/files` returns static file metadata without reading file bodies.

The conversion smoke fixture is expected at:

```txt
static/projects/project_demo_001/versions/version_demo_001/source.ifc
```
