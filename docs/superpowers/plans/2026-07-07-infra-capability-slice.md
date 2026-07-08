# INFRA 基礎設施本輪切片 Implementation Plan（Spec-0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Spec：`docs/superpowers/specs/2026-07-07-infra-capability-contract-design.md`（先讀 §0 關鍵發現：INFRA 是 capability substrate，A1 只是第一個 consumer）

**Goal:** 把 INFRA 做成未來 BIM/AI/Omniverse 新能力的共用證據底座：本輪先落地 `#sessions` 證據鏈（SS-02）、A1 連動橋供應端（SS-05）、ModelDataPage coverage 呈現（S3）、`#instances` 真遙測第一片（S4）、`#runtime` 監控彙總＋孤兒清理（S5）。

**Architecture:** 後端證據鏈已存在（coordinator `/api/runtime/status` 的 session 物件已含 `first_frame_at`、`viewer_leases[]`（含 `last_heartbeat_at`/`datachannel_ready`/`stage_match`）、`stage_open_evidence`）。本輪**幾乎全是前端渲染＋一個 additive client 函式**；不改任何凍結檔。A1 只是第一個消費者：本輪建立的 session evidence、runtime telemetry、ledger coverage、Kit instance 狀態與 Review Room handoff，必須能被後續 A2/A3/A4/A5/A6+、AI 審查、BCF topic/viewpoint/snapshot 閉環重用。

**Tech Stack:** React 18 + TypeScript（web-viewer-sample console）、Vitest（`createRoot`+`act`+`vi.spyOn` 模式）、Playwright evidence。

## Product North Star（與長期目標的關係）

這個 repo 的長期目的不是只交付 A1，而是承接 BIM、AI coding、Omniverse/WebRTC、BCF/IDS、digital twin 等新趨勢與新發現，逐步形成一個可驗證、可審批、可回放的能力平台。A1「治理與模型檢核」只是第一個可落地的 capability slice；INFRA 要提供所有未來 capability 共用的證據、遙測、handoff、交付物與誠實降級規則。

本 plan 的任務因此要以「capability substrate」角度執行：

- `#sessions` / `#runtime` 證據鏈不是 A1 私有狀態；它是未來所有 3D 連動能力的 ready gate（A1 高亮、A2 diff overlay、A3 clash 飛點、A4 isolate、A5 IoT twin、A6 4D/5D 等）。
- BCF 的目標不是單純下載 `.bcfzip`，而是把 AI/rule/diff/人工審查結果變成可交換、可稽核、可帶 viewpoint/snapshot 的 approval artifact；本輪只保留 BCF 2.1 與 Issue gating，不偷渡 BCF 3.0 或假 viewpoint。
- A1 bridge wording 只在 IX-A1/IX-SS-05 contract 中使用；新增工具函式、資料欄位與 telemetry copy 預設要保持 capability-neutral，避免把未來 A2-A10 都綁死成 A1 特例。
- 未來 AI coding / AI reviewer 可以消費這些 evidence 來建立或流轉 BCF topic，但本輪不做自動審批、不做 agent 決策寫回 source model；所有 state change 仍走明確 intent、confirm、audit 與 backend 回讀。

## Global Constraints（每個 Task 隱含適用）

- 前端只打 coordinator `127.0.0.1:8004`；不得直連 `:49102/:49101/:8010`。
- 禁改凍結檔：coordinator `src/app.ts`、`src/routes/governanceProxy.ts`（本 plan 完全不需要動它們）；streaming `conversion_authority.py`。
- 誠實鐵律：無遙測顯「未取得」／`not observed`，禁推定（D-33）、禁樂觀更新、禁畫假綠燈。
- Capability-neutral：除非既有規格明名 `A1Bridge` / IX-A1 / IX-SS-05，新增 helper、types、telemetry copy 不得寫成 A1-only；A1 是第一個 consumer，不是 INFRA 的唯一 owner。
- `useSharedStatus()` 的 `SharedSessionEntry.stage_matched` 為刻意永遠 null 的精簡摘要（useSharedStatus.ts:10）——**證據欄一律用 `coordinatorClient.runtimeStatus()` 完整資料，不用 SharedStatus**。
- 驗證指令：`cd web-viewer-sample && npm run verify`（= build + vitest + test:struct-log；型別檢查含在 vite build）。單測：`npx vitest run src/console/<file>`。
- console 改動要 `npm run build:ui` 產 dist-ui 並重啟 coordinator 才會出現在 `:8004/ui`。
- 測試模式（照 `SessionManagementPage.test.tsx`）：`createRoot`+`act` 掛載、`vi.spyOn(coordinatorClient, "方法").mockResolvedValue(...)`、`container.querySelector('[data-testid=...]')`、`dispatchEvent(new MouseEvent("click", { bubbles: true }))`。
- 每個 Task 改 symbol 前跑 GitNexus `impact`，commit 前跑 `detect_changes`。
- 分支：`feat/infra-capability-slice`（從 main 切，main 已含本 spec/plan）。每個 Task 完成即 commit。

