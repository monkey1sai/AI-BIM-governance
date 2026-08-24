# kit-message-probe — Kit DataChannel 訊息時序探針

在一顆**完全隔離**的 Kit instance 上，量測 WebRTC DataChannel 上的
request/response 時序：送出 N 則命令、進入一段完全靜默的觀察窗、逐秒取樣
`getStats()`，最後輸出一份可重複比對的 JSON。

三個檔案，彼此獨立可替換：

| 檔案 | 角色 |
|---|---|
| `start-isolated-kit.ps1` | 啟動／停止／查詢一顆隔離 Kit（預設 signal 49131、stream 48031），不接 coordinator |
| `probe.html` | 觀測用頁面：Proxy `RTCPeerConnection` 取得 raw DataChannel，並提供 `__send` / `__arrived` / `__snapshot` / `__stats` |
| `driver.mjs` | CDP driver：自帶 loopback static server、開真 Chrome、跑模式、寫 JSON |

---

## 1. 這支工具解決什麼問題

要回答「Kit 對 DataChannel 命令的回應時序是什麼樣子」這類問題，需要一個
**可拋棄、不污染部署區、可完整重跑**的觀測環境。臨時湊出來的 harness 做不到這件事，
因為它每次都要從零重造，而重造就會重犯同樣的錯。

### 1.1 為什麼它必須留在 repo（#671 的教訓）

issue #671 原本的結論是「尾則出站 hold」：最後一則命令送出後被卡住。
**這個現象不存在。** 它是前一輪實驗 harness 的 CDP bug 造成的假觀測：

> `Runtime.evaluate` 同時帶 `replMode: true` 與 `awaitPromise: true` 時，
> `replMode` 會**靜默抑制** `awaitPromise`。仍在 pending 的 Promise 被直接回傳，
> `returnByValue` 把它序列化成 `{}`。呼叫端看到的是一個空物件，不是錯誤。

`probe.html` 上所有的觀測 accessor（`__stats()`、`__statsFull()`）都是 async。
所以這一個 flag 決定了整輪實驗到底有沒有量到東西。

**同一個 bug 在複驗時又踩了一次。** 複驗探針第一版的 stats 全空，直到 driver 修掉
`replMode` 才恢復。這件事在原始資料裡是可查的：早於修正的 run（`n1a` / `sq` / `b1`）
`statsBefore.pcs` 缺欄位、`statsSeries[0]` 是 `{}`；晚於修正的 run（`n1b` / `pb16`）
兩者都有完整內容。

兩次踩同一個坑，結構性原因就是**這類 harness 每次都要從頭重造**。
這支工具存在的唯一理由，就是讓第三次不要發生。

---

## 2. 前置需求

- Windows（`kit.exe`、`Get-NetTCPConnection`、Chrome 皆為 Windows 路徑假設）
- Node.js >= 22（用到內建 `WebSocket`、`fetch`、`node:util` 的 `parseArgs`）
- 已建置的 Kit：`bim-streaming-server\_build\windows-x86_64\release\kit\kit.exe`
  與 `apps\ezplus.bim_review_stream_streaming.kit`
  （沒有的話先跑 `.\bim-streaming-server\repo.bat build`）
- `web-viewer-sample` 已安裝相依（提供 NVIDIA streaming library；否則先 `npm ci`）
- **不需要任何額外套件**。driver 只用 Node 內建模組。

---

## 3. 逐步重跑

以下命令都從 repo root 執行。

### 步驟 1 — 啟動隔離 Kit

```powershell
.\scripts\dev\kit-message-probe\start-isolated-kit.ps1 -Action start -Verbose
```

成功時回傳一個物件（`status = ready`、`kit_pid`、`log_path`、`manifest_path`），
並在 work root 寫下 `run-manifest.json`、`kit.log`、`kit.pid`。
埠被佔用、build 不存在、或在 timeout 內沒 listen，都會**直接 throw**（見 §6）。

### 步驟 2 — 跑一輪探針

```powershell
node .\scripts\dev\kit-message-probe\driver.mjs --mode pipe16 --label pb16 --observe-sec 120
```

driver 會自己：起 loopback static server → 開 headless Chrome → 等串流 ready →
送命令 → 觀察 → 寫 `<out-dir>\<label>.json` → 收乾淨（關 ws、關 Chrome、關 server）。

終端最後一行是單行摘要 `PROBE_RESULT {...}`，方便直接被上層腳本吃掉。

