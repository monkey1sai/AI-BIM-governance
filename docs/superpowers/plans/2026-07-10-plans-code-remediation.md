# plans×code 修復輪 Implementation Plan（2026-07-10）

> **✅ 全數落地（2026-07-10）**：Wave A＝PR #321、Wave B＝PR #322、Wave C＝PR #324、Wave D＝PR-D（本 PR）。
> 逐 task 完成狀態與發現修正（F4 誤報、W4 縮小修法、C1 清單調整、D4 改 env opt-in、D6 實驗結論）
> 見 spec `docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` §4.1 落地紀錄；
> 本檔 checkbox 不逐格回寫（完成真相＝spec 落地紀錄＋merged PR）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依 2026-07-10 分析輪與 grill 裁決（spec：`docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md`），把「裁決文件落地＋docs stale 同步＋合規 code 修＋衛生/golden path＋品質小修」以 Wave A–D 四個 PR 收口。

**Architecture:** 純文件（Wave A）→ 前後端合規小修（Wave B，user-facing 附 E2E）→ repo 衛生與部署腳本（Wave C）→ 防禦性品質修與 A2 對照實驗（Wave D）。全程在 worktree `worktree-remediation-plan-20260710`，每 wave 一個 PR、依慣例 auto-merge。

**Tech Stack:** React 18 + TypeScript（web-viewer-sample console／vitest）、Node/TS（bim-review-coordinator／vitest）、Python FastAPI（governance-service／pytest，host `C:\Program Files\Python312\python.exe`）、PowerShell（scripts）、root contracts（`.venv\Scripts\python.exe -m pytest tests`）。

## Global Constraints

- 凍結契約（手冊 §1）檔案僅可依裁決 R1/R3/R6 觸碰；其餘凍結檔一律不動；PR body 引 spec 為 Requirement source。
- 修改任何 code symbol 前先跑 GitNexus `impact`；每次 commit 前跑 `detect_changes` 與 `git diff --cached --check`（trailing whitespace 會被 hook 擋）。
- root 契約測試一律走 `.venv\Scripts\python.exe`；governance-service 測試走 host `"C:\Program Files\Python312\python.exe" -m pytest tests/ -v`；console 測試走 `npm test`（web-viewer-sample/）。
- user-facing 變更須附 branch 隔離 stack E2E 截圖（`artifacts/e2e/*.png` 要 `git add -f`），不碰部署區 :8004。
- enum 值、API 路徑、status 語意一律不變（§1.7 逐字 echo）；所有新增皆 additive。
- Conventional commits；PR 開完 `gh pr merge --squash --auto --delete-branch`；PR body 依 body-evidence 表逐字 label 填寫。
- docs/plans 各檔不得自建路由表（鐵律 #2）；修訂時只改指定列/句，不重排全檔。

---

## Wave A — 裁決文件落地＋docs stale 同步（純 docs；PR-A 含本 plan+spec）

### Task A1: 互動實作規格修訂（IX-3D-01、A.1.1 #conv 列、PART D 前提、#runtime 描述）

**Files:**
- Modify: `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md`（檔頭變更紀錄＋4 處）

**Interfaces:**
- Consumes: spec R1／R4（NAV 裁決＝路由表為準 → 本檔「群組」欄**不動**）
- Produces: Wave B Task B4（NAV 改 code）引用本檔 A.1.1 群組欄為權威

- [ ] **Step 1: 檔頭追加變更紀錄一行**（沿用檔內既有變更紀錄格式）：`2026-07-10 v2.x：IX-3D-01 修訂（承認 A1 evidence-gated inline viewer，PR #319）；A.1.1 第 16 列 #conv 改 alias（MD 三頁合一 #303/#304）；PART D 前提 1 同步；#runtime 現況描述更新。裁決紀錄見 docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md。`
- [ ] **Step 2: 修 IX-3D-01 卡**：先 `Grep "IX-3D-01"` 定位。將「不在 console 內嵌 WebRTC」約束改寫為：`預設路徑：/ui/open?session=（server redirect）。經 2026-07-10 裁決（PR #319 追認）：A1 治理工作台允許 evidence-gated、手動啟動的 inline viewer（mode="a1-inline"，ReviewSessionViewerPane→EmbeddedViewer iframe）；證據未齊一律 disabled；其他 console 頁仍禁內嵌。`（保留卡片其餘驗收語意。）
- [ ] **Step 3: 修 A.1.1 第 16 列**（`:93` 附近，原文 `| CV | #conv | IFC→USD 轉檔排程（P1） | OMNIVERSE RUNTIME | coordinator /api/conversions + streaming-server 轉檔 | 🟡 讀真 ifc-ready jobs；插隊/重試/coverage P1 |`）改為：`| CV | #conv | （alias→#minio；MD 三頁合一 #303/#304 後轉檔排程併入 ModelDataPage） | OMNIVERSE RUNTIME | AliasRedirect；功能後端同 M 列 | ✅ alias 保留；獨立頁已除役 |`
- [ ] **Step 4: 修 PART D 前提 1**（`:377` 附近「22 條 hash 與 data.ts PAGES 的同步關係維持不變」）改為：`22 條 hash 與 EdgeConsole.tsx switch 的對應維持不變；PAGES 導覽項自 2026-07-06 MD 三頁合一起少於 22（#conv/#intake 為 alias 不入導覽）。`
- [ ] **Step 5: 修 #runtime 列（row 20）backend/現況欄**：`🟡 端點真有；UI 監控面板待建` 改為 `🟡 已有 4 治理分頁＋sessions/kit 真遙測（經 coordinator proxy）；GPU/VRAM 遙測仍未取得`。
- [ ] **Step 6: 驗證＋commit**

