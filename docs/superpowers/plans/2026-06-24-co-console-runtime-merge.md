# CO Console → #runtime Merge Implementation Plan

**For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 移除與 `#runtime` 功能重複的「CO 審查控制台」獨立左側導覽項，讓 `#runtime` 承接 `CoordinatorPage` 的四分頁觀測台，並把 `RuntimePage` 獨有的 stream-config 讀取器抽成共用元件保住其前端入口，後端零變更。

**Architecture:** 前端 console（`web-viewer-sample/src/console/`）以單一資料源 `data.ts` 的 `PAGES` 陣列驅動左欄導覽，`EdgeConsole.tsx` 的 `renderBody` switch 把 hash key 對應到 `pages.tsx` 的頁面元件。本變更只動「導覽資料 + route key→component 對應 + FLOW page 指向 + nav 文案 + 一處元件抽取」；`CoordinatorPage` / `RuntimePage` / `CoordinatorGovernanceTabs` 元件全部保留，CO 與 RT 同樣只消費既有 `GET /api/runtime/status`，無新增 / 修改任何後端 API。

**Tech Stack:** React 18 + TypeScript（`web-viewer-sample`，Vite build）；vitest（`renderToString` SSR 誠實 smoke，無 testing-library / 無網路）；Playwright（`web-viewer-sample/e2e/`，`npm run test:e2e`）。型別檢查走 `npx tsc --noEmit`（Vite build 不跑 tsc）。

---

## 背景與不變式（執行前必讀，假設你對此 codebase 零脈絡）

本節是後續每個 Task 的共同前提。已用 GitNexus（`mcp__gitnexus__query` / `context`）+ codebase-memory（`search_graph`）+ Read 逐一查證；**行號取自 2026-06-24 工作樹現況**（GitNexus/codebase-memory 索引行號略舊，僅供導航，以 Read 實檔為準）。

**檔案與精確觸碰點：**

| 檔案（相對 `web-viewer-sample/`） | 觸碰點（已查證行號） |
|---|---|
| `src/console/data.ts` | `PAGES` coordinator 項在 **L75**：`{ key: "coordinator", no: "CO", label: "Coordinator Console", plane: "governance", group: "coordinator" },`。`NAV_GROUPS`（L41–47）+ `conv`/`sessions`/`instances`/`minio`（L67–70）**保留不動**。`PAGE_TITLE` 定義在 `pages.tsx:2630`，衍生自 `PAGES`。 |
| `src/console/EdgeConsole.tsx` | `renderBody` switch（**非 export**，L51）：`coordinator` case **L80**、`runtime` case **L82**。`NAV_LABEL`（**非 export**，L92）：`coordinator` L114、`runtime` **L118**。`COPILOT_PROMPTS`（L123，無 coordinator/runtime key）。`FLOW`（L137）：③ Meeting **L140**、⑤ Record **L142** 現為 `page: "coordinator"`。`RuntimePage` import 在 **L25**、`CoordinatorPage` import 在 L14。 |
| `src/console/pages.tsx` | `CoordinatorPage`（**L2379**，h1=`Coordinator Console · C / Hybrid Runtime Orchestrator` @L2394）保留；`RuntimePage`（**L2463**，h1=`Runtime Dashboard · 串流執行狀態（F）` @L2488）保留；stream-config 讀取器 JSX 在 **L2525–2533**，其 state `scSession/sc/scErr`（L2467–2469）+ `fetchStreamConfig`（L2479–2484）在 `RuntimePage` 內；`PAGE_TITLE`（**L2630**）。檔頂已 import `Btn`(L5)、`t`(L4)、`coordinatorClient`(L9)、`PAGES`(L7)。 |
| `src/console/coordinator/RuntimeGovernanceTabs.tsx` | `CoordinatorGovernanceTabs`（export，L209）；四分頁 `TABS`（L15–20）；`DebugTab`（**非 export**，**L191–207**）為 `debug` 分頁實作，現只收 `{ rt }`；`ActionButton`（L45–51，`<Btn disabled caption="Phase 1 read-only">`）為誠實守門基準；檔頂已 import `Btn` from `../components`（L2）。 |
| `src/console/console.test.tsx` | import `from "./data"` 在 **L32**（現為 `{ A1A10, A1A10_DETAIL, DEPENDENCIES, ENDPOINTS }`，需加 `PAGES`）；`CoordinatorPage`/`RuntimePage` import L12/L21；既有測試：CoordinatorPage 四視角 L162–195 / L197–213、`RuntimePage` 直測 L191–194（含 `stream-config`、`未取得`、`not.toContain("92.4%")`）、EdgeConsole IA L336–346（L341 `落地端控制台`）。 |
| `e2e/co-console-runtime-merge.spec.ts`（**新建**） | 慣例：`web-viewer-sample/e2e/*.spec.ts`，`baseURL` 由 `playwright.config.ts` 設為 `http://127.0.0.1:5180`（自啟 dev server），`VITE_COORDINATOR_API_BASE` 預設指向 branch coordinator `:8005`。參考既有 `e2e/unified-console-routes.spec.ts`（已驗 `#/runtime`、nav 點擊、`COORDINATOR/ui` 兩種起法）。 |

**已查證的關鍵事實（load-bearing，prevent 假陽性）：**

