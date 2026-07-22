## Why

使用者首要目標是「穩定多 session、單 GPU 的生命週期」，其上再疊加「AI 產草稿 → 人審轉正」的最小審查閉環，Kit 定位為前期渲染 / 3D viewer / WebRTC 多人會議檢討。四個問題驅動本 change：

1. **單 GPU 是硬牆，且現況無生命週期管理**（簡報已驗證）：NVIDIA 官方明文 "limit each GPU worker instance to a single stream"；論壇實測單機第二個 Kit session 會使前一個斷流，port remapping/multi-container 變通均失敗。repo 現況已有 primary 49100 + spectator 49110~49150、1 primary 6 人同看的前例，但沒有 admission control、TTL/idle 回收、watchdog、佇列語意——第二個使用者一個誤觸就能弄斷正在進行的多人檢討會議（旅程斷點 J6）。此為 MVP 第一支柱。
2. **最核心的量化缺口沒有答案**（簡報與 repo 皆無數字）：單 GPU 靠 app 層排程可穩定支撐幾個並發 session、每 stream VRAM/vCPU/頻寬、Kit 長連線是否記憶體洩漏，官方全無數字，本 repo 亦無既有實測。MVP 哲學：先建量測 harness 拿到本地基準，再談擴充；不先蓋 K8s 空中樓閣，也不援引未經驗證的外部案例數字。
3. **AI 自審自派發若一步到位就是 issue 工廠 + 簽證風險**（簡報已驗證）：semi-automated 鏈（checker→帶 GUID 的 BCF→人審）可行但無生產級開源可抄；建築簽證多法域仍要 direct supervision，涉安全部件判定恐落入 EU AI Act Annex III 高風險。裁決：自派發重定義＝自動產生 + 路由人審佇列 + 去重排序，建立/關閉/指派一律人審 gate。MVP 只做「AI 產草稿 → 人審轉正」。
4. **A1–A4 既有閉環不能被改壞**（repo 現況）：`:8004` proxy byte-identical、禁改凍結三檔（`app.py`／`conversion_authority.py`／`governanceProxy.ts`）；ConversionLedger/MinIO/issues store/BCF-IDS 匯出已存在。MVP 一律疊加式，零破壞。

**驗收以單一 vertical slice 為準**（非整條 J0→J7 全量）：用真實 IFC fixture 跑完一圈「轉檔 → AI 審查產草稿（含 GUID/viewpoint/引用/信心值）→ 人審 accept 轉正式 issue → BCF 3.0 匯出 → 6 人 WebRTC 會議看模型討論該 issue ≥30 分鐘不斷流 → 新版本回跑產 resolved-candidate 差異報告」，全程有基準數據與 E2E evidence。

## What Changes

四個 capability、四個交付分期，全部疊加在既有 A1–A4 之上：

- **Phase 0（先量測再承諾）**：GPU/session 基準量測 harness（`gpu-session-baseline`）— 是 `session-lifecycle` 的硬 gate。
- **Phase 1（首要目標）**：單 GPU session 生命週期管理器 SessionBroker（`session-lifecycle`，吃 Phase 0 基準當 admission 參數）。
- **Phase 2（最小 AI 審查環）**：AI 審查草稿管線（`ai-review-draft-pipeline`）+ 跨版本冪等去重（`issue-idempotency`）。
- **Phase 3（人審轉正 + 標準出口）**：人審 triage 佇列（`human-triage-queue`）+ BCF-API 3.0 契約匯出（`bcf-contract-export`）。

主要行為變更（皆 additive，不動凍結三檔）：

- SessionBroker：admission control（fail-closed，競爭單位＝會議 session 非個別使用者）、primary 佇列（requester-TTL + 認領視窗）、spectator 分流（49110~49150，滿員 fail-closed）、TTL/idle 回收（idle 綁 readyState=4 peer 存在性）、顯式 terminate、環境指紋啟動比對 fail-loud；封裝 `omni.services.livestream.session` REST（`/v1/streaming/ready`、`/endsession`、`/creds`）為 coordinator 疊加路由。
- session 健康探針（readyState=4 + 影像尺寸 + DataChannel）、`-ResetUser` 自動復原、冷啟動 202 + 狀態輪詢端點。
- Phase 0 量測 harness：隔離 stack + 獨佔量測窗 + 內建 keepalive probe、nvidia-smi + WebRTC health probe + TTFF 基準報告（含環境指紋必填欄位）、≥30 分鐘 soak 記憶體斜率、SLO 數值化寫入部署文件並綁定指紋。
- IfcClash 規則式碰撞審查（has_occ hard guard fail-loud + 大模型 size guard），AI finding 證據包強制欄位（fail-closed ingest：GUID + 規則引用 + 離線 bounding box viewpoint + 信心值 + abstain 桶）。
- issues store 疊加 `source_type=ai_review` 與 draft 狀態；AI 無直建正式 issue、無直接 reopen 正式 issue 路徑。
- 兩層 fingerprint 冪等（精確 GUID+規則 / 幾何 fallback 標 `guid_churn_suspected` 強制人審）、parent/child 收斂、resolved 延續、reopen-candidate、機器可讀差異報告。
- 人審 triage UI（console 疊加一頁）：批量 accept/reject/edit、單一寫入者序列化 + per-draft 版本號 409 + 欄位所有權 fail-loud、操作稽核 ledger。
- BCF-API 3.0 topic/comment/viewpoint JSON 匯出端點 + 官方 schema 驗證；驗證層 pin IFC 4.3、幾何走 adapter。
- 橫切治理 checklist G1–G6（量測/SLO/EULA/硬體/能買就不要造/零破壞）。