Run: `grep -n "a1-inline" "docs/plans/ai-bim-governance-互動實作規格與標準對齊.md" && grep -n "alias→#minio" "docs/plans/ai-bim-governance-互動實作規格與標準對齊.md"`
Expected: 兩個都命中。

```bash
git add "docs/plans/ai-bim-governance-互動實作規格與標準對齊.md"
git commit -m "docs(plans): IX-3D-01 承認 a1-inline、A.1.1 #conv 列改 alias（R1 裁決落地）"
```

### Task A2: 手冊修訂（exception ledger 補登 ×3、§5.A、§1.9、加性慣例、#conv 殘句）

**Files:**
- Modify: `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md`

**Interfaces:**
- Consumes: spec R1/R3/R6
- Produces: Wave B Task B10（F3 修復）與既有 `4949b9b`/#319 端點的合法性依據

- [ ] **Step 1: §1.1 Approved Exceptions 表補登三列**（沿用既有 for-ifc-ready 列格式；Requirement source 逐列填）：
  1. `GET /api/governance/rule-runs`（history）＋`source_metadata` 持久化 — source：`docs/superpowers/plans/2026-07-09-a1-minio-worktree-conflict-resolution.md`＋本 spec R3（commit 4949b9b 追認）。
  2. `POST /api/external/ifc-ready/:jobId/review-session`＋A1 inline viewer — source：PR #319＋本 spec R1。
  3. `governance-service/app.py` `export_rule_run` cache-miss DB fallback（bug fix，行為僅「409→成功匯出」）— source：本 spec R6（預簽，Wave B Task B10 實作）。
- [ ] **Step 2: §5.A 修訂**：「不內嵌 3D」句改為「inline 3D 僅限 A1 evidence-gated 手動啟動路徑（IX-3D-01 2026-07-10 修訂版）；其他頁不內嵌」。
- [ ] **Step 3: §1.9 授權清單補列** `POST /api/conversion/trigger`（既有實作已掛 IP allowlist＋確認對話框；文件補認列）。
- [ ] **Step 4: §1 新增「加性慣例」條款**（R6）：`新增 coordinator 端點一律進 src/routes/*.ts（沿 governanceProxy.ts 先例）、新增 governance 端點一律進所屬 domain 的 api.py（rule_engine 面進 rule_engine/api.py）；禁止再向 app.ts/app.py 巨石 append。本條為凍結檔持續長大的止血線。`
- [ ] **Step 5: 修 §5/§6 內 `#conv`（ConversionSchedulingPage — BUILT）殘句**（`:191,196,365` 附近）：改為 `#conv=alias→#minio（ModelDataPage；MD 三頁合一 #303/#304）`。
- [ ] **Step 6: 驗證＋commit**

Run: `grep -n "conversion/trigger" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md" | head -3 && grep -c "4949b9b\|#319" "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md"`
Expected: trigger 在 §1.9 命中；exception 登記 ≥2 處。

```bash
git add "docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md"
git commit -m "docs(plans): exception ledger 補登 3 筆＋§5.A/§1.9/加性慣例（R1/R3/R6）"
```

### Task A3: docs-plans-README 修訂（鐵律 #7/#9、§1.1 兩列、§4 A3、鐵律 #8 顆粒度）

**Files:**
- Modify: `docs/plans/docs-plans-README.md`

- [ ] **Step 1: §1.1「IFC→USD 轉檔紀錄」列**：「缺的是前端 console 歷史頁呈現」改為「前端歷史呈現已於 2026-07-06 落地（ModelDataPage GlobalConversionPane『轉檔歷史』折疊區，#303）；殘餘為獨立第一入口頁與 >50 筆分頁（未排程）」。
- [ ] **Step 2: 鐵律 #7 第 2 釘同句同步修正**（同上措辭）。
- [ ] **Step 3: 鐵律 #7 第 4 釘兩處修正**：(a)「無已接線的手動佇列/插隊 UI 觸發新轉檔」改為「手動觸發已接線：`POST /api/conversion/trigger`（IP allowlist＋IntentDialog 確認＋idempotency；GlobalConversionPane/ObjectDetailPane『觸發轉檔』按鈕），僅對未偵測或終局失敗物件建新請求；prioritize/retry 仍僅作用既有 job」。(b)「270/889/990+271 皆為 MinIO 暫時測試 IFC 檔，須在 UI 標示測試資料」改為「MinIO bucket 為**真實資料監控來源**（不標測試資料）；local_fs storage 270/889/990/271 為本地測試 fixtures，A1 選檔 local_fs 來源須標『測試資料』（清單由 coordinator config 驅動，不得裸寫編號；R8 裁決）」。
- [ ] **Step 4: 鐵律 #9 改寫**（R2）：整段改為：`### 9. IFC diff / BCF 對齊 IfcOpenShell 官方語意\n版本比對現行採自製多級鍵引擎（governance-service/diff_engine：GlobalId→(is_a,Tag)→type+Name+loc；moved 用 placement Δ、property 用 pset hash；語意對齊 ifcdiff：GlobalId 主鍵、JSON 輸出）。2026-07-10 簽核：選型理由＝三級配對抗 GUID churn＋moved 責任語意＋直接對接 Issue/3D schema；已知限制＝跨 IFC schema 比對不保證正確，碰到跨 schema 需求時再評估官方 ifcdiff。BCF 用官方 bcf 庫語意（現行 2.1 保留，3.0 為升級目標）。`
- [ ] **Step 5: §1.1 A3 clash 列＋§4 A3 列**：「blocked-on-OCC」語句改為「clash NOT BUILT·**未開工**；O6 已裁定官方 `ifcclash` 路線（2026-07-07 spec），依 `docs/superpowers/plans/2026-07-07-a3-clash-ifcclash.md` 執行，舊 OCC-blocked plan 不再引用」。
- [ ] **Step 6: 鐵律 #8 表三處顆粒度**：spectator 列補「（signaling 49110 起、media 48008 起、stride 10，兩條序列）」；表尾加一列 `kit-manager-web | 127.0.0.1:5174 | kit-manager-api 的 operator 前端（Mode B compose） | 不作產品入口`；MCP sidecars 列補註「dev-time 官方驗證工具，非 golden-path runtime、不由 deploy.ps1 編排」。
- [ ] **Step 7: 驗證＋commit**

