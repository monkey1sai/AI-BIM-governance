# A1 治理檢核 + 3D 高亮（MinIO 來源 · 排隊轉檔）Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

> 來源 spec：`docs/superpowers/specs/2026-06-24-a1-governance-3d-minio-redesign-design.md`
> 範圍：B2（純前端，`web-viewer-sample`）。B1 後端地基（`POST /api/conversion/trigger` + `conversion_lifecycle_status` + presigned 遮蔽）已於 **PR #259（mergeCommit `b660b1f`，已是本 branch 祖先）merge 進 main**，本 plan 不含任何後端變更。

## Goal

把 A1 頁面收斂為「只做治理檢核 + 3D 高亮」：模型改由 MinIO 下拉選取、操作員手動把 IFC 排入 IFC→USD 轉檔排程、治理檢核改走 `for-session/:sessionId`、移除頁面底部 demo-control 內嵌大表。

## Architecture

A1（`web-viewer-sample/src/console/pages.tsx` 的 `A1GovernanceWorkbenchPage`）是一支整頁狀態機（`a1Machine.ts`）驅動的 React 頁，瀏覽器只打 coordinator `:8004` 的 coordinator-owned / governance-proxy 端點（不直連 :49100/:49101/:49102）。本次改動全部 additive/替換：step① 文字框換成讀 `GET /api/minio/objects` 的 `<select>`；無 session 時把靜態提示換成「排入轉檔」按鈕（`POST /api/conversion/trigger {key}` → 輪詢 `GET /api/external/ifc-ready/:jobId` 讀 `conversion_lifecycle_status`）；step② 規則檢核改打既有 `createRuleRunForSession`；移除 `<RealIfcConsolePage/>` 內嵌（該元件仍掛在 `#/demo-control`）。`a1Machine.ts` 與所有後端契約皆不動。

## Tech Stack

- 前端：React 18 + TypeScript（`web-viewer-sample`）；狀態機純函式（`a1Machine.ts`）。
- 元件測試：vitest（`vi.spyOn` mock `fetch` / `coordinatorClient`；`createRoot` + `act` 客戶端渲染；`vi.mock("./EmbeddedViewer")` forwardRef stub）。SSR smoke 用 `renderToString`。
- 瀏覽器 E2E：Playwright（`web-viewer-sample/e2e/`）。
- 既有 client：`coordinatorClient`（coordinator REST）、`governanceClient`（governance proxy）。

## 驗證指令（所有指令的工作目錄 = `web-viewer-sample/`）

- 型別檢查（**必跑**，`vite build` 不跑 tsc）：`npx tsc --noEmit`
- Lint：`npm run lint`
- 單元測試（單檔）：`npx vitest run src/console/<file>`
- 單元測試（全部）：`npm test`
- 建 `/ui` console bundle（E2E 前）：`npm run build:ui`
- E2E：`npx playwright test e2e/<spec>`

> **⚠ lint / tsc baseline 與測試 mock 修正（2026-06-30 指揮官，解除 P3 `plan_error_at_task` @task#1；證據：f246401 受改 3 檔 79 測試全綠、零新增 lint/tsc error）**
>
> **(A) lint / tsc 採 baseline-aware，非絕對 exit 0**：`web-viewer-sample` 全專案 `npm run lint` 有 **44 個既有 errors + 4 warnings**（全落在本 plan 未碰檔：`App.tsx`/`AppStream.tsx`/`Forms.tsx`/`OperatorConsole.tsx` 等）、`npx tsc --noEmit` 有 **7 個既有 errors**（`indexHtml.test.ts`/`IntentDialog.css.test.ts` 缺 `@types/node` 共 6 個 + `console.test.tsx` 的 governanceClient `ifc_type:null` typing 1 個）。這些是 origin/main 既有 baseline（見 `docs/agents/sub-repo-verify-commands.md`），**非本 plan 引入**。各 task 驗收凡寫「`npm run lint` / `tsc --noEmit` exit 0」**一律解讀為 baseline-aware**：**受改檔本身 lint/tsc 乾淨 + 全專案 error 數零新增（≤ baseline）即過**；**禁止**為達絕對 exit 0 去修 44/7 個無關既有 error（CLAUDE.md：不動無關檔案、YAGNI）。
>
> **(B) A1ViewerEmbed.test.tsx 的 `beforeEach` 預設 `getMinioObjects` mock 必須含「至少一個 `source_ifc` 物件」**（非空 `objects: []`）：否則下拉只有 placeholder、`selectedKey` 恆 `""`、`a1-step-pick` 恆 disabled，Task 3/4 的 pick→run 測試（`selectMinioModel()` helper 依賴可選 option）會因 click 變 no-op 而失敗。f246401 已如此實作（單一預設 source_ifc + `selectMinioModel` helper，正是本 plan 對 `console.test.tsx` doRun 開的同一處方）；後續 task **沿用、勿回退成空 `objects: []`**。

## 共用前置（每個改 `A1GovernanceWorkbenchPage` 的 task 開工前）

- [ ] 依 CLAUDE.md §4 對唯一受改既有 symbol 跑一次 impact，確認 blast radius：
  ```
  mcp__gitnexus__impact  name="A1GovernanceWorkbenchPage"  repo="AI-BIM-governance"
  ```
  預期：upstream 只有 `EdgeConsole`/`OperatorConsole` 的路由 switch（`#/a1`），無其他 production caller。若回 HIGH/CRITICAL 先停下回報。
- [ ] 建立 baseline（改任何碼前先綠）：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts src/console/console.test.tsx src/console/A1ViewerEmbed.test.tsx
  ```
  預期輸出：三檔全 `passed`（記下通過數當對照；改完用同一條比較）。

---

## Task 1: coordinatorClient 新增 triggerConversion + getIfcReadyJob + lifecycle 型別

新增前端 client 方法，對接 B1 已落地的 `POST /api/conversion/trigger` 與 `GET /api/external/ifc-ready/:jobId`（讀 `conversion_lifecycle_status`）。純 additive，不改既有方法。

**Files**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`
- Test: `web-viewer-sample/src/console/coordinatorClient.test.ts`

**Steps**

