# One-Click Deploy(Mode C hybrid)Smoke Checklist

> Layer 3 手動 smoke。對應 `docs/superpowers/specs/2026-05-26-one-click-deploy-design.md` §9.3。
> 這份 checklist 在 `scripts\deploy.ps1` 第一次合進 main 之前跑一次,蓋章在本檔下方「Smoke Pass Log」。

## Prerequisites

- Windows host
- NVIDIA GPU + driver(`nvidia-smi` 在 PATH)
- Docker Desktop 已裝且 running(tray icon settled)
- Node 18+ / Python 3.12+ 已裝(`.venv` 由 deploy 自動建)
- LAN demo 預設公開位址為 `192.168.10.105`；同網段裝置要能連到這台 host 的 `8004` / `5173` / `49100` / `47998` 與 spectator ports

## Steps

### 1. Cold start

```powershell
# Safety guard: run only from repo root.
$repoRoot = (git rev-parse --show-toplevel).Trim()
if ((Resolve-Path .).Path -ne (Resolve-Path $repoRoot).Path) {
    throw "Run this cleanup from repo root only: $repoRoot"
}

# Stop all
.\scripts\stop-runtime-manager-docker.ps1
.\scripts\stop-all.ps1

# Clear local artifacts under the verified repo root only.
Remove-Item -LiteralPath .\.venv -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\bim-review-coordinator\node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .\web-viewer-sample\node_modules -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath .\.env.web-plane.host-kit) {
    Copy-Item -LiteralPath .\.env.web-plane.host-kit -Destination ".\.env.web-plane.host-kit.bak-$(Get-Date -Format yyyyMMddHHmmss)" -Force
    Remove-Item -LiteralPath .\.env.web-plane.host-kit -Force
}
docker compose -f compose.runtime-manager.yml -f compose.host-kit.yml down -v
```

### 2. Run deploy

```powershell
.\scripts\deploy.ps1
```

**Expected:** 5-6 個 `[fix ]` lines(create .venv / pip / Copy-Item .env / docker compose build / etc),全程 < 10 分鐘,退 0。Summary 顯示 coordinator / viewer public URL 使用 `192.168.10.105`。

### 3. Open coordinator UI

開 <http://192.168.10.105:8004/ui>

**Expected:** Coordinator dashboard 載入。

### 4. Verify WebRTC handshake

開 <http://192.168.10.105:5173>(viewer 由 docker compose 提供)。

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

**Expected:** Docker image 重 build、container recreate、host-native 不重啟(若 PID 仍活)，public URL 仍維持 `192.168.10.105`。

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
| 2026-05-26 | monkey1sai + Claude | `docs/one-click-deploy-design-2026-05-26 @ 2b9715b` | Step 1/2/5 pass(cold start → deploy 1m 42s 全綠 → idempotent re-run 5s + Phase 4 全 skip + verify 全 200)。Step 3/4(coordinator UI / WebRTC 畫面)、Step 6(-Build force rebuild)、Step 7(關 Docker Desktop fail injection)需要人類目視 / 手動操作,留 PR review 階段補驗 |
