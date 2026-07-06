# AI-BIM-governance SaaS 改版：租戶與身分

## §0 標準狀態聲明頭

- 本檔為增補層，效力低於 `docs-plans-README` §1 所列全部既有文件，衝突一律以既有凍結契約與對齊矩陣 §4.4 裁決為準。
- 全文能力除明確引用已建成項外一律 **PLANNED·未建**；定價/容量/門檻數字一律標「(規劃值·非實測)」。
- 現況＝單站點單租戶閉環＝tenant zero；本檔描述的租戶模型、Bridge 隔離、身分與 token 相容路徑全部尚未實作。

本檔在 SaaS 六檔中負責「租戶模型 / 隔離策略 / 身分與 token 相容路徑」；雲端控制面服務規格見 `ai-bim-governance-saas-架構總覽.md`、GPU 經濟與計量見 `ai-bim-governance-saas-GPU經濟與計量計費.md`、合規與資料主權見 `ai-bim-governance-saas-合規資料主權與生命週期.md`。

---

## §1 租戶模型（三層 tenant → project → model-container）

### §1.1 三層容器與業界對齊

多租戶資料模型採三層容器，直接對齊主流 BIM/AEC 平台的既有分層，不自造新結構（PLANNED·SaaS-M4）：

| 本平台層級 | 職責 | Bentley iTwin | Autodesk APS | Speckle |
|---|---|---|---|---|
| **tenant**（最上層隔離鍵） | 一家企業 / 業主，隔離邊界頂點 | iTwin | Hub | workspace |
| **project** | 一個工程專案 | iModel | Project → Folder | project |
| **model-container** | 一份模型 / 版本容器 | iModel branch/version | Item → Version | version |

- 對齊 iTwin `iTwin/iModel`、APS `Hub→Project→Folder→Item→Version`、Speckle `workspace→project→version`；MVP 只需在**最上層插入 `tenant_id` 隔離鍵**，重用既有 A1-A10 資料模型不重寫。
- Foundation/BCF/Documents 三大官方 API 皆無 multi-tenancy 語意——**租戶是本平台自建的外層概念**（`project_id` 前綴/映射 `tenant_id`，在 `/auth` 之上疊 tenant-aware JWT）。

### §1.2 主鍵與檔名鍵紀律（不動既有事實）

- `ifc_guid` 主鍵、D4 Issue/BCF schema、Prov 7 值（`asbuilt|artifact|demo|p1|p15|p3|p4`）**全部不動**，只在最上層加租戶維度。
- ConversionLedger 檔名鍵現況＝`mw_<hash16>`（不動）。SaaS-M4 起演進為 **`mw_<tenantId>_<hash16>`** 防跨租戶碰撞（PLANNED·SaaS-M4）。
- 租戶級狀態一律以正交獨立欄位（`tenantId`、`scope: tenant|global`）表達，**不進 prov 型別**——`prov` 恰 7 值，發明第 8 值（含 `tenant_asbuilt`）會 TS2322 編譯錯誤（見 §8 與對齊矩陣 §4.4）。

---

## §2 Bridge 隔離策略

依 noisy-neighbor 敏感度**逐服務**決定隔離級別（AWS SaaS Lens `silo-pool-and-bridge-models` 的 Bridge 判準），分層**直接對應定價 tier**，並書面化進隔離 ADR（引 `ai-bim-governance-saas-合規資料主權與生命週期.md` §1）。全部 PLANNED·未建。

### §2.1 Pool（共享，控制面 metadata + 低價 tier 業務資料）

