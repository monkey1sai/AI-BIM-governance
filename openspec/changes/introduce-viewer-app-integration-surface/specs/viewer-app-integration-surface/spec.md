# viewer-app-integration-surface（本 change 的 delta）

本 delta 只新增 capability `viewer-app-integration-surface`：viewer 能力的「一套 core、兩宿主、宣告式 app 整合面」**結構性契約**。本 change 不對任何被 active change 持有 delta 的 capability 出 delta（開 PR 當下快照見 proposal「Predecessor-owned surface」段）；viewport 掛載版面、runtime command 權威、失敗態矩陣本體、unmapped 計數與 ack 欄位之行為語意、design token 權威，仍由各自的既有 capability 與 active change 持有——本 capability 引用而不重定義該等行為，只約束其**實作來源與分層位置**。本 capability 為新建，canonical spec 於 archive 後才出現。

## ADDED Requirements

### Requirement: 同一 viewer 語意 SHALL 只有單一實作來源

console 內嵌宿主與 viewer origin 宿主 SHALL 經由同一套 core（protocol／transport／state／intent 層）表達同一 viewer 語意（highlight、highlight_batch、focus、clear 及其 ack 承接與 guid→prim_path 翻譯）。同一語意的第二套 gate 鏈、翻譯表或 ack 處理 SHALL 視為缺陷。抽取過程 SHALL 維持行為凍結：逐筆 highlight（每 item 一 ack）與 highlight_batch（單次＋計數 ack）雙語意的 ack transcript SHALL 與抽取前擷取之 golden 基線等值（事件順序、event_type 與 payload 欄位值逐項相等）。

#### Scenario: 兩宿主共用同一 core 且 ack transcript 凍結

- **GIVEN** console 內嵌 viewport 與 viewer origin 頁皆附掛同一 review session
- **WHEN** 任一 app 對同一組 domain 項目觸發逐筆 highlight 與 highlight_batch
- **THEN** 兩宿主 SHALL 經同一 core 實作送出訊息並承接 ack
- **AND** 逐筆與批次之 ack transcript SHALL 與抽取前 golden 基線等值
- **AND** SHALL NOT 存在第二套等價 gate 鏈、guid 翻譯表或 ack 處理

### Requirement: app 整合面 SHALL 宣告式且受宿主能力集限制並誠實降級

每個 app 整合 profile SHALL 以宣告式資料（語意軸、能力集、gate、動作對映）描述其 3D 整合，且 SHALL 受宿主傳輸能力集限制（vg01 目錄與 DataChannel 目錄為兩個不同集合）。profile 宣告而宿主不支援的能力 SHALL 以可見 disabled 狀態＋已知限制標示誠實降級；MUST NOT 靜默移除、靜默失敗或假成功。intent 送出結果 SHALL 非靜默：成功、被封鎖（blocker）、被拒（rejected reason）三種結果 SHALL 皆可被 UI 觀察；被拒 reason 之列舉與行為語意以既有 runtime 拒絕契約為權威，本需求不重定義。

#### Scenario: 宿主不支援之能力誠實停用

- **GIVEN** 某 profile 宣告之能力不在目前宿主傳輸目錄（例：vg01 目錄不含 select／reset_view／tree_children）
- **WHEN** 整合面 render 對應動作
- **THEN** 該動作 SHALL 以可見 disabled 呈現並標示已知限制
- **AND** MUST NOT 靜默移除該動作或宣稱已執行

#### Scenario: 被拒的 3D 動作有可見回饋

- **WHEN** intent 送出後收到 rejected 結果
- **THEN** UI SHALL 呈現可見的拒絕回饋（事件列或 toast）並保留原因
- **AND** SHALL NOT 以靜默或假成功呈現

### Requirement: 未對映封鎖與誠實計數之判定 SHALL 只有單一實作來源

缺 `usd_prim_path` 對映之 domain 項目的封鎖判定、以及批次動作之送出數／未對映數計算，SHALL 只由 core state 層之單一實作提供；任何 app 或宿主 SHALL NOT 自帶第二套判定或計數邏輯。封鎖與計數之對外行為語意（ack 欄位形狀、誠實計數呈現）以既有 capability spec 為權威，本需求不重定義；app 整合面 SHALL 一致消費 core 的判定結果並附誠實原因。

#### Scenario: 跨 app 一致消費同一判定來源

- **GIVEN** 一批 domain 項目中部分缺 usd_prim_path 對映
- **WHEN** 任兩個不同 app 的整合面對同批項目 render 3D 動作並觸發批次動作
- **THEN** 兩 app 之封鎖結果與送出數／未對映數 SHALL 一致（同一 core 判定）
- **AND** SHALL NOT 存在 app 自帶之第二套判定或計數實作

### Requirement: 整合面 SHALL 傳輸無關且 app 層對傳輸模組 direct import SHALL 為 0

app 層（profiles 與 profile 消費頁面）SHALL 只以語意（ElementSemantics）與意圖（ViewerIntent）表達 3D 動作，經型別化 encoder 與 port 轉譯為具體傳輸訊息；語意到傳輸欄位的翻譯（含 guid→prim_path 查表）之實作位置 SHALL 唯一（core），其行為語意仍以既有 capability spec 為權威。app 層對傳輸模組之 direct import SHALL 為 0，並 SHALL 由隨標準測試指令執行之 repo 內靜態邊界測試驗證（不依賴 CI workflow 變更）。

#### Scenario: 靜態邊界測試擋下 app 層直接 import 傳輸

- **WHEN** 執行標準測試指令（含靜態邊界測試）
- **THEN** profiles 與 profile 消費頁面層對 transport 模組之 direct import 數 SHALL 為 0
- **AND** 違反時測試 SHALL fail closed 並指出違規 import

### Requirement: 新增 app profile SHALL 不需修改協定、傳輸與狀態層

新增一個 app 整合 profile SHALL 只落在 profiles 層與其註冊點；協定、傳輸、狀態與 intent 核心層 SHALL 零修改。此性質 SHALL 以實際新增之 profile（得為 test-only fixture profile）的 changed paths 證據與既有 app 測試全綠驗證。

#### Scenario: 以 fixture profile 驗證擴充邊界

- **WHEN** 加入一個新的 app profile（或 test-only fixture profile）
- **THEN** changed paths SHALL 侷限於 profiles 層與註冊點
- **AND** 協定／傳輸／狀態／intent 層 SHALL 無 diff
- **AND** 既有 app profile 測試 SHALL 全綠

### Requirement: 3D 動作 gate SHALL 同時包含 item 軸與 session 軸

每個 3D 動作之可用性 SHALL 由 item 軸（對映、資格）與 session 軸（session 附掛、串流、lease 與 stage 狀態）雙軸共同決定：session 軸未 ready 時，已對映項目之 3D 動作亦 SHALL disabled 並呈現 session 軸 blocker 原因；批次動作 SHALL 由批次 gate 一致封鎖。單筆與批次 gate SHALL 為兩個可區分的判定（批次 gate 不含 item 專屬前置段）。

#### Scenario: session 未 ready 時已對映項目仍被封鎖

- **GIVEN** domain 項目已具 usd_prim_path 對映
- **AND** session 軸未 ready（未附掛 session、conversion 未完成、串流未建立或未持有 lease）
- **WHEN** 整合面 render 該項目之 3D 動作
- **THEN** 該動作 SHALL disabled 並呈現 session 軸 blocker 原因
- **AND** 批次動作 SHALL 被批次 gate 一致封鎖