### 步驟 3 — 收工

```powershell
.\scripts\dev\kit-message-probe\start-isolated-kit.ps1 -Action stop
```

`stop` 只會殺**自己記錄過、且仍是位於同一個 build tree 下的 `kit.exe`** 的 PID。
PID 被回收或指向別的行程時回 `stale_pid_cleared`，不會誤殺。

隨時可查：

```powershell
.\scripts\dev\kit-message-probe\start-isolated-kit.ps1 -Action status
```

---

## 4. 參數

### 4.1 `start-isolated-kit.ps1`

| 參數 | 預設 | 說明 |
|---|---|---|
| `-Action` | `start` | `start` / `stop` / `status` |
| `-SignalPort` | `49131` | Kit WebRTC signalling port |
| `-StreamPort` | `48031` | Kit WebRTC media port |
| `-InstanceId` | `kit_probe_001` | 寫進 `KIT_INSTANCE_ID` 與 manifest；本情境下純資訊性（見 §7.2） |
| `-PublicIp` | `127.0.0.1` | `primaryStream/publicIp` |
| `-PortableRoot` | `<WorkRoot>\portable` | Kit `--portable-root` |
| `-WorkRoot` | 見下 | log / pid / manifest / portable 的根目錄 |
| `-AllowedStageHosts` | `127.0.0.1:49101,localhost:49101` | `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` |
| `-ReadyTimeoutSeconds` | `300` | 等 signalling port listen 的上限（10–1800） |
| `-KeepOnTimeout` | off | 逾時時**不**殺子行程，留著人工檢查 |
| `-RepoRoot` | 由 `$PSScriptRoot` 往上三層 | 覆寫 repo root |

`WorkRoot` 解析順序：`-WorkRoot` → 環境變數 `KIT_MESSAGE_PROBE_WORK_ROOT` →
`<repo>\artifacts\tmp\kit-message-probe`（`artifacts/tmp/` 在 `.gitignore` 內）。

### 4.2 `driver.mjs`

每個選項都可用 CLI flag 或環境變數，優先序：**CLI flag > env > 預設值**。

| flag | env | 預設 | 說明 |
|---|---|---|---|
| `--mode` | `KIT_PROBE_MODE` | `single` | `single` / `seq<N>` / `burst<N>` / `pipe<N>` |
| `--label` | `KIT_PROBE_LABEL` | 同 `--mode` | 輸出檔名與 request id 前綴 |
| `--out-dir` | `KIT_PROBE_OUT_DIR` | `<repo>\artifacts\tmp\kit-message-probe\out` | JSON 與 Chrome profile 落點 |
| `--observe-sec` | `KIT_PROBE_OBSERVE_SEC` | `120` | 主觀察窗秒數 |
| `--tail-observe-sec` | `KIT_PROBE_TAIL_OBSERVE_SEC` | `60` | T2 解阻探測的第二段觀察窗 |
| `--ready-timeout-sec` | `KIT_PROBE_READY_TIMEOUT_SEC` | `90` | 等 `AppStreamer` ready 的上限 |
| `--signal-port` | `KIT_PROBE_SIGNAL_PORT` | `49131` | 要對上 §4.1 的 `-SignalPort` |
| `--server` | `KIT_PROBE_SERVER` | `127.0.0.1` | signalling / media host |
| `--http-port` | `KIT_PROBE_HTTP_PORT` | `8799` | 內建 static server（只綁 127.0.0.1） |
| `--cdp-port` | `KIT_PROBE_CDP_PORT` | `9333` | Chrome remote debugging port |
| `--chrome-path` | `KIT_PROBE_CHROME_PATH` | 標準 Chrome 安裝路徑 | Chrome 執行檔 |
| `--session-id` | `KIT_PROBE_SESSION_ID` | `review_session_probe0001` | payload `session_id` |
| `--trace-id` | `KIT_PROBE_TRACE_ID` | 空 → 頁面用 `rev_<sessionId>` | payload `trace_id` |
| `--event-type` | `KIT_PROBE_EVENT_TYPE` | `loadingStateQuery` | 要送的 DataChannel `event_type` |
| `--library-path` | `KIT_PROBE_LIBRARY_PATH` | `web-viewer-sample/node_modules/@nvidia/...` | NVIDIA streaming library |
| `--profile-dir` | `KIT_PROBE_PROFILE_DIR` | `<out-dir>\chrome-<label>` | Chrome user-data-dir（每輪先清空） |
| `--repo-root` | `KIT_PROBE_REPO_ROOT` | 由腳本自身位置往上三層 | 覆寫 repo root |
| `--headed` | — | off | 不加 `--headless=new`，開有頭 Chrome |