- 雲端控制面 metadata（租戶/站點目錄、計費、跨站 dashboard）走**控制面新 Postgres**（全新雲端元件，與落地端 DB 物理分離，見 §7）。
- 業務資料**僅** trial/低價 tier 進 pooled，避免 pooled 大表 `tenant_id` 篩選漏刪關聯表。
- Pool 層導入**執行期 tenant-scoped 憑證**（isolation manager 每請求動態產生範圍受限憑證，不只靠應用層 `tenant_id WHERE`）。
- 若用 PostgreSQL RLS 須避兩陷阱（官方點名，來源 AWS RLS blog）：
  1. **非 owner 角色 + `FORCE ROW LEVEL SECURITY`**——不可用 table owner 帳號跑應用連線。
  2. **`SET LOCAL` vs pgBouncer**——session variable（`SET app.current_tenant`）與 server-side 連線池不相容，須改 `SET LOCAL` + transaction pooling 或改顯式 `tenant_id WHERE`；**連線池策略必須在選 pool 前定案**。

### §2.2 per-session Silo（GPU/WebRTC 天然硬隔離＝架構賣點）

- GPU 轉檔與 WebRTC 審查因 `1 GPU = 1 Kit = 1 stream` **天然硬隔離**；落地端站點本身＝**最強物理 silo**（payload 不出站）。
- 一租戶 Kit crash 不波及他人 stream（blast radius 小）——主打為**架構賣點**，非事後補丁。
- 不承諾官方不存在的 live migration / hot-swap / fractional GPU（物理死線詳見 GPU 經濟檔）。

### §2.3 tenant-per-stamp（高法遵 tier）

- 國防/公共工程/關鍵基礎設施（AWS 明文「不願跑 pool」的客群）走**專屬 GPU 池 + 專屬儲存 + region/stamp pinning**。
- GPU 層做成獨立 compute stamp，架構驗收＝**最少部署兩個 GPU stamp**（破除程式碼寫死單一 Kit GPU 池假設）。
- 資料層宜 silo（獨立 schema 或 bucket 頂層 prefix）：資料匯出＝打包單一 prefix、GDPR 抹除＝`DROP SCHEMA`/刪 prefix + 級聯清 ConversionLedger/mapping 成原子操作。

### §2.4 Bridge 分層 ↔ 定價 tier 對照（規劃值·非實測）

| Tier | 資料隔離 | GPU 隔離 | 寫進 ADR |
|---|---|---|---|
| Free / Trial | Pool（pooled + RLS） | per-session Silo | 是 |
| Team | Bridge（獨立 schema/bucket prefix） | per-session Silo | 是 |
| Enterprise（高法遵） | tenant-per-stamp（silo） | 專屬 GPU stamp + region pinning | 是 |

> Bridge 分層即定價 tier 的技術基礎；隔離模型書面化 ADR 同時是 SOC 2 / ISO 27001 一級佐證（哪些 pool/silo/stamp、跨租戶防護在哪層）。

---

## §3 MinIO 隔離（per-tenant bucket）

MVP（<50 租戶）採 **per-tenant bucket（container-per-tenant）**外層隔離，租戶隔離**落在 bucket 層**（PLANNED·SaaS-M4）。對齊 Azure Blob 三層隔離表（來源 Azure `storage-data`）：

| 規模 | MinIO 隔離形態 | 隔離度/複雜度 |
|---|---|---|
| ≤ 5 租戶、資料量小 | 可退化為 shared-prefix（現況擋穿越即補此不足） | 低 |
| MVP（< 50 租戶） | **per-tenant bucket（container-per-tenant）** | 中隔離/中複雜度 |
| 逼近 50+ 或需自帶金鑰(BYO)/獨立備份 | 升級 **storage-account-per-tenant** | 高隔離/高複雜度 |

### §3.1 deriveIntakeFromKey 三層 key 語意（逐字不動）

`deriveIntakeFromKey` 內部三層 key 語意在 bucket 內**完全不變**：**種類=倒數第二段/版本=末段/中文→mv_\<hash8\>**。租戶隔離只加在 bucket 這一最外層，不侵入 watcher 解析。

- `#minio` 頁三層 raw-folder 唯讀瀏覽（`delimiter='/'`）語意不變。
- E2/E5/E8 勘誤與四釘子在 bucket 內保持。
- 文件一律標 PLANNED，**嚴禁寫「已支援多租戶」**。

