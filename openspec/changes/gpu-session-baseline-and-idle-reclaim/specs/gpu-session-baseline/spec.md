## ADDED Requirements

### Requirement: 基準量測腳本 SHALL 產出含環境指紋的結構化基準報告

執行 `measure-session-baseline.ps1` 時 SHALL 產出結構化基準報告，內容 SHALL 至少含：GPU 型號盤點（判定是否消費級 RTX、確認 MIG 不可用 → 鎖定軟體佇列路線）、1 primary + k spectator 下 VRAM 水位、time-to-first-frame（TTFF）、建立成功率。取樣 SHALL 使用 nvidia-smi（VRAM/利用率）+ WebRTC health probe + TTFF。報告 schema SHALL 含「環境指紋」必填欄位：GPU 型號、driver 版本、Kit 版本、量測 fixture 的 hash + 大小。

#### Scenario: 執行基準量測

- **WHEN** 在目標部署環境執行 `measure-session-baseline.ps1`
- **THEN** SHALL 產出含 GPU 型號盤點、VRAM 水位、TTFF、建立成功率的結構化報告
- **AND** 報告 SHALL 含 GPU 型號/driver 版本/Kit 版本/fixture hash+大小的環境指紋必填欄位

#### Scenario: 缺環境指紋欄位

- **WHEN** 產生的基準報告缺任一環境指紋必填欄位
- **THEN** 報告 SHALL 判定為不完整
- **AND** 後續 SLO 形式化與任何 admission 參數 loader SHALL NOT 引用該報告

### Requirement: 長連線 soak test SHALL 在隔離量測窗產出記憶體斜率報告且門檻只由本地實測決定

一條 warm primary 連線 SHALL 跑 ≥30 分鐘（目標 2 小時）soak 並產出記憶體斜率報告。洩漏 watchdog 門檻 SHALL 完全依本次本地實測結果訂定，SHALL NOT 引用未經本地驗證的任何外部系統數字（含任何 GB/日 之類外部洩漏率）。soak SHALL 於隔離 stack（獨立埠、獨立 governance）＋獨佔量測窗執行，harness SHALL 內建最小 keepalive health probe 維持連線活性，量測期間 SHALL NOT 共用入口。soak 期間自然斷流 SHALL 記為 finding；連兩次同點斷流 SHALL 判定為環境污染需查因，單次 SHALL 視為量測窗雜訊不逕自作結。

#### Scenario: 隔離 soak 產記憶體斜率

- **WHEN** 一條 warm primary 連線於隔離 stack + 獨佔量測窗跑 ≥30 分鐘 soak，keepalive probe 維持活性
- **THEN** SHALL 產出記憶體斜率報告
- **AND** 洩漏 watchdog 門檻 SHALL 只由本次實測訂出，不引用外部數字

#### Scenario: soak 期間自然斷流

- **WHEN** soak 期間發生單次自然斷流
- **THEN** SHALL 記為 finding 並視為量測窗雜訊
- **AND** 僅在連兩次同點斷流時 SHALL 判定為環境污染需查因

### Requirement: SLO SHALL 以具體數值形式化寫入部署文件並綁定環境指紋

設定任何 session admission 參數時 SHALL 以基準報告為前提，SHALL 以具體數值指標形式化並寫入可稽核部署文件：session 建立成功率下限、TTFF 上限、探針逾時定義、並發上限、idle-timeout、洩漏門檻。SHALL NOT 使用「合理」「足夠」等模糊詞；無基準報告則 admission 參數 SHALL NOT 上線（硬 gate）。所有 SLO 數值 SHALL 綁定基準量測報告的環境指紋；指紋任一變動即令既有 SLO 失效須重跑基準。

#### Scenario: 有基準報告設定 SLO

- **WHEN** 基準報告已存在，設定 admission 參數
- **THEN** SLO SHALL 以具體數值寫入部署文件且無模糊詞
- **AND** 每項 SLO SHALL 綁定報告的環境指紋

#### Scenario: 無基準報告

- **WHEN** 尚無基準報告
- **THEN** admission 參數 SHALL NOT 上線
- **AND** admission 參數 loader SHALL 以硬 gate 拒絕未經量測的門檻

#### Scenario: 環境指紋變動

- **WHEN** GPU 型號/driver/Kit/fixture 任一變動
- **THEN** 既有 SLO SHALL 失效
- **AND** SHALL 要求重跑基準取得新指紋