**只吃具名 flag，不吃 positional 參數。** 打錯字會直接報錯，不會被靜默當成別的意思。

`probe.html` 本身沒有任何環境知識，全部由 driver 透過 query string 餵進去：
`signalPort` / `server` / `sessionId` / `traceId` / `eventType` / `maxReconnects`。

### 4.3 模式語意

| mode | 行為 |
|---|---|
| `single` | 送 **1** 則，之後完全靜默 `observe-sec` 秒 |
| `seq<N>` | 送 N 則，**每則都等前一則的回應到了才送下一則**，第 N 則之後靜默 |
| `burst<N>` | N 則，每則間隔 1 秒；靜默 `observe-sec`；再補一則 `t2-unblock`，再靜默 `tail-observe-sec` |
| `pipe<N>` | N 則在**同一個同步 JS 迴圈內背靠背送出**（零間隔、零 await）；靜默後若仍有缺回應，才送 `t2-unblock` 並再觀察 |

`seq10`、`burst3`、`pipe16` 就是 `seq`/`burst`/`pipe` 帶 N 的寫法。

---

## 5. 輸出 JSON 欄位

檔案落在 `<out-dir>/<label>.json`（`label` 會先做檔名安全化）。

### 頂層

| 欄位 | 說明 |
|---|---|
| `schemaVersion` | 目前為 `1`；欄位語意變更時遞增 |
| `mode` / `label` | 本輪模式與標籤 |
| `params` | **完整回填**的解析後參數（port、session、library 路徑等），讓 JSON 自我描述、可重跑 |
| `startedAt` / `endedAt` | ISO 時間 |
| `ready` | `AppStreamer` 是否成功建立串流 |
| `failed` | ready 失敗原因（含 ready timeout） |
| `error` | 執行期例外字串；正常時不存在 |
| `statsBefore` / `statsAfter` | 首則命令前 / 全部結束後的完整 `getStats()` dump |
| `statsSeries` | 觀察窗內**逐秒**的精簡 stats（見下） |
| `marks` | 主觀察窗的取樣點 |
| `marks2` | T2 觀察窗的取樣點（`burst` / `pipe` 才有） |
| `seq` | `seq<N>` 模式的逐則 `{rid, arrivedAt, waitedMs}` |
| `pipeSend` | `pipe<N>` 模式的 `{n, spanMs}`——N 則送完實際花掉的毫秒 |
| `missingAfterT1` | `pipe<N>` 主觀察窗結束後仍缺的回應數 |
| `snapshotT1` | T2 之前的頁面快照 |
| `snapshot` | 最終頁面快照（見下） |
| `table` | 逐則的送出／到達相對時間與延遲（見下） |
| `console` | 頁面 console 全文，含 `PROBE_SEND` / `PROBE_RECV` 行 |

### `snapshot`

| 欄位 | 說明 |
|---|---|
| `cfg` | 頁面實際採用的設定（由 query string 解析而來） |
| `t0` | **第一則命令送出**的 epoch ms；所有相對時間的基準 |
| `readyAt` | 串流 ready 的 epoch ms |
| `count` | `onCustomEvent` 收到的訊息總數 |
| `byType` | 依 `event_type` 分桶計數，例如 `{"commandRejected": 16}` |
| `sent[]` | `{request_id, at, ok}`；`ok=false` 時附 `error` |
| `raw[]` | **raw DataChannel 到達紀錄** `{at, label, len, head}`。這是繞過 library 的第一手證據——library 有沒有把某則訊息 surface 出來，比對 `raw` 與 `events` 就知道 |
| `dcs[]` | `{label, origin, state}`。實測會看到 5 條：`input_channel_v1` / `cursor_channel` / `stats_channel`（local）、`control_channel` / `remote_trace_channel`（remote） |
| `events[]` | `{n, at, event_type, rid, detail, reason}`。`rid` 取 `request_id`，沒有時退回 `rejection_id` |

### `table[]`