> 待人類簽核觸發條件：(a) 任何要改 `deriveIntakeFromKey` 解析語意的需求；(b) 要改 `#minio` 頁既有呈現語意或四釘子任一釘。以上一律記為待人類簽核的新決策（見 §6）。

---

## §4 身分（org-per-tenant + tenant_id claim）

全部 PLANNED·未建。

### §4.1 org-per-tenant（Users Isolated by Organization）

- 採 Auth0『Users Isolated by Organization』模式——**BIM 圖資不跨企業共用身分**。
- shared-identity（顧問同時服務多業主）**延後 Phase 2**。
- `org_id`/`tenant` claim 必須在 token 顯式帶入，server 端依此做資料隔離（來源 Auth0 `multiple-organization-architecture`）。

### §4.2 tenant_id claim 集中驗證

- 每個 access token **強制帶 `tenant_id` claim**，由 **coordinator 中介層**集中驗證與範圍過濾，不讓各 service 自兜隔離。
- 先拆 **operator（治理權）/ viewer（觀看權）兩級 scope**（對應 APS `viewables:read` 窄 scope），不等真做 3-legged 才補（來源 APS OAuth v2 scopes）。

### §4.3 OAuth flow 與第三方 BCF client 相容

- MinIO watch 自動觸發走 **two-legged**；Edge Console 使用者登入走 **three-legged**。
- OAuth 相容三 flow：`authorization_code` / `implicit` / `resource_owner_password`（相容第三方 BCF client）；buildingSMART **Foundation API 明確排除 `client_credentials`**（來源 buildingSMART Foundation API `release_1_1`）。

### §4.4 Keycloak 選型（待人類簽核立項）

- **realm-per-tenant**：客戶數數百家內用（最強隔離、最簡單 GDPR/刪除語意）。
- **Keycloak Organizations / Auth0 Organizations**：目標數千自助租戶必須改用（單 realm 多租戶），否則撞 realm 數量效能牆。
- 社群回報 **600+ realm 效能惡化為非官方數字**（來源 Keycloak GitHub Discussion #11074，社群非官方，須實測，見 §8）。
- 企業自帶 AD/Okta 走 **Keycloak Identity Brokering / Auth0 Enterprise Connections**——列為企業導入必要前置能力（來源 Keycloak `server_admin`）。

> Keycloak realm-per-tenant vs Organizations 的立項選型屬高遷移成本決策，**待人類簽核**；社群效能牆數字禁當定案依據。

---

## §5 與現有單租戶 governance token 相容路徑

分階段引入租戶身分，**零改凍結面**（詳見對齊矩陣 §4.4 與後端凍結契約 §1）：

| 階段 | 對 token 的動作 | 相容保證 |
|---|---|---|
| **SaaS-M1** | 完全不動 token | 現況 byte-identical |
| **SaaS-M2** | 現況單一 token 視為 `tenant_id=default` 的隱含租戶（**tenant zero**），中介層逐步注入顯式 claim | 向後相容 |
| **SaaS-M2** | `X-Tenant-Id` header 為 **additive optional**，缺省時 fallback 現況單租戶路徑 | 缺省行為與現況一致 |

- proxy 路徑字串、enum 逐字 echo、envelope key 全部 **byte-identical**（不改名、不 flatten）。
- 驗收＝`X-Tenant-Id` 缺省時，coordinator proxy 行為與現況 **byte-for-byte 相同**。

> 突破 §1 觸發條件表（任一啟動即記為待人類簽核的新決策）：
>
> | 觸發條件 | 為何待簽核 |
> |---|---|
> | governance API 需新增 `user`/`org`/`project` 參數 | 侵入凍結契約 §1 |
> | 需修改 §1 禁改後端檔（`app.py` / `governanceProxy.ts` / `conversion_authority.py` 等） | 十二條凍結 |
> | target host 選擇邏輯需侵入 proxy 路徑語意 | 連動 `a1Machine.ts` / `data.ts` 消費者 |
> | `/v1` gateway 無法通過 golden-path 逐位元組對比測試 | 靜默破壞 §1 |