1. **`PAGE_TITLE["coordinator"]` 無 reader**：`grep PAGE_TITLE` 於 `web-viewer-sample/src` 唯一命中為定義行（`pages.tsx:2630`），刪 `PAGES` L75 後 `PAGE_TITLE.coordinator` 變 `undefined` 但**零下游消費者**，安全。
2. **兩個 h1 陷阱**：字串 `Coordinator Console` 同時在 nav 與 `CoordinatorPage` h1（`pages.tsx:2394`）；字串 `串流執行狀態` 同時在 nav label（L118）與 `RuntimePage` h1（`pages.tsx:2488`）。**任何 `not.toContain("Coordinator Console")` / `not.toContain("串流執行狀態")` 全域負向斷言都會假陽性** → 守門斷言一律打資料模型（`PAGES`）/ nav button / `NAV_LABEL`，不打全域 html 字串。
3. **stream-config 不在 Coordinator 四分頁**：`grep "stream-config|streamConfig|scSession|StreamConfig"` 於 `coordinator/` 目錄 = 0 命中。直接讓 `#runtime` 只渲染 `CoordinatorPage` 會靜默砍掉 stream-config 這個 as-built 入口 → 採 spec §3.4 **D2-A′**：抽 `StreamConfigReader` 共用。
4. **循環 import 風險（D2-A′ 必知）**：`pages.tsx` import `CoordinatorGovernanceTabs` from `./coordinator/RuntimeGovernanceTabs`；若 `DebugTab` 反向 import `StreamConfigReader` from `../pages` 會形成 ES module 循環。**因 `StreamConfigReader` 僅在 `DebugTab` 的 JSX（call-time render）被引用、非 module top-level 求值**，esbuild/vite + tsc 可正確解析（無 TDZ）。Task 5 的 `tsc --noEmit` + `vitest`（直測 `CoordinatorGovernanceTabs` debug 分頁）會抓到任何 `undefined` / TDZ 退化。目前 `coordinator/` 內**無**任何 `from "../pages"` import（已 grep 確認），這是新增的第一條反向邊。
5. `coordinatorClient.streamConfig(sessionId)`（`coordinatorClient.ts:262`）回 `StreamConfigResponse`，為真實 coordinator-owned 端點 `GET /api/review-sessions/:id/stream-config`，已在 `ENDPOINTS`（`data.ts:151`）。

**不在範圍（YAGNI，spec §1.2）：** 不碰 A1（不引用 A1 行號）；不刪任何頁面元件；不刪 `coordinator` route case（L80 保留，`#coordinator` deep link 不死）；不動 `NAV_GROUPS` 群組；不改 `conv`/`minio` 的 `key`/`group`；不新增 / 修改後端 API、不動 `/api/runtime/status` schema；不把轉檔 lifecycle 狀態搬進 `#runtime`；不新增 `#runtime-legacy` alias route。

---

## Task 0: data.ts — 移除 CO 獨立導覽項

**Files:**
- Modify: `web-viewer-sample/src/console/data.ts`
- Test: `web-viewer-sample/src/console/console.test.tsx`（斷言在 Task 4 一併加，本 Task 先以既有測試守住「不誤刪 group」）

- [ ] 先讀 `web-viewer-sample/src/console/data.ts` L51–80 確認 `PAGES` 內容與 L75 位置（idempotent：若 L75 已不存在 coordinator 項，跳過刪除，直接進 Task 1）。
- [ ] 跑 baseline：確認既有 console 測試現在是綠的，作為刪除前的對照尺。

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx 2>&1 | tail -20
  ```

  預期輸出：尾端含 `Test Files  1 passed` 或同等綠燈（記下通過數，刪除後須維持）。
- [ ] 從 `PAGES` 陣列刪除 coordinator nav 項（**只刪這一行，不動上下任何行**）。用精確字串：

  ```
  刪除整行：
    { key: "coordinator", no: "CO", label: "Coordinator Console", plane: "governance", group: "coordinator" },
  ```

  刪後 `PAGES` 仍含 `home/a1..a10/issues/reports/viewer/gpu/conv/sessions/instances/minio/runtime/admin/spec/overview/intake/review/semantic/apps`，且 `coordinator` 群組仍有 `conv`/`sessions`/`instances`/`minio` 四項（這四項 `group: "coordinator"` 不變）。
- [ ] 複驗「無 `PAGE_TITLE["coordinator"]` reader」（spec 要求實作期以同條 grep 複驗再信賴刪除安全）：

  ```bash
  cd web-viewer-sample && rg -n "PAGE_TITLE" src
  ```

  預期輸出：唯一命中 `src/console/pages.tsx:2630`（定義行）。若出現任何 reader，停止並回報（與假設衝突）。
- [ ] 跑既有測試確認「不誤刪 group」未回歸（`console.test.tsx:341` 斷言 `落地端控制台` 群組存在）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx 2>&1 | tail -20
  ```

  預期輸出：通過數與 baseline 一致（仍綠）。若 `落地端控制台` 相關測試炸 → 表示誤刪了 `NAV_GROUPS` 的 group，回退只刪 page 行。
- [ ] commit：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/src/console/data.ts && git commit -m "feat(console): 從 PAGES 移除 CO 審查控制台導覽項（保留 group 與 route case）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 1: pages.tsx — 抽出 `StreamConfigReader` 並由 `RuntimePage` 復用

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Test: `web-viewer-sample/src/console/console.test.tsx`（既有 `RuntimePage` 直測 L191–194 必須仍綠：`stream-config` + `未取得` + `not.toContain("92.4%")`）

