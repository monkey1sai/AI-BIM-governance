# Local Verification

選擇與 changed paths 直接相關的 checks；沒有執行的項目必須明列，不能用遠端 CI、歷史 evidence 或其他 service 的 pass 代替。

| Scope | Commands |
|---|---|
| Root contracts/fakes | `.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider` |
| Kit Command Vocabulary（改到 `tests/contracts/kit-datachannel-v1.schema.json` 或任何 `kit-command-vocabulary` 產出檔） | `cd web-viewer-sample && npm run generate:kit-command-vocabulary -- --check`；root pytest 的 `tests/test_kit_command_vocabulary_contract.py` 也會比對三份產出檔的 `source-sha256` |
| `bim-review-coordinator` | `npm test`、`npm run build` |
| `bim-streaming-server` | 先 `.venv\Scripts\python.exe -m pip install -r bim-streaming-server\requirements-dev.txt`；再 `.venv\Scripts\python.exe -m pytest tests/test_conversion_authority_api.py -q`；動到 CFD job（`cfd_job_service.py`、`cfd_options.*`、`cfd_estimate.py`、`cfd_pipeline/`）時加 `tests/test_cfd_job_service.py`、`tests/test_cfd_openfoam_runner.py` 與 `tests/test_cfd_options_estimate.py`，並在 `tools/cfd` 目錄跑 `pytest tests -q`（同一套 pipeline 程式的離線 CLI 測試） |
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

#### Kit info-level log 在哪裡

`scripts/.run/bim-streaming-server.log` 只有 Kit 的 stdout，而 Kit 的 stdout 只印 warning 以上（`kit-core.json` 的 `outputStreamLevel=Warning`）。`datachannel trace accepted`、`[client-send] forwarded …`、`Processing N signaling headers` 都是 info，只會出現在 Kit 的檔案 log（`fileLogLevel=Info`）。start-all 與手動啟動都以 `-PortableRoot` 啟動 Kit，所以檔案在：

```
bim-streaming-server\logs\nvstreamer\<instance>\portable\logs\Kit\<app>\<version>\kit_<start_timestamp>.log
```

不在 `~/.nvidia-omniverse/logs/Kit` 或 `%LOCALAPPDATA%/ov`。start-all 的 `[note ]` 與 launcher 的 `[streaming] kit log :` 會印出這個路徑。判讀 `loadingStateQuery` 是否到達 Kit 的最小序列：

```powershell
$kitLog = Get-ChildItem 'bim-streaming-server\logs\nvstreamer\kit_local_001\portable\logs\Kit' -Recurse -Filter 'kit_*.log' | Sort-Object LastWriteTime | Select-Object -Last 1
Select-String -Path $kitLog.FullName -Pattern 'signaling headers|datachannel trace (accepted|rejected)|\[client-send\] forwarded'
```

- `Processing 11 signaling headers`：瀏覽器的 `sign_in` 到了這個 Kit；`Processing 4 signaling headers` 只是 `Test-KitSignalingOffer` 探針。
- 之後每則 query 應成對出現 `datachannel trace accepted for loadingStateQuery` 與 `forwarded loadingStateResponse via queue_event`。
- 瀏覽器有影像、query 每秒送出，但檔案 log **連 `11 signaling headers` 都沒有**：viewer 連的不是這個 Kit，見下一節，不要去 Kit 或 viewer 找 bug。

#### Session 紀錄帶著建立當時的 Kit endpoint

`bim-review-coordinator/data/sessions/<id>.json` 的 `kit_instance` / `kit_instance_bindings[].stream_config` 是建立 session 當下 `KIT_INSTANCE_ENDPOINTS` 的快照。把 data 目錄拿到另一台機器（或 Kit host 變更）後重開舊 session，coordinator 現在會依 `kit_instance_id` 把它重綁到目前登記的 endpoint，並在 structured log 記一筆 `stream-config` warn（`persisted Kit endpoint rebound to the registered runtime endpoint`）。2026-09-21 之前沒有這條規則：一個 2026-09-03 在 181 建立的 session 在本機開啟時，viewer 連到 `192.168.20.181:49100` 的遠端 Kit，影像正常、`loadingStateQuery` 每秒送出、本機 Kit 零訊息、零 TCP 到 `:8004`，看起來完全像 #768。