---

## §6 RBAC 與 Issue/BCF ACL（全屬待人類簽核的新決策）

現況 issues schema **無 assignee、無 ACL**；任何 ACL 模型都是全新契約。以下**全部維持現契約**，設計主張僅供簽核參考，不得在文件改寫或實作中偷渡：

- issues schema 無 assignee；BCF 面板 assignee **維持 O7·P1 dashed 不提供假控制（D-32）**。
- **IX-SS-04 裁定A（刻意不加 IP allowlist）逐字保留**。
- **D4 共同出海口 schema 不動**，租戶維度只加在最外層。

**設計主張（僅供簽核參考）**：租戶門控走 **token `tenant_id` claim 而非 IP allowlist**；issue/BCF ACL 在租戶/專案層定義。IX-SS-04 裁定A 與租戶門控之調和亦待簽核。

> 待人類簽核觸發條件（任一啟動即須人類簽核）：
> (a) 引入 issue/BCF ACL schema 或 assignee 寫入路徑；
> (b) 需調和 IX-SS-04 裁定A 與租戶門控；
> (c) 跨組織/跨專案 issue 可見性規則定義。

---

## §7 資料庫立場

- **落地端 SQLite + 雲端 MySQL＝§8.3 資料庫事實不過期**：governance-service host-native 單例 SQLite（`governance.db`）+ metadata 雲端 MySQL（`bim-control`）+ A5 TimescaleDB 未建。正文凡 Postgres 舊敘述沿用「程式碼 > 文件」更正段，**不復活**。
- **控制面新 Postgres 為全新雲端元件**：只存租戶/計費 metadata，與落地端 DB 物理分離，不牴觸凍結。
- governance schema-per-tenant＝SaaS-M4 **expand-contract**（先加不動既有欄位、每次只動一張表、雙寫驗證）——**牽動 §1 禁改後端檔即待人類簽核**。
- **不做單一 Postgres big-bang**；任何落地端 DB 遷移都走 expand-contract。

> 待人類簽核觸發條件：
> (a) 落地端 governance 資料要遷 Postgres 或改 schema-per-tenant 而牽動 `app.py`/`conversion_authority.py` 等禁改檔（SaaS-M4 啟動前）；
> (b) 任何會使 §8.3 過期的遷移——此屬更高效力文件（互動實作規格/開發軌跡）裁決之事，須先在該層取得裁決再實作。

---

## §8 未驗證假設

以下為推論類設計，正文引用時標「(未驗證，見未驗證假設章)」；不得包裝成 runtime-verified fact。

- **Keycloak 效能牆為社群數字**：realm-per-tenant 撞 600+ realm 效能惡化來自 Keycloak GitHub Discussion #11074（社群，非官方），落地前須實測；realm-per-tenant vs Organizations 選型待人類簽核（§4.4）。
- **零停機回填 `tenant_id` 無官方一手指引**：單租戶轉多租戶（AWS/Azure 皆預設新建多租戶），expand-contract + bridge 過渡為自建方案，每次只動一張表 + 雙寫驗證，SaaS-M4 前須充分 POC；pooled 收斂路徑與落地端 SQLite 單例現況的連動未定（見 §7 待簽核）。
- **Speckle / Bentley Enterprise 實體隔離程度未查得**：三層容器對齊取自各家公開資料模型文件，其 Enterprise tier 的實體隔離（silo/pool/stamp）細節未取得一手佐證，僅作結構對齊參考。
- **GPU 視為 Bridge silo 單元屬類比推論**：GPU-session 為 per-session silo 由 AWS/Azure 通用 SaaS 原則類比推論，未經 NVIDIA Omniverse 多租戶白皮書交叉驗證（詳見 GPU 經濟檔未驗證假設章）。
