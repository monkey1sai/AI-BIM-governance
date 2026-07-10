# AI-BIM Governance — 前端對齊 Design System · 保留既有後端 · 實作手冊

> **v1.1 · 2026-07-02**：`#a1` 規格改版（D10：選檔雙來源／BcfReviewPanel／A1BridgeRail）、`#sessions` 新增 A1BridgeSupplyPanel、`#minio` 更新為真 MinIO raw-folder；其餘逐字保留。

> **一句話定位**：這是「把 repo 前端對齊 `AI-BIM Governance Design System`、同時**完全不動既有後端**」的**唯一可執行計畫**。每條路由都給：要採用的 DS 視覺 → 必須保留的真實後端 API → 有序 AI-coding 任務 → 改哪幾個檔 → Playwright 驗收 → Prov 誠實規則。
>
> **本手冊是「怎麼做（HOW / 可執行）」層**，不是需求/行為權威。需求看互動規格、狀態裁決看對齊矩陣、紀律看技術債防線。
>
> **誠實第一**：標 NOT BUILT 的頁面，任何任務不得把它寫成「已交付 / 顯示真實資料」；不得提供假按鈕；缺遙測標「未取得」不畫綠燈。
>
> v1.0 · 2026-06-23 · 來源：DS repo（`C:\Repos\design\AI-BIM Governance Design System`）+ repo 前端（`web-viewer-sample/src/console/`）+ 後端三服務實掃 + 對抗複驗（零幻覺 API / 後端保留=TRUE / AI 可執行=TRUE）。

---

## §0 效力定位（衝突裁決）

```
使用者最新明確指令
  > 互動實作規格與標準對齊.md（行為合約 / 正典路由 22 條 / 官方對齊）—— 最高效力
  > 開發軌跡與執行計畫.md（順序 / 里程碑 / DoD）
  > 設計規格.md（介面 / token / A1–A10 介面分析）
  > 本手冊（前端對齊 DS 的可執行任務層）── 不取代上列，只把它們落成 per-route 任務
平行補充層：實作紀律與技術債防線.md（HOW 紀律）/ design-system 對齊矩陣.md（三方對照 + A1–A10 狀態唯一裁決）
程式碼權威覆寫：repo 實作與 tests/ 為行為真相；docs 不得當行為權威
```

- **路由正典**只有一份：對齊矩陣 §2 / 互動規格 PART A「A.1.1 正典路由表（22 條）」。本手冊**不重新維護路由表**，只在 §5 為每條路由補「可執行對齊規格」。
- **A1–A10 功能狀態裁決**只有一份：對齊矩陣 §4.4。本手冊 §5 的 built / NOT BUILT 標記一律服從該裁決。
- **Prov 映射**只有一份：對齊矩陣 §4.3 / §6。本手冊 §4 引用，不另立新映射。
- **token 數值真相**：DS 端 `styles.css` / repo 端 `web-viewer-sample/src/console/edge-console.css`。本手冊列對照與動作，不另定 px。

---

## §1 後端凍結面契約（BACKEND PRESERVATION CONTRACT — 抬頭必讀）

> **本輪是「frontend-only 對齊」。下列任何一條被違反 = 做錯，必須 revert。** 對抗複驗已確認：依本契約執行，無任一頁任務會迫使後端契約改動。

1. **拓樸凍結**：前端**只能打 coordinator `127.0.0.1:8004`**。**永遠不得**新增對 governance-service `:49102`、streaming-server `:49101`、kit-manager `:8010` 的直連。一切走 `/api/governance/*`、`/api/dev/conversions*`、`/api/kit/*`、`/api/external/*` proxy。
2. **proxy 路徑字串 byte-identical（不得改名）**：
   `POST /api/governance/rule-runs`、`/api/governance/rule-runs/for-session/:sessionId`、`/results`、`/failures`、`/export`；`/api/governance/diffs*`（create / `:diffId` / `/items` / `/apply-overlay` / `/issue-impact`）；`/api/governance/federated-sets*`（create / `:setId/members` / `/validate-coords` / `/build` / `/review-room`）；`/api/governance/issues*`（create / list / `:issueId/transition` / `from-rule-run/:runId` / `from-diff/:diffId`）；`/api/governance/bcf/export`；`/api/governance/files/tree`；`/api/governance/element-mapping/for-session/:sessionId`。
3. **轉檔 dev proxy 路徑凍結**：`/api/dev/conversions`（GET/POST）、`/api/dev/conversions/:jobId`、`/:jobId/result`、`/api/dev/conversions/mock`。coordinator 會改寫到 streaming-server `/api/conversions*`，**不得改名**。
4. **`/ui/open?session=...` 凍結 handoff（RK6 CRITICAL）**：必須保留 302→viewer redirect、session-id regex `^(lwv_|review_session_)[A-Za-z0-9_]+$`，且必須註冊在 `/ui` SPA fallback **之前**；**禁止**任何 catch-all 吃掉 `/ui/open` 或 `/ui/console`。React console 由 `/ui` 與 `/ui/*` SPA fallback 提供。
5. **`apply-overlay` 故意回 501**：`POST /api/governance/diffs/:id/apply-overlay` 是 **by design 501**（overlay 走 client `highlightPrimsRequest`，非 server-push）。前端**不得**把它接到「真實後端 overlay」當缺功能補；維持 `p15`。
6. **誠實資料契約不動**：A1 `RuleResult` / A2 `DiffItem` 的 `usd_prim_path` 未映射時為 `null`（**禁捏造**）；semantics endpoint 的 `classification` / `geometry` 維持 `null` + `roadmap[]`；`coverage_ratio==1` 在 `usd_stage_enumeration` 下是**結構性自我參照**——前端**可重新標註說明**，但**不得改後端數值**；`source_kind`（`local_fs` vs `s3`）是 UI 用來判斷檔案來源的誠實標記。
7. **穩定 enum（逐字 echo，禁自創）**：`change_type`（added/removed/moved/geometry_changed/property_changed）；issue `status`（open/assigned/in_progress/resolved/rejected/reopened）；`severity`（low/medium/high/critical）；conversion `status`（queued/running/succeeded/succeeded_with_warnings/failed/cancelled）；session `status`（queued/active/closing/closed）；ifc-ready job status；`KitInstance.status`。`ifc_guid` 是 BCF/governance 永遠存在的主鍵。
8. **rule-run export 只支援 `?fmt=excel`**（`fmt=bcf` → 400）。**BCF 匯出是獨立 endpoint**（`/api/governance/bcf/export` → `.bcfzip`），且**只有在用 `from-rule-run`/`from-diff` 建立 issues 之後**才可用。BCF gating UI 必須誠實呈現這個兩步流程。
9. **control-plane 授權不動**：`prioritize`/`retry`/`watch`/`trigger`（`POST /api/conversion/trigger`，2026-07-10 認列既有實作）是 IP-allowlist gated 且 audited（trigger 另有 IntentDialog 確認＋idempotency）；`/close` **故意不 gate**（cooperative/operator 雙語意，IX-SS-04）；Kit `open`/`close` 需 `x-dev-token`。前端**不得**假設這些是公開/匿名，也**不得**移除目前送出的 auth header。
10. **權威歸屬凍結**：coordinator 對 project/artifact metadata **只是 reference，非資料權威**。轉檔 artifact / `quality_metrics` / lineage 仍從 streaming-server（經 proxy）讀；rule/diff/issue 權威仍在 governance-service（經 proxy）。**不得**把權威搬進前端或 coordinator。
11. **回應 envelope key 是載重結構（不得 flatten/改名）**：list 用 `{items,count}`（conversions、ifc-ready）或 `{issues}`/`{projects}`/`{results}`/`{items}`；failures 用 `{items,total,limit,offset}`。
12. **DO-NOT-RE-ADD（2026-05-21 已退役）**：socket 協作 server-push（`highlightRequest`/`selectionUpdate`/`annotationCreate`、`getReviewIssues`、`createAnnotation`、`/api/model-versions/:id/review-bootstrap`）。只剩 `/events` 與 `/lifecycle-events`。**禁改的後端檔**：governance-service（`app.py`、`diff_engine/api.py`、`federation/api.py`、`issues/api.py`、`bcf/api.py`、`file_library/api.py`）、coordinator（`src/app.ts`、`src/routes/governanceProxy.ts`）、streaming `conversion_authority.py`。
13. **加性慣例（2026-07-10，R6 止血線）**：新增 coordinator 端點一律進 `src/routes/*.ts`（沿 `governanceProxy.ts` 先例，`app.ts` 僅允許一行 mount）；新增 governance 端點一律進所屬 domain 的 `api.py`（rule-run 面進 `rule_engine/api.py`）。**禁止再向 `app.ts`／`app.py` 巨石 append**；既有巨石拆分屬待人類簽核的獨立決策，不在本條範圍。

