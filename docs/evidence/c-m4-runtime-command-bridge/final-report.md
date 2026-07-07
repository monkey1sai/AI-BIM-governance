# C M4 Runtime Command Bridge — 最終實作報告（Task7: Final Detect Changes And Review）

> spec: `docs/superpowers/specs/2026-07-03-c-m4-runtime-command-bridge-design.md`
> plan: `docs/superpowers/plans/2026-07-03-c-m4-runtime-command-bridge.md`
> branch: `feat/c-m4-runtime-command-bridge`（分支點 `bd18d02`，main 已於此之後再前進 21 個不相關 commit）
> 日期：2026-07-07

## Verified facts

- Whitespace：`git diff --check` / `git diff --cached --check` 皆乾淨，無 trailing whitespace。
- GitNexus `detect_changes(scope="compare", base_ref="bd18d02")`（真正分支點，非落後的 `main`）：`changed_files=17`、`risk_level=critical`。與 `git diff --stat bd18d02..HEAD` 的 20 個檔案交叉核對，缺口全部可解釋（見 Unverified risks）。
- Layer 1（contract/unit，本次獨立重跑，非僅信任前次 commit 訊息）：
  - `bim-review-coordinator`：`npx vitest run tests/viewer-leases.test.ts` → 8/8 passed。
  - `bim-streaming-server`：`python -m pytest tests/test_runtime_command_authority.py tests/test_stage_loading_stage_composition.py -q` → 10/10 passed；`python -m pytest tests -q`（全量）→ 103 passed。
  - root contracts：`.venv\Scripts\python.exe -m pytest tests -p no:cacheprovider -q`（主工作區 venv，於 worktree 執行）→ 79 passed。
  - `web-viewer-sample`：`npx vitest run src/console/windowParentMessage.dom.test.tsx` → 45/45 passed。
- Layer 2（browser/harness E2E，本次獨立重跑）：
  `npx playwright test e2e/gov-viewer-layout.spec.ts e2e/primary-spectator-authority.spec.ts e2e/runtime-command-bridge.spec.ts e2e/stage-artifact-binding.spec.ts --project=chromium` → 8/8 passed。
- Layer 3（real Kit/WebRTC）：`npx playwright test e2e/real-ifc-viewer-lineage.spec.ts e2e/real-ifc-conversion-lineage.spec.ts --project=chromium` → 2 skipped（沿用 Task6 結論，本次重跑結果一致：無 `mv_realifc_*` 命名的真實 IFC E2E fixture）。標記 `runtime evidence not collected in this run`，不宣稱完整 M4 readiness。
- `web-viewer-sample`：`npm run build`（vite build）成功；`npx tsc --noEmit` 有 1 個既有已知非阻擋提示（見 Known limitations）。
- Coordinator 邊界：`git diff --stat bd18d02..HEAD -- bim-review-coordinator/` 為空，確認本 spec 全程未修改 coordinator 程式碼（Task4 驗證結論成立）；`rg "/operations|viewer-operations|operation-log"` 掃描 `bim-review-coordinator/src` 與 `web-viewer-sample/src` 零命中，未新增通用 operations endpoint。
- 孤兒檔案歸戶：`docs/superpowers/plans/2026-07-03-c-m4-runtime-command-bridge.md`（指揮官本人 2026-07-06 直接編輯的 Task3 plan 修正決策）已於 commit `2c4c9ea`（task#3）正式歸戶，非本 task 遺留項。

## Inferences

- `risk_level=critical` 主要來自 `Window.tsx` 的 `_handleCustomEvent` / `_sendStreamMessage` 這類高扇出的中央 dispatch 符號被觸及（許多 cross_community process 都經過這裡），符合 spec 本身對這條改動的定性（「Cross-service runtime boundary and authorization risk」），非本 task 新增的意外風險。
- GitNexus `changed_symbols`（17 檔）少於 `git diff --stat`（20 檔）的差距，可歸因於既有已知的索引涵蓋率缺口（見 Unverified risks），非本 task 動作造成。

## Unverified risks

- GitNexus 對 `bim-streaming-server/.../stage_loading.py` 的索引缺席（與同名 template scaffold dedup 衝突）為 Task5 階段已查證、已由使用者 AskUserQuestion 確認放行的既知缺口（`acknowledgedCriticalSymbols`），本次 compare 掃描再次印證同一缺口，非新增問題，但仍是 GitNexus 本身尚待修復的涵蓋率限制。
- GitNexus 未捕捉到 `web-viewer-sample/e2e/gov-viewer-layout.spec.ts`、`e2e/runtime-command-bridge.spec.ts`、`src/harness/fixtures/harnessMapping.ts`（新檔）、`src/console/viewer/viewer.css` 的符號層變更（CSS 本無 code symbol 屬預期；e2e spec / 新檔可能因索引未涵蓋新增測試檔或建索引時間點早於這幾個 commit）。已用 `git diff --stat` 直接核對這些檔案內容與 plan 對應 task 描述一致，非隱藏的越界修改。
- Layer 3 real Kit/WebRTC evidence 本 run 全程未收集（無真實 IFC E2E fixture、無 host-native Kit 執行環境驗證 `messaging_tests.py`），M4 完整 readiness 尚未被證實，僅 Layer1+Layer2 通過。

