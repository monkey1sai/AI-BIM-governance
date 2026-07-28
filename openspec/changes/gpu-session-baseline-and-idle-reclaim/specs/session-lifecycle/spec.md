## ADDED Requirements

### Requirement: session 回收倒數與互動保活 SHALL 作為第二回收路徑，前端顯示 10 秒倒數且互動即取消

session 連續 T_inactivity 秒無任何使用者互動（viewer 輸入事件／DataChannel 指令）但仍有 readyState=4 peer 連線時，session SHALL 進入回收倒數。進入回收倒數時，前端 SHALL 對該 session 所有已連線 viewer 顯示 10 秒倒數；倒數期間任一 peer 的任何互動 SHALL 取消本次回收並重置 inactivity 計時；倒數歸零 SHALL 經既有 coordinator session close 路徑 teardown 並以 reason=inactivity 寫入 session ledger。SHALL 維持無 max-hold hard cap：有持續互動的會議 SHALL NOT 因持有時長被強制回收。T_inactivity SHALL 可設定，預設值 SHALL 於 `gpu-session-baseline` 基準取得後訂定。本 Requirement SHALL 以疊加方式落在既有 coordinator session close 路徑，SHALL NOT 依賴佇列／SessionBroker 語意（該語意屬 deferred 母 change `add-single-gpu-session-ai-review-mvp`，其「佇列中下一位獲派」段不在本 capability 範圍）。

> 使用者裁決（2026-07-22，母 change OQ-A／OQ-3）：原話「同意, 但是前端追加 session 進入倒數10秒顯示」——同意維持無 max-hold，追加 session 進入回收時前端 10 秒倒數顯示；忘關分頁（有 peer 無互動）由本路徑回收。

#### Scenario: 忘關分頁回收

- **WHEN** session 仍有 readyState=4 peer 但連續 T_inactivity 秒無任何使用者互動，且 10 秒回收倒數內無任何互動
- **THEN** session SHALL 經既有 close 路徑 teardown
- **AND** SHALL 以 reason=inactivity 寫入 session ledger

#### Scenario: 倒數期間互動取消回收

- **WHEN** session 進入回收倒數，倒數期間任一已連線 peer 發生互動
- **THEN** SHALL 取消本次回收並重置 inactivity 計時
- **AND** 前端倒數顯示 SHALL 消失

#### Scenario: 活躍會議不因時長被回收

- **WHEN** 會議持續有使用者互動
- **THEN** session SHALL NOT 因持有時長觸發任何強制回收（無 max-hold hard cap）