---

### Task 0: A1 MinIO downloaded-session stale artifact diagnosis（新增 issue）

**Issue（2026-07-08 runtime diagnosis）**：operator 在 `#a1` 選到 MinIO source_ifc 後，API 狀態可能同時是 `download_status=downloaded`、`review_session_id` 已存在、`conversion_lifecycle_status=ready`，但 `artifact_health.source_ifc_exists=false`、`stale_reason=edge_storage_root_missing`。現有安全守門會正確阻止 for-session rule-run，但主要 disabled button 文案仍可能顯示「等待 downloaded session」，容易被誤解成 watcher 還沒下載，而不是 server-local IFC artifact / storage root 不可讀。

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`A1GovernanceWorkbenchPage` MinIO disabled button copy）
- Test: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`

**Constraints:**
- 不改 coordinator / governance-service 凍結面；此 issue 是 UX copy + regression test gap，不是放寬 A1 guard。
- `edge_storage_root_missing` 必須原樣露出於 visible diagnostic；不得把 stale artifact 誤報成 not downloaded。

- [ ] **Step 1: 寫失敗測試** — fixture 設 `download_status="downloaded"`、`review_session_id` 存在、`artifact_health.source_ifc_exists=false`、`stale_reason="edge_storage_root_missing"`；斷言 `a1-minio-resolution-note` 含 `edge_storage_root_missing`，且 disabled `a1-step-pick` 文案不再只是「等待 downloaded session」。
- [ ] **Step 2: 實作 copy** — disabled pick button label 依 state 區分：未 downloaded 才顯「等待 downloaded session」；已 downloaded 但無 session 顯「等待 review session」；已 downloaded 且 session 存在但 stale 顯「source IFC artifact stale」。
- [ ] **Step 3: 跑 `npx vitest run src/console/A1ViewerEmbed.test.tsx` 與 `npm run verify`。**

---

### Task 1: SS-02 — `#sessions` 三欄證據＋5000ms 輪詢

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`SessionManagementPage`，函式起點 :1055；表頭 :1130、tbody :1135-1168、mount effect :1101）
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（若 `RuntimeSessionSummary` 型別缺 `viewer_leases`/`first_frame_at` 欄位則 additive 補齊——欄位名逐字對 coordinator `publicLease()`：`lease_id/status/last_heartbeat_at/first_frame_at/loaded_stage_url/datachannel_ready/stage_match`，及 session 層 `primary_viewer_lease_id`）
- Test: `web-viewer-sample/src/console/SessionManagementPage.test.tsx`

**Interfaces:**
- Produces: `export function leaseEvidence(s: RuntimeSessionSummary, nowMs: number): LeaseEvidence`（`{ firstFrameAt: string|null; lastHeartbeatAt: string|null; heartbeatStale: boolean|null; stageMatch: boolean|null; datachannelReady: boolean|null }`）— Task 2、A1 bridge 與後續 A-axis 3D consumers 重用，放在 `pages.tsx` 頂部工具區並 export。
- Consumes: `coordinatorClient.runtimeStatus()`（既有）。

- [ ] **Step 1: 寫失敗測試**（加進 `SessionManagementPage.test.tsx`；沿用該檔 `makeSession`/`rtWith` fixture，fixture 需 additive 補 `first_frame_at`、`primary_viewer_lease_id`、`viewer_leases`）