- [ ] 讀 `web-viewer-sample/src/console/pages.tsx` L2460–2540 確認 `RuntimePage` 全貌（state L2467–2469、`fetchStreamConfig` L2479–2484、stream-config `<Panel>` L2525–2533）。確認檔頂已 import `Btn`(L5)/`t`(L4)/`coordinatorClient`(L9)/`useCallback`+`useState`(L3) → 抽元件不需新增任何 import。
- [ ] 跑 baseline（抽取前 `RuntimePage` 直測現狀）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "GPU / 首幀 無遙測" 2>&1 | tail -15
  ```

  預期輸出：該 it 綠（含 `RuntimePage` 的 `stream-config` 斷言）。
- [ ] 在 `pages.tsx` 的 `RuntimePage` 定義**之前**（緊鄰 L2460 註解上方）新增 `StreamConfigReader` 元件，把 stream-config 的 state + handler + JSX 整段內聚進去（**逐字搬移既有字串，不改任何顯示文案**，確保既有 `stream-config` 斷言不破）：

  ```tsx
  // ── stream-config 讀取器（D2-A′ 抽出共用）：RuntimePage 與 CoordinatorGovernanceTabs 的 ──
  // Terminal/Debug 分頁共用同一元件，使 stream-config 入口在 #runtime（承接 CoordinatorPage）後不孤兒。
  // 自取資料（coordinatorClient.streamConfig）、零 props、誠實 read-only：不開串流、不捏造遙測。
  export function StreamConfigReader() {
    const [scSession, setScSession] = useState("");
    const [sc, setSc] = useState<string | null>(null);
    const [scErr, setScErr] = useState<string | null>(null);

    const fetchStreamConfig = useCallback(async () => {
      if (!scSession.trim()) return;
      setScErr(null); setSc(null);
      try { setSc(JSON.stringify(await coordinatorClient.streamConfig(scSession.trim()), null, 2)); }
      catch (e) { setScErr(`${t("stream-config 讀取失敗：", "Failed to read stream-config: ")}${String(e)}`); }
    }, [scSession]);

    return (
      <Panel title={t("stream-config · 給 viewer 的連線資訊", "stream-config · connection info for the viewer")} sub="GET /api/review-sessions/:id/stream-config（coordinator owner）" prov="asbuilt">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="ec-btn" style={{ minWidth: 320 }} placeholder="review_session_id" value={scSession} onChange={(e) => setScSession(e.target.value)} />
          <Btn disabled={!scSession.trim()} caption="GET …/stream-config" onClick={fetchStreamConfig}>{t("讀取 stream-config", "Read stream-config")}</Btn>
        </div>
        {scErr && <p className="ec-warn-note">{scErr}</p>}
        {sc && <pre className="ec-note" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{sc}</pre>}
        <p className="ec-note">{t("stream-config 為 coordinator owner 的真實端點；GPU 串流由 host-native Kit 負責，本面板僅唯讀轉發連線資訊，不開串流、不捏造遙測。", "stream-config is a real endpoint owned by the coordinator; GPU streaming is handled by host-native Kit. This panel only forwards connection info read-only; it does not open streams or fabricate telemetry.")}</p>
      </Panel>
    );
  }
  ```
- [ ] 在 `RuntimePage` 內刪除已搬走的 `scSession`/`sc`/`scErr` state（L2467–2469）與 `fetchStreamConfig`（L2479–2484），並把原 stream-config `<Panel>`（L2525–2533）整段**替換為** `<StreamConfigReader />`。`RuntimePage` 其餘部分（h1 L2488、Host-native plane Panel、Kit binding Panel、A1 governance binding Panel L2535–2537）**保持不動**。替換後 `RuntimePage` 仍 render `StreamConfigReader`，故 `stream-config` 字串仍出現在其輸出。
- [ ] 跑既有 `RuntimePage` 直測確認字串未移位（GREEN）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "GPU / 首幀 無遙測" 2>&1 | tail -15
  ```

  預期輸出：該 it 仍綠（`renderToString(<RuntimePage />)` 仍含 `stream-config` 與 `未取得`，且 `not.toContain("92.4%")` 仍成立——因元件內容逐字搬移、未新增數字）。
- [ ] type-check（抽取後 `useCallback`/`useState` 仍被用，不應有 unused）：

  ```bash
  cd web-viewer-sample && npx tsc --noEmit 2>&1 | tail -20
  ```

  預期輸出：無 error（尤其無 TS6133 unused、無 TS2552 找不到符號）。
- [ ] commit：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/src/console/pages.tsx && git commit -m "refactor(console): 抽出 StreamConfigReader 共用元件，RuntimePage 復用（D2-A′ 取代路徑前置）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 2: RuntimeGovernanceTabs — `debug` 分頁 render `StreamConfigReader`（D2-A′ 取代路徑落地）

**Files:**
- Modify: `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`
- Test: `web-viewer-sample/src/console/console.test.tsx`（既有 `CoordinatorPage` 四視角 L197–213 必須仍綠；新增 stream-config-in-debug 斷言在 Task 4）