- [ ] 在 `coordinatorClient.test.ts` 既有 `describe("coordinatorClient conversion control", ...)` 區塊內（`afterEach(vi.restoreAllMocks)` 之後）貼三個失敗測試：
  ```ts
  it("triggerConversion 打 POST /api/conversion/trigger 帶 key，202 回 ifc_ready_job_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_mw_abc", status: "queued_for_conversion", trigger_source: "manual" }), { status: 202 }),
    );
    const r = await coordinatorClient.triggerConversion("專案A/root/main/uuid/model.ifc");
    expect(r.ifc_ready_job_id).toBe("ifcready_mw_abc");
    const call = spy.mock.calls[0];
    expect(String(call[0])).toContain("/api/conversion/trigger");
    expect((call[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ key: "專案A/root/main/uuid/model.ifc" });
  });

  it("triggerConversion 503（MinIO 未設定）throw 帶後端 detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "MinIO 未設定（endpoint/bucket/credentials 不齊全）" }), { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(coordinatorClient.triggerConversion("k")).rejects.toThrow(/MinIO 未設定/);
  });

  it("getIfcReadyJob 打 GET /api/external/ifc-ready/:jobId，回 conversion_lifecycle_status", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ifc_ready_job_id: "ifcready_mw_abc", status: "queued_for_conversion", conversion_lifecycle_status: "queued", download_status: "downloaded", conversion_status: null, review_session_id: null }), { status: 200 }),
    );
    const r = await coordinatorClient.getIfcReadyJob("ifcready_mw_abc");
    expect(r.conversion_lifecycle_status).toBe("queued");
    expect(String(spy.mock.calls[0][0])).toContain("/api/external/ifc-ready/ifcready_mw_abc");
  });
  ```
- [ ] 跑測試確認三條失敗（方法尚未存在）：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts
  ```
  預期：3 failed（`coordinatorClient.triggerConversion is not a function` / `...getIfcReadyJob is not a function`）。
- [ ] 在 `coordinatorClient.ts` 既有 `IfcReadyListItem` interface 之後（約檔案第 176 行後）新增型別：
  ```ts
  // B1（PR #259）落地的單一權威轉檔生命週期狀態（services/lifecycleStatus.ts deriveLifecycleStatus）。
  export type ConversionLifecycleStatus = "detected" | "queued" | "converting" | "ready" | "failed";

  // A1（B2）排隊轉檔回應：POST /api/conversion/trigger。成功 202 帶 ifc_ready_job_id；
  // MinIO 未設定 503 由 jsonPost throw（帶後端 detail），不會走到這裡。
  export interface TriggerConversionResponse {
    ifc_ready_job_id?: string;
    status?: string;
    trigger_source?: string;
    detail?: string;
  }

  // A1（B2）轉檔狀態輪詢：GET /api/external/ifc-ready/:jobId（summarizeIfcReadyJob 子集）。
  // 主讀 conversion_lifecycle_status；該欄缺失時誠實降級用 conversion_status / download_status。
  export interface IfcReadyJobDetail {
    ifc_ready_job_id: string;
    status: string;
    conversion_lifecycle_status: ConversionLifecycleStatus | null;
    download_status: string | null;
    conversion_status: string | null;
    review_session_id: string | null;
  }
  ```
- [ ] 在 `coordinatorClient` 物件內、`getMinioObjects` 那筆之後（約檔案第 302 行）新增兩個方法：
  ```ts
    // A1（B2）：操作員手動把 MinIO 物件排入 IFC→USD 轉檔（POST /api/conversion/trigger {key}）。
    // 前端只送 key；presign 與 webhook secret 一律 coordinator server-side（誠實／簽章不出瀏覽器）。
    triggerConversion: (key: string) =>
      jsonPost<TriggerConversionResponse>("/api/conversion/trigger", { key }),
    // A1（B2）：單一 ifc-ready job 輪詢（讀 conversion_lifecycle_status）。
    getIfcReadyJob: (jobId: string) =>
      jsonGet<IfcReadyJobDetail>(`/api/external/ifc-ready/${encodeURIComponent(jobId)}`),
  ```
- [ ] 跑測試確認三條通過，並跑型別檢查：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/coordinatorClient.test.ts && npx tsc --noEmit
  ```
  預期：3 passed；`tsc --noEmit` 無輸出（exit 0）。
- [ ] commit：
  ```bash
  git add web-viewer-sample/src/console/coordinatorClient.ts web-viewer-sample/src/console/coordinatorClient.test.ts
  git commit -m "feat(console): A1 client 新增 triggerConversion + getIfcReadyJob（B2 task1）"
  ```

---

## Task 2: A1 step① 改 MinIO source_ifc 下拉（取代手打路徑文字框）

把 `a1-step-path` 文字框換成讀 `GET /api/minio/objects`、過濾 `role==="source_ifc"` 的 `<select>`，每項顯示 `project_display_name · category · version · 檔名`，並把選定 key 存進 `selectedKey`（供 step② PICK + Task 3 排隊鈕共用）。保留選填 IDS 路徑欄不動。

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage`）
- Test: `web-viewer-sample/src/console/console.test.tsx`、`web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Steps**

- [ ] 先讓既有測試對「下拉」hermetic：在 `A1ViewerEmbed.test.tsx` 的 `beforeEach`（`box.current = null;` 那行之後）加一行預設 mock，避免 A1 mount 時 `getMinioObjects` 打真網路：
  ```ts
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: null, count: 0, objects: [] });
  ```
- [ ] 在 `console.test.tsx` 既有 `describe("MinioData + A1 檔案庫選擇器 client-render ...")` 區塊**之後**新增一支失敗測試（沿用該檔頂部已 import 的 `createRoot` / `act` / `coordinatorClient` / `A1GovernanceWorkbenchPage`）：
  ```ts
  describe("A1 step① MinIO 下拉（B2）", () => {
    it("getMinioObjects 回 source_ifc + parsed_usdc → A1 只列 source_ifc，文字框 a1-step-path 不再渲染", async () => {
      vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("offline"));
      vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
        bucket: "bim-control", count: 2,
        objects: [
          { key: "松風庵/root/main/uuid1/model.ifc", etag: "e1", role: "source_ifc", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" },
          { key: "松風庵/root/main/uuid1/model.usdc", etag: "e2", role: "parsed_usdc", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" },
        ],
      });
      const container = document.createElement("div");
      document.body.appendChild(container);
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
      const root = createRoot(container);
      await act(async () => { root.render(<A1GovernanceWorkbenchPage />); });
      for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
      const select = container.querySelector('[data-testid="a1-minio-select"]') as HTMLSelectElement | null;
      expect(select).not.toBeNull();
      // 只列 source_ifc（1 個真選項 + 1 個 placeholder option）。
      expect(select!.querySelectorAll("option").length).toBe(2);
      expect(select!.textContent).toContain("松風庵");
      expect(select!.textContent).toContain("建築");
      expect(select!.textContent).not.toContain("model.usdc"); // parsed_usdc 不入下拉
      // 文字框 a1-step-path 已被下拉取代。
      expect(container.querySelector('[data-testid="a1-step-path"]')).toBeNull();
      await act(async () => { root.unmount(); });
      document.body.removeChild(container);
    });
  });
  ```
