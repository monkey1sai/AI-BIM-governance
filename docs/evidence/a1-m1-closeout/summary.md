# A1/M1 收尾包 · Browser E2E Evidence

- 日期：2026-06-15
- branch：`feat/a1-m1-closeout`
- spec：`docs/superpowers/specs/2026-06-15-a1-m1-closeout-design.md`
- engine：**Playwright（chromium）** —— gstack NEEDS_SETUP（缺 bun），default 引擎 Playwright（誠實記實際引擎，非品牌）。

## 取證環境（隔離 branch stack，未碰部署區 :8004/:49102）

部署區運行的 docker web plane（:8004）服務的是 origin/main dist-ui（無 stepper、其 governance 無 `/failures` 端點），故另起**隔離 branch 雙進程 stack**取證：

- branch governance-service：host-native `python app.py`，`GOV_PORT=49103`、fresh `GOV_DB_PATH`、`BIM_FILE_LIBRARY_ROOT=主工作區 storage`（含 270 等專案 + `fixture-bytes.ifc`）。含本 branch 的 `/api/rule-runs/{id}/failures` + `_storey_from_element` enrichment。
- branch coordinator：`npx tsx src/index.ts`，`PORT=8005`、`CONSOLE_DIST_DIR=worktree/web-viewer-sample/dist-ui`（本 branch `build:ui`，bundle 含 `a1-step-run`）、`GOVERNANCE_API_BASE=http://127.0.0.1:49103`。
- E2E：`E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/a1-m1-closeout.spec.ts`。

## Playwright 結果（皆 PASS，非 skip）

| test | 結果 | 涵蓋 |
|---|---|---|
| `選模型 → 自動亮步驟2 → 檢核 succeeded → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出` | ✅ **1 passed (6.3s)** | 五步 stepper 全流程 + 失敗抽屜展開（storey 欄 + 複製鈕斷言） |
| `重跑檢核 → 下游(Issue/匯出旗標)清空、已開 Issue artifact 仍在、記分板重建（證據型更新，可重跑不崩）` | ✅ **1 passed (4.4s)** | 重跑語意（清下游、保留 artifact） |

截圖：`a1-m1-closeout-flow.png`、`a1-m1-closeout-rerun.png`（同目錄）。

## API 硬證據（直打 branch stack :8005，proof of storey enrichment on real IFC）

對真實 `fixture-bytes.ifc`（89 MB，7126 構件）跑 rule-run → `/failures`：

```
rule_run_id = rr_d3f02ab59640
status = succeeded
total failures = 71            ← 與 commit-in-repo A1_EVIDENCE failed:71 完全吻合
sample（ifc_guid / ifc_name / storey / rule_code）：
  3$xKPHQlD10AG1 | Doors_Swing_Moelven-Modu     | storey='FL2' | DOOR-FIRERATING-REQUIRED
  1$6rKosWT5r9WG | 單開-矩形- (1):60 x 230 cm     | storey='FL1' | DOOR-FIRERATING-REQUIRED
  0zwbDetyr4YQBd | TA_玻纖木紋橫拉門_一般_單開...   | storey='FL1' | DOOR-FIRERATING-REQUIRED
storey 非 null 樣本：8/8
```

→ failures 端點按規則分組、開 model 補 **ifc_name + 真實樓層（FL1/FL2，走 spatial-chain 容納鏈）**，端到端證實有效（spec §2.2/§2.4/§6.3）。

## Vertical slice 七項（product-operability §5 / spec §6.3）

1. UI route 可達：`#/a1` 由 coordinator `/ui` 服務 ✅
2. 明確按鈕：`a1-step-pick / a1-step-run / a1-step-issues / a1-step-export` + 失敗規則 `a1-fail-toggle-*` ✅
3. default fixture：`storage/fixture-bytes.ifc`（真 IFC，非 mock）✅
4. 真實 backend API：`POST /api/governance/rule-runs` → 輪詢 → `getResults` → `GET .../failures`（branch governance 真跑，非 mock）✅
5. runtime ID 可見：`rule_run_id`（如 rr_d3f02ab59640）顯示於 stepper ✅
6. loading/success/failure/retry：stepper state（idle→…→delivered）依 server 確認前進；重跑 test 證 retry ✅
7. 截圖/trace 已落檔：兩張截圖 + 本 summary ✅

## 誠實註記

- 3D highlight 維持待建（`p1` disabled，需 M3/M4），非本輪範圍。
- 取證走隔離 branch stack（非部署區）；merge 後部署區從新 main 重建即服務此 UI。
- 一個非阻斷 React key warning（`FailureScoreboard` render path）已記錄，交 P5 對抗複驗裁決。