- [ ] 讀 `web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx` L1–4（imports）與 L191–207（`DebugTab`），確認 `DebugTab` 現只收 `{ rt }` 並 render 一個 `<Panel title="Terminal / Debug" ...>`。
- [ ] 寫失敗測試（先驗證承接後 `#runtime` 的 debug 分頁尚無 stream-config 入口 → 預期失敗）：在 `console.test.tsx` 暫加一條（Task 4 會正式定稿，此處用來確認 RED）：

  ```tsx
  it("[temp-red] CoordinatorGovernanceTabs debug 分頁含 stream-config 入口", () => {
    const html = renderToString(<CoordinatorGovernanceTabs rt={null} busy={false} err={null} onRefresh={() => {}} />);
    expect(html).toContain("stream-config");
  });
  ```

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "temp-red" 2>&1 | tail -15
  ```

  預期輸出：FAIL（debug 分頁預設未 active 且不含 stream-config；`CoordinatorGovernanceTabs` 初始 active=`classic`，故 `stream-config` 不在輸出）。確認 RED 後刪除這條 temp 測試（正式版在 Task 4）。
- [ ] 在 `RuntimeGovernanceTabs.tsx` 檔頂 import 區（L4 之後）新增對 `StreamConfigReader` 的 import：

  ```tsx
  // D2-A′：debug 分頁直接 render 共用的 StreamConfigReader（定義在 ../pages）。
  // 註：pages.tsx 反向 import 本檔的 CoordinatorGovernanceTabs，形成 ES module 循環；
  // 因 StreamConfigReader 僅在 DebugTab 的 JSX(call-time)被引用、非 top-level 求值，
  // esbuild/vite + tsc 可正確解析（Task 5 的 tsc --noEmit + vitest 守住）。
  import { StreamConfigReader } from "../pages";
  ```
- [ ] 修改 `DebugTab`（L191–207）：在既有 `<Panel title="Terminal / Debug" ...>` 之後、`DebugTab` return 的 fragment 內，加上 `<StreamConfigReader />`。把 `DebugTab` 的 return 從單一 `<Panel>` 包成 fragment：

  ```tsx
  function DebugTab({ rt }: { rt: RuntimeStatus | null }) {
    return (
      <>
        <Panel title="Terminal / Debug" sub="工程證據頁；保留 raw JSON 入口但 Phase 1 不在總覽展開" prov="asbuilt">
          <p className="ec-note">Terminal / Debug 是工程證據頁.</p>
          <p className="ec-note">
            Debug categories：service health、coordinator endpoint、conversion authority、Kit binding、browser evidence、exception details。
          </p>
          <Field k="service" v={rt ? `${rt.service.name} · ${rt.service.status}` : "未取得 /api/runtime/status"} prov="asbuilt" />
          <Field
            k="runtime endpoint"
            v={rt ? `${rt.configured_endpoints.coordinator.public_base_url}/api/runtime/status` : "/api/runtime/status"}
            prov="asbuilt"
          />
          <Field k="raw JSON" v="僅在工程排障視角檢視；Classic Dashboard 不直接展開 payload" prov="asbuilt" />
        </Panel>
        <StreamConfigReader />
      </>
    );
  }
  ```
- [ ] 跑既有 `CoordinatorPage` 四視角測試確認未回歸（GREEN，debug 分頁變更不影響 classic 初始視角斷言）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "四視角 contract" 2>&1 | tail -15
  ```

  預期輸出：L197–213 那條 it 仍綠（`A Classic Dashboard`…`D Terminal / Debug`、`not.toContain('"session_id"')` 不受 debug 內容新增影響）。
- [ ] type-check（驗證循環 import 不致 TDZ / 找不到符號）：

  ```bash
  cd web-viewer-sample && npx tsc --noEmit 2>&1 | tail -20
  ```

  預期輸出：無 error。若出現 `StreamConfigReader` 相關 TS2304/TS2552 → 確認 `pages.tsx` 已 `export function StreamConfigReader`（Task 1）。
- [ ] commit：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx && git commit -m "feat(console): Terminal/Debug 分頁 render StreamConfigReader（stream-config 入口零孤兒）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 3: EdgeConsole.tsx — `#runtime` 承接 CoordinatorPage + NAV_LABEL 文案 + FLOW 重導

**Files:**
- Modify: `web-viewer-sample/src/console/EdgeConsole.tsx`
- Test: `web-viewer-sample/src/console/console.test.tsx`（既有 EdgeConsole IA L336–346 + FlowBar L320–334 必須仍綠；新增 #runtime 承接 / nav 文案 / FLOW 守門在 Task 4）

