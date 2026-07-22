## ADDED Requirements

### Requirement: SessionBroker SHALL 以會議 session 為競爭單位執行 fail-closed admission control

排程器核心以 SessionBroker 呈現，對外 API SHALL 不含單 GPU 假設。Admission 競爭單位 SHALL 是會議 session（1 primary + N spectator）而非個別使用者：後加入既有會議者 SHALL 一律走 spectator 分流，不佔新 GPU、不進 primary 佇列；只有請求「新 primary（＝新會議，需獨佔 GPU）」SHALL 進入佇列競爭。SessionBroker SHALL 封裝 `omni.services.livestream.session` REST（GET `/v1/streaming/ready`、POST `/endsession`、POST `/creds`）為 coordinator 疊加路由，且 SHALL NOT 修改凍結三檔。

#### Scenario: 既有 primary 佔用下請求新 primary

- **WHEN** 已有一個 active primary session 佔用 GPU，第二位使用者請求新 primary
- **THEN** SessionBroker SHALL 回 202 + 明確佇列位置/預估等待
- **AND** SHALL NOT 直接再起第二個 Kit primary（fail-closed：資源忙碌預設拒絕/佇列而非嘗試多開）

#### Scenario: spectator 席位未滿

- **WHEN** GPU 已被 primary 佔用且 spectator 席位未滿，收到 spectator 請求
- **THEN** SessionBroker SHALL 分配 49110~49150 空埠並回可用 endpoint

#### Scenario: spectator 席位已滿

- **WHEN** 在席 spectator ≥ `KIT_SPECTATOR_COUNT` 上限，再收到 spectator 請求
- **THEN** SessionBroker SHALL fail-closed 回明確拒絕 + 滿員原因（例：「席位 5/5 已滿」）
- **AND** SHALL NOT 把該 spectator 請求轉入 primary 佇列

### Requirement: SessionBroker SHALL 以 readyState=4 peer 存在性判定 idle 並支援顯式 terminate 回收

idle SHALL 定義為該 session 連續 T 秒無任一 readyState=4 的已連線 viewer peer（primary 與 spectator 連線皆計入）；只要仍有任一健康連線，該 session SHALL NOT 被判 idle。SessionBroker SHALL NOT 以輸入/滑鼠/鍵盤活動作為 idle 判準。idle-timeout SHALL 可設定，其預設值 SHALL 由 Phase 0 基準決定。

#### Scenario: session idle 逾時自動回收

- **WHEN** session idle 逾 idle-timeout（連續 T 秒無任一 readyState=4 連線），watchdog 判定 idle
- **THEN** SessionBroker SHALL 走 `/endsession` + teardown
- **AND** 佇列中下一位 SHALL 獲派並收到「輪到你」

#### Scenario: 顯式 terminate

- **WHEN** 收到顯式 terminate 請求
- **THEN** SessionBroker SHALL 走 `/endsession` + teardown 回收
- **AND** 佇列中下一位 SHALL 獲派

### Requirement: SessionBroker SHALL 以 readyState=4 加影像尺寸加 DataChannel 回應定義健康並自動復原

health SHALL 定義為 readyState=4 + 影像尺寸 + DataChannel 回應，SHALL NOT 以 port-open 判定存活。連續 N 次健康探針失敗時 watchdog SHALL 觸發自動 `-ResetUser` 復原；復原失敗 SHALL teardown 回收並將事件寫入 session ledger 供排程器決策。

#### Scenario: viewer 卡死自動復原

- **WHEN** 連續 N 次健康探針失敗（viewer readyState=0 卡死）
- **THEN** watchdog SHALL 自動執行 `-ResetUser`
- **AND** 恢復後事件 SHALL 寫入 session ledger

#### Scenario: 復原失敗

- **WHEN** `-ResetUser` 復原失敗
- **THEN** SessionBroker SHALL teardown 回收
- **AND** SHALL 將失敗事件寫入 session ledger 供排程器決策

### Requirement: SessionBroker SHALL 對冷啟動立即回 202 加可輪詢 statusUrl 而非假同步

冷啟動（起流 30–40 秒、shader cache 未預熱更久）時 SessionBroker SHALL 立即回 202 + 可輪詢 statusUrl，SHALL NOT 假裝同步成功。前端 SHALL 輪詢至 ready 才進 viewer，UI SHALL 顯示啟動進度。

#### Scenario: 冷啟動建立請求

- **WHEN** 收到冷啟動建立請求
- **THEN** SessionBroker SHALL 立即回 202 + statusUrl
- **AND** UI SHALL 顯示啟動進度，前端 SHALL 輪詢至 ready 才進 viewer

### Requirement: SessionBroker SHALL 維持 WebRTC 強制 DTLS-SRTP 不降級

任何連線建立路徑分配 endpoint 時 SessionBroker SHALL 維持 RFC 8825/8826/8827 強制 DTLS-SRTP，SHALL NOT 為相容引入未加密路徑。

#### Scenario: 分配連線 endpoint

- **WHEN** SessionBroker 為任一連線建立路徑分配 endpoint
- **THEN** 連線 SHALL 強制 DTLS-SRTP
- **AND** SHALL NOT 引入任何未加密路徑

### Requirement: primary 佇列 SHALL 具 requester-TTL 與認領視窗語意且無 preemption

佇列項的 requester-TTL 逾時（請求者離開/放棄）時 SHALL 自動出列、釋放佔位、後方遞補。輪到某請求者且前一 primary 回收釋放 GPU 時 SHALL 發「輪到你」通知並開啟認領視窗；認領視窗 N 秒內未起流 SHALL 讓位給下一位（本人可重新排隊）。MVP SHALL NOT 做搶佔（preemption），SHALL NOT 設會議最長持有硬上限（max-hold hard cap）；餓死風險以可見等待資訊（佇列位置/預估）＋人際協調吸收。

> Open Question OQ-4：認領視窗的「起流」判準（發出建立請求 vs 達到 readyState=4）與 N 的下限（是否須 ≥ Phase 0 TTFF p99）尚未定義，見 proposal.md。Open Question OQ-A：max-hold 是否改設 Phase 0 後可設定 knob，待使用者確認。

#### Scenario: 佇列請求者中途離開

- **WHEN** 佇列中的請求項 requester-TTL 逾時
- **THEN** 該請求 SHALL 自動出列並釋放佔位
- **AND** 後方請求者 SHALL 遞補

#### Scenario: 認領視窗逾時讓位

- **WHEN** 已通知某請求者「輪到你」，但認領視窗 N 秒內未起流
- **THEN** SessionBroker SHALL 讓位給下一位
- **AND** 原請求者 MAY 重新排隊

### Requirement: SessionBroker 啟動 SHALL 比對環境指紋，不符即 fail-loud

SessionBroker 啟動並載入 `gpu-session-baseline` 基準 SLO 門檻時 SHALL 讀取當前環境指紋（GPU 型號/driver 版/Kit 版/量測 fixture hash）並與基準報告指紋比對；不符時 SHALL fail-loud（拒絕起排程或顯著告警），SHALL NOT 靜默沿用舊門檻。

#### Scenario: 環境指紋不符

- **WHEN** SessionBroker 啟動讀取的環境指紋與基準報告指紋不符
- **THEN** SessionBroker SHALL fail-loud（拒絕起排程或顯著告警）
- **AND** SHALL NOT 靜默沿用舊 SLO 門檻