### 1.1 Approved Backend-Freeze Exceptions

本表只記錄已被後續設計明確批准的例外；不得外推成 §1 全面放寬。新增任一例外都必須更新本表並列 Requirement source。

| 日期 | 例外 | Requirement source | 邊界 |
|---|---|---|---|
| 2026-07-08 | 新增 A1 for-ifc-ready rule-run proxy：`/api/governance/rule-runs/for-ifc-ready/:jobId` | `docs/superpowers/specs/2026-07-08-a1-minio-downloaded-rule-run-design.md` | 僅服務 A1 v2 從 ifc-ready job 對應已下載 IFC 執行 rule-run；不允許改名既有 proxy、不允許新增租戶/host/path 語意、不允許把 A1 選檔改成轉檔觸發器。 |
| 2026-07-09（2026-07-10 追認） | `GET /api/governance/rule-runs`（history 清單）＋ `source_metadata` 持久化（commit `4949b9b`，動 `governanceProxy.ts`／`app.py`／`db.py`） | `docs/superpowers/plans/2026-07-09-a1-minio-worktree-conflict-resolution.md`＋`docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R3 | 唯讀 history proxy＋additive metadata 欄；不改名既有 proxy、不洩漏 host path/secret、不改變 rule-run 建立語意。 |
| 2026-07-09（2026-07-10 追認） | `POST /api/external/ifc-ready/:jobId/review-session`＋A1 inline viewer（`mode="a1-inline"`，PR #319） | PR #319＋`docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R1（IX-3D-01 v2.1 修訂） | 僅 A1 工作台、evidence-gated＋手動啟動；其他 console 頁仍禁內嵌 WebRTC；不改 `/ui/open` 凍結 handoff。 |
| 2026-07-10（預簽） | `governance-service/app.py` `export_rule_run` cache-miss 改由 DB 重建（`_RUN_CACHE` miss → `store.get_run`＋`get_results`） | `docs/superpowers/specs/2026-07-10-plans-code-remediation-design.md` R6（bug fix，行為僅「409→成功匯出」） | 僅此函式；不動其他 app.py 端點；匯出格式與 `?fmt=excel` 契約不變。 |

---

## §2 Token 對齊層

> **單一真相規則**：repo 的 token 入口是 `web-viewer-sample/src/console/edge-console.css` 的 `.ec-root --ec-*`。**不得**在 repo 內另建一套 `styles.css` token；DS 的 `styles.css` 是外部設計來源，作為值對照，不直接 import。
> 動作分類：`already-aligned`（角色已對應、保留現值）/ `add var`（補命名 token）/ `decision-needed`（視覺改動須人類點頭，見 §8）。

### 2.1 顏色（多數已對齊，保留現值不要 churn）

| DS token（值） | repo `--ec-*`（現值） | 動作 |
|---|---|---|
| `--bg #0c0f11` 頁底 | `--ec-bg #0b0d10` | already-aligned；可加註解橋接，不改名 |
| `--surface #13181b` 卡底 | `--ec-panel #181c21` | already-aligned（視為 DS `--surface`） |
| `--surface-2 #1a2024` 巢狀/輸入/MetricCard | `--ec-bg-2 #111418` / `--ec-bg-3 #15191e` | add alias `--ec-surface-2`（= `--ec-bg-3`）供 MetricCard/input |
| `--raised #222a2f` hover/抬升 | `--ec-bg-3 #15191e` | already-aligned |
| `--c-panel-hi #232c32` Panel header 頂光 | `--ec-panel-hi #1d2329` | already-aligned |
| `--line .08` / `--line-2 .14` hairline | `--ec-line #262c33` / `--ec-line-2 #2f363f` | already-aligned（repo 用 solid hex，保留） |
| text ramp `--text/-2/-3/-4` | `--ec-fg #e7ebf0` / `-2` / `-3` / `-4` | already-aligned |
| `--accent/--ok #84c714`（DS 亮版 NVIDIA 綠） | `--ec-grn #76b900`（正統 NVIDIA 綠） | **decision-needed**（見 §8 Q1）；預設保留 `#76b900` |
| `--accent-soft .14` / `--accent-ring .32` | `--ec-grn-2` / `--ec-grn-3` | already-aligned；focus/glow ring 用 `--ec-grn-3` |
| `--on-accent #0b0f06`（綠底上的字） | （無） | **add var** `--ec-on-grn:#0b0f06`（primary Button 字/icon 對比） |
| `--info/--prov-artifact #46c7e6`（CORE plane/artifact） | `--ec-cyan #4dd0e1` | already-aligned |
| `--warn/--prov-demo #f2b43b` | `--ec-amb #f4b740` | already-aligned |
| `--err #f0635f` | `--ec-red #ef5350` | already-aligned |
| `--ai/--prov-ai #9a8cff`（AI plane/ai prov/disabled 邊框） | `--ec-vio #b388ff` | already-aligned |
| `--prov-todo` 灰 | （**無對應**） | **不要加**：repo Prov 無 `todo` 值，未建用 `p3`/`p4`（見 §4） |
| light `.theme-docs`（藍 `#2563eb` 全套） | （無；console 純暗色） | **skip**（見 §8 Q3） |

### 2.2 排版 / 間距 / 圓角 / 陰影 / 動效（最大缺口＝沒有命名 token tier）

| DS token | repo 現況 | 動作 |
|---|---|---|
| `--font-sans`（Plus Jakarta Sans + Noto Sans TC，body/label 用） | 無（`--ec-mono` 全域 13px/1.5） | **decision-needed**（見 §8 Q2）：建議 add `--ec-sans` 套 body/nav/heading，mono 留給 code/ID/port/metric |
| `--font-mono`（JetBrains Mono） | `--ec-mono: ui-monospace,Cascadia Code,Consolas` | already-aligned（可把 JetBrains Mono 放 stack 頭） |
| type scale `--fs-page 27 / -h2 21 / -h3 16 / -body 15 / -sm 13 / -xs 12 / -mono 11 / -mono-sm 9.5` | 無（inline 字面值：h1 19、panel 13、note 11…） | **add vars** `--ec-fs-*` 進 `.ec-root`，逐頁取代 inline font-size（最大 token 缺口） |
| weight/line-height/tracking（`--track-label .12em`、`--track-tag .06em`） | 無（少量 inline letter-spacing） | **add vars** `--ec-track-label/-tag` + line-height token；套 `.label`/mono key/ProvTag（低風險） |
| spacing scale `--sp-1..-12`（4px base：4/8/12/16/20/24/32/40/48） | 無（inline `padding:18px 22px` 等） | **add vars** `--ec-sp-1..-12`；逐頁把 `style={{gap/padding}}` 換 token class（系統性缺口） |
| `--pad-card 16 / --pad-page 30 / --content-max 1080` | inline `.ec-main padding:18px 22px` 等 | **add vars** `--ec-pad-card/-page/-content-max`，調和現有字面值 |
| radius `--radius-xs 6 / -sm 10 / --radius 14 / -pill 999` | 無（inline 6px；卡片約 6px） | **add vars**；DS 正典卡片 14px 是**可見改動**（見 §8 Q5），逐元件套 + 截圖比對 |
| shadow `--shadow-1/-2` / `--glow-accent (0 0 8px ring)` | 無（inline box-shadow，如 nav active `inset 3px 0 0`） | **add vars** `--ec-shadow-1/-2` + `--ec-glow-grn`；換掉 inline LED/active 陰影，並補一個真正的 focus-ring token（a11y 缺口） |
| motion `--ease cubic-bezier(.4,0,.2,1)` / `--dur-fast .13 / --dur .2 / --dur-slow .3` | 無顯式 | **add vars** `--ec-ease/-dur*`；用於 page fade-up（~0.28s）、hover、LED pulse；遵守 `prefers-reduced-motion` |