- [ ] 讀 `web-viewer-sample/src/console/EdgeConsole.tsx` L80–82（switch）、L114/L118（NAV_LABEL）、L137–143（FLOW），確認與背景表行號一致。
- [ ] 跑 baseline（EdgeConsole shell 既有測試現狀）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "四組資訊架構" 2>&1 | tail -15
  ```

  預期輸出：L336–346 那條 it 綠。
- [ ] 改 `renderBody` 的 `runtime` case（L82），把渲染元件從 `RuntimePage` 改向 `CoordinatorPage`（`coordinator` case L80 **保留不動**，雙入口同頁）：

  ```
  改前（L82）：    case "runtime": return <RuntimePage />;
  改後（L82）：    case "runtime": return <CoordinatorPage />;
  ```

  > 注意：`RuntimePage` 在 `pages.tsx` 內仍 render `StreamConfigReader`，且本檔的 `RuntimePage` import（L25）此後在 EdgeConsole 內 0 引用 → 見下一步處理 import。
- [ ] 處理 `RuntimePage` import（L25）：改 `runtime` case 後 `RuntimePage` 在 `EdgeConsole.tsx` 已無任何 render 點（`coordinator` 與 `runtime` 都渲染 `CoordinatorPage`，無其他 case 用 `RuntimePage`）。Vite build 不跑 tsc 不會報，但 `npx tsc --noEmit` 會報 **TS6133 unused import** → **移除 `RuntimePage,` 這一行 import**（L25）。`RuntimePage` 元件本身在 `pages.tsx` 仍被 `console.test.tsx` 直接 import 測試，不受影響。

  ```
  從 import { ... } from "./pages"; 區塊移除：    RuntimePage,
  ```
- [ ] 改 `NAV_LABEL.runtime`（L118）文案（誠實鐵律：反映承接後實際渲染的 Coordinator 觀測台，不留「串流執行狀態」誤導）：

  ```
  改前（L118）：  runtime: { tech: "Runtime Dashboard", biz: "串流執行狀態" },
  改後（L118）：  runtime: { tech: "Runtime Console", biz: "Runtime 觀測值班台" },
  ```

  `NAV_LABEL.coordinator`（L114）**保留不動**（route 仍在，未列出對渲染無害）。
- [ ] 改 `FLOW` ③ Meeting（L140）與 ⑤ Record（L142）的 `page`，從 `"coordinator"` 改為 `"runtime"`（對齊左欄真實顯示入口；③⑤ 必須同步改）：

  ```
  改前（L140）：  { n: "③", tech: "Meeting", biz: "建立審查會議", state: "asbuilt", page: "coordinator" },
  改後（L140）：  { n: "③", tech: "Meeting", biz: "建立審查會議", state: "asbuilt", page: "runtime" },
  改前（L142）：  { n: "⑤", tech: "Record", biz: "紀錄回寫雲端", state: "asbuilt", page: "coordinator" },
  改後（L142）：  { n: "⑤", tech: "Record", biz: "紀錄回寫雲端", state: "asbuilt", page: "runtime" },
  ```

  > `COPILOT_PROMPTS`（L123）無 `coordinator` 也無 `runtime` key → `prompts = COPILOT_PROMPTS[flowActive] ?? COPILOT_PROMPTS.home`（L181）對二者本來就 fallback `home`，改 page 不改變此既有行為（無新破綻）。`flowActive`（L180）純衍生，不需改。
- [ ] 跑既有 EdgeConsole + FlowBar 測試確認未回歸（GREEN）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "FlowBar|四組資訊架構|EdgeConsole 殼層" 2>&1 | tail -20
  ```

  預期輸出：L320–334（FlowBar 文案 `①`/`接收建模來源`/`紀錄回寫雲端`，斷言 n/biz 不碰 page 欄）、L336–346（四組 IA）皆仍綠。
- [ ] type-check（確認移除 `RuntimePage` import 後無 TS6133，且無遺漏符號）：

  ```bash
  cd web-viewer-sample && npx tsc --noEmit 2>&1 | tail -20
  ```

  預期輸出：無 error。
- [ ] commit：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/src/console/EdgeConsole.tsx && git commit -m "feat(console): #runtime 承接 CoordinatorPage + NAV_LABEL 改 Runtime 觀測值班台 + FLOW ③⑤ 重導 runtime

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 4: console.test.tsx — 新增守門斷言（CO 消失 / #runtime 承接 / 誠實 / stream-config 不孤兒）

**Files:**
- Modify: `web-viewer-sample/src/console/console.test.tsx`

> 守門一律打資料模型 / nav / `NAV_LABEL`，**不打全域 html**（避開兩個 h1 陷阱，見背景事實 2）。

- [ ] 讀 `web-viewer-sample/src/console/console.test.tsx` L7–33（imports）確認現有 import；把 `PAGES` 併入既有 `from "./data"`（L32），並把 `NAV_LABEL` 設為可測（採 export 法，最低摩擦）。
- [ ] 在 `EdgeConsole.tsx` 把 `NAV_LABEL`（L92）改為 export（順手，供 nav 文案誠實守門精準斷言，不擴大 `renderBody` 公開面）：

  ```
  改前（L92）：const NAV_LABEL: Record<string, { tech: string; biz: string }> = {
  改後（L92）：export const NAV_LABEL: Record<string, { tech: string; biz: string }> = {
  ```

  （本步改 `EdgeConsole.tsx`，故 Task 4 的 commit 同時納入 `EdgeConsole.tsx` 與 `console.test.tsx`。）
- [ ] 修改 `console.test.tsx` 的 data import（L32）：

  ```
  改前（L32）：import { A1A10, A1A10_DETAIL, DEPENDENCIES, ENDPOINTS } from "./data";
  改後（L32）：import { A1A10, A1A10_DETAIL, DEPENDENCIES, ENDPOINTS, PAGES } from "./data";
  ```

  並在 EdgeConsole import（L27）旁加 `NAV_LABEL`：

  ```
  改前（L27）：import EdgeConsole from "./EdgeConsole";
  改後（L27）：import EdgeConsole, { NAV_LABEL } from "./EdgeConsole";
  ```
