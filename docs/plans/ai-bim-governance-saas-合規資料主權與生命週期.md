# AI-BIM-governance SaaS：合規、資料主權與租戶生命週期

## §0 文件狀態聲明

- 本檔為增補層，效力低於 `docs-plans-README.md` §1 所列全部既有文件；衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項（對齊矩陣 §4.4 裁定 built 的 A1、A2、A3-federation）外，一律 **PLANNED·未建**。
- 現況＝單站點單租戶閉環（tenant zero）；本檔所述合規、資料主權、生命週期、DR 能力皆尚未實作。

> 定位速記：本檔是「信任視角」主檔，把「模型檔不出站（H6）＋可稽核的租戶隔離」從行銷口號變成可對 SOC 2／ISO 稽核方交付的書面控制與驗收邊界。分工邊界：租戶模型／隔離策略細節見 `ai-bim-governance-saas-租戶與身分.md`；GPU 物理與計費見 `ai-bim-governance-saas-GPU經濟與計量計費.md`；對外 API 見 `ai-bim-governance-saas-公開API與標準對齊.md`；本檔只寫合規敘述、資料主權承諾、稽核帳本、生命週期與 DR，互相引用不重複展開。

---

## §1 租戶隔離 ADR（SOC 2 system description／ISO 27001 SoA 一級佐證）

**PLANNED·未建。** 租戶隔離模型必須書面化為 ADR（Architecture Decision Record），這不是文件潔癖，而是合規稽核的一級證物：

- SOC 2 system description 與 ISO 27001 Statement of Applicability（SoA）都要求明寫「用哪種隔離模型、租戶邊界如何強制、有哪些控制防跨租戶存取」；敘述含糊會觸發稽核方更深入調查（來源：SOC2／ISO27001 業界落地慣例，二手，須一手核對）。
- Azure 官方建議即使暫不需合規也提早比照標準建置，因為回頭補證比先建成本高（來源：Azure governance-compliance，二手彙整）。

**本平台隔離模型逐服務書面化（PLANNED，全部標明所在層）：**

| 服務／資料面 | 隔離模型 | 跨租戶防護所在層 |
| --- | --- | --- |
| 雲端控制面 metadata（租戶／站點目錄、計費、跨站 dashboard） | Pool（共享，控制面新 Postgres） | 執行期 tenant-scoped 憑證 + 應用層 tenant_id 範圍過濾 |
| 業務資料（trial／低價 tier） | Pool（pooled schema） | RLS + tenant-scoped 憑證（非僅 `WHERE tenant_id`） |
| GPU 轉檔與 WebRTC 審查 | per-session Silo（天然） | 1 GPU=1 Kit=1 stream 物理硬隔離；一租戶 Kit crash 不波及他人 |
| 落地端站點整體 | 最強物理 Silo | payload 不出站（H6），拔網後完全自主 |
| 高法遵 tier（國防／公共工程／關鍵基礎設施） | tenant-per-stamp | 專屬 GPU 池 + 專屬儲存 + region/stamp pinning |

- **跨租戶防護主線**：租戶門控走 access token 的 `tenant_id` claim，由 coordinator 中介層集中驗證與範圍過濾，不讓各 service 各自兜隔離邏輯。此設計刻意**不採 IP allowlist**——與 `IX-SS-04 裁定A（刻意不加 IP allowlist）`一致，該裁定逐字保留、不改寫；租戶門控與 `IX-SS-04 裁定A` 的調和屬待人類簽核的新決策（見 §9 與 `ai-bim-governance-saas-租戶與身分.md` §6），本檔不預設通過。
- **Bridge 分層＝定價 tier**：Pool／per-session Silo／tenant-per-stamp 三檔直接對應 Free／Team／Enterprise，隔離強度與付費層綁定，書面化進本 ADR（隔離策略詳規見 `ai-bim-governance-saas-租戶與身分.md` §2）。
- ISO 27001 取證聚焦點（多租戶 SaaS 業界慣例）：雲端服務設定、租戶隔離、自動化部署、監控四類 Annex A 控制項須逐條列適用與否附理由。

