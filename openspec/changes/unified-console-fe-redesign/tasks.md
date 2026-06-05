# Tasks — unified-console-fe-redesign（fe-redesign：統一治理控制台收斂到 :8004/ui）

> 對應 PR #184（branch `feat/fe-redesign-foundation`）。每期 = 一個 CH 階段，done 條件 = browser E2E evidence（Playwright 截圖/trace）。誠實鐵律：無真人可開 URL/點按鈕/用 fixture/看到結果 + Playwright 證據前不得宣告 done。

## 1. CH-0 可決定性 harness + Playwright

- [x] 1.1 `FakeAppStreamer`（換 transport + 假 Kit 大腦，不假造前端狀態機）+ `harness/streamer.ts` 旗標化
- [x] 1.2 Playwright config（專用 port 5180、strictPort、截圖/trace 落 `artifacts/e2e/`）+ viewer-harness smoke

## 2. CH-B viewer USD 樹 → 聚焦 + spectator gate

- [x] 2.1 左側 USD 語意樹 dock + 點節點→`focusPrimRequest`；viewport 點選→回灌樹
- [x] 2.2 spectator gate（唯讀，不送 mutating）；E2E viewer-tree-focus

## 3. CH-D `/api/kit/*` forward-only proxy

- [x] 3.1 coordinator `/api/kit/*` forward-only reverse-proxy → kit-manager :8010（loopback）
- [x] 3.2 瀏覽器禁直連 :8010；變更型需 operator/dev 授權（403 無 token）；E2E kit-proxy

## 4. 真實 IFC 垂直切片（frontend-operable + 誠實 runtime）

- [x] 4.1 `GET /api/dev/ifc-sources` 契約 shape（無絕對路徑 / 無 source_ref；穩定 source_id）
- [x] 4.2 `POST /api/dev/ifc-sources/:id/register`（coordinator loopback self-fetch → 真進件 → 真轉檔）；`ifc-file` loopback-only
- [x] 4.3 `#/demo-control` 從前端選真 IFC → 誠實 runtime（converting/ready/runtime_blocked/conversion_timeout/download_failed）+ lineage；E2E real-ifc-storage-intake / conversion-lineage / viewer-lineage

## 5. CH-F Stage/Artifact Binding + CH-C 角色權威

- [x] 5.1 `BindingComposer`（多選 ready USDC → 指定唯一 primary → load_order → 交易式 `composeStageRequest`，Kit `bindingApplied` 確認才 applied，保留 last-good）
- [x] 5.2 coordinator `POST /api/review-sessions/:id/stage-binding` 以 `source_client_id`/primary 後端角色權威（非 UI-only gate）；E2E stage-artifact-binding / primary-spectator-authority
- [ ] 5.3 streaming-server（host GPU Kit）DataChannel `source_client_id` 強制（需 host GPU runtime 真驗，見 proposal Non-goals / 已知限制）

## 6. CH-E React UnifiedConsole 上 :8004/ui

- [x] 6.1 `routing.ts` 認六 hash 路由（含 `#/` 前綴）+ coordinator `/ui` pathname；`?session=` 仍讓位 viewer
- [x] 6.2 `OperatorConsole` 六頁 + 修 `readPage` `#/` 前綴 bug；`KitConsolePage` / `RealIfcConsolePage` React port（同 testid、相對路徑 fetch）
- [x] 6.3 coordinator gated 服務 React console（`CONSOLE_DIST_DIR`；未設定回退 dev-console.html）；`build:ui`（vite base=/ui/ → dist-ui）+ compose 唯讀 bind-mount
- [x] 6.4 E2E unified-console-routes（六路由直接導航 + nav 切換）

## 7. CH-G URL 收斂 / RK6 守衛

- [x] 7.1 `/ui/console` 精確 301→`/ui`；`/ui/open?session=` 維持 302 凍結，先行精確註冊不被 `/ui/*` 吞
- [x] 7.2 E2E ui-open-regression（301 + 凍結 handoff 逐字保留）+ coordinator supertest

## 8. 驗證 / 對抗驗證

- [x] 8.1 `bim-review-coordinator`：`npm run build`(tsc) 綠 + `npm test` 291 passed（含 unit_kitpool fixture 補欄修 latent tsc break）
- [x] 8.2 `web-viewer-sample`：`npx tsc --noEmit` 0 error + `npm test` 158 passed
- [x] 8.3 Playwright E2E 12 specs 全綠；真轉檔產物 `stream_conv_20260605093932_f79903a0` → 真 model.usdc + element_mapping.json
- [x] 8.4 GitNexus impact 全 LOW、detect_changes low / 0 affected processes