---

## §3 元件對齊層

> repo 元件入口：`web-viewer-sample/src/console/components.tsx`（Btn / Panel / Metric / Field / HealthChip / ProvTag / ProvLegend…）+ `EdgeConsole.tsx`（NAV / Chat rail）+ `edge-console.css`（`.ec-status-dot` 等）。
> **原則：compose / refactor，不要 rebuild。** repo 元件帶**領域契約**（如 Btn 的 caption + prov micro-label + testid），比 DS 通用元件更嚴格——保留契約、只換視覺。

| DS 元件 | repo 對應 | 狀態 | 動作 |
|---|---|---|---|
| **ProvTag** | `components.tsx` ProvTag + ProvLegend（`data.ts` PROV_LABEL/PROV_CLASS，**7 值**） | **custom（更強）** | **直接沿用**——它就是誠實系統，比 DS 5 級更細。只把 chip 視覺對齊 DS（mono 9.5px、leading dot、demo/p3/p4 虛線）；**保留 7 值、保留 ProvLegend、永不加 `todo`** |
| **Panel** | `components.tsx` Panel | partial | refactor：採 DS 頂光 header（`--ec-panel-hi` 漸層）+ 未建區塊用紅斜線 phase header；保留 prov-tag slot。**主容器，refactor 一次全站受惠** |
| **Card** | Panel + AppCard（`.ec-appcard`） | partial | refactor：採 DS Card 圓角 14px + hairline + hover-lift（`--ec-shadow-1`）；AppCard 當 clickable Card variant |
| **Button** | `components.tsx` Btn（強制 caption + 選用 prov + primary/disabled/title/testid） | partial | refactor：**保留領域契約**（caption + prov micro-label + testid），加 DS variant（primary hover 提亮 / ghost / danger）+ size scale + disabled 紫虛線；**保留 disabled=誠實 caption** |
| **MetricCard** | `components.tsx` Metric（`{value,label,tone:'warn'|'bad'}`） | partial | refactor 成 DS MetricCard（mono label / 大 tabular value / unit / note）。注意：`tone` 只收 `'warn'|'bad'`（無 `'good'`，tone='good' 會 TS2322）；預設無 tone = 綠值，**不要加 'good'** |
| **NavItem** | `EdgeConsole.tsx` NAV_GROUPS sidebar rows（inline） | partial | 抽成 NavItem 元件：code chip + label + badge + plane 左色條（core=cyan/omni=green/ai=violet）用 `--ec-glow/--ec-line`；**保留現有 hash-route 接線（usePageHash）** |
| **StatusLED** | `edge-console.css .ec-status-dot`（ok/warn/bad，inline） | partial | 抽成 StatusLED 元件（tone ok/warn/err/idle + `--ec-glow-grn` glow + live pulse + 選用 label）；**idle=無 glow 給「未取得」**；repo `'bad'`→`err` |
| **Stepper** | FlowBar/LifecycleStrip（Intake→Convert→Meeting→Mark→Record）+ a1Machine 5 步 | **custom** | refactor FlowBar 成 DS Stepper 視覺（24px 圓點、✓ done、current glow ring、→ 箭頭）；**state 由 `a1Machine.ts` 驅動，非 timer** |
| **HealthChip** | `components.tsx` HealthChip（`{name,state,prov}`） | partial | refactor：加 DS LED-dot + tone（ok/warn/err/idle）+ idle「未取得」（**永不假綠**）；保留 prov-tagged 簽名 |
| **ChatToolCall** | `EdgeConsole.tsx` Chat USD Agent rail（僅預覽殼） | partial | refactor 成 DS ChatToolCall 視覺（左紫 2px 邊、status dot、mono tool name、Nms），但**保持誠實**：A9 後端 NOT BUILT（p4）——input disabled、rail 標 `ROADMAP·A9`，**無假 tool call** |
| **Badge** | severity/status chip + 零散 span（無專屬 Badge） | **missing** | **build** 小 Badge（tone neutral/accent/info/warn/err/ai + dashed）給 code/count/HTTP method/severity，讀 `--ec-*` |
| **Pill** | header context inline（`EdgeConsole.tsx` top bar） | **missing** | **build** Pill（project/version/phase 切換器）給 top bar；接現有 `#version-diff` selector 資料，**不捏假 dropdown** |
| **LangToggle** | （無；repo 是 用語 操作員/技術 + 情境 toggle，非 zh/EN） | **missing** | **skip**（除非 i18n 入本輪範疇，見 §8 Q4）；repo 字串 zh 為主、無 `AIBIM.tt` runtime；**不要做一個沒功能的 EN toggle** |

---

## §4 Provenance 誠實系統（repo 7 值 ↔ DS 5 級）

repo `Prov` 型別（`data.ts:6`）**恰好 7 值、無 `todo`**：`asbuilt` / `artifact` / `demo` / `p1` / `p15` / `p3` / `p4`。映射（裁決源＝對齊矩陣 §4.3）：

| DS 5 級 | repo 值 | 標籤語意 |
|---|---|---|
| built | `asbuilt` | 已實作 |
| artifact | `artifact` | 實測 artifact |
| demo | `demo` | 示範資料（1px dashed amber） |
| ai | `p1` / `p15` | 後端待建 · P1 / P1.5 |
| todo | `p3` / `p4` | 願景 Phase 3 / Phase 4（1px dashed 灰） |

**誠實鐵律（每頁適用）**：

- `prov="todo"` 會 **TS2322**，禁用。未建一律用 `p1`/`p15`/`p3`/`p4`。
- 缺遙測 → 「未取得」+ idle LED（無 glow，**不偽綠**）。
- 未建功能 → disabled Btn + 誠實 caption + prov micro-label，**不提供假按鈕**。
- 後端 enum **逐字 echo**（見 §1.7），不自創顯示值。
- **A4–A10 永遠 NOT BUILT**；hero built = **A1 + A2 + A3-federation only**。
- demo 數據 → `prov="demo"` + 標「示範資料」；願景數字 → 標「願景敘事 · 示意」。

---

## §5 逐路由實作規格（PER-ROUTE PAGE SPECS）

> 每條路由格式：**DS 視覺** / **保留後端 API（逐字，全走 :8004 proxy）** / **AI-coding 任務（有序）** / **改檔** / **Playwright 驗收** / **Prov 誠實**。
> 路由身分以對齊矩陣 §2 為準；狀態以 §4.4 為準。檔路徑前綴 `web-viewer-sample/src/console/`。

### 5.A Hero Built（A1 + A2 + A3-federation；最高優先，先對齊這三條）