```tsx
it("active session 顯示三欄證據：first_frame / heartbeat(stale) / stage_match", async () => {
  const now = Date.now();
  const session = {
    ...makeSession("active"),
    first_frame_at: new Date(now - 60_000).toISOString(),
    primary_viewer_lease_id: "lease_1",
    viewer_leases: [{
      lease_id: "lease_1", status: "active",
      last_heartbeat_at: new Date(now - 20_000).toISOString(), // >15s → stale
      first_frame_at: new Date(now - 60_000).toISOString(),
      loaded_stage_url: "s", datachannel_ready: true, stage_match: true,
    }],
  };
  vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(makeStatus([session]) as never);
  const root = createRoot(container);
  await act(async () => { root.render(<SessionManagementPage />); });
  await act(async () => { await Promise.resolve(); });
  const row = container.querySelector('[data-testid="session-row-review_session_t1"]')!;
  expect(row.querySelector('[data-testid="ev-first-frame"]')!.textContent).not.toContain("未取得");
  expect(row.querySelector('[data-testid="ev-heartbeat"]')!.textContent).toContain("stale");
  expect(row.querySelector('[data-testid="ev-stage"]')!.textContent).toContain("matched");
});

it("無 lease 的 session 三欄一律顯示「未取得」不畫 fail", async () => {
  vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rtWith("active"));
  const root = createRoot(container);
  await act(async () => { root.render(<SessionManagementPage />); });
  await act(async () => { await Promise.resolve(); });
  const row = container.querySelector('[data-testid="session-row-review_session_t1"]')!;
  for (const id of ["ev-first-frame", "ev-heartbeat", "ev-stage"]) {
    expect(row.querySelector(`[data-testid="${id}"]`)!.textContent).toMatch(/未取得|not observed/);
  }
});
```

- [ ] **Step 2: 跑測試確認失敗** — `cd web-viewer-sample && npx vitest run src/console/SessionManagementPage.test.tsx`，預期 FAIL（querySelector 回 null）。

- [ ] **Step 3: 實作**

(a) `pages.tsx` 頂部工具區加（export 供 Task 2／A1 bridge／後續 A-axis 3D consumers 重用）：

```tsx
export interface LeaseEvidence {
  firstFrameAt: string | null;
  lastHeartbeatAt: string | null;
  heartbeatStale: boolean | null; // null = 無心跳資料（未取得）
  stageMatch: boolean | null;
  datachannelReady: boolean | null;
}

export function leaseEvidence(s: RuntimeSessionSummary, nowMs: number): LeaseEvidence {
  const leases = s.viewer_leases ?? [];
  const lease = leases.find((l) => l.lease_id === s.primary_viewer_lease_id)
    ?? leases.find((l) => l.status === "active") ?? null;
  const lastHb = lease?.last_heartbeat_at ?? null;
  return {
    firstFrameAt: s.first_frame_at ?? lease?.first_frame_at ?? null,
    lastHeartbeatAt: lastHb,
    heartbeatStale: lastHb ? nowMs - Date.parse(lastHb) > 15_000 : null,
    stageMatch: lease?.stage_match ?? null,
    datachannelReady: lease?.datachannel_ready ?? null,
  };
}
```

（`RuntimeSessionSummary` import 自 coordinatorClient；型別缺欄位就 additive 補型別，欄位名逐字照上方 Files 段。）

(b) `SessionManagementPage` 表格：表頭（:1130）在 `stage` 後加三欄 `首幀`/`心跳`/`stage`；tbody 每列（:1135-1168 map 內）加：

```tsx
{(() => {
  const ev = leaseEvidence(s, Date.now());
  const na = t("未取得", "not observed");
  return (<>
    <td data-testid="ev-first-frame">{ev.firstFrameAt ? new Date(ev.firstFrameAt).toLocaleTimeString() : na}</td>
    <td data-testid="ev-heartbeat">{ev.lastHeartbeatAt
      ? <>{new Date(ev.lastHeartbeatAt).toLocaleTimeString()}{ev.heartbeatStale ? <span className="ec-prov ec-p1" style={{ marginLeft: 4 }}>stale</span> : null}</>
      : na}</td>
    <td data-testid="ev-stage">{ev.stageMatch === true ? "matched" : ev.stageMatch === false ? t("不符", "mismatch") : na}</td>
  </>);
})()}
```

(c) 輪詢：mount effect（:1101）改為 5000ms interval（與 SharedStatusProvider 同 cadence；手動刷新鈕保留）：

```tsx
useEffect(() => {
  void load();
  const id = window.setInterval(() => { void load(); }, 5000);
  return () => window.clearInterval(id);
}, [load]);
```

