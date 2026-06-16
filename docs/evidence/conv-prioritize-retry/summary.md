# conv-prioritize-retry — Browser E2E evidence（Task 7）

IX-CV-03 #conv 轉檔佇列「插隊／重試」controlled action 的 user-facing browser E2E 證據抽樣。
spec：`docs/superpowers/specs/2026-06-16-conv-prioritize-retry-design.md`。
E2E spec 檔：`web-viewer-sample/e2e/conv-prioritize-retry.spec.ts`（守門 + skip-gate 效力限制段比照 `conv-coverage-report.spec.ts`）。

## 驗收切片（vertical slice）

`#conv` route → `Refresh queue`（GET `/api/external/ifc-ready`）→ 依狀態渲染的控制鈕
（`dispatch_failed`/`dropped_on_restart` → `data-testid="conv-retry-<id>"`；`queued_for_conversion`
且 `queue_position>=2` → `data-testid="conv-prioritize-<id>"`）→ 點按開 `IntentDialog`
（`data-testid="intent-dialog"`）→ confirm（`data-testid="intent-confirm"`）→ 真 coordinator
`POST /api/conversion/jobs/:id/{retry,prioritize}` → 觀察一次真後端 2xx 回應 → 列依回傳真狀態刷新
（非樂觀：POST 成功後 `load()` 重抓真佇列）。

## 本輪執行（2026-06-16，branch feat/conv-prioritize-retry）

- 指令：`cd web-viewer-sample && E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/conv-prioritize-retry.spec.ts`
- 前置實況：
  - branch coordinator `:8005` 可達；CORS preflight 對 `Origin: http://127.0.0.1:5180` 回 `204` +
    `Access-Control-Allow-Origin: http://127.0.0.1:5180`、`Allow-Methods` 含 `POST`（驗證通過）。
  - conversion authority `:49101` listening。
  - viewer 由 `playwright.config.ts` webServer 在 `:5180` 起 fresh build。
- 結果：**1 skipped（計 pass，EXIT=0）**，見 `playwright-run.txt`、`conv-prioritize-retry-trace.zip`。

> task#7 spec-compliance fix 補記（2026-06-17，第二輪）：修掉 spec 檔頭聲稱「coordinator base 由
> VITE_COORDINATOR_API_BASE 注入（預設 :8005）」但 `playwright.config.ts` webServer 實際未注入該 env
> 的結構性 gap。原本 webServer command 無 `env:` 欄位，Vite 不會把 `VITE_COORDINATOR_API_BASE`
> 帶進 dev server 進程 → `src/config/env.ts` 第 64 行 fallback `http://127.0.0.1:8004`，browser 端
> `coordinatorClient` 的 POST 會打 :8004 而非 branch coordinator :8005，導致前置齊全時 `page.waitForResponse`
> 攔不到真 POST、vertical slice 無法正確命中。修法：webServer 加 `env: { VITE_COORDINATOR_API_BASE:
> E2E_COORDINATOR_BASE_URL || ":8005" }`，使 viewer build-time coordinator base 與 test 端 `COORDINATOR`
> 常數同源。此 fix 同時修好共用同一 config 的 `conv-coverage-report.spec.ts`。註：本輪仍是 honest skip
> （前置佇列無可控制 job，種 dispatch_failed job 需重啟 :8005 並改其 `.env` 指向 500-stub authority，
> 屬 secrets/外部行程邊界，本 subagent 不為取證偽造佇列狀態）；config fix 移除的是「即使前置齊全也命中不到
> :8005」的結構性阻礙，不偽綠任何 gate。
>
> task#7 spec-compliance fix 補記（2026-06-17）：對齊規格範本，`test.describe` 改為
> `IX-CV-03 #conv 插隊／重試 controlled action`、單一測試名改為
> `控制鈕 → IntentDialog → 真 POST → 列依真狀態刷新`，並把 `notObserved` 揭露由 test body
> 的 `test.info().annotations` 改回 `test.afterAll` console 輸出（skip 下 test body 不執行，
> 唯 afterAll 仍跑，才不漏記揭露）。重跑驗證仍為 **1 skipped, EXIT=0**，且 afterAll 確實印出
> `[conv-prioritize-retry] notObserved: [...]`（見更新後 `playwright-run.txt`）；`playwright-run.txt`
> 已替換為與新名一致的真實 run 記錄。重跑當下未重新確認 `:8005`/`:49101` 前置實況（直接命中
> `beforeEach` skip），上方前置實況段為原 2026-06-16 觀察，保留不竄改。

### 為何本輪是 honest skip（not observed，非 fail、非偽綠）