#### `#a1`（A1GovernanceWorkbenchPage）— HERO BUILT（**v2 改版 2026-07-02 · D10**）
- **DS 視覺**：頁首「① 選檔 · 偵測到的 IFC」Panel：來源切換 pills（local_fs 檔案庫／MinIO bucket 偵測）+ 選檔元件（三樣式擇一：下拉 optgroup／級聯 pills／樹狀；原型供挑）+ 選定檔列（key·大小·mtime·「測試資料」Badge）；5-step Stepper（**選檔→檢核→結果→審查(Issue·BCF)→交付**）；記分板 MetricCard（來自真實 run）；可點 rule 清單；**BCF 審查面板**（topic 列：ID·標題·規則碼·severity·狀態 chip 可流轉·指派 dashed 待建標；footer 匯出 BCF 2.1/Excel）；**A1 連動橋**：四格證據 rail + GUID 佇列 + 高亮鍵（**不用 hatched phase Panel 視窗佔位**；inline 3D 僅限 evidence-gated、手動啟動的 `a1-inline` 路徑——IX-3D-01 v2.1（2026-07-10 R1）修訂版，其他頁不內嵌）。
- **保留後端 API**：`governanceClient` → `GET /api/governance/files/tree`、`POST /api/governance/rule-runs`、`GET .../rule-runs/:id`、`/results`、`/failures`、`/export?fmt=excel`、`GET /api/governance/issues?rule_run=`、`POST /api/governance/issues/:id/transition`、`POST /api/governance/issues/from-rule-run/:runId`、`GET /api/governance/bcf/export`；`coordinatorClient` → `GET /api/minio/objects?prefix=&delimiter=/`、`runtimeStatus` + `POST /api/review-sessions/:id/first-frame`；EmbeddedViewer postMessage highlight（P1.5）。**全部既存，零後端改動；assignee 欄不存在（O7）——前端不得自建。**
- **任務**：1) 新增 SourcePicker：雙來源切換 + 選檔元件（切來源回 idle、下游清空；任一邊 list 失敗只降該邊，D-31）。2) FlowBar→DS Stepper 綁 `a1Machine.ts`（新增 picked 前置；非 timer）。3) 記分板 Metric→MetricCard，值來自真實 `RuleRunResult.summary`，**禁 hardcode**。4) 新增 BcfReviewPanel：issues list + transition（IntentDialog 模式 3）；指派 dashed 待建標（D-32）。5) 新增 A1BridgeRail：證據單一來源＝`#sessions`／runtime 同輪詢值（IX-SS-05，D-33）；IX-A1-06 四條件 gating 不變。6) tokenize inline layout。
- **改檔**：`pages.tsx`、`a1Machine.ts`、`components.tsx`（SourcePicker/BcfReviewPanel/A1BridgeRail）、`EmbeddedViewer.tsx`、`governanceClient.ts`、`coordinatorClient.ts`。
- **驗收**：branch-isolated stack：① 雙來源各自列出真檔（MinIO 邊斷線時只該邊降破）；② 選檔→真 IFC rule-run 截圖 live 數（如 7126/7055/71/99.0）、Stepper 推進；③ topic 狀態流轉後重整不回退；④ 連動橋與 `#sessions` 證據一致、高亮鍵 disabled；network 只打 `/api/governance/*` + `/api/minio/objects` + `/api/runtime/status`。
- **Prov 誠實**：真 run = `artifact`/`asbuilt`；選檔兩來源 `asbuilt`（檔案標「測試資料」）；topic 列/流轉 `asbuilt`、指派 `p1` dashed；3D 高亮 `p15` disabled（A1 連動橋 rail，非 phase Panel 視窗）；`ifc_guid` 永遠顯示，`usd_prim_path` 為 null 時留空。

#### `#a2` / `#version-diff`（VersionDiffPage）— HERO BUILT
- **DS 視覺**：v06↔v07 add/mod/del MetricCard；三色變更清單（加/改/刪）用 Badge tone；Accountability who/when/why Panel；diff selector Pill。
- **保留後端 API**：`governanceClient` → `filesTree`（`GET /api/governance/files/tree`）、`POST /api/governance/diffs`、`GET .../diffs/:id`、`/items`、`/issue-impact`、`POST /api/governance/issues/from-diff/:diffId`。**`apply-overlay` by design 501**——維持 `p15`，不接真 overlay。
- **任務**：1) diff 計數→MetricCard；變更列→Badge，`change_type` enum 逐字。2) 三色 `ec-diff-add/del/mod` 對 `--ec-grn/--ec-red/--ec-amb`。3) diff selector→Pill。4) apply-overlay 維持誠實 `p15`（501），標「需 viewer DataChannel」非缺功能。
- **改檔**：`pages.tsx`、`components.tsx`、`governanceClient.ts`。
- **驗收**：建 diff，截圖三色清單 + MetricCard 來自真實 `DiffResult.summary.counts`；斷言 apply-overlay 顯示 `p15` 誠實標記而非可用按鈕。
- **Prov 誠實**：diff 資料 `artifact`；apply-overlay/3D 上色 `p15` disabled；`change_type` 逐字；`usd_prim_path` null 保留。**A2 頁不得出現成本影響塊**（成本屬 A6/A9）。

#### `#a3` / `#federation`（FederationPage）— HERO BUILT（federation）
- **DS 視覺**：member 清單 Panel（discipline/usd_path/visibility）；validate-coords 結果；build 狀態；Review-Room handoff link（PrimaryViewLink）。
- **保留後端 API**：`governanceClient` → `POST /api/governance/federated-sets`、`POST .../members`、`GET .../:setId`、`POST .../validate-coords`、`POST .../build`、`GET .../review-room`。
- **任務**：1) member 列→Panel + Field；狀態→Badge。2) 空 `usd_path`（ARC/STR seeded 空白）呈現為「需操作員填入」的誠實提示，**非已建資料**。3) Review-Room handoff 接 `.../review-room` descriptor；build 409/400 錯誤用 IntentDialog 顯示。4) tokenize。
- **改檔**：`pages.tsx`、`components.tsx`、`IntentDialog.tsx`、`governanceClient.ts`。
- **驗收**：建 set→加 2 members→validate-coords→build→開 review-room descriptor；截圖真實 set/members + handoff ready；<2 members 的 build 在 IntentDialog 顯誠實 400。
- **Prov 誠實**：federation flow `asbuilt`；空 seeded `usd_path` 標「待操作員提供」非資料；**不捏 `stage_url`**。

#### `#issues`（IssuesRuleCenterPage）— BUILT（A1 正典中心）
- **DS 視覺**：Panel + Stepper（rule-run）+ 記分板 MetricCard + Issue board 表；export Button；BCF gating 誠實兩步。
- **保留後端 API**：`governanceClient` → `filesTree`、`POST /api/governance/rule-runs`、`GET .../rule-runs/:id`、`/results`、`/failures`、`POST .../issues/from-rule-run/:runId`、`GET /api/governance/issues`（list）、`POST .../issues/:id/transition`、`GET .../rule-runs/:id/export`、`GET /api/governance/bcf/export`。
- **任務**：1) 重用 refactored Stepper + MetricCard + Btn。2) Issue board：status enum（open/assigned/in_progress/resolved/rejected/reopened）逐字 Badge；transition 走 IntentDialog。3) BCF gating：先有 `from-rule-run` issue 才可匯出；`fmt=excel` 與 BCF 分開（export 只 `?fmt=excel`，BCF 是另一 endpoint）。4) in-3D 高亮 disabled `p1`。
- **改檔**：`pages.tsx`、`components.tsx`、`IntentDialog.tsx`、`governanceClient.ts`。
- **驗收**：rule-run → from failures 建 issues → transition 一張 → 匯 BCF；斷言 BCF 按鈕在無 issue 前 gated；status Badge 對 enum；只打 `/api/governance/*`。
- **Prov 誠實**：issue/rule 資料 `artifact`/`asbuilt`；in-3D 高亮 `p1` disabled；enum 逐字；BCF 兩步誠實。

### 5.B 其他 Built 頁（既有功能，套 DS 視覺 + 凍結 API）

#### `#conv`（alias→`#minio`）— 已併入 ModelDataPage（2026-07-06 MD 三頁合一 #303/#304；`ConversionSchedulingPage` 已除役）
- **DS 視覺**：Panel + 表 + coverage MetricCard；MinIO watch toggle（StatusLED observable 狀態）；prioritize/retry Button；失敗診斷 disclosure。
- **保留後端 API**：`coordinatorClient` → `GET /api/external/ifc-ready`、`GET /api/external/minio-watch/status`、`GET /api/conversions/:jobId/quality-metrics`、`POST /api/conversion/jobs/:id/prioritize`、`POST .../retry`、`PUT /api/conversion/watch`；轉檔結果經 `/api/dev/conversions*` proxy。
- **任務**：1) job 清單→DS 表 + status Badge（conversion status enum 逐字）。2) `coverage_ratio` 顯示但**誠實重標**（==1 在 `usd_stage_enumeration` 下是自我參照、非 lossless）——後端值不動、UI 加 note。3) MinIO toggle→StatusLED + IntentDialog（**保留 IP-allowlist auth header**）。4) prioritize/retry 維持 allowlist gating；422 誠實顯示。
- **改檔**：`modelData/ModelDataPage.tsx`、`modelData/GlobalConversionPane.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#minio`（`#conv` 為 alias 轉址），截圖 GlobalConversionPane job 表 + coverage note；toggle watch 斷言 `PUT /api/conversion/watch` payload 回 status；無直連 `:49101`。
- **Prov 誠實**：coverage 反映來源（artifact）；coverage_ratio 重標（值不變）；watch 狀態 observable，**不預設為開**。

