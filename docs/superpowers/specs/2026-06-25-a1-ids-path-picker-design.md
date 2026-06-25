# A1 buildingSMART IDS 路徑預填與選檔入口

> 日期：2026-06-25
> 類型：frontend UX surgical change

## 背景與問題

A1 工作台原本的 buildingSMART IDS 欄位是空白 placeholder。使用者在操作時需要手動記住或貼上 repo 內預設規則路徑，也缺少就地選取 `.ids` 檔案的入口，讓規則校核前的準備動作變得不必要地費力。

## 需求

- A1 buildingSMART IDS 欄位 SHALL 預填 repo 內既有 sample IDS 規則路徑。
- 前端 SHALL 支援以環境變數覆寫預設 IDS 路徑，避免把單一路徑寫死成不可配置行為。
- 使用者 SHALL 能從欄位旁啟動 `.ids` file picker，選取檔名後更新欄位值。
- 實作 MUST NOT 新增 backend shell / `explorer.exe` helper，避免擴大本機執行面。

## 設計決策

預設值使用 `VITE_A1_DEFAULT_IDS_PATH`，未設定時 fallback 到：

```txt
C:\Repos\active\iot\AI-BIM-governance\governance-service\rules\sample-fire-rating.ids
```

選檔入口使用瀏覽器安全的 file picker；若瀏覽器不提供 `showOpenFilePicker`，則退回 hidden file input。因為 browser 不會可靠暴露使用者選取檔案的絕對路徑，fallback 行為只取選到的檔名，並沿用目前欄位中的資料夾路徑組成 server-local path。

## 驗證

- `npm run test -- src/console/console.test.tsx`
- `npm run build`
- `git diff --check`

## 非目標

- 不新增後端「開啟 Windows 資料夾」API。
- 不變更 A1 規則校核 API contract。
- 不更動 governance-service 規則引擎行為。
