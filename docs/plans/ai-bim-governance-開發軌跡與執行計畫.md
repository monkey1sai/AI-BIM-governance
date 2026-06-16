# AI-BIM-Governance — 開發軌跡 · A1–A10 工程規格 · 執行計畫

> 版本：v3.1 · 2026-06-10 初版 · **2026-06-11 勘誤**（route hash 無斜線、BCF 現行 2.1、版本層已落地、governance 經 proxy——實測依據見《ai-bim-governance-互動實作規格與標準對齊.md》PART A）
> 配套檔案：`ai-bim-governance-prototype.html`（v2 原型）、`ai-bim-governance-設計規格.md`（v2 規格）
> 對齊：https://bim-docs.jackshappybot.com/ （系統總覽）· repo `C:\Repos\active\iot\AI-BIM-governance`（branch `feat/edge-console-product-shell`）
> 執行前提：**你 + Claude 協作**（工作量以「輪次」計，一輪 ≈ 一次對話可完成並驗收的小目標）
> **實作紀律 / 技術債防線**：本計畫的里程碑/DoD 如何「不欠技術債、精準落地與驗收」，另見 `ai-bim-governance-實作紀律與技術債防線.md`（HOW 補充層，每輪交付前用其 §8 總檢查表逐條核對；它不改本計畫需求，與本計畫衝突時以本計畫為準）。

---

## 0. 這份文件怎麼用（給不懂工程的你）

全文分三大部分：

- **PART 1 開發軌跡**：到今天為止發生了什麼、做了哪些決定、為什麼。你想跟別人介紹這個專案，看這部分就夠。
- **PART 2 A1–A10 工程規格**：每個功能拆到「工程師拿了就能動工」的細度。你只要看每節開頭的「一句白話」和「驗收清單」，其餘是給寫程式時用的。
- **PART 3 執行計畫**：先做什麼、後做什麼、每一步怎麼驗收。下次開新對話，直接指著某一輪說「做這個」即可。

文末附 **名詞白話對照表**，看到看不懂的縮寫就翻最後一頁。

---

# PART 1 · 開發軌跡與歷史

## 1.1 一句話講這個專案

幫營建業主（億集 EZPLUS）管理 BIM 建築模型的平台：**雲端管帳號和規則（輕），客戶機房的 GPU 電腦管大模型和 3D 畫面（重）**；AI-BIM-Governance 是落地端那一半的操作介面與治理功能，核心賣點是 A1「模型自動檢核」加上 Omniverse 的 GPU 3D 能力（A6–A10）。

## 1.2 時間軸（誰、何時、做了什麼、產出）

| 輪次 | 時間 | 發生什麼 | 產出 / 狀態 |
|---|---|---|---|
| 輪 0 | 2026-05 及更早 | 主平台與文件既有資產成形：系統總覽網站（React SPA 六分頁：01 架構 / 02 Coordinator 控制台線稿 / 03 落地端入口 / 04 應用藍圖 / 05 BIM 治理 / 06 操作介面總覽）；舊規劃文件 `AI-BIM-governance-saas-roadmap-2026-05.md` | 網站在線；舊 roadmap 之後被 v2 規格**取代退役** |
| 輪 1 | ≈2026-06-08～09 | 梳理整體架構（雲端輕 / 落地重）、定案 A1–A10 十支應用、實際連線讀取你的 MinIO 真實資料結構、確立設計語言（深色 + NVIDIA 綠 + 誠實標記）、產出第一版原型與規格 | 專案記憶建立（脈絡可跨對話延續） |
| 輪 2 | 2026-06-09 | (a) v2「深色但友善」改版定稿：三欄版面、A1 五步引導、3D Viewer 呈現頁；(b) 新增**落地端控制台四頁**（轉檔排程 / Session 管理 / Kit·GPU 機隊 / MinIO 資料），全部比照 MinIO 真實結構；(c) 你給三點回饋（見 1.4 D6–D8）；(d) **兩次 NVIDIA 官方核實**；(e) 三頁做成真的能拖能點（9 + 10 項行為測試全過） | 交付 `ai-bim-governance-prototype.html`（單檔約 1,030 行 / 121KB）+ `ai-bim-governance-設計規格.md`（v2） |
| 輪 3 | 2026-06-10（今天） | readonly 盤點：釐清軌跡、拓展 A1–A10 到工程可執行級、排出協作版執行計畫 | 本文件 v3 |

## 1.3 資產盤點（現在手上有什麼）

**文件與原型**

| 資產 | 內容 | 狀態 |
|---|---|---|
| `ai-bim-governance-prototype.html` | 單檔可點原型：13 個實頁（home / a1 / issues / reports / viewer / gpu / conv / sessions / instances / minio / runtime / admin / spec）+ A2–A10 示範頁 + 右側 Chat USD Agent（A1、A2 有腳本化工具呼叫示範）。其中轉檔排程、Session 端點池、Kit·GPU 機隊三頁**可拖可點、會即時動** | 🟢 前端示意完成；資料為示範用 |
| `ai-bim-governance-設計規格.md` | v2 規格：設計原則、Design Tokens、A1–A10 介面分析、3D Viewer 角色表、落地端控制台四頁、MinIO 真實結構、NVIDIA 核實紀錄 | 🟢 已交付，為 repo 功能需求**主來源** |
| 系統總覽網站 | bim-docs.jackshappybot.com，六分頁 | 🟢 在線 |
| 本文件 v3 | 軌跡 + 工程規格 + 執行計畫 | 🟢 你正在看 |

**程式與基礎設施**