## Capabilities

### New Capabilities

- `session-lifecycle`：單 GPU session 生命週期管理器 SessionBroker（driver 可替換 + fake driver contract test，`create`/`join` 一級動詞）——admission、佇列、spectator 分流、TTL/idle 回收、健康探針、`-ResetUser` 復原、冷啟動 202、環境指紋啟動比對、WebRTC 不降級。
- `gpu-session-baseline`：Phase 0 量測 harness——GPU/MIG 盤點、VRAM/TTFF/建立成功率基準報告（含環境指紋）、≥30 分鐘 soak 記憶體斜率、SLO 數值化並綁定指紋。
- `ai-review-draft-pipeline`：IfcClash 規則式碰撞審查（Finding SPI）、finding 證據包強制欄位 fail-closed ingest、draft gate。
- `issue-idempotency`：兩層 fingerprint、容差校準、parent/child 收斂、resolved 延續、reopen-candidate、機器可讀差異報告。
- `human-triage-queue`：人審 triage UI、accept/reject/edit、單一寫入者 + 版本號 409 + 欄位所有權、稽核 ledger。
- `bcf-contract-export`：BCF-API 3.0 JSON 匯出端點 + 官方 schema 驗證、IFC 4.3 pin + 幾何 adapter。

## Impact

- **所屬目錄／服務**：`bim-review-coordinator` 擁有 SessionBroker 排程/admission/佇列/生命週期 state、AI draft store（單一寫入者序列化）、triage accept 寫入正式 issue、稽核 ledger、BCF 匯出端點與冷啟動 202 輪詢 API；`bim-streaming-server` 提供 Kit runtime 起流/回收/`-ResetUser`、`omni.services.livestream.session` REST、IfcClash 執行環境與 IFC→USD 座標變換鏈；`governance-service` 維持既有 issues/annotations/BCF 持久化與匯出契約，draft 為 additive `source_type`；`web-viewer-sample` 擁有 triage 頁與冷啟動進度 UI（dist-ui 體系，build:ui 交付）。
- **保留的外部邊界**：外部客戶落地端 IFC Worker 仍是 IFC producer；外部公司雲端 `bim-control` 仍擁有 tenant/RBAC/enterprise workflow。本 change 不新增跨 repo 外部工作室派發、不引入 auth/RBAC 模型（維持 `:8004/ui` 現況）。
- **API／資料／儲存影響**：新增 additive session 生命週期 REST（create/join/status/terminate）、Phase 0 基準報告 schema、AI draft 記錄（issues store 疊加 `source_type=ai_review` + draft 狀態 + fingerprint 鍵 + 版本號）、resolved-candidate 差異報告 JSON、BCF-API 3.0 匯出端點。既有 `/api/external/ifc-ready`、conversion callback、`:8004` proxy 與凍結三檔均不變。
- **Session／runtime 影響**：SessionBroker 為 out-of-process 控制面，只做 admission/回收/佇列，不注入 per-session 渲染路徑；WebRTC 維持 RFC 8825/8826/8827 DTLS-SRTP 不降級；Kit GPU 渲染僅 host-native（repo 既知 Docker/WSL2 無繪圖驅動）。
- **量測依賴**：所有 admission SLO 綁定 Phase 0 報告環境指紋；硬體/driver/Kit/fixture 任一變動即令 SLO 失效須重跑基準。
- **非目標**：不上 K8s/MIG/多 GPU 水平擴充（僅記錄 SessionBroker driver 介面約束）、不做 Kit 串流內 fly-to 或 live 視角→BCF viewpoint 擷取、不建 LLM 分類層（僅凍結可停用降級接縫）、不建 IDS 完整規則引擎、不做 BCFzip serializer、不做 auth/RBAC、不做 AI 繪圖寫回、不做完整 OpenCDE server、不含建築工作室 agent 學習訓練（使用者明示不屬本 repo）。詳見 design.md 與各 spec 的 scope。

## Open Questions

以下為研究與對抗詰問後仍**未在本規格草案內解決**的殘留問題；各對應 spec 的相關 Requirement 標註了關聯，實作前應由使用者裁決或以 Phase 0/校準報告收斂。前二項另含使用者產品決策，**待使用者確認**。

### 待使用者確認的產品決策

