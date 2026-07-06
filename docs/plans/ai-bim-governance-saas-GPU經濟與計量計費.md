# AI-BIM-governance SaaS — GPU 經濟與計量計費

## §0 文件狀態聲明與數字紀律

- 本檔為**增補層**,效力低於 `docs-plans-README.md` §1 所列全部既有文件;衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項(對齊矩陣 §4.4 已裁決 built = A1、A2、A3-federation)外,一律 **PLANNED·未建**。
- 現況能力邊界一句話 = **已建成僅單站點單租戶閉環(tenant zero)**。
- **數字紀律(全檔硬規範)**:本檔所有定價、容量、費率、SLO、寬限期數字一律行內標「**(規劃值·非實測)**」。凡引用二手來源(economize.cloud / Vantage / 部落格 / 廠商牌價聚合)一律標明來源並註「**須一手核對**」;凡引用他家產品參數(APS token、iTwin credit、GeForce NOW 100 小時)標「**參照值,本平台數值待定**」。本檔不含任何實測 benchmark、客戶數或已對帳的財務數字。
- **推論邊界**:GPU-bound SaaS 無官方專屬多租戶指引,本檔多數計量/計費/隔離結論由 AWS/Azure 通用 SaaS 原則與 NVIDIA 官方 streaming 架構**類比推論**而得,凡屬推論者於正文標「(未驗證,見 §15)」。

> 分工邊界:租戶模型 → `ai-bim-governance-saas-租戶與身分.md`;雲地架構總綱 → `ai-bim-governance-saas-架構總覽.md`;對外 API → `ai-bim-governance-saas-公開API與標準對齊.md`;合規/生命週期 → `ai-bim-governance-saas-合規資料主權與生命週期.md`;階段詳規 → `ai-bim-governance-saas-遷移路線與里程碑.md`。本檔專責 **GPU 物理 × 商業模型**,互相引用不重複展開。

---

## §1 GPU 物理死線與承諾邊界(H8,NVIDIA 官方兩次核實)

以下為本平台 GPU 商業模型的**物理死線**,是可售 SLA 的絕對上界,銷售物料與文件一律不得逾越。逐條:

| # | 物理事實(H8) | 商業含義 |
|---|---|---|
| H8-1 | **1 GPU = 1 Kit instance = 1 primary stream** | GPU 顆數 = primary session 併發硬上限;配額分級的物理單位 |
| H8-2 | **無 live migration** | 進行中的 session 不能無感搬到另一顆 GPU;維護/再平衡必然中斷 |
| H8-3 | **換模型 / 換 GPU = terminate + recreate 約 30-40 秒(規劃值·非實測)** | 換手非瞬時;產生「切換死時間」,計費與 SLO 都要吸收 |
| H8-4 | **冷啟 shader cache 空時可達 ~15 分(規劃值·非實測)** | warm pool 存在的唯一理由;冷啟不是常態但屬最壞情況 |
| H8-5 | **spectator 共看同一 stream 不另吃 GPU** | 多人審查同一模型邊際 GPU 成本趨零;但**加入前必須同租戶顯式驗證 + 稽核 log(PLANNED)** |

**明文不承諾清單(對客戶與銷售一律禁宣稱)**:熱遷移 / hot-swap / 一個 session 多 stream / 彈性熱擴縮(elastic hot-scaling)/ fractional GPU 切分。上述皆為 NVIDIA 官方未提供之能力;任何要對客戶承諾超出 H8 物理能力的 SLA 條款,屬**待人類簽核的新決策**(見 §7、§16)。

> spectator 共看能滿足「多人審查同一模型」,**不**滿足「多人各自獨立 primary session」——後者受 GPU 顆數硬限,靠排隊 / 配額 / 加購管理,文件須兩者並陳。

---

## §2 Session Broker 兩層設計(複用 NVIDIA OVAS 官方架構)

Session broker 是本平台相對 APS / iTwin / Speckle 的**獨有元件**(PLANNED·SaaS-M3)。設計複用 NVIDIA OVAS 官方兩層(Streaming Session Manager + Resource Management Control Plane),把現有 host-native launcher 職責拆對應兩層,**不自創編排**。

### §2.1 職責拆分表