| 資產 | 內容 | 狀態 |
|---|---|---|
| Repo `C:\Repos\active\iot\AI-BIM-governance` | 目標落點；branch `feat/edge-console-product-shell` 定義產品殼層：coordinator `/ui` 掛 EdgeConsole（React 18 + TypeScript），route contract：`/ui`、`#a1`、`#viewer`、`#conv`、`#sessions`、`#instances`、`#minio` + operator 工具 `#kit`、`#demo-control` | 🟢 殼層已上線（2026-06-11 實測 coordinator `/ui`，hash 無斜線；另多出 Review Room／Model Intake／五步管線等頁）；差距清單見《互動實作規格》PART A |
| MinIO（內網 LAN） | bucket `bim-control`，PRIVATE，12.6 GiB / 867 objects；專案編號現況 270/889/990＋271（**2026-06-11 確認：皆為暫時測試 IFC 檔**，非正式專案） | 🟢 早期實測（見 1.5）；**短期真相源已改 local_fs storage**（D:\Users\deploy\AI-bim-geo\storage） |
| 落地端 runtime 規劃 | Omniverse Kit 107、USD/RTX、WebRTC 串流、Coordinator :8004、MCP sidecars（omni-ui-mcp :9901 / kit-mcp :9902 / usd-code-mcp :9903）、governance-service :49102 | ⚪ 規劃確立，實機串流待建 |
| 雲端 | Nuxt 3 + MySQL（control-plane：帳號、專案、權限） | 🟢 主平台既有 |

## 1.4 關鍵決策紀錄（為什麼長成現在這樣）

| # | 決策 | 原因 / 依據 |
|---|---|---|
| D1 | **雲端輕、落地重**的部署邊界 | 模型動輒上百 MB～GB、3D 要 GPU，放客戶內網；雲端只管帳號、規則、報表等薄邏輯 |
| D2 | **誠實標記制度**（已實作 / 實測 / 示範 / 待建） | 不對客戶過度承諾；沿用系統總覽 AS-BUILT / DEMO DATA 文化，是整套介面的信任機制 |
| D3 | 介面走**深色 + NVIDIA 綠但更友善**（放大字級、圓角、留白）、白話優先、A1 做成五步引導 | 你是非工程背景，介面要「跟著步驟走」；專業感保留給客戶觀感 |
| D4 | **Issue 共同出海口**：A1/A2/A3/A5 的問題全部進同一套 Issue/BCF schema | 各應用不必各做各的；統一指派、打包交付 |
| D5 | AI 只在 **session layer** 操作、工具呼叫全程透明、危險動作真人確認 | 不碰 source model 才安全可還原；看得到 AI 做了什麼才放心 |
| D6 | **1 GPU = 1 Kit instance = 1 stream**；同時 session 數 ≤ GPU 數；spectator 共看不另吃 GPU | 你要求向 NVIDIA 核實 → 官方 Kit App Streaming 文件明訂「GPU: 1 per stream」 |
| D7 | MinIO 採**三層規劃**：projectId → OpenBIM 類別（機電/消防/管線/施工/牆面…）→ 版本 v01/v02；USD 以 projectId 為索引寫回同 modelId 資料夾 | 你的補充說明；第二層目前以 UUID 儲存（邏輯上＝類別）、第三層版本原「尚未實作」→ **2026-06-11 已以 local_fs 落地**：`270/機電|水電|消防/000001~000003＋竣工.ifc`（真 S3/MinIO 待接、版本命名規約待定案） |
| D8 | 原型先不碰 repo（你選了 B） | repo 尚未實作，先把介面語意做對 |
| D9 | **不做無縫 GPU 遷移**，拖放 = 重啟搬移（terminate + recreate）/ 排程偏好 / drain | 你的原則「官方支援才做」→ NVIDIA 官方無 migrate API，重啟約 30–40 秒、shader cache 冷可達 15 分鐘以上 |

## 1.5 已核實的硬事實（可直接引用，不必再查）

**MinIO 實測結構**（bucket `bim-control`）：

```
bim-control/
└── {projectId}            270 / 899 / 988   ←當時 bucket 所見；2026-06-11 確認現況為 270/889/990＋271（皆暫時測試檔）
    └── {modelId UUID}     例 123a909a-0f28-…（邏輯上＝OpenBIM 類別）
        ├── model.ifc        65.7 MB  來源 IFC（轉檔輸入）
        ├── model.rvt       222.9 MB  來源 Revit
        ├── elements.json     1.0 MB  解析：元素屬性
        ├── geometries.json  49.7 MB  解析：幾何
        ├── geometries_chunks/        manifest.json + chunk_0…6（串流分塊）
        ├── spatial_tree.json 2.3 KB  解析：空間樹（樓層/空間）
        └── model.usdc      （目前不存在 ← 轉檔管線要產生的東西）
```

**NVIDIA 官方核實**（兩筆，含出處）：

1. GPU worker「**number: 1 per stream**」、叢集 stream 上限 = GPU 數 → https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/requirements.html
2. streaming session **綁定單一 GPU pod**，生命週期僅 create / connect / disconnect / terminate，**無 migrate API**；新 stream 啟動 30–40 秒、shader cache 冷可 15 分鐘以上 → https://docs.omniverse.nvidia.com/ovas/latest/deployments/infra/limitations_etc.html

**02 線稿的 endpoint pool 模型**：1 個 Kit process = 1 PRIMARY（操作者）+ N SPECTATOR（旁觀者）；健康判定看「viewer 真的收到 frame」，不是看埠有沒有 listen（`port has listen ≠ viewer sees frame`）。

## 1.6 未決事項（接下來要解的開放問題）