- **OQ-A（max-hold hard cap，關聯 R1.6）**：MVP 顯式決定 primary 佇列無 preemption、無會議最長持有硬上限，餓死風險以「可見等待資訊＋人際協調」吸收。此為使用者產品決策，需向使用者揭示並確認是否接受「單一忘關分頁／長會議可無限期霸佔 GPU」的行為，或改設 Phase 0 後可設定的 max-hold knob。
- **OQ-B（BCF 交付面，關聯 R6.1）**：MVP 只交付 BCF-API 3.0 JSON。桌面工具（BIMcollab/Solibri/Revit）直接開啟需 BCFzip serializer（第二個 serializer，非 server），列 fast-follow。若 J5 目標為交付外部工作室，須向使用者揭示 JSON 無法被桌面 BCF 工具直接開啟，是否納入本期交使用者裁決。

### 對抗詰問殘留（實作前須收斂）

- **OQ-1（GUID churn 冪等塌陷，關聯 R4.1／R4.2／R4.3）**：IFC re-export 幾乎必然重配 GlobalId（GUID churn 是常態）。真實新版本回跑時第一層幾乎全 miss、第二層幾乎全命中，每筆舊 finding 都變成 `guid_churn_suspected` 待人審項。**未定義**：(a) suspected 命中在資料模型上是「新開一筆 draft」還是「掛在既有 draft 上的待確認 merge 項」——這直接決定 R4.3 resolved/reopen lineage 是否斷裂；(b)「疑似同源群一鍵確認」的顯式人審語意；(c) 驗收僅斷言同模型重跑（第一層全命中），缺真實 churn 版本對（第一層全 miss）的收斂斷言。建議：suspected 命中收斂成 parent 級「疑似同源群」一鍵確認，且 R4.2 分群鍵在 fallback 模式下能把同一 parent 的 children 一起帶過去。
- **OQ-2（AI 審查裡沒有 AI，關聯 CAP-3 全體）**：使用者原始目標明寫「AI agent 自審、自派發」，但 MVP 砍掉 LLM 層，`ai-review-draft-pipeline` 實為零模型推論的確定性 IfcClash，`source_type=ai_review` 與 R5.2「AI 版本標記」在無模型下實際只是規則集版本號。**須向使用者白紙黑字揭示 MVP=規則引擎、LLM=future work**，並確認是否接受此 headline 落差，或至少保留一條最小 LLM 分流層以名副其實。
- **OQ-3（忘關分頁永久餓死，關聯 R1.2／R1.6）**：R1.2 定義 idle＝連續 T 秒無任一 readyState=4 peer 且「只要仍有任一健康連線永不 idle」；R1.6 又不設 max-hold。兩者交集：presenter 關機走人但分頁沒關 → readyState 仍=4 → 永不 idle → 無 max-hold → 佇列永久餓死，而「人際協調」對已離場持有者無法觸及。另外「無主會議」（primary 連線掉但 spectator 還在、spectator 依賴 primary stage）算活還是連帶 teardown 未定。**須裁決**：是否引入「無人互動 last-activity 軟門檻」作為第二回收路徑，或接受單一忘關分頁無限期霸佔 GPU。
- **OQ-4（認領視窗與冷啟動矛盾，關聯 R1.4／R1.6）**：R1.4 說冷啟動起流 30–40 秒，R1.6 說「認領視窗 N 秒內未起流則讓位」。若「起流」＝達到 readyState=4 且 N < 冷啟動上限，佇列變成每個被通知者都在冷啟動途中逾時的空轉死結。**須精確定義**「起流／認領」判準（建議：認領＝視窗內成功發出建立請求並進入 202 輪詢即鎖住 GPU，起流耗時不計入認領視窗），且若認領＝ready 則 N 必須硬性 ≥ Phase 0 TTFF p99 上限（綁 R2.3）。
- **OQ-5（soak 切斷論證漏 spectator 與探針負載，關聯 R2.2）**：R2.2 記憶體斜率 soak 只量「一條 warm primary」單條，並以「SessionBroker 是 out-of-process 控制面」論證裸量可作門檻依據。但驗收壓的是 1 primary + 5 spectator ≥30 分鐘，且 R1.3 排程器對每個 session 持續打健康探針（DataChannel 往返負載）。這兩項都不在裸 primary soak 裡。**須裁決**：soak 是否收緊為「在 k=5 spectator 且健康探針同時運行下量測記憶體斜率與 VRAM 水位」，否則 admission 上限與洩漏門檻是用比實際輕的負載算出、對 6 人會議不具保證力。
- **OQ-6（ledger 持久化跨 docker 重建，關聯 R5.2／R5.3）**：R5.3 稱 draft store 靠 atomic swap 持久化、版本號存檔內作 409 樂觀鎖；R5.2 稽核 ledger 是 draft-gate 對抗 EU AI Act/簽證風險的唯一人審軌跡。但 repo 現況：coordinator store in-memory 重啟即清、`rebuild-test-deploy` 會 `git clean -fdx` 洗掉部署區 runtime 狀態。**須精確定義**：(a) ledger 與 draft store 的持久化落點是否在會被 rebuild/clean 洗掉的路徑之外（掛載卷或 MinIO）；(b) coordinator 重啟後版本號計數器與序列化狀態如何從磁碟重載、重載後誰是權威；(c) 若稽核 ledger 隨一次 docker 重建蒸發，draft-gate 的法遵防禦是否等於歸零。