- [ ] 跑測試確認失敗：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "A1 step① MinIO 下拉"
  ```
  預期：1 failed（`a1-minio-select` 為 null）。
- [ ] 在 `pages.tsx` 的 `A1GovernanceWorkbenchPage` 內，於 `const [idsPath, setIdsPath] = useState(defaultA1IdsPath);`（約第 285 行）之後新增 MinIO 下拉狀態（同時刪掉第 284 行 `const [pathInput, setPathInput] = useState(defaultA1IfcPath);`，該 state 只服務即將移除的文字框）：
  ```ts
  const [minioObjects, setMinioObjects] = useState<import("./coordinatorClient").MinioObject[] | null>(null);
  const [minioErr, setMinioErr] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  ```
- [ ] 在既有 mount 時的 `runtimeStatus()` effect（約第 318 行 `useEffect(() => { let alive = true; ...`）**之後**新增 MinIO 物件清單 effect：
  ```ts
  // A1（B2）step①：列 MinIO source_ifc 物件供下拉選模型。誠實：失敗顯錯、空就空，不偽造。
  useEffect(() => {
    let alive = true;
    coordinatorClient.getMinioObjects()
      .then((res) => { if (alive) { setMinioObjects(res.objects.filter((o) => o.role === "source_ifc")); setMinioErr(null); } })
      .catch((e) => { if (alive) { setMinioObjects([]); setMinioErr(String(e)); } });
    return () => { alive = false; };
  }, []);
  ```
- [ ] 在 `A1GovernanceWorkbenchPage` 內、`return (` 之前新增下拉選項 label helper：
  ```ts
  const minioLabel = (o: import("./coordinatorClient").MinioObject) =>
    `${o.project_display_name ?? o.project_id ?? "?"} · ${o.category ?? "?"} · ${o.version ?? "?"} · ${o.key.split("/").pop() ?? o.key}`;
  ```
- [ ] 把 step① 文字框那段（現第 450-454 行，`<div ...><input ... data-testid="a1-step-path" .../><Btn data-testid="a1-step-pick" ...>選取模型</Btn></div>`）整段替換成下拉 + 鎖定鈕：
  ```tsx
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select data-testid="a1-minio-select" className="ec-btn" style={{ minWidth: 420 }}
            value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
            <option value="">{minioErr ? t("（MinIO 物件不可用）", "(MinIO objects unavailable)") : minioObjects === null ? t("載入中…", "Loading…") : minioObjects.length === 0 ? t("（無 source_ifc 物件）", "(no source_ifc objects)") : t("— 選擇 MinIO 模型 —", "— select a MinIO model —")}</option>
            {(minioObjects ?? []).map((o) => <option key={o.key} value={o.key}>{minioLabel(o)}</option>)}
          </select>
          <Btn data-testid="a1-step-pick" disabled={!selectedKey}
            caption={t("鎖定此模型（進入步驟2；同時作為排入轉檔的 key）", "Lock this model (proceed to step 2; also the key to queue conversion)")}
            onClick={() => dispatch({ type: "PICK_FILE", ifcPath: selectedKey })}>{t("選取模型", "Select Model")}</Btn>
        </div>
        {minioErr && <p className="ec-warn-note" data-testid="a1-minio-error" style={{ marginTop: 4 }}>{t("MinIO 物件清單不可用：", "MinIO object list unavailable: ")}{minioErr}</p>}
  ```
- [ ] **遷移既有 doRun 測試以對齊「`a1-step-pick` 現 `disabled={!selectedKey}`」**：`console.test.tsx` 既有 `describe("A1GovernanceWorkbenchPage client-render（doRun 輪詢守門 + 動作失敗 UI 回饋）")` 區塊有 11 支測試靠點 `a1-step-pick` 推進 step。本步把 step① 文字框換成下拉後，A1 mount 會打 `getMinioObjects()`（該 describe 的 `beforeEach` 未 mock → jsdom 真 fetch 失敗、`.catch()` 設空清單）且下拉預設 placeholder `value=""` → `selectedKey` 恆 `''` → `a1-step-pick` disabled → `clickByTestId("a1-step-pick")` 點到 disabled 鈕為 no-op → doRun 不啟動 → `expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(1)`（現第 1749 行）等斷言全 fail。修法（此步只解 selectedKey gating，屬 Task 2 範圍）：
  - 在該 describe 的 `beforeEach`（現第 1693 行 `runtimeStatus` mock 之後）補一筆 `getMinioObjects` mock，回**單一 source_ifc 物件**（option 必須真的渲染，下一步 `sel.value=` 才選得到）：
    ```ts
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{ key: "松風庵/root/main/u1/model.ifc", etag: "e", role: "source_ifc", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    ```
  - 在該 describe 的 `clickByTestId` helper 之後新增 `pickModel` helper（選下拉設 `selectedKey` → 再點 pick；若 option 尚未渲染，先補一拍 `await act(async () => { await vi.advanceTimersByTimeAsync(0); })`）：
    ```ts
    const pickModel = async (key = "松風庵/root/main/u1/model.ifc") => {
      const sel = container.querySelector<HTMLSelectElement>('[data-testid="a1-minio-select"]')!;
      await act(async () => { sel.value = key; sel.dispatchEvent(new Event("change", { bubbles: true })); });
      await clickByTestId("a1-step-pick");
    };
    ```
  - 把這 11 支測試各自的「**第一個**」`await clickByTestId("a1-step-pick")` 換成 `await pickModel();`（現第 1744 / 1769 / 1797 / 1833 / 1872 / 1925 / 1954 / 1997 / 2051 / 2112 / 2151 行）。`[finding#1] step 守門`（現第 1776 行）與 `[qr-t2-pollgen-race]`（現第 1931 行）的「**重置用第二次**」pick re-click 維持 `clickByTestId("a1-step-pick")` 不動（`selectedKey` 已設、pick 已 enable）。
  > 此步刻意只動 selectedKey gating：doRun 在 Task 2 仍打 `createRuleRun`、尚無 session gating，故這 11 支在 Task 2 結束時即可回綠。`createRuleRunForSession` 改名與 session 注入留待 **Task 4**（doRun 改 for-session 時）一併處理，避免在 Task 2 提前改動造成 RED 不可解。
- [ ] 跑 lint 確認沒有殘留未用變數（`pathInput`/`setPathInput` 已移除；`defaultA1IfcPath` 仍被 `MinioDataPage`/A2 用，不可刪 import）：
  ```bash
  cd web-viewer-sample && npm run lint
  ```
  預期：exit 0（`--max-warnings 0`，任何未用變數會 fail）。
- [ ] 跑新測試 + A1ViewerEmbed 全測 + 型別檢查確認綠：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx src/console/A1ViewerEmbed.test.tsx && npx tsc --noEmit
  ```
  預期：全 passed；tsc exit 0。
- [ ] commit：
  ```bash
  git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx web-viewer-sample/src/console/A1ViewerEmbed.test.tsx
  git commit -m "feat(console): A1 step① 改 MinIO source_ifc 下拉（B2 task2）"
  ```

---

## Task 3: A1 無 session 時新增「排入 IFC→USD 轉檔排程」按鈕 + 誠實 lifecycle 狀態行 + #conv 連結

把 3D 區無 session 分支的「需先派發 review session」靜態字，換成排隊轉檔按鈕（`triggerConversion(selectedKey)` → 輪詢 `getIfcReadyJob` → 原樣顯示 `conversion_lifecycle_status`）+ `#conv` 連結。誠實鐵律：狀態行原樣顯示 detected/queued/converting/ready/failed，轉檔未完成（lifecycle 非 ready）不顯示假成功；轉檔 `ready` 才重抓 `runtimeStatus` 撈 auto-session。**保留 `data-testid="a1-no-session"` 外層 wrapper**（`A1ViewerEmbed.test.tsx` 結構斷言依賴它）。

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage`）
- Test: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Steps**

- [ ] 在 `A1ViewerEmbed.test.tsx` 的「無 active session」測試之後新增一支失敗測試，驗排隊鈕 + 誠實狀態行：
  ```ts
  it("無 session：排入轉檔鈕 觸發 triggerConversion，狀態行原樣顯示 lifecycle（queued，不顯示假 ready）", async () => {
    const empty = fakeRuntimeStatus(VIEWER_ORIGIN);
    empty.sessions = { count: 0, active_count: 0, participant_count: 0, items: [] };
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(empty as never);
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control", count: 1,
      objects: [{ key: "松風庵/root/main/u1/model.ifc", etag: "e", role: "source_ifc", project_id: "p1", project_display_name: "松風庵", category: "建築", version: "v1" }],
    });
    const trigger = vi.spyOn(coordinatorClient, "triggerConversion").mockResolvedValue({ ifc_ready_job_id: "ifcready_mw_x", status: "queued_for_conversion", trigger_source: "manual" });
    vi.spyOn(coordinatorClient, "getIfcReadyJob").mockResolvedValue({ ifc_ready_job_id: "ifcready_mw_x", status: "queued_for_conversion", conversion_lifecycle_status: "queued", download_status: "downloaded", conversion_status: null, review_session_id: null });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();
    const sel = q("a1-minio-select") as HTMLSelectElement;
    await act(async () => { sel.value = "松風庵/root/main/u1/model.ifc"; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    const btn = q("a1-trigger-convert") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    await act(async () => { btn.click(); });
    await flush();
    expect(trigger).toHaveBeenCalledWith("松風庵/root/main/u1/model.ifc");
    const status = q("a1-convert-status");
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("queued");
    expect(status!.textContent).not.toContain("ready");
    expect(q("a1-conv-link")).not.toBeNull();
  });
  ```
- [ ] 跑確認失敗：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx -t "排入轉檔鈕"
  ```
  預期：1 failed（`a1-trigger-convert` 為 null）。
- [ ] 在 `A1GovernanceWorkbenchPage` 的 state 宣告區（Task 2 新增的 `selectedKey` 之後）新增排隊狀態與輪詢 ref：
  ```ts
  const [convJobId, setConvJobId] = useState<string | null>(null);
  const [convStatus, setConvStatus] = useState<string | null>(null); // 原樣顯示 lifecycle / fallback；誠實不偽造 ready
  const [convErr, setConvErr] = useState<string | null>(null);
  const [convBusy, setConvBusy] = useState(false);
  const convPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (convPollRef.current) clearInterval(convPollRef.current); }, []);
  ```
- [ ] 在 `doExport` useCallback 之後新增排隊 handler（立即輪詢一次讓 UI/測試不必等 interval；非終態才掛 2s interval）：
  ```ts
  const queueConversion = useCallback(async () => {
    if (!selectedKey || convBusy) return;
    setConvErr(null);
    setConvBusy(true);
    setConvStatus(t("觸發中…", "triggering…"));
    const pollOnce = async (jobId: string): Promise<string | null> => {
      const job = await coordinatorClient.getIfcReadyJob(jobId);
      // 主讀 conversion_lifecycle_status；缺失才誠實降級到 conversion_status / download_status / status。
      const lifecycle = job.conversion_lifecycle_status ?? job.conversion_status ?? job.download_status ?? job.status;
      setConvStatus(lifecycle);
      if (job.conversion_lifecycle_status === "ready") {
        // 轉好 → coordinator 已自動建立 review session；重抓 runtime/status 讓 A1 撈到該 session（for-session 檢核）。
        const rt = await coordinatorClient.runtimeStatus();
        const act2 = rt.sessions.items.filter((s) => s.status === "active" || s.status === "created");
        setSessions(act2);
        if (act2[0]) setSelectedSession(act2[0].session_id);
      }
      return job.conversion_lifecycle_status;
    };
    try {
      const res = await coordinatorClient.triggerConversion(selectedKey);
      const jobId = res.ifc_ready_job_id ?? null;
      setConvJobId(jobId);
      if (!jobId) { setConvErr(t("trigger 未回 job id", "trigger returned no job id")); setConvStatus(null); return; } // 註：TriggerConversionResponse 已無 detail 欄（task#0 收緊型別），失敗 detail 由 jsonPost throw 經 catch 顯示
      const first = await pollOnce(jobId);
      if (convPollRef.current) { clearInterval(convPollRef.current); convPollRef.current = null; }
      if (first !== "ready" && first !== "failed") {
        convPollRef.current = setInterval(() => {
          void pollOnce(jobId)
            .then((s) => { if ((s === "ready" || s === "failed") && convPollRef.current) { clearInterval(convPollRef.current); convPollRef.current = null; } })
            .catch((e) => { if (convPollRef.current) { clearInterval(convPollRef.current); convPollRef.current = null; } setConvErr(String(e)); });
        }, 2000);
      }
    } catch (e) {
      setConvErr(String(e)); // 503 MinIO 未設定 / 400 key 不合法 → 誠實顯示，按鈕可重試
      setConvStatus(null);
    } finally {
      setConvBusy(false);
    }
  }, [selectedKey, convBusy]);
  ```
- [ ] 把 3D 區無 session 分支（現第 511-512 行）那段單一 `<p data-testid="a1-no-session">需先派發 review session…</p>`（位於三元 `sessions.length === 0 ? ( … ) : (` 的問號分支）替換成保留 `a1-no-session` wrapper 的排隊 UI。只替換問號分支那一段；冒號分支之後既有的 session 下拉 + EmbeddedViewer 區塊原樣保留：
  ```tsx
        {sessions.length === 0 ? (
          <div data-testid="a1-no-session">
            <p className="ec-note">{t("無 active session。選定上方 MinIO 模型後，按下方按鈕手動排入 IFC→USD 轉檔；轉檔完成會自動建立 review session，本頁即可進行治理檢核與 3D 高亮。", "No active session. After selecting a MinIO model above, click below to manually queue IFC to USD conversion; when conversion completes a review session is created automatically, and this page can then run governance validation and 3D highlighting.")}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn primary data-testid="a1-trigger-convert" disabled={!selectedKey || convBusy}
                caption={selectedKey ? "POST /api/conversion/trigger {key}" : t("先選 MinIO 模型", "select a MinIO model first")}
                onClick={() => { void queueConversion(); }}>
                {convBusy ? t("排入中…", "queuing…") : t("排入 IFC→USD 轉檔排程", "Queue IFC to USD Conversion")}
              </Btn>
              {convJobId && <span className="ec-s" data-testid="a1-convert-job">job: {convJobId}</span>}
              <a className="ec-s" data-testid="a1-conv-link" href="#/conv">{t("到 IFC→USD 轉檔排程查看詳情 →", "View details in the conversion schedule →")}</a>
            </div>
            {convStatus !== null && <p className="ec-note" data-testid="a1-convert-status">{t("轉檔狀態：", "conversion status: ")}{convStatus}</p>}
            {convErr && <p className="ec-warn-note" data-testid="a1-convert-error">{convErr}</p>}
          </div>
        ) : (
  ```
- [ ] 跑測試 + 型別檢查確認綠：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx && npx tsc --noEmit
  ```
  預期：全 passed（含舊「無 active session」結構斷言仍綠，因 `a1-no-session` wrapper 保留）；tsc exit 0。
- [ ] commit：
  ```bash
  git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/A1ViewerEmbed.test.tsx
  git commit -m "feat(console): A1 無 session 排入轉檔鈕 + 誠實 lifecycle 狀態行（B2 task3）"
  ```

---

## Task 4: A1 step② 治理檢核改走 for-session + run 鈕以 session 為前提

把 `doRun` 從 `createRuleRun({ ifc_source_path })` 改成既有 `createRuleRunForSession(selectedSession, { ids_path })`（server-side 從 session 反解 IFC 路徑，瀏覽器不需知道伺服器路徑）。run 鈕加 `!selectedSession` 誠實 disabled。為讓「對既有 session 直接檢核」也能用（不必先選 MinIO 模型），新增 auto-PICK-on-session effect 推進五步條；`a1Machine.ts` 保持純函式不動。

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage`）
- Test: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Steps**

- [ ] 在 `A1ViewerEmbed.test.tsx` 新增兩支失敗測試（有 session 時 run 走 for-session 並 enable；無 session 時 run disabled + 誠實 caption）：
  ```ts
  it("有 session：run 鈕 enable 且 doRun 打 createRuleRunForSession（非 ifc_source_path 直接路徑）", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
    const forSession = vi.spyOn(governanceClient, "createRuleRunForSession").mockResolvedValue({ rule_run_id: "rr_1", status: "queued" });
    vi.spyOn(governanceClient, "getRuleRun").mockResolvedValue({ rule_run_id: "rr_1", status: "succeeded", summary: { total: 0, passed: 0, failed: 0, unique_elements: 0 }, score: 100 } as never);
    vi.spyOn(governanceClient, "getResults").mockResolvedValue([]);
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush(); // runtimeStatus → session 自動選 → auto-PICK 推進 step
    const run = q("a1-step-run") as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    await act(async () => { run.click(); });
    await flush();
    expect(forSession).toHaveBeenCalledWith("review_session_x", { ids_path: expect.any(String) });
  });

  it("無 session：run 鈕 disabled + caption 指向 for-session 前提", async () => {
    const empty = fakeRuntimeStatus(VIEWER_ORIGIN);
    empty.sessions = { count: 0, active_count: 0, participant_count: 0, items: [] };
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(empty as never);
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({ bucket: null, count: 0, objects: [] });
    root = createRoot(container);
    await act(async () => { root!.render(<A1GovernanceWorkbenchPage />); });
    await flush();
    const run = q("a1-step-run") as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(run.getAttribute("title") ?? run.textContent).toContain("review session");
  });
  ```
  > 註：`a1-step-run` 的誠實原因走 `Btn` 的 `caption`（既有實作把 caption 放進 `title`）。若該元件以別屬性呈現 caption，依 `components.tsx` 的 `Btn` 實作對齊斷言屬性。
- [ ] 跑確認失敗：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx -t "for-session"
  ```
  預期：2 failed（仍打舊 `createRuleRun` / run 鈕未以 session gating）。
- [ ] 在 `A1GovernanceWorkbenchPage` 內、Task 3 的排隊 effect 附近新增 auto-PICK-on-session effect：
  ```ts
  // for-session 模式：治理檢核只需 session。選定 session 後若狀態機仍在 idle（操作員直接對既有 session 檢核，
  // 未經 MinIO 選模型），以 sessionId 當 PICK marker 推進五步條（ifcPath 僅作 gating/顯示，for-session 不送伺服器）。
  useEffect(() => {
    if (selectedSession && state.step === "idle") dispatch({ type: "PICK_FILE", ifcPath: selectedSession });
  }, [selectedSession, state.step]);
  ```
- [ ] 改 `doRun`：把守門（現第 334 行 `if (!state.ifcPath) return;`）改成同時要求 session，並把 createRuleRun 那行（現第 342 行）換成 for-session：
  ```ts
    if (!state.ifcPath || !selectedSession) return;
  ```
  ```ts
      const { rule_run_id } = await governanceClient.createRuleRunForSession(selectedSession, { ids_path: idsPath || undefined });
  ```
  > `doRun` useCallback 的 deps 已含 `selectedSession`、`idsPath`，無需改 deps。`state.ifcPath` 保留於守門（PICK marker），不再作為 `ifc_source_path` 送出。
- [ ] 改 run 鈕 gating（現第 477-478 行）加 `!selectedSession` 並更新 caption：
  ```tsx
          <Btn primary data-testid="a1-step-run" disabled={state.step === "idle" || (state.step === "running" && !state.runError) || !selectedSession}
            caption={!selectedSession ? t("需先完成轉檔產生 review session（治理檢核走 for-session）", "Conversion must finish to create a review session first (governance runs via for-session)") : "POST /api/governance/rule-runs/for-session/:sessionId"} onClick={doRun}>
  ```
- [ ] **遷移既有 doRun 測試以對齊「for-session doRun（需 selectedSession）+ 改打 createRuleRunForSession」**：本 task 後 doRun `if (!state.ifcPath || !selectedSession) return;` 且改打 `createRuleRunForSession`。既有測試仍 mock `createRuleRun`、且 `console.test.tsx` 那批 mock 空 runtime（無 session）→ doRun 不是 early-return 就是打到未 mock 的真 `createRuleRunForSession`（jsdom fetch reject）→ 斷言全 fail。逐項修：
  - `A1ViewerEmbed.test.tsx` 三支（現第 201 / 234 / 320 行）：把 `vi.spyOn(governanceClient, "createRuleRun").mockResolvedValue({ rule_run_id: "rr_x", status: "queued" })` 改成 `vi.spyOn(governanceClient, "createRuleRunForSession").mockResolvedValue({ rule_run_id: "rr_x", status: "queued" })`。這三支用 `fakeRuntimeStatus`（含 active session）→ 本 task 的 auto-PICK effect 已把 step 推到 picked，原本顯式 `(q("a1-step-pick")).click()` 因 `selectedKey===''` 變 no-op 但無害（step 已 picked），doRun 照跑、改走 for-session。
  - `console.test.tsx` 的 client-render describe `beforeEach`：把現第 1693-1696 行的「空 runtime」mock 改成帶**一個 active session**（讓 `selectedSession` 有值 → auto-PICK + run 鈕 `!selectedSession` gating 通過），並補 `elementMappingForSession` mock（避免有 `usd_prim_path: null` 列的測試觸發真 mapping fetch 在 fake-timer 下 hang）；同步把該 beforeEach 上方「為何 mock 空 runtime 隔離真 fetch」的註解改寫成「提供 1 個 active session 跑 for-session doRun + mock elementMappingForSession 防 hang」：
    ```ts
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({
      sessions: { count: 1, active_count: 1, participant_count: 0, items: [
        { session_id: "review_session_x", status: "active", project_id: "p1", model_version_id: "m1",
          participant_count: 0, expected_stage_url: "", expected_mapping_url: "", conversion_status: null,
          kit_instance_ids: [], created_at: "", updated_at: "", first_frame_at: null },
      ] },
      configured_endpoints: { viewer: { browser_url_base: "" } }, // viewerOrigin 留空 → 不掛 EmbeddedViewer，斷言面不變
    } as never);
    vi.spyOn(governanceClient, "elementMappingForSession").mockResolvedValue({ mock: false, summary: { fake_mapping_count: 0 }, items: [] });
    ```
  - `console.test.tsx` 的 11 支：把各自的 `vi.spyOn(governanceClient, "createRuleRun")...`（現第 1736 / 1763 / 1788 / 1822 / 1862 / 1917 / 1946 / 1984 / 2031 / 2094 / 2132 行）一律改名為 `createRuleRunForSession`（`[qr-t2-pollgen-race]` 第 1917 行的 `mockReturnValue(createPending)` deferred 也一併改名，回傳型別相同無須 cast）。Task 2 已加的 `getMinioObjects` mock 與 `pickModel` helper 保留沿用（`pickModel` 設的 `selectedKey` 仍供 reset 測試 re-click pick 用）。
  > viewerOrigin 留空 → 這批 doRun 測試不掛 EmbeddedViewer、無須在 `console.test.tsx` vi.mock viewer；斷言面（scoreboard / issues / export / bcf）不變。
- [ ] 跑測試 + 型別檢查確認綠（**含 `console.test.tsx` 回歸**：本 task 改了 doRun，那批 11 支 doRun 測試必須一起綠）：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/A1ViewerEmbed.test.tsx src/console/console.test.tsx && npx tsc --noEmit
  ```
  預期：兩檔全 passed（含遷移後的 3 支 A1ViewerEmbed + 11 支 console doRun 測試改打 `createRuleRunForSession`）；tsc exit 0。
- [ ] commit：
  ```bash
  git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/A1ViewerEmbed.test.tsx web-viewer-sample/src/console/console.test.tsx
  git commit -m "feat(console): A1 step② 治理檢核改 for-session + session gating（B2 task4）"
  ```

---

## Task 5: 移除 A1 頁底 demo-control 內嵌大表 + 修 smoke 斷言

移除 `<RealIfcConsolePage/>` 內嵌與其 import。該元件仍掛在 `#/demo-control`（`EdgeConsole.tsx:86` / `OperatorConsole.tsx:32`），故 `#/demo-control` 路由與 `OperatorConsole.test.tsx` 回歸不受影響。

**Files**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage` + 檔頂 import）
- Test: `web-viewer-sample/src/console/console.test.tsx`、`web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Steps**

- [ ] 在 `console.test.tsx` 的 A1 honesty smoke 區塊把現第 367-368 行兩條 `toContain` 翻成 `not.toContain`，並補「下拉在、文字框不在」正向斷言：
  ```ts
    expect(a1).not.toContain('data-testid="a1-real-ifc-slice"');
    expect(a1).not.toContain('data-testid="real-ifc-demo-control"');
    expect(a1).toContain('data-testid="a1-minio-select"'); // step① 已改下拉
    expect(a1).not.toContain('data-testid="a1-step-path"'); // 手打路徑文字框已移除
  ```
- [ ] （誠實補強，非功能）把 `A1ViewerEmbed.test.tsx` 現第 290 行 stale 測試標題更新為反映新 UI：
  ```ts
  it("無 active session：顯示排入轉檔 UI（a1-no-session wrapper），不出 session 下拉", async () => {
  ```
- [ ] 跑確認 smoke 失敗（embed 還在）：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "honesty smoke"
  ```
  預期：1 failed（`a1` 仍含 `a1-real-ifc-slice`）。
- [ ] 在 `pages.tsx` 刪掉內嵌 section（現第 652-654 行）：
  ```tsx
      <section data-testid="a1-real-ifc-slice" className="ec-a1-inline-slice">
        <RealIfcConsolePage />
      </section>
  ```
- [ ] 在 `pages.tsx` 刪掉現第 12 行 import：
  ```ts
  import { RealIfcConsolePage } from "./RealIfcConsolePage";
  ```
- [ ] 跑全 console 測試 + lint + 型別檢查（含 `OperatorConsole.test.tsx` 回歸：demo-control 仍渲染 `real-ifc-demo-control`）：
  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx src/console/A1ViewerEmbed.test.tsx src/console/OperatorConsole.test.tsx && npm run lint && npx tsc --noEmit
  ```
  預期：全 passed（`OperatorConsole.test.tsx` 的 demo-control 測試仍綠）；lint exit 0；tsc exit 0。
- [ ] commit：
  ```bash
  git add web-viewer-sample/src/console/pages.tsx web-viewer-sample/src/console/console.test.tsx web-viewer-sample/src/console/A1ViewerEmbed.test.tsx
  git commit -m "refactor(console): A1 移除 demo-control 內嵌大表 + 修 smoke 斷言（B2 task5）"
  ```

---

## Task 6: 瀏覽器 E2E（更新 viewer-embed 走 for-session + 新增 MinIO 排隊垂直切片）

A1 是 user-facing feature，AGENTS.md 要求 browser E2E 證據。本 task：(a) 更新既有 `viewer-embed-a1-highlight.spec.ts`（step① 文字框改下拉、step② 改 for-session）讓 3D 高亮證據鏈仍可跑；(b) 新增 `a1-minio-governance-3d.spec.ts` 驗真正新增的「MinIO 選模型 → 排入轉檔 → 真 job id → 誠實 lifecycle 狀態行」垂直切片。

> **誠實邊界（NOT BUILT / not observed）**：「排隊 → ready → auto-session → for-session → 3D 高亮」整條 happy path 依賴真 stack 的 converter 把 `conversion_status` 回填成 `ready`（lifecycleStatus.ts 註明「converter 落地前不會出現 ready」）。dev stack 若該 callback 未驗，MinIO 觸發只會停在 detected/queued/converting。故 (b) 只驗到「真 job id + 誠實非 ready 狀態行」，ready 之後的續段以 `test.fixme` 明標 NOT BUILT；3D 高亮證據改由 (a) 用既有 `:49101` succeeded conversion 建好的 session 獨立取得（兩半合起來才是完整 user-facing 證據）。

**Files**
- Modify: `web-viewer-sample/e2e/viewer-embed-a1-highlight.spec.ts`
- Create: `web-viewer-sample/e2e/a1-minio-governance-3d.spec.ts`

**Steps**

- [ ] 更新 `viewer-embed-a1-highlight.spec.ts` 的「失敗構件 3D 紅高亮」test：把現第 154-157 行（取 `ifcPath`、`fill("a1-step-path")`、`fill("a1-ids-path")`、`click("a1-step-pick")` 那四行）替換成只 fill IDS 的 for-session 流程（選 session 即 auto-PICK，不再 fill 路徑、不再點 a1-step-pick）：
  ```ts
    // for-session 模式（B2）：rule-run 由 session 反解 IFC，瀏覽器不再 fill server-side 路徑。
    // 選定 session 後 auto-PICK 已推進五步條，run 鈕即 enable。IDS 仍以選填欄帶入 for-session。
    await page.getByTestId("a1-ids-path").fill(VG01_IDS_PATH);
  ```
  > 該 test 開頭既有的 `await page.getByTestId("a1-session-select").selectOption(sessionId);`（現第 146 行）保留——它正是 auto-PICK 的觸發點。其後 a1-step-run enable→click→a1-rulerun-scoreboard→a1-highlight-3d→a1-highlight-status 的斷言與截圖（現第 158-172 行）原樣保留。
- [ ] 確認 `viewer-embed-a1-highlight.spec.ts` 內已無 `a1-step-path` / `a1-step-pick` 殘留參考：
  ```bash
  cd web-viewer-sample && grep -n "a1-step-path\|a1-step-pick" e2e/viewer-embed-a1-highlight.spec.ts || echo clean
  ```
  預期：輸出 `clean`。
- [ ] 新增 `web-viewer-sample/e2e/a1-minio-governance-3d.spec.ts`：
  ```ts
  import { test, expect } from "@playwright/test";

  // A1 重構（B2）MinIO 排隊垂直切片：選 MinIO source_ifc 模型 → 排入 IFC→USD 轉檔 → 真 ifc_ready job id
  // → 誠實 lifecycle 狀態行（detected/queued/converting；轉檔未完成不顯示假 ready）→ #conv 連結。
  // 前置：cd web-viewer-sample && npm run build:ui，再重啟 branch coordinator(:8005) 服務新 dist-ui；
  // MinIO watch env 須齊（endpoint/bucket/credentials）。未重建 console → 觀察可能是陳舊碼，不算驗證。
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

  test.describe("A1 MinIO 排隊 → 誠實轉檔狀態（B2）", () => {
    test.setTimeout(120_000);
    let sourceKey = "";

    test.beforeEach(async ({ request, page }) => {
      let apiOk = false;
      try { apiOk = (await request.get(`${COORDINATOR}/health`, { timeout: 10_000 })).ok(); } catch { apiOk = false; }
      test.skip(!apiOk, "branch coordinator 未備妥：需啟動 :8005 或設定 E2E_COORDINATOR_BASE_URL");

      sourceKey = "";
      try {
        const res = await request.get(`${COORDINATOR}/api/minio/objects`, { timeout: 15_000 });
        const body = await res.json();
        const objs = Array.isArray(body?.objects) ? body.objects as Array<{ key: string; role: string }> : [];
        sourceKey = objs.find((o) => o.role === "source_ifc")?.key ?? "";
      } catch { sourceKey = ""; }
      test.skip(!sourceKey, "MinIO 未設定或無 source_ifc 物件（GET /api/minio/objects 空）：需填 MINIO_WATCH_* 並上傳真 .ifc");

      await page.goto(`${COORDINATOR}/ui/#/a1`, { waitUntil: "domcontentloaded" });
      const hasBranchUi = await page.getByTestId("a1-minio-select").waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
      test.skip(!hasBranchUi, "coordinator dist-ui 非本 branch：需 npm run build:ui 後重啟 :8005");
    });

    test("選 MinIO 模型 → 排入轉檔 → 真 job id + 誠實 lifecycle 狀態行 + #conv 連結", async ({ page }) => {
      await page.getByTestId("a1-minio-select").selectOption(sourceKey);
      await expect(page.getByTestId("a1-trigger-convert")).toBeEnabled({ timeout: 5_000 });
      await page.getByTestId("a1-trigger-convert").click();
      // loading→success：真 ifc_ready job id 出現（runtime ID 證據）。
      await expect(page.getByTestId("a1-convert-job")).toContainText("ifcready", { timeout: 30_000 });
      // 誠實 lifecycle：原樣顯示 detected/queued/converting（轉檔未完成不顯示假 ready）。
      await expect(page.getByTestId("a1-convert-status")).toContainText(/detected|queued|converting|downloaded|queued_for_conversion/, { timeout: 30_000 });
      await expect(page.getByTestId("a1-conv-link")).toBeVisible();
      await page.screenshot({ path: "../docs/evidence/a1-minio-governance-3d/queue-status.png", fullPage: true });
    });

    // ready 之後續段（auto-session → for-session 檢核 → 3D 高亮）依賴真 converter 回填 conversion_status=ready。
    // dev stack 該 callback 未驗時 lifecycle 停在 converting；不偽造，明標 NOT BUILT。3D 高亮證據改由
    // viewer-embed-a1-highlight.spec.ts（既有 :49101 conversion 建好的 session）獨立取得。
    test.fixme("轉好 → auto-session → for-session 檢核 → 3D 高亮（NOT BUILT: 真 converter ready callback 未驗）", async () => {
      // 待補：真 stack converter 回填 ready 後，驗 a1-convert-status 顯 ready → A1 撈到 auto-session →
      //       a1-step-run(for-session) → a1-rulerun-scoreboard → a1-highlight-3d → a1-highlight-status「已在 3D 標示」+ 截圖。
    });
  });
  ```
- [ ] 建 `/ui` bundle 並（在備妥 branch :8005 + 真 stack 的環境）跑兩支 E2E；無真 stack 時記錄為 skip（誠實揭露，skip 不等於 PASS）：
  ```bash
  cd web-viewer-sample && npm run build:ui && npx playwright test e2e/a1-minio-governance-3d.spec.ts e2e/viewer-embed-a1-highlight.spec.ts
  ```
  預期（真 stack）：a1-minio-governance-3d 排隊 test 出現真 `ifcready...` job id + 非 ready 狀態行 + 截圖落 `docs/evidence/a1-minio-governance-3d/`；viewer-embed-a1-highlight 的 first-frame / 紅高亮截圖落 `docs/evidence/viewer-embed-a1-highlight/`。預期（無真 stack）：相關 test honest skip，回報為 not observed 而非 PASS。
- [ ] commit：
  ```bash
  git add web-viewer-sample/e2e/viewer-embed-a1-highlight.spec.ts web-viewer-sample/e2e/a1-minio-governance-3d.spec.ts
  git commit -m "test(e2e): A1 MinIO 排隊垂直切片 + viewer-embed 改 for-session（B2 task6）"
  ```

---

## 收尾（最後一個 task 完成後）

- [ ] 全前端驗證一次拿總綠（與 baseline 比較不退步）：
  ```bash
  cd web-viewer-sample && npx tsc --noEmit && npm run lint && npm test
  ```
  預期：tsc exit 0；lint exit 0；`npm test` 全 passed。
- [ ] commit 前依 CLAUDE.md §4 跑 detect_changes，確認受影響 symbol scope 不超出預期（只 `A1GovernanceWorkbenchPage` + 新增 client 方法）：
  ```
  mcp__gitnexus__detect_changes  repo="AI-BIM-governance"
  ```
- [ ] 完成回報四項：改了哪些 tracked files、跑了哪些最小驗證、哪些測試沒跑及原因（E2E 真 stack 段落若 skip 須誠實標 not observed）、已知風險（converter Phase-2 ready callback 未驗時 MinIO happy path 無法閉合）。

## 誠實 / 邊界備註

- 轉檔/排隊狀態一律**原樣顯示** `conversion_lifecycle_status`（detected/queued/converting/ready/failed），缺欄才降級到 `conversion_status`/`download_status`；lifecycle 非 ready **不顯示假成功**。
- presigned 簽章 / secret 絕不入前端與 log：前端只送 `key`，presign 與 webhook secret 一律 coordinator server-side（B1 已落地）。
- 3D 高亮四條件邏輯（IX-A1-06）與記分板 / Issue / Excel / BCF 全不動。
- `#/demo-control`（`RealIfcConsolePage`）保留；A1 只移除其內嵌。
- `Prov` 型別僅 7 值（`asbuilt`/`artifact`/`demo`/`p1`/`p15`/`p3`/`p4`），新增 `Field`/`ProvTag` 一律用 `asbuilt`（真實後端）或 `p1`（待觀察），不得寫 `todo`（TS2322）。

## YAGNI（spec §9，不做）

- 不做「專案→類別→版本」三層巢狀下拉（用 `/api/minio/objects` 平面清單，已帶三段欄位）。
- A1 不做插隊（去 `#conv`），只連結過去。
- 不刪 `#/demo-control`；不做 `for-ifc-ready` 端點（檢核等轉檔完成 → 用既有 for-session）。
- MinIO 下拉先不做分頁/搜尋（OQ-A1-3 定案）。