| # | 開放問題 | 影響 | 建議在哪一輪解 |
|---|---|---|---|
| O1 | repo 實際現況（哪些目錄、能不能跑、coordinator/EdgeConsole 殼層到什麼程度） | 一切實作的起點 | M0-R1 |
| O2 | A1 第一批檢核規則清單（命名 / 分類 / 樓層 / 防火…要查哪幾條、嚴重度怎麼分） | A1 MVP 的靈魂 | M1-R2（要你參與決定） |
| O3 | MinIO「版本層」怎麼落地（資料夾命名規則、舊資料要不要搬） | A2 版本差異的前置 | M5-R1 |
| O4 | MinIO 新檔自動偵測機制（bucket event 通知 vs 輪詢） | 轉檔排程的觸發方式 | M2-R1 |
| O5 | 落地端實際 GPU 台數與型號 | session 容量、A8 算圖排程 | M3 前確認即可 |
| O6 | clash 碰撞引擎選型（A3）：自研幾何相交 vs 既有函式庫 | A3 從示範變真 | M5-R3 |

---

# PART 2 · A1–A10 工程可執行級規格

## 2.0 共用地基（看懂 A1–A10 之前先看這節）

### 2.0.1 共用資料模型（所有應用講同一套語言）

| 實體 | 關鍵欄位 | 白話 |
|---|---|---|
| Project | `projectId`（測試現況：270/889/990＋271，皆暫時測試 IFC）、名稱、階段 | 一個工程案 |
| Model | `modelId`(UUID)、projectId、discipline(OpenBIM 類別)、來源檔資訊 | MinIO 一個模型資料夾 |
| Version | `versionId`(v01/v02…)、modelId、上傳者、時間、備註 | 同一模型的某一版（local_fs 已落地檔名版本 000001~竣工；S3/MinIO 與命名規約待定，A2 可先用 ifcdiff 開工） |
| Element | `elementGuid`(IFC GlobalId)、ifcClass、名稱、樓層、屬性 bag、`usdPath`(轉檔後對應 prim) | 一個構件（牆、門、管…）；`elementGuid ↔ usdPath` 對照表是 3D 連動的關鍵 |
| RuleResult | `checkId`、ruleId、status(pass/fail)、severity、命中 elementGuids | A1 一條規則的檢核結果 |
| Issue | `issueId`、來源(app)、severity、標題、描述、elementGuids、指派、狀態、BCF 欄位 | 共同出海口；A1/A2/A3/A5 都往這裡丟 |
| ConvJob | `jobId`、modelId、狀態(queued/running/done/failed)、進度、coverage 報告 | 一筆 IFC→USD 轉檔任務 |
| Session | `sessionId`、kitInstanceId、stage 路徑、endpoint pool(1 PRI + N SPC)、health | 一場 GPU 審查 |
| KitInstance | `nodeId`、GPU 型號/util/VRAM、Kit PID/埠、載入 stage、drain 狀態 | 一台 GPU 節點上的 Kit |

### 2.0.2 服務與埠（誰負責什麼）

| 服務 | 埠 | 負責 |
|---|---|---|
| coordinator | :8004 | 控制塔：session/instance 排程、EdgeConsole `/ui` 殼層 |
| governance-service | :49102 | A1 規則引擎、Issue/BCF、報表（CPU 即可）；**browser 不直連，經 coordinator `/api/governance/*` proxy** |
| conversion worker | (隨 coordinator 管理) | IFC→USD 轉檔（CPU 吃重） |
| kit-mcp | :9902 | 對 Kit 場景下指令／查詢 prims |
| usd-code-mcp | :9903 | 產生／執行 Python-USD 程式碼（A9） |
| omni-ui-mcp | :9901 | Kit UI 自動化 |
| MinIO | 內網 | 物件儲存（模型、轉檔產物、BCF 包） |
| Postgres | 內網 | 治理帳本（規則結果、Issue、稽核軌跡） |

**通用約定**：REST 走 `/api/v1/...`；所有會「改東西」的 API 要帶操作者身分（稽核）；每個功能的可信度標記（已實作/實測/示範/待建）由後端設定檔 `provenance.json` 驅動，前端不寫死。

### 2.0.3 Issue / BCF 共同出海口（D4 的工程落法）

最小 Issue schema（A1/A2/A3/A5 共用）：

```json
{
  "issueId": "ISS-2026-0612-001",
  "source": "A1",                      // A1|A2|A3|A5|manual
  "severity": "Critical",              // Critical|Major|Minor
  "title": "FireDoor 缺 FireRating（37 件）",
  "projectId": "270", "modelId": "123a909a-…", "version": "v07",
  "elementGuids": ["1xF3…", "…"],
  "ruleId": "ARC-DOOR-REQ-001",        // 來源是 A1 時填
  "assignee": "Architect",
  "status": "open",                    // open|in_progress|resolved|closed
  "viewpoint": null                    // 3D 視角+截圖，M4 之後才有
}
```

匯出 BCF = 把 Issue 打包成 `.bcfzip`（**現行實作 BCF 2.1**；官方 bcf 庫支援 2.1/3.0，3.0 為升級目標。每個 issue 一個資料夾：`markup.bcf` 描述 + `viewpoint.bcfv` 視角 + `snapshot.png` 截圖；沒有 3D 時 viewpoint/snapshot 可缺省，誠實標「無視角資訊」）。

### 2.0.4 3D 的三種角色（邊界，避免過度承諾）

- **核心舞台**（沒 3D 就不成立）：A3、A5、A6、A7、A10 → 一定要 GPU session。
- **選用疊加**（API/表格/BCF 就能交付，3D 是加分）：A1、A2、A4 → 沒 GPU 也能用，但不得宣稱已完成 3D 高亮。
- **取景台 / AI 預覽**：A8（算訓練資料）、A9（看 AI 改了什麼）。

