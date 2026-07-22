## 背景

repo 現況已具備外部 IFC Worker → `bim-review-coordinator` → `bim-streaming-server` → metadata-only callback 的最小 B 方案閉環，Kit WebRTC 有 primary 49100 + spectator 49110~49150、1 primary 最多 6 人同看的既有配置，且 `governance-service` 已有 issues store 與 BCF-IDS 匯出。缺口在於：多人 WebRTC 會議沒有任何生命週期管理（admission/回收/佇列/watchdog），第二個使用者一個誤觸即可擊落正在進行的會議；且 AI 審查→草稿→BCF 的半自動鏈尚未落地。

本 change 採 MVP 優先、疊加式：首要建立單 GPU session 生命週期，再疊加「AI 產草稿 → 人審轉正」最小切片。所有交付為新增 routes/欄位/頁面，不動凍結三檔（`app.py`／`conversion_authority.py`／`governanceProxy.ts`），`:8004` proxy byte-identical。

## 目標／非目標

**目標：**
- 讓單 GPU 上的多人 WebRTC 會議有可恢復、可稽核的生命週期：admission fail-closed、primary 佇列、spectator 分流、TTL/idle 回收、健康探針與自動復原。
- 先量測後承諾：Phase 0 基準 harness 是 CAP-1 硬 gate，admission 參數必須引用實測報告數值。
- 讓 AI 審查定位為「高召回證據準備者」：draft gate 結構性保證 AI 無路徑直建/關閉/指派/reopen 正式 issue。
- 讓 issue 跨版本冪等收斂（120 命中→1 parent），版本回跑產機器可讀差異報告。
- issue 契約一開始就 pin BCF-API 3.0 標準，驗證層 pin IFC 4.3、幾何走 adapter。

**非目標：**
- 不上 K8s/MIG/多 GPU 水平擴充（消費級 RTX 不支援 MIG，僅 A100/H100 等資料中心卡支援），只記錄 SessionBroker driver 介面約束。
- 不做 Kit 串流內 fly-to 自動導覽、不做 live WebRTC 視角→BCF viewpoint 即時擷取橋接（MVP 用離線 bounding box viewpoint 替代）。
- 不建 IDS 1.0 完整規則引擎；LLM 分流層依 2026-07-22 使用者裁決納入 MVP（本地小模型、advisory-only、可整層停用），但不引入外部雲端 LLM API。
- 不做 auth/RBAC/project-tenant 隔離（維持 `:8004/ui` 現況）、不做 AI 繪圖寫回、不做完整 OpenCDE Foundation API server；BCFzip（BCF-XML 3.0）依 2026-07-22 使用者裁決納入本期。
- 不含建築工作室 agent 的學習/訓練（使用者明示不屬本 repo 範疇）。

## 決策

### 1. 單 GPU 路線＝單一常駐 warm primary + spectator 分流 + primary 佇列

**依據（簡報 confirmed）**：NVIDIA 官方明文 "limit each GPU worker instance to a single stream"；論壇實測單機第二個 Kit session 會使前一個斷流，port remapping/multi-container 變通均失敗，社群建議改用多台各配單 GPU 的獨立機器。官方 production-grade 多 session 靠 K8s 控制面（Streaming Session Manager + Resource Management Control Plane + CRD/Helm + Min=Max 預熱池），但那是為多 GPU 雲端叢集設計。

**裁決**：單 GPU（消費級 RTX）首要路線放棄 MIG 與多 instance 預熱池，改走「單一常駐 warm Kit session ＋ viewer 佇列/spectator 分流」，用 `omni.services.livestream.session` REST（GET `/v1/streaming/ready`、POST `/endsession`、POST `/creds`）自建輕量 app 層排程器。K8s/MIG 僅列未來多 GPU 水平擴充選項。

**取捨**：admission 競爭單位＝會議 session（1 primary + N spectator）而非個別使用者——後加入者一律走 spectator 分流不佔新 GPU、不進 primary 佇列；只有請求「新 primary（＝新會議）」才進佇列競爭。這把「會議已滿」（席位 fail-closed 拒絕）與「需要新 GPU」（進佇列）明確分流，避免誤導觸發不必要的佇列競爭。

### 2. 量測先於承諾（measure-before-commit）＝Phase 0 硬 gate

**依據（簡報 open_questions）**：單 GPU 靠 app 層排程可穩定支撐幾個並發 session、每 stream VRAM/vCPU/頻寬、Kit 長連線是否記憶體洩漏——官方全無數字，本 repo 亦無既有實測。簡報 open_question 特別點出「Kit WebRTC 連線期約 20GB/日記憶體洩漏（來自 Isaac Sim livestream 案例）是否適用本 repo 目前 Kit 版本，須本地長連線基線量測確認」。

