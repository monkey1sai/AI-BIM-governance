## Why

CH-3 收 3 個低風險、互相獨立但主題相鄰的「設定化 + 死碼清理 + 文件對齊」缺口,全圍繞 HTTP stage allowed-hosts 與退役 `_worker` port 8005。全 LOW impact、無新 production dependency、無對外 API / contract 變更。

1.（#12）`stage_loading.py` 的 `_http_stage_allowed_hosts()` 與 `start-streaming-server.ps1` L281-283 在 env var 空時「靜默」fallback 到硬寫死 demo localhost 清單(含 8005、49101)。coordinator / conversion authority 換 IP / port 時 `_ensure_allowed_http_stage_url` raise、stage 載入回 error、串流停白畫面;靜默 fallback 反而掩蓋 ops 忘設 env 的情形。
2.（#24）`_worker` 已退役(無進程 listen 8005),但 8005 硬寫在三處獨立 fallback(deploy.ps1、start-streaming-server.ps1、stage_loading.py)。純死碼,留著只會誤導後人以為 8005 還有服務。
3.（#14）`bim-streaming-server/SYSTEM_DESIGN.md` 是前瞻 target 架構稿(Node session manager、Kit worker pool、slot model、Unix socket telemetry…),與 as-built(單一 PowerShell launcher 起單一常駐 Kit + 獨立 49101 FastAPI conversion authority)嚴重不符,讀者(含 AI agent)會把不存在的多進程架構當既有實作、做出錯誤 impact 判斷。

## What Changes

Owner = `bim-streaming-server` + root `scripts/`;不碰 coordinator / web-viewer / callback outbox / stage 載入核心邏輯。

- **#12 stage allowed-hosts 設定化 + 空值 warn**:`start-streaming-server.ps1` 加 `-AllowedStageHosts` param(對齊 `$SignalPort` 等既有 param);改 fallback 為三分支(param 非空 → env 已設沿用 → 否則 Write-Warning 後填 default)。`stage_loading.py` 的 `_http_stage_allowed_hosts()` 空值分支加 `carb.log_warn`(提示 env 未設、用 localhost-only 預設、coordinator 非 localhost 請設 env)。env 變數名 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` 維持不變;host 強制檢查 `_ensure_allowed_http_stage_url` 不動。
- **#24 移除三處 8005 死碼**(explore 確認 100% 可安全移除:全 repo 8005 非註解功能引用只剩這三處 fallback、既有測試零依賴):`deploy.ps1` 的 `Resolve-AllowedStageHosts` default 陣列刪 8005(留 `127.0.0.1:{ConversionPort}` / `localhost:{ConversionPort}`,`$PublicHost:49101` 仍動態追加);`stage_loading.py` 的 `_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS` 改 `('127.0.0.1:49101','localhost:49101')`;`start-streaming-server.ps1` default 字串改 `127.0.0.1:49101,localhost:49101`;`bim-streaming-server/README.md` L215-220 範例移除 8005、改述 retired host 已清。
- **#14 SYSTEM_DESIGN.md 改寫為 as-built**:新增 As-built architecture 段;§5/§6/§7/§8/§9/§11/§13 前瞻內容逐段標 `[DEFERRED]` 並補實際 as-built 描述;§3/§9 target sizing 數字保留 + 加「target capacity 模型、as-built 尚未實作 slot 強制」註記(roadmap §9 引用其數字,不刪以免斷引用鏈)。

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `one-click-deploy-hybrid`:ADD 1 requirement(stage allowed-hosts 設定化 + 空值告警 + 預設清單不含退役 port),涵蓋 #12 設定化/warn 與 #24 預設不含 8005 的外部可觀察行為。
- #14 SYSTEM_DESIGN.md 改寫、README 範例、test fixture URL 屬 tasks-only(文件/測試對齊,不改外部 contract,無額外 spec delta)。

## Impact

- Owner repo / folder:
  - `bim-streaming-server/source/extensions/.../messaging/stage_loading.py`(#12 `_http_stage_allowed_hosts` warn、#24 `_DEFAULT_HTTP_STAGE_ALLOWED_HOSTS` 刪 8005)
  - `bim-streaming-server/scripts/start-streaming-server.ps1`(#12 `-AllowedStageHosts` param + 三分支、#24 default 字串)
  - `scripts/deploy.ps1`(#24 `Resolve-AllowedStageHosts` default 刪 8005)
  - `bim-streaming-server/README.md`(#24 範例)
  - `bim-streaming-server/SYSTEM_DESIGN.md`(#14 as-built 改寫)
  - `bim-streaming-server/tests/test_stage_loading_stage_composition.py`(#12/#24 新 test + fixture URL)
  - `scripts/tests/test-deploy-dryrun.ps1`(#24 regression)
  - `openspec/changes/harden-stage-host-allowlist/`
- Runtime boundary:純 streaming-server + scripts。不改 stage 載入核心、host 強制檢查語意、env 變數名、對外 API / DataChannel / Socket.IO contract。
- API:無變更。
- Data:無 schema 變更;stage allowed-hosts default 清單移除退役 8005(LAN demo 不受影響,49101 + 動態 `$PublicHost` 仍在)。
- Dependencies:無新增(`carb.log_warn` / `Write-Warning` 皆既有設施)。
- Runtime 行為變更(operator 需注意):env 未設時改為發 warn(非靜默),提示設 env;default 清單不再含退役 8005。
- Non-goals:
  - 不改 stage 載入核心邏輯(`_ensure_allowed_http_stage_url` / `_http_stage_host_key` / `LoadingManager._download_http_stage`)。
  - 不重命名 env 變數 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS`。
  - 不實作任何 SYSTEM_DESIGN 前瞻設計(Node session manager / slot model / warm pool / OTel 等)。
  - 不刪 SYSTEM_DESIGN §3 / §9 target sizing 數字(roadmap §9 引用,只加註)。
  - 不新增 production dependency。
  - 不動 archive / contract 歷史文件的 8005(worker-api.md 等,已標 retired)。
  - 不改 spectator / multi-viewer / capacity 並發機制。