## Frontend URL

- Harness（決定性、非連真後端）：`http://127.0.0.1:5180/?harness=1`（Playwright 專用 E2E port，見 `web-viewer-sample/playwright.config.ts:38`）。
- 正式產品入口（real runtime，非本次 Layer3 驗證環境）：coordinator `:8004/ui`（LAN IP），`web-viewer-sample` dev port `:5173` 僅 Kit 1:1 endpoint，不當入口暴露。

## Buttons tested

- `mapping-row`（`getByTestId("mapping-row").first()`）點擊 → 更新 `geo-viewer-right-semantic` / `geo-viewer-bottom-mapping`，且 `demo-outgoing-log` 不含 `focusPrimRequest`（驗證 UI-local 不觸發 runtime mutator）。
- primary 端 binding-apply 控制（`primary-spectator-authority.spec.ts`）→ 套用後出現 active binding revision。
- spectator 端控制（可見但 disabled）→ 誠實 readonly banner，不送 mutating。
- `stage-artifact-binding.spec.ts`：選 N 個 ready USDC → 指定 primary → 調 load_order → 套用 → active binding revision 出現。

## Test fixture used

- `web-viewer-sample/src/harness/fixtures/harnessMapping.ts`：3 筆 in-memory demo mapping（`HARNESS-DEMO-GUID-001/002/003`），全數標記 `mock: true` + `mapping_method: "fake_for_smoke_test"`，沿用 `MappingTable.tsx` 既有 `isFakeMappingItem` 誠實標示機制（`mapping-fake` badge），不冒充真實對映、不新增網路請求。

## Expected visible result

- `?harness=1` 下 C 區塊為真 3x3 grid IA：`geo-viewer-left-model` / `geo-viewer-center-stage` / `geo-viewer-right-semantic` 併排，`geo-viewer-bottom-mapping` 滿版，`geo-viewer-runtime-evidence` 滿版於頂列；單一頁面捲軸（無巢狀捲動）。
- 至少一筆 `mapping-row` 可見且 `mapping-fake` badge 可見（誠實標示 demo 資料）。
- primary 送出 binding-apply 後出現 active binding revision；spectator 控制可見但 disabled，不送 mutating。

## E2E command

```powershell
cd web-viewer-sample
npx playwright test e2e/gov-viewer-layout.spec.ts e2e/primary-spectator-authority.spec.ts e2e/runtime-command-bridge.spec.ts e2e/stage-artifact-binding.spec.ts --project=chromium
npx playwright test e2e/real-ifc-viewer-lineage.spec.ts e2e/real-ifc-conversion-lineage.spec.ts --project=chromium
```

## Screenshot/evidence path

- `artifacts/e2e/gov-viewer-layout.png`
- `artifacts/e2e/primary-spectator-authority.png`（本次重跑刷新）
- `artifacts/e2e/stage-artifact-binding.png`（本次重跑刷新）

## Known limitations

- Layer 3 real Kit/WebRTC runtime evidence 本 run 未收集（`runtime evidence not collected in this run`），不宣稱完整 M4 readiness；`messaging_tests.py`（Omniverse Kit AsyncTestCase）本機無 Kit runtime，僅 `py_compile` 驗證語法。
- Plan 字面指令 `npm test -- primary-spectator-authority` / `npm test -- stage-artifact-binding` 因 vitest include pattern 只認 `src/**/*.{test,spec}.{ts,tsx}`，實際上這兩支是 Playwright e2e spec，非 vitest unit test；Layer1 契約層改由 `bim-review-coordinator/tests/viewer-leases.test.ts` + 本次 Layer2 e2e 覆蓋（Task6 已記錄，本次重跑確認）。
- `web-viewer-sample/src/console/windowParentMessage.dom.test.tsx:677` 有 1 個 `tsc --noEmit` 提示 TS6133（mock fetch callback 中未讀的 `init` 參數），純測試 mock 未使用參數，無執行期風險，不影響 45/45 vitest 通過。
- 已知但非阻擋（Task3 quality-review 第 3 輪記錄，使用者已裁決接受不回頭修）：
  1. `useSynchronousSetState`（測試輔助函式）因 `use` 前綴命名被 `eslint-plugin-react-hooks` 誤判為 Hook，觸發 `react-hooks/rules-of-hooks` lint error；純命名問題，CI 目前未接 eslint gate，不擋 merge。
  2. `Window.tsx` 的 `_openSelectedAsset` 內「standalone+primary 缺 lease 就擋 `openStageRequest`」分支（`b6f9f3a` 引入）目前無測試覆蓋。
- Task5（`bim-streaming-server` mutator 授權）quality-review 因 Anthropic cyber-safeguard 連兩次誤判「cybersecurity topic」而無法自動跑完，改由指揮官親自逐行審查 commit `f979c3f` diff 作為 quality gate，經使用者裁決接受（非自動化 review 缺口的隱瞞）。
- GitNexus 對 `stage_loading.py` 的索引缺席（同名 template scaffold dedup）為既知限制，已於 Task5 由使用者確認放行（`acknowledgedCriticalSymbols`），本報告的 compare 掃描結果與此一致，非新問題。