Run: `grep -n "真實資料監控來源" docs/plans/docs-plans-README.md && grep -n "ifcclash" docs/plans/docs-plans-README.md | head -3 && grep -n "kit-manager-web" docs/plans/docs-plans-README.md`
Expected: 全部命中。

```bash
git add docs/plans/docs-plans-README.md
git commit -m "docs(plans): README 鐵律#7/#9 依現實與 R2/R8 裁決改寫、A3 clash 敘述更新、#8 埠表補顆粒度"
```

### Task A4: 對齊矩陣 row16＋實作紀律 D-11 同步

**Files:**
- Modify: `docs/plans/ai-bim-governance-design-system-對齊矩陣.md`（`:72` row 16）
- Modify: `docs/plans/ai-bim-governance-實作紀律與技術債防線.md`（D-11、§11、§13 E1）

- [ ] **Step 1: 對齊矩陣 row 16**（原 `| 16 | #conv | CV | IFC→USD 轉檔排程 [P1] | ... | built（intake 佇列 + coverage）；轉檔歷史頁待建 | ✓ |`）改為 `| 16 | #conv | CV | alias→#minio（MD 三頁合一） | 同 19 列 M | alias；歷史呈現已併入 ModelDataPage | ✓ |`。
- [ ] **Step 2: 實作紀律 D-11 改寫**：`A2 diff 現行採自製多級鍵引擎（2026-07-10 簽核，選型理由與限制見 README 鐵律 #9）；前端直接吃其 JSON；跨 schema 需求出現時再評估 from ifcdiff import IfcDiff。`；§11 與 §13 E1 對應句同步（E1 改為「A2 diff 走簽核之自製引擎，語意對齊 ifcdiff」）。
- [ ] **Step 3: 驗證＋commit**

Run: `grep -rn "一律用.*ifcdiff\|無自寫比對" docs/plans/ | grep -v "再評估"`
Expected: 0 命中（舊強制句已全數改寫）。

```bash
git add docs/plans/ai-bim-governance-design-system-對齊矩陣.md docs/plans/ai-bim-governance-實作紀律與技術債防線.md
git commit -m "docs(plans): 對齊矩陣 #conv 列與 D-11/§13E1 依 R2 裁決同步"
```

### Task A5: 開 PR-A

- [ ] **Step 1**: `git push -u origin worktree-remediation-plan-20260710`
- [ ] **Step 2**: `gh pr create` — title `docs: plans×code 修復輪 Wave A（裁決落地＋stale 同步）`；body 含變更清單、Requirement source＝本 spec、body-evidence governance 表（docs-only 誠實填）。
- [ ] **Step 3**: `gh pr merge --squash --auto --delete-branch`；CI 綠後確認 merge，`git fetch --prune`。
- [ ] **Step 4**: Wave B 起在新分支 `fix/remediation-wave-b`（基於最新 origin/main）繼續。

---

## Wave B — 合規 code 修（PR-B；user-facing 附 E2E）

> Wave B 每個 code task：動 symbol 前跑 GitNexus `impact({target,direction:"upstream"})`；HIGH/CRITICAL 先回報。

### Task B1: typecheck 進 verify 與 CI（F11）

**Files:**
- Modify: `web-viewer-sample/package.json`（scripts）
- Modify: `.github/workflows/ci.yml`（viewer/console job）

**Interfaces:**
- Produces: `npm run typecheck`（`tsc --noEmit`）；後續所有前端 task 的驗證步驟都要跑它

- [ ] **Step 1**: package.json scripts 加 `"typecheck": "tsc --noEmit"`，並把 `"verify"` 改為 `"npm run typecheck && npm run build && npm run test && npm run test:struct-log"`。
- [ ] **Step 2**: ci.yml 的 web-viewer job 在 build 前加一步 `- run: npm run typecheck`（比照既有 step 縮排與 working-directory）。
- [ ] **Step 3: 驗證**

Run: `cd web-viewer-sample && npm run typecheck`
Expected: exit 0（若現況有型別錯誤→先修到 0 才 commit，錯誤清單列入 PR body）。

- [ ] **Step 4: Commit** `git commit -m "ci(web): typecheck 納入 verify 與 CI（F11，契約鎖生效）"`

### Task B2: A1 local_fs 測試資料標記（R8）

**Files:**
- Modify: `bim-review-coordinator/src/config.ts`（新增 `testDataProjectIds: string[]`，來源 env `TEST_DATA_PROJECT_IDS`，預設 `[]`）
- Modify: `bim-review-coordinator/src/app.ts` 之外——**不動 app.ts**：端點掛在 `bim-review-coordinator/src/routes/devMeta.ts`（新檔，加性慣例首例）`GET /api/dev/test-data-projects` → `{ projects: config.testDataProjectIds }`；在 app.ts 既有 route 掛載點以外無法掛載時，允許在 app.ts 僅加一行 `mountDevMetaRoutes(app, config)`（單行豁免，PR body 註明）。
- Modify: `bim-review-coordinator/.env.example`＋根 `.env.example`（補 `TEST_DATA_PROJECT_IDS=270,889,990,271` 註解範例）
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（加 `getTestDataProjects(): Promise<string[]>`）
- Modify: `web-viewer-sample/src/console/pages.tsx`（A1 local_fs 選檔下拉 `:906-927` 區：top-level 資料夾名命中清單者 label 加 `〔測試資料〕`）
- Test: `bim-review-coordinator/tests/dev-meta.test.ts`（新）＋`web-viewer-sample/src/console/` 既有 A1 測試檔加案例

