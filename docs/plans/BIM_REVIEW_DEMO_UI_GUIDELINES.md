# BIM Review Demo UI 設計守則 v0.4

> 本文件是後續所有 Demo UI 改動的**唯一風格依循**。任何 UI 修改若違反本守則，視為破壞 demo 一致性。
> 適用範圍：`_bim-control` / `_s3_storage` / `_conversion-service` / `bim-review-coordinator` / `web-viewer-sample` 五個有 UI 的服務。`bim-streaming-server` 無 UI，其存在感由 `web-viewer-sample` 的「串流連線狀態卡」呈現。
>
> 本守則**不新增功能**。所有 UI 元素都對應現有 API / 事件。

---

## 1. 目標客群

**主要受眾**：完全不理解系統內部的客戶。

意涵：
- 看到畫面 3 秒內必須能口述「這頁在做什麼」。
- **禁止**在主要文案出現以下技術名詞：`USD / USDC / prim_path / prim / DataChannel / payload / Socket.IO / room / namespace / IFC GUID / artifact_id / session_id / WebRTC signaling`。
- 上述名詞只能出現在「展開細節 (Show technical details)」折疊區、tooltip 或工程除錯抽屜內。

---

## 2. 六項設計原則

### 2.1 業務語言優先 Business language first

| 禁用 | 改用 |
|---|---|
| Upload IFC / 上傳 IFC | 上傳建模檔 (Upload model file) |
| Run conversion | 轉換成可審查模型 (Convert to reviewable model) |
| USDC artifact ready | 可審查模型已就緒 (Reviewable model ready) |
| Create review session | 建立審查會議 (Start review meeting) |
| Highlight prim | 標示問題位置 (Highlight issue location) |
| Annotation | 審查標註 (Review note) |
| Stream config / WebRTC | 雲端視訊連線 (Cloud video link) |

文案格式：**繁中為主、英文於括號內**。例：「審查會議 (Review session)」。技術術語在主介面**不英中並列**，僅在折疊細節內使用原始英文。

### 2.2 單一進入點 + 線性故事

每個 UI 頁頂部固定 5 步驟流程條：

```
①上傳建模 → ②自動轉換 → ③建立會議 → ④標記問題 → ⑤紀錄回寫
Upload   →  Convert   →  Meeting  →  Mark    →  Record
```

當前頁所對應的步驟亮起；其他步驟為灰色但可點擊（連到對應服務 URL）。

服務對應：
- 步驟 ① = `_s3_storage` (8002)
- 步驟 ② = `_conversion-service` (8003)
- 步驟 ③ = `bim-review-coordinator` (8004)
- 步驟 ④ = `web-viewer-sample` (5173) + `bim-streaming-server` (49100)
- 步驟 ⑤ = `_bim-control` (8001)

### 2.3 狀態號誌化 Traffic-light status

所有 status 一律映射成 3 色：

| 號誌 | 含義 | 範例文案 |
|---|---|---|
| ● 綠 | 就緒 / 已連線 / 已完成 | 「假主資料庫已連線」「可審查模型已就緒」 |
| ● 黃 | 進行中 / 等待中 | 「轉換中…剩約 30 秒」 |
| ● 紅 | 未啟動 / 失敗 / 不可用 | 「審查協調服務未啟動」 |

**禁止**直接顯示 `status: "ready"` / `status: "missing"` / HTTP 狀態碼於主介面。

### 2.4 每個按鈕一句「會發生什麼」 Action caption

每個 primary button 下方須有一行 14px caption，描述業務後果而非 API 名稱：

```
[ 開始轉換 ]
↳ 系統會把建模檔轉成 3D 可審查模型 (約 30~60 秒)
```

**錯誤示範**：`POST /api/conversions`、`Trigger conversion job`。

### 2.5 失敗友善 Friendly failure

所有錯誤面板必須顯示：
1. 哪個服務沒開（用業務名稱，不用 port）
2. 一行操作建議

範例：
```
● 紅  審查協調服務未啟動 (Review coordinator offline)
請在另一個終端機執行：cd bim-review-coordinator && npm run dev
```

**禁止**：
- 直接顯示 stack trace 於主介面
- 顯示 `ECONNREFUSED 127.0.0.1:8004` 於主介面（移到「展開細節」）

### 2.6 跨服務一致 Cross-service consistency

5 個 UI 共用同一份 design tokens（顏色、字型、步驟條樣式）。實作方式：
- `web-viewer-sample` 引用 `src/styles/demo-theme.css`
- `_bim-control` / `_s3_storage` / `_conversion-service` 的 `app/ui.py` 以 inline `<style>` 複製同一份 CSS 變數值（避免跨服務 CORS 載入）
- `bim-review-coordinator/public/index.html` 直接 inline 同一份變數