**裁決**：洩漏 watchdog 門檻、並發上限、idle-timeout、TTFF 上限、建立成功率下限一律由本次本地實測決定，**不得引用簡報未涵蓋、未經驗證的任何外部系統數字（含任何 GB/日 之類外部洩漏率）**。無基準報告則 admission 參數不得上線。SLO 以具體數值寫入可稽核部署文件，禁「合理」「足夠」等模糊詞。

**環境指紋綁定**：所有 SLO 綁定 Phase 0 報告的環境指紋（GPU 型號/driver 版/Kit 版/量測 fixture hash+大小）；指紋任一變動即令 SLO 失效須重跑基準，排程器啟動亦 fail-loud 攔截。此原則於 Phase 2 延伸至 fingerprint 幾何容差校準（R4.4）。

**bootstrap 切斷論證**：Phase 0 soak 於隔離 stack（沿用 repo「branch E2E 隔離」模式：獨立埠、獨立 governance）＋獨佔量測窗執行，harness 內建最小 keepalive health probe 維持連線活性；量測標的＝裸 Kit process 資源行為。因 SessionBroker 為 out-of-process 控制面（僅 admission/回收/佇列，不注入 per-session 渲染路徑），裸量結果可作排程器門檻依據。此切斷論證的邊界見 Open Question OQ-5（是否需在 k=5 spectator + 健康探針負載下量測）。

### 3. AI＝高召回證據準備者，draft gate 結構性保證

**依據（簡報 confirmed）**：Text2BIM 等研究原型驗證「LLM 生成→IFC→model checker 幾何/碰撞檢查→輸出帶 GUID 的 BCF→Reviewer agent 讀 BCF 產優化建議」semi-automated 鏈可行，但無生產級開源可抄；建築簽證多法域仍要 direct supervision，涉安全部件判定可能落入 EU AI Act Annex III 高風險（強制人為監督/日誌/風險管理）。競品（Solibri Autorun、BIMcollab BCF Live、Autodesk Forma、Speckle Automate）成熟但差異化須落在整合原創性與治理嚴謹度，而非「AI 自主權威判定」。

**裁決**：自派發重定義＝自動產生 + 路由人審佇列 + 去重排序；建立/關閉/指派/reopen 一律人審 gate。AI 產出一律 draft 狀態（issues store 疊加 `source_type=ai_review`），draft 不出現在正式 issue 清單、不觸發派發。正式 issue 淨增＝人審 accept 數。

**規則引擎先行、LLM 層可整層關閉**：deterministic IfcClash 承擔主審查量與正確性底線；LLM 分流層設計成故障或超預算時可整層停用而不中斷核心審查閉環。**裁決更新（2026-07-22，OQ-2 消解）**：使用者裁決 MVP 納入最小本地小模型 LLM 分流層（local inference、advisory-only、模型 id/版本標記、停用整層降級、不引入外部雲端 LLM API），取代原「僅凍結接縫不實作」方案；`source_type=ai_review` 的 AI 版本標記自此具真實模型語意。

### 4. 冪等價值＝收斂非產量，兩層 fingerprint 兜底 GUID churn

**依據（簡報 key_constraint + repo 現況）**：BCF issue 需跨 model 版本冪等，套用 repo 既有冪等鍵模式（`mw_` 前綴 hash / ConversionLedger atomic swap），避免每次重跑審查變 issue 工廠。repo 已知 IFC 重匯出常重配 GlobalId（GUID churn），是既有 A1–A4 反覆踩過的坑。

**裁決**：第一層＝GUID 組合 + 規則 id 精確匹配；第一層 miss → 第二層＝規則 id + 幾何量化位置 bucket，命中標 `guid_churn_suspected` 必路由人審、**禁自動 dedup/suppress**（防兩個實為不同的 finding 因幾何量化落同 bucket 被誤併而隱藏真實新 finding）。分群鍵寫死 `(rule_id, sorted 涉事元素 GUID 集合)`，明確不採距離/樓層/系統啟發式。幾何 bucket 大小引用 R4.4 校準報告（GUID 存活率與幾何容差曲線），禁模糊詞。**GUID churn 常態下的資料模型形狀（新 draft vs merge-candidate）與 parent 級一鍵確認語意仍未定義，見 Open Question OQ-1。**

### 5. MVP viewpoint 用離線 bounding box、以 IFC 世界座標表述

**依據（簡報 open_question）**：Kit 即時視埠→BCF viewpoint 擷取橋接（把 live WebRTC 相機視角落成 BCF viewpoint）機制未規範，實查 governance issues 表只有 `ifc_guid`/`usd_prim_path` 無 camera/viewpoint 欄位，此為 Kit 與 BCF 唯一整合接縫。

