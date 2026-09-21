# Local Verification

選擇與 changed paths 直接相關的 checks；沒有執行的項目必須明列，不能用遠端 CI、歷史 evidence 或其他 service 的 pass 代替。

| Scope | Commands |
|---|---|
| Root contracts/fakes | `.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider` |
| Kit Command Vocabulary（改到 `tests/contracts/kit-datachannel-v1.schema.json` 或任何 `kit-command-vocabulary` 產出檔） | `cd web-viewer-sample && npm run generate:kit-command-vocabulary -- --check`；root pytest 的 `tests/test_kit_command_vocabulary_contract.py` 也會比對三份產出檔的 `source-sha256` |
| `bim-review-coordinator` | `npm test`、`npm run build` |
| `bim-streaming-server` | 先 `.venv\Scripts\python.exe -m pip install -r bim-streaming-server\requirements-dev.txt`；再 `.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py -q` |
| `governance-service` | `C:\Program Files\Python312\python.exe -m pytest tests -v` |
| `web-viewer-sample` | `npm run test:session-first`、`npm run build` |
| `services/kit-manager-api` | `..\..\.venv\Scripts\python.exe -m pytest tests -q` |
| `apps/kit-manager-web` | `npm run build` |
| Runtime/deploy path | `.\scripts\deploy.ps1 -DryRun` |

## User-facing acceptance

### Structured-log evidence reports

`scripts/dev/run-structured-log-runtime-evidence.ps1` 產生及驗證的報告使用
`## Requirements and verification mapping`，引用現行 backlog、驗證入口及 log contracts。
新版驗證器不接受只有舊 `OpenSpec 10.1-10.5 mapping` 標題的報告。
歷史證據保留原檔並使用產生它的 commit 查證；新驗收須重跑產生新 attempt，
不得只改歷史 Markdown 或 hash manifest 來冒充本次驗證。
本機 renderer 回歸命令：`pwsh -NoProfile -File scripts/tests/test-run-structured-log-runtime-evidence.ps1 -Case ArtifactRenderer`。

### Browser and Kit

Browser/UI 變更需回報 route、主要操作、fixture、真 API、observed runtime ID、loading/success/failure/retry、E2E command、screenshot/trace 與 known gaps。靜態 build 或 API health 不證明 user workflow。

Kit/WebRTC 變更另需真實 first frame、正確 Stage、DataChannel 與 ACK。GPU 不可用時明確標記未驗證，不得在無 graphics channel 的容器內宣稱 runtime pass。

部署層的 Kit 就緒不以 log 關鍵字為準：`scripts/deploy.ps1` Phase 4c 在 `Wait-KitReady` 之後會對 signalling port 做真實 `sign_in` 握手（`scripts/lib/kit-signaling-probe.ps1`），必須在逾時內收到含 `m=video` 的 SDP offer 才算通過；失敗會停止 Kit、等待 tree 釋放、冷卻後重啟一次，再失敗即 exit 4。手動驗證同一件事可用 `pwsh -NoProfile -Command ". scripts/lib/kit-signaling-probe.ps1; Test-KitSignalingOffer -HostName <kit host> -Port 49100"`。

### 本機真 Kit browser E2E 前置條件

Kit 只有在 `COORDINATOR_INTERNAL_API_BASE` 是 origin-only loopback URL、且 `INTERNAL_API_AUTH_TOKEN` 與 coordinator 使用同一值時，才會接受 DataChannel trace；否則每個 trace 都被拒、stage 永遠不載入。`scripts/start-all.ps1` 在啟動 Kit 前處理這件事（`scripts/lib/kit-runtime-authority.ps1`）：

1. Base：shell 有設 `COORDINATOR_INTERNAL_API_BASE` 就用它，否則 `http://127.0.0.1:8004`。非 loopback 或帶 path/query/fragment/credentials 時，在啟動任何服務前失敗。
2. Token：shell 有設 `INTERNAL_API_AUTH_TOKEN` 就用它（同一次 start-all 啟動的 coordinator 繼承同值）；沒設就用 coordinator 的非 production 預設值，只有 coordinator 本身也沒有私有值時才會相符。
3. 等 coordinator `/health` 通過後，以 Kit 同款 `X-Internal-Token` header 呼叫唯讀的 `GET /api/internal/structLog/health`。回應不是 2xx 就拒絕啟動 Kit、exit 非 0，訊息會指出要設哪個變數；通過才把兩個值交給 Kit。
4. Coordinator 已有私有 token（例如它自己的 untracked `.env`）而被拒時：在同一個 shell 設 `$env:INTERNAL_API_AUTH_TOKEN` 為同一值，執行 `scripts\stop-all.ps1` 後重跑 start-all。值不得出現在 command line 參數、log、截圖或 PR。

直接執行 `bim-streaming-server/scripts/start-streaming-server.ps1`（非 `-PreflightOnly`）時，兩個值缺一或 base 非 loopback 會在檢查 build/port 前直接失敗；它無法驗證是否與 coordinator 相符，須自行帶入與 coordinator 相同的值。

另有兩個本機 gate，start-all 不會自動設定：

| 變數 | 作用 | 未設定的症狀 | 設定方式 |
|---|---|---|---|
| `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` | Kit 只下載 host:port 在清單內的 HTTP stage；預設 `127.0.0.1:49101,localhost:49101` | Kit log 出現 `HTTP stage URL host is not allowed: '<host:port>'`，stage 不載入 | 啟動前在 shell 設逗號分隔的 `host:port`（要保留仍需要的預設值），或手動啟動 Kit 時用 `-AllowedStageHosts` |
| `VITE_ALLOWED_COORDINATOR_ORIGINS` | viewer 只接受清單內 origin 的 parent（vg01）訊息 | embedded viewer 拒收所有 vg01 parent message，console 指令無效 | 啟動前在 shell 設為 console origin，例如 `http://127.0.0.1:8004`；Vite dev server 在啟動時讀取 process env，改值要重啟 viewer |

```powershell
$env:VITE_ALLOWED_COORDINATOR_ORIGINS = 'http://127.0.0.1:8004'
.\scripts\start-all.ps1
# Kit 載入 stage 後應無輸出；有任何一行即代表 runtime authority 不一致，E2E 結果無效
Select-String -Path scripts\.run\bim-streaming-server.log -Pattern 'datachannel trace rejected'
```

## PR safety

```powershell
node --test .github/scripts/pr-safety.test.mjs
node .github/scripts/pr-safety.mjs --base <40-character-base-sha> --head <40-character-head-sha>
```

此檢查只涵蓋 diff whitespace/conflict-marker、changed JSON、changed PowerShell 與新增行秘密模式；service tests 與人工審查仍由變更風險決定。