| 層 | 對應 NVIDIA OVAS 元件 | 職責 | 不負責 |
|---|---|---|---|
| **排程層(下)** | Resource Management Control Plane | 「有沒有一顆閒置 GPU 可綁」;K8s 原生 GPU 只能**整顆分配**(無 fractional) | queue / 優先權 / SLA 分級 |
| **應用層 broker(上)** | Streaming Session Manager + 自建策略 | queue + preemption + fair-share + 租戶優先權 SLA 分級;session token 核發 | 直接管 GPU 硬體 |

排程層只回答「有沒有閒置整顆 GPU」;所有 queue、搶佔、公平分配、租戶優先權都在**應用層 broker**實作——這是 K8s scheduler 只管整顆閒置 GPU 之外唯一合規做法(未驗證,見 §15)。

### §2.2 配額與 gate 規則

- **noisy-neighbor 防護單位 = 併發 session 數**(per-tenant `max-concurrent-sessions`,依 tier),**非請求速率**;單純 API Gateway request-rate throttling 不足以擋一租戶長審查整顆佔 GPU。
- 核發新 session token **前**硬 gate:(a) 查 entitlements(`max_concurrent_gpu_sessions` 等,見 §13);(b) 查該租戶累積 GPU-session 分鐘數對配額。任一不過即拒發或轉入 §3 的 429 契約。
- **三時戳**:每個 session 記 `session_start` / `session_end` / `idle_timeout_triggered`,同時供計費(§9)與 SLA(§7)。以官方 on-demand pod 生命週期 + idle timeout 天然對齊「用多少算多少」。
- **租戶 context 解析**:每個 session 建立**前**解析租戶 context;租戶狀態(deactivate / offboard)作硬 gate,可於 30-40 秒內 terminate 佔用中 Kit(細節見合規檔生命週期章)。
- **spectator gate**:spectator 加入前**顯式驗證同租戶**並留稽核 log(SOC 2 稽核路徑);跨租戶加入一律拒絕並記 log(對應防線 D-36)。spectator 多人共看機制是否為官方 multi-viewer API 尚未證實(未驗證,見 §15)。

---

## §3 429 + Retry-After 資源耗盡契約

現況缺陷(引現有 memory 事實):目前多筆轉檔的 Kit subprocess 幾乎同時啟動時,**vendor extension 對預設 port 8011 存在 TOCTOU race**,輸家 process crash(見 memory `ifc-conversion-concurrent-kit-port-8011-race`)。SaaS 化把此 race 升級為正式的「**GPU 資源耗盡回應契約**」:資源滿時回**結構化 429 + Retry-After**,而**不讓輸家 process crash**(比照 APS rate-limiting)。

結構化回應(PLANNED,前端呈現對應 IX-TN-02):

```json
{
  "error": "gpu_capacity_exhausted",
  "retry_after_seconds": 45,
  "queue_depth": 3,
  "estimated_wait_seconds": 130,
  "tenant_concurrent_used": 2,
  "tenant_concurrent_limit": 2
}
```

- HTTP 429 + `Retry-After` header;body 附**佇列深度**與**預估等待**供前端呈現。
- 前端呈現紀律(IX-TN-02):429 是「容量滿」狀態,**非紅色錯誤**、非故障;禁樂觀更新。
- `queue_depth` / `estimated_wait_seconds` 為執行期實值,非本檔規劃數字;上例 JSON 內數值僅為格式示意(規劃值·非實測)。

---

## §4 Warm Pool(暖機待命池)

為吸收 §1 H8-3 的 30-40 秒換手與 H8-4 的最壞冷啟,broker 維持一小池 **driver-loaded 待命 Kit instance**(PLANNED)。設計依據:NVCF 的 scale-to-zero 賣點反證冷啟動是業界痛點,應維持暖機池避免每 session 從 0 冷啟。

**成本誠實**:閒置暖機 GPU **不是免費的**——雲租仍按 $/hr 計、自建仍攤 capex,一律誠實計入 COGS(見 §8),不假裝免費。

**pool size 起始值待實測**:暖機池大小為稼動率 vs 待命成本的取捨,無官方 sizing guide,起始值須以真實流量實測後定(規劃值·非實測;Kit 每 session 實吃 GPU-hr 無官方 sizing,未驗證,見 §15)。

---

## §5 GPU Compute Stamp

GPU 做成**獨立 compute stamp**(對應 Azure deployment stamp 概念)。