---

## §2 資料主權三層可售承諾

**PLANNED·未建。** 把「資料主權」拆成三層可稽核、可寫進合約的具體承諾，而非行銷詞彙：

1. **region/stamp pinning**：IFC/USD 實體資料落在指定地區或客戶自有站點（落地端 stamp）。承諾語意＝「這個租戶的模型檔在物理上不離開這個 region／這個機房」，配 §5 per-tenant DR 的「只還原這個租戶」邊界即可驗收。IFC/USD payload 本體不出站（H6），雲端只收 metadata-only 白名單投影（見 `ai-bim-governance-saas-架構總覽.md` §6）。
2. **ISO 27001 範疇聲明**：ISMS 範疇只涵蓋平台 application 層（IAM 設定、多租戶資料隔離、加密設定）＋多租戶隔離，**明確排除雲商自身機房**——雲端供應商的 ISO 證書只涵蓋其自身基礎設施，SaaS 公司須就 application 層獨立取證（來源：ISO 27001 for SaaS 業界慣例，二手，須一手核對）。
3. **ISO 19650-5 need-to-know 分級 + 觸發式 security triage**：ISO 19650-5:2020 security-minded 資訊管理，對敏感資訊（國防／能源／公部門／關鍵基礎設施，外洩具實體安全含意）要求 need-to-know 分級存取、觸發式 security triage、跨組織安全文化與持續稽核；可作企業 tier 差異化條款。

> **一手核實缺口（見 §10）**：ISO 19650-5:2020 官方全文於 iso.org WebFetch 回 **403**，本檔範疇描述來自搜尋彙整，未經官方全文核對（未驗證，見 §10）。

---

## §3 Audit & Compliance Ledger 設計

**PLANNED·未建。** 稽核帳本是「信任視角」的一級服務，設計原則 **append-only、只讀、不可刪改**（任何 mutation 都以新增紀錄表達，永不回頭改寫或刪除既有列）。

**收錄範圍（每筆皆帶明確 tenant context）：**

- 控制面每一筆 tenant-context 操作（哪個租戶、哪個 request/query/背景工作、在哪個 tenant context 下執行）。
- 落地端回補的稽核摘要（僅 metadata；IFC/USD payload 不出站，H6）：
  - session 建立（誰在哪個租戶開了哪個 GPU session）；
  - spectator 同租戶驗證結果（通過／拒絕，見 §8）；
  - 危險動作三段式確認軌跡 `intent → confirm → audited`——延續 `A9／D5 session-layer-only 安全鐵律`（AI 只寫 session layer、source `.usdc` 雜湊前後不變、危險動作走三段式），該鐵律逐字延續、不改寫；
  - 租戶狀態轉移（§4 狀態機每次 transition）。

**SOC 2 直接稽核路徑**：Audit Ledger 存在的核心目的＝讓稽核方能逐筆回答「每個 request／query／背景工作是否在明確 tenant context 下執行」。這是 SOC 2 for SaaS 慣例會實際查的問題（來源：SOC 2 for SaaS 慣例，二手）；GPU/Kit session broker 的租戶邊界正是此路徑最敏感的一段（確保同 GPU 池不同租戶 Kit instance 無共享 stage/scene cache 或 spectator 通道洩漏）。

**API 面（PLANNED·SaaS-M7）**：`GET /cp/audit?tenant=&from=&to=` 只讀查詢，無寫入／刪除端點（append 由控制面內部與 connector 回補寫入，不對外開放 mutation）。

---

## §4 租戶生命週期狀態機

**PLANNED·未建。** 狀態機：

```txt
active ──deactivate──▶ deactivated ──retain──▶ retained ──purge──▶ purged
                            │                      │
                            └────reonboard◀────────┘
```