**Token 來源權威**：`web-viewer-sample/src/styles/demo-theme.css`。其他服務若需新增 token，先改這支再同步。

---

## 3. 共用 Design Tokens（規格）

```css
:root {
  /* 配色 — 淺色 + 藍色卡片 */
  --demo-bg: #f4f7fb;             /* 頁面底 */
  --demo-bg-elevated: #ffffff;    /* header/footer/輸入區 */
  --demo-bg-card: #eaf2fb;        /* 藍色卡片底 */
  --demo-border: #c9d6e6;
  --demo-text-primary: #102a43;
  --demo-text-secondary: #486581;
  --demo-text-muted: #829ab1;
  --demo-brand: #1d6fb8;          /* 主品牌色（深藍）*/
  --demo-brand-soft: #d6e8fa;
  --demo-status-ok: #2ea44f;      /* 綠 */
  --demo-status-warn: #b08800;    /* 黃 */
  --demo-status-bad: #d73a49;     /* 紅 */
  --demo-status-idle: #829ab1;    /* 灰 */

  /* 字型 */
  --demo-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI",
                    "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  --demo-font-mono: "JetBrains Mono", Consolas, "Courier New", monospace;

  /* 尺寸 */
  --demo-radius: 8px;
  --demo-radius-lg: 12px;
  --demo-gap: 16px;
  --demo-gap-lg: 24px;
  --demo-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
```

---

## 4. 標準頁面骨架

```
┌──────────────────────────────────────────────────────────┐
│ [LOGO] BIM 審查雲端 Demo                          [#步驟] │
├──────────────────────────────────────────────────────────┤
│  步驟條：①─②─③─④─⑤  (當前步驟亮起)                         │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   主內容區（業務語言、卡片化、號誌狀態）                    │
│                                                          │
│   [Primary Action]                                       │
│   ↳ 會發生什麼                                            │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  ▸ 展開技術細節 (Show technical details)                  │
├──────────────────────────────────────────────────────────┤
│  你現在在這裡：步驟 X｜下一步：[連到下一服務 URL]            │
└──────────────────────────────────────────────────────────┘
```

---

## 5. 5 步驟故事板（Demo 腳本）

| 步驟 | 客戶看到 | 服務 | URL | 操作 |
|---|---|---|---|---|
| ① 模型已備份在雲端倉庫 | 專案資料夾樹＋「IFC 原始檔已存放」 | `_s3_storage` | http://127.0.0.1:8002 | 純展示 |
| ② 自動轉成可審查 3D 模型 | 進度條跑完顯示「✅ 已產出可審查模型 + 元件對照表」 | `_conversion-service` | http://127.0.0.1:8003 | 點按鈕 |
| ③ 開啟雲端審查會議 | console「建立會議 → 取得連線資訊」 | `bim-review-coordinator` | http://127.0.0.1:8004 | 點按鈕 |
| ④ 進入瀏覽器看 3D 模型並點問題 | 串流＋問題清單，點問題 → 模型高亮 | `web-viewer-sample` | http://127.0.0.1:5173 | 點 issue |
| ⑤ 標記與紀錄回到主資料庫 | 顯示新增的標註紀錄 | `_bim-control` | http://127.0.0.1:8001 | 純展示 |

**Demo 順序保留調整空間**：必要時可省略步驟 ⑤ 以縮短時長，或從步驟 ③ 直接跳步驟 ④。但步驟條必須完整顯示，讓客戶理解全貌。

---

## 6. 反模式（嚴禁）

- ❌ 主介面顯示 raw JSON（必須折疊）
- ❌ 主介面顯示 HTTP 狀態碼或錯誤碼
- ❌ 按鈕文案直接複製 API 名稱（`POST /api/conversions`）
- ❌ 用 `success` / `error` / `pending` 英文顯示狀態（必須中文 + 號誌）
- ❌ 在 5 個服務之間用不同主色 / 字型（必須跨服務一致）
- ❌ 任何 emoji（除非是步驟編號 ①②③④⑤ 或號誌 ●）
- ❌ 大段英文 onboarding 文字（客戶讀不下去）

---

## 7. 維護規則

- 本文件變更必須先於程式變更。先改守則、PR review 守則、再改 UI。
- 任何新增 token 先進 `demo-theme.css`，再同步到其他服務 inline style。
- 文案改動須繁中與英文括號同步。
- 違反守則的 PR 應被退回，理由註明本文件章節編號。

---

## 8. 已知限制

- 本期不做 i18n。所有文案以繁中 + 英文括註的形式硬編碼。若未來需要英文 only demo，再抽 i18n。
- 一律淺色 + 藍色卡片風格；不支援深色主題（避免 demo 中切換感不一致）。
- 不支援手機 / 平板版面；demo 假設 1920×1080 桌面瀏覽器。