---

## A1 · 治理與模型檢核 ★P0 核心（最詳細，其他應用比照此格式從簡）

**一句白話**：把 IFC 模型丟進來，系統照規則自動抓錯（命名、分類、樓層、防火、編碼…），抓到的錯一鍵變 Issue、打包 BCF 交付。

**解的痛**：現在靠人工抽查圖模，漏抓、標準不一、來回改版吵不清責任。

**使用者故事**
1. 我是 BIM 經理：上傳 v07 → 5 分鐘內拿到「287 過 / 25 擋」記分板和規則清單，紅燈點開看是哪些構件。
2. 我是審查者：把 25 條失敗一鍵轉成 Issue 指派給建築師，打包 BCF 寄給對方公司。
3. 我是業主：看通過率趨勢，決定這版能不能進下一階段。

**功能拆解（MoSCoW）**

| # | 功能 | 級別 |
|---|---|---|
| F1 | 上傳/選擇 MinIO 既有 model.ifc 觸發檢核 | Must |
| F2 | 規則引擎：IfcOpenShell 解析 + ifctester 跑 IDS 規則 → pass/fail + 命中構件 | Must |
| F3 | 結果記分板（通過/擋下/通過率/構件數）+ 規則清單（可展開看構件） | Must |
| F4 | 失敗規則 → 批次建 Issue（進共同出海口） | Must |
| F5 | 匯出 BCF (.bcfzip · 現行 2.1，3.0 為目標) + Excel 清單 | Must |
| F6 | 規則庫管理：IDS/YAML 檔可增改、分專案啟用、設嚴重度 | Should |
| F7 | 檢核歷史與趨勢（每版通過率） | Should |
| F8 | 3D 高亮失敗構件（需 M4 的 review session + DataChannel） | Could（後期） |
| F9 | Revit 直讀（.rvt 不經 IFC） | Won't（暫不做，IFC 為主） |

**資料流**：MinIO `{projectId}/{modelId}/model.ifc` → governance-service 下載 → IfcOpenShell 載入 → ifctester 跑規則庫 → RuleResult 寫 Postgres → 介面顯示 → 使用者勾選 → Issue 寫 Postgres → BCF 打包上傳 MinIO `{projectId}/{modelId}/deliveries/`。

**API 草案**

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/v1/models/{modelId}/checks` | 發起檢核（body：規則集 id、版本） |
| GET | `/api/v1/checks/{checkId}` | 進度 + 記分板 + 規則結果 |
| GET | `/api/v1/checks/{checkId}/rules/{ruleId}/elements` | 某條規則命中的構件清單 |
| POST | `/api/v1/checks/{checkId}/issues` | 勾選的失敗規則批次轉 Issue |
| GET/POST | `/api/v1/rulesets` | 規則庫列表／上傳 IDS |
| POST | `/api/v1/deliveries/bcf` | 把選定 Issues 打包 .bcfzip |

**規則範例**（第一批規則要跟你一起定，這是格式示意）：

```yaml
- id: ARC-DOOR-REQ-001
  名稱: 防火門必須填防火時效
  適用: IfcDoor 且 Type=FireDoor
  條件: 屬性 FireRating 不得為空
  嚴重度: Critical
  負責方: Architect
```

**UI 對應**：route `#a1`，五步 stepper（上傳→檢核→結果→Issue→BCF），原型已可走完整流程（示範資料）；右側 Copilot 三條建議指令 + 工具呼叫示範已腳本化。

**驗收清單（A1 Core MVP 完成的定義）**
- [ ] 用真實 `model.ifc`（65.7MB 那支）跑完檢核不爆記憶體、5 分鐘內出結果
- [ ] 至少 10 條真規則（O2 工作坊定案）有 pass/fail 與命中構件
- [ ] 失敗規則可批次轉 Issue，Issue 中心看得到、可改狀態
- [ ] 匯出的 .bcfzip 能被第三方 BCF 檢視器（如 BIMcollab）打開
- [ ] EdgeConsole `#a1` 走的是真 API，不是示範資料；誠實標記翻成「已實作」
- 規格既有估計：純 Core MVP ≈ 1.5–2 人月（工程師口徑）；協作口徑見 PART 3 M1

**依賴**：MinIO 讀取權限、Postgres、O2 規則清單。**不依賴** GPU/Kit（這是 P0 能最快落地的原因）。

**風險**：IfcOpenShell 對特定 Revit 匯出的 IFC 相容性（先拿你三個專案的真檔測）；規則表達力不足時退 YAML+Python 自訂規則。

---

## A2 · 版本差異與責任追蹤（P1 · CORE · Phase 2）

**一句白話**：v06 跟 v07 到底改了什麼？誰改的？列成加（綠）/改（黃）/刪（紅）清單。

**功能拆解**：F1 版本選擇器（同 modelId 兩版）Must｜F2 差異引擎 Must｜F3 差異清單＋屬性層級 diff Must｜F4 變更→Issue（共同出海口）Should｜F5 「誰改、何時、為什麼」帳本（上傳時填變更說明）Should｜F6 3D onion-skin 疊影（新增綠/刪除紅幽靈/修改黃）Could（M4 後）。

**差異引擎兩條路**（M5 選型）：(a) IFC 層 diff——比 GlobalId 集合與屬性雜湊，CPU 可跑、先做；(b) USD 層 UsdDiff——有 model.usdc 後可比幾何，做 3D 疊影時需要。

**API 草案**：`POST /api/v1/models/{modelId}/diffs {from:"v06",to:"v07"}` → `GET /api/v1/diffs/{diffId}`（added[]/modified[]/removed[]，每筆含 elementGuid 與變更欄位）。