- [ ] **Step 1: coordinator 失敗測試**

```ts
// bim-review-coordinator/tests/dev-meta.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
describe("test data projects config", () => {
  it("parses TEST_DATA_PROJECT_IDS csv", () => {
    const cfg = loadConfig({ TEST_DATA_PROJECT_IDS: "270, 889,990,271" });
    expect(cfg.testDataProjectIds).toEqual(["270", "889", "990", "271"]);
  });
  it("defaults to empty list", () => {
    expect(loadConfig({}).testDataProjectIds).toEqual([]);
  });
});
```

- [ ] **Step 2**: Run `cd bim-review-coordinator && npx vitest run tests/dev-meta.test.ts` → FAIL（欄位不存在）。
- [ ] **Step 3**: config.ts 用既有 `csvFromEnv` helper 實作 `testDataProjectIds`；`routes/devMeta.ts` 掛 `GET /api/dev/test-data-projects`（回 `{ projects }`，唯讀、無 auth 需求—非變更型）。
- [ ] **Step 4**: Run 同 Step 2 → PASS；`npx vitest run` 全套綠。
- [ ] **Step 5**: 前端—coordinatorClient 加 `getTestDataProjects`（`jsonGet<{projects:string[]}>("/api/dev/test-data-projects")`）；A1 local_fs 下拉渲染處以 `projects.includes(topLevelName)` 加 `〔測試資料〕` 後綴；沿 A1 既有測試檔（`console.test.tsx` A1 區塊）加一個 stub 案例斷言 label 出現。
- [ ] **Step 6**: Run `cd web-viewer-sample && npm run typecheck && npx vitest run src/console/console.test.tsx` → PASS。
- [ ] **Step 7: Commit** `git commit -m "feat(a1): local_fs 測試資料標記（後端 config 驅動，R8）"`

### Task B3: GovernanceOverlay 對齊權威 A1–A10（R9）

**Files:**
- Modify: `web-viewer-sample/src/console/GovernanceOverlay.tsx`（`MVP_ENGINES`/`ROADMAP_ENGINES` `:76-89`、標題 `:148-155`、roadmap 區 `:303-311`、stale 註解 `:155`）
- Test: 既有 overlay 測試檔（Grep `GovernanceOverlay` 找 `*.test.tsx`；無則新增 `GovernanceOverlay.test.tsx`）

**Interfaces:**
- Consumes: `data.ts` `A1A10`（權威清單，`:97-109`）與 `Prov` 型別
- Produces: overlay 面板不再出現與權威衝突的「A4/A8 asbuilt」

- [ ] **Step 1: 失敗測試**

```tsx
// web-viewer-sample/src/console/GovernanceOverlay.test.tsx（核心斷言）
import { render, screen } from "@testing-library/react";
import { GovernanceOverlay } from "./GovernanceOverlay";
import { A1A10 } from "./data";
it("overlay 條目不得與權威 A1A10 的 NOT BUILT 裁決衝突", () => {
  render(<GovernanceOverlay /* 依現有 props 最小化 */ />);
  // A4 語意搜尋、A8 Synthetic Data 在權威為 p3/p4 → overlay 不得以 asbuilt 呈現同編號
  expect(screen.queryByText(/A4.*完整性|A4.*治理分/)).toBeNull();
  expect(screen.queryByText(/A8.*Issue\/BCF/)).toBeNull();
});
```

- [ ] **Step 2**: Run → FAIL（現行 MVP_ENGINES 仍用 A4/A8 舊編號）。
- [ ] **Step 3: 重排實作**：
  - `MVP_ENGINES` 改為權威歸屬：`治理分/完整性` 條目歸 **A1**（caption「A1 rule-run 產物」，prov 維持 `asbuilt`）；`Issue/BCF` 條目歸 **A1 · Issue 共同出海口**（prov `asbuilt`）；`語意映射` 條目標「M4 GUID⇔prim 連動」不掛 App 編號。
  - `ROADMAP_ENGINES`：碰撞條目改標 `A3 · clash（spec：ifcclash 已選型未開工）` prov=`p1` disabled；A4（語意搜尋）/A8（Synthetic Data）依權威 `p4` disabled、標題與 `data.ts` `A1A10[].title` 一致（直接 import 引用，不再手抄字串）。
  - 面板標題 `:148-155`「A1–A10 治理 overlay」改「治理 overlay（依 A1–A10 權威狀態）」；`:155` stale 註解 `（design §5）` 改 `（權威：data.ts A1A10；README §4）`。
- [ ] **Step 4**: Run 測試 → PASS；`npm run typecheck` → PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(console): GovernanceOverlay 對齊權威 A1-A10，消除 A4/A8 asbuilt 撞名（R9）"`

### Task B4: NAV 分組對齊 A.1.1（R4）

**Files:**
- Modify: `web-viewer-sample/src/console/data.ts`（PAGES `group` 欄 `:51-79`）
- Test: `web-viewer-sample/src/console/console.test.tsx`（nav 分組斷言同步）

- [ ] **Step 1: 失敗測試**：console.test.tsx 加：

