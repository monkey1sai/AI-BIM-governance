# MinIO File-Server 來源落地（storage/270、889、990）設計

- 文件性質：spec design（設計文件）。權威序：code > contracts > AGENTS > wiki；與實作衝突時以實作程式碼與 `openspec/specs/` capability spec 為準。
- 日期：2026-06-10
- 狀態：使用者已授權自主推進（「以 storage\270, 889, 990 當作 minIO 的 file server 來源…依照自己的理解推進任務」）
- Phase 對應：M0-R2 殼層真資料化（`#/minio`）+ M1-R6 端到端驗收的資料地基（A1 檢核來源選擇器）
- userFacing：true

## 1. 背景與問題

`docs/plans/` v3 規約第 7 條：資料路徑比照真實 MinIO `bim-control/{projectId}/{modelId}/model.ifc…`。
使用者已在本機 `storage/` 備妥三個專案的真實結構：

```
storage/270/機電/ver 000001.ifc … ver 竣工.ifc   （4 版本）
storage/270/水電/…、storage/270/消防/…
storage/889/{機電,水電,消防}/…
storage/990/{機電,水電,消防}/…
```

共 3 專案 × 3 模型（discipline）× 4 版本 = 36 個 IFC。現況缺口：

1. `#/minio`（`web-viewer-sample/src/console/pages.tsx` 的 `MinioDataPage`）是寫死示意（`prov="demo"`），無任何真 API。
2. `#/a1` 檢核來源（`IssuesRuleCenterPage`）只有一個手填文字框，預設寫死 `storage/fixture-bytes.ifc` 絕對路徑；操作者無法瀏覽/選擇三個專案的檔案。
3. 後端沒有任何「檔案庫瀏覽」API；governance-service 的 rule-run 已吃 `ifc_source_path`（`governance-service/app.py:216`），但路徑來源全靠人工貼字串。

## 2. 目標（成功標準）

1. 後端提供唯讀 file-library browse API，把 `storage/` 下的 `{projectId}/{modelId}/*.ifc` 兩層結構暴露成樹（比照 `bim-control` 規約的 project/model/version 語意）。
2. `#/minio` 接真 API：操作者在瀏覽器看到 270/889/990 × 機電/水電/消防 × 4 版本的真實樹（檔名、大小、修改時間），標 `asbuilt`。
3. `#/a1` 新增「從檔案庫選擇」：project → model → version 三層選擇，選定後作為 rule-run 的 `ifc_source_path`；保留手動輸入（向後相容既有 E2E 與 fixture 流程）。
4. Browser E2E 證據：`#/minio` 樹可見三專案；`#/a1` 由選擇器選 `270/機電/ver 竣工.ifc` 跑出真檢核結果。

## 3. 非目標（明確不做）

- 不做真 S3/MinIO client 連線（本 spec 是 local file-server 模擬層；API 形狀設計成未來換真 MinIO 時前端不動）。
- 不做上傳 / 刪除 / 改名（唯讀來源）。
- 不做 O4 轉檔自動觸發（M2 範疇）、不做 A2 版本 diff（M5 範疇）。
- 不動 conversion 管線、不動 coordinator session/instance 邏輯。
- 頂層散檔（`storage/fixture-bytes.ifc`、`demo_lib_2026.ifc` 等不符兩層結構者）不列入樹 —— 它們不屬 `bim-control` 規約，A1 手動輸入路徑仍可用到它們。

## 4. 架構與元件

### 4.1 governance-service：file_library router（新增）

- 位置：`governance-service/file_library/`（新模組，比照 `issues/`、`diff_engine/` 既有 router 模式），掛進 `app.py`。
- Endpoint：`GET /api/files/tree`
  - 回應形狀：

    ```json
    {
      "root": "<解析後的絕對路徑>",
      "source_kind": "local_fs",
      "projects": [
        {
          "project_id": "270",
          "models": [
            {
              "model_id": "機電",
              "versions": [
                {
                  "name": "ver 000001.ifc",
                  "path": "<絕對路徑，給 rule-run ifc_source_path 用>",
                  "size_bytes": 8155,
                  "mtime": "2026-06-10T17:17:00+08:00"
                }
              ]
            }
          ]
        }
      ]
    }
    ```

  - `source_kind: "local_fs"` 是誠實標記欄位：前端據此顯示「local file-server（比照 bim-control 規約）」，未來真 MinIO 接上時改回 `"s3"`，前端文案跟著翻。
- Root 解析：env `BIM_FILE_LIBRARY_ROOT`，未設時預設 repo `storage/`（與 `app.py` 既有 storage 慣例一致）。
- 規則：
  - 只收兩層結構 `{projectId}/{modelId}/*.ifc`（大小寫不敏感的 `.ifc` 副檔名）；其餘檔案/層級忽略。
  - 一律 `os.path.realpath` 解析後檢查仍在 root 內（防 path traversal / symlink 逃逸）。
  - root 不存在或為空 → 回 `{projects: [], root, source_kind}`（200，不丟 500），前端顯示空狀態。
  - versions 排序：檔名自然排序，`ver 竣工.ifc` 固定排最後（竣工是最終版語意）。

