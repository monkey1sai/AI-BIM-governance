# Tasks — coordinator-auto-poll-streaming-conversion

> `/goal` 視這份 tasks.md 為**參考路徑**;acceptance condition 見 `acceptance.md`。任一 task 失敗 stop 給人類。

## 0. Pre-implementation setup

- [x] 0.1 切 worktree + branch(`codex/openspec/coordinator-auto-poll-streaming-conversion` from `origin/main`)
- [x] 0.2 寫 proposal / design / tasks / acceptance / spec deltas
- [x] 0.3 GitNexus reindex(已 background 跑完,index = 29fbe3e)
- [ ] 0.4 Commit scaffold(本 task 完成後)

## 1. GitNexus pre-impact analysis

- [ ] 1.1 `gitnexus_impact({target:"fetchConversionResult", direction:"upstream"})`
- [ ] 1.2 `gitnexus_impact({target:"createConversionJob", direction:"upstream"})`
- [ ] 1.3 `gitnexus_impact({target:"createCoordinatorApp", direction:"upstream"})`
- [ ] 1.4 `gitnexus_impact({target:"loadConfig", direction:"upstream"})`
- [ ] 1.5 任一回 HIGH/CRITICAL → stop,回報後等使用者裁定

## 2. config.ts 加 polling config

- [ ] 2.1 `CoordinatorConfig` interface 加 `conversionPollEnabled` / `conversionPollIntervalSeconds` / `conversionPollMaxAttempts`
- [ ] 2.2 `loadConfig` defaults:`true` / `5` / `60`;env override `CONVERSION_POLL_ENABLED` / `CONVERSION_POLL_INTERVAL_SECONDS` / `CONVERSION_POLL_MAX_ATTEMPTS`
- [ ] 2.3 註解說明 polling 用途與 backward compat

## 3. streamingConversionClient.pollConversionResult

- [ ] 3.1 加 method `pollConversionResult(conversionJobId, options): { cancel: () => void }`
      - options: `intervalMs`, `maxAttempts`, `onTerminal(result)`, optional `fetchImpl`(test inject)
      - setTimeout chain,sequential,不 overlap
      - terminal detection 對齊 既有 ingest handler(§4 in design.md)
      - max attempts → `onTerminal({ status: "poll_timeout", conversion_job_id })`
      - `cancel()` 清 pending timer(不影響已 in-flight fetch)
- [ ] 3.2 既有 fetchConversionResult / createConversionJob 不動

## 4. app.ts refactor + dispatch auto-poll

- [ ] 4.1 抽 ingest helper `ingestStreamingConversionResult(conversionJobId, options)`:
      - 從 既有 `POST /api/internal/conversions/:id/ingest` handler body 抽出
      - 內含 fetchConversionResult(若 options.result 沒帶)、terminal 判定、callbackOutbox.enqueue、autoCreateOrActivateSession、externalIfcReadyStore.recordConversionOutcome
      - 加 `source: "manual" | "auto-poll"` log context
- [ ] 4.2 加 module-scope `pollerRegistry: Map<string, { cancel: () => void }>`
- [ ] 4.3 `POST /api/external/ifc-ready` handler(dispatch path)`markDispatched` 後:
      - 檢查 `pollerRegistry.has(conversion_job_id)`,有則 skip
      - else `setImmediate(() => { const h = streamingConversionClient.pollConversionResult(...) ; pollerRegistry.set(id, h); })`
- [ ] 4.4 `POST /api/internal/conversions/:id/ingest` handler 開頭:
      - cancel + delete `pollerRegistry.get(id)`
      - rest 改 call `ingestStreamingConversionResult(id, { source: "manual" })`
- [ ] 4.5 加 shutdown hook(`process.on('SIGTERM')` 與 `app.close()` 對應):cancel all pollers

## 5. Vitest cover

