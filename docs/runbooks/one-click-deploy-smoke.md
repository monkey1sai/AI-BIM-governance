# One-Click Deploy(Mode C hybrid)Smoke Checklist

> Layer 3 手動 smoke。對應 `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` §9.3。
> 這份 checklist 在 `scripts\deploy.ps1` 第一次合進 main 之前跑一次,蓋章在本檔下方「Smoke Pass Log」。

## Prerequisites

- Windows host
- NVIDIA GPU + driver(`nvidia-smi` 在 PATH)
- Docker Desktop 已裝且 running(tray icon settled)
- Node 18+ / Python 3.12+ 已裝(`.venv` 由 deploy 自動建)

## Steps

### 1. Cold start

```powershell
# Stop all
.\scripts\stop-runtime-manager-docker.ps1
.\scripts\stop-all.ps1

# Clear local artifacts
Remove-Item -LiteralPath .\.venv -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\bim-review-coordinator\node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\web-viewer-sample\node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\.env.web-plane.host-kit -Force -ErrorAction SilentlyContinue
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml down -v
```

### 2. Run deploy

```powershell
.\scripts\deploy.ps1
```

**Expected:** 5-6 個 `[fix ]` lines(create .venv / pip / Copy-Item .env / docker compose build / etc),全程 < 10 分鐘,退 0。

### 3. Open coordinator UI

開 <http://127.0.0.1:8004/ui>

**Expected:** Coordinator dashboard 載入。

### 4. Verify WebRTC handshake

開 <http://127.0.0.1:5173>(viewer 由 docker compose 提供)。

**Expected:** Viewer 跑起來,session 建立,WebRTC handshake 成功,viewport 有畫面(`readyState=4` + 影像尺寸 > 0,參考 memory `webrtc-no-video-reset-user-recovery`)。

### 5. Hot re-run(idempotent)

```powershell
.\scripts\deploy.ps1
```

**Expected:**
- 0 個 `[fix ]`
- 0 個 `[ask ]`
- Phase 4 全部 `[skip ] already running`
- 退 0
- 總時 < 30 秒

### 6. Forced rebuild

```powershell
.\scripts\deploy.ps1 -Build
```

**Expected:** Docker image 重 build、container recreate、host-native 不重啟(若 PID 仍活)。

### 7. Failure injection

```powershell
# 故意關 Docker Desktop(在 system tray 退出)
.\scripts\deploy.ps1
```

**Expected:** Phase 1 `[fail ]` preflight-docker engineRunning=false,退 1,host-native 不啟動。

---

## Smoke Pass Log

> 第一次 smoke 通過後填這欄,之後每次大改 deploy.ps1 也回來蓋一次。

| Date       | Operator | Branch / Commit                                | Notes |
|------------|----------|------------------------------------------------|-------|
| YYYY-MM-DD | YOUR_NAME| `docs/one-click-deploy-design-2026-05-26 @ XXXXXX` | (pending first run) |