- [ ] **Step 4: 跑測試確認通過** — 同 Step 2 指令，預期 PASS；再跑整檔確認既有測試沒被 interval 弄壞（測試用 fake timer 者注意 cleanup；若既有測試因 interval 卡住，在 afterEach `root.unmount()` 確保 clearInterval）。
- [ ] **Step 5: `npm run verify` 綠後 commit** — `feat(sessions): IX-SS-02 occupied 證據三欄+5s 輪詢`。

---

### Task 2: SS-05 — `#sessions` A1BridgeSupplyPanel

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`SessionManagementPage` 內，Controlled actions Panel（:1171）之前插入新 Panel）
- Test: `web-viewer-sample/src/console/SessionManagementPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `leaseEvidence()`（同一證據推導，保證與表格/A1 一致）。
- Produces: `data-testid="a1-bridge-supply"` Panel；每 session 一列 `data-testid={`supply-${session_id}`}`。

- [ ] **Step 1: 寫失敗測試**

```tsx
it("A1BridgeSupplyPanel 顯示繫結鏈且證據與列表同源", async () => {
  const now = Date.now();
  const session = { ...makeSession("active"), first_frame_at: new Date(now - 1000).toISOString(),
    primary_viewer_lease_id: "lease_1",
    viewer_leases: [{ lease_id: "lease_1", status: "active", last_heartbeat_at: new Date(now).toISOString(),
      first_frame_at: new Date(now - 1000).toISOString(), loaded_stage_url: "s", datachannel_ready: true, stage_match: true }] };
  vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(makeStatus([session]) as never);
  const root = createRoot(container);
  await act(async () => { root.render(<SessionManagementPage />); });
  await act(async () => { await Promise.resolve(); });
  const panel = container.querySelector('[data-testid="a1-bridge-supply"]')!;
  const line = panel.querySelector('[data-testid="supply-review_session_t1"]')!;
  expect(line.textContent).toContain("review_session_t1");
  expect(line.textContent).toContain("DataChannel ✓");
  expect(line.textContent).toContain("stage matched");
});
```

- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作** — 在 Controlled actions Panel 前插入：

```tsx
<Panel title={t("A1 連動橋供應端", "A1 bridge supply")} prov="asbuilt"
  sub={t("單一證據來源＝本頁 /api/runtime/status（IX-SS-05）；highlight ack 權威＝Review Room command trace，本面板不推定", "...")}>
  <div data-testid="a1-bridge-supply">
    {sessions.filter((s) => s.status === "active" || s.status === "created").map((s) => {
      const ev = leaseEvidence(s, Date.now());
      const na = t("未取得", "not observed");
      return (
        <div key={s.session_id} data-testid={`supply-${s.session_id}`} className="ec-s" style={{ marginBottom: 4 }}>
          <code>{s.session_id}</code>
          {" ⇢ lease "}{s.primary_viewer_lease_id ?? na}
          {" ⇢ "}{ev.datachannelReady ? "DataChannel ✓" : `DataChannel ${na}`}
          {" ⇢ "}{ev.stageMatch === true ? "stage matched" : `stage ${na}`}
          {" ⇢ 首幀 "}{ev.firstFrameAt ? new Date(ev.firstFrameAt).toLocaleTimeString() : na}
          {" · "}<a href={buildHandoff("review", { source: "sessions", session: s.session_id })}>{t("Review Room（ack trace）→", "Review Room (ack trace) →")}</a>
        </div>
      );
    })}
    {sessions.every((s) => s.status !== "active" && s.status !== "created") && (
      <p className="ec-note">{t("無 active session；A1 連動橋在 #a1 端維持 idle。", "...")}</p>
    )}
  </div>
