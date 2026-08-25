# unified-console-runtime-truth — Slice 2 Design（§4 coordinator：T4 operator-token per-route 授權＋D3 dev routes 關閉）

**Status**：approved slice。owner 2026-08-25 口令：「§4 coordinator 的 T4 operator-token per-route 授權與 D3 ENABLE_DEV_ROUTES=false 可平行開第二片」。

> **本 PR＝slice 2 後端半部（coordinator／compose／env template／tasks.md §4）。** 前端半部（web-viewer dev-routes 404 誠實狀態、`web-viewer-sample/e2e/dev-routes-disabled-operator-token.spec.ts`、瀏覽器證據、實作 plan）在姊妹分支 `codex/openspec/unified-console-runtime-truth-s2`（另一 PR，後端 PR 合併後跟進）。拆分原因：spec-to-done P5 對抗複驗的供給上限 400k 字元（coordinator 2026-08-25）。

**唯一忠實源**：`openspec/changes/unified-console-runtime-truth/`（`proposal.md`、`design.md` §2.1–§2.4、`tasks.md` §4 與 §0 裁決 0.2／0.3、`specs/unified-console-runtime-truth/spec.md` 的 requirement「canonical-linux 上 operator SHALL 能由 UI 觸發既有 MinIO 物件轉檔，授權 SHALL 以 per-route 方式落地且 SHALL NOT 放寬 lineage 與 webhook 面」及其「dev 路徑不是產品路徑且 canonical-linux 關閉 dev routes」scenario）。本檔只界定切片範圍與執行環境事實，**不新增需求**；衝突時以 change 為準。

## 1. Scope（本切片必做：tasks 4.1–4.5）

- 4.1 impact：`gitnexus impact rejectIfIpNotAllowed -d upstream -r AI-BIM-governance`；列出全部呼叫點並確認**不改 helper 本體**。
- 4.2 T4 per-route wrapper（owner 裁決 0.2）：四條 conversion 控制路由（`POST /api/conversion/trigger`、prioritize、retry、watch；`app.ts` 約 :1616／:1642／:1678／:1728，以 `rg -n "rejectIfIpNotAllowed"` 重新定位）改為「IP allowlist 通過 **或** operator token 通過」。token 比對沿用 `isKitMutationAuthorized`（`app.ts:4531`）的型式：header `x-operator-token`（相容 `x-dev-token`）與 `config.devAuthToken`（env `DEV_AUTH_TOKEN`）同型比對；`config.devAuthToken` 仍為預設值 `"dev-token"`（config.ts 已列為 defaulted secret）時 token 路徑視為**未啟用**（fail-closed，只剩 allowlist 路徑），避免公開預設值變成授權。速率限制：**只對 token 路徑**每來源 IP 每分鐘 10 次（in-memory 滑動視窗，不新增生產依賴），超額 429＋`Retry-After`；allowlist 路徑（含 loopback 的 minio-watcher self-POST）行為逐字不變。
- 4.3 釘樁測試：`lineageSourceBundleRoutes.ts` 的 `legacy-unmanaged/preview`／`confirm` 兩條路由與 `/api/external/*`（含 `/api/external/ifc-ready`）授權回應在變更前後逐字相同；prioritize／retry／watch 既有 allowlist 行為釘樁；`npx vitest run tests/lineage`（cwd `bim-review-coordinator`）。
- 4.4 D3（owner 裁決 0.3）：`compose.host-kit.yml` coordinator `environment:` 透傳 `ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}`（未設定＝空字串＝維持開啟，本機 local-windows 與隔離 branch stack 不受影響；canonical-linux 由 owner 在私有 canonical env 設 `false`）；`.env.example` parity guard 沿用 PR #693 `tests/env-example-lineage-parity.test.ts` 模式（新檔 `tests/env-example-dev-routes-parity.test.ts`，掃描 `src/app.ts` 的 `process.env.ENABLE_DEV_ROUTES` 讀取點並斷言 `.env.example` 有 `ENABLE_DEV_ROUTES=` 宣告）；`tests/dev-routes-disabled.test.ts`：`ENABLE_DEV_ROUTES=false` 時 `/api/dev/*`（含 `POST /api/dev/conversions`、`GET /api/dev/ifc-sources`、`GET /api/dev/test-data-projects`）回 404。前端（`web-viewer-sample`）：依賴 `/api/dev/*` 的 Edge Console 頁——`#demo-control`（`src/console/RealIfcConsolePage.tsx` 的 `/api/dev/ifc-sources*`）與 A1 workbench local_fs／測試資料清單（`coordinatorClient.ts` 的 `/api/dev/test-data-projects`、`/api/dev/conversions` 消費者）——在 404 時誠實顯示「dev routes 已關閉（canonical-linux）」，不崩潰、不假資料。
- 4.5 全量：`npm run build`（tsc）與 `npx vitest run`（cwd `bim-review-coordinator`）；前端受影響檔另跑 `npx tsc --noEmit` 與對應 vitest（cwd `web-viewer-sample`）。