**前置（硬依賴）**：MinIO **版本層落地（O3）**——目前儲存層只有單版，沒有 v06/v07 可比。

**驗收**：兩版真檔比對出三色清單；點任一筆看屬性差異；可轉 Issue。
**風險**：GlobalId 在重新匯出時不穩定（Revit 習慣問題）→ 需定「同一構件」的比對鍵策略。

---

## A3 · 跨專業疊合（P1 · Phase 2）

**一句白話**：把同一專案的機電、消防、管線…模型疊在同一個 3D 畫面，自動找「打架」的地方。

**對應資料**：同 projectId 下多個 modelId（= 多個 OpenBIM 類別資料夾）→ USD 轉檔後以 layer stack 疊合（這正是 D7 三層結構的用途）。

**功能拆解**：F1 專業圖層開關（USD sublayer 載入/卸載）Must｜F2 疊合視圖（需 GPU session）Must｜F3 碰撞偵測引擎（O6 選型：trimesh/自研 BVH vs 既有庫）Should——目前原型誠實標「示範資料」｜F4 碰撞清單按嚴重度排序、點擊飛到衝突點、高亮兩構件 Should｜F5 碰撞→Issue Should。

**驗收**：270 專案兩個類別疊在同一 viewport、圖層可開關；（第二階段）跑出真碰撞清單且抽查 10 筆屬實。
**依賴**：M2 轉檔（要有 .usdc 才有 layer 可疊）+ M3 GPU session。**3D 角色：核心舞台**。

---

## A4 · 語意搜尋與模型問答（P1 · CORE · Phase 4）

**一句白話**：用一句中文找構件——「三樓所有沒填防火時效的防火門」——不用會查詢語法。

**架構**：兩段式。(1) **結構化過濾**：把白話解析成條件（樓層=3F、類別=IfcDoor、FireRating=空）直接查 elements.json 建的索引——可解 8 成需求、先做；(2) **向量語意**：屬性文字做 embedding 進向量庫，撈相似構件——後做。與右側 Copilot **共用同一查詢引擎**（規格 §6 A4 既有決定）。

**功能拆解**：F1 elements.json → 可查詢索引（Postgres/SQLite + 全文）Must｜F2 NL→條件解析（LLM function calling）Must｜F3 結果清單 + 轉 Issue/報表 Must｜F4 3D 高亮 isolate（M4 後）Could｜F5 向量語意層 Could。

**API**：`POST /api/v1/projects/{pid}/search {q:"三樓沒填防火時效的防火門"}` → 結構化解析結果 + elements[]（含解析出的條件，給使用者確認 AI 沒理解錯——透明原則）。

**驗收**：10 句典型問句正確率 ≥ 8 句；錯誤解析時使用者看得出來哪裡解錯。
**風險**：中文建築術語對映（防火時效=FireRating 這類對照表要累積）。

---

## A5 · IoT / BMS / FM 數位分身（P1 · MIX · Phase 3）

**一句白話**：溫濕度、電表、門禁的即時數據掛到 3D 構件上，異常變黃變紅，點下去看歷史和工單。

**功能拆解**：F1 感測點↔構件綁定表（sensorId ↔ elementGuid，手動維護起步）Must｜F2 MQTT bridge 收數據 → TimescaleDB 存歷史 Must｜F3 即時狀態 API + 門檻告警（綠/黃/紅）Must｜F4 3D 圖釘 + 樓層熱力（GPU session）Should｜F5 工單關聯（先內建簡單工單，後接客戶既有 FM 系統）Should｜F6 異常→Issue（共同出海口）Should。

**API**：`GET /api/v1/projects/{pid}/sensors/live`｜`GET /sensors/{id}/history?from=…`｜`POST /sensors/bindings`（綁定表）。

**驗收**：先用**模擬 MQTT 數據**跑通全流程（規格既定：感測接線⚪待建、示範資料先行）；之後接 1 個真實場域試點。
**3D 角色：核心舞台**（但 F1–F3 純後端可先做，不卡 GPU）。

---

## A6 · 4D / 5D 施工模擬（P2 · OMNI · Phase 2）

**一句白話**：把施工排程綁到構件上，拉時間軸看建築物一週週「長出來」，排程衝突亮紅燈；掛上成本就是 5D。

**功能拆解**：F1 排程匯入（CSV/MS Project XML：任務、起迄、綁構件群）Must｜F2 構件↔工項對映（按樓層/類別批次綁 + 手動微調）Must｜F3 4D 播放：USD timeSamples 控制可見性（未建半透明/當期高亮/已建實體）Must｜F4 時間軸 UI + 衝突偵測（同空間同時段兩工項）Should｜F5 成本曲線（工項單價 × 進度 = S-curve）Should｜F6 吊裝路徑動畫 Could。

**驗收**：拿一份真排程在 viewport 播出生長動畫；衝突清單至少抓到一筆人工驗證屬實。
**依賴**：M2 轉檔 + M3 session。**3D 角色：核心舞台**。

---

## A7 · Reality Capture 比對（P2 · OMNI · Phase 4）

**一句白話**：現場掃描的點雲疊到設計模型上，顏色標出「蓋的跟畫的差多少」。

**功能拆解**：F1 點雲匯入（E57/LAS → USD points）Must｜F2 對齊（先手動三點對位，後 ICP 自動精配）Must｜F3 偏差計算（點到設計面距離 → 熱力色階）Must｜F4 偏差報告（超標部位清單 + 截圖）Should｜F5 NeRF/3DGS 支援 Could。