```tsx
it("NAV 分組對齊 A.1.1 群組欄", () => {
  const g = (k: string) => PAGES.find(p => p.key === k)?.group;
  ["viewer","gpu","a6","a7","a8","a9","a10"].forEach(k => expect(g(k)).toBe("core"));
  ["sessions","instances","minio"].forEach(k => expect(g(k)).toBe("omniverse"));
  expect(g("runtime")).toBe("coordinator"); // A.1.1 row20：落地端控制台 / SYSTEM，取前者
});
```

- [ ] **Step 2**: Run → FAIL。
- [ ] **Step 3**: data.ts 改 group：`viewer/gpu/a6..a10 → "core"`；`sessions/instances/minio → "omniverse"`;`runtime → "coordinator"`；檢查 `NAV_GROUPS`（`:41-47`）四組 label 不變、無空組（若 "coordinator" 組只剩 runtime 屬預期）。同步修既有受影響斷言。
- [ ] **Step 4**: Run `npx vitest run src/console/console.test.tsx` → PASS；`npm run typecheck` → PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(console): NAV 分組改依 A.1.1 群組欄（R4，路由表為準）"`

### Task B5: A6 phase 顯示矛盾修正

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`:2086` AppsPage、`:2122` AppVisionPage）
- Test: `console.test.tsx` 加一案例

- [ ] **Step 1: 失敗測試**：斷言 A6 卡片不出現裸字 `Phase 2`、而是 `規劃序 P2`（或含「願景」字樣的組合）。
- [ ] **Step 2**: 兩處 `Phase {a.phase}` 改為 helper：`const phaseLabel = (p: {phase:number; prov:Prov}) => (p.prov==="p3"||p.prov==="p4") ? `規劃序 P${p.phase}` : `Phase ${p.phase}`;`（放 pages.tsx 頂部 util 區，兩處共用）。
- [ ] **Step 3**: Run 測試＋typecheck → PASS。
- [ ] **Step 4: Commit** `git commit -m "fix(console): 願景 App 卡 phase 顯示與 ProvTag 消歧義（A6 矛盾）"`

### Task B6: governance db.py busy_timeout（F4）

**Files:**
- Modify: `governance-service/db.py`（`_conn` `:68-71`）
- Test: `governance-service/tests/test_db_concurrency.py`（新）

- [ ] **Step 1: 失敗測試**

```python
def test_conn_sets_busy_timeout(tmp_path):
    from db import Store
    s = Store(str(tmp_path / "g.db"))
    conn = s._conn()
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
```

- [ ] **Step 2**: Run `"C:\Program Files\Python312\python.exe" -m pytest tests/test_db_concurrency.py -v`（cwd=governance-service）→ FAIL（現值 0）。
- [ ] **Step 3**: `_conn` 加 `conn.execute("PRAGMA busy_timeout=5000")`（與 issues/store.py `:125` 相同值）。
- [ ] **Step 4**: Run → PASS；全套 `-m pytest tests/ -v` 綠。
- [ ] **Step 5: Commit** `git commit -m "fix(governance): db.py 連線加 busy_timeout=5000，對齊 IssueStore 並發紀律（F4）"`

### Task B7: useConversionData 防重入（F13）

**Files:**
- Modify: `web-viewer-sample/src/console/modelData/useConversionData.ts`（`load`/`loadRecords` `:63-64`）
- Test: 同目錄既有 hook 測試檔加案例（比照 `useConversionActions` 測試寫法）

- [ ] **Step 1: 失敗測試**：mock client 記呼叫數，同步連呼 `load()` 兩次，斷言底層 `listIfcReady` 只被呼叫 1 次。
- [ ] **Step 2**: Run → FAIL（2 次）。
- [ ] **Step 3**: 比照 `useConversionActions.ts:41-42` 加 `const loadBusyRef = useRef(false);`——進入時 `if (loadBusyRef.current) return; loadBusyRef.current = true;`，finally 釋放；`loadRecords` 同法。
- [ ] **Step 4**: Run → PASS；typecheck PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(console): useConversionData 同步防重入，比照 useConversionActions（F13）"`

### Task B8: operator 頁改走型別化 client（W4）

**Files:**
- Modify: `web-viewer-sample/src/clients/coordinatorClient.ts`（console 用的那份 `src/console/coordinatorClient.ts`——以 Grep 確認 KitConsolePage 實際 import 對象後補方法）：加 `kitHealth()`、`kitUsdcList()`、`devIfcSources()`（皆 `jsonGet`，路徑同現行 raw fetch）
- Modify: `web-viewer-sample/src/console/KitConsolePage.tsx`（`:19,24,29`）、`RealIfcConsolePage.tsx`（`:33,57,71,105`）改用 client 方法（`kitInstanceCurrent`/`streamConfig`/`getIfcReadyJob` 用既有的）
- Test: 兩頁既有測試（無則各加最小 render+stub 測試）斷言呼叫 client 而非 raw `fetch`

- [ ] **Step 1**: 失敗測試（spy `coordinatorClient.kitHealth`，render KitConsolePage 斷言被呼叫；raw fetch spy 斷言 0 次）。
- [ ] **Step 2**: Run → FAIL。
- [ ] **Step 3**: 補 client 方法＋兩頁替換（保持 UI/文案零變化；`COORD_BASE` 由 client 統一處理，dev :5173→:8004 修復）。
- [ ] **Step 4**: Run → PASS；typecheck PASS。
- [ ] **Step 5: Commit** `git commit -m "refactor(console): operator 頁改走 coordinatorClient，修 dev base-URL 隱患（W4）"`

### Task B9: routing.ts 認得 app/ 前綴