## 2. tasks.md 驗證指令更正（P0 自檢發現，非新需求）

- `bim-review-coordinator/tests/` 為 **vitest**（無任何 `.py`、無 pytest）。`tasks.md` 4.2／4.4 所寫 `.venv/Scripts/python -m pytest bim-review-coordinator/tests/test_conversion_control_auth.py`、`test_dev_routes_disabled.py` 為工具名誤植；對應真實驗證為 `npx vitest run tests/conversion-control-auth.test.ts`、`tests/dev-routes-disabled.test.ts`、`tests/env-example-dev-routes-parity.test.ts`（cwd `bim-review-coordinator`）。本切片 PR 於 `tasks.md` 4.2／4.4 下方以子彈註記更正（不打勾）。

## 3. Out of scope

- `/ui` 殼層的 operator token 輸入與「觸發轉檔」按鈕啟用（tasks 2.4／§6.3，另切片）；§1–§3、§5、§6、§7。
- 不改 `rejectIfIpNotAllowed` 判定、不改 `EXTERNAL_INTAKE_IP_ALLOWLIST` 語意、`/api/external/*` 逐字不變、`/api/dev/*` 不作產品路徑、不動 lineage 後端契約、不新增生產依賴、不新增端點。
- `openspec/lifecycle-ledger.json`、`docs/plans/NOW.md` 本切片不改。

## 4. 勾選與 owner 動作

- `tasks.md` §4 task 為後端／測試 task：4.2／4.3／4.5 可於本切片 PR 以本機 vitest 綠打勾（非 UI task）；4.4 含 UI 顯示與 canonical env，只在下方註記「後端與 compose 透傳本機綠；canonical env 與 181 404 驗證待 owner」，不打勾；4.1 以 impact 輸出附於 PR body 後打勾。
- **owner 動作（AI 不得代做）**：(a) 在 `bim-review-coordinator/.env.example` 加一行 `ENABLE_DEV_ROUTES=`（附註解「canonical-linux 設 false；空＝維持開啟」）——本 session 的 protect-secrets hook 保護所有 `.env*`（含 `.env.example`），agent 不讀不改不繞道；parity 測試在該行落地前預期為紅。(b) 在 canonical-linux 私有 canonical env 設 `ENABLE_DEV_ROUTES=false`，並確認 `DEV_AUTH_TOKEN` 非預設值（否則 T4 token 路徑不啟用，UI 觸發只剩 allowlist）。

## 5. 執行環境事實（worktree）

- worktree 根：`C:\Repos\active\iot\AI-BIM-governance.worktrees\unified-console-runtime-truth-s2`；branch `codex/openspec/unified-console-runtime-truth-s2`（自 `origin/main` `2ef725a`）。
- `bim-review-coordinator` 已 `npm ci`；指令 cwd 為 `bim-review-coordinator`：`npm run build`、`npx vitest run <檔>`。前端若需驗證，`web-viewer-sample` 內先 `npm ci`。
- 既有相關測試：`tests/conversion-control-routes.test.ts`、`tests/conversion-trigger.test.ts`、`tests/lineage/external-lineage-authorization.test.ts`、`tests/dev-console.test.ts`、`tests/env-example-minio-watch-parity.test.ts`、`tests/env-example-lineage-parity.test.ts`；新測試沿用其 app 建構與 supertest／fetch 模式。
- GitNexus：本 worktree 於 HEAD 已 `npx gitnexus@1.6.9 analyze --index-only`；每個既有 symbol 修改前 `gitnexus impact <Symbol> -d upstream -r AI-BIM-governance`，HIGH／CRITICAL 先回報；commit 前 `gitnexus detect-changes --scope compare --base-ref main`（linked worktree 看不到 staged 時 fallback `git diff --name-only --cached` 並記 `detectVerdict='fallback'`）。
- Python venv 不在 worktree（本切片不需要）。