**驗收**：一份真實掃描對齊後，偏差熱力圖與人工抽測 3 處吻合（誤差容許值跟你定）。
**依賴**：M2+M3；需要客戶供點雲檔。**3D 角色：核心舞台**。

---

## A8 · Synthetic Data Studio（P1 · OMNI · Phase 4）

**一句白話**：用 BIM 模型自動「拍」出成千上萬張帶標註的訓練圖片（RGB/深度/分割/框），給工安、設備辨識 AI 用。

**功能拆解**：F1 Dataset Job 卡（選場景/相機路徑/隨機化參數/輸出格式）Must｜F2 omni.replicator 腳本模板 + BasicWriter 執行 Must｜F3 COCO/YOLO 格式匯出到 MinIO Must｜F4 縮圖牆預覽 + 抽查標註正確性 Should｜F5 與 GPU 機隊排程整合（算圖吃 GPU，占用顯示在頂部 QUEUE）Should。

**驗收**：從 270 模型生成 100 張 COCO 格式圖檔，能直接餵進訓練腳本不報錯。
**依賴**：M2+M3。**3D 角色：取景台**（不是審查工具）。

---

## A9 · 設計 / 審查 Copilot（P2 · OMNI · Phase 4）

**一句白話**：跟 AI 說「把三樓的隔間牆改成 12 公分」，AI 寫 USD 程式碼改場景給你預覽，不滿意一鍵還原。

**安全鐵律（D5）**：所有改動只寫 **session layer**；一鍵還原 = 關掉 session layer 可見性；永不碰 source model；動作前確認。

**功能拆解**：F1 NL→Python-USD 代碼（usd-code-mcp :9903）Must｜F2 session layer 沙箱執行 + 被改 prim 高亮 Must｜F3 代碼與場景並排預覽、工具呼叫軌跡全顯示 Must｜F4 還原/重做棧 Should｜F5 OpenUSD API 問答（接官方知識庫）Could。

**驗收**：5 個改場景指令成功率/可還原性 100%；source model 檔案雜湊前後不變（用這個證明沒碰原檔）。
**依賴**：M3（要有 Kit session 才有場景可改）。

---

## A10 · 機器人 / 自動巡檢模擬（P2 · OMNI · Phase 4）

**一句白話**：在 3D 模型裡先讓虛擬機器狗/無人機走一遍巡檢路線，確認路線可行、拍照點對，再去現場部署。

**功能拆解**：F1 巡檢路徑繪製（waypoint 串接）Must｜F2 Isaac Sim 機器人沿線模擬（避障、繞行）Must｜F3 每點任務清單（拍照/讀表）+ 模擬相機取景預覽 Should｜F4 結果回放 + 可行性報告 Should｜F5 真機介接（ROS bridge）Won't（超出本期）。

**驗收**：在 270 模型畫一條跨樓層路線，模擬走完、輸出每點截圖。
**依賴**：M3 + Isaac Sim 環境（比 Kit 重，**建議最後做**）。

---

## 2.99 A1–A10 總覽表（優先序 × 依賴 × 狀態）

| App | 優先 | Phase | 3D 角色 | 硬依賴 | 目前狀態 |
|---|---|---|---|---|---|
| A1 治理檢核 | **P0** | 1 | 選用疊加 | 無（CPU 即可） | 介面🟢 引擎⚪ |
| A2 版本差異 | P1 | 2 | 選用疊加 | 版本層 O3 | 介面🟡 引擎⚪ |
| A3 跨專業疊合 | P1 | 2 | 核心舞台 | M2 轉檔+M3 session | 介面🟡 clash⚪ |
| A4 語意搜尋 | P1 | 4 | 選用疊加 | elements 索引 | 介面🟡 引擎⚪ |
| A5 IoT/FM | P1 | 3 | 核心舞台 | 綁定表+MQTT | 介面🟡 接線⚪ |
| A6 4D/5D | P2 | 2 | 核心舞台 | M2+M3+排程檔 | 介面🟡 ⚪ |
| A7 Reality Capture | P2 | 4 | 核心舞台 | M2+M3+點雲 | 介面🟡 ⚪ |
| A8 Synthetic Data | P1 | 4 | 取景台 | M2+M3 | 介面🟡 ⚪ |
| A9 Copilot | P2 | 4 | AI 預覽 | M3+usd-code-mcp | 介面🟡 ⚪ |
| A10 機器人巡檢 | P2 | 4 | 核心舞台 | M3+Isaac Sim | 介面🟡 ⚪ |

> 🟢 已實作 · 🟡 示範資料（介面通了）· ⚪ 待建。「介面🟡」= 原型有該頁與互動示意。

---

# PART 3 · 執行計畫（你 + Claude 協作版）

## 3.1 協作模式：一輪怎麼跑

「一輪」= 一次 Cowork 對話，完成**一個可驗收的小目標**。固定節奏：

1. **開場**：你說「做 M?-R?」（或貼這份文件指著某一輪）。Claude 讀記憶接上脈絡。
2. **動工**：Claude 寫程式／查官方文件／跑測試，過程中要動你的檔案夾或 repo 會先請你授權。
3. **驗收**：每輪結尾一定有「你能親眼確認的東西」——點得開的頁面、跑得出的結果檔、過了的測試清單。
4. **記錄**：Claude 把這輪結論寫回專案記憶，下輪無縫接續。

**鐵律（沿用既有決策）**：官方支援才做（D9）；誠實標記隨進度更新且由後端驅動（D2）；AI 只動 session layer、危險動作真人確認（D5）；預設 readonly，動 repo 前先授權（D8）。

## 3.2 里程碑總覽與關鍵路徑

