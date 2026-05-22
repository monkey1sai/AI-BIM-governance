# Acceptance — streaming-server-capture-kit-conversion-logs

## L1 — Unit / pytest

- `cd bim-streaming-server && python -m pytest tests -q` **PASS**(31 既有 + 1-2 新)
- `cd bim-review-coordinator && npm run verify` **PASS**(173 既有,coordinator 不動)
- `python -m pytest tests -p no:cacheprovider` **PASS**(9 既有)

## L2 — OpenSpec validate

- `npx openspec validate streaming-server-capture-kit-conversion-logs --strict` **valid**
- `npx openspec validate --specs --strict` **26 passed**

## L3 — GitNexus

- Pre-impact:`_run_powershell_conversion` / `convert` LOW;任一 HIGH/CRITICAL 先回報
- Post-change `detect_changes`:scope = `convert-ifc-to-usdc.ps1` + `ifc2usdc_powershell_adapter.py` + `host_native_conversion_service.py`(若改了)+ tests + openspec change folder

## L4 — 真實 runtime end-to-end

- 重啟 streaming-server 讀新 code(`taskkill //F //PID <pid>` + 重 launch with STORAGE_ROOT)
- 用 user 真實 IFC URL(341MB)透過 Postman / Python urllib 重跑 happy path
- 預期 `GET /api/conversions/<conv>/result` 的 `error` 物件 **含 `kit_stdout_log` 與 `kit_stderr_log` host absolute path**
- 直接 `tail` 對應 file → 能看到 Kit subprocess 完整 stdout/stderr → 知道為何 silent fail(non-goal:本 change 不解 Kit 本身;但拿到 log 之後 user / 下一個 change 可以 debug)

## L5 — UI(N/A)

本 change 不動 UI;`/ui` 行為不變(failed flow 仍走相同 callback,viewer_url 仍 null)。

## Stop conditions

任一 L1-L4 不 pass:stop,回報。

不為 acceptance hack(例如測試只 stub 不真實 redirect、ps1 fake message 不真實去抓 Kit subprocess output)。