- **架構驗收標準 = 最少部署兩個 GPU stamp**。此標準刻意破除程式碼寫死單一 Kit GPU 池的假設——port 8011 併發搶佔正是「寫死單池」的產物(§3)。
- **region pinning 執行點**:stamp 依 region 部署 = 資料落地的實體執行點;資料主權承諾(region/stamp pinning)在此層兌現(可售承諾細節見合規檔 §2)。
- 落地端每個客戶站點本身即最強物理 silo(payload 不出站);datacenter tier 的多 stamp 隔離另見 §6。

---

## §6 Datacenter vs 落地端分界(H8 法務死線)

這是 GPU 商業模型的**法律死線**,屬 GTM 前產品 / 法務層級 go/no-go,非工程判斷。

### §6.1 落地端(客戶自有站點)= 現況主線

- 現況 on-prem 用的 **RTX 4060 Ti 屬 GeForce 消費卡**;NVIDIA GeForce driver EULA 明文「software is not licensed for **datacenter deployment**」(僅區塊鏈例外,2018 起有效)。
- RTX 4060 Ti 只能存在於**客戶自有落地端 / BYO 硬體**場景。
- **法律灰色地帶**:「公司自有 on-prem 硬體對外提供多租戶付費服務」是否觸犯 EULA datacenter 禁令,條文與二手報導皆未界定,**須法務審查**;此為 **GTM 前 go/no-go**。若判定觸禁,落地端消費卡商業模式與現況對外收費都要重排。此判斷屬**待人類簽核的新決策**(見 §16)。

### §6.2 Datacenter / 雲託管 tier(SaaS-M8 選項·客戶明確 opt-in·H6 例外)

- 必用 **datacenter 授權 GPU**:L4 / L40S / A10 / H100。
- **硬隔離只能兩選一**:
  - **MIG**(Ampere+,**Linux**,硬體層 memory + fault isolation;**MIG 對 Kit 顯存 profile 相容性未經官方驗證(未驗證,見 §15)**);
  - **Windows Server 2025 Hyper-V GPU-P**(SR-IOV 切片)。GPU-P 限制:叢集內 GPU 須**同廠同型同分割數(homogeneous)**;一張卡 DDA 直通與 partitionable 二選一;partition 自動指派不可綁定客戶。**若同集群要混賣整顆 GPU 與切片,必須拆兩個獨立同質節點池**,拉高最低機台數門檻。
- **絕不用 time-slicing 隔開付費租戶**:官方白紙黑字 time-slicing「無 memory / fault isolation」,只適合同租戶內部可信批次。

### §6.3 最大架構分岔(待人類簽核,先於一切 GPU 擴縮設計)

- **Windows-only GPU 渲染(容器缺 Vulkan ICD)** vs **官方 Kit 容器化 Linux-only(worker node 僅 Ubuntu 22.04)** 直接衝突,是 SaaS 化最大架構分岔。
- **本藍圖主線 = 落地端維持 Windows host-native + 自建排程層**(保 H2 落地端一級元件 / H8 物理誠實);datacenter 全雲託管 tier 才走 Linux GPU node。
- 此分岔為**自建架構、無官方參考**,是放棄官方 K8s 路徑的重大自建投資,**立項須人類拍板**,且**先於一切 GPU 擴縮設計**。詳觸發條件見 §16。

---

## §7 SLI / SLO 與 error budget

session broker 另設**兩個獨立 SLI**(有別於轉檔管線 SLI 與 WebRTC request SLI),引 Google SRE Workbook Ch.2:

| SLI | 定義 | 對應物理 |
|---|---|---|
| **排隊等待時間** | session 請求到綁上 GPU 的等待 | GPU 顆數硬限(H8-1) |
| **搶佔 / 換手延遲** | terminate + recreate 完成時間 | 30-40 秒換手(H8-3) |

- **error budget 窗口 = 滾動四週**。
- **error budget policy(白紙黑字寫超標降級動作)**:(1) 優先權排程;(2) 告知預估等待(§3 的 429 body);(3) **暫停新租戶 onboarding 直到 GPU 擴充**。
- **per-tenant SLO 分層並追每客戶達成率**(非只看全租戶聚合):例 Enterprise 99.9% vs Standard 99% session 可用性(規劃值·非實測);GPU 佇列違反的體感傷害遠高於 API 延遲,故 GPU SLO 獨立追蹤。
- 初始 SLO 取現況實測四捨五入(規劃值·非實測)。

> 任何要對客戶承諾超出 H8 物理能力的 SLA 條款(如「零等待」「無中斷換手」),屬**待人類簽核的新決策**(§16)。

