# one-click-deploy-hybrid 規格增量 (harden-stage-host-allowlist)

> 對 `openspec/specs/one-click-deploy-hybrid/spec.md` 的規格增量。
> 補足 HTTP stage allowed-hosts 的設定化與空值告警行為:部署 / 啟動時 allowed-hosts 由設定推導,env 未設時發出告警而非靜默 fallback,且內建預設清單不含已退役服務的 port。

## ADDED Requirements

### Requirement: Stage allowed-hosts SHALL be configurable with an explicit empty-value warning

coordinator / conversion authority 載入 HTTP stage 時所允許的來源 host 清單(`BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS`)SHALL 可由部署設定推導:`start-streaming-server.ps1` SHALL 接受 `-AllowedStageHosts` 參數,並 SHALL 在「參數非空 → 既有 env → 否則內建預設」三分支間選擇來源。當 allowed-hosts 最終落到內建預設(operator 未經參數或 env 設定)時,系統 SHALL 發出告警(PowerShell `Write-Warning` / Python `carb.log_warn`),提示 env 未設、正使用 localhost-only 預設、coordinator 非 localhost 時須顯式設定,MUST NOT 靜默 fallback。內建預設清單 SHALL 只含現役 host-native conversion authority(`127.0.0.1:49101` / `localhost:49101`),MUST NOT 含已退役服務的 port。host 強制檢查的拒絕語意(來源不在清單即拒載)SHALL 維持不變。

#### Scenario: Empty allowed-hosts env emits a warning instead of silent fallback

- **WHEN** `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` 未設且未經 `-AllowedStageHosts` 參數提供
- **THEN** 系統 SHALL 發出告警(`Write-Warning` / `carb.log_warn`),提示正使用 localhost-only 內建預設、coordinator 非 localhost 時須設定
- **AND** SHALL NOT 靜默套用預設而不告警

#### Scenario: Built-in default excludes retired service ports

- **WHEN** allowed-hosts 落到內建預設(env 與參數皆未提供)
- **THEN** 預設清單 SHALL 只含現役 host-native conversion authority host(`127.0.0.1:49101` / `localhost:49101`)
- **AND** MUST NOT 含已退役 `_worker` 的 `:8005`

#### Scenario: Explicit configuration overrides the default

- **WHEN** operator 經 `-AllowedStageHosts` 參數或 `BIM_REVIEW_STREAM_ALLOWED_STAGE_HOSTS` env 提供非空清單
- **THEN** 系統 SHALL 採用該清單作為 allowed-hosts
- **AND** stage 載入對清單外 host 的拒絕語意 SHALL 維持不變
