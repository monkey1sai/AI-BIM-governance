## Context

`AGENTS.md` 和 Phase B draft 都把正式外部 IFC-ready intake 放在 `bim-review-coordinator`。本 slice 因使用者要求限定在 `bim-streaming-server`，所以只處理 streaming 既有 `POST /api/conversions/ifc-to-usdc` 入口：它仍是 coordinator -> streaming 的 internal conversion request，不升格成 public external endpoint。

目前 `conversion_authority.py` 已有基本行為：

- `event_type="ifc_ready"` 才可建立 conversion job。
- `event_id` 已可做簡單 replay，重複事件回傳既有 job。
- 無 `callback_url` 時不打已刪 `_bim-control`，由 coordinator 輪詢 `/result` 並在 T5 outbox 處理 callback。

缺口是 contract 沒有明確列出 service auth、`idempotency_key`、duplicate conflict、以及 4xx 行為，導致 coordinator 與 streaming 的邊界容易被誤讀成 unauthenticated external webhook。

## Goals / Non-Goals

**Goals:**

- 對 `POST /api/conversions/ifc-to-usdc` 加上可設定的 internal service token。
- 以 `idempotency_key` 作為主要 replay key，缺省時 fallback 到既有 `event_id`。
- 對相同 idempotency key 但 payload 不相容的 retry 回 409，不建立第二個 job。
- 補契約測試：auth 401/403、invalid payload 400、duplicate replay 202、conflict 409。
- 產出 verification doc，記錄 impact analysis、測試與剩餘風險。

**Non-Goals:**

- 不改 `_worker` / `_bim-control` 產品邏輯。
- 不把 `bim-streaming-server` 改成正式 public IFC-ready endpoint。
- 不重寫 IFC->USDC converter、mapping、USDC publish、WebRTC runtime。
- 不新增 production dependency 或真實 secret/env 設定。

## Decisions

1. Auth 採 optional setting，不硬寫環境變數。
   - `ConversionAuthoritySettings.internal_conversion_token` 預設 `None`，維持目前 local tests 與 adapter 相容。
   - 設定 token 時，request 必須帶 `X-Internal-Conversion-Token`。
   - missing token 回 401；wrong token 回 403；兩者都不能建立 job。

2. Idempotency key 優先於 event id。
   - 新 request 儲存 `idempotency_key` 與 `request_fingerprint`。
   - retry 同 key 且 fingerprint 相同，回傳既有 job 並加 `idempotent_replay=true`。
   - retry 同 key 但 fingerprint 不同，回 409，避免同一 webhook retry key 指向不同 IFC artifact。
   - 未提供 `idempotency_key` 時沿用 `event_id`，降低現有 caller 破壞面。

3. 4xx 只在 route/request boundary 處理。
   - invalid schema-like errors 繼續由 store 丟 `ValueError`，route 回 400。
   - idempotency conflict 使用小型 request error，route 回 409。
   - 不改 `_safe_id`，因 GitNexus impact 顯示它是 HIGH 風險共用 helper。

## Risks / Trade-offs

- [Risk] GitNexus index 落後，且 analyzer refresh 因外部匯出風險被拒。 -> Mitigation：保留既有 MCP impact 結果，搭配本地 `rg`/file inspection 與 targeted pytest 驗證；final 明確列出此限制。
- [Risk] Optional auth 預設不啟用，不能代表 production 已安全。 -> Mitigation：contract test 覆蓋 token configured case；部署時須由 coordinator/launcher 設定 token。
- [Risk] Fingerprint 太嚴格可能把 callback_url 變動視為 conflict。 -> Mitigation：目前只針對 internal request contract；若未來要允許可變欄位，需在 coordinator contract 另開 spec 調整。
