# Design

## Overview

本 change 把 LAN browser handoff 和 same-Kit spectator capacity 分成兩個可驗證層：

- Public handoff layer：由部署參數設定 browser-visible host/base URLs，並傳入 coordinator、viewer、conversion artifact refs。
- Spectator topology layer：由 spectator count 與 port base/stride 產生同一個 Kit process 的 spectator WebRTC endpoint list，coordinator 用這些 endpoint 補出 runtime `kit_instance_bindings`。

## Configuration Model

新增或標準化下列 env/CLI 參數：

- `PUBLIC_HOST`：browser-visible host/IP。作為未明確設定 base URL 時的共同 host。
- `COORDINATOR_PUBLIC_BASE_URL`：`/ui/open` query handoff 使用的 coordinator base。
- `VIEWER_PUBLIC_BASE_URL`：`/ui/open` redirect target 的 viewer base。
- `VIEWER_BIND_HOST`：Docker publish viewer port 的 host bind address，LAN demo 可設 `0.0.0.0`。
- `KIT_SIGNALING_HOST` / `KIT_MEDIA_HOST`：browser-visible Kit endpoint host。
- `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL`：Kit/runtime-visible artifacts base。
- `KIT_SPECTATOR_COUNT`：spectator viewer slots，預設 `5`。
- `KIT_SPECTATOR_SIGNALING_PORT_START`：預設 `49110`。
- `KIT_SPECTATOR_MEDIA_PORT_START`：預設 `48008`。
- `KIT_SPECTATOR_PORT_STRIDE`：預設 `10`。

`KIT_INSTANCE_ENDPOINTS` 仍保留為進階 escape hatch。當它只提供 primary endpoint 時，coordinator 可依 `KIT_SPECTATOR_*` 補出 spectator endpoints；當它已提供多個 endpoint 時，視為 operator 明確指定完整 topology，不再追加預設 spectator endpoints。

## Runtime Behavior

1. `scripts/deploy.ps1` 生成 spectator port pairs，預設 5 組。
2. `scripts/deploy.ps1` preflight 檢查 host-native Kit wrapper script 與 runtime build artifacts：`_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat` 與 `kit\kit.exe`。
3. 若 runtime build artifacts 缺失且未使用 `-SkipKit`，Phase 2 auto-fix 會在 `bim-streaming-server` 執行 `.\repo.bat build`；build 失敗時早停，並指向 `scripts\.run\kit-repo-build.log`。
4. `Start-HostNativeKit` 將 spectator port list 傳給 `bim-streaming-server/scripts/start-streaming-server.ps1`。
5. `compose.host-kit.yml` 把 public host/base URL、Kit host、spectator count/base/stride 傳入 coordinator，並允許 viewer bind host 配置。
6. `bim-review-coordinator` 載入 config 時，如果 active endpoint topology 只有 primary，就依 spectator count 產生 spectator endpoints。
7. `/api/sessions/:id/stream-config` 透過既有 `runtimeKitInstanceBindings` 回傳 primary + spectator bindings，`viewport_sharing.spectator_ready` 在存在 distinct spectator endpoint 時為 `true`。
8. `web-viewer-sample` 維持現有 `stream=spectator` selection 行為；此 change 不重寫 viewer stream selection。

## Validation Strategy

- Unit tests:
  - public base URL normalization 仍通過。
  - default spectator count 產生 5 個 spectator endpoints。
  - explicit multi-endpoint `KIT_INSTANCE_ENDPOINTS` 不被額外追加 default spectators。
  - invalid spectator config 被拒絕或降到安全值，不產生 duplicate endpoint。
- Script-level checks:
  - deploy dry run / focused parsing tests 確認 default ports 為 `49110/48008` 起跳，stride `10`。
  - host-native preflight tests 確認 wrapper 存在但 `_build` runtime artifacts 缺失時會回報 `NEEDS_BUILD` 與 `repo.bat build` 指引。
- OpenSpec validation:
  - strict validate new change。
- Runtime evidence requirement:
  - LAN client 驗證必須打 `http://<server-ip>:8004/ui/open?session=<review_session_id>` 或由 `/ui` 的 `viewer_url` 開啟。
  - Browser evidence 必須看見 redirect 不含 client-loopback、stream-config 有 primary + spectator endpoints、兩個 browser pages 可用同一 session 分別連 primary/spectator。

## Risks

- 如果 OS firewall 未開放 `8004`, `5173`, `49100`, `47998`, spectator ports，LAN client 仍無法連線；這是 network policy blocker，不應被誤判成 app success。
- 如果 artifact public URL 仍是 `127.0.0.1:49101`，host-native Kit 在同 host 可讀，但 remote browser/client 觀察會混淆；validation 必須清楚標示 consuming runtime perspective。
- 5 個 spectator streams 增加 host Kit port surface 與 GPU/encode 負載；預設是 demo-friendly，operator 仍可把 count 降低。