```
M0 地基盤點 ──→ M1 A1 核心閉環（P0，最快見效）──→ M5 版本與疊合(A2/A3)
      │                                              ↑
      └──→ M2 轉檔管線 ──→ M3 Runtime 串流 ──→ M4 3D 連動 ─┘
                                   │
                                   └──→ M6 IoT(A5) · M7 4D/合成資料(A6/A8) · M8 進階(A7/A9/A10)
```

兩條主線可**交錯進行**：價值線（M1：不用 GPU 就能對客戶交付）與 3D 線（M2→M3→M4：把 Omniverse 賣點變真）。建議先衝 M1 拿到第一個「真的能用」的功能，再回頭鋪 3D 線。

| 里程碑 | 目標一句話 | 估計輪次 | 前置 |
|---|---|---|---|
| M0 地基盤點 | 看清 repo 現況、殼層能跑、標記設定化 | 2–3 輪 | 無 |
| M1 A1 核心閉環 | 上傳→檢核→Issue→BCF 全部來真的 | 6–8 輪 | M0 |
| M2 轉檔管線 | model.ifc 自動變 model.usdc 回寫 MinIO | 4–6 輪 | M0 |
| M3 Runtime 串流 | 瀏覽器看到 Kit 的真 3D 畫面（first frame） | 5–8 輪 | M2 |
| M4 3D 連動 | A1 高亮失敗構件、A4 搜尋結果框選 | 4–6 輪 | M1+M3 |
| M5 版本與疊合 | A2 真差異、A3 真疊合（clash 先選型） | 5–7 輪 | M1（A2 另需 O3）；A3 需 M3 |
| M6 IoT 試點 | A5 模擬數據走通 → 一個真場域 | 4–6 輪 | M3（3D 圖釘）；純後端部分僅需 M0 |
| M7 OMNI 加值一 | A6 4D 播放、A8 第一批訓練資料 | 6–8 輪 | M3 |
| M8 進階 | A7 點雲、A9 Copilot、A10 巡檢 | 8–12 輪 | M3（A10 另需 Isaac） |

> 輪次是估計值：每輪如果順（環境沒意外）就往低標走。總計約 44–64 輪。

## 3.3 各里程碑的輪次拆解與完成定義（DoD）

### M0 · 地基盤點（2–3 輪）
- **R1 repo 現況盤點（readonly）**：你授權資料夾 → Claude 列出目錄結構、能不能 build、coordinator/EdgeConsole 殼層與 route contract 差距 → 產出《現況與差距清單》。解 O1。
- **R2 殼層跑起來**：EdgeConsole `/ui` 在本機起得來，`#a1 #viewer #conv #sessions #instances #minio` 路由都有頁（內容可先是原型移植的示範資料）。
- **R3 誠實標記設定化**：`provenance.json` + 讀取 API，前端標記改吃設定。
- **DoD**：你在瀏覽器打開 `/ui` 能點到七頁；差距清單你看得懂。

### M1 · A1 核心閉環（6–8 輪）★建議最先衝
- **R1 規則引擎 PoC**：IfcOpenShell + ifctester 在本機吃真檔 `model.ifc`（65.7MB）跑 2–3 條示範規則 → 出 JSON 結果。先證明這條路通。
- **R2 規則工作坊（要你出席）**：跟你一起定第一批 10 條檢核規則（白話描述→Claude 翻成 IDS/YAML）。解 O2。
- **R3 governance-service 落地**：:49102 起服務、Postgres schema（RuleResult/Issue）、檢核 API 三支。
- **R4 `#a1` 接真 API**：五步 stepper 從示範資料換成真檢核；進度條是真進度。
- **R5 Issue 中心 + BCF**：批次轉 Issue、`.bcfzip` 匯出、Excel 清單。
- **R6 端到端驗收**：用三個測試專案（270/889/990）各跑一次完整五步；BCF 用第三方檢視器開啟驗證；誠實標記翻綠。
- **DoD**：A1 驗收清單（PART 2）全勾。

### M2 · 轉檔管線（4–6 輪）
- **R1 觸發機制選型**：MinIO bucket event vs 輪詢（解 O4）→ 官方文件核實後定案。
- **R2 轉檔 worker PoC**：IfcOpenShell → USD，真檔轉出 `model.usdc`，能在 usdview/Kit 開啟。
- **R3 coverage 報告**：property / relationship / attribute 轉換成功率統計（沿用「不承諾 100% 無損」原則）。
- **R4 佇列服務 + `#conv` 接真資料**：排隊、插隊、重試語意照原型，背後是真 job。
- **DoD**：丟一支新 model.ifc 進 MinIO → 不碰任何按鈕 → `model.usdc` 出現在同資料夾 + coverage 報告可看。

### M3 · Runtime 串流（5–8 輪）
- **R1 環境確認**：GPU 台數/型號（解 O5）、Kit 107 安裝、USD Viewer streaming template 起得來。
- **R2 單機串流 PoC**：一台 GPU 起 Kit → 瀏覽器 WebRTC 看到 first frame（健康判定照 D6：看 frame 不看埠）。
- **R3 coordinator 排程**：session create/terminate、1 GPU = 1 stream 守門、endpoint pool（1 PRI + N SPC）。
- **R4 `#sessions` `#instances` 接真資料**：含重啟搬移（confirm→terminate→recreate）與 drain，語意照 D9。
- **DoD**：兩個人同時在瀏覽器看同一 session（一人操作一人旁觀）；拖 session 到另一節點走完重啟搬移流程。

