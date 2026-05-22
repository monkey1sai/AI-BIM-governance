## Why

fast-mvp loop 三段 archive 收尾後(2026-05-22 L4 真實驗證,見 archive `streaming-server-prefer-local-ifc-path` 與 PR #94/#95/#96/#97),`POST /api/external/ifc-ready` → coordinator dispatch → streaming-server 真實轉檔 succeeded(40s)— **但 coordinator 端的 `conversion_status` 永遠停在 `queued`**,因為:

- `streamingConversionClient.fetchConversionResult` 雖然存在(由 `POST /api/internal/conversions/<id>/ingest` 呼叫),但**沒有任何自動 caller**
- 既有 spec `Coordinator ingests host-native conversion result into callback outbox`(line 86-107)寫「SHALL ingest through polling, an internal result loop, or an equivalent internal callback」,**polling 與 internal result loop 都沒實作**
- 要拿到 `viewer_url` 必須外部手動戳 `POST /api/internal/conversions/<id>/ingest`(L4 用 Python urllib 模擬才走通)

對 fast-mvp demo / 自動化測試 / 真實 user flow,**這條 manual 觸發是 broken UX**。本 change 補實 spec 已宣告但未實作的 polling 行為,讓 coordinator dispatch 成功後自動 poll streaming-server,terminal 時自動 ingest,viewer_url 自然出現,不需要外部介入。

## What Changes

### 修改 — `bim-review-coordinator` streamingConversionClient

- 加 method `pollConversionResult(conversionJobId, options): { cancel: () => void }`:
  - In-process `setTimeout` chain(避免 setInterval overlap)
  - 每 `intervalMs`(default `config.conversionPollIntervalSeconds * 1000`)拉一次 `fetchConversionResult`
  - 遇 terminal(`status in {succeeded, succeeded_with_warnings, failed, cancelled}` 或 `model_status in {ready, failed}`)→ call `onTerminal(result)`,return,不再 schedule
  - `attempts >= maxAttempts` → call `onTerminal({ status: "poll_timeout", ... })` 然後 stop
  - 回傳 `cancel()`:清掉 pending timer
- 既有 `fetchConversionResult` 不動

### 修改 — `bim-review-coordinator/src/app.ts`

- Refactor 既有 `POST /api/internal/conversions/:conversionJobId/ingest` handler 內的 ingest 邏輯抽成共用 helper `ingestStreamingConversionResult(conversionJobId, options)`(可帶 `source` flag 區分 manual / auto-poll)
- Dispatch 成功(`markDispatched` 之後)→ 用 `pollerRegistry: Map<conversion_job_id, { cancel }>` 檢查既有 poller;沒有則 `setImmediate(() => streamingConversionClient.pollConversionResult(conversion_job_id, { onTerminal: result => ingestStreamingConversionResult(result, { source: "auto-poll" }).catch(logger.warn) }))`
- `pollerRegistry` 在 terminal ingest 之後 `delete(conversion_job_id)`
- `POST /api/internal/conversions/:id/ingest` handler 內也清 registry(避免 auto poller 重複 ingest)
- `app.close()` / `httpServer.close()` shutdown hook 清空所有 poller(防止 process exit 卡住)

### 修改 — `bim-review-coordinator/src/config.ts`

- 加 `conversionPollEnabled: boolean`(env `CONVERSION_POLL_ENABLED`,default `true`)
- 加 `conversionPollIntervalSeconds: number`(env `CONVERSION_POLL_INTERVAL_SECONDS`,default `5`)
- 加 `conversionPollMaxAttempts: number`(env `CONVERSION_POLL_MAX_ATTEMPTS`,default `60`,= 5 min total)

### 加 — pytest / vitest 覆蓋

- `bim-review-coordinator/tests/`(新 test file 或加在既有 file):
  - dispatch 成功後 auto poller 起來,fetchConversionResult mock 回 ready → 自動 ingest 走 callback + auto-session
  - dispatch 成功後 auto poller 起來,fetchConversionResult mock 回 failed → 自動 ingest 走 failed callback
  - 重複 dispatch(idempotent replay)不雙 poller
  - max attempts 後 timeout → coordinator 端標 conversion_status failed
  - 手動 POST `/api/internal/conversions/<id>/ingest` 觸發後 auto poller cancel
  - shutdown hook 清空 poller

### OpenSpec deltas finalize

- `openspec/changes/coordinator-auto-poll-streaming-conversion/specs/conversion-webhook-lifecycle/spec.md`:`## MODIFIED Requirements` 修既有 `Coordinator ingests host-native conversion result into callback outbox`,加 SHALL 自動 poll 子條款 + 對應 Scenario

### 明確排除(本 change 不做)

- 不改 streaming-server 端(streaming-server 仍 fire-and-forget,不主動 callback coordinator)
- 不持久化 poller state(coordinator restart 後 in-memory timers lost;手動 endpoint 仍可救;持久化留給 distributed deploy follow-up)
- 不解雲端 callback outbox retry / dead-letter(`Cloud callback is unreachable after conversion succeeds` 既有 scenario 不變)
- 不改 dispatch payload / `/result` schema
- 不引入第三方 scheduler library

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `conversion-webhook-lifecycle`:MODIFIED 1 個 requirement(`Coordinator ingests host-native conversion result into callback outbox` 加 auto-poll 子條款)+ ADD 新 scenario

### Removed Capabilities

- None.

## Impact

- Owner repo/folder:`bim-review-coordinator/src/`、`bim-review-coordinator/tests/`
- API:`POST /api/external/ifc-ready` 行為延伸(成功後自動啟動 poller,API response 不變);`POST /api/internal/conversions/:id/ingest` 行為延伸(觸發後 cancel auto poller);新 env `CONVERSION_POLL_ENABLED` / `CONVERSION_POLL_INTERVAL_SECONDS` / `CONVERSION_POLL_MAX_ATTEMPTS`
- Data structure:無 store schema 變動(`externalIfcReadyStore` 內 conversion_status 由 ingest helper 寫,既有)
- Affected integration:streaming-server 不動;coordinator 自治
- Affected symbols(apply 前需 GitNexus impact analysis):`StreamingConversionClient.fetchConversionResult`、`createConversionJob`、`POST /api/internal/conversions/:id/ingest` handler body、`createCoordinatorApp`、`loadConfig`
- Tests/contracts:加 ~6 vitest case;既有 168 tests 不破
- Dependencies:無新 prod dependency(Node.js stdlib `setTimeout` / `clearTimeout`)
- Predecessor:`streaming-server-prefer-local-ifc-path`(PR #96 / PR #97 archived 2026-05-22)+ PR #94 / PR #95 hotfix bundle
- Acceptance verification:L1 vitest unit;L1 既有 168 regression;L4 真實 runtime end-to-end:重啟 coordinator(讀新 code)→ Postman ① → 自動等(不手動 POST ingest)→ ② Poll 看 `viewer_url` 自動出現
- Brainstorming source-of-truth:本次對話 explore Round 1 / Round 2;PR #97 commit message 內 "follow-up:streaming-server consumer ingest auto-trigger" 註記