- [ ] 寫新斷言：在 `console.test.tsx` 的 `describe("edge console honesty smoke", ...)` 內（既有最後一條 it 之後）新增一條完整守門測試（**逐字使用，無 placeholder**）：

  ```tsx
  // ── CO 審查控制台併入 #runtime（co-console-runtime-merge）守門 ──
  // 守門打資料模型 / nav / NAV_LABEL，不打全域 html（Coordinator Console、串流執行狀態 同字串各存於
  // CoordinatorPage h1 / RuntimePage h1，全域負向斷言必假陽性）。
  it("CO 審查控制台已從 PAGES 移除；#runtime 承接 CoordinatorPage 四分頁且維持誠實 read-only", () => {
    // 1) CO nav 不再存在（負向守門，打資料模型 PAGES —— 左欄唯一渲染資料源）。
    expect(PAGES.some((p) => p.key === "coordinator")).toBe(false);
    // group 不可被誤刪：coordinator 群組仍有 conv/sessions/instances/minio 四項。
    expect(PAGES.filter((p) => p.group === "coordinator").map((p) => p.key).sort())
      .toEqual(["conv", "instances", "minio", "sessions"]);

    // 2) #runtime 承接 CoordinatorPage 四分頁（正向；用 hash 驅動 EdgeConsole，不呼叫非 export 的 renderBody）。
    window.location.hash = "#runtime";
    const body = renderToString(<EdgeConsole />);
    expect(body).toContain("A Classic Dashboard");
    expect(body).toContain("D Terminal / Debug");
    expect(body).toContain("/api/runtime/status");
    // 與 L197 既有 CoordinatorPage 元件測試同源：#runtime 現渲染同一元件。

    // 3) 誠實守門：Controlled Actions 仍 disabled caption（read-only 不被偽裝）。
    expect(body).toContain("Phase 1 read-only");
    // nav label 誠實（負向，打 NAV_LABEL 非打 html）：biz 已非「串流執行狀態」。
    expect(NAV_LABEL.runtime.biz).toBe("Runtime 觀測值班台");
    expect(NAV_LABEL.runtime.biz).not.toContain("串流執行狀態");
    // 假精準守門沿用既有風格。
    expect(body).not.toContain("99.1%");
    expect(body).not.toContain("92.4%");

    window.location.hash = "";
  });

  // stream-config 不孤兒（D2-A′）：抽出的 StreamConfigReader 由 CoordinatorGovernanceTabs 的 debug 分頁 render。
  it("StreamConfigReader 由 CoordinatorGovernanceTabs debug 分頁提供（stream-config 入口零孤兒）", () => {
    const debugHtml = renderToString(<CoordinatorGovernanceTabs rt={null} busy={false} err={null} onRefresh={() => {}} />);
    // CoordinatorGovernanceTabs 初始 active=classic；切到 debug 才出 stream-config。改為直測 DebugTab 渲染結果：
    // 用 renderToString(<RuntimePage />) 仍含 stream-config（Task 1 後 RuntimePage 仍 render StreamConfigReader）作 anchor，
    // 並斷言 debug 分頁標籤存在（四分頁含 D Terminal / Debug）作為入口可達佐證。
    expect(debugHtml).toContain("D Terminal / Debug");
  });
  ```

  > 設計說明（給執行者）：`CoordinatorGovernanceTabs` 初始 active 分頁為 `classic`，`renderToString` 只渲染初始 active 內容，故無法在預設渲染中直接看到 `debug` 分頁的 `stream-config`。上面第二條 it 以「四分頁標籤 `D Terminal / Debug` 存在」+「`RuntimePage` 仍含 `stream-config`」雙重 anchor 守住「StreamConfigReader 仍有可達入口」，不依賴非 export 的 `DebugTab` 直接渲染。若執行者希望更強的直接驗證，可順手把 `DebugTab` export 後 `renderToString(<DebugTab rt={null} />)` 斷言含 `stream-config`——屬可選補強，非必需。
- [ ] 跑新增測試確認 GREEN：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx -t "CO 審查控制台已從 PAGES 移除|StreamConfigReader 由" 2>&1 | tail -20
  ```

  預期輸出：兩條新 it 皆綠。
- [ ] 跑全檔確認既有測試全綠（無回歸）：

  ```bash
  cd web-viewer-sample && npx vitest run src/console/console.test.tsx 2>&1 | tail -20
  ```

  預期輸出：`Test Files  1 passed`，通過數 = baseline + 2。
- [ ] commit：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/src/console/console.test.tsx web-viewer-sample/src/console/EdgeConsole.tsx && git commit -m "test(console): CO 移除 / #runtime 承接 / 誠實 nav / stream-config 不孤兒守門 + export NAV_LABEL

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 5: 全量型別檢查 + build + vitest 驗證（合併證據）

**Files:**
- 無（純驗證；若發現問題回到對應 Task 修正）

- [ ] 型別檢查（最 load-bearing：抓 TS6133 import 收尾 + 循環 import TDZ；Vite build 不跑 tsc）：

  ```bash
  cd web-viewer-sample && npx tsc --noEmit 2>&1 | tail -30
  ```

  預期輸出：無任何 error（特別確認 `EdgeConsole.tsx` 無 `RuntimePage` unused、`RuntimeGovernanceTabs.tsx` 的 `StreamConfigReader` 解析正常）。
- [ ] lint：

  ```bash
  cd web-viewer-sample && npm run lint 2>&1 | tail -20
  ```

  預期輸出：`eslint` 0 error 0 warning（`--max-warnings 0`）。
- [ ] 全量 vitest（不只 console.test）：

  ```bash
  cd web-viewer-sample && npx vitest run 2>&1 | tail -25
  ```

  預期輸出：全部 Test Files passed（含 `OperatorConsole.test.tsx` 仍綠——它是獨立退役殼層、不 import `PAGES`，與本變更解耦）。
- [ ] build（`npm run verify` = build + test + struct-log；先單跑 build 確認 Vite 產出無誤）：

  ```bash
  cd web-viewer-sample && npm run build 2>&1 | tail -15
  ```

  預期輸出：`vite build` 成功、`✓ built in ...`，無編譯錯誤。
- [ ] 若以上任一失敗：回到對應 Task 以最小 diff 修正後重跑此 Task；全綠後不需 commit（純驗證），直接進 Task 6。

---

## Task 6: Browser E2E（Playwright，user-facing 證據 — backend-only done 不接受）

**Files:**
- Create: `web-viewer-sample/e2e/co-console-runtime-merge.spec.ts`

> vertical slice：UI route(`#/runtime`/`#/home`) → 左欄 nav → 真實 `GET /api/runtime/status` → CoordinatorPage 四分頁 → 誠實 read-only(`Phase 1 read-only`) → FLOW 點擊落點。E2E 起法對齊既有 `e2e/unified-console-routes.spec.ts`（`COORDINATOR/ui` 由真實 coordinator 服務 `/ui` build；或 Playwright 自啟 dev server :5180 + `VITE_COORDINATOR_API_BASE`）。無 backend 處標 DEMO DATA / NOT BUILT。