#### `#sessions`（SessionManagementPage）— BUILT（**v2：新增 A1 連動橋供應端**）
- **DS 視覺**：Panel + session 表（含 occupied 證據三欄：first_frame_at／last_heartbeat／stage matched，IX-SS-02）；terminate Button（IntentDialog 確認，成功後列轉灰 60s）；Reclaim/Force-release disabled `p1`；**「A1 連動橋 · 供應端」Panel**：繫結鏈 `A1 rule_run ⇢ session ⇢ DataChannel ⇢ highlight ack`（IX-SS-05）。
- **保留後端 API**：`coordinatorClient` → `GET /api/runtime/status`、`POST /api/review-sessions/:id/close`（terminate；**故意不 IP-gate**，cooperative/operator 雙語意，IX-SS-04）。**連動橋無新 endpoint：同 `runtime/status` 資料鏡射，零後端改動。**
- **任務**：1) session 列→表 + status Badge（queued/active/closing/closed 逐字）+ occupied 證據三欄。2) terminate 走 IntentDialog → `/close` 帶 reason。3) Reclaim/Force-release 維持 disabled `p1`。4) 新增 A1BridgeSupplyPanel：A1 頁四格證據的單一來源（D-33）。
- **改檔**：`SessionManagementPage.tsx`、`IntentDialog.tsx`、`coordinatorClient.ts`、`components.tsx`（A1BridgeSupplyPanel）。
- **驗收**：載 `#sessions`，經 IntentDialog terminate；斷言 `POST .../:id/close` 帶 reason；Reclaim/Force-release 維持 disabled；連動橋證據與 `#a1` rail 同輪詢一致；關 session 後 A1 rail 同步回 idle。
- **Prov 誠實**：terminate `asbuilt`；Reclaim/Force-release `p1` disabled；session enum 逐字；證據缺值標「未取得」+ idle LED，不推定。

#### `#minio`（MinioDataPage）— BUILT（真 MinIO raw-folder 逐層；bucket-layout 語意參照為 demo）
- **DS 視覺**：DS Tree（project/model/version）+ Panel；source 標記 copy 由後端 `source_kind` 驅動。
- **保留後端 API**：`coordinatorClient` → `GET /api/minio/objects?prefix=&delimiter=/`（真 MinIO raw-folder 逐層，唯讀）；`governanceClient.filesTree`（`GET /api/governance/files/tree`，local_fs）保留——兩者亦供 `#a1` SourcePicker 共用。
- **任務**：1) file-library 樹維持真實，套 `ec-tree` 於 Panel。2) UI copy **必須由 `source_kind` 驅動**（`local_fs` 顯本地，後端報 `s3` 才翻 's3' 標記——**禁 hardcode 's3'**）。3) 真 S3/MinIO 瀏覽器 + `model.usdc` layout panel 維持 `demo`/`p1`。
- **改檔**：`pages.tsx`、`governanceClient.ts`、`components.tsx`。
- **驗收**：載 `#minio`，斷言樹來自 `/api/governance/files/tree`；source 標記反映 `source_kind`；demo bucket-layout panel 標 `p1`/`demo`。
- **Prov 誠實**：樹 `asbuilt`；bucket-layout/usdc-layout `demo`/`p1`；保留 `source_kind` 誠實標記（**不捏「s3 真實三層」**）。

#### `#semantic`（SemanticViewerPage）— BUILT（唯讀）
> ⚠ **複驗修正**：此頁**不是**走 whitelisted proxy，而是 raw fetch 操作員貼上的 URL（`pages.tsx:3038-3066`）。whitelisted proxy（`governanceClient.elementMappingForSession`，`governanceClient.ts:121`）是**另一頁**（`pages.tsx:420`）在用，勿混。
- **DS 視覺**：Panel + Field 列呈現 IFC 語意；in-3D 高亮 disabled `p1`；classification/geometry 誠實 null。
- **保留後端 API**：`coordinatorClient.listIfcReady`（`GET /api/external/ifc-ready`）；**raw `fetch(mapUrl.trim())`** 載入操作員貼上的 `element_mapping.json` URL（現況，非 proxy）。
- **任務**：1) 語意列→Field；classification/geometry 顯 null + `roadmap[]`（**禁捏造**）。2) 維持現況 raw-fetch 載入操作員 URL 行為（若要改走 whitelisted proxy 是**行為變更**，列入 §8 Q6，非純對齊）。3) in-3D 高亮 disabled `p1`。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#semantic`，貼一個 mapping URL，斷言 raw fetch 載入；classification/geometry 顯 null/roadmap；高亮 disabled `p1`。
- **Prov 誠實**：語意 `artifact`；classification/geometry null 誠實；高亮 `p1`。

#### `#overview`（OverviewPage）— BUILT
- **DS 視覺**：Panel + 表（ENDPOINTS/SERVICES/DEPENDENCIES，來自 `data.ts`）；`/health` 用 HealthChip；method 用 Badge。
- **保留後端 API**：`coordinatorClient.health`（`GET /health`）。
- **任務**：1) 表→DS 表；HTTP method→Badge。2) `/health`→HealthChip（不可達顯 idle「未取得」）。3) 表讀 `data.ts`（descriptive 誠實）。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#overview`，斷言 `/health` HealthChip 反映真狀態；表渲染；method Badge 存在。
- **Prov 誠實**：health 不可達 → idle「未取得」；表為 descriptive 資料。

#### `#apps`（AppsPage）— BUILT
- **DS 視覺**：DS AppCard grid（A1–A10 tile）+ plane 色碼 + per-app ProvTag；route 到 live A1–A3 或 AppVisionPage。
- **保留後端 API**：none（純渲染卡 + 路由）。
- **任務**：1) AppCard→DS clickable Card + plane 色（core/omni/ai）。2) 每 tile 顯真 prov：A1/A2/A3=`asbuilt`，A5=`p3`，A4/A6–A10=`p4`。3) A1–A3→live 頁，A4–A10→AppVisionPage。
- **改檔**：`pages.tsx`、`components.tsx`、`data.ts`。
- **驗收**：載 `#apps`，斷言 A1–A3 tile 連 live 頁、A4–A10 tile 帶 `p3`/`p4` 連 vision 頁；plane 色正確。
- **Prov 誠實**：hero built = A1+A2+A3 only；A4–A10 tile `p3`/`p4`，**永不**樣式化成 built。

#### `#coordinator`（CoordinatorPage → CoordinatorGovernanceTabs）— BUILT
- **DS 視覺**：DS Tabs（aria tablist）+ 每 tab Panel；runtime 狀態 MetricCard/HealthChip。
- **保留後端 API**：`coordinatorClient.runtimeStatus`（`GET /api/runtime/status`）。
- **任務**：1) 保留 `ec-tab/ec-tabs` aria tablist，套 DS Tabs token。2) runtime 欄→HealthChip/MetricCard（缺值 idle）。3) tokenize。
- **改檔**：`coordinator/`（目錄）、`components.tsx`、`coordinatorClient.ts`。
- **驗收**：載 `#coordinator`，切 tab，斷言 runtimeStatus 渲染；aria tablist 可存取。
- **Prov 誠實**：runtime 缺值 idle「未取得」。

#### `#intake`（IntakePage）— BUILT
- **DS 視覺**：Panel + ifc-ready job 表；quality/GPU-seconds 標 `demo`/`p15`。
- **保留後端 API**：`coordinatorClient.listIfcReady`（`GET /api/external/ifc-ready`）。
- **任務**：1) job 清單→表 + status Badge（ifc-ready status enum 逐字）。2) quality/GPU-seconds 標 `demo`/`p15`。3) tokenize。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#intake`，斷言 job 來自 `/api/external/ifc-ready`；quality 欄標 `demo`/`p15`。
- **Prov 誠實**：job `asbuilt`；quality/GPU-seconds `demo`/`p15`。