仍然是快照、coordinator 不會改寫的欄位：`artifact_bindings[].url` / `mapping_url`。舊 session 的 stage 若指向別台主機的 `:49101`，本機 Kit 要載入它必須把該 `host:port` 放進 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS`，而且該主機要可達；否則請建立新 session。

快速判斷 viewer 實際連到哪台 Kit：

```powershell
Invoke-RestMethod http://127.0.0.1:8004/api/review-sessions/<session_id>/stream-config | Select-Object -ExpandProperty webrtc
netstat -ano | Select-String ':49100\s+ESTABLISHED'
```

### CFD 風場（S4 部署）

canonical deploy（`scripts/deploy.ps1`，經 `scripts/dev/rebuild-test-deploy.ps1 -Build`）從 canonical env 解析下列鍵並交給 host-native conversion service 與 dockerized coordinator；不設即關閉（`/api/cfd/*` 回 503 `cfd_disabled`）：

| 鍵 | 預設 | 說明 |
|---|---|---|
| `CFD_ENABLED` | `false` | `1/true/yes/on` 開啟；其他字串視為設定錯誤，deploy 直接失敗 |
| `CFD_IMAGE` | `opencfd/openfoam-default:2412` | 求解映像（repository[:tag]） |
| `CFD_IMAGE_DIGEST` | `sha256:1ba02114…d41b50` | 釘住的 digest；開啟時 Phase 4b 缺映像就 `docker pull <repo>@<digest>` 並打回 tag，本機 digest 不符即 exit 4 |
| `CFD_N_PROCS` | `4` | 每個 run 的 OpenFOAM 程序數上限（docker `--cpus` 同值）；181 與 Kit 同機，先保守 |
| `CFD_MAX_DIRECTIONS` | `16` | 單一 run 最多方向數 |
| `CFD_MAX_CELLS_PER_DIRECTION` | 空＝服務預設 8,000,000 | S8 算力硬上限：送出時估算單一風向格數超過即 422 `compute_cap_exceeded`；設值須為 100000–200000000 的整數 |
| `CFD_ARTIFACTS_ROOT` | 空＝`<STREAMING_CONVERSION_ARTIFACTS_ROOT>/cfd` | run 目錄（案例、overlay layer、run_record）所在；設值須為絕對路徑，且要在 `/cfd-artifacts` 能服務的同一台主機 |
| `CFD_PUBLIC_ARTIFACTS_URL` | 由 `STREAMING_CONVERSION_PUBLIC_ARTIFACTS_URL` 派生（`/artifacts`→`/cfd-artifacts`） | overlay／run record 對外 URL |

任何 CFD 鍵變動都進 conversion runtime signature（開關另進 web-plane signature），deploy 會重啟受影響服務。映像檢查在 Phase 4b 動到既有 conversion service 之前執行：失敗時 exit 4，舊服務維持運行。單元測試：`pwsh -File scripts/tests/test-deploy-cfd-solver.ps1`。真站驗收＝在 181 UI 送出 16 方向 run、Kit 疊圖截圖、Kit 串流未中斷（見契約文件 S4）。

#### 進行中的 CFD run（CFD run guard）

conversion service 每次啟動都執行 `CfdJobService.reconcile_on_start`：`preprocessing`、`meshing`、`solving`、`postprocessing` 的 run 會被殺掉 solver container 並標 `failed`（`worker_unavailable`），`queued` 重新排隊。所以部署在停止或取代這個服務之前，會在目標主機讀它自己的 run list：`GET http://127.0.0.1:49101/api/cfd-runs?status=<status>&limit=500`（讀取不需 token）。

| 狀況 | 結果 |
|---|---|
| 服務沒在跑（`scripts/.run/bim-streaming-conversion-service.pid` 不存在或 process 已結束） | 繼續 |
| 沒有進行中的 run（`queued` 只列出） | 繼續 |
| 有進行中的 run | 失敗，列出 run id 與狀態 |
| 服務在跑但 run list 讀不到（連線、逾時、非 2xx、格式不符） | 失敗（fail closed） |

檢查時機：

- 遠端 canonical 部署：目標主機在 `git reset --hard` 之前先查一次，使用即將部署那個 revision 的 `cfd-solver-deploy.ps1`（執行中的服務還會從這個 checkout 載入程式碼，所以擋下時 checkout 與服務都不動）。
- `deploy.ps1` Phase 1：runtime signature 已變、重啟已確定時查；擋下即 exit 1，此時服務、Kit 與 venv 都還沒動。
- `deploy.ps1` Phase 4b：每次停止 conversion service 之前再查一次；擋下即 exit 4，服務原樣保留。
- `-TargetId local-windows` 的 rebuild：staging 前與停服務前各查一次，擋下即丟出例外。

判定訊息都以 `CFD run guard:` 開頭，`deploy.ps1` 會把它寫進 deploy.log；遠端 canonical 部署時（包含 reset 前那次），`rebuild-test-deploy.ps1` 會把這些行印到 operator console。處理方式：等 run 結束或取消（coordinator `POST /api/cfd/runs/<run_id>/cancel`）後重跑。確定要中斷才加 `-AllowInterruptingCfdRuns`（`rebuild-test-deploy.ps1` 與 `deploy.ps1` 都有）；`-Force` 不代表同意，`scripts/stop-all.ps1` 一樣會中斷 run。

## PR safety

```powershell
node --test .github/scripts/pr-safety.test.mjs
node .github/scripts/pr-safety.mjs --base <40-character-base-sha> --head <40-character-head-sha>
node --test .github/scripts/ci-scope.test.mjs
```

`pr-safety` 是 `main` 唯一的 required check，本身不跑檢查，只把 `.github/workflows/pr-safety.yml` 其他 job 的結果轉成判定。diff whitespace/conflict-marker、changed JSON、changed PowerShell 與新增行秘密模式在 `safety` job，它沒有 `needs`／`if:`，每個 PR 都與 `changes` 及 service jobs 並行起跑；其餘 service jobs 由 `.github/scripts/ci-scope.mjs` 依 changed paths 選出。

| CI job | 對應本機命令 | Runner |
|---|---|---|
| `safety` | `node --test .github/scripts/pr-safety.test.mjs`、`node .github/scripts/pr-safety.mjs --base … --head …` | ubuntu（每個 PR 都跑） |
| `coordinator` | `npm test`、`npm run build`、`npm run contract:check` | ubuntu |
| `viewer` | `npm test`、`npm run typecheck`、`npm run build`、`npm run test:session-first`、`npm run test:struct-log` | ubuntu |
| `governance` | `pytest tests` | ubuntu |
| `streaming` | `pytest tests` | **windows**（`tests/test_host_native_conversion_service.py` 的 IFC→USDC adapter 要解析 `powershell.exe`，5 個測試無 `os.name` 守門，在 Linux 會以 `converter_unavailable` 失敗） |
| `cfd_tools` | `tools/cfd` 的 `pytest tests` | ubuntu |
| `kit_manager_api` | `pytest tests` | ubuntu |
| `kit_manager_web` | `npm run build` | ubuntu |
| `root_contracts` | `pytest tests` | ubuntu |
| `vocabulary` | `npm run generate:kit-command-vocabulary -- --check` | ubuntu |

分類規則與判定邏輯都在 `ci-scope.mjs`，並由 `ci-scope.test.mjs` 鎖住：未對應到任何規則的路徑一律 fan-out 到全部 scope；改到 workflow 或 classifier 本身也是全部 scope。`root_contracts` 讀每個 service 各一個 parity 來源檔，所以任一 service 原始碼變更都會帶到它。

CI 不跑 browser/Kit/WebRTC/GPU E2E、`scripts/tests/*.ps1` 與 compose config；這些仍照本檔上方各節在本機與真站執行。`streaming` 只在 windows runner 跑，該檔的 POSIX 程序圍堵測試（`skipif(os.name == "nt")`，8 項）在 CI 不會執行；`web-viewer-sample/e2e/support/isolated-stack.test.ts` 的真 pwsh 測試同理只在 Windows 本機驗證。