- [ ] 5.1 新 file `tests/auto-poll-conversion.test.ts` 或加在既有 `external-ifc-ready.test.ts`:
      - test:dispatch 成功後 poller 啟動,mock fetchConversionResult 第 1 次 queued、第 2 次 ready → 自動 ingest 走 callback outbox + auto-session,viewer_url 出現
      - test:dispatch 成功後 poller 啟動,mock 回 failed → 自動 ingest 走 failed callback,viewer_url 不出現
      - test:重複 dispatch(同 conversion_job_id)不雙起 poller
      - test:max attempts 達到 → poll_timeout,coordinator 端標 failed
      - test:手動 POST `/api/internal/conversions/<id>/ingest` 後 auto poller cancel,不雙 ingest
      - test:`conversionPollEnabled: false` config 不啟 poller(disable knob 生效)
- [ ] 5.2 既有 test 若 dispatch 後依賴特定 behavior,加 `conversionPollEnabled: false` config override 避免 poller 干擾

## 6. OpenSpec spec deltas

- [ ] 6.1 `openspec/changes/coordinator-auto-poll-streaming-conversion/specs/conversion-webhook-lifecycle/spec.md`:
      `## MODIFIED Requirements` 修 `Coordinator ingests host-native conversion result into callback outbox`,加 SHALL auto-poll 子條款 + 3 Scenarios
- [ ] 6.2 `npx openspec validate coordinator-auto-poll-streaming-conversion --strict` 綠
- [ ] 6.3 `npx openspec validate --specs --strict` 整體仍綠

## 7. L1 verification

- [ ] 7.1 `cd bim-review-coordinator && npm run verify`(11 files + 新 case 全綠)
- [ ] 7.2 `cd bim-streaming-server && python -m pytest tests -q`(streaming-server 不動,regression)
- [ ] 7.3 `python -m pytest tests -p no:cacheprovider`(root contracts/fakes)

## 8. L3 GitNexus post-change

- [ ] 8.1 `gitnexus_detect_changes({scope:"all"})` 確認影響面 = config.ts + streamingConversionClient.ts + app.ts + tests
- [ ] 8.2 任一新出現的 unexpected file → stop debug

## 9. L4 真實 runtime end-to-end

- [ ] 9.1 docker compose `--force-recreate coordinator`(讀新 code)
- [ ] 9.2 streaming-server 仍跑(PID 7488,STORAGE_ROOT absolute)
- [ ] 9.3 跑 Postman ① POST /api/external/ifc-ready(用 fixture trick 確保 IFC 真實落地)
- [ ] 9.4 **不**手動 POST `/api/internal/conversions/<id>/ingest`;改觀察 coordinator log + `GET /api/external/ifc-ready/<job>`
- [ ] 9.5 預期:5s 內 coordinator 自動 poll 一次,40s 內 streaming-server succeeded,coordinator 自動 ingest 並 setViewerLink → `viewer_url` 出現

## 10. Commit / Push / PR / Merge

- [ ] 10.1 `git status` 確認 staged file set
- [ ] 10.2 `git add` 指定路徑
- [ ] 10.3 `git commit` 繁中 message
- [ ] 10.4 `git push -u origin codex/openspec/coordinator-auto-poll-streaming-conversion`
- [ ] 10.5 `gh pr create`
- [ ] 10.6 CI green / Reviewer approve / squash merge

## 11. Post-merge sync + archive

- [ ] 11.1 切 archive branch + git mv to `openspec/changes/archive/<YYYY-MM-DD>-coordinator-auto-poll-streaming-conversion/`
- [ ] 11.2 sync `openspec/specs/conversion-webhook-lifecycle/spec.md`(MODIFIED requirement body + scenarios + implementation status note)
- [ ] 11.3 update `docs/plans/AI-BIM-governance-saas-roadmap-2026-05.md`
- [ ] 11.4 archive PR + merge
- [ ] 11.5 worktree closeout + branch delete
- [ ] 11.6 `npx gitnexus analyze --embeddings` final reindex

## 12. Goal done

- [ ] 12.1 §0 ~ §11 全 check
- [ ] 12.2 通知使用者 change archived;fast-mvp loop 真正 fully automated(無需手動 POST ingest)