#### `#runtime`（RuntimePage）— BUILT（GPU/VRAM 為 demo）
- **DS 視覺**：MetricCard + Panel；GPU/VRAM 遙測顯 idle「未取得」（demo）。
- **保留後端 API**：`coordinatorClient` → `runtimeStatus`（`GET /api/runtime/status`）、`streamConfig`（`GET /api/review-sessions/:id/stream-config`）。
- **任務**：1) 真 runtime 欄→MetricCard；GPU/VRAM→idle「未取得」（demo）。2) streamConfig 欄當 session 回報（CAM/CODEC/LATENCY 有才顯，FPS「未取得」）。3) tokenize。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#runtime`，斷言 GPU/VRAM 顯「未取得」（無假綠）；只打 runtimeStatus+streamConfig。
- **Prov 誠實**：GPU/VRAM/FPS demo「未取得」；**不捏 GPU 數字**。

#### `#kit`（KitConsolePage）— BUILT
- **DS 視覺**：Panel + HealthChip（Kit health/instances/usdc）；狀態 Badge。
- **保留後端 API**：經 coordinator forward proxy raw fetch：`GET /api/kit/health`、`GET /api/kit/instances/current`、`GET /api/kit/usdc`（coordinator→kit-manager `:8010`；open/close 變更需 `x-dev-token`）。
- **任務**：1) Kit health/instances→HealthChip/Panel。2) **只走 `/api/kit/*` proxy**（禁直連 `:8010`）。3) open/close 變更保留 `x-dev-token`。
- **改檔**：`KitConsolePage.tsx`、`components.tsx`。
- **驗收**：載 `#kit`，斷言 `/api/kit/*` 渲染 health；無直連 `:8010`；變更按鈕保留 token 語意。
- **Prov 誠實**：Kit health `asbuilt`/`artifact`；proxy down 顯 idle「未取得」；`KitInstance.status` 逐字。

#### `#demo-control`（RealIfcConsolePage）— BUILT
- **DS 視覺**：Panel + IFC source picker 表 + Stepper；亦嵌入 A1（`a1-real-ifc-slice`）。
- **保留後端 API**：raw fetch：`GET /api/dev/ifc-sources`、`GET /api/review-sessions/:id/stream-config`；`POST /api/dev/ifc-sources/:sourceId/register`（把 storage IFC 註冊進 review flow）。
- **任務**：1) IFC source 清單→表；選取→`/api/dev/ifc-sources/:sourceId/register`。2) stream-config→狀態欄。3) 維持 dev-gated 誠實；tokenize。
- **改檔**：`RealIfcConsolePage.tsx`、`components.tsx`。
- **驗收**：載 `#demo-control`，斷言 `/api/dev/ifc-sources` 列頂層 IFC；register flow 打對 endpoint；stream-config 渲染。
- **Prov 誠實**：source 清單 `asbuilt`；dev-gated 誠實標示；**不捏 source**。

#### `#spec`（SpecPage）— BUILT（靜態）
- **DS 視覺**：Panel + Field 列呈現 repo boundary contract；靜態資訊。
- **保留後端 API**：none（靜態 boundary contract 內容）。
- **任務**：1) boundary contract→Panel + Field/描述列。2) tokenize 間距。
- **改檔**：`pages.tsx`、`components.tsx`。
- **驗收**：載 `#spec`，截圖靜態 boundary contract 經 Panel/Field 渲染；無 network。
- **Prov 誠實**：靜態資訊；無 live claim。

#### `#home`（HomePage）— BUILT（無 live API）
- **DS 視覺**：edge-console「今天要做什麼」：依 severity 分組的 Smart-Todo Card + ProvLegend；compose Card + Badge + ProvTag。
- **保留後端 API**：none（Smart Todo nav 卡 + demo Recent-Risk 欄；今天無 live feed——**保持誠實、不捏 feed**）。
- **任務**：1) todo item 包進 refactored Card；severity 用 Badge。2) 頂部 ProvLegend 用 `data.ts` PROV taxonomy。3) demo Recent-Risk 欄標 `prov='demo'`（**無捏造計數**）。4) inline padding/gap 換 `--ec-sp-*`。
- **改檔**：`pages.tsx`、`components.tsx`、`edge-console.css`。
- **驗收**：載 `#home`，截圖 Card grid + ProvLegend；斷言 demo 區塊帶「DEMO DATA」/示範 ProvTag；無無資料的綠燈。
- **Prov 誠實**：Recent-Risk demo 欄標 `demo`；nav 卡帶真 prov；無假計數。

### 5.C Partial 頁（部分已建，誠實標記未建部分）

#### `#viewer`（ViewerPresentationPage）— PARTIAL
- **DS 視覺**：DS Review-Room 描述矩陣 + 誠實 first-frame/stage-truth 區；MethodNote；PrimaryViewLink。
- **保留後端 API**：`coordinatorClient.runtimeStatus`（`GET /api/runtime/status`）——只讀任一 session 的 `first_frame_at` boolean。
- **任務**：1) 矩陣維持描述性；first_frame/stage-truth 為誠實 `p1`（由真實 `first_frame_at` 驅動，**非 timer**）。2) 套 Panel + Field + StatusLED（無 frame 顯 idle「未取得」）。3) PrimaryViewLink 連 review-room handoff（`openInViewerUrl` → `/ui/open?session=`）。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：載 `#viewer`（無 active session），斷言 first-frame 列顯 idle「未取得」（無假綠）；唯一 network 是 runtimeStatus。
- **Prov 誠實**：first_frame/stage-truth `p1`；缺遙測→idle StatusLED + 未取得，**永不綠**。

#### `#gpu`（GpuReviewRoomPage → ReviewRoomPage + panel）— PARTIAL
- **DS 視覺**：DS Review-Room CTA 卡 + bridge 步驟（建立session→派發endpoint→首幀→DataChannel）做成 Stepper；PrimaryViewLink 區；usage-scenario spec Panel；MethodNote。
- **保留後端 API**：經 ReviewRoomPage 的 `coordinatorClient.openInViewerUrl` → `${COORD_BASE}/ui/open?session=`（`coordinatorClient.ts:496`）。
- **任務**：1) bridge 步驟→Stepper。2) CTA 走 `openInViewerUrl`；**保留 `/ui/open?session=` handoff**（不得改 redirect target/regex）。3) console 內 WebRTC 標為不存在（僅 link-out）。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：點「開啟主畫面預覽」，斷言導向 `/ui/open?session=<id>`（console 內無影片）；Stepper 渲染 bridge 步驟。
- **Prov 誠實**：link-out only = 誠實；highlight/section/snapshot `p15`；**不捏 stream**。

#### `#review`（ReviewRoomPage）— PARTIAL（link-out）
- **DS 視覺**：DS Review-Room CTA + bridge Stepper；PrimaryViewLink；highlight/section/snapshot `p15`。
- **保留後端 API**：`coordinatorClient.openInViewerUrl` → `/ui/open?session=`。
- **任務**：1) bridge 步驟→Stepper。2) CTA 走 `openInViewerUrl`；保留 `/ui/open?session=` handoff + regex（**勿破 RK6**）。3) highlight/section/snapshot disabled `p15`。
- **改檔**：`pages.tsx`、`coordinatorClient.ts`、`components.tsx`。
- **驗收**：點開啟，斷言導向 `/ui/open?session=<id>`；`p15` 控制 disabled。
- **Prov 誠實**：link-out 誠實；highlight/section/snapshot `p15` disabled。
> 注意：`#review`（repo `key:"review"` = ReviewRoomPage，獨立頁）與 `#gpu` 是兩個不同頁，**HTML/路由重生時不得把 ReviewRoomPage 連結砍掉或重定向到 `#gpu`**（對齊矩陣 §2 M2）。

#### `#instances`（KitGpuFleetPage）— PARTIAL（demo node snapshot）
- **DS 視覺**：DS Panel 給 Fleet model（asbuilt）+ 明確標記的 demo Node snapshot 區（hardcoded `edge-gpu-01..03`）帶 demo ProvTag。
- **保留後端 API**：none（無 live GPU telemetry endpoint）。**不得**把假遙測接到真 API。
- **任務**：1) 分頁：Fleet-model Panel（asbuilt 設計）vs Node-snapshot Panel（`prov='demo'`）。2) hardcoded `edge-gpu-01..03` 明標 DEMO DATA。3) 真 GPU telemetry = NOT BUILT note。
- **改檔**：`pages.tsx`、`components.tsx`。
- **驗收**：載 `#instances`，斷言 Node-snapshot 帶 demo ProvTag 且無 network 取它；Fleet-model 區只讀為 design/asbuilt。
- **Prov 誠實**：Node snapshot `demo`；真遙測缺→無假綠 metric；**不捏 endpoint**。