- `active`：正常營運。
- `deactivated`：停用（欠費／合約到期／客戶要求）；**session broker 立即硬 gate**（見下）。
- `retained`：資料保留期，仍**可 reonboard**（重新啟用回 active）。
- `purged`：抹除完成、不可逆（含備份輪替清除，見 §6）。

**三大留白政策（待商務／法務拍板，官方未給硬數字）：**

| 政策 | 待決內容 | 現況 |
| --- | --- | --- |
| retention | `retained` 保留幾天才可 purge | 待商務/法務拍板 |
| reonboarding | 從 `retained` 復原的資料範圍與 SLA | 待商務/法務拍板 |
| rebalancing | 租戶在 pool/stamp 間搬遷的觸發與時機 | 待商務/法務拍板 |

> Azure tenant-life-cycle 官方文件討論狀態轉移與 config 傳播，但**未給具體天數**（來源：Azure tenant-life-cycle，二手）；AWS 亦強調「tenant config 必須正確傳播到執行環境」。三政策數字全為待拍板，本檔不預設。

**session broker 硬 gate（H8 物理連動，PLANNED·SaaS-M3／M7）**：`deactivate`／offboard 一旦觸發，立即 terminate 該租戶佔用中的 Kit instance（約 **30–40 秒內**（規劃值·非實測，H8 物理死線），詳 `ai-bim-governance-saas-GPU經濟與計量計費.md` §1），防離線／欠費租戶繼續佔用昂貴 GPU。狀態＝broker 的硬 gate 輸入，非事後對帳。

**GDPR 抹除觸發提前 purge**：收到 GDPR Art.17 抹除請求時，可繞過 retention 窗口提前進 `purge`，並**觸發備份輪替清除**，以防 EDPB 點名的「備份還原復活已刪資料」情境（見 §6）。

---

## §5 per-tenant DR（災難復原）

**PLANNED·未建。** AWS 官方明講「無 SaaS 專屬可靠性作法」，故本平台**不自造 DR 機制**，直接套用成熟元件，只是按租戶切邊界：

- **Postgres PITR/WAL archiving**（控制面新 Postgres）＋ **MinIO versioning/replication**（落地端／per-tenant bucket）。
- 按 **tenant schema／bucket** 切出「只還原這個租戶」的備份邊界——單一租戶誤刪或損毀可獨立回滾，不驚動他人。
- **pooled + RLS 的取捨**：走 pooled schema + RLS 時，全 DB 一起還原會**連累他人的 RPO/RTO**；這是選 pool 前必須向業務明示的取捨（不是實作細節，是商業承諾邊界）。

**DR 分層＝付費差異（全部規劃值·非實測）：**

| tier | DR 模型 | RPO |
| --- | --- | --- |
| Free | backup-restore | 小時級（規劃值·非實測），RTO 24h 內（規劃值·非實測） |
| 付費（Team） | PITR | 5 分鐘級（規劃值·非實測） |
| 企業（Enterprise） | 獨立 pool／stamp | 客製，配 region/stamp pinning |

> 呼應 Azure「DR 保證是否因租戶而異」——DR 保證從 **schema 第一天**就設計進去（`dr_rpo_tier` 作為 entitlement 欄位，見 `ai-bim-governance-saas-GPU經濟與計量計費.md` §13），不是上線後補（來源：Azure tenant-life-cycle／AWS SaaS Lens Reliability，二手；RPO 量級為次級來源聚合，須一手核對，見 §10）。

---

## §6 GDPR（Art.17 抹除權）

**PLANNED·未建。** GDPR Art.17 只規範**個人資料**，須於合理期限內（約一個月內，有法定例外）執行（來源：GDPR.eu Article 17）。BIM 語境的關鍵區分：

