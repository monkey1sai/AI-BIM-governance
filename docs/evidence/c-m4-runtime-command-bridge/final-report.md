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

- `mapping-row`（`getByTestId("mapping-row").first()`）點擊 → 更新 `geo-viewer-right-semantic` / `geo-viewer-bottom-mapping`，且 `demo-outgoing-log` 不含 `focusPrimRequest`（驗證 UI-local 不觸發 runtime mutator）。註（P5 f3）：此處「不送 mutator」是 §2 UI-local 設計的正確行為，但同時意味 table 選列**沒有**第 7 塊 reverse-jump 的 focus 入口（只有 tree 有）——見 Known limitations f3，勿誤讀為第 7 塊 table 半邊已完成。
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

### P5 對抗複驗補揭露（2026-07-07，repo-health 後續收斂）

P5（`fu-adversarial-verify-generic`，6 個 refute-by-default 懷疑者）對 5 個 arbiter finding + 1 個 P4 gap 逐一複驗，結果：f2 閉合、f1/f3/f4/g1 與 f5 未閉合。f4 已於本輪補上 committed 回歸測試關閉；其餘四項屬「真實限制/gap」，據誠實鐵律於此揭露（holistic critic 因 session limit 未跑完，不影響以下逐項 code 親驗結論）：

- **f1（安全，Kit 端授權只驗字串形狀不驗真偽）**：`runtime_authority.py` 的 `is_authorized_mutator` 只從 client 自送 payload 讀 `role`/`session_id`/`lease_token` 三個字串，判斷 `role=="primary"` 且兩字串非空即放行，**不回 coordinator ViewerLeaseStore 驗證 token 真偽/撤銷/過期**。故 spec §6「forged client cannot mutate state」僅達成一半——缺欄位會被擋，但任一連上 DataChannel 的 client（含合法 spectator）偽造 `role:"primary"` + 任意 session_id/token 字串即可通過 Kit 端閘門。coordinator 端 lease 簽發/spectator 唯讀仍是真實權威層，Kit 端目前是 defense-in-depth 的形狀檢查，非真偽驗證。→ **follow-up：Kit 端 mutator 授權應回 coordinator 驗 lease 真偽（見待開 issue）**。
- **f3（第 7 塊 reverse-jump 只做 tree 半邊）**：spec §1 In-scope 的「table/tree/list → 3D focus/highlight 反向跳轉」，tree node 有 `_onSelectUSDPrims` 送 `selectPrimsRequest`+`focusPrimRequest`；**mapping table 選列被設計為純 UI-local（`onSelectGuid` 只 setState），無 focus affordance、不送 mutator**（符合 §2 `select_mapping_row=UI-local`，但第 7 塊 table 半邊的 focus 入口未建）。三層 E2E 全綠是因 spec 自身 Layer2 驗收只驗「選列更新語意面板」。
- **f5（embedded primary lease 晚到會 stall，無重試）**：embedded viewer 無法自取 lease（`window.parent!==window` 時 `_ensurePrimaryViewerLease` 回 null），完全依賴 parent 推 `viewer_lease_token`；若 token 晚於 3 秒 `_scheduleDeferredOpenStage` 自動開檔到達，`_failStageLoad` 後直接 return 且 **token handler 不重排開檔、`_canOpenSelectedAsset` 不等 lease**，可能真實黑畫面 stall。parent 側（`ReviewSessionViewerPane` 先取 lease 再 mount）正常時序 token 幾乎必先到，但**無順序保證、無競態測試**。只有真 Kit runtime 能觀察，本輪 Layer3 補收的是 standalone `/ui/open` lineage，未覆蓋 embedded Review Room 流程。→ **follow-up：token 到達時重試被擋的 open，或 `_canOpenSelectedAsset` 納入 lease 等待**。
- **g1（runtime mutator 的 browser 失敗/重試狀態無 E2E）**：Kit 端 `unauthorized_mutating_command` 拒絕只有 pytest 覆蓋；browser 端 mutator 拒絕/失敗呈現只有 vitest jsdom（`windowParentMessage.dom.test.tsx`），**無 Playwright E2E 演練失敗/重試 UI**。harness fakeKit 目前無 reject 模擬能力。→ **follow-up：harness 加 reject 模擬 + 失敗/重試 UI E2E**。
- **f4（已關閉）**：新增 `bim-review-coordinator/tests/no-generic-operations-endpoint.test.ts`（15 tests，斷言 7 條通用 operations 路徑 GET/POST 皆 404），把「coordinator 不得有通用 operations endpoint」邊界從一次性手動 rg 升級為 committed CI 回歸守衛。