### 5.D NOT BUILT 頁（維持 phase Panel，全 disabled，零後端呼叫）

#### `#a4`..`#a10`（AppVisionPage，slug=ai-search/iot-fm/4d-5d/reality-capture/synthetic-data/usd-copilot/robot-sim）— NOT BUILT（願景 Phase 3/4）
- **DS 視覺**：DS ScenarioPage / 通用 Phase Panel：persona callout、glyph viewport 佔位 + 紅斜線 Phase Panel、journey ol、requirement SpecList、PrimaryViewLink（disabled）。**絕不**用 A1/A2 的 built hero 處理。
- **保留後端 API**：**none**——A4–A10 後端不存在。**不得接任何 endpoint，不得引用任何 API。**
- **任務**：1) 每 slug 用 DS phase Panel（紅斜線 header）標 roadmap。2) 所有 action 為 disabled Btn + 誠實 caption + prov micro-label（A5=`p3`、A4/A6–A10=`p4`）。3) 保留「後端未建」warning banner。4) PrimaryViewLink 在但 disabled。
- **改檔**：`pages.tsx`、`components.tsx`、`data.ts`。
- **驗收**：載每個 A4–A10 hash，斷言 phase-Panel 存在、所有 action 按鈕 disabled、prov tag = `p3`（A5）或 `p4`（其餘）、「後端未建」文字可見；**斷言這些頁對 `/api/*` 零 network 呼叫**。
- **Prov 誠實**：A5=`p3`，A4/A6/A7/A8/A9/A10=`p4`；**永不**描述/樣式化成 built；無假計數、無 enabled 按鈕、無捏造 viewport 圖。

#### `#reports`（ReportsPage / StubPage）— NOT BUILT
- **DS 視覺**：DS phase Panel stub；item 為 disabled 列帶真 prov（asbuilt/p1 混合誠實）。
- **保留後端 API**：none。
- **任務**：1) 誠實 stub Panel，無 live 呼叫。2) 每 item 保留 prov 標；`p1` item disabled。3) **不得**暗示功能性報表。
- **改檔**：`pages.tsx`。
- **驗收**：載 `#reports`，斷言 stub 處理、無 network、disabled item 顯 prov 標。
- **Prov 誠實**：stub；item asbuilt/p1 誠實混合；無假報表按鈕。

#### `#admin`（AdminPage / StubPage）— NOT BUILT
- **DS 視覺**：DS phase Panel stub，全控制 disabled（`p1`）。
- **保留後端 API**：none。
- **任務**：1) 誠實 stub Panel，全 `p1` 全 disabled。2) 無 live 呼叫。
- **改檔**：`pages.tsx`。
- **驗收**：載 `#admin`，斷言全控制 disabled `p1`、無 network。
- **Prov 誠實**：全 `p1` disabled；無捏造 admin 動作。

---

## §6 前端對齊執行順序與里程碑

> 原則：**先地基（token tier）→ 再共用元件 → 再逐頁套用（先 hero）→ 最後全頁取證**。每步都跟 baseline 截圖比對；沒比 baseline 好就 revert。

- **F0 — token tier 抽取（低風險、加性）**：在 `edge-console.css .ec-root` 補命名 token（`--ec-fs-*` type scale、`--ec-sp-*` 4px spacing、`--ec-r-*` radius、`--ec-shadow-*`、`--ec-glow-grn`、`--ec-ease/-dur*`、`--ec-track-label/-tag`、`--ec-on-grn`、`--ec-surface-2`、`--ec-sans`）。**只新增、先不取代 inline 值**——零視覺改動。
- **F1 — 共用元件 refactor（一次改、全站受惠）**：Panel/Card、Btn、Stepper(FlowBar)、StatusLED(.ec-status-dot)、MetricCard(Metric)、NavItem、HealthChip、ProvTag(只換視覺)；**新建** Badge、Pill。保留所有領域契約（caption/prov/testid/enum）。
- **F2 — 逐頁套用**（順序）：① hero `#a1`/`#a2`/`#a3`/`#issues` → ② 其他 built 頁（`#sessions`/`#minio`（含原 `#conv`/`#intake` alias）/`#overview`/`#apps`/`#coordinator`/`#runtime`/`#kit`/`#demo-control`/`#semantic`/`#spec`/`#home`）→ ③ partial 頁（`#viewer`/`#gpu`/`#review`/`#instances`）→ ④ NOT BUILT 頁（`#a4`–`#a10`/`#reports`/`#admin`）維持 phase Panel。每頁把 inline font-size/padding/gap 換成 F0 token。
- **F3 — 全頁 Playwright evidence**：每頁依 §5 驗收條 + §7 規約取證。

每個 milestone 完成 = 對應頁 §5 驗收通過 + 後端契約（§1）零違反 + screenshot 比對不退步。

---

## §7 驗收與證據規約

- **user-facing 驗收唯一證據**＝gstack/Playwright per-page evidence（`artifacts/e2e/<page>-trace/` + `*.png`）；**backend-only done 不接受**。
- **branch-isolated stack 啟法**（不碰部署區 :8004/:49102）：`build:ui` → branch governance（`GOV_PORT=49103` + `BIM_FILE_LIBRARY_ROOT`）→ branch coordinator（`PORT=8005` / `CONSOLE_DIST_DIR` / `GOVERNANCE_API_BASE`）→ E2E 打 `:8005`。（細節見記憶 `branch-e2e-isolated-stack`。）
- **network 面斷言**：built/partial 頁只允許打 coordinator `:8004`(/`:8005`) 的 `/api/*` proxy；**A4–A10 / `#reports` / `#admin` 斷言對 `/api/*` 零呼叫**。
- **誠實斷言**：缺遙測顯「未取得」+ idle LED；disabled 控制帶誠實 caption + prov；demo 區帶 `prov='demo'`；enum 逐字。
- **對齊技術債防線 §13 boolean checklist** 逐項過（built 宣告 5 條件）。
- **截圖偶發 frozen**：重試（記憶 `a1a3-ds-alignment-2026-06-23`）。

---

## §8 已知風險與待人類決策（open questions）

> 下列是**會改變可見外觀或行為**的決策，AI coding **不得自行拍板**，須先問人類；在拍板前，F0/F1 的加性 token + 元件 refactor 可先做（不依賴這些決策）。

1. **NVIDIA 綠值**：DS 提亮成 `--accent #84c714`（比正統 NVIDIA `#76b900` 亮一階）；repo `--ec-grn` 是正統 `#76b900` 且 CLAUDE.md 記憶把「GPU/NVIDIA-green」當核心品牌前提。採 DS `#84c714` 還是保留 `#76b900`？（**可見品牌改動，須人類簽核才大規模套用**；預設保留 `#76b900`。）
2. **字體**：DS body/label 用 UI sans（Plus Jakarta Sans + Noto Sans TC）、mono 只留給 code/ID；repo 目前 mono-only（`--ec-mono` 全域 13px）。本輪導入 `--ec-sans` 重塑 body/nav/heading，還是維持 mono-only？（**最大可見重塑**。）
3. **Light `.theme-docs`**：DS 出一整套淺色 token（藍 `#2563eb`）；repo console 純暗、無 docs surface。本輪做不做任何淺色/docs surface，或整個 skip？**（現況補記 2026-06，非拍板）** repo 已落地全站 `theme-light` toggle（`edge-console.css:435` 註解映射 `.theme-light = DS .theme-docs`、一處覆寫全站變色，PR #255），可作此題現有實作參考；惟「是否正式採此為最終形 / 是否做 per-page docs surface」仍依本節開頭規則**保留人類決策、未拍板**。
4. **雙語 i18n**：DS 要求 `AIBIM.tt {zh,en}` + LangToggle + persistence；repo 字串 zh 為主、無 i18n runtime，Tweaks toggle 是 用語/情境 非 zh/EN。本輪加真 i18n + LangToggle，還是延後（**不要做沒功能的 EN toggle**）？
5. **卡片圓角**：DS 正典卡片 14px（`--radius`）；repo 卡片約 6px。採 14px（全 Panel/Card 可見變圓）還是維持現狀？
6. **`#semantic` 資料路徑**：現況 raw fetch 操作員貼上的 mapping URL。是否要**遷移**到 whitelisted proxy（`elementMappingForSession`）？這是**行為變更**（非純 DS 對齊），須單獨立項。
7. **token-tier 抽取 vs 可見重塑的範疇**：F0（加性命名 token）零風險；逐頁取代 inline 字面值會改外觀。本輪是「全面視覺採用」還是「只建 token tier + 先 refactor 共用元件」？

