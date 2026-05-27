# fix-lan-runtime-params-spectator-capacity

## Summary

將 hybrid web-plane + host-native Kit demo 的 LAN/browser-visible 參數收斂成可配置 contract，並讓 single-Kit spectator WebRTC stream 數量可由部署參數控制，預設產生 5 個 spectator viewer slots。

## Problem

目前已完成 IFC-ready → conversion → review session → `/ui/open` 的閉環，但實機觀察仍有兩個 gap：

1. Browser handoff 仍可能把 client 導向 `127.0.0.1`，導致 LAN client 實際連到自己的電腦，而不是 streaming server host。
2. Same-Kit multi-viewer 需要 primary/spectator WebRTC streams，但 deploy path 尚未把 spectator port topology 參數化；operator 無法用一個可審查參數控制可同時觀看的人數。

這代表現在 demo 雖然能在 server 本機看見 ready job，但 LAN client 驗證仍需要手動猜 URL、手動改 env，且多人觀看的容量沒有成為 OpenSpec/code/tests 共同驗收條件。

## Goals

- 提供一組 LAN/runtime public host 參數，使 coordinator redirect、viewer API/socket base、Kit WebRTC endpoint、artifact public URL 一致使用 browser/runtime 可達 host。
- 讓 spectator stream 數量可配置，預設 5 個 spectator slots；primary stream 仍保留原本 endpoint。
- `stream-config` 與 runtime status 必須暴露 primary + spectator bindings，讓 viewer 可以選擇 spectator stream 並讓驗證看到 `spectator_ready=true`。
- 更新 deployment scripts、compose env/example、tests、OpenSpec evidence checklist，避免再回到 hard-coded loopback。
- 一鍵部署在啟動 Kit 前必須檢測 host-native Kit runtime build artifacts；缺失時自動執行 `bim-streaming-server\repo.bat build`，避免 Phase 4b 等待 timeout 才揭露「需要 build」。

## Non-Goals

- 不把 host-native NVIDIA Kit containerize。
- 不實作 dedicated multi-Kit / 多 GPU process capacity。
- 不處理 Internet-facing TLS/TURN/STUN production exposure。
- 不修改真實 `.env` secret 或私有 token。
- 不改變 external company cloud / edge IFC Worker 的責任邊界。

## Assumptions

- LAN demo host 可用一個 operator-provided host/IP 表示，例如 `192.168.10.105`。
- Same-Kit multi-viewer 在本 change 中代表 one Kit process + one primary stream + N spectator streams；不是 N 個 Kit process。
- 「預設 5 人」在本 change 定義為 5 個 spectator viewer slots，總容量為 1 primary viewer + 5 spectator viewers。若要總共 5 個 viewer，operator 可把 spectator count 設為 4。

## Success Criteria

- `openspec validate fix-lan-runtime-params-spectator-capacity --strict` 通過。
- Coordinator config tests 覆蓋 public URL normalization 與 spectator endpoint generation。
- Hybrid deploy path 可用參數產生 default 5 spectator port pairs，並傳給 host-native Kit launch 與 coordinator stream config。
- `compose.host-kit.yml` 不再把 viewer publish hard-code 成 `127.0.0.1` only，LAN profile 可 publish 到 configured bind host。
- `scripts/deploy.ps1` 在 `_build\windows-x86_64\release\ezplus.bim_review_stream_streaming.kit.bat` 或 `kit\kit.exe` 缺失時，於 Phase 2 自動跑 `repo.bat build`；build 失敗時要早停並指向 log。
- `/ui/open?session=<id>` 在 LAN profile 下 redirect 到 configured viewer public base，且 viewer query handoff 使用同一個 coordinator public base。
- Runtime verification checklist 要求驗證 redirect、stream-config primary/spectator endpoints、artifact URL、browser readiness，而不是只看 port open。