**裁決**：MVP viewpoint 由幾何 bounding box 離線計算相機參數，以 IFC 模型世界座標系表述（符合 BCF 規範語意）；轉檔管線 IFC→USD 的座標變換（含 georeference offset）記入 ConversionLedger，保留可稽核變換鏈供 viewpoint 反算與跨工具互通。live Kit 擷取橋接與 Kit 串流內 fly-to 延後為 future work——最小成本滿足「每 finding 必附 viewpoint」硬約束。會議中 issue 定位在 MVP＝人看 triage 頁 + 匯出 BCF 給外部工具的協作流程，非 Kit 串流內自動導覽。

### 6. issue 契約 pin BCF-API 3.0、驗證層 pin IFC 4.3、幾何走 adapter

**依據（簡報 confirmed）**：IFC 4.3＝ISO 16739-1:2024（2024 正式通過）；buildingSMART BCF-API 3.0（RESTful topic/comment/viewpoint + JSON schema，屬 OpenCDE API family）為 issue 資料契約；IFC5（IFCX，alpha，schema 引用 USD）走 USD 化元件化，保留遷移路徑。WebRTC 須遵 RFC 8825/8826/8827 強制 DTLS-SRTP。

**裁決**：匯出物以 BCF-API 3.0 官方 JSON schema 驗證通過為準，禁自造私有格式；MVP 只做匯出端點，不做完整 OpenCDE Foundation API server。驗證層 pin IFC 4.3，幾何存取走 adapter 不硬編 IFC4.3 entity，保留 IFC5/IFCX 遷移路徑。BCF-API JSON 與 BCFzip 共享同一 topic/comment/viewpoint 邏輯模型。**裁決更新（2026-07-22，OQ-B 消解）**：BCFzip（BCF-XML 3.0）serializer 納入本期，與 JSON 同源匯出並以官方 XSD 驗證，供桌面 BCF 工具直接開啟。

### 7. 成本基準＝Omniverse 現免費、企業支援選配 + 制度化查證 gate

**依據（簡報 confirmed）**：2026-07-01 官方公告 Omniverse 開發與生產雙雙免費化，取消強制訂閱 AI Enterprise（$4,500/GPU/年已過時）；但 2025-10 有 AI Enterprise/Omniverse Enterprise 整併為 NVIDIA Enterprise 之變動且來源曾 citation mismatch，簽約/生產前須調閱官方 EULA/pricing 逐字確認。可觀測性走 DCGM Exporter + Grafana（dashboard 12239）。

**裁決**：規格以「Omniverse 現免費、企業支援選配」為基準，但加制度化 gate G3：宣稱 production-ready 前 checklist 必有一項「Omniverse EULA/pricing 逐字確認完成，附官方文件連結與日期」。不把免費當永久前提。

### 8. 架構接縫（YAGNI 約束下的最小可替換介面）

直接回應使用者「多 session 和多 GPU 先具備基礎能力」，讓單 GPU 實作未來擴充時只需換 driver 不改 caller，但以最小成本落地。

- **SEAM-1 SessionBroker driver 介面**：對外 API 不含單 GPU 假設；一級 API 明列 `create(model_ref)`（起新會議/新 primary，需獨佔 GPU、走佇列競爭）與 `join(session_id, role)`（加入既有會議，`role ∈ {primary 接手, spectator}`，spectator 不佔新 GPU、不進佇列）兩動詞。Phase 1 提供 `SingleGpuDriver` 唯一實作 + `InMemoryFakeDriver`（供 contract test）。**YAGNI 防鍍金 gate**：此介面必須在 Phase 1 內有一條走完整介面的垂直切片 + 一份 contract test 證明「換 driver 不改 caller」，否則砍掉抽象退回直呼。多 GPU/K8s driver 列 future work，僅記錄介面約束不建實作。
- **SEAM-2 Finding SPI（checker 介面）**：IfcClash 為 Phase 2 唯一 checker 實作；介面預留 IDS 1.0 規則引擎與 LLM 分流層可插拔位，並要求 LLM 層設計為「可整層關閉不中斷主審查」。MVP 只落地 IfcClash checker，同受 YAGNI gate 約束。

### 9. 第二回收路徑＝無互動軟門檻＋前端 10 秒倒數（2026-07-22 使用者裁決）

**依據（對抗詰問 OQ-3）**：R1.2（有任一 readyState=4 peer 即永不 idle）× R1.6（無 max-hold）交集產生「忘關分頁永久餓死」：presenter 離場但分頁未關，readyState 仍=4，session 永不回收、佇列永久餓死，「人際協調」對已離場持有者無法觸及。