| 欄位 | 說明 |
|---|---|
| `rid` | request id |
| `sent_rel_ms` | 相對 `t0` 的送出時間 |
| `arr_rel_ms[]` | 相對 `t0` 的到達時間（可能多筆） |
| `latency_ms[]` | 該則的往返延遲 |
| `arrived` | 是否收到對應回應 |

### `statsSeries[]`（每秒一列）

| 欄位 | 說明 |
|---|---|
| `at` | epoch ms |
| `conn` / `ice` | `RTCPeerConnection.connectionState` / `iceConnectionState` |
| `dc.<label>` | `{st, mSent, mRecv, bSent, bRecv}`——該 DataChannel 的 state 與訊息／位元組計數 |
| `tr` | transport 層 `{pSent, pRecv, bSent, bRecv, dtls}` |
| `cp` | 勝出的 candidate-pair `{pSent, pRecv, bSent, bRecv, rtt, reqSent, respRecv}` |
| `error` | 取樣失敗時的字串；**看到 `{}` 或整片 `error` 就是量測本身壞了**，不要拿來下結論 |

---

## 6. Fail-closed 行為

**啟動器**（任一條件成立就 throw，不硬闖）：

- port 落在部署區保留清單（`8004` `8010` `5173` `5174` `49100` `49101` `49102` `47998`、
  spectator signalling `49110/49120/49130/49140/49150`、spectator media `48008/48018/48028/48038/48048`）
- port 已經有人在 listen（**不停掉任何別人的行程**，只報 owning PID）
- `SignalPort == StreamPort`、port 不在 1024–65535、`InstanceId` 不合法
- `kit.exe` 或 `.kit` app 檔不存在（錯誤訊息直接給 build 指令）
- `ReadyTimeoutSeconds` 內沒 listen，或 `kit.exe` 提早退出
  → 預設殺掉自己起的子行程、清掉 pid 檔、throw 並附上 log 尾巴；
  想留現場就加 `-KeepOnTimeout`
- 已有記錄在案且仍存活的 probe Kit → 拒絕重複啟動

**driver**：

- CDP port 已經有瀏覽器在服務 → throw（**絕不 attach 到別人的瀏覽器**）
- HTTP port 被佔用 → throw 並提示改 `--http-port`
- streaming library 找不到 → throw 並提示 `npm ci` 或 `--library-path`
- 40 秒內找不到 CDP page target、或 `--ready-timeout-sec` 內串流沒 ready → 記錄後結束
- 任何失敗路徑**仍然會把 JSON 寫出來**（保留現場），但 process exit code 為 `1`

---

## 7. 什麼時候該用、什麼時候**不該**用

### 7.1 該用

- 量 DataChannel 上 request→response 的延遲分佈
- 比較 pipeline（`pipe<N>`）與逐則等待（`seq<N>`）的行為差異
- 驗證某個「訊息卡住／掉了」的假說——`raw` 與 `events` 的落差就是答案
- 需要一個**乾淨、可拋棄、不碰部署區**的 Kit 來重現現象

### 7.2 不該用

- **任何依賴活著的 coordinator 的假說。** 這是最重要的一條。
  啟動器刻意清空 `COORDINATOR_INTERNAL_API_BASE` 與 `INTERNAL_API_AUTH_TOKEN`，
  `RuntimeAuthorityClient` 因此判定設定無效，**根本不會發出任何 socket**，
  直接走 `authority_unavailable` 分支。實測結果：每一則 `loadingStateQuery` 都回
  `commandRejected` / `reason=lease_invalid` / `detail_code=authority_unavailable`。
  在這裡「量不到 coordinator 往返」不是發現，是這個 harness 的定義。
  要測授權、lease、trace 驗證的**成功路徑**，必須用接了 coordinator 的正規環境。
- **不要拿它當部署區的 smoke test。** 它跑的是另一顆 Kit、另一組 port、
  另一個 portable root，什麼都不共用。
- **不要拿它量畫面／影像品質。** 頁面只掛了一個 320×180 的 `<video>` 供 library 綁定，
  沒有任何影像正確性檢查。
- **不要在部署區正在跑的時候，把 port 覆寫成部署區的 port。** 保留清單會擋，
  但別去繞它。

---

## 8. 已知限制

1. **標準 `getStats()` 不暴露 SCTP 重傳計數。** `RTCDataChannelStats` 只有
   `messagesSent/Received`、`bytesSent/Received`；`RTCTransportStats` 的封包計數是
   整條 DTLS transport（與 media 共用）的總量。所以「某則訊息在 SCTP 層重傳了幾次」
   **無法**從這份輸出回答；要回答只能改用 `chrome://webrtc-internals` dump 或
   native 抓包，那是另一個工具的範圍。