</Panel>
```

（`buildHandoff` 已在本檔使用（:1243 KG 頁同款 import）。「關 session 後 A1 橋回 idle」由同源輪詢自然成立：session 轉 closing/closed 即從供應清單消失——A1 端對稱驗收在本輪 E2E 中驗。）

- [ ] **Step 4: 跑測試確認通過**；`npm run verify`。
- [ ] **Step 5: Commit** — `feat(sessions): IX-SS-05 A1 連動橋供應端 panel`。

---

### Task 3: S3 — ModelDataPage 呈現 ledger coverage_report（verify-first）

**背景（已查證）**：回填鏈**已落地**（PR #287：`ingestConversionReport` 回填 `status`/`usdc_key`/`coverage_report` 進 ledger；`ObjectDetailPane.tsx:122-128` 已渲染 `usdc_key`（null→「待產生」誠實態））。「property/relationship/attribute 三軸 %」**後端不存在**（全 repo 零命中）——**禁止捏造三軸欄位**，只渲染真實欄位。

**Files:**
- Modify: `web-viewer-sample/src/console/modelData/ObjectDetailPane.tsx`（coverage 區 :182-198 附近）
- Test: `web-viewer-sample/src/console/modelData/ObjectDetailPane.test.tsx`

**Interfaces:**
- Consumes: `record.coverage_report`（`ConversionRecord`，ledger 回填欄，unknown|null）；欄位取 `coverage_ratio`/`coverage_status`/`mapped_count`/`unmapped_count`（來源=streaming `_normalize_quality_metrics`）。

- [ ] **Step 1: 先驗現況** — 讀 `ObjectDetailPane.tsx` 現檔確認 `record.coverage_report` 是否已渲染；若已渲染（後續 PR 可能已補），本 Task 只補測試與 E2E，回報「已建」。
- [ ] **Step 2: 寫失敗測試**（照 `ObjectDetailPane.test.tsx` 既有 mock 模式）：record 帶 `coverage_report: { coverage_ratio: 1, coverage_status: "pass", mapped_count: 10, unmapped_count: 0, materialization_strategy: "usd_stage_enumeration" }` → 斷言畫面出現 `data-testid="md-ledger-coverage"` 且內容含 `100%`、`pass`、且含自我參照註記文案；record 無 coverage_report → 顯「未取得」。
- [ ] **Step 3: 實作** — usdc_key Field 下方加：

```tsx
<Field k={t("coverage（ledger 回填）", "coverage (ledger backfill)")}
  v={(() => {
    const cr = record?.coverage_report as { coverage_ratio?: number; coverage_status?: string; mapped_count?: number; unmapped_count?: number; materialization_strategy?: string } | null;
    if (!cr || typeof cr.coverage_ratio !== "number") return <span data-testid="md-ledger-coverage">{t("未取得", "not observed")}</span>;
    return (
      <span data-testid="md-ledger-coverage">
        {Math.round(cr.coverage_ratio * 100)}% · {cr.coverage_status ?? "?"} · mapped {cr.mapped_count ?? "?"}/{(cr.mapped_count ?? 0) + (cr.unmapped_count ?? 0)}
        {cr.materialization_strategy === "usd_stage_enumeration" && cr.coverage_ratio === 1
          ? <span className="ec-note" style={{ marginLeft: 6 }}>{t("（自我參照口徑：非 IFC lossless 宣稱）", "(self-referential caliber; not an IFC lossless claim)")}</span>
          : null}
      </span>
    );
  })()}
  prov="artifact" />
```

（`ConversionRecord` 型別若缺 `coverage_report` 欄位，coordinatorClient.ts additive 補 `coverage_report?: unknown`。）

- [ ] **Step 4: 測試通過＋`npm run verify`**。
- [ ] **Step 5: Commit** — `feat(minio): ObjectDetailPane 呈現 ledger coverage 回填（誠實口徑註記）`。

---

### Task 4: S4 — `#instances` 真遙測第一片

**背景（已查證）**：kit-manager-api **只有** `GET /api/kit/instances/current`（經 coordinator proxy `GET /api/kit/instances/current`，app.ts:2548-2550，已存在）。回應=`KitInstanceState`：`{ instance_id: string, status: string, selected_artifact_ids: string[], opened_runtime_uris: string[], last_command: string|null, control_status: string }`（status 值：idle/open/closed/blocked/recorded_only）。**無 fleet 清單、無 GPU 數值遙測**——GPU busy/total 維持「未取得」誠實態。

**Files:**
- Modify: `web-viewer-sample/src/console/coordinatorClient.ts`（additive 函式）
- Modify: `web-viewer-sample/src/console/pages.tsx`（`KitGpuFleetPage` :1193；demo Node snapshot 表 :1239-1247）
- Test: `web-viewer-sample/src/console/KitGpuFleetPage.test.tsx`（新檔）

**Interfaces:**
- Produces: `coordinatorClient.kitInstanceCurrent(): Promise<KitInstanceState>`；`KitInstanceState` 型別如上（逐字欄位）。

- [ ] **Step 1: 寫失敗測試**（新檔，沿用 SessionManagementPage.test.tsx 的掛載模式）：