### M4 · 3D 連動（4–6 輪）
- **R1 DataChannel 通道**：`highlightPrimsRequest` 從瀏覽器到 Kit 走通。
- **R2 GUID↔prim 對照**：elementGuid ↔ usdPath 對照表（轉檔時產生，存 Postgres）。
- **R3 A1 高亮**：規則清單點「在 3D 高亮」→ 失敗構件變紅；截圖存證回寫 BCF viewpoint。
- **R4 A4 最小版**：結構化搜尋（NL→條件→elements 索引）+ 3D isolate。
- **DoD**：A1 的 F8、A4 的 F1–F4 驗收；A1/A4 誠實標記更新。

### M5–M8 · 擴展線（摘要）
- **M5**：O3 版本層落地 → A2 IFC-diff → 3D onion-skin；A3 layer 疊合 → O6 clash 選型 → 真碰撞清單。
- **M6**：A5 綁定表 + 模擬 MQTT 走通 → TimescaleDB → 3D 圖釘 → 真場域試點。
- **M7**：A6 排程匯入 + timeSamples 播放；A8 replicator 出第一批 COCO 資料集。
- **M8**：A7 點雲對齊與偏差熱力；A9 session layer Copilot；A10 Isaac 巡檢（最後做，環境最重）。

## 3.4 風險清單（前五名與對策）

| 風險 | 影響 | 對策 |
|---|---|---|
| IFC→USD 轉換 coverage 不足（幾何或屬性掉資料） | M2 之後全線 | coverage 報告制度化；掉的東西列清單不藏；必要時保留 elements.json 為屬性真相源 |
| repo 現況與規格差距大 | 全部時程 | M0-R1 先盤點再排程，不先承諾日期 |
| IfcOpenShell 吃特定 Revit IFC 會踩雷 | M1 | R1 PoC 直接用你三個專案的真檔測，提早爆雷 |
| GPU 資源有限（session 數 ≤ GPU 數） | M3 之後體驗 | 排程器 + drain 已設計；容量規劃等 O5 確認台數 |
| 中文語意搜尋對映不準 | A4 口碑 | 解析結果透明show給使用者確認；術語對照表隨用隨補 |

## 3.5 下一輪就能開始的三個選項

| 選項 | 內容 | 為什麼選它 |
|---|---|---|
| **(a) M0-R1 repo 盤點** | 你授權 repo 資料夾，readonly 盤點現況 | 一切的起點，解最大未知 O1 |
| **(b) M1-R1 規則引擎 PoC** | 不碰 repo，拿真 model.ifc 跑通 IfcOpenShell + ifctester | 直接驗證 P0 核心技術路線，最快有感 |
| **(c) M1-R2 規則工作坊** | 純討論，把 10 條檢核規則用白話定下來 | 不寫程式也能推進，且是 A1 的靈魂 |

> 建議順序：(b) 或 (c) 可以馬上做（不需要授權）；(a) 做完才能排準時程。三個都做完，M1 就等於開跑了。

---

# 附錄 · 名詞白話對照表

| 名詞 | 白話 |
|---|---|
| IFC | 建築模型的「通用交換檔格式」，像建築界的 PDF |
| Revit / .rvt | Autodesk 的建模軟體與它的原生檔 |
| USD / .usdc | NVIDIA Omniverse 用的 3D 場景格式；.usdc 是它的二進位檔 |
| Omniverse Kit | NVIDIA 的 3D 引擎平台，吃 GPU、負責漂亮的即時 3D |
| WebRTC 串流 | GPU 算好畫面，像視訊通話一樣串到你的瀏覽器，模型不用下載 |
| first frame | 瀏覽器收到的第一張 3D 畫面 = 串流真的通了的證據 |
| DataChannel | 串流旁邊的「悄悄話通道」，傳指令用（例如「把這幾個構件變紅」） |
| MCP | 讓 AI 能呼叫工具的標準介面；kit-mcp 等三個 sidecar 就是 AI 的手 |
| Coordinator | 落地端控制塔（:8004），決定哪台 GPU 跑哪個 session |
| EdgeConsole | 正式產品的前端殼層（React），掛在 coordinator 的 /ui |
| MinIO | 內網的「自家雲端硬碟」，存所有模型檔 |
| IfcOpenShell / ifctester | 開源工具：前者讀 IFC，後者照規則檢查 IFC |
| IDS | 「交付規範」的標準檔格式——把驗收要求寫成機器看得懂的清單 |
| BCF / .bcfzip | 建築界通用的「問題單」交換格式，可夾 3D 視角和截圖 |
| Issue | 一張問題單（誰、哪個構件、什麼問題、多嚴重、修了沒） |
| session layer | USD 的「描圖紙」層：AI 改動都畫在描圖紙上，原圖永遠不動 |
| prim | USD 場景裡的一個物件節點（一面牆、一扇門） |
| endpoint pool | 一場 session 的座位表：1 個駕駛（PRIMARY）+ N 個乘客（SPECTATOR） |
| drain / 排空 | 請一台 GPU「不收新客、送完現有客人就下班」，方便維護 |
| terminate + recreate | 換 GPU 的唯一正規做法：關掉重開（約 30–40 秒），不是無縫搬移 |
| coverage | 轉檔成功率報告：屬性、關聯、幾何各轉過去幾 % |
| Postgres / TimescaleDB | 資料庫；Timescale 是專門存時間序列（感測數據）的版本 |
| P0 / P1 / P2 | 優先級：P0 最優先（A1），P1 重要，P2 加值 |
| MoSCoW | 需求分級法：Must 必要 / Should 應該 / Could 可以 / Won't 本期不做 |

---

*v3 · 2026-06-10 · 由 readonly 盤點產出：上傳的原型與規格檔皆未修改。本文件可直接放入 repo（建議路徑 `docs/`），與 v2 規格並存：v2 管「介面長怎樣」，v3 管「軌跡、工程拆解與打仗順序」。*