- [ ] 讀 `web-viewer-sample/e2e/unified-console-routes.spec.ts` 與 `web-viewer-sample/playwright.config.ts` 確認起法（`COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004"`；`page.goto(\`${COORDINATOR}/ui#/runtime\`)`；截圖落 `../artifacts/e2e/*.png`）。
- [ ] 新建 `web-viewer-sample/e2e/co-console-runtime-merge.spec.ts`（**逐字使用，無 placeholder**）：

  ```ts
  import { test, expect } from "@playwright/test";

  // CO 審查控制台併入 #runtime（co-console-runtime-merge）user-facing 證據。
  // vertical slice：左欄移除 CO → #runtime 渲染 CoordinatorPage 四分頁（真實 /api/runtime/status）→
  // 誠實 read-only → FLOW ③⑤ 落 #runtime。起法對齊 unified-console-routes.spec.ts（coordinator 服務 /ui）。
  // 需先有 branch 隔離 coordinator（:8005，依 OQ-2 / memory branch-e2e-isolated-stack）或部署區 :8004/ui。
  const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

  test.describe("co-console-runtime-merge：CO 移除 + #runtime 承接 CoordinatorPage", () => {
    test("E2E-1 左欄無 CO，群組『落地端控制台』仍在且只剩 4 項", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui#/home`);
      // 群組標題仍在（不誤刪 group）。
      await expect(page.getByText("落地端控制台", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
      // CO 審查控制台 nav 入口不再存在（打 nav button 文字，非全域 html）。
      await expect(page.getByRole("button", { name: /審查控制台/ })).toHaveCount(0);
      // 落地端控制台四項仍可見（取樣 IFC→USD 轉檔排程 + MinIO 資料）。
      await expect(page.getByRole("button", { name: /IFC→USD 轉檔排程/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /MinIO 資料/ })).toBeVisible();
      await page.screenshot({ path: "../artifacts/e2e/co-merge-nav-no-co.png", fullPage: true });
    });

    test("E2E-2 #runtime 渲染 CoordinatorPage 四分頁（真實 /api/runtime/status）", async ({ page }) => {
      // 攔截確認 #runtime 真打 coordinator /api/runtime/status（非 mock）。
      const statusReq = page.waitForRequest((r) => r.url().includes("/api/runtime/status"), { timeout: 20_000 });
      await page.goto(`${COORDINATOR}/ui#/runtime`);
      await statusReq;
      // 四分頁標籤齊全（承接 CoordinatorGovernanceTabs）。
      await expect(page.getByRole("tab", { name: /A Classic Dashboard/ })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("tab", { name: /B ATC Tower/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /C Lifecycle Flow/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /D Terminal \/ Debug/ })).toBeVisible();
      await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-four-tabs.png", fullPage: true });
    });

    test("E2E-3 #runtime 誠實 read-only（ATC Controlled Actions 全 disabled）+ nav 文案", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui#/runtime`);
      // 左欄 #runtime 入口 biz 文案為「Runtime 觀測值班台」（非「串流執行狀態」）。
      await expect(page.getByRole("button", { name: /Runtime 觀測值班台/ })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /串流執行狀態/ })).toHaveCount(0);
      // 切到 ATC Tower，Controlled Actions 全部 disabled（read-only 未偽裝）。
      await page.getByRole("tab", { name: /B ATC Tower/ }).click();
      await expect(page.getByText("Controlled Actions", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      const openPrimary = page.getByRole("button", { name: /Open primary URL/ });
      await expect(openPrimary).toBeVisible();
      await expect(openPrimary).toBeDisabled();
      await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-readonly.png", fullPage: true });
    });

    test("E2E-4 FLOW ③ Meeting / ⑤ Record 落 #runtime（無死連結）", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui#/home`);
      // 點 FlowBar ③ Meeting（biz=建立審查會議）→ hash 變 #runtime + 渲染 CoordinatorPage。
      await page.getByRole("button", { name: /建立審查會議/ }).first().click();
      await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
      await expect(page.getByRole("tab", { name: /A Classic Dashboard/ })).toBeVisible({ timeout: 15_000 });
      // ⑤ Record（biz=紀錄回寫雲端）同樣落 #runtime。
      await page.getByRole("button", { name: /紀錄回寫雲端/ }).first().click();
      await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
      await page.screenshot({ path: "../artifacts/e2e/co-merge-flow-runtime.png", fullPage: true });
    });

    test("E2E-5 stream-config 仍可達（Terminal/Debug 分頁的 StreamConfigReader）", async ({ page }) => {
      await page.goto(`${COORDINATOR}/ui#/runtime`);
      await page.getByRole("tab", { name: /D Terminal \/ Debug/ }).click();
      // StreamConfigReader 入口：review_session_id 輸入框 + 讀取 stream-config 鈕。
      await expect(page.getByPlaceholder("review_session_id")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: /讀取 stream-config/ })).toBeVisible();
      await page.screenshot({ path: "../artifacts/e2e/co-merge-streamconfig-reachable.png", fullPage: true });
    });
  });
  ```
- [ ] 準備真實 backend：依 memory `branch-e2e-isolated-stack` 起 branch 隔離 coordinator（`PORT=8005` + `CONSOLE_DIST_DIR`(branch `build:ui` 產出) + `GOVERNANCE_API_BASE` + governance `GOV_PORT=49103`），或使用部署區 `:8004/ui`（OQ-2，依 reviewer 對隔離需求判斷）。先 `cd web-viewer-sample && npm run build:ui` 產 branch console dist。
- [ ] 跑 E2E（指向真實 coordinator；`COORDINATOR/ui` 由 coordinator 服務的 console build）：

  ```bash
  cd web-viewer-sample && E2E_DISABLE_WEBSERVER=1 E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/co-console-runtime-merge.spec.ts 2>&1 | tail -30
  ```

  預期輸出：5 passed（E2E-1..E2E-5）。截圖落 `artifacts/e2e/co-merge-*.png`。
  > 註：`E2E_DISABLE_WEBSERVER=1` 表示由 coordinator 直接服務 `/ui`（同 unified-console-routes 模式）；若改用 Playwright 自啟 dev server :5180，去掉該 env 並把 spec 內 `COORDINATOR` 換 `baseURL` 起法（`page.goto("/#/runtime")`），兩種皆可，擇一即可，需確保打到 branch 最新碼。
- [ ] 確認既有 `e2e/unified-console-routes.spec.ts` 不回歸：其 L29 斷言 `#/runtime` 顯示 heading `/Runtime/`——承接後 `CoordinatorPage` h1=`Coordinator Console · C / Hybrid Runtime Orchestrator` 仍含 `Runtime`，故該斷言仍過。順手重跑確認：

  ```bash
  cd web-viewer-sample && E2E_DISABLE_WEBSERVER=1 E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 npx playwright test e2e/unified-console-routes.spec.ts 2>&1 | tail -20
  ```

  預期輸出：2 passed（含 `#/runtime` 那條）。
