# docs/plans/ — 給 Claude Code 的導讀（必讀）

> v1.1 · 2026-06-11 勘誤更新（依 `ai-bim-governance-互動實作規格與標準對齊.md` PART A 實測）
> 這個資料夾是「**要做成什麼樣子**」的事實來源（需求、互動語意、驗收條件）。
> 它**不是程式碼範本**：兩份 .html 是單檔 vanilla JS 示意原型，正式產品另有技術棧（見下）。
>
> **效力順序**：互動實作規格（行為/標準）＞ v3 計畫（順序/DoD）＞ v2 規格（介面）＞ 兩份 .html（視覺示意）。

## 檔案角色

| 檔案 | 角色 | 照著做的部分 | 不要照抄的部分 |
|---|---|---|---|
| `ai-bim-governance-互動實作規格與標準對齊.md` | **行為合約 + 實測差距 + 官方標準**（最高效力） | PART B 互動卡 IX-xx（狀態機/API/驗收）、六個通用互動模式、PART C 三領域官方對齊 | — |
| `ai-bim-governance-prototype.html` | 產品殼層需求原型（A1–A10 + 落地端控制台四頁） | 頁面清單、版面結構、互動語意（轉檔排程/Session 端點池/機隊重啟搬移）、誠實標記呈現 | 單檔 vanilla JS 實作。正式殼層 = **React 18 + TypeScript EdgeConsole**，由 coordinator `/ui` 提供 |
| `ai-bim-geo-viewer-prototype.html` | 3D viewer「執行計畫完成後」的驗收示意（對應 `#viewer`、M4 成果） | 七區塊資訊架構（點選→IFC 語意→Pset/Qto→Spatial→GUID⇔USD 對應表→A1 疊加→反向跳轉）、驗證結果清單 | **自寫 canvas 3D 引擎（純示意）**。正式版 3D 畫面來自落地端 Kit 的 **WebRTC 串流**，前端只收 frame、指令走 DataChannel（`highlightPrimsRequest`） |
| `ai-bim-governance-設計規格.md` | v2 設計規格 | Design tokens、A1–A10 介面分析、MinIO 三層結構、兩次 NVIDIA 官方核實 | — |
| `ai-bim-governance-開發軌跡與執行計畫.md` | v3 軌跡 + 工程規格 + 執行計畫 | **實作順序照這份**：里程碑 M0–M8、各 App API 草案與 DoD、決策 D1–D9、未決事項 O1–O6 | — |

## 實作鐵律（違反 = 做錯）

1. **順序照 v3**：M0 地基 → M1 A1 核心閉環（P0，純 CPU，不碰 3D）→ M2 轉檔 → M3 串流 → M4 3D 連動 → M5+。不要先做 3D。
2. **Route contract（2026-06-11 實測修正：hash 無斜線）**：`/ui`、`#home`、`#a1`、`#viewer`、`#conv`、`#sessions`、`#instances`、`#minio`、`#review`；operator 工具 `#kit`、`#demo-control` 保留不砍。
3. **誠實標記**（已實作/實測/示範/待建）由後端 provenance 驅動，不寫死前端；沒做的功能一律標「待建」，**不提供假按鈕**。
4. **官方支援才做**：1 GPU = 1 Kit instance = 1 stream（同時 session ≤ GPU 數）；session 換 GPU = terminate + recreate（約 30–40 秒），**沒有 live migration**；spectator 共看同一 stream 不另吃 GPU。
5. **Issue 共同出海口**：A1/A2/A3/A5 共用同一 Issue/BCF schema（見 v3 §2.0.3），不要各做各的。
6. **AI 僅寫 session layer**，不碰 source model；建 Issue、批次修改、送 BCF 等動作要真人確認（intent → confirm → audited result）。
7. **資料路徑**：短期真相源為 local_fs storage（比照 `bim-control/{projectId}/{類別}/{版本檔}` 三層規約；2026-06-11 已落地 `270/機電|水電|消防/000001~000003+竣工.ifc`），真 S3/MinIO 待接；轉檔輸出 `model.usdc` 寫回對應位置並出 coverage 報告（不承諾 100% 無損）。專案編號現況＝**270/889/990＋271，皆為 MinIO 暫時測試 IFC 檔**（非正式專案；正式資料匯入後替換，測試資料須在 UI 標示）。
8. 服務邊界：governance-service :49102（規則/Issue/BCF，CPU）——**browser 不直連，一律經 coordinator `/api/governance/*` proxy**；coordinator :8004（session/instance）；MCP sidecars 9901/9902/9903。CORE 功能不依賴 GPU 即可交付。
9. **BCF / IFC diff 對齊 IfcOpenShell 官方**：版本比對一律用 `ifcdiff`（JSON、GlobalId 鍵），不自寫 diff；BCF 用官方 bcf 庫語意（**現行 2.1 匯出保留**，3.0 為升級目標）。https://docs.ifcopenshell.org/
10. **IFC 轉檔對齊 IfcConvert 官方能力邊界**：IfcConvert 無 USD 輸出；自製 IFC→USD 必須 (a) 以 GlobalId 命名 prim（`G_<sanitized_guid>`）、(b) 出 mapping coverage 報告；備援路線 `IfcConvert --use-element-guids` → glb。https://docs.ifcopenshell.org/ifcconvert.html
11. **3D viewer 功能對齊 Omniverse 官方 extensions**：量測/批註/剖切/書籤/場景樹/屬性/串流一律用官方件（`omni.kit.tool.measure`、`omni.kit.tool.markup`、`omni.kit.window.section`、`omni.kit.waypoint.core`、`omni.kit.widget.stage`、`omni.kit.window.property`、`omni.kit.livestream.webrtc`），web 端不重做；自製僅限 **BCF 橋接層**。https://docs.omniverse.nvidia.com/extensions

## 驗收方式

每個里程碑以 v3 文件的 **DoD** 為準；互動行為以互動實作規格 **PART B 互動卡** 為準（含「禁止樂觀更新、一律證據型更新」）；介面長相以兩份原型的對應頁面為準。

## 給 repo root CLAUDE.md 的建議段落（複製貼上）

```
## 需求事實來源
A1–A10 功能需求、UI 驗收語意與實作順序，一律以 docs/plans/ 為準：
先讀 docs/plans/docs-plans-README.md，再讀 ai-bim-governance-互動實作規格與標準對齊.md（行為與標準）、
ai-bim-governance-開發軌跡與執行計畫.md（順序）與 ai-bim-governance-設計規格.md（介面）。
兩份 .html 是行為示意，不是程式碼範本。
```