### 4.2 coordinator：governanceProxy 白名單（新增一條）

- `bim-review-coordinator/src/routes/governanceProxy.ts` 是逐 endpoint 白名單轉發；新增：
  - `GET /api/governance/files/tree` → governance-service `GET /api/files/tree`
- 照既有 proxy helper 模式寫，不改其他路由。

### 4.3 EdgeConsole：`#/minio` 接真資料

- `MinioDataPage`（`pages.tsx`）改為：
  - 載入時呼叫 `governanceClient.filesTree()`（`data.ts` 的 client 加一個方法，走 `/api/governance/files/tree`）。
  - 主區塊：真實樹（project → model → versions，含大小/時間），`prov="asbuilt"`；面板副標明示「local file-server 來源（比照 bim-control/{projectId}/{modelId} 規約）；真 S3/MinIO 待接」。
  - loading / error / empty 三態都要有可見 UI（error 顯示原因，不假裝有資料）。
  - 原 bucket layout 規約示意縮為一個說明 Panel，維持 `prov="demo"` 標記（它是規約示意不是實況）。
- `model.usdc` 仍標 `p1`（轉檔產物待建），不得因本 spec 翻綠。

### 4.4 EdgeConsole：`#/a1` 檢核來源選擇器

- `IssuesRuleCenterPage`（`pages.tsx`）的 rule-run 表單區新增「從檔案庫選擇」：
  - 三層 `<select>`：專案（270/889/990）→ 模型（機電/水電/消防）→ 版本（4 檔）；資料來自同一 `filesTree()`（頁內共用一次載入）。
  - 選定版本 → 該檔絕對路徑填入既有 `ifc_source_path` 輸入框（輸入框保留、仍可手動覆寫；流程其餘部分不變）。
  - 檔案庫載入失敗時選擇器顯示不可用狀態與原因，手動輸入照常可用（graceful degradation）。
- 不改 rule-run / Issue / BCF 後端流程 —— 本 spec 只解「路徑怎麼來」。

## 5. 資料流（一句話版）

瀏覽器 `#/minio`、`#/a1` → coordinator `:8004 /api/governance/files/tree`（proxy）→ governance-service `:49102 /api/files/tree` → 讀 `BIM_FILE_LIBRARY_ROOT`（預設 `storage/`）→ 樹 JSON 原路返回；A1 選定的 `path` 直接作為既有 `POST /api/governance/rule-runs` 的 `ifc_source_path`。

## 6. 錯誤處理

| 情境 | 行為 |
|---|---|
| root 不存在 / 空 | API 回空 projects（200）；前端空狀態文案 |
| 路徑逃逸（symlink / ..） | 該項直接略過不列 |
| 樹 API 失敗（governance down） | `#/minio` 顯示 error 狀態；`#/a1` 選擇器標不可用、手動輸入照常 |
| 選到的檔在 run 前被移走 | 既有 rule-run 的 400（`ifc_source_path not found`）路徑已處理，前端顯示該錯誤 |

## 7. 測試與驗收

1. **governance-service pytest**（新 `tests/test_file_library.py`）：
   - tmp root 造 `{p}/{m}/*.ifc` 結構 → tree 形狀正確、只列 .ifc、兩層外忽略。
   - traversal：root 外 symlink 不出現。
   - root 不存在 → 200 空 projects。
   - `ver 竣工.ifc` 排最後。
2. **coordinator 測試**：proxy 轉發單元測試照 `governanceProxy` 既有測試模式加一條。
3. **前端 vitest**（`console.test.tsx` 既有模式）：MinioDataPage 三態 render；A1 選擇器選定後 input 值更新。
4. **Browser E2E（P4 硬 gate，Playwright）**：
   - `#/minio`：真樹可見 270/889/990 三專案與版本檔。
   - `#/a1`：選擇器選 `270/機電/ver 竣工.ifc` → 跑 rule-run → 檢核結果（記分板/列表）出現。
   - 截圖 + trace + summary JSON 落 `artifacts/e2e/minio-fileserver-source-*`。
5. **驗收基準**：上述 E2E 通過 + 四項回報；`#/minio` 不再有「整頁 demo」假象，誠實標記正確（local_fs 文案、usdc 仍 p1）。

## 8. 風險與緩解

- **中文路徑（機電/水電/消防、竣工）跨服務編碼**：governance-service 在 Windows host 跑 Python（既有 rule-run 已處理過中文檔名 fixture，如 `許良宇圖書館…ifc`）；JSON 全程 UTF-8。E2E 直接用中文路徑當 happy path，提早爆雷。
- **governance-service 是否在 deploy 腳本內**：若測試區 deploy 不含 governance-service，E2E 前指揮官依 golden path 啟動（`scripts/deploy.ps1` / 既有啟動方式），不在 workflow 內自啟。
- **`#/a1` 既有 E2E（a1-real-ifc-slice）回歸**：保留手動輸入框與預設值，既有測試不應壞；plan 內列回歸檢查。