`beforeEach` 守門查 `:8005` ifc-ready 佇列，本輪僅 1 筆 job：
`ifcready_1781590085298_904c631e | status=dispatched | queue_position=None`（已派工成功），
**無** `dispatch_failed`/`dropped_on_restart`（重試路徑），亦**無** `queued_for_conversion` 且
`queue_position>=2`（插隊路徑）可驗。依 spec 設計 → `test.skip` honest 揭露。

要種出可控制 job（如 spec 檔頭所述「500-stub authority 觸發 dispatch_failed」）需重起 branch coordinator
並改其 `STREAMING_CONVERSION_API_BASE` 指向 500-stub —— 涉及重啟正在執行的 `:8005` 行程與其 `.env`
（secrets 邊界，本 subagent 不改 `.env`、不重啟外部行程）。故本輪以 conditional skip + 本檔誠實揭露，
不偽造佇列狀態（守 mapping fake-vs-real 隔離與誠實鐵律）。

### skip-gate 效力限制（誠實註記）

`.github/workflows` 無任何 Playwright/e2e job，此 conditional skip 不會 false-green 任何既有自動化 gate；
純本機 / 指揮官手動 P4 gate。日後若升級為 CI 硬 gate，必須在 workflow 加「前置必備、缺失即 fail」的
setup step（起 coordinator + 種可控制 job），不能只靠這裡的 conditional skip。

## 深度因果兜底（已綠，補足 browser 本輪未觀察到的轉移）

- `bim-review-coordinator/tests/conversion-control-routes.test.ts`：**14 passed**
  （`POST .../prioritize`、`POST .../retry` → 真狀態轉移 + audit log；含非可控狀態 4xx、cap 邊界）。
  見 `conversion-control-routes-backstop.txt`。
- `web-viewer-sample/src/console/ConversionSchedulingPage.test.tsx`：UI 切片單元覆蓋
  （控制鈕 → IntentDialog → 真 POST mock → 列刷新；插隊鈕在隊首/in-flight disabled；
  POST 失敗不關 dialog）。

## render-surface 截圖證據（2026-06-17，spec-compliance fix：補 tracked .png）

task#7 requirement 要求「把截圖 + summary 複製到 tracked `docs/evidence/conv-prioritize-retry/`」，
但前兩輪 controlled-action slice 皆 honest skip（前置佇列無可控制 job、test body 未執行），故無 slice
截圖、evidence dir 缺 `.png`（與 conv-coverage-report / a1-m1-closeout / a2 等 peer evidence dir 不一致）。

本輪在 spec 內新增**獨立**的 render-surface 證據 test（`test.describe("…render-surface 證據…")`，不受
slice 的 `beforeEach` 守門），無條件渲染 `#conv` 真頁面 → 按 `Refresh queue` 載入 branch coordinator
`:8005` 的真佇列 → 截圖 `conv-render-surface.png`（PASS, 891ms）。截圖內容為 IFC→USD 轉檔排程頁
（插隊／重試控制鈕所在的真實 render surface，含 :8005 真佇列那筆 `dispatched` job）。

**誠實鐵律邊界**：此 `.png` **只**證明 `#conv` 真頁面渲染 + 截圖路徑機制可落點，**不**等於觀察到
controlled action（按鈕 → IntentDialog → 真 POST → 列刷新）。controlled-action slice 仍 honest skip、
不被本截圖偽綠；深度控制因果由 `conversion-control-routes.test.ts`（14 passed）與
`ConversionSchedulingPage.test.tsx` 單元切片兜底。亦同步落 `artifacts/e2e/conv-prioritize-retry-render-surface.png`
供本機檢視（非 tracked）。

## notObserved（誠實揭露）

- 本輪 browser 端未實際點到 `conv-retry`/`conv-prioritize`（前置佇列無可控制 job）；
  按鈕 → IntentDialog → 真 POST → 列刷新 這條 controlled-action browser 切片本輪 not observed。
- 故 controlled-action **slice 截圖**（`conv-prioritize-retry-retry.png`/`…-prioritize.png`）本輪未產生；
  上方 render-surface `.png` 是 `#conv` 頁面渲染證據，非 slice 觀察截圖（兩者語意不同，不可混為已驗控制動作）。
- trace.zip 為 Playwright 框架層 trace 抽樣（含 webServer 啟動與守門 GET）。

## 檔案

- `playwright-run.txt` — Playwright 執行輸出（1 skipped + 1 passed render-surface, EXIT=0）。
- `conv-render-surface.png` — `#conv` 真頁面 render surface 截圖（render 證據，非 controlled-action slice 截圖）。
- `conv-prioritize-retry-trace.zip` — Playwright trace 抽樣。
- `conversion-control-routes-backstop.txt` — 深度因果 route 測試 14 passed 輸出。