**Files:**
- Modify: `web-viewer-sample/src/console/routing.ts`（`:10-20`）
- Test: `web-viewer-sample/src/console/routing.test.ts`

- [ ] **Step 1: 失敗測試**：`expect(isOperatorConsolePath("/", "#app/ai-search")).toBe(true);`
- [ ] **Step 2**: Run → FAIL。
- [ ] **Step 3**: `SHORT_CONSOLE_HASH` 正則 alternation 加 `app\/[a-z0-9-]+`（維持既有 `^#\/?(...)$` 結構）。
- [ ] **Step 4**: Run routing.test → PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(console): routing 支援 app/ 前綴 deep-link（F8-route）"`

### Task B10: export_rule_run DB fallback（F3，凍結檔簽核修復）

**Files:**
- Modify: `governance-service/app.py`（`export_rule_run` `:389-395` 附近；**僅此函式**）
- Test: `governance-service/tests/test_export_fallback.py`（新）

- [ ] **Step 1: 失敗測試**：建一筆 run（直接用 Store 寫入完成態＋results），**不碰** `_RUN_CACHE`，呼叫 export endpoint（TestClient），斷言 200 且回 xlsx bytes（非 409）。
- [ ] **Step 2**: Run → FAIL（409 not available）。
- [ ] **Step 3**: `export_rule_run` cache miss 分支改：`run = _RUN_CACHE.get(run_id) or _rebuild_run_from_store(run_id)`；`_rebuild_run_from_store` 用 `store.get_run`＋`store.get_results` 組回 `RuleRunResult`，查無才 404（語意：409 分支移除）。
- [ ] **Step 4**: Run 新測試＋全套 governance pytest → PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(governance): rule-run 匯出 cache miss 改由 DB 重建（F3，exception 已登記）"`

### Task B11: Wave B E2E 證據＋開 PR-B

- [ ] **Step 1**: branch 隔離 stack（不碰 :8004）：`npm run build:ui`＋branch governance（`GOV_PORT=49103`）＋branch coordinator（`PORT=8005`、`CONSOLE_DIST_DIR`、`GOVERNANCE_API_BASE`）——照 memory「branch E2E 隔離 stack」配方。
- [ ] **Step 2**: headless Chrome/Playwright 對 `:8005/ui` 截圖：`#home`（NAV 新分組）、`#a1`（local_fs 測試資料 badge）、`#apps`（A6 卡新 phase 字樣）、viewer overlay 面板（權威對齊後）→ 存 `artifacts/e2e/2026-07-10-wave-b/*.png`，`git add -f`。
- [ ] **Step 3**: 全套驗證：console `npm run verify`（含新 typecheck）；governance host pytest 全綠；root contracts 85 綠；GitNexus `detect_changes` scope 檢查。
- [ ] **Step 4**: PR-B（title `fix: plans×code 修復輪 Wave B（合規 code 修）`；body-evidence Frontend Verification 七列逐字填＋截圖路徑）→ auto-merge。

---

## Wave C — 衛生＋golden path（PR-C；分支 `chore/remediation-wave-c`）

### Task C1: tracked 殘留移除

**Files:**
- Delete（git rm，逐檔先 `git log --oneline -3 -- <path>`＋全 repo Grep 引用確認）: `patches/README_DOCKER_FIRST_UPDATE.md`、`artifacts/git-cleanup-20260609-*`（實際檔名以 `ls artifacts/` 為準）、`artifacts/audit-wip-shelved-2026-06-09.patch`、`frontend-redesign-ia-and-phases.html`、`CODE_GOAL_DOCKER_KIT_MVP.md`、`README_APPLY.md`、`連線測試.md`
- Modify: 若 README/docs 索引引用被刪檔 → 同 commit 修引用

- [ ] **Step 1**: 逐檔確認無現行引用（`Grep -l "<檔名>"` 全 repo，命中僅歷史 artifacts 可忽略）。
- [ ] **Step 2**: `git rm` 上列檔案；`patches/` 空目錄一併消失。
- [ ] **Step 3**: root contracts 綠（確認無測試引用被刪檔）。
- [ ] **Step 4: Commit** `git commit -m "chore: 移除 tracked 歷史殘留（patches/git-cleanup/根層散落文件）"`

### Task C2: untracked 殘留清單化

- [ ] **Step 1**: 在主 checkout 產清單（唯讀）：`output/`、`logs/gitnexus-analyze-*.log`、`logs/mcp-runtime/`、`.tmp/pending-delete-20260710-094030`、`.tmp/m1-review`（先 `git worktree list` 確認 m1-review 是否仍註冊——是 worktree 就走 `git worktree remove`）、`bim-streaming-server/*.etl`、`g1-doctor.log`、`.aider.*`。
- [ ] **Step 2**: 清單寫入 `artifacts/2026-07-10-untracked-cleanup-list.md`（含每項大小與判定理由），commit 進 PR-C。
- [ ] **Step 3**: **執行刪除前用 AskUserQuestion 逐清單確認一次**（R5：清單化、確認後刪）；確認後在主 checkout 刪除，結果回寫該 artifacts 檔。

### Task C3: kit-manager-api 補 golden path

**Files:**
- Modify: `scripts/deploy.ps1`（Mode C host-native 階段加 kit-manager-api 啟動；埠 8010；比照 4a/4b/4c 既有 process 啟動樣式與 pidfile 慣例）
- Modify: `scripts/stop-all.ps1`（`$ExpectedServices` `:46-53` 加 `kit-manager-api`）
- Test: `scripts/tests/` 若 `fix/deploy-rebuild-worktree-e2e` 已 merge → 跑其 `test-rebuild-test-deploy.ps1` 回歸