---

## §9 複驗存證（confidence stamp）

本手冊內容經 4 路平行掃描（DS / 前端 / 後端 / 既有 docs）→ 合成 → 對抗複驗（對 source code 實查，非只信摘要）產出。複驗結論：

- **零幻覺 API**：26 條路由所引 endpoint 全部對得上 `governanceClient.ts`/`coordinatorClient.ts` 真實 method 與真實 proxy 路徑。
- **後端保留 = TRUE**：計畫明確 frontend-only，凍結拓樸（browser→`:8004` only），禁改 `app.py`/`governanceProxy.ts`/`conversion_authority.py`，無任一頁任務迫使後端契約改動。
- **AI 可執行 = TRUE**：每頁有真實檔路徑、真實路由、有序任務、驗收。
- **誠實紀律**：Prov 確認恰 7 值無 `todo`（`data.ts:6`）；A4–A10 一致維持 NOT BUILT/phase-Panel/`p3`-`p4`；idle「未取得」與 501/coverage 自我參照重標皆保留。
- **已套修正**：`#semantic` 改為 raw-fetch 現實（非 whitelisted proxy）；`#gpu`/`#review`/`#viewer` 措辭收斂為 `/ui/open?session=`（移除 console 不會送出的 `/?session=`）。

---

## §10（增補·2026-07-06）：單租戶 host 假設與 SaaS 租戶維度邊界（全部 PLANNED）

> **增補層聲明**：本節為 2026-07-06 SaaS 改版增補，效力低於 §0 效力鏈所列全部既有文件；與 §1 後端凍結面契約衝突時，一律以 §1 為準。本節描述的 SaaS 租戶維度能力**全部 PLANNED·未建**，現況仍是**單站點單租戶閉環（tenant zero）**。A1–A10 建成狀態不因本節變動——建成裁決唯一源仍是對齊矩陣 §4.4（**本節不重述**）。
>
> **編號說明**：本手冊既有末節為 §9 複驗存證；本增補依「不重編既有章節編號」原則接續為 §10。

### 10.1 重申 §1 凍結：SaaS 化不鬆動任何一條

本手冊全篇「frontend-only 對齊」前提在 SaaS 語境下**原封不動**。特別重申兩條最高約束：

- **proxy 路徑字串 byte-identical 永久不可變**：§1.2 governance proxy 路徑、§1.3 轉檔 dev proxy、§1.4 `/ui/open?session=` handoff（含 session-id regex `^(lwv_|review_session_)[A-Za-z0-9_]+$`，以及「必須註冊在 `/ui` SPA fallback **之前**」的順序聲明）、§1.7 enum 逐字 echo、§1.11 envelope key（`{items,count}`／`{issues}`／`{items,total,limit,offset}` 等）——**引入租戶維度不得改動其中任何一個字元**。
- **禁改後端檔清單不動**：§1.12 列的 governance-service（`app.py`、`diff_engine/api.py`、`federation/api.py`、`issues/api.py`、`bcf/api.py`、`file_library/api.py`）、coordinator（`src/app.ts`、`src/routes/governanceProxy.ts`）、streaming `conversion_authority.py`——SaaS 租戶化**不得**以「加租戶參數」為由觸碰任一檔（觸碰即進 §10.4 待簽核清單）。

### 10.2 租戶維度只有兩種合法增補形態

「單租戶 host 假設」與多租戶並存的**唯二**允許形態（PLANNED·SaaS-M2；兩者皆為 additive、零改凍結面）：

1. **token `tenant_id` claim 於 coordinator 中介層集中解析**：租戶身分由帶 `tenant_id` claim 的短期 token 承載，於 coordinator 新增的租戶 context 中介層**集中**解析與範圍過濾，**不讓各後端 service 自兜隔離**、不改 proxy 路徑字串。現況單一 governance token 視為 `tenant_id=default` 的隱含租戶（tenant zero）。
2. **`X-Tenant-Id` additive optional header**：作為輔助傳遞，**缺省即 fallback 到現況單租戶路徑**（tenant zero），header 存在與否都不改變 proxy 目標與回應結構。

> 兩形態皆**不新增 hash 路由、不改 A.1.1 22 條正典路由**——租戶維度一律加在 22 條 hash 之外的更外層（token claim 為主、子網域為輔）。任何要引入 tenant-scoped hash 的需求進 §10.4 待簽核清單。

### 10.3 golden-path 逐位元組對比測試（PLANNED·SaaS-M6，§1 迴歸守門）

為機器化守住 §1「byte-identical」承諾，SaaS-M6 導入 **golden-path 逐位元組對比測試**：

- **測法**：同一請求分兩路——(a) 前端 console 現況路徑，直打 coordinator `:8004` 的凍結 `/api/*`；(b) 對外開發者路徑，經 `/v1` gateway 轉發到同一凍結內部路徑。對兩路回應做 **byte-for-byte 比對**。
- **比對範圍（三類）**：① proxy 路徑字串（不改名）；② enum 逐字 echo（`change_type`／issue `status`／`severity`／conversion·session·job status／`KitInstance.status`）；③ envelope key（不 flatten／不改名）。**逐端點對照詳表引用 `ai-bim-governance-saas-公開API與標準對齊.md` §3，本節不重複。**
- **守門語意**：對比出任一位元組差異（gateway re-serialize、enum 大小寫、envelope 改名等靜默破壞）＝ SaaS-M6 驗收 fail ＝ §1 迴歸紅燈，阻擋合併。前端 console **完全不經** `/v1` gateway，仍直打 `:8004`（§1 十二條零觸碰）。

### 10.4 待人類簽核的新決策（未簽核前不得實作、不得在改寫或實作中偷渡）

下列任一情形**觸及既有凍結面**，屬「待人類簽核的新決策」，AI coding **不得自行拍板**，須先以顯式 AskUserQuestion 取得人類簽核：

| # | 觸發條件 | 為何須簽核 |
|---|---|---|
| S1 | governance API 需新增 `user`／`org`／`project` 參數 | 動到凍結 API 形狀，連動 §1.2 路徑與後端 schema |
| S2 | 需修改 §1.12 禁改後端檔清單中**任一檔** | 直接違反 §1 最高約束 |
| S3 | `data.ts:6` `Prov` 型別變更（如加第 8 值） | 牽動 `a1Machine.ts` 等全部消費者，且 `prov="todo"` 已知 TS2322（見 §4） |
| S4 | target host 選擇邏輯**侵入 proxy 路徑語意**（把 host／tenant 塞進路徑字串或改寫轉發目標語意） | 破壞 byte-identical 與 §10.3 守門 |

> §8 七項待人類決策（NVIDIA 綠值／字體／light theme／i18n／圓角／`#semantic` proxy 遷移／token-tier 範疇）**維持 OPEN**；SaaS 品牌演進壓力**不構成**定案理由，拍板仍走 §8 守門。

### 10.5 技術債防線引用

- **D-34（tenant 參數禁塞凍結路徑）**：實作 `/v1` gateway 或租戶中介層時，**禁**把 tenant 參數塞進凍結 governance proxy 路徑字串／query；防線＝§10.3 golden-path 逐位元組對比測試 ＋ code review 檢查點「proxy 路徑字串 grep 不含 tenant」。詳規見 `ai-bim-governance-實作紀律與技術債防線.md` §3 D-34。
- **H6 metadata-only**：SaaS 雲端只收白名單 metadata 投影（計數／狀態／hash／摘要／時戳／版本號），**IFC/USD payload 不出站**；此為 D-35 防線標的，本節僅聲明、詳規見技術債防線檔。