- BIM 幾何／工程資料**通常非個資**；但 **metadata／Issue-BCF 留言／標註**可能含個資（姓名、email、指派人、留言署名），須可局部刪除。
- **設計鐵律：個資欄位與工程資料本體分離。** 抹除只處理個資欄位，**不下架 IFC/USD 資產本體**，避免誤觸整個模型資產下架造成專案紀錄斷鏈（H6 邊界：IFC/USD payload 本就不出站，抹除動作發生在 metadata 面）。

**抹除機制（PLANNED）：**

- 原子操作＝`DROP SCHEMA`／刪 bucket prefix ＋**級聯清 ConversionLedger／mapping 索引**（防 pooled 大表 tenant_id 篩選刪除漏刪關聯表，對應技術債防線 D-37）。
- silo（獨立 schema／bucket 頂層 prefix）讓「資料匯出＝打包單一 prefix」「抹除＝DROP SCHEMA／刪 prefix」兩個生命週期操作變原子；pool 只留 trial/低價 tier。

**備份抹除（監理重點，無統一技術規格）：**

- 2026-02 EDPB CEF 報告：32 國 DPA 聯合稽核 764 個控管者，點名「備份中個資保留期限判定與刪除」是主要痛點——半數 DPA 反映很多控管者對備份無專門刪除程序、甚至無機制防「備份還原復活已刪資料」（來源：EDPB Coordinated Enforcement Action 2026）。
- 官方立場只要求**文件化、合理、比例原則**做法並誠實告知資料主體；**退場抹除 SLA（備份最晚幾天清乾淨）目前無法規硬數字可引用**——保留窗口由法務拍板並文件化（見 §9），本檔不虛構天數。

---

## §7 BIM 模型 IP 歸屬

**PLANNED·未建。** BIM 模型 IP 歸屬須做成**專案層級結構化可設定的平台功能**，而非合約附註或自由文字：

- 多方協作模型天生分層 IP（多顧問各自貢獻疊在同一模型）；比照 **ConsensusDocs 301 的 BEP（BIM Execution Plan）模式**，在租戶／專案建立時就要求業主與顧問就「模型使用範圍／跨專案重用權限／疊圖衍生模型歸屬」做結構化設定。
- 英國 **CIC BIM Protocol** 採「顧問保留 IPR、授權業主使用」模式，可作預設樣板之一。
- **不留給法務自由文字合約**：否則會在企業採購的資安／法務盡調階段被卡關（結構化欄位可供盡調快速核對，自由文字不行）。

> 來源：CIC BIM Protocol／ConsensusDocs 301，**二手行業慣例**，須一手合約條款核對（見 §10）。

---

## §8 spectator 稽核檢查點

**PLANNED·未建。** spectator（共看者）共看同一 stream **不佔額外 GPU、不另計費**（對齊 GPU 物理：spectator 共看不吃額外 GPU；計費見 `ai-bim-governance-saas-GPU經濟與計量計費.md` §10）——但**加入前必須通過同租戶顯式驗證，並留稽核 log（PLANNED）**：

- 檢查點：spectator 加入 stream 前，broker 顯式驗證其租戶與 primary session 同租戶，確保同 GPU 池不同租戶 Kit instance 無共享 stage/scene cache 或 spectator 通道洩漏。
- 驗證結果（通過／拒絕）寫入 Audit Ledger（§3），拒絕時前端明確錯誤呈現（對應互動卡 IX-TN-04）。
- 對應技術債防線 **D-36（spectator 跨租戶洩漏）**：驗收＝跨租戶加入被拒且留 log 的 E2E（PLANNED·SaaS-M3）。

> 誠實並提：現有 spectator 架構（primary 49100 + spectator 49110~49150、`KIT_SPECTATOR_COUNT`）是否為官方 multi-viewer 機制未證實（見 §10）；「共看不佔 GPU／不計費」與「加入前同租戶驗證＋稽核 log」必須同段並陳，不可只講前者。

---

## §9 法務／合規待審清單（待人類簽核，未簽核前不得對客戶承諾）

