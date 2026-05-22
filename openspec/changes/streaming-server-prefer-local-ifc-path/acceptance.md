# Acceptance — streaming-server-prefer-local-ifc-path

## L1 — Unit / pytest

- `cd bim-streaming-server && python -m pytest tests/test_conversion_authority_api.py -q` **PASS**(含新增 5 case)
- `cd bim-streaming-server && python -m pytest tests -q` **PASS**(整 suite regression)
- `cd bim-review-coordinator && npm run verify` **PASS**(11 files / 168 tests,不動 coordinator code)
- `python -m pytest tests -p no:cacheprovider` **PASS**(root contracts / fakes)

## L2 — OpenSpec validate

- `npx openspec validate streaming-server-prefer-local-ifc-path --strict` **valid**
- `npx openspec validate --specs --strict` **all passed**(本 change archive 之後仍綠)

## L3 — GitNexus

- Pre-impact:`_ifc_artifact` / `_resolve_local_ifc` / `_url_to_local_path` 的 upstream impact **LOW / MEDIUM**(內部 utility,d=1 callers 在同 module);任一 HIGH/CRITICAL 先回報
- Post-change `detect_changes`:staged file set = `conversion_authority.py` + `ifc2usdc_powershell_adapter.py` + `tests/test_conversion_authority_api.py` + openspec change folder(無額外飄逸 file)

## L4 — 真實 runtime end-to-end

- `docker rm -f` 既有 coordinator + viewer container
- `docker compose -p ai-bim-web-plane-host-kit ... up -d --build coordinator viewer`(用最新 main code)
- streaming-server host-native 重啟讀新 code
- Python urllib 等效 Postman ① ②(用 collection 預設值或使用者真實 URL):
  - ① POST 預期 `HTTP 202 / dispatched / download_status:downloaded`(PR #94/#95 + 本 change 累積行為)
  - ② Poll 預期 `conversion_status` 從 `queued` **離開 queued**(用 fallback-friendly fixture 至少能 fail with clear error;真實 URL 可達則 ready + viewer_url 出現)
- `docker exec coordinator ls /workspace/storage/ifc-cache/<jobId>/source.ifc` 確認 IFC bytes 真實落地(真實 URL 場景)
- streaming-server log 顯示 path resolution 結果走 host_local_path 分支

## L5 — UI(optional / nice-to-have)

- 若 conversion 真正 ready + viewer_url 出現:在 browser 開 `http://127.0.0.1:8004/ui/open?session=<lwv_id>` → 302 redirect 到 `127.0.0.1:5173/?session=<id>`,viewer 全螢幕 stream

## Stop conditions

任一 L1-L4 不 pass:stop,回報給人類。

不要為了 acceptance 而 hack(例如改 fixture 來 pass test、跳 sandboxing 來讓 path 通)。
