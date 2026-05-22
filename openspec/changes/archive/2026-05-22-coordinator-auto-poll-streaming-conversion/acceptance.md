# Acceptance — coordinator-auto-poll-streaming-conversion

## L1 — Unit / vitest

- `cd bim-review-coordinator && npm run verify` **PASS**(168 既有 + ~6 新 case 全綠)
- `cd bim-streaming-server && python -m pytest tests -q` **PASS**(streaming-server 不動,regression)
- `python -m pytest tests -p no:cacheprovider` **PASS**(root contracts / fakes)

## L2 — OpenSpec validate

- `npx openspec validate coordinator-auto-poll-streaming-conversion --strict` **valid**
- `npx openspec validate --specs --strict` **all passed**(本 change archive 之後仍綠)

## L3 — GitNexus

- Pre-impact:`fetchConversionResult` / `createConversionJob` / `createCoordinatorApp` 全 **LOW / MEDIUM**;任一 HIGH/CRITICAL 先回報
- Post-change `detect_changes`:staged file set = `config.ts` + `streamingConversionClient.ts` + `app.ts` + `tests/*.test.ts` + openspec change folder

## L4 — 真實 runtime end-to-end(no manual ingest)

- `docker compose ... up -d --force-recreate coordinator`(讀含本 change 的新 code)
- streaming-server 仍跑(STORAGE_ROOT absolute)
- Python urllib 等效 Postman:
  1. POST /api/external/ifc-ready → 202 dispatched
  2. **不**手動 POST internal ingest endpoint
  3. 等 5 秒 → coordinator 第一次 poll
  4. 等 streaming-server 完成轉檔(~40s)→ 下次 poll 拿 ready → 自動 ingest
  5. GET /api/external/ifc-ready/<job> 看 `conversion_status: ready` + `viewer_url: http://...` 自動出現
- 預期 total < 90 秒 從 dispatch 到 viewer_url 出現

## L5 — UI(optional)

- 點開 viewer_url(`http://127.0.0.1:8004/ui/open?session=<lwv_id>`)→ 302 redirect 到 `127.0.0.1:5173/?session=<id>`,viewer 全螢幕 stream

## Stop conditions

任一 L1-L4 不 pass:stop,回報。

不要為 acceptance 而 hack(例如把 poller default 設超短 interval 來避過 max attempts test、跳 idempotent check 來讓 reuse 通過)。