**以下皆為待人類簽核的新決策，禁寫成已裁決、禁在正文以肯定語氣預設通過：**

| # | 待審項 | 觸發條件／go-no-go |
| --- | --- | --- |
| 1 | **GeForce EULA 灰色地帶** | 「公司自有 on-prem 消費卡對外提供多租戶付費服務」是否觸 EULA『No Datacenter Deployment』屬法律解釋灰色地帶，須法務 go/no-go；GTM 前必決（詳 `ai-bim-governance-saas-GPU經濟與計量計費.md` §6）。 |
| 2 | **ISO 19650-5 一手全文** | 官方全文 iso.org 403 未核；企業 tier 條款定稿前須取得授權全文核對範疇。 |
| 3 | **BIM IP 一手合約條款** | CIC Protocol／ConsensusDocs 301 為二手；結構化 IP 欄位落地前須法務核一手條款。 |
| 4 | **WebRTC GPU 串流稽核指引缺口** | SOC 2／ISO 27001 對「WebRTC GPU 串流」此非典型負載無專門稽核指引；稽核前須與稽核方確認控制對應。 |
| 5 | **離線寬限期窗口** | Arc 14 天／GDC 7 天為他家參照值，本平台窗口、逾期憑證刷新、離線租戶佔 GPU 處置未定，待合規/法務拍板。 |
| 6 | **備份抹除 SLA** | GDPR 備份抹除無法規硬數字，保留窗口由法務拍板並文件化（§6）。 |
| 7 | **租戶門控 vs IX-SS-04** | 租戶門控走 token claim（非 IP allowlist）與 `IX-SS-04 裁定A` 的調和須人類簽核（§1）。 |
| 8 | **台灣個資法／中國資料出境** | 本輪材料**未涵蓋**；面向兩岸客戶前須補地區法遵評估。 |

---

## §10 未驗證假設

本檔多數合規敘述為**二手來源或行業慣例**，非 runtime-verified fact；正文引用處已標來源，集中列出如下（正文引用時視同標「未驗證，見 §10」）：

1. **合規標準敘述皆二手**：SOC 2 system description／ISO 27001 SoA 對隔離模型的要求、Azure「提早比照建置」建議，均來自業界落地慣例與二手彙整，未經稽核方或官方標準全文交叉核對。
2. **ISO 19650-5:2020 一手全文未核**：iso.org WebFetch 403，need-to-know 分級／security triage 範疇描述來自搜尋彙整。
3. **GDPR 備份抹除無硬數字**：EDPB CEF 2026 為監理趨勢報導，退場抹除 SLA 無統一技術規格或法規天數。
4. **BIM 模型 IP 為二手行業文章**：CIC BIM Protocol／ConsensusDocs 301 未核一手合約條款。
5. **DR RPO 量級為次級來源聚合**：backup-restore 小時級／PITR 5 分鐘級為聚合參考值，須一手核對，全標「規劃值·非實測」。
6. **spectator 官方機制未證實**：現有 6 endpoint（primary 49100 + spectator 49110~49150）與 `KIT_SPECTATOR_COUNT` 可能為專案自建而非官方 multi-viewer API，須查 `omni.kit.livestream` 系列確認。
7. **metadata-only 白名單間接洩漏風險**：conversion ledger 摘要、rule-run 統計、稽核 log 中的檔名／GUID／專案字串可能間接洩漏模型內容，使 H6 承諾與 ISO 19650-5 need-to-know 打折；須白名單 schema ＋ 網路擷取抽驗 ＋ 去識別選項評估（D-35），本輪未實測。
8. **企業 tier 盡調缺口**：SOC2/ISO27001 對 WebRTC GPU 串流無專門稽核指引、GDPR 備份抹除無硬數字、兩岸法遵未涵蓋——企業銷售恐被買方資安／法務追問超出本輪材料範圍（見 §9）。