**裁決**：維持無 max-hold（有互動的會議不因時長被回收），追加第二回收路徑：session 連續 T_inactivity 無任何使用者互動（viewer 輸入事件／DataChannel 指令）且仍有 peer 連線時進入回收倒數；前端對該 session 所有已連線 viewer 顯示 10 秒倒數，倒數期間任一互動取消回收並重置計時，歸零則 teardown（reason=inactivity 入 session ledger）、佇列下一位獲派。

**與 R1.2 的相容性**：R1.2「禁用輸入活動判 idle」的原意是防被動觀看中的會議被誤殺；第二回收路徑不改 idle 判準，而是把回收轉為使用者可攔截的顯式流程——被動觀看者看得到倒數、動一下即可保活；真正離場者無人取消、session 被回收。T_inactivity 預設值於 Phase 0 後訂定。殘留子題：「無主會議」（primary peer 斷線僅剩 spectator）語意列 0.2 收斂。

## 資料流與 source-of-truth 權責

| 持久資料 | 權威 |
|---|---|
| Session 生命週期 state（admission/佇列/lease/idle/health event ledger） | `bim-review-coordinator` SessionBroker |
| Kit runtime lease/readiness/stage、WebRTC endpoint | `bim-streaming-server` / Kit runtime |
| Phase 0 基準報告 + 環境指紋 + SLO 數值 | 可稽核部署文件（tracked） |
| AI draft records（`source_type=ai_review`、fingerprint 鍵、版本號、evidence/last_seen） | coordinator draft store（單一寫入者序列化） |
| 正式 issue、annotation、BCF 持久化 | `governance-service` issues store |
| 稽核 ledger（accept/reject/edit、操作者/時間/AI 版本標記） | coordinator（持久化落點見 Open Question OQ-6，須在 rebuild/clean 洗除範圍外） |
| IFC→USD 座標變換鏈（含 georeference offset） | ConversionLedger |
| resolved-candidate 差異報告 JSON | coordinator（版本回跑產出） |

## 驗證策略與環境限制

- **GPU/Kit 限制**：Kit GPU 渲染僅 host-native（Docker/WSL2 無 NVIDIA 繪圖驅動，repo 既知）；Phase 0 量測與 6 人會議 E2E 皆須真實 host-native Kit + RTX GPU。
- **health ≠ port-open**：健康判準＝readyState=4 + 影像尺寸 + DataChannel 回應。
- **隔離量測**：Phase 0 soak 用獨立埠 + 獨立 governance（沿用 branch E2E 隔離模式），不碰部署區 `:8004`。
- **零破壞回歸**：`:8004` proxy byte-identical + 凍結三檔 git diff 為空列入驗收；既有 A1–A4/轉檔閉環測試全綠。
- **contract test 位置**：driver 與 Finding SPI contract test 落 `tests/contracts/`；各服務單元/整合測試留在各自服務目錄避免 import cache 污染。
- **假綠防護測試**：缺 OpenCASCADE 跑審查須明確報錯（非 0 findings）、大模型 size guard、health 非 port-open、環境指紋不符啟動 fail-loud、ingest 缺欄位 fail-closed、幾何 fallback 強制人審——各有自動化測試。
- **stop-and-ask**：GIVEN Phase 0 實測 6 人 fixture 安全上限 < 6，THEN 觸發 stop-and-ask 呈使用者裁決（降人數／換 fixture／調品質參數／接受風險），禁規格靜默下修或硬湊 6 人。

## 反假綠檢核表（集中列出已知假綠模式）

| 假綠模式 | 結構性防護 |
|---|---|
| 缺 OpenCASCADE 靜默回 0 findings | R3.1 has_occ hard guard，缺依賴 fail-loud + size guard 有測試 |
| 冷啟動假裝同步成功 | R1.4 冷啟動一律 202 + statusUrl，UI 顯示進度 |
| health 用 port-open 誤判存活 | R1.3 health＝readyState=4 + 影像尺寸 + DataChannel 回應 |
| ingest 缺欄位仍進佇列 | R3.2 fail-closed：缺任一欄位進 abstain 桶不進佇列 |
| admission 資源忙碌仍多開 | R1.1 fail-closed：忙碌預設拒絕/佇列 |
| 以輸入事件判 idle 誤殺活會議 | R1.2 idle 綁 readyState=4 已連線 peer，禁用輸入/滑鼠活動判 idle；第二回收路徑（無互動軟門檻）以 10 秒可見倒數＋互動取消防誤殺（2026-07-22 裁決，見決策 9） |
| GUID churn 幾何 fallback 靜默 false-merge 隱藏新 finding | R4.1 `guid_churn_suspected` 命中強制人審，禁自動 dedup/suppress |
| 舊機器基準管新環境 | R1.7/R2.3 啟動時環境指紋比對，不符 fail-loud，不靜默沿用舊門檻 |
