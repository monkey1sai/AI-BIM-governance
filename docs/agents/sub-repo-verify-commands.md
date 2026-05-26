> Loaded lazily by AGENTS.md / CLAUDE.md。Source-of-truth: AGENTS.md。
>
> 何時讀本檔：要跑 sub-repo 驗證指令、Cursor Cloud / Linux 環境設定、查 lint / build / health 入口時。

# Sub-repo 驗證入口

每個 sub-repo 都有自己的 repo-local `AGENTS.md` / `CLAUDE.md`（七段 schema），本檔只匯總 root 層常用的「跑哪個 sub-repo 的什麼指令」清單。

## Root contracts / fakes

```powershell
python -m pytest tests -p no:cacheprovider
```

> 必須走 `.venv\Scripts\python.exe`，否則 user-site packages 會把 FastAPI / Starlette / uvicorn 拉成不相容版本（見 agent memory `venv-python-required-for-pytest.md`）。

## bim-review-coordinator (Node, port 8004)

```powershell
cd bim-review-coordinator
npm test
npm run build
npm run verify
```

## bim-streaming-server (Python + Kit)

```powershell
cd bim-streaming-server
python -m pytest tests/test_conversion_authority_api.py -q
```

Kit 渲染需要 Windows host-native（NVIDIA driver）；WSL2 / Docker 無 GPU graphics 通道，不可在容器跑 Kit runtime（見 agent memory `kit-gpu-render-needs-windows-native.md`）。

## web-viewer-sample (Vite, port 5173)

```powershell
cd web-viewer-sample
npm run test:session-first
npm run build
```

Network 入口走 coordinator `:8004/ui`（LAN IP）；viewer `:5173` 是 Kit 1:1 endpoint，不可當入口直接暴露。

---

## Cursor Cloud / Linux 等效啟動

### 環境概要

- Node.js 18 透過 nvm 管理；啟動 Node 服務前須先 source nvm：`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`
- Python 3.12 已系統安裝；FastAPI/uvicorn 等 Python 依賴安裝在全域 site-packages（非 venv）
- `bim-streaming-server` 需要 NVIDIA GPU + Kit SDK，Cloud VM 無法運行，可跳過

### 啟動服務（B 方案：2 個可運行 Node 服務，Kit 需 GPU 可另行啟動）

每個服務需獨立 terminal / tmux session，README.md 已有完整 PowerShell 版命令，以下是 Linux 等效：

| 服務 | 工作目錄 | 啟動命令 | Port |
|---|---|---|---|
| `bim-review-coordinator` | `bim-review-coordinator/` | `npm run dev` | 8004 |
| `web-viewer-sample` | `web-viewer-sample/` | `npm run dev -- --host 0.0.0.0` | 5173 |

### 測試

- Python tests：
  - `python3 -m pytest tests`（外部平台 contracts + test-only fakes）
  - `cd bim-streaming-server && python3 -m pytest tests/test_conversion_authority_api.py`
- Node tests：`cd bim-review-coordinator && npm test`
- Build：`cd bim-review-coordinator && npm run build` / `cd web-viewer-sample && npm run build`
- Lint（`web-viewer-sample`）：`npm run lint` — 目前有 30 個 pre-existing eslint errors，這是已知狀態

### .env 設定

- 從 `.env.example` 複製：root `.env`、`bim-review-coordinator/.env`
- 預設值即為本地開發正確值，通常不需修改

### 注意事項

- `web-viewer-sample` 完整功能需要 `bim-streaming-server`（WebRTC 串流），Cloud VM 無 GPU 無法運行。但 UI 仍可正常載入，REST API 與 coordinator 互動正常
- Health check endpoints：各服務皆有 `/health`