2. `statsSeries` 是**每秒一次**取樣，抓不到次秒級的瞬間尖峰。
3. `chrome.kill()` 在 Windows 上不保證回收所有子行程；`--profile-dir` 每輪會先清空，
   但殘留的 Chrome helper process 偶爾要人工清。
4. 只跑得動 Windows。`Get-NetTCPConnection` 與 `kit.exe` 都是 Windows-only。
5. `-InstanceId` 在這個隔離情境下沒有消費者（沒有 coordinator、沒有 Kit manager），
   它只是被寫進環境變數與 manifest，方便和正規啟動器對照。
6. 啟動器刻意**不**引用 `scripts/lib/StructLog.psm1` 與 deploy-target registry，
   為的是在只有 `bim-streaming-server/_build` 的裸 checkout 上也跑得起來。
   代價是它不產生 structured log，只回傳物件 + `run-manifest.json`。
7. **不要把 `-Action start` 的輸出接進 pipe**（例如 `| tail`、`| Select-Object`）。
   `Start-Process` 起的 `kit.exe` 會讓 stdout handle 保持開啟，pipe 讀端因此等不到
   EOF，呼叫端會**看似掛住**——但腳本其實早就回傳了，Kit 也已經 ready。
   判斷是否成功要看 `run-manifest.json` 是否寫出、以及 signal port 是否 listening，
   不要看 pipe 有沒有吐東西。要留存輸出就重導向到檔案（`> start.log 2>&1`）再讀檔。
   `-Action stop` / `-Action status` 沒有這個問題。

---

## 9. 埠位政策

預設 **49131 / 48031** 是實測可用值，落在部署區實際綁定的 spectator 埠之間的空隙
（signalling 綁的是 49110/49120/49130/49140/49150，media 綁的是
48008/48018/48028/48038/48048）。

但要注意：`scripts/dev/start-isolated-branch-stack.ps1` 把 **整段 `49110..49150`**
列為保留（保守作法），49131 在那段裡面。所以**同時**跑 isolated branch stack 時，
請用 `--signal-port` / `-SignalPort` 換一個段外的埠。啟動器的 listen 檢查會在真的撞上時擋下來。

driver 的 CDP 預設 **9333**，刻意避開 `scripts/verify-runtime-e2e-cdp.mjs` 的
`RUNTIME_E2E_CDP_PORT` 預設值 9223——兩個 harness 共用 CDP port 會互相驅動對方的瀏覽器，
而且不會報錯。

---

## 10. 維護：最容易改壞的兩個地方

改動這個目錄前，先看這兩條。

1. **`driver.mjs` 的 `evaluate()` 絕對不要打開 `replMode`。**
   程式碼裡是顯式寫成 `replMode: false` 並附註解，就是為了讓下一個人看到這個開關的名字。
   打開它 → 所有 async accessor 回 `{}` → 整輪實驗量到空氣，而且**不會報錯**。
   這就是 #671 那個不存在的「尾則出站 hold」的來源（§1.1）。

2. **`probe.html` 的 `__send()` 必須 fire-and-forget。**
   `AppStreamer.sendMessage()` 回傳的 Promise 永遠不會 resolve——它等的 ack
   不是 Kit messaging extension 會產生的東西。`await` 它（或用
   `awaitPromise: true` 去 evaluate 一個會回傳它的 wrapper）會在第一則命令就死鎖，
   而現象看起來**和「Kit 不回應了」一模一樣**。
   到達與否一律靠 `onCustomEvent` / `__arrived()` 觀測，永遠不看 `sendMessage()` 的回傳值。

其他維護提醒：

- `probe.html` 用 `import './omniverse-webrtc-streaming-library.js'`，這個路徑由
  driver 的 static server 對映到 `web-viewer-sample` 的 `node_modules`。
  **不要**把那份 700 KB 的 library 複製進 repo。
- §6 的保留埠清單是**鏡像**，不是引用。正本在
  `scripts/dev/start-isolated-branch-stack.ps1`、`scripts/deploy.ps1` 與
  `scripts/.run/bim-streaming-server.params.json`；那邊變了要同步這裡。
- 輸出 JSON 的欄位語意若變更，請把 `schemaVersion` 加一並更新 §5。