```tsx
it("kit-manager 可用時顯示真 instance 狀態", async () => {
  vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockResolvedValue({
    instance_id: "kit_main", status: "open", selected_artifact_ids: [], opened_runtime_uris: ["omniverse://x"], last_command: "open", control_status: "sent",
  } as never);
  // …掛載 KitGpuFleetPage…
  const panel = container.querySelector('[data-testid="kg-live-instance"]')!;
  expect(panel.textContent).toContain("kit_main");
  expect(panel.textContent).toContain("open");
});

it("kit-manager 不可用時顯示「未取得」且不出現 edge-gpu 假節點", async () => {
  vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockRejectedValue(new Error("502"));
  // …掛載…
  expect(container.querySelector('[data-testid="kg-live-instance"]')!.textContent).toMatch(/未取得|not observed/);
  expect(container.textContent).not.toContain("edge-gpu-01");
});
```

- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作**
  - 先同步更新既有 `KitGpuFleetCrossLinks.test.tsx`：原本 assert `edge-gpu-01` demo row 的舊契約需改成真遙測/未取得契約，避免本 Task 依 plan 移除 demo 節點後被舊測試擋住。
  - coordinatorClient additive（照檔內 `jsonGet` 既有寫法）：`kitInstanceCurrent: () => jsonGet<KitInstanceState>("/api/kit/instances/current")` ＋ export `KitInstanceState` interface（欄位逐字如上）。
  - `KitGpuFleetPage`：**整段移除** hardcoded demo Node snapshot 表（:1239-1247，含 edge-gpu-01..03 三列）；原位改為：

```tsx
<Panel title={t("Kit instance（真遙測）", "Kit instance (live)")} prov="asbuilt"
  sub={t("來源：coordinator /api/kit/instances/current → kit-manager-api :8010；多節點 fleet 遙測 NOT BUILT（Spec-0 §4 backlog）", "...")}>
  <div data-testid="kg-live-instance">
    {kitErr || !kit ? (
      <p className="ec-note">{t("未取得（kit-manager 未回應）", "not observed (kit-manager unavailable)")}{kitErr ? ` — ${kitErr}` : ""}</p>
    ) : (
      <div className="ec-grid">
        <Field k="instance_id" v={kit.instance_id} prov="asbuilt" />
        <Field k="status" v={kit.status} prov="asbuilt" />
        <Field k="control_status" v={kit.control_status} prov="asbuilt" />
        <Field k="opened_runtime_uris" v={kit.opened_runtime_uris.join(", ") || "—"} prov="asbuilt" />
        <Field k="GPU busy / total" v={t("未取得（kit-manager 遙測待建）", "not available (kit-manager telemetry not built)")} prov="demo" />
      </div>
    )}
  </div>
</Panel>
```

  - 頁內加 state＋load（mount 一次＋沿用頁面既有刷新節奏即可）：`const [kit, setKit] = useState<KitInstanceState | null>(null); const [kitErr, setKitErr] = useState<string | null>(null);` ＋ `useEffect(() => { coordinatorClient.kitInstanceCurrent().then(setKit).catch((e) => setKitErr(String(e))); }, []);`
  - 保留「Live session aggregate」與 fleet-model 概念 Panel（設計層 asbuilt），GPU 欄照舊「未取得」。
- [ ] **Step 4: 測試通過＋`npm run verify`**。
- [ ] **Step 5: Commit** — `feat(instances): 真 Kit instance 遙測第一片，移除 edge-gpu demo 假節點`。

---