---

## §8 COGS 與成本地板

**全部數字為規劃值·非實測,二手聚合,正式定價前須 AWS / Azure Pricing Calculator 與 APS 官方頁人工核對。**

### §8.1 成本地板定錨

- 雲租 **L4 class**(AWS G6,L4 24GB,最貼近 RTX 4060 Ti 效能量級的公開牌價雲端 GPU)約 **$0.80-1.02/GPU-hr ≈ $0.0134-0.017/GPU-分鐘**(economize.cloud + Vantage 二手互證,官方動態價表未直抓,**須一手核對**)。
- **定價紅線**:任何 tier 的 GPU-session-minute 定價須 **≥ 地板 × 2-4x 毛利倍數**,否則先天負毛利。此地板可直接拿來檢核額度 / token 包裝。

### §8.2 渲染 vs AI 推論拆兩條計量表

- **渲染 GPU(L4 class)** 約 $0.80-1/GPU-hr(規劃值·非實測)。
- **AI 推論 GPU(H100 class)** 約 $7-12/GPU-hr,**貴 8-12 倍**(二手換算,**須一手核對**)。
- **A8 合成資料 / A9 Copilot 這類 AI 負載不可與 Kit 渲染混同一 GPU-hr 假設**;渲染表對應 A8/A9 以外的 Kit WebRTC,AI 推論表對應 A8/A9。兩表分開計量,不混算。

### §8.3 授權費歸零(取代舊模型)

- 自 **2026-05 起 Omniverse(含 Kit)開發與生產用途完全免費、可自由重散布**,不再需 NVIDIA AI Enterprise 訂閱。
- **舊「$4,500/GPU/年授權費攤進 session COGS」的模型應整條刪除重算**;session COGS 只剩 GPU 硬體 / 雲租費。
- **NAIE 為選配**:僅在平台真的依賴需 NAIE 才能用的元件(特定 vGPU 軟體、NIM 微服務)時才計(雲端 $1/GPU-hr 或自管 $4,500/GPU/年,**須一手核對**);Omniverse/Kit 本體不需 NAIE。

### §8.4 自建 vs 雲租

- 普遍論點:使用率須持續 **>60-85%**(規劃值·非實測)on-prem 才比雲租便宜(二手 TCO,**須一手核對**)。
- **SaaS 起步先雲租 L4 class 按量計費**;有真實高稼動率數據才決策加碼自建 datacenter 授權 GPU capex,避免「先射箭再畫靶」。
- GDN(Omniverse Cloud Graphics Delivery Network)官方確認存在但**無公開定價**,須聯繫 NVIDIA 業務洽談取價,無法先做並列 COGS 比較(見 §15)。

---

## §9 計量三軸

計量拆**三軸分開追**,不用通用 API call 蓋過去(全部 PLANNED):

| 軸 | 計量對象 | 顆粒 / 規則 | 對應功能 |
|---|---|---|---|
| **GPU-session-minutes** | Kit WebRTC 佔用時長(最貴稀缺資源) | **1 分鐘最小顆粒**;三時戳(§2.2) | GPU 審查 session |
| **conversion-jobs** | IFC→USD 轉檔 job | 按**複雜度分檔**(IFC→USD 屬 **complex**);**與檔案大小無關**(1MB 與 1GB 同價);**失敗 job 不收費** | A1 轉檔管線 |
| **API-calls** | CPU-bound 呼叫數 | rule-run / diff / metadata 查詢 | A1 / A2 / A4(CPU 軸,不吃 GPU) |

- 複雜度分檔借鏡 APS:複雜檔 0.5 token/job、簡單檔 0.1 token/job(參照值,本平台數值待定)。
- 三軸 SLO 與 error budget 分開追(GPU 違反體感傷害遠高於 API 延遲)。
- `storage_quota_gb` 作 **entitlement 與用量回報線**,**不設為第四計費軸**(避免對「存放」重複收費;儲存超額走 entitlement 加購)。

---

## §10 計費哲學

計費綁「**觸發稀缺資源的動作**」而非「**看**」:

