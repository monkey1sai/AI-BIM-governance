# Tasks

證據正本：`artifacts/2026-08-12-hifi-consumer-spec-scenario-audit.md`（行號即該檔行號）。
每項收斂 SHALL 只改措辭使其符合已上線行為，SHALL NOT 改 production 程式碼，
SHALL NOT 把 UNVERIFIABLE 項當成已驗證。

## 1. unified-governance-console（4 項 STALE）

- [x] 1.1 R3 Scenario「在 3D 標紅」→ 收斂為 selection highlighting（稽核 L297）。owner 2026-08-18
      明確選定 (b) 收斂 spec、不在 Kit 補顏色。已於 `specs/unified-governance-console/spec.md` 以
      `## MODIFIED Requirements` 落地：標題去除「標紅」、新增一條 AND 明載 Kit 現行以 USD selection
      呈現並回 `applied_mode: "selection"`，且明載 client 仍在協定 payload 帶 `color`（Kit 現行不消費）。
- [x] 1.2 「harness／無 GPU 時中央視區顯示資訊而非空白」收斂（稽核 L423）：requirement 的必備欄位改為實際呈現的 Stage URL／loaded prims／WebRTC／loaded layers／selected；移除未實作的 `camera 狀態`（`MockViewport.tsx` grep camera 零命中）；Scenario 明載對構表有 selection echo、結構樹無選取 callback；E2E 截圖歸部署驗證範圍不由措辭收斂視為已取得
- [x] 1.3 「Operator opens the product console」收斂（稽核 L478）：導覽分組改為實際的「工作台」／「AI 應用模組」兩組（`unified/fixtures.ts`），移除五組敘述；明載 shell 實為 topbar+sidebar+children+toastHost 四塊，且 Chat USD Agent side panel 不存在於 `UnifiedShell.tsx`（僅在 LegacyEdgeConsole）
- [x] 1.4 「Operator opens A1」收斂（稽核 L495；與 2.2 同源＝IA v2 把 a1/a2/a3 讓給 UnifiedConsole workspace）：明載 a1 由 `WorkspacePage initialDock="a1"` 承接、互動為 fixture 語意；移除 upload/select model 與 Excel delivery 的宣稱（`grep -rni "excel|xlsx" src/console/unified/` 零命中，Excel 面在 `#issues`）

## 2. edge-console-operator-frontend（5 項 STALE）

- [ ] 2.1 R1「兩段式導覽與 provenance 誠實標記」收斂（稽核 L48；provenance 側仍成立，不成立的是
      「開啟 `/console` SHALL 顯示 Governance Platform 與 Omniverse Runtime 兩段導覽」）
- [ ] 2.2 R3「A2/A3 為 as-built 操作頁並誠實標邊界」收斂（稽核 L81）
- [ ] 2.3 R5「缺 mediaPort 時不傳 null 給串流 library」收斂（稽核 L104）
- [ ] 2.4 「未設定時預設與 viewer 一致」收斂（稽核 L138）
- [ ] 2.5 「GPU／首幀無遙測標未取得（非 fail，非捏造）」收斂（稽核 L211）

## 3. 收尾

- [ ] 3.1 `npx openspec validate converge-console-specs-to-shipped-behavior --strict` 通過
- [ ] 3.2 `node scripts/tests/verify-openspec-repository-lifecycle.mjs` exit 0（三源一致）
- [ ] 3.3 PR body 誠實揭露：本 change 只收斂措辭、零 production 變更；6 項 UNVERIFIABLE 明列為
      **不在範圍**且仍未驗證；`migrate-console-to-hifi-design` 7.4 維持 unchecked
