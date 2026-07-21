# embedded-viewer-bridge Specification

## Purpose
TBD - created by archiving change viewer-redesign. Update Purpose after archive.
## Requirements
### Requirement: iframe 進場 URL SHALL 使用固定參數集且不承載 secret

EmbeddedViewer SHALL 以 `{viewerOrigin base}/?{params}` 直連 viewer origin（非經 `/ui/open`；凍結面照舊併存供外開）。URL 參數集封閉為：`session`（必填）、`coordinatorApiBase?`、`coordinatorSocketUrl?`、`streamRole?`、`kitInstanceId?`、`userId?`、`displayName?`、`sourceClientId?`。`viewer_lease_token` 為 bearer secret，MUST NOT 出現在 URL query（history/referrer/log 可見面），SHALL 只經受限 targetOrigin 的 postMessage 交付。`viewerOrigin` SHALL 取自 `runtimeStatus().configured_endpoints.viewer.browser_url_base`（可含路徑前綴）；origin 比對與 postMessage targetOrigin SHALL 使用 normalize 後的純 origin。

#### Scenario: lease token 不落 URL

- **WHEN** console 掛載 EmbeddedViewer 且已持有 viewer lease token
- **THEN** iframe src SHALL 不含 token；token SHALL 於 `viewer_ready` 握手後以 `{protocol:"vg01", type:"viewer_lease_token", token}` postMessage 交付

### Requirement: vg01 postMessage 訊息目錄 SHALL 封閉且雙向驗 origin

雙向訊息 SHALL 一律帶 `protocol:"vg01"`；未知 type SHALL 忽略（前向相容）。接收端 SHALL 同時驗證 `e.origin`（normalize 後精確比對）與 `e.source`（iframe contentWindow）；targetOrigin MUST NOT 為 `"*"`。目錄：

**console→viewer**：`viewer_lease_token {token}`、`highlight {items[] {ifc_guid, severity?, label?, rule_code?}}`（逐筆 replace 語意，每 item 一 request 一 ack）、`highlight_batch {items[]}`（聯集裝進單一 highlightPrimsRequest、回單一帶計數 ack）、`focus {ifc_guid}`、`clear {}`。

**viewer→console**：`viewer_ready`、`first_frame {stageUrl}`、`stage_loaded {stageUrl}`、`highlight_result {requestId, ok, reason?:"unmapped"|"datachannel_not_ready", sent_count?, unmapped_count?, unmapped_guids?[]}`（批次 ack 才帶計數欄）、`selected_guid {ifcGuid|null}`。

`highlight` 與 `highlight_batch` 語意 MUST NOT 混用；viewer 端 mapping 解不出 prim 的 GUID SHALL 誠實計入 `unmapped_*` 回報，MUST NOT 偽宣告成功。

#### Scenario: 跨 origin 訊息被拒收

- **WHEN** 非 viewerOrigin 的來源對 console 發出 vg01 形狀訊息
- **THEN** console SHALL 拒收（origin 或 source 比對失敗），不觸發任何 callback

#### Scenario: 批次高亮誠實計數

- **WHEN** console 送 `highlight_batch` 含 10 個 GUID 而 viewer mapping 只解出 7 個
- **THEN** viewer SHALL 送單一 highlightPrimsRequest（7 筆）並回 `highlight_result {sent_count:7, unmapped_count:3, unmapped_guids:[...3]}`

### Requirement: 掛載生命週期 SHALL 遵守 gated-mount 與 key-remount 契約

父元件 SHALL 於 `viewerOrigin` 取得值後才掛載 EmbeddedViewer（null 時顯示 viewer-origin-missing 態，不先空 render）；`viewerOrigin`/`sessionId` MUST NOT 於 mount 後原地變更——切換 session SHALL 以 `key={sessionId+leaseId}` 強制乾淨 remount。iframe SHALL 使用 `sandbox="allow-scripts allow-same-origin"` 與 `allow="autoplay"`（receive-only，不授 camera/microphone）。`viewer_ready` 與 iframe `onLoad` SHALL 皆觸發 lease token 重送（reload 自癒）。

#### Scenario: 換 session 乾淨重掛

- **WHEN** 使用者將 viewport 由 session A 切至 session B
- **THEN** 系統 SHALL 先 release A 的 lease，再以新 key 重掛 iframe（新 src、新 WebRTC 協商）
- **AND** MUST NOT 原地改 prop 造成隱性 reload 與 first_frame 證據失真