- [ ] **Step 0（前置）**: `git log origin/main --oneline | grep -i "deploy-rebuild-worktree-e2e"` 確認該分支 merge 狀態；未 merge → 本 task 照做但 PR body 註明鄰接分支，merge 順序交 auto-merge 佇列。
- [ ] **Step 1**: deploy.ps1 讀現行 4a/4b/4c 區塊，複製其 Start-Process＋pidfile＋health-wait 樣式新增 4d kit-manager-api（`services/kit-manager-api`，uvicorn 啟動指令以該 sub-repo README/AGENTS 為準；health URL `http://127.0.0.1:8010/health`）。
- [ ] **Step 2**: stop-all.ps1 `$ExpectedServices` 加列。
- [ ] **Step 3: 驗證**：PowerShell 語法檢查 `pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw scripts/deploy.ps1)) | Out-Null"`；部署區實測留待使用者下次重建口令（PR body 誠實標「deploy 實跑未執行，語法與樣式對齊驗證」）——或使用者同意時跑 `.\scripts\dev\rebuild-test-deploy.ps1 -Build`（先清 port）。
- [ ] **Step 4: Commit** `git commit -m "feat(scripts): kit-manager-api 納入 deploy.ps1/stop-all.ps1 golden path"`

### Task C4: stage_composition 單一契約

**Files:**
- Modify: `docs/contracts/streaming-datachannel.md`（升為權威：欄位表 `primary/secondary[]/load_order`＋各語言鏡像位置清單）
- Test: `tests/test_stage_composition_contract.py`（root contracts，新）

- [ ] **Step 1: 失敗測試**（源碼掃描式契約測試，零 runtime 依賴）：

```python
import re, pathlib
FIELDS = {"primary", "secondary", "load_order"}
SOURCES = [
  "services/kit-manager-api/app/kit_service.py",
  "bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging/stage_loading.py",
  "web-viewer-sample/src/types/review.ts",
  "apps/kit-manager-web/src/models.ts",
]
def test_stage_composition_fields_present_everywhere():
    for p in SOURCES:
        text = pathlib.Path(p).read_text(encoding="utf-8")
        missing = {f for f in FIELDS if f not in text}
        assert not missing, f"{p} 缺 stage_composition 欄位 {missing}"
```

（路徑以 Grep `stage_composition` 實際命中檔修正後鎖定。）
- [ ] **Step 2**: Run root pytest 該檔 → 依現況 PASS/FAIL 修正 SOURCES 清單至 PASS。
- [ ] **Step 3**: docs/contracts/streaming-datachannel.md 加「單一真相」段：欄位語意表＋『四處鏡像以本檔為準、變更需四處同步＋本測試守門』。
- [ ] **Step 4: Commit** `git commit -m "test(contracts): stage_composition 四鏡像契約測試＋文件升權威（R5）"`
- [ ] **Step 5**: 開 PR-C → auto-merge。

---

## Wave D — 品質小修＋A2 實驗（PR-D；分支 `fix/remediation-wave-d`）

### Task D1: fetch 原語 timeout（F12）

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（`jsonGet/jsonPost/jsonPut/jsonPostWithHeaders` `:27-70` 區）
- Modify: `web-viewer-sample/src/console/governanceClient.ts`（`jsonFetch` `:110-132`）
- Test: 兩 client 測試檔各加 timeout 案例

- [ ] **Step 1: 失敗測試**：mock 一個永不 resolve 的 fetch，斷言 `jsonGet("/x", {timeoutMs: 50})` 在 ~50ms 內 reject（AbortError）。
- [ ] **Step 2**: Run → FAIL（永久 pending → 測試 timeout）。
- [ ] **Step 3**: 各動詞加 `signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)`；`DEFAULT_FETCH_TIMEOUT_MS = 15000`（module const）；SharedStatusProvider watchdog 保留為第二道保險（不動）。
- [ ] **Step 4**: Run 全 console 測試＋typecheck → PASS（長輪詢呼叫點若需更長 timeout，呼叫處顯式傳參）。
- [ ] **Step 5: Commit** `git commit -m "fix(console): fetch 原語內建 AbortSignal.timeout，wedged socket 不再永久卡 busy（F12）"`

### Task D2: config 預設機密 prod fail-fast（F2）

**Files:**
- Modify: `bim-review-coordinator/src/config.ts`（`:375-389` 附近）
- Test: `bim-review-coordinator/tests/config-secrets.test.ts`（新）

- [ ] **Step 1: 失敗測試**：`loadConfig({ NODE_ENV: "production" })` 應 throw（訊息列出未設的 secret env 名）；`NODE_ENV: "production"` 且三個 secret env 都給值 → 不 throw；未設 NODE_ENV（dev）→ 沿用預設不 throw。
- [ ] **Step 2**: Run → FAIL。
- [ ] **Step 3**: config.ts 加 production guard（沿既有 fail-fast 風格：集合檢查 `DEV_AUTH_TOKEN`/`INTERNAL_API_AUTH_TOKEN`/`EXTERNAL_INTAKE_WEBHOOK_SECRET` 是否落在已知預設值）。
- [ ] **Step 4**: Run coordinator 全套 vitest → PASS。
- [ ] **Step 5: Commit** `git commit -m "fix(coordinator): production 下預設機密 fail-fast（F2）"`

### Task D3: 跨服務 enum parity 測試（S3）

**Files:**
- Test: `tests/test_cross_service_enum_parity.py`（root contracts，新；源碼掃描式）

