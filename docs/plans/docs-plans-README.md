# docs/plans/ — 給 Claude Code 的導讀（必讀）

> 這個資料夾是「**要做成什麼樣子**」的事實來源（需求、互動語意、驗收條件）。
> 它**不是程式碼範本**：兩份 .html 是單檔 vanilla JS 示意原型，正式產品另有技術棧（見下）。

## 檔案角色

| 檔案 | 角色 | 照著做的部分 | 不要照抄的部分 |
|---|---|---|---|
| `ai-bim-governance-prototype.html` | 產品殼層需求原型（A1–A10 + 落地端控制台四頁） | 頁面清單、版面結構、互動語意（轉檔排程拖曳/Session 端點池/機隊重啟搬移）、誠實標記呈現 | 單檔 vanilla JS 實作。正式殼層 = **React 18 + TypeScript EdgeConsole**，由 coordinator `/ui` 提供 |
| `ai-bim-geo-viewer-prototype.html` | 3D viewer「執行計畫完成後」的驗收示意（對應 `#/viewer`、M4 成果） | 七區塊資訊架構（點選→IFC 語意→Pset/Qto→Spatial→GUID⇔USD 對應表→A1 疊加→反向跳轉）、驗證結果清單 | **自寫 canvas 3D 引擎（純示意）**。正式版 3D 畫面來自落地端 Kit 的 **WebRTC 串流**，前端只收 frame、指令走 DataChannel（`highlightPrimsRequest`） |
| `ai-bim-governance-設計規格.md` | v2 設計規格 | Design tokens、A1–A10 介面分析、MinIO 真實結構、兩次 NVIDIA 官方核實 | — |
| `ai-bim-governance-開發軌跡與執行計畫.md` | v3 軌跡 + 工程規格 + 執行計畫 | **實作順序照這份**：里程碑 M0–M8、各 App API 草案與 DoD、決策 D1–D9、未決事項 O1–O6 | — |

## 實作鐵律（違反 = 做錯）

1. **順序照 v3**：M0 地基 → M1 A1 核心閉環（P0，純 CPU，不碰 3D）→ M2 轉檔 → M3 串流 → M4 3D 連動 → M5+。不要先做 3D。
2. **Route contract**：`/ui`、`#/a1`、`#/viewer`、`#/conv`、`#/sessions`、`#/instances`、`#/minio`；operator 工具 `#/kit`、`#/demo-control` 保留不砍。
3. **誠實標記**（已實作/實測/示範/待建）由後端 `provenance.json` 驅動，不寫死前端；沒做的功能一律標「待建」，不得假裝完成。
4. **官方支援才做**：1 GPU = 1 Kit instance = 1 stream（同時 session ≤ GPU 數）；session 換 GPU = terminate + recreate（約 30–40 秒），**沒有 live migration**；spectator 共看同一 stream 不另吃 GPU。
5. **Issue 共同出海口**：A1/A2/A3/A5 共用同一 Issue/BCF schema（見 v3 §2.0.3），不要各做各的。
6. **AI 僅寫 session layer**，不碰 source model；建 Issue、批次修改、送 BCF 等動作要真人確認。
7. **資料路徑比照真實 MinIO**：`bim-control/{projectId}/{modelId}/model.ifc …`；轉檔輸出 `model.usdc` 寫回同一 modelId 資料夾並出 coverage 報告（不承諾 100% 無損）。
8. 服務邊界：governance-service :49102（規則/Issue/BCF，CPU）；coordinator :8004（session/instance）；MCP sidecars 9901/9902/9903。CORE 功能不依賴 GPU 即可交付。

## 驗收方式

每個里程碑以 v3 文件的 **DoD** 為準；介面行為以兩份原型的對應頁面為準（例：A1 五步 stepper 流程、機隊拖曳跳「重啟搬移」確認框、viewer 點選構件後右欄三區塊的內容結構）。

## 給 repo root CLAUDE.md 的建議段落（複製貼上）

```
## 需求事實來源
A1–A10 功能需求、UI 驗收語意與實作順序，一律以 docs/plans/ 為準：
先讀 docs/plans/README.md，再讀 ai-bim-governance-開發軌跡與執行計畫.md（順序）
與 ai-bim-governance-設計規格.md（介面）。兩份 .html 是行為示意，不是程式碼範本。
```