### Task 5: S5 — CoordinatorPage 監控彙總 v1

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`（`CoordinatorPage` :2335；在 `CoordinatorGovernanceTabs`（:2355）上方插入彙總 Panel）
- Test: `web-viewer-sample/src/console/CoordinatorPage.test.tsx`（新檔）

**Interfaces:**
- Consumes: Task 1 `leaseEvidence()`＋Task 4 `coordinatorClient.kitInstanceCurrent()`。

- [ ] **Step 1: 寫失敗測試** — mock runtimeStatus（兩 session：一 active 帶綠證據、一 queued）＋ kitInstanceCurrent（idle）→ 斷言 `data-testid="rt-monitor-summary"` 內含 `active 1`、`queued 1`、`kit idle`；kit 失敗態顯「未取得」。
- [ ] **Step 2: 跑測試確認失敗**。
- [ ] **Step 3: 實作** — 插入 Panel：

```tsx
<Panel title={t("監控彙總", "Monitoring summary")} prov="asbuilt"
  sub={t("session 證據與 Kit 狀態彙總；無統一 GPU 遙測，不畫 fail、不捏造秒數", "...")}>
  <div className="ec-grid" data-testid="rt-monitor-summary">
    <Field k="sessions" v={`active ${sessions.filter((s) => s.status === "active").length} · queued ${sessions.filter((s) => s.status === "queued" || s.status === "created").length}`} prov="asbuilt" />
    <Field k={t("證據齊備 session", "evidence-green sessions")} v={String(sessions.filter((s) => { const ev = leaseEvidence(s, Date.now()); return Boolean(ev.firstFrameAt && ev.datachannelReady && ev.stageMatch === true && ev.heartbeatStale === false); }).length)} prov="asbuilt" />
    <Field k="kit" v={kit ? `${kit.instance_id} · ${kit.status}` : t("未取得", "not observed")} prov={kit ? "asbuilt" : "demo"} />
    <Field k="GPU / VRAM" v={t("未取得", "not observed")} prov="demo" />
  </div>
</Panel>
```

（`sessions` 取自本頁既有 `rt`：`const sessions = rt?.sessions?.items ?? []`；kit state 同 Task 4 模式加載。）

- [ ] **Step 4: 測試通過＋`npm run verify`**。
- [ ] **Step 5: Commit** — `feat(runtime): CoordinatorPage 監控彙總 v1（#runtime 面）`。

---

### Task 6: S5 — 刪除孤兒 RuntimePage＋OperatorConsole（守衛式）

**已查證**：`RuntimePage`（pages.tsx:2407-2466）只被 `OperatorConsole.tsx:8,31` 引用；`OperatorConsole` 在 src 內無人 import（EdgeConsole 是唯一掛載殼層，main.tsx:40）；`#runtime`→CoordinatorPage（EdgeConsole.tsx:96）。

- [ ] **Step 1: GitNexus impact** — `impact({target: "RuntimePage", direction: "upstream"})` 與 `impact({target: "OperatorConsole", direction: "upstream"})`；若出現 EdgeConsole/main 之外的活引用→停，回報不刪。
- [ ] **Step 2: 刪除 / 測試同步** — 刪 `web-viewer-sample/src/console/OperatorConsole.tsx`、`OperatorConsole.test.tsx`；刪 pages.tsx 的 `RuntimePage` 函式（:2407-2466）。同步移除或改寫仍 import/render `RuntimePage` 的既有測試（例如 `console.test.tsx` runtime legacy assertions），使測試契約對齊 `#runtime→CoordinatorPage` 收斂後的新入口。`StreamConfigReader` 若只被 RuntimePage 用，一併查 impact 再決定去留（被 CoordinatorGovernanceTabs 共用則保留）。
- [ ] **Step 3: 驗證** — `npm run verify` 綠（vite build 含型別檢查會抓 dangling import）。
- [ ] **Step 4: `detect_changes`** — blast radius 只含預期符號。
- [ ] **Step 5: Commit** — `chore(console): 移除孤兒 RuntimePage/OperatorConsole（#runtime→CoordinatorPage 已收斂）`。

---

### Task 7: E2E evidence ＋ PR

- [ ] **Step 1: build:ui＋部署驗證** — `npm run build:ui`；依部署慣例重啟 coordinator 後開 `:8004/ui`。
- [ ] **Step 2: Playwright 截圖**（`npm run test:e2e` 或既有 e2e 慣例腳本）至少四張落 `artifacts/e2e/infra-slice/`：`#sessions` 證據三欄＋供應端（無 Kit 時「未取得」態即可）、`#minio` ObjectDetailPane coverage、`#instances` 真遙測（或未取得態）、`#runtime` 彙總。PNG 用 `git add -f`。
- [ ] **Step 3: spec 檔補實作狀態行** — 在 `docs/superpowers/specs/2026-07-07-infra-capability-contract-design.md` 變更紀錄表 additive 加一列（滿足 pr-review-agent missing_openspec：本 PR diff 須摸到 specs 檔）。
- [ ] **Step 4: 開 PR** — 標題 `feat(infra): 基礎設施本輪切片 S1–S5（Spec-0）`；body 依 changed paths 填 pr-review-agent 的 Frontend Verification 七列表格（逐字 label）；`gh pr merge --squash --auto --delete-branch`。