- [ ] **Step 1: 寫測試**：regex 抽三處值集——streaming `conversion_authority.py` `CONVERSION_STATUSES = (...)`、coordinator `src/services/conversionLedger.ts` lifecycle 陣列、前端 `src/console/coordinatorClient.ts` `CONVERSION_LIFECYCLE_STATUS_VALUES`；斷言：前端值集 == coordinator 值集；且兩者 ⊆ streaming 值集 ∪ {合法投影值}（以現況實際值鎖定：`detected/queued/converting/ready/failed`）。另抽 governance `diff_engine/models.py` `CHANGE_TYPES` 斷言前端 `governanceClient.ts` 若宣告 union 需相符（現況為裸 string → 測試僅鎖 Python 端 5 值不被縮減）。
- [ ] **Step 2**: Run root pytest → PASS（若 FAIL 即抓到真 drift，修文件不修值）。
- [ ] **Step 3: Commit** `git commit -m "test(contracts): 跨服務 conversion status / change_type parity 守門（S3）"`

### Task D4: externalIfcReadyStore 持久化（S2）

**Files:**
- Modify: `bim-review-coordinator/src/services/externalIfcReadyStore.ts`（`:13-17` 三個 Map）
- Modify: `bim-review-coordinator/src/config.ts`（`externalIfcReadyStorePath`，env `EXTERNAL_IFC_READY_STORE_PATH`，預設沿 conversionLedger 同目錄慣例）
- Test: `bim-review-coordinator/tests/external-ifc-ready-persistence.test.ts`（新）

- [ ] **Step 1: 失敗測試**：store A 建 job → new Store（同 path）→ 斷言 job 讀得回（id/status/tenant 完整）；壞 JSON 檔 → 不 crash、空启动。
- [ ] **Step 2**: Run → FAIL。
- [ ] **Step 3**: 比照 `conversionLedger.ts:82-91`：建構子 load、每 mutation 後 `persist()`（`.tmp` 寫入＋rename atomic swap、注入式 path 與時鐘）；**app.ts 呼叫點零變更**（持久化全在 store 內部）。
- [ ] **Step 4**: Run coordinator 全套 → PASS。
- [ ] **Step 5: Commit** `git commit -m "feat(coordinator): externalIfcReadyStore 落 JSON 持久化，修重啟 ledger↔job split-brain（S2）"`

### Task D5: 8011 listener 根因（F7）

**Files:**
- Modify: 轉檔用 `.kit` 設定檔（Grep `bim-streaming-server` 內 `8011`／`omni.services.transport.server.http` 定位實際檔案）
- Test: 轉檔回歸（實跑一次小檔轉檔）

- [ ] **Step 1**: 定位：`Grep -rn "8011" bim-streaming-server/ --include=*.kit --include=*.toml --include=*.py`；確認 headless `--exec` 轉檔啟動參數載入的 kit file。
- [ ] **Step 2**: 停用該 listener：`.kit` `[settings]` 加 `exts."omni.services.transport.server.http".port = 0`（或依 Kit MCP 查證的正確關閉鍵；先 `search_kit_settings` 驗證鍵名再寫）。粗鎖（`conversion_authority.py:243`）保留。
- [ ] **Step 3: 回歸**：對 local_fs 小 IFC 跑一次真轉檔（走 `POST /api/dev/conversions` 或既有 dev 流程），斷言 job 到 `ready` 且無 port-conflict 錯誤；同時啟兩個轉檔驗證不再搶 8011（可觀察 log 無 `8011` bind error）。
- [ ] **Step 4: Commit** `git commit -m "fix(streaming): 轉檔 Kit 停用未使用的 HTTP listener，根除 8011 併發 TOCTOU（F7）"`

### Task D6: A2 diff 驗證實驗＋回寫（R2 加購項）

**Files:**
- Create: `artifacts/2026-07-10-a2-diff-vs-ifcdiff-experiment.md`（實驗報告）
- Modify: `docs/plans/docs-plans-README.md` 鐵律 #9（補一句實測結論）

- [ ] **Step 1**: 材料（已驗真不同版本）：`C:\Repos\active\iot\AI-BIM-governance\storage\270\機電\ver 000001.ifc`（309M）vs `ver 000002.ifc`（317M）。主 checkout 絕對路徑（worktree 不帶 storage）。
- [ ] **Step 2**: host Python312 跑自製引擎：`run_diff_on_paths(a, b, include_geometry=False)`，記錄 counts＋`evidence.match` 分佈（guid/tag/type_name_loc 各多少）→ 直接回答「GUID churn 假設」（guid 命中率 <100% 即證實多級配對有真實價值）。時間預算：326M 檔 diff 預估 5–30 分鐘、記憶體高；先跑一次並記錄實際耗時，過重則在報告中誠實降級為「單 discipline 一對版本」。
- [ ] **Step 3**: 隔離 venv `pip install ifcdiff`，同一對檔跑官方 ifcdiff，記錄輸出 added/deleted/changed 計數與耗時。
- [ ] **Step 4**: 報告寫入 artifacts（兩引擎計數對照表＋match 分佈＋結論：自製引擎多抓回多少「GUID 換名但實為同構件」）；README 鐵律 #9 補一句 `（2026-07-10 實測：270 機電 v1→v2，match 分佈 guid X%/tag Y%/type_name_loc Z%，見 artifacts/2026-07-10-a2-diff-vs-ifcdiff-experiment.md）`。
- [ ] **Step 5: Commit** `git commit -m "docs(experiment): A2 自製引擎 vs ifcdiff 對照實驗與 GUID churn 實測（R2）"`
- [ ] **Step 6**: 開 PR-D → auto-merge；四 wave 全 merge 後：`git fetch --prune`、worktree closeout、向使用者總結（changed files／驗證清單／未跑項／殘餘風險）。
