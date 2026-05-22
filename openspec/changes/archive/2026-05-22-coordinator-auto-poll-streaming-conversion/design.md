# Design — coordinator-auto-poll-streaming-conversion

## 1. Context

streaming-server-prefer-local-ifc-path archive(2026-05-22)後,L4 真實驗證流程:

```
[POST /api/external/ifc-ready]
  → coordinator dispatch streaming-server `POST /api/conversions/ifc-to-usdc`
  → streaming-server return conversion_job_id, status=queued → running → succeeded
  → coordinator 端 conversion_status 永遠 queued(沒 caller fetch result)
  → 需手動 POST /api/internal/conversions/<id>/ingest 才完成 setViewerLink
```

本 change 補實 spec `Coordinator ingests host-native conversion result into callback outbox` 的 "through polling, an internal result loop, or an equivalent internal callback" 但實作缺失的部分。

## 2. Resolution shape

**選 polling (option A) 而非 streaming-server push callback (option B)** 理由:

- A 只動 coordinator 一邊,streaming-server PR #96 剛 merged,不想再動
- B 雖然更 react,但需要 streaming-server 知道 coordinator internal URL + env + 失敗 retry 處理(複雜度高)
- Polling 對 fast-mvp scale(個位數 concurrent jobs)overhead 可忽略

## 3. Component layout

```
streamingConversionClient:
  - fetchConversionResult(id)                       (既有,不改)
  - createConversionJob(...)                        (既有,不改)
  + pollConversionResult(id, opts)                  (新)
    └── setTimeout chain
        ├── fetchConversionResult(id)
        ├── if terminal → opts.onTerminal(result), stop
        ├── if attempts >= maxAttempts → opts.onTerminal({status:"poll_timeout"}), stop
        └── schedule next

app.ts:
  + pollerRegistry: Map<conversion_job_id, { cancel: () => void }>
  + ingestStreamingConversionResult(id, {source}): refactor 自既有 handler body
  modify POST /api/external/ifc-ready handler:
    ...markDispatched(conversion_job_id)
    if (config.conversionPollEnabled && !pollerRegistry.has(conversion_job_id)) {
      const handle = streamingConversionClient.pollConversionResult(conversion_job_id, {
        intervalMs: config.conversionPollIntervalSeconds * 1000,
        maxAttempts: config.conversionPollMaxAttempts,
        onTerminal: async (result) => {
          try {
            await ingestStreamingConversionResult(conversion_job_id, { result, source: "auto-poll" });
          } catch (err) {
            logger.warn({ err }, "auto-poll ingest failed");
          } finally {
            pollerRegistry.delete(conversion_job_id);
          }
        },
      });
      pollerRegistry.set(conversion_job_id, handle);
    }
  modify POST /api/internal/conversions/:id/ingest handler:
    const existing = pollerRegistry.get(conversionJobId);
    existing?.cancel();
    pollerRegistry.delete(conversionJobId);
    // call ingestStreamingConversionResult(conversionJobId, { source: "manual" })

  shutdown:
    httpServer.close + for [_, h] of pollerRegistry: h.cancel()

config.ts:
  + conversionPollEnabled: boolean       (env CONVERSION_POLL_ENABLED, default true)
  + conversionPollIntervalSeconds: number (env CONVERSION_POLL_INTERVAL_SECONDS, default 5)
  + conversionPollMaxAttempts: number    (env CONVERSION_POLL_MAX_ATTEMPTS, default 60)
```

## 4. Terminal detection

對齊既有 `POST /api/internal/conversions/:id/ingest` handler line 898-907 的判斷:

```ts
const failed = result.model_status === "failed" ||
               result.status === "failed" ||
               result.status === "cancelled";
const ready = !failed && (
  result.ready === true ||
  result.model_status === "ready" ||
  result.status === "succeeded" ||
  result.status === "succeeded_with_warnings"
);
const terminal = failed || ready;
```

`pollConversionResult` 用同一 detection;非 terminal → schedule next。

## 5. Poll timeout 處理

`attempts >= maxAttempts` 觸發 `onTerminal({ status: "poll_timeout", conversion_job_id })`:

- ingestStreamingConversionResult 收到後視為 failed-equivalent
- externalIfcReadyStore 標 conversion_status `poll_timeout`(新 enum 值或映射 failed)
- callback outbox enqueue `conversion_failed` with reason="poll_timeout"
- 不自動重啟 poller(留給後續 ops decision;手動 endpoint 仍可救)

## 6. Idempotency / cleanup

| 情境 | 行為 |
|---|---|
| 重複 dispatch(相同 conversion_job_id;不應發生但防呆) | `pollerRegistry.has(id)` 檢查,既有就 reuse,不雙起 |
| Coordinator restart | in-memory `Map` lost;in-flight conversion 後續仍可手動 POST `/api/internal/conversions/<id>/ingest` ingest |
| Manual ingest endpoint 被呼叫 | cancel + delete registry entry,避免 auto poller 後續 ingest 同個 result(double callback) |
| Process shutdown | `app.close()` 或 SIGTERM handler 遍歷 registry cancel 所有 timer,避免 keep-alive 阻 exit |

## 7. Backward compatibility

- `POST /api/external/ifc-ready` response 不變(202 dispatched,僅後台 schedule poller)
- `POST /api/internal/conversions/:id/ingest` response 不變(同樣的 callback / session payload)
- 既有 test 不破:既有 vitest 內若有 dispatch flow test,需 `config.conversionPollEnabled: false`(test fixture override)避免 poller 啟動干擾
- env 不設 = default 啟用 polling(行為 net change)

## 8. Observability

- 加 log:poller start / poll attempt / terminal / timeout(structured,既有 pino-style)
- 不新增 metric(本 change 不引入 metric framework)

## 9. Why not setInterval?

`setInterval` 在 callback 慢時可能 overlap(下一個 tick 在前一個 fetch 還沒完成就跑);`setTimeout` chain 永遠先等前一個 result 才 schedule next,確保 sequential。

## 10. Failure modes

| Mode | Behavior |
|---|---|
| streaming-server `/result` 502/network error | 視為 non-terminal,schedule next(retry next interval);不立即失敗 |
| streaming-server return 結構不符 schema | 同上(轉檔仍在跑) |
| streaming-server `/result` 404(job 不存在) | 立即 onTerminal({status:"failed", error:"conversion_not_found"}),stop |
| Coordinator ingestStreamingConversionResult 拋錯 | log + 不重試(下次 manual endpoint 可救);registry 仍 delete |