- 對 **IFC→USD 轉檔** 與 **WebRTC 審查產生審查紀錄** 計費。
- **spectator 共看不佔額外 GPU 故不計費**(對齊 APS「多人看同一 derivative 免費」);但 **spectator 加入前必須通過同租戶顯式驗證 + 稽核 log(PLANNED)**(§2.2 / 合規檔 §8)。
- **primary reviewer 席位(持有 GPU)** 與 **spectator 席位(邊際 GPU 成本趨零)** 拆**兩種計量單位與費率**;spectator 用極低邊際定價,不與 primary 同價。
- **最低計費區塊 5-10 分鐘起跳(規劃值·非實測)**:吸收 §1 的 30-40 秒切換死時間(新租戶切換期不產出可計費內容卻仍佔 GPU),或以暖機池(§4)降低切換頻率。

---

## §11 governance credit 抽象

對外用**單一抽象貨幣單位 `governance credit`**,隱藏 GPU 秒數 / Kit process,讓定價與底層 Kit / USD 版本解耦(比照 APS Flex token、iTwin credit 換算表)。

- 提供**公開可預估的 rate sheet / token estimator**:建築業專案制採購需事先估「一個專案跑完 A1-A10 要多少點數」。
- **定價錨點**:iTwin compute = 2 credit/hr,給出「GPU 運算比一般 API 貴 100 倍量級」的定價錨點(參照值,本平台數值待定)。
- rate sheet 把異質軸(§9 三軸 + 儲存)換算成單一 credit,定價與 Kit / USD 版本更新解耦。

---

## §12 Stripe Billing Meters 模型(PLANNED·SaaS-M5)

三個 Stripe meter,計費事件來源 = 雲端 Aggregator 收 connector 上報(僅用量 metadata,IFC/USD payload 不出站)後去重的 usage record:

| meter | dimension | 對應 §9 軸 |
|---|---|---|
| `gpu_session_minute` | — | GPU-session-minutes |
| `conversion_job` | `complexity: simple \| complex` | conversion-jobs |
| `api_call` | — | API-calls |

- **冪等鍵 = `<tenantId>_<sessionId>_<event_time>`**;Aggregator 依此去重(至少一次投遞 + 冪等去重,防重複計費)。
- 配額扣減後推 Stripe meter event。
- **Prepay 用 invoice + credit grant**(**年效期、不跨月累積**)。
- **超額走加購包並觸發業務對話**,不自動爆表扣款(比照 iTwin / Speckle)。
- **上線前先跑 shadow billing**(只記帳不扣款)驗證對帳準確度,再開真實扣款。
- payload 不出站(H6):計量事件只含用量 metadata,IFC/USD payload 不出站(§14 / 架構總覽 §6)。

---

## §13 Tier 分層與 entitlements

**GPU 併發配額為核心分級軸**(GPU 是最貴 COGS),對應 Bridge 隔離 tier(隔離細節見租戶與身分檔)。數字全為規劃值·非實測:

| Tier | Bridge 隔離 | GPU 併發 | spectator | 儲存 / 備份 | onboarding |
|---|---|---|---|---|---|
| **Free** | pooled | 1 concurrent Kit | 無 | 低儲存 / backup-restore RPO 小時級 | 全自動 |
| **Team** | bridge | 1-2 concurrent Kit | 開放共看 | Prepay credit / PITR RPO 5 分鐘級 | 全自動 |
| **Enterprise** | tenant-per-stamp | 專屬 GPU 池 + region/stamp pinning | 開放 | 獨立備份 / DR + SSO + ISO 19650-5 need-to-know | **人工 / 半自動容量審核** |

- **Free 全功能不閹割、只限規模**(1 project、GPU 併發=1、無 spectator、低儲存)。
- **Enterprise 客製報價**;onboarding 觸發人工 / 半自動容量審核——**不承諾無限彈性 GPU 供給**(受 §1 顆數硬限)。

**Entitlements(session token 核發前硬 gate,逐欄)**:

```
max_concurrent_gpu_sessions   # §2.2 broker 硬 gate
spectator_enabled             # §10 spectator 席位開關
max_projects
storage_quota_gb              # §9 entitlement 線,非計費軸
data_residency_region         # §5 region pinning 執行點
sso_enabled
dr_rpo_tier                   # 合規檔 §5 per-tenant DR 分層
```

- GPU 額度採**封頂 + 結轉 + 超額加購**(非直接阻斷),保 business continuity(比照 GeForce NOW 100 小時/月 + 結轉 + 買包,參照值,本平台數值待定)。
- onboarding 依 tier 分岔:非 GPU 專屬 tier 走全自動 pooled;GPU 保留 tier 走觸發實際資源保留的人工 / 半自動審核。