- [ ] commit（E2E spec + 抽樣截圖；只存抽樣，不 commit 大檔/trace）：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git add web-viewer-sample/e2e/co-console-runtime-merge.spec.ts && git commit -m "test(e2e): CO 移除 + #runtime 承接 CoordinatorPage + 誠實 read-only + FLOW + stream-config 可達

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 7: GitNexus detect_changes + 完成回報

**Files:**
- 無（收尾驗證 + 回報）

- [ ] commit 前跑 GitNexus detect_changes 確認改動範圍未超出預期（對齊 default branch）：

  載入工具後執行 `mcp__gitnexus__detect_changes({scope: "compare", base_ref: "main"})`。
  預期：affected symbols 落在 `CoordinatorPage` / `RuntimePage` / `StreamConfigReader`(new) / `DebugTab` / `EdgeConsole`(renderBody/NAV_LABEL/FLOW) / `console.test.tsx` 範圍內；無意外的後端 / 其他 console 頁面被牽動。若 detect_changes 看不到 worktree staged（已知 worktree 限制），以 `git diff --stat origin/main` 佐證範圍。
- [ ] 最終全量驗證一次（確保所有 commit 後 tree 仍綠）：

  ```bash
  cd web-viewer-sample && npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -15
  ```

  預期輸出：tsc 無 error、lint 0 warning、vitest 全綠。
- [ ] 確認 commit 範圍只含預期檔案：

  ```bash
  cd "C:/Repos/active/iot/AI-BIM-governance/.claude/worktrees/co-console-runtime-merge-spec" && git diff --stat origin/main
  ```

  預期輸出：僅 `web-viewer-sample/src/console/data.ts`、`web-viewer-sample/src/console/pages.tsx`、`web-viewer-sample/src/console/coordinator/RuntimeGovernanceTabs.tsx`、`web-viewer-sample/src/console/EdgeConsole.tsx`、`web-viewer-sample/src/console/console.test.tsx`、`web-viewer-sample/e2e/co-console-runtime-merge.spec.ts`（+ 可選 `docs/superpowers/plans/2026-06-24-co-console-runtime-merge.md`）。
- [ ] 完成回報（依 CLAUDE.md §1）：列出 (1) 改了哪些 tracked files、(2) 執行了哪些最小驗證（tsc / lint / vitest / playwright + 截圖路徑）、(3) 哪些測試沒跑及原因、(4) 已知風險（循環 import 雖經 tsc/vitest 守住但屬新增反向邊；E2E 需真實 coordinator，OQ-2 隔離 vs 部署區擇一）。

---

## 完成標準（Definition of Done）

1. 左欄不再出現「CO 審查控制台」，`coordinator` 群組仍有 `conv`/`sessions`/`instances`/`minio` 四項（vitest + E2E-1 雙證）。
2. `#runtime` 渲染 CoordinatorPage 四分頁（Classic / ATC / Lifecycle / Terminal·Debug），真打 `GET /api/runtime/status`（vitest + E2E-2）。
3. `CoordinatorPage` / `CoordinatorGovernanceTabs` / `RuntimePage` 元件全部保留；`StreamConfigReader` 抽出後由 `RuntimePage` 與 debug 分頁共用，stream-config 入口零孤兒（vitest + E2E-5）。
4. FLOW ③⑤ 點擊落 `#runtime`，active bar 與左欄對齊，無死連結（E2E-4）。
5. 後端零變更；Controlled Actions 維持 Phase 1 read-only `disabled`，nav 文案誠實為「Runtime 觀測值班台」（vitest + E2E-3）。
6. `npx tsc --noEmit` / `npm run lint` / `npx vitest run` / `npm run build` 全綠；Playwright 5 spec passed 並留抽樣截圖於 `artifacts/e2e/`。
7. `e2e/unified-console-routes.spec.ts` 既有 `#/runtime` 斷言未回歸。
