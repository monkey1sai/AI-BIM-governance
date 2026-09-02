---
name: prompt-crafter
description: 專門根據使用者需求，產出符合 AI-BIM-governance 治理規範、各子服務邊界與「防差不多先生（Anti-Shortcut）」守則的標準化任務 Prompt。
---

# Prompt Crafter — 任務標準化 Prompt 生成器

本技能專門將使用者的自然語言需求，轉換為針對 **Gemini Flash**（或任何 Code Agent）經過結構化加固的標準 Prompt，徹底杜絕「差不多先生」現象（略過細節、未驗證即宣稱完成、臆造 API、忽略邊界條件）。

---

## 核心分析維度

當收到使用者的任務描述時，依據以下維度進行萃取與組裝：

### 1. 目標服務與邊界 (Service Target & Frozen Surfaces)
| 服務名稱 | 角色與邊界 | 專屬鐵律與命令 |
| :--- | :--- | :--- |
| **`bim-review-coordinator`** (`:8004`) | Session / Control Plane、對外 intake、Proxy | 負責 Session state 與轉發；維持對外部 API 與驗證。測試：`npm test` |
| **`governance-service`** (`:49102`) | A1 規則檢核 / A2 比對 / A3 衝突檢測 / BCF | 必須使用虛擬環境：`.venv\Scripts\python.exe -m pytest tests/`；保持 loopback 權威。 |
| **`web-viewer-sample`** (`:5173`) | 前端 Browser Client (React/Vite/Three) | **一律只呼叫 coordinator `:8004`**；嚴守 R2 API 三態（supported/unsupported/planned）；**禁改後端 proxy 與 `app.py`**。驗證：Playwright E2E。 |
| **`bim-streaming-server`** (`49100/49101`) | IFC->USDC 轉檔 authority + Kit WebRTC | **嚴禁修改 `conversion_authority.py`**；USD/Kit 變更需具備 first-frame/stage 實證。測試：`.venv\Scripts\python.exe -m pytest` |
| **`apps/kit-manager-web` & `services/kit-manager-api`** (`:8010`) | Kit 管理員操作介面與 API | 前後端分立，驗證 Kit fleet telemetry 與狀態管理。 |

### 2. 治理分級判定 (Lane Policy)
- **Lane F (Fast Fix)**：單一服務、1~3 檔案微調、小 Bug。不強制 GitNexus impact，跑 targeted tests 即可。
- **Lane B (Bounded Change)**：單一服務內明確功能、不改架構/公開 API。需執行一次 batch `gitnexus impact`，3~5 項 inline checklist。
- **Lane G (Governed Change)**：跨 >= 2 服務、改動公開 API/Schema、WebRTC/GPU、使用者流程。需獨立 branch/worktree，強制完整 GitNexus impact + detect-changes，包含 Playwright E2E。

---

## 輸出格式

生成標準 Prompt 時，請直接以 **Markdown 代碼區塊** 輸出，方便使用者一鍵複製：

```text
[任務分級]: Lane <F / B / G>
[目標服務]: <填入服務名稱，如 governance-service (:49102)>
[涉及檔案/模組]: <填入推估涉及的檔案或目錄路徑>

### 一、 需求目標
<條列式列出 1~3 點具體功能或修復目標>

### 二、 防偷懶硬約束 (Anti-Shortcut Rules)
1. **零佔位符 (No Placeholders)**：嚴禁輸出 `// TODO`、`// FIXME`、`... 其餘代碼` 或空 catch 區塊，所有邊界狀況（null/undefined/空集合/網路異常/超時）必須完整實作。
2. **定義優先 (Inspect Before Edit)**：修改或呼叫任何 API/函式前，必須先使用 `view_file` 或定義查閱真實檔案，嚴禁盲猜或臆造未定義欄位。
3. **<依據服務填入專屬邊界>**:
   - (若前端): 前端一律呼叫 coordinator `:8004`，遵守 R2 API 三態處理，嚴禁修改 coordinator 的 proxy 與後端服務代碼。
   - (若 Python): 所有指令一律精確使用虛擬環境路徑 `.venv\Scripts\python.exe`。
   - (若 Streaming): 嚴禁修改 `conversion_authority.py`。

### 三、 執行步驟 (Checklist)
1. [ ] 執行影響分析：`gitnexus impact <核心Symbol> -d upstream -r AI-BIM-governance`（Lane B/G 必跑）
2. [ ] 實作最小有效改動，保持現有程式碼架構與註解完整。
3. [ ] 執行專屬驗證：`<填入精確的驗證指令，如 .venv\Scripts\python.exe -m pytest <path> 或 npm test>`
4. [ ] 執行範圍檢查：`gitnexus detect-changes --scope compare --base-ref main`

### 四、 完成標準與驗收證據 (Evidence Required)
- **必須提供真實終端機 PASS 輸出截圖或 log 片段**，無實證輸出前絕不宣稱完成。
- 列出本次改動已覆蓋的 Edge Cases 清單。
```

---

## 互動範例

**使用者輸入**：
> "我想在 web-viewer-sample 增加一個檢查 BCF 匯出狀態的按鈕，如果後端還沒實作就顯示 planned"

**Skill 產出**：
```text
[任務分級]: Lane B (Bounded Change)
[目標服務]: web-viewer-sample (:5173)
[涉及檔案/模組]: web-viewer-sample/src/components/...

### 一、 需求目標
1. 在 web-viewer-sample 介面增加「檢查 BCF 匯出狀態」按鈕與狀態指示器。
2. 串接 coordinator (:8004) 的 BCF 狀態端點。
3. 嚴格遵守 API 三態：當後端回傳 501 / 未支援時，UI 必須優雅呈現「Planned (規劃中)」狀態，不得報錯或崩潰。

### 二、 防偷懶硬約束 (Anti-Shortcut Rules)
1. **零佔位符**：按鈕 Loading 狀態、Success 狀態、Failure 狀態與 Planned 狀態必須完整實作，禁止使用 mock 假資料或 `// TODO`。
2. **邊界防禦**：一律只向 `bim-review-coordinator` (`:8004`) 發送請求，嚴禁直接呼叫 `:49102`，嚴禁修改 coordinator 中的 proxy 檔案。
3. **視覺與型別**：先查閱既有 UI component 與型別定義，維持一致的 Design Token。

### 三、 執行步驟
1. [ ] 查閱現有 BCF 相關型別定義與 API client。
2. [ ] 實作按鈕與三態（supported/unsupported/planned）渲染邏輯。
3. [ ] 執行前端語意/單元測試驗證按鈕行為。
4. [ ] 執行 `gitnexus detect-changes --scope compare --base-ref main` 確認改動範圍。

### 四、 完成標準與驗收證據 (Evidence Required)
- 提供前端測試或 Playwright 驗證通過的完整 log。
- 附上三態（包含 Planned 狀態）的渲染實證。
```