---

## §14 落地端計量斷線佇列

connector 在落地端維持**本地持久佇列 + 冪等 key**:

- 斷線期間計量 / 稽核事件累積本地,恢復連線後**批次冪等回補**(至少一次投遞,Aggregator 去重防重複計費)。
- **離線期間絕不阻斷落地端運算**:轉檔 / governance 檢核 / GPU 渲染 / WebRTC 照常,計量事後結算;離線**僅犧牲雲端可視性與遠端控制**。
- 離線寬限期參照 Outposts 7 天 telemetry 快取(參照值,本平台窗口待合規拍板)。
- DR 保證(RTO/RPO)做成付費層差異,從 schema 第一天設計(見 §13 `dr_rpo_tier` 與合規檔 §5)。

---

## §15 未驗證假設

本檔以下設計為**推論類**,尚未經一手交叉驗證,落地前須補查;正文引用時已標「(未驗證,見 §15)」:

1. **GPU-bound SaaS 無官方多租戶指引**:GPU-session-minute 計量、GPU 視為 bridge silo 單元、租戶狀態 gate terminate Kit,皆由 AWS/Azure 通用 SaaS 原則類比推論,未經 NVIDIA Omniverse 多租戶白皮書或 GPU/HPC SaaS 一手案例交叉驗證。
2. **MIG 對 Kit 顯存 profile 需 POC**:MIG 對 Kit 渲染(吃顯存兇)的最低 profile / 驅動需求無官方建議;datacenter tier 硬隔離能否滿足 Kit 需 POC。POC 未過前,tenant-per-stamp 以下的共享 datacenter GPU 隔離設計不成立。
3. **spectator 官方 multi-viewer API 未證實**:現有 **6 endpoint(primary 49100 + spectator 49110~49150,由 KIT_SPECTATOR_COUNT 控制)** 可能是**專案自建**而非官方 multi-viewer API;多租戶並發需求能否長期靠 spectator 模型滿足,須查 `omni.kit.livestream` 系列確認。
4. **GDN / NVCF 無公開費率**:Omniverse Cloud GDN 官方確認存在但無公開定價,須聯繫 NVIDIA 業務;NVCF 費率亦須洽談。無法先做並列 COGS 比較。
5. **Kit 每 session 實吃 GPU-hr 無官方 sizing**:Kit App Streaming 每 session 實際佔用的 GPU-hr 無官方 sizing guide,warm pool size、最低計費區塊、稼動率門檻均須效能實測後定,不可據本檔規劃值定商業計畫定價。
6. **COGS 數字全為二手聚合**:AWS G6 $0.80-1.02/GPU-hr、Azure H100、on-prem TCO、APS token 皆非一手;正式定價前須 AWS/Azure Pricing Calculator 與 APS 官方頁人工核對。
7. **Stripe 冪等 / shadow billing 對帳準確度未驗**:`<tenantId>_<sessionId>_<event_time>` 冪等鍵在 at-least-once 投遞 + 斷線回補下的去重正確性,須 shadow billing 期實測對帳。

---

## §16 待人類簽核的新決策(GPU 經濟相關)

以下 GPU 經濟決策涉突破凍結面或重大自建投資,**未簽核前不得實作**,禁在正文以肯定語氣預設通過:

| 決策 | 觸發條件 |
|---|---|
| **Windows host-native vs Linux K8s 架構分岔** | 立項即須簽核;**先於一切 GPU 擴縮設計**(§6.3) |
| **datacenter tier MIG vs GPU-P 硬隔離選型** | 啟動 datacenter / 雲託管 tier(SaaS-M8)前(§6.2) |
| **超出 H8 物理能力的 SLA 條款** | 任何要向客戶承諾熱遷移 / 零等待 / 無中斷換手 / fractional GPU 之 SLA(§1、§7) |
| **GeForce EULA datacenter go/no-go** | GTM 前,判定「自有 on-prem 對外多租戶收費」是否觸 EULA datacenter 禁令;屬法務審查非工程判斷(§6.1) |

> 本檔其餘凍結面(§1 十二條、22 路由、Prov 型別、§4.4、§8 七項、IX-SS-04、O7、DB 遷移、docs-plans 搬遷、BCF 3.0)之簽核清單見 `審批報告-docs-plans-SaaS改版-2026-07-06.md` §5 與架構總覽 §8。
