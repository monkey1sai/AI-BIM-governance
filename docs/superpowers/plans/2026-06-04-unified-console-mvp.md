# 統一治理控制台 MVP 垂直切片 · Implementation Plan

> **For Hermes / implementer:** REQUIRED SUB-SKILL: `subagent-driven-development`。逐 task dispatch 一個 fresh subagent，two-stage review（先 spec compliance，再 code quality）。每個 task 自成 RED→GREEN→commit 一輪；commit 前必跑 `gitnexus_detect_changes` 確認 scope（見根目錄 `CLAUDE.md` §4），改 `Window.tsx` / `App.tsx` / `main.tsx` 前必跑 `gitnexus_impact`（HIGH/CRITICAL 先回報）。

**Goal:** 在 `web-viewer-sample` 瀏覽器 client 邊界內，落地「統一治理控制台 MVP 垂直切片」——三個獨立 operator 頁（coordinator / intake / runtime）+ A1–A10 治理 overlay 疊在 primary viewer live 3D 上（MVP 只接已有引擎 A2/A3/A4/A8）+ HighlightBridge / MappingCache / GovPanelState 打通「點 3D 構件 ↔ IFC GUID ↔ 治理」與「治理失敗構件 → 3D 標紅」，全程只打 coordinator `:8004`、誠實 provenance、後端離線顯 502。

**Architecture:**
- **零新後端、零新 API/data shape。** 所有新元件（HighlightBridge / MappingCache / GovPanelState / overlay 框架）都在瀏覽器 client 邊界內，沿用既有 NVIDIA WebRTC streaming library（`@nvidia/omniverse-webrtc-streaming-library@^5.6.0`，`AppStreamer.sendMessage`）與既有 message builders（`clients/streamMessages.ts` 的 `buildHighlightPrimsRequest` / `buildFocusPrimRequest` / `buildClearHighlightRequest`）。3D 著色走 **client 主動拉**（client → DataChannel → Kit），不復活 2026-05-21 退役的 server-push highlight。
- **Window.tsx overlay 框架抽取走漸進式（Q1）**：先抽**純資料/邏輯小單元**（`MappingCache` / `HighlightBridge` / `GovPanelState`，各自獨立 module + 單元測試，不碰 `Window.tsx`），再以**最小掛載點**把 overlay 容器掛進 viewer，逐 task 後 viewer 仍可 build/跑。
- **MappingCache 鎖單一 model version（Q2）**：只快取當前 model version 的 `element_mapping`，不做跨版本智能失效。
- **spectator 唯讀（Q）**：`GovPanelState` 依 `streamRole=spectator`（沿用 `Window.tsx:188 isSpectatorStreamMode`）把治理操作面板 `disabled`（面板可見、不可操作，誠實表態「唯讀」）。
- **強制 identity profile guid_exact / coverage 1.0（Q4）**；coverage<90% 走既有 spec 誠實降級（`host-native-conversion-authority-service` / `runtime-verification-evidence` / `governance-rule-run-authority`），未對映 failed 構件誠實「無法 3D 標示」+ coverage%，不捏造 prim path。

**Tech Stack:** TypeScript + React 18（class component viewer + function component console）、Vite 5、Vitest 1.6（jsdom + `renderToString` smoke 測試風格，見既有 `src/console/console.test.tsx`）、NVIDIA omniverse-webrtc-streaming-library。後端為既有 coordinator（Express，`bim-review-coordinator`，`:8004`）+ governance-service（`:49102`，僅經 coordinator proxy）。

**北極星 source of truth：**
- spec delta：`openspec/changes/unified-governance-console/specs/unified-governance-console/spec.md`（5 requirements）。
- design doc：`docs/superpowers/specs/2026-06-04-unified-governance-console-design.md`（§2 架構 / §3 路由 / §6 MVP 切片 / §7 fallback / §8 新元件+重構flag / §10 已裁示 Q1-Q3）。

**誠實鐵律（不可退化，沿用既有 Edge Console 契約）：**
1. 畫面與真實落地一致、無假數字（禁 127 rules / 53 BCF / 73–100 分 / 99.1% GUID / 92.4% mapping）。
2. 每塊資料 / 每顆動作標 provenance（`asbuilt` / `artifact` / `demo` / `p1` / `p15`）；待建標 `p1`/`p15` 並 `disabled`，不做點了沒反應的假按鈕。
3. 後端離線顯 502（coordinator proxy 既有行為，`governanceProxy.ts:39`）；不偽裝成功、不顯示捏造數值、不殘留舊結果假裝成功。
4. 不冒充 `guid_exact`；fake/smoke mapping（`mock` / `allow_fake_mapping` / `fake_mapping_count>0` / `mapping_method=fake_for_smoke_test`）一律當 fake（重用既有 `types/mapping.ts` 的 `isFakeMappingDocument`）。
5. 不復活 2026-05-21 退役的 server-push highlight；3D 著色一律 client `highlightPrimsRequest` 走既有 DataChannel。
6. 前端只打 coordinator `:8004`，不直連 `governance-service :49102` / `streaming :49100/47998`。

**MVP 不含（Q3 已裁示各自獨立 OpenSpec change）：** A5 / A6 / A9 / A10、spectator 多人協作、`geometry_changed`、跨版本 MappingCache。

---

## MCP 查詢紀錄（Omniverse 鐵律，誠實標示）

本計畫撰寫時依鐵律嘗試查 Kit MCP / usd-code-mcp / omni-ui-mcp 對齊 NVIDIA 官方 DataChannel / highlight / prim 選取 API。**實況**：`mcp__claude_ai_Kit_MCP__search_kit_knowledge`、`search_kit_code_examples`（3 次不同 query）、`mcp__claude_ai_USD_Code_MCP__search_usd_knowledge` / `search_usd_code_examples`、`mcp__claude_ai_Omni_UI_MCP__search_ui_code_examples` 當次全數回 `403 Forbidden（Authorization failed）` 或 `No examples found`，無法取得線上內容（環境限制，不臆造）。

**緩解（不靠臆測）**：本 MVP **不新增任何 Kit / USD server-side code**；client→Kit 的 DataChannel 契約以 **repo 內既有、NVIDIA 自家、已上線運作的 vendored 實作** 為權威來源，計畫只「引用既有已驗證的 message 形狀」，不發明新指令：
- 傳輸：`AppStreamer.sendMessage(message)`（NVIDIA `@nvidia/omniverse-webrtc-streaming-library`，`web-viewer-sample/src/AppStream.tsx:236`）。
- 既有 message 形狀（已被 Kit 消費、已有回應事件）：`highlightPrimsRequest` / `focusPrimRequest` / `selectPrimsRequest` / `clearHighlightRequest` / `openStageRequest`，由 `web-viewer-sample/src/clients/streamMessages.ts` 組成；回應 `highlightPrimsResult` 等在 `Window.tsx:1552` 處理。
- 形狀證據：`buildHighlightPrimsRequest(items, focusFirst, requestId)` → `{ event_type:"highlightPrimsRequest", payload:{ request_id?, mode:"replace", items:[{prim_path, ifc_guid?, color?, label?, source?, issue_id?}], focus_first } }`（`streamMessages.ts:51`，`types/streamMessages.ts` `HighlightItem`）。

> 實作階段若 MCP 恢復，建議補查 `highlightPrimsRequest` 是否有新版欄位再對齊；本計畫的形狀以 repo 既有為準，不會憑空新增 Kit 端指令。

---

## File Structure（先盤點：create / modify + 各自責任）

### 新建（皆在 `web-viewer-sample/src/` 瀏覽器 client 邊界內）

| 檔案 | 責任 |
|---|---|
| `src/console/governance/mappingCache.ts` | **MappingCache**：純函式 + class，吃 `ElementMappingDocument`（既有 `types/mapping.ts`），建 `ifc_guid → usd_prim_path` 與 `usd_prim_path → ifc_guid` 雙向 index；鎖單一 model version；拒絕 fake mapping（重用 `isFakeMappingDocument`）；回報 coverage%（`mapped_count / source_ifc_entity_count`）。 |
| `src/console/governance/mappingCache.test.ts` | MappingCache 單元測試（雙向查、fake 拒絕、coverage 計算、未對映回 null）。 |
| `src/console/governance/highlightBridge.ts` | **HighlightBridge**：把 failed 構件（`{ifc_guid, usd_prim_path, severity}`）+ MappingCache 組成 `highlightPrimsRequest`（重用 `buildHighlightPrimsRequest` + `severityToColor`）；`usd_prim_path` 為 null（未對映）時回 `{ ok:false, reason:"unmapped" }`（誠實，不捏造）；DataChannel 未就緒時回 `{ ok:false, reason:"datachannel_not_ready" }`。**只組訊息，不自己送**（送由注入的 `sendMessage` 函式，便於測試與守邊界）。 |
| `src/console/governance/highlightBridge.test.ts` | HighlightBridge 單元測試（有 prim 組出正確 request、未對映回 unmapped、DataChannel 未就緒回 not_ready、不復活 server-push）。 |
| `src/console/governance/govPanelState.ts` | **GovPanelState**：純函式，吃 `{ streamRole, dataChannelReady }`，回 `{ canOperate, disabledReason }`；spectator → `canOperate=false, disabledReason:"spectator_read_only"`；DataChannel 未就緒 → `disabledReason:"waiting_viewer"`。 |
| `src/console/governance/govPanelState.test.ts` | GovPanelState 單元測試（spectator disabled、primary+ready 可操作、未就緒 waiting）。 |
| `src/console/governance/govEndpoints.ts` | MVP guid_exact / coverage 門檻常量 + 降級判定純函式（`evaluateCoverageGate(summary)` → `{ profile, coverageOk, degraded, denominator }`），引用既有三份 spec 的門檻（`minimum_coverage_ratio=1.0`、`coverage_denominator=source_ifc_entity_count`）。 |
| `src/console/governance/govEndpoints.test.ts` | coverage gate 單元測試（coverage 1.0 pass、<0.9 degraded warn 不 fail、fake 不算覆蓋）。 |
| `src/console/GovernanceOverlay.tsx` | **A1–A10 治理 overlay 框架元件**（function component，吃 props，不自管 WebRTC）：右側治理清單/動作，MVP 接 A2（語意映射檢視）/A3（規則·IDS 檢核）/A4（治理分）/A8（Issue·BCF）；A5/A6/A9/A10 標 `p3`/`p4` disabled；點 failed 構件呼叫注入的 `onHighlight(item)`（接 HighlightBridge）；spectator 由 `govPanelState` 決定 disabled。 |
| `src/console/GovernanceOverlay.test.tsx` | overlay smoke（renderToString）：含 A2/A3/A4/A8 區塊、provenance、spectator disabled、未對映顯「無法在 3D 標示」+ coverage%、無假數字。 |
| `src/console/governance/overlay.css` | overlay 容器樣式（沿用 `edge-console.css` 的 `--ec-*` token；`position:absolute` 疊在 viewer 右側；spectator disabled 視覺）。 |
| `src/console/OperatorConsole.tsx` | **三個獨立 operator 頁殼**（hash 路由 `#/console/coordinator|intake|runtime`，沿用既有 `EdgeConsole.tsx` 的 `usePageHash` 零依賴路由模式）；複用既有 `CoordinatorPage` / `IntakePage` / `RuntimePage`（`console/pages.tsx`）；**不混入 A1–A10 overlay**。 |
| `src/console/OperatorConsole.test.tsx` | operator 殼 smoke：三頁皆獨立 render、皆不含 A1–A10 治理 overlay 標記。 |
| `src/console/IntakeSelectPage.tsx` | `/console/intake` 的 A1 進件「從現成模型清單選取」面板（讀既有 `coordinatorClient.listIfcReady`，列 `expected_stage_url` 的 job 供選；**不要求手填路徑**）。 |
| `src/console/IntakeSelectPage.test.tsx` | intake 選取 smoke：呈現現成清單 UI、無「手填模型路徑」input、provenance 標示。 |

### 修改

| 檔案 | 修改責任 |
|---|---|
| `src/main.tsx:36-40` | 路由分流：`#/console/...` 或 `/console...` 掛 `<OperatorConsole/>`（三 operator 頁），其餘維持 `<App/>`（viewer）。**保留既有 `?session=` bootstrap 與 `<App/>` 行為不變**（Q1 漸進式）。 |
| `src/Window.tsx` | **最小掛載點**（最後幾個 task 才動，先跑 `gitnexus_impact`）：(a) 偵測 `streamRole` 算 GovPanelState；(b) 在 viewer render 樹疊上 `<GovernanceOverlay/>`（client 主動拉，用既有 `_sendStreamMessage` 注入給 HighlightBridge）；(c) 把當前 model version 的 mapping 餵進 MappingCache。**保留既有 viewer 行為**，overlay 預設可關。 |
| `src/console/pages.tsx`（既有 `IssuesRuleCenterPage` / `VersionDiffPage` / `SemanticViewerPage`） | **不改邏輯**；僅供 overlay 與 operator 頁複用其既有 client 呼叫模式（讀，不重造）。若 overlay 需共用既有渲染，抽共用子元件而非複製（DRY）。 |

### 不動（守邊界）

- `bim-review-coordinator/*`、`governance-service/*`、`bim-streaming-server/*`：**零後端改動**。MVP 只用既有已驗證端點。
- `src/App.tsx`（NVIDIA Forms 殼）：不動（viewer attach 路徑由 `Window.tsx` 承載）。
- 任何 `secrets` / `.env` 實際機密值：不碰。

---

## 驗證指令（全程在 `web-viewer-sample/` 目錄下）

- 單一測試檔：`npm run test -- src/console/governance/mappingCache.test.ts`（vitest run，`vitest.config.ts` 已設 jsdom + globals）。
- 全部測試：`npm run test`（= `vitest run`）。
- type + build：`npm run build`（= `vite build`，會跑 tsc 型別檢查）。
- 提交前 gate（與 repo 一致）：`npm run verify`（= `npm run build && npm run test && npm run test:struct-log`）。
- **baseline（動手前先量）**：第一個 task 前先在 `web-viewer-sample/` 跑一次 `npm run test` 與 `npm run build`，記下現狀通過數，作為 keep/discard 比較基準。

> Windows PowerShell 跑 npm 用 `npm run test -- <path>`（`--` 後傳給 vitest）。

---

## Phase A — 純邏輯單元（不碰 Window.tsx，先建地基）

### Task A0: 量 baseline + 建 governance 目錄

**Objective:** 取得現狀測試/build baseline，並建立新元件目錄。

**Files:**
- Create dir: `web-viewer-sample/src/console/governance/`

**Step 1: 量 baseline**

在 `web-viewer-sample/` 下 Run：`npm run test`
Expected: 既有測試全綠（記下檔數 / 測試數，例如 `console.test.tsx` 等通過）。

**Step 2: build baseline**

Run：`npm run build`
Expected: tsc + vite build 成功，無型別錯誤。

**Step 3: 建目錄佔位**

建立空目錄 `web-viewer-sample/src/console/governance/`（放後續 module）。Windows：`New-Item -ItemType Directory -Force web-viewer-sample/src/console/governance`。

**Step 4: Commit**

```bash
git add -A
git commit -m "chore(console-mvp): 建 governance 元件目錄 + 記錄 baseline"
```

---

### Task A1: MappingCache — 雙向 index（ifc_guid ↔ usd_prim_path）

**Objective:** 從真實 `element_mapping` 建立 client 端雙向查詢快取，鎖單一 model version。

**Files:**
- Create: `web-viewer-sample/src/console/governance/mappingCache.ts`
- Test: `web-viewer-sample/src/console/governance/mappingCache.test.ts`

**真實 shape 依據**（已查 repo 內真實 `element_mapping.json`）：top keys `{ mock, summary, items }`；`items[]` 形如 `{ ifc_guid, usd_prim_path, ifc_type, ifc_name, entity_id }`；`summary` 形如 `{ mapped_count, fake_mapping_count }`。型別用既有 `src/types/mapping.ts` 的 `ElementMappingDocument` / `ElementMappingItem`。

**Step 1: Write failing test**

```ts
// web-viewer-sample/src/console/governance/mappingCache.test.ts
import { describe, expect, it } from "vitest";
import { MappingCache } from "./mappingCache";
import type { ElementMappingDocument } from "../../types/mapping";

const REAL: ElementMappingDocument = {
  mock: false,
  model_version_id: "mv_001",
  summary: { mapped_count: 2, unmapped_ifc_count: 1, fake_mapping_count: 0 },
  items: [
    { ifc_guid: "GUID_A", usd_prim_path: "/World/IfcWall/_A", ifc_class: "IfcWall", name: "Wall-A" },
    { ifc_guid: "GUID_B", usd_prim_path: "/World/IfcDoor/_B", ifc_class: "IfcDoor", name: "Door-B" },
  ],
};

describe("MappingCache 雙向查詢（鎖單一 model version）", () => {
  it("ifc_guid → usd_prim_path", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.primPathForGuid("GUID_A")).toBe("/World/IfcWall/_A");
    expect(cache.primPathForGuid("GUID_B")).toBe("/World/IfcDoor/_B");
  });

  it("usd_prim_path → ifc_guid（點 3D 反查）", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.guidForPrimPath("/World/IfcDoor/_B")).toBe("GUID_B");
  });

  it("未對映 guid 回 null（不捏造）", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.primPathForGuid("GUID_MISSING")).toBeNull();
    expect(cache.guidForPrimPath("/World/Nope")).toBeNull();
  });

  it("鎖定的 model version 可讀回", () => {
    const cache = MappingCache.fromDocument(REAL, "mv_001");
    expect(cache.modelVersionId).toBe("mv_001");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/mappingCache.test.ts`
Expected: FAIL — `MappingCache` 找不到 / 未匯出。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/governance/mappingCache.ts
// MappingCache：client 端快取 element_mapping 的 ifc_guid ↔ usd_prim_path 雙向 index。
// 鎖單一 model version（Q2：不做跨版本智能失效）。只讀 + 不寫回；mapping 權威在 conversion artifact。
import type { ElementMappingDocument, ElementMappingItem } from "../../types/mapping";

export class MappingCache {
  readonly modelVersionId: string | null;
  private readonly guidToPrim: Map<string, string>;
  private readonly primToGuid: Map<string, string>;

  private constructor(modelVersionId: string | null, items: ElementMappingItem[]) {
    this.modelVersionId = modelVersionId;
    this.guidToPrim = new Map();
    this.primToGuid = new Map();
    for (const item of items) {
      if (item.ifc_guid && item.usd_prim_path) {
        this.guidToPrim.set(item.ifc_guid, item.usd_prim_path);
        this.primToGuid.set(item.usd_prim_path, item.ifc_guid);
      }
    }
  }

  static fromDocument(doc: ElementMappingDocument, modelVersionId: string | null): MappingCache {
    const items = Array.isArray(doc.items) ? doc.items : [];
    return new MappingCache(modelVersionId ?? doc.model_version_id ?? null, items);
  }

  primPathForGuid(ifcGuid: string): string | null {
    return this.guidToPrim.get(ifcGuid) ?? null;
  }

  guidForPrimPath(primPath: string): string | null {
    return this.primToGuid.get(primPath) ?? null;
  }

  get mappedCount(): number {
    return this.guidToPrim.size;
  }
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/governance/mappingCache.test.ts`
Expected: PASS — 4 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/mappingCache.ts web-viewer-sample/src/console/governance/mappingCache.test.ts
git commit -m "feat(console-mvp): MappingCache 雙向 ifc_guid↔usd_prim_path（鎖單一 model version）"
```

---

### Task A2: MappingCache — 拒絕 fake mapping + coverage%

**Objective:** fake/smoke mapping 不得當真實覆蓋；誠實算 coverage%（denominator = source_ifc_entity_count）。

**Files:**
- Modify: `web-viewer-sample/src/console/governance/mappingCache.ts`
- Test: `web-viewer-sample/src/console/governance/mappingCache.test.ts`（追加）

**Step 1: Write failing test（追加到既有 describe 後）**

```ts
// 追加至 mappingCache.test.ts 末端
import { isFakeMappingDocument } from "../../types/mapping";

describe("MappingCache fake 隔離 + coverage（誠實，不灌水）", () => {
  it("fake mapping document 被拒（fromDocument 標 fake，雙向 index 為空）", () => {
    const fakeDoc = { mock: true, items: [{ ifc_guid: "g", usd_prim_path: "/World/X" }] };
    expect(isFakeMappingDocument(fakeDoc)).toBe(true); // 重用既有工具
    const cache = MappingCache.fromDocument(fakeDoc, "mv_fake");
    expect(cache.isFake).toBe(true);
    expect(cache.primPathForGuid("g")).toBeNull(); // fake → 不提供真實對映
  });

  it("coverage% = mapped_count / source_ifc_entity_count（denominator 為來源 IFC 實體數）", () => {
    const doc = {
      mock: false,
      model_version_id: "mv_cov",
      summary: { mapped_count: 90, source_ifc_entity_count: 100, fake_mapping_count: 0 },
      items: [{ ifc_guid: "g", usd_prim_path: "/World/X" }],
    } as ElementMappingDocument & { summary: { source_ifc_entity_count: number } };
    const cache = MappingCache.fromDocument(doc, "mv_cov");
    expect(cache.coverageRatio()).toBeCloseTo(0.9, 5);
  });

  it("無 source_ifc_entity_count 時 coverage 回 null（誠實，不假裝 1.0）", () => {
    const doc = { mock: false, summary: { mapped_count: 5, fake_mapping_count: 0 }, items: [] };
    const cache = MappingCache.fromDocument(doc, "mv_x");
    expect(cache.coverageRatio()).toBeNull();
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/mappingCache.test.ts`
Expected: FAIL — `cache.isFake` / `cache.coverageRatio` 不存在。

**Step 3: Write minimal implementation（擴充 mappingCache.ts）**

把 `import` 補上 `isFakeMappingDocument`，並擴充 class：

```ts
// mappingCache.ts — 修改 import 行
import { isFakeMappingDocument, type ElementMappingDocument, type ElementMappingItem } from "../../types/mapping";

// constructor 增加 isFake + sourceEntityCount 欄位（建構時帶入）：
export class MappingCache {
  readonly modelVersionId: string | null;
  readonly isFake: boolean;
  private readonly sourceEntityCount: number | null;
  private readonly guidToPrim: Map<string, string>;
  private readonly primToGuid: Map<string, string>;

  private constructor(
    modelVersionId: string | null,
    items: ElementMappingItem[],
    isFake: boolean,
    sourceEntityCount: number | null,
  ) {
    this.modelVersionId = modelVersionId;
    this.isFake = isFake;
    this.sourceEntityCount = sourceEntityCount;
    this.guidToPrim = new Map();
    this.primToGuid = new Map();
    if (!isFake) {
      // fake mapping 不建真實對映（誠實：不冒充真實覆蓋率 / 不提供假 prim）。
      for (const item of items) {
        if (item.ifc_guid && item.usd_prim_path) {
          this.guidToPrim.set(item.ifc_guid, item.usd_prim_path);
          this.primToGuid.set(item.usd_prim_path, item.ifc_guid);
        }
      }
    }
  }

  static fromDocument(doc: ElementMappingDocument, modelVersionId: string | null): MappingCache {
    const items = Array.isArray(doc.items) ? doc.items : [];
    const isFake = isFakeMappingDocument(doc);
    const summary = doc.summary as { source_ifc_entity_count?: number } | undefined;
    const sourceEntityCount = typeof summary?.source_ifc_entity_count === "number" ? summary.source_ifc_entity_count : null;
    return new MappingCache(modelVersionId ?? doc.model_version_id ?? null, items, isFake, sourceEntityCount);
  }

  coverageRatio(): number | null {
    if (this.isFake) return null; // fake 不算覆蓋率
    if (this.sourceEntityCount === null || this.sourceEntityCount <= 0) return null;
    return this.mappedCount / this.sourceEntityCount;
  }
  // primPathForGuid / guidForPrimPath / mappedCount 保留原樣
}
```

> 註：`ElementMappingSummary`（`types/mapping.ts`）目前無 `source_ifc_entity_count` 欄位；以區域型別斷言讀取即可（不改既有共用型別，YAGNI；若實作階段要正規化再另開 task）。

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/governance/mappingCache.test.ts`
Expected: PASS — 7 passed（4 + 3）。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/mappingCache.ts web-viewer-sample/src/console/governance/mappingCache.test.ts
git commit -m "feat(console-mvp): MappingCache 拒 fake mapping + 誠實 coverage%（denominator=source_ifc_entity_count）"
```

---

### Task A3: GovPanelState — spectator 唯讀 + 等待 viewer

**Objective:** 集中治理面板可操作狀態：spectator → disabled（唯讀）；DataChannel 未就緒 → 等待。

**Files:**
- Create: `web-viewer-sample/src/console/governance/govPanelState.ts`
- Test: `web-viewer-sample/src/console/governance/govPanelState.test.ts`

**Step 1: Write failing test**

```ts
// web-viewer-sample/src/console/governance/govPanelState.test.ts
import { describe, expect, it } from "vitest";
import { resolveGovPanelState } from "./govPanelState";

describe("GovPanelState（spectator 唯讀 / 等待 viewer）", () => {
  it("primary + DataChannel ready → 可操作", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: true });
    expect(s.canOperate).toBe(true);
    expect(s.disabledReason).toBeNull();
  });

  it("spectator → 不可操作（唯讀，誠實表態，非隱藏）", () => {
    const s = resolveGovPanelState({ streamRole: "spectator", dataChannelReady: true });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("spectator_read_only");
  });

  it("DataChannel 未就緒 → 不可操作（等待 viewer 連線，非假按鈕）", () => {
    const s = resolveGovPanelState({ streamRole: "primary", dataChannelReady: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("waiting_viewer");
  });

  it("spectator 優先於 waiting（唯讀無論連線與否都不可操作）", () => {
    const s = resolveGovPanelState({ streamRole: "spectator", dataChannelReady: false });
    expect(s.canOperate).toBe(false);
    expect(s.disabledReason).toBe("spectator_read_only");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/govPanelState.test.ts`
Expected: FAIL — `resolveGovPanelState` 未定義。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/governance/govPanelState.ts
// GovPanelState：集中治理面板可操作狀態。spectator 唯讀（disabled，誠實表態，非隱藏）；
// DataChannel 未就緒 → 等待 viewer 連線（R2）。streamRole 沿用 Window.tsx isSpectatorStreamMode 的語意。
export type StreamRole = "primary" | "spectator";

export interface GovPanelInput {
  streamRole: StreamRole;
  dataChannelReady: boolean;
}

export interface GovPanelState {
  canOperate: boolean;
  disabledReason: "spectator_read_only" | "waiting_viewer" | null;
}

export function resolveGovPanelState(input: GovPanelInput): GovPanelState {
  if (input.streamRole === "spectator") {
    return { canOperate: false, disabledReason: "spectator_read_only" };
  }
  if (!input.dataChannelReady) {
    return { canOperate: false, disabledReason: "waiting_viewer" };
  }
  return { canOperate: true, disabledReason: null };
}

// UI 顯示用文案（誠實，不假裝 ready）。
export const GOV_PANEL_REASON_TEXT: Record<NonNullable<GovPanelState["disabledReason"]>, string> = {
  spectator_read_only: "旁觀者唯讀：治理操作面板僅供檢視，不可建立 / 派工 / 標示 / 匯出",
  waiting_viewer: "等待 viewer 連線：3D 標示需 primary viewer 的 WebRTC DataChannel 就緒",
};
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/governance/govPanelState.test.ts`
Expected: PASS — 4 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/govPanelState.ts web-viewer-sample/src/console/governance/govPanelState.test.ts
git commit -m "feat(console-mvp): GovPanelState spectator 唯讀 + 等待 viewer（誠實 disabled）"
```

---

### Task A4: HighlightBridge — failed 構件 → highlightPrimsRequest（client 主動拉）

**Objective:** 把治理失敗構件用 MappingCache 解出 `usd_prim_path`，組成 `highlightPrimsRequest`（重用既有 builder），交由注入的 sender 送出；未對映 / DataChannel 未就緒誠實回拒，不捏造、不 server-push。

**Files:**
- Create: `web-viewer-sample/src/console/governance/highlightBridge.ts`
- Test: `web-viewer-sample/src/console/governance/highlightBridge.test.ts`

**依據**：`buildHighlightPrimsRequest(items, focusFirst, requestId)`（`clients/streamMessages.ts:51`）+ `severityToColor`（同檔 `:80`）+ `HighlightItem`（`types/streamMessages.ts`）。

**Step 1: Write failing test**

```ts
// web-viewer-sample/src/console/governance/highlightBridge.test.ts
import { describe, expect, it, vi } from "vitest";
import { HighlightBridge } from "./highlightBridge";
import { MappingCache } from "./mappingCache";
import type { ElementMappingDocument } from "../../types/mapping";

const DOC: ElementMappingDocument = {
  mock: false,
  model_version_id: "mv_1",
  summary: { mapped_count: 1, source_ifc_entity_count: 1, fake_mapping_count: 0 },
  items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/IfcWall/_A", ifc_class: "IfcWall", name: "Wall-A" }],
};

describe("HighlightBridge（client 主動拉 → DataChannel，不 server-push）", () => {
  it("有 usd_prim_path 的 failed 構件 → 送出 highlightPrimsRequest（含 prim_path + 顏色 + ifc_guid）", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: { event_type: string; payload: any }[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m as any), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].event_type).toBe("highlightPrimsRequest"); // 既有 Kit 消費的指令（非新發明）
    expect(sent[0].payload.items[0].prim_path).toBe("/World/IfcWall/_A");
    expect(sent[0].payload.items[0].ifc_guid).toBe("GUID_A");
    expect(sent[0].payload.items[0].color).toEqual([1, 0, 0, 1]); // severity=error → 紅（severityToColor）
  });

  it("未對映（usd_prim_path 查不到）→ ok:false reason:unmapped，不送、不捏造 prim", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const sent: unknown[] = [];
    const bridge = new HighlightBridge({ cache, sendMessage: (m) => sent.push(m), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_MISSING", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unmapped");
    expect(sent).toHaveLength(0); // 不送假 prim
  });

  it("DataChannel 未就緒 → ok:false reason:datachannel_not_ready，不送", () => {
    const cache = MappingCache.fromDocument(DOC, "mv_1");
    const send = vi.fn();
    const bridge = new HighlightBridge({ cache, sendMessage: send, dataChannelReady: () => false });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("datachannel_not_ready");
    expect(send).not.toHaveBeenCalled();
  });

  it("fake mapping cache → 一律 unmapped（不冒充可標示）", () => {
    const fakeCache = MappingCache.fromDocument({ mock: true, items: [{ ifc_guid: "GUID_A", usd_prim_path: "/World/X" }] }, "mv_fake");
    const sent: unknown[] = [];
    const bridge = new HighlightBridge({ cache: fakeCache, sendMessage: (m) => sent.push(m), dataChannelReady: () => true });
    const res = bridge.highlightFailed({ ifc_guid: "GUID_A", severity: "error" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unmapped");
    expect(sent).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/highlightBridge.test.ts`
Expected: FAIL — `HighlightBridge` 未定義。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/governance/highlightBridge.ts
// HighlightBridge：治理失敗構件 usd_prim_path → highlightPrimsRequest → 經注入的 sendMessage（既有
// _sendStreamMessage / AppStreamer.sendMessage）走 viewer WebRTC DataChannel 在 3D 標紅。
// 著色走 client 主動拉（client → DataChannel → Kit），不復活 2026-05-21 退役的 server-push highlight。
// 未對映 / DataChannel 未就緒誠實回拒（不捏造 prim、不假裝成功）。
import { buildHighlightPrimsRequest, severityToColor } from "../../clients/streamMessages";
import type { HighlightItem, StreamMessage } from "../../types/streamMessages";
import type { MappingCache } from "./mappingCache";

export interface FailedElement {
  ifc_guid: string;
  severity: string; // error / warning / ...
  label?: string;
  rule_code?: string;
}

export type HighlightResult =
  | { ok: true; primPath: string; requestId: string }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

export interface HighlightBridgeDeps {
  cache: MappingCache;
  sendMessage: (message: StreamMessage) => void;
  dataChannelReady: () => boolean;
}

export class HighlightBridge {
  constructor(private readonly deps: HighlightBridgeDeps) {}

  highlightFailed(failed: FailedElement): HighlightResult {
    if (!this.deps.dataChannelReady()) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    const primPath = this.deps.cache.primPathForGuid(failed.ifc_guid); // fake cache → null
    if (!primPath) {
      return { ok: false, reason: "unmapped" };
    }
    const item: HighlightItem = {
      prim_path: primPath,
      ifc_guid: failed.ifc_guid,
      color: severityToColor(failed.severity),
      label: failed.label || failed.rule_code || failed.ifc_guid,
      source: "governance_failed",
      issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
    };
    const requestId = `gov-highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.deps.sendMessage(buildHighlightPrimsRequest([item], true, requestId));
    return { ok: true, primPath, requestId };
  }

  clear(buildClear: () => StreamMessage): void {
    if (!this.deps.dataChannelReady()) return;
    this.deps.sendMessage(buildClear());
  }
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/governance/highlightBridge.test.ts`
Expected: PASS — 4 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/highlightBridge.ts web-viewer-sample/src/console/governance/highlightBridge.test.ts
git commit -m "feat(console-mvp): HighlightBridge failed→highlightPrimsRequest（client 主動拉，未對映誠實回拒）"
```

---

### Task A5: govEndpoints — guid_exact / coverage gate（誠實降級）

**Objective:** 集中 MVP 強制 identity profile 門檻與 coverage<90% 降級判定（引用既有三份 spec 的數值），不引入新引擎。

**Files:**
- Create: `web-viewer-sample/src/console/governance/govEndpoints.ts`
- Test: `web-viewer-sample/src/console/governance/govEndpoints.test.ts`

**Step 1: Write failing test**

```ts
// web-viewer-sample/src/console/governance/govEndpoints.test.ts
import { describe, expect, it } from "vitest";
import { MVP_IDENTITY_PROFILE, MVP_MIN_COVERAGE, evaluateCoverageGate } from "./govEndpoints";

describe("MVP identity profile + coverage gate（誠實降級，零新引擎）", () => {
  it("MVP 常量：強制 guid_exact、minimum_coverage_ratio=1.0、denominator=source_ifc_entity_count", () => {
    expect(MVP_IDENTITY_PROFILE).toBe("guid_exact");
    expect(MVP_MIN_COVERAGE).toBe(1.0);
  });

  it("coverage 1.0 → pass，不降級", () => {
    const g = evaluateCoverageGate({ coverageRatio: 1.0, isFake: false });
    expect(g.coverageOk).toBe(true);
    expect(g.degraded).toBe(false);
  });

  it("coverage 0.85（<0.9）→ degraded（warn 不 fail，measure-first）", () => {
    const g = evaluateCoverageGate({ coverageRatio: 0.85, isFake: false });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
    expect(g.warnOnly).toBe(true); // runtime-verification-evidence：低覆蓋 warn 不 fail
  });

  it("fake mapping → 不算覆蓋率（degraded，coverageRatio 視為不可信）", () => {
    const g = evaluateCoverageGate({ coverageRatio: null, isFake: true });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
  });

  it("coverage 未知（null，非 fake）→ degraded（不假裝 1.0）", () => {
    const g = evaluateCoverageGate({ coverageRatio: null, isFake: false });
    expect(g.coverageOk).toBe(false);
    expect(g.degraded).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/govEndpoints.test.ts`
Expected: FAIL — 匯出不存在。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/governance/govEndpoints.ts
// MVP 強制 identity profile = guid_exact、coverage = 1.0（Q4）。coverage<90% 觸發降級時，
// 依既有 spec 誠實降級（不捏造、不冒充 guid_exact、不引入新引擎）：
//  - host-native-conversion-authority-service：未對映 entity 報 unmapped/sidecar-only/omitted。
//  - runtime-verification-evidence：measure-first，誠實報 coverage，低覆蓋 warn 不 fail；
//    threshold lock 後 minimum_coverage_ratio=1.0、coverage_denominator=source_ifc_entity_count。
//  - governance-rule-run-authority：不把非 guid_exact 當 guid_exact；fake/smoke 不算真實覆蓋。
export const MVP_IDENTITY_PROFILE = "guid_exact" as const;
export const MVP_MIN_COVERAGE = 1.0 as const;
export const MVP_COVERAGE_DENOMINATOR = "source_ifc_entity_count" as const;
// 低覆蓋 fallback 觸發閾值（<90%）；MVP 強制 1.0 多半不觸發。
export const LOW_COVERAGE_THRESHOLD = 0.9 as const;

export interface CoverageGateInput {
  coverageRatio: number | null; // 來自 MappingCache.coverageRatio()
  isFake: boolean;
}

export interface CoverageGateResult {
  coverageOk: boolean; // 是否達 MVP_MIN_COVERAGE（1.0）
  degraded: boolean;   // 是否進入誠實降級路徑
  warnOnly: boolean;   // measure-first：低覆蓋 warn 不 fail
  profile: typeof MVP_IDENTITY_PROFILE;
  denominator: typeof MVP_COVERAGE_DENOMINATOR;
}

export function evaluateCoverageGate(input: CoverageGateInput): CoverageGateResult {
  const base = { profile: MVP_IDENTITY_PROFILE, denominator: MVP_COVERAGE_DENOMINATOR } as const;
  if (input.isFake || input.coverageRatio === null) {
    // fake / 未知覆蓋：不可信 → 降級（warn 不 fail），不假裝 1.0。
    return { ...base, coverageOk: false, degraded: true, warnOnly: true };
  }
  const coverageOk = input.coverageRatio >= MVP_MIN_COVERAGE;
  return { ...base, coverageOk, degraded: !coverageOk, warnOnly: !coverageOk };
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/governance/govEndpoints.test.ts`
Expected: PASS — 5 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/govEndpoints.ts web-viewer-sample/src/console/governance/govEndpoints.test.ts
git commit -m "feat(console-mvp): MVP guid_exact + coverage gate（誠實降級，引用既有 spec 門檻）"
```

---

## Phase B — overlay 與 operator UI（React，renderToString smoke）

> 測試風格沿用既有 `src/console/console.test.tsx`：`renderToString(<Page/>)` 後對 HTML 斷言 provenance / 誠實 wording / 無假數字。元件皆 function component、props 注入、不自管 WebRTC（便於測試與守邊界）。

### Task B1: GovernanceOverlay — A2/A3/A4/A8 區塊骨架 + provenance

**Objective:** A1–A10 治理 overlay 容器，MVP 只接已有引擎 A2（語意映射）/A3（規則·IDS）/A4（治理分）/A8（Issue·BCF）；A5/A6/A9/A10 標 `p3`/`p4` disabled；無假數字。

**Files:**
- Create: `web-viewer-sample/src/console/GovernanceOverlay.tsx`
- Create: `web-viewer-sample/src/console/governance/overlay.css`
- Test: `web-viewer-sample/src/console/GovernanceOverlay.test.tsx`

**依據既有元件**：`Btn` / `Panel` / `Field` / `Metric` / `ProvTag`（`console/components.tsx`）；`Prov` 型別（`console/data.ts`）。MVP A 編號對映既有引擎見 design §5（A2=diff/語意、A3=rule_engine+ifctester、A4=治理分、A8=issues+bcf）。

**Step 1: Write failing test**

```tsx
// web-viewer-sample/src/console/GovernanceOverlay.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GovernanceOverlay } from "./GovernanceOverlay";

const baseProps = {
  panelState: { canOperate: true, disabledReason: null as null },
  coverage: { coverageOk: true, degraded: false, ratio: 1.0 },
  failedElements: [],
  onHighlight: () => ({ ok: true as const, primPath: "/World/X", requestId: "r1" }),
  onClearHighlight: () => {},
};

describe("GovernanceOverlay A1–A10 overlay（MVP 接 A2/A3/A4/A8）", () => {
  it("含 A2/A3/A4/A8 已有引擎區塊，且標 provenance", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).toContain("A2"); // 轉檔 / 語意映射
    expect(html).toContain("A3"); // 規則庫 / IDS
    expect(html).toContain("A4"); // 完整性 / 治理分
    expect(html).toContain("A8"); // Issue / BCF
    expect(html).toContain("ec-prov"); // provenance 標記存在
  });

  it("A5/A6/A9/A10 標願景且 disabled（不假裝 ready）", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).toContain("A5");
    expect(html).toContain("A9");
    // 願景 phase 標記（PROV_LABEL.p3 / p4）。
    expect(html).toMatch(/願景 · Phase [34]（後端未建）/);
  });

  it("無願景假數字", () => {
    const html = renderToString(<GovernanceOverlay {...baseProps} />);
    expect(html).not.toContain("99.1%");
    expect(html).not.toContain("92.4%");
    expect(html).not.toContain("127 rules");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: FAIL — `GovernanceOverlay` 未定義。

**Step 3: Write minimal implementation**

```tsx
// web-viewer-sample/src/console/GovernanceOverlay.tsx
// A1–A10 治理 overlay 框架：疊在 primary viewer live 3D 右側。MVP 只接已有引擎 A2/A3/A4/A8；
// A5/A6/A9/A10 標願景 disabled（誠實，不假裝 ready）。所有治理動作在 live 3D 上；點 failed 構件
// 經 onHighlight（HighlightBridge）在 3D 標紅。本元件不自管 WebRTC（props 注入），守 console 邊界。
import "./governance/overlay.css";
import { Btn, Panel, ProvTag } from "./components";
import type { Prov } from "./data";
import type { FailedElement, HighlightResult } from "./governance/highlightBridge";
// DRY（E3 type consistency）：直接復用 govPanelState 的 union，不另立平行 OverlayPanelState。
import type { GovPanelState } from "./governance/govPanelState";

export interface GovernanceOverlayProps {
  panelState: GovPanelState;
  coverage: { coverageOk: boolean; degraded: boolean; ratio: number | null };
  failedElements: FailedElement[];
  onHighlight: (failed: FailedElement) => HighlightResult;
  onClearHighlight: () => void;
}

// MVP 接的已有引擎（design §5 權威對映）。
const MVP_ENGINES: { code: string; title: string; prov: Prov }[] = [
  { code: "A2", title: "轉檔 / 語意映射", prov: "asbuilt" },
  { code: "A3", title: "規則庫 / IDS 檢核", prov: "asbuilt" },
  { code: "A4", title: "完整性 / 治理分", prov: "asbuilt" },
  { code: "A8", title: "Issue / BCF", prov: "asbuilt" },
];
// MVP 不含的新引擎（Q3 各自獨立 OpenSpec change）→ 標願景 disabled。
const ROADMAP_ENGINES: { code: string; title: string; prov: Prov }[] = [
  { code: "A5", title: "碰撞 / 空間干涉", prov: "p3" },
  { code: "A6", title: "圖模一致", prov: "p4" },
  { code: "A9", title: "AI 搜尋 / 問答", prov: "p4" },
  { code: "A10", title: "報表 / 稽核 / 封存", prov: "p4" },
];

export function GovernanceOverlay(props: GovernanceOverlayProps) {
  return (
    <div className="gov-overlay" role="complementary" aria-label="A1–A10 治理 overlay">
      <div className="gov-overlay-h">
        <span className="gov-overlay-t">治理 · A1–A10</span>
        <ProvTag prov="asbuilt" />
      </div>

      <Panel title="MVP 已接引擎" sub="A2 語意映射 · A3 規則/IDS · A4 治理分 · A8 Issue/BCF（design §5）" prov="asbuilt">
        {MVP_ENGINES.map((e) => (
          <div className="gov-engine" key={e.code}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <ProvTag prov={e.prov} />
          </div>
        ))}
      </Panel>

      <Panel title="後期願景 · 各自獨立 OpenSpec change" sub="A5/A6/A9/A10 後端未建（Q3）→ disabled，不假裝 ready" prov="asbuilt">
        {ROADMAP_ENGINES.map((e) => (
          <div className="gov-engine roadmap" key={e.code}>
            <span className="gov-engine-code">{e.code}</span>
            <span className="gov-engine-title">{e.title}</span>
            <Btn prov={e.prov} disabled caption="後端未建（願景），各自獨立 OpenSpec change">{e.title}</Btn>
          </div>
        ))}
      </Panel>
    </div>
  );
}
```

並建立 overlay.css（沿用 `--ec-*` token，疊在 viewer 右側）：

```css
/* web-viewer-sample/src/console/governance/overlay.css
 * A1–A10 治理 overlay 容器：疊在 primary viewer live 3D 右側。沿用 edge-console.css 的 --ec-* token。 */
.gov-overlay {
  position: absolute; top: 0; right: 0; width: 340px; height: 100%;
  background: rgba(11, 13, 16, 0.92); color: #e7ebf0;
  border-left: 1px solid #262c33; overflow-y: auto; padding: 12px;
  font: 13px/1.5 ui-monospace, "Cascadia Code", "Consolas", monospace; z-index: 20;
}
.gov-overlay-h { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.gov-overlay-t { color: #76b900; font-weight: 700; letter-spacing: .04em; }
.gov-overlay.gov-readonly { opacity: .98; }
.gov-overlay.gov-readonly .ec-btn:not(.gov-readonly-allowed) { pointer-events: none; opacity: .45; }
.gov-engine { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px dashed #262c33; }
.gov-engine-code { color: #545d68; width: 28px; }
.gov-engine-title { flex: 1; }
.gov-overlay .gov-banner { padding: 8px 10px; border-radius: 4px; margin: 8px 0;
  background: rgba(244, 183, 64, .14); color: #f4b740; border: 1px solid #2f363f; }
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: PASS — 3 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/GovernanceOverlay.tsx web-viewer-sample/src/console/governance/overlay.css web-viewer-sample/src/console/GovernanceOverlay.test.tsx
git commit -m "feat(console-mvp): GovernanceOverlay A2/A3/A4/A8 骨架 + A5/A6/A9/A10 願景 disabled"
```

---

### Task B2: GovernanceOverlay — spectator 唯讀 disabled

**Objective:** spectator 時 overlay 治理動作 disabled（誠實表態唯讀，非隱藏）；DataChannel 未就緒顯「等待 viewer 連線」。

**Files:**
- Modify: `web-viewer-sample/src/console/GovernanceOverlay.tsx`
- Test: `web-viewer-sample/src/console/GovernanceOverlay.test.tsx`（追加）

**Step 1: Write failing test（追加）**

```tsx
// 追加至 GovernanceOverlay.test.tsx
import { GOV_PANEL_REASON_TEXT } from "./governance/govPanelState";

describe("GovernanceOverlay spectator 唯讀 / 等待 viewer（誠實 disabled，非隱藏）", () => {
  it("spectator → 顯示唯讀橫幅且操作鈕 disabled，但面板仍可見（不隱藏）", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: false, disabledReason: "spectator_read_only" }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[{ ifc_guid: "G1", severity: "error" }]}
        onHighlight={() => ({ ok: true, primPath: "/World/X", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain(GOV_PANEL_REASON_TEXT.spectator_read_only); // 誠實表態
    expect(html).toContain("gov-readonly"); // 容器標唯讀（CSS 禁用操作）
    // 面板內容仍渲染（不隱藏）：A2/A3/A4/A8 仍在。
    expect(html).toContain("A2");
  });

  it("DataChannel 未就緒 → 顯示等待 viewer 連線文案", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: false, disabledReason: "waiting_viewer" }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[]}
        onHighlight={() => ({ ok: false, reason: "datachannel_not_ready" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain(GOV_PANEL_REASON_TEXT.waiting_viewer);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: FAIL — overlay 尚未渲染唯讀橫幅 / `gov-readonly` class。

**Step 3: Write minimal implementation（擴充 GovernanceOverlay.tsx）**

在 `GovernanceOverlay` 加入 import 與唯讀橫幅，root div 依 `panelState` 加 class：

```tsx
// GovernanceOverlay.tsx — 增加 import
import { GOV_PANEL_REASON_TEXT } from "./governance/govPanelState";

// 在 return 的 root div：根據 panelState 加 class + 橫幅
export function GovernanceOverlay(props: GovernanceOverlayProps) {
  const readOnly = !props.panelState.canOperate;
  const reason = props.panelState.disabledReason;
  return (
    <div className={`gov-overlay ${readOnly ? "gov-readonly" : ""}`} role="complementary" aria-label="A1–A10 治理 overlay">
      <div className="gov-overlay-h">
        <span className="gov-overlay-t">治理 · A1–A10</span>
        <ProvTag prov="asbuilt" />
      </div>
      {reason && <div className="gov-banner">{GOV_PANEL_REASON_TEXT[reason]}</div>}
      {/* ...原 MVP_ENGINES / ROADMAP_ENGINES Panel 不變... */}
    </div>
  );
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: PASS — 5 passed（3 + 2）。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/GovernanceOverlay.tsx web-viewer-sample/src/console/GovernanceOverlay.test.tsx
git commit -m "feat(console-mvp): GovernanceOverlay spectator 唯讀 disabled + 等待 viewer 文案（誠實非隱藏）"
```

---

### Task B3: GovernanceOverlay — failed 構件清單 + 點選在 3D 標紅 + 未對映誠實

**Objective:** 列治理失敗構件，按「在 3D 標示」呼叫 `onHighlight`（HighlightBridge）；未對映（`usd_prim_path=null`）誠實顯「無法在 3D 標示」+ coverage%，不捏造 prim。

**Files:**
- Modify: `web-viewer-sample/src/console/GovernanceOverlay.tsx`
- Test: `web-viewer-sample/src/console/GovernanceOverlay.test.tsx`（追加）

**Step 1: Write failing test（追加）**

```tsx
// 追加至 GovernanceOverlay.test.tsx
describe("GovernanceOverlay failed 構件 → 3D 標紅 / 未對映誠實", () => {
  it("列出 failed 構件（含 rule_code / ifc_guid）且提供「在 3D 標示」鈕", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: true, degraded: false, ratio: 1.0 }}
        failedElements={[{ ifc_guid: "GUID_A", severity: "error", rule_code: "DOOR-FIRERATING-REQUIRED" }]}
        onHighlight={() => ({ ok: true, primPath: "/World/IfcWall/_A", requestId: "r" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain("GUID_A");
    expect(html).toContain("DOOR-FIRERATING-REQUIRED");
    expect(html).toContain("在 3D 標示");
  });

  it("coverage 降級（<90%）→ 顯示 coverage% 與「部分構件無法在 3D 標示」（誠實，不捏造）", () => {
    const html = renderToString(
      <GovernanceOverlay
        panelState={{ canOperate: true, disabledReason: null }}
        coverage={{ coverageOk: false, degraded: true, ratio: 0.85 }}
        failedElements={[{ ifc_guid: "GUID_X", severity: "error" }]}
        onHighlight={() => ({ ok: false, reason: "unmapped" })}
        onClearHighlight={() => {}}
      />,
    );
    expect(html).toContain("85"); // coverage% 顯示（0.85 → 85%）
    expect(html).toContain("無法在 3D 標示"); // 誠實降級文案
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: FAIL — failed 清單 / coverage% 區塊尚未渲染。

**Step 3: Write minimal implementation（擴充 GovernanceOverlay.tsx）**

新增 failed 構件 Panel（在 roadmap Panel 前）。用 `useState` 記每筆 highlight 結果，未對映顯誠實文案：

```tsx
// GovernanceOverlay.tsx — 增加 import 與 state
import { useState } from "react";
import { Field, Metric } from "./components";

// 在元件內：
const [lastResult, setLastResult] = useState<Record<string, string>>({});
const coveragePct = props.coverage.ratio === null ? null : Math.round(props.coverage.ratio * 100);

const handleHighlight = (failed: FailedElement) => {
  const res = props.onHighlight(failed);
  setLastResult((prev) => ({
    ...prev,
    [failed.ifc_guid]: res.ok ? `已在 3D 標示：${res.primPath}` : (res.reason === "unmapped" ? "無法在 3D 標示（未對映 usd_prim_path）" : "等待 viewer 連線（DataChannel 未就緒）"),
  }));
};

// 在 return 內，roadmap Panel 之前插入：
<Panel
  title="治理失敗構件 · 在 live 3D 標示"
  sub="點 failed 構件 → HighlightBridge 經 DataChannel 在 3D 標紅（client 主動拉，非 server-push）"
  prov="asbuilt"
>
  {props.coverage.degraded && (
    <div className="gov-banner">
      coverage {coveragePct === null ? "未知" : `${coveragePct}%`}（&lt; 100%）：部分未對映構件
      <strong> 無法在 3D 標示</strong>，依既有 spec 誠實降級，不捏造 prim path。
    </div>
  )}
  {!props.coverage.degraded && coveragePct !== null && (
    <Metric value={`${coveragePct}%`} label="mapping coverage" />
  )}
  {props.failedElements.length === 0 ? (
    <p className="ec-note">目前無治理失敗構件（或尚未跑檢核）。</p>
  ) : (
    <table className="ec-table">
      <thead><tr><th>rule_code</th><th>severity</th><th>ifc_guid</th><th /></tr></thead>
      <tbody>
        {props.failedElements.slice(0, 50).map((f) => (
          <tr key={f.ifc_guid}>
            <td>{f.rule_code ?? "—"}</td>
            <td>{f.severity}</td>
            <td>{f.ifc_guid}</td>
            <td>
              <Btn caption="highlightPrimsRequest（client 主動拉）" disabled={!props.panelState.canOperate} onClick={() => handleHighlight(f)}>
                在 3D 標示
              </Btn>
              {lastResult[f.ifc_guid] && <span className="ec-note" style={{ marginLeft: 6 }}>{lastResult[f.ifc_guid]}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )}
  <Field k="3D 著色機制" v="client highlightPrimsRequest 經 viewer DataChannel；不復活 2026-05-21 退役 server-push" prov="asbuilt" />
</Panel>
```

> 註：`ec-table` / `ec-note` 已存在於 `edge-console.css`；overlay 內可用（class 全域）。若要 scope，於 overlay.css 補同名輔助樣式（非必需）。

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/GovernanceOverlay.test.tsx`
Expected: PASS — 7 passed（5 + 2）。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/GovernanceOverlay.tsx web-viewer-sample/src/console/GovernanceOverlay.test.tsx
git commit -m "feat(console-mvp): overlay failed 構件清單→3D 標紅 + 未對映/降級誠實顯 coverage%"
```

---

### Task B4: IntakeSelectPage — A1 進件「選現成模型」（不手填路徑）

**Objective:** `/console/intake` 的 A1 進件：從既有 `coordinatorClient.listIfcReady` 列現成模型 job 供選取，**不要求手填模型路徑**。

**Files:**
- Create: `web-viewer-sample/src/console/IntakeSelectPage.tsx`
- Test: `web-viewer-sample/src/console/IntakeSelectPage.test.tsx`

**依據**：`coordinatorClient.listIfcReady(limit)` 回 `{ count, items: IfcReadyListItem[] }`（`console/coordinatorClient.ts:122`）；`IfcReadyListItem` 含 `expected_stage_url` / `review_session_id`。

**Step 1: Write failing test**

```tsx
// web-viewer-sample/src/console/IntakeSelectPage.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IntakeSelectPage } from "./IntakeSelectPage";

describe("IntakeSelectPage A1 進件（選現成模型，不手填路徑）", () => {
  it("呈現「選現成模型」UI 且不含手填模型路徑 input", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("選取現成模型"); // 選取式 UI
    expect(html).toContain("/api/external/ifc-ready"); // 真實端點來源（誠實）
    // 不得出現「手填路徑」式的可編輯模型路徑欄位（誠實鐵律：不手填）。
    expect(html).not.toMatch(/placeholder="[^"]*模型[^"]*路徑/);
    expect(html).not.toMatch(/placeholder="[^"]*\.ifc/);
  });

  it("標 provenance 且只打 coordinator :8004（不直連內部埠）", () => {
    const html = renderToString(<IntakeSelectPage />);
    expect(html).toContain("ec-prov");
    expect(html).not.toContain(":49102");
    expect(html).not.toContain(":49101");
    expect(html).not.toContain(":49100");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/IntakeSelectPage.test.tsx`
Expected: FAIL — `IntakeSelectPage` 未定義。

**Step 3: Write minimal implementation**

```tsx
// web-viewer-sample/src/console/IntakeSelectPage.tsx
// /console/intake A1 進件：從 coordinator 既有 /api/external/ifc-ready 列現成模型 job 供「選取」，
// 不要求操作員手填模型檔案路徑（誠實鐵律 + spec：A1 進件於現成清單選取）。只打 coordinator :8004。
import { useCallback, useEffect, useState } from "react";
import { Btn, Panel } from "./components";
import { coordinatorClient, type IfcReadyListItem } from "./coordinatorClient";

export function IntakeSelectPage() {
  const [jobs, setJobs] = useState<IfcReadyListItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      // 只列「有轉換產出 expected_stage_url」的 job 作可選現成模型（誠實：可審查者才可選）。
      const { items } = await coordinatorClient.listIfcReady(50);
      setJobs(items.filter((j) => j.expected_stage_url));
    } catch (e) {
      setErr(`未連線 coordinator /api/external/ifc-ready：${String(e)}`); // 後端離線誠實顯示
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <h1>模型進件 · A1（選取現成模型）</h1>
      <p className="ec-lead">
        從 coordinator <code>/api/external/ifc-ready</code> 列出已轉換、可審查的現成模型，
        直接<strong>選取</strong>進件 —— 不需手動輸入模型檔案路徑。
      </p>
      <Panel
        title="選取現成模型 · IFC-ready（已轉換）"
        sub="GET /api/external/ifc-ready?limit=1..100 · 只列有 expected_stage_url 的 job"
        prov="asbuilt"
        actions={<Btn disabled={busy} caption="GET /api/external/ifc-ready" onClick={load}>{busy ? "讀取中…" : "重新整理"}</Btn>}
      >
        {err && <p className="ec-warn-note">{err}</p>}
        {jobs.length === 0 && !err ? (
          <p className="ec-note">目前無可選現成模型（coordinator 已連線，佇列為空——非錯誤）。</p>
        ) : (
          <table className="ec-table">
            <thead><tr><th>選取</th><th>ifc_ready_job_id</th><th>conversion</th><th>session</th></tr></thead>
            <tbody>
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.ifc_ready_job_id}>
                  <td>
                    <input
                      type="radio"
                      name="intake-model"
                      checked={selected === j.ifc_ready_job_id}
                      onChange={() => setSelected(j.ifc_ready_job_id)}
                    />
                  </td>
                  <td>{j.ifc_ready_job_id}</td>
                  <td>{j.conversion_status ?? "—"}</td>
                  <td>{j.review_session_id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ec-note">進件來源為現成清單選取；模型路徑由 coordinator / conversion authority 持有，前端不手填、不直連內部埠。</p>
      </Panel>
    </>
  );
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/IntakeSelectPage.test.tsx`
Expected: PASS — 2 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/IntakeSelectPage.tsx web-viewer-sample/src/console/IntakeSelectPage.test.tsx
git commit -m "feat(console-mvp): IntakeSelectPage A1 進件選現成模型（不手填路徑，只打 :8004）"
```

---

### Task B5: OperatorConsole — 三頁獨立殼（不含 A1–A10 overlay）

**Objective:** `#/console/coordinator|intake|runtime` 三個獨立 operator 頁（複用既有 `CoordinatorPage`/`RuntimePage` + 新 `IntakeSelectPage`），**不混入 A1–A10 治理 overlay**。

**Files:**
- Create: `web-viewer-sample/src/console/OperatorConsole.tsx`
- Test: `web-viewer-sample/src/console/OperatorConsole.test.tsx`

**依據**：既有 `usePageHash` 零依賴 hash 路由（`EdgeConsole.tsx:21`）；既有 `CoordinatorPage` / `RuntimePage`（`pages.tsx`）；`edge-console.css` 樣式。

**Step 1: Write failing test**

```tsx
// web-viewer-sample/src/console/OperatorConsole.test.tsx
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatorBody } from "./OperatorConsole";

describe("OperatorConsole 三頁獨立（不含 A1–A10 overlay）", () => {
  it("coordinator 頁渲染 Coordinator 控制台且不含治理 overlay 容器", () => {
    const html = renderToString(<OperatorBody page="coordinator" />);
    expect(html).toContain("Coordinator"); // 控制台
    expect(html).not.toContain("gov-overlay"); // 不混入 A1–A10 overlay
  });

  it("intake 頁渲染選現成模型且不含治理 overlay", () => {
    const html = renderToString(<OperatorBody page="intake" />);
    expect(html).toContain("選取現成模型");
    expect(html).not.toContain("gov-overlay");
  });

  it("runtime 頁渲染 Runtime 狀態且不含治理 overlay", () => {
    const html = renderToString(<OperatorBody page="runtime" />);
    expect(html).toContain("Runtime");
    expect(html).not.toContain("gov-overlay");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/OperatorConsole.test.tsx`
Expected: FAIL — `OperatorBody` 未定義。

**Step 3: Write minimal implementation**

```tsx
// web-viewer-sample/src/console/OperatorConsole.tsx
// 三個獨立 operator 頁（非 viewer overlay）：/console/coordinator|intake|runtime。
// 沿用既有零依賴 hash 路由。SHALL NOT 混入 A1–A10 治理 overlay（A1–A10 只疊在 primary viewer）。
import { useEffect, useState } from "react";
import "./edge-console.css";
import { CoordinatorPage, RuntimePage } from "./pages";
import { IntakeSelectPage } from "./IntakeSelectPage";

export type OperatorPage = "coordinator" | "intake" | "runtime";

function readPage(): OperatorPage {
  const h = window.location.hash.replace(/^#\/?console\/?/, "").replace(/^#/, "");
  if (h === "intake") return "intake";
  if (h === "runtime") return "runtime";
  return "coordinator";
}

// 純 body（便於測試，不依賴 window.location）。
export function OperatorBody({ page }: { page: OperatorPage }) {
  if (page === "intake") return <IntakeSelectPage />;
  if (page === "runtime") return <RuntimePage />;
  return <CoordinatorPage />;
}

const NAV: { key: OperatorPage; label: string }[] = [
  { key: "coordinator", label: "Coordinator 控制台" },
  { key: "intake", label: "模型進件（A1）" },
  { key: "runtime", label: "Runtime 狀態" },
];

export default function OperatorConsole() {
  const [page, setPage] = useState<OperatorPage>(readPage);
  useEffect(() => {
    const on = () => setPage(readPage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (k: OperatorPage) => { window.location.hash = `/console/${k}`; setPage(k); };

  return (
    <div className="ec-root">
      <header className="ec-top">
        <span className="ec-brand">AI · BIM Governance</span>
        <span className="ec-sub">OPERATOR CONSOLE · COORDINATOR 8004</span>
      </header>
      <nav className="ec-nav">
        <div className="ec-group">OPERATOR</div>
        {NAV.map((n) => (
          <button key={n.key} className={page === n.key ? "active" : ""} onClick={() => go(n.key)}>{n.label}</button>
        ))}
      </nav>
      <main className="ec-main"><OperatorBody page={page} /></main>
      <footer className="ec-foot"><span>operator 頁不含 A1–A10 治理 overlay · 治理只疊在 primary viewer</span></footer>
    </div>
  );
}
```

**Step 4: Run test to verify pass**

Run: `npm run test -- src/console/OperatorConsole.test.tsx`
Expected: PASS — 3 passed。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/OperatorConsole.tsx web-viewer-sample/src/console/OperatorConsole.test.tsx
git commit -m "feat(console-mvp): OperatorConsole 三頁獨立殼（coordinator/intake/runtime，不含治理 overlay）"
```

---

## Phase C — 接進 viewer（漸進式重構，R1 高風險，逐 task 後 viewer 仍可跑）

> **重要（Q1 漸進式 + R1）**：本 Phase 動 `main.tsx` / `Window.tsx`，是已驗證 viewer 的核心。**每個 task 前先跑 `gitnexus_impact({target, direction:"upstream"})`，HIGH/CRITICAL 先回報**；每個 task 後 `npm run build` 必須通過、`<App/>` viewer 行為不變、overlay 預設不破壞既有畫面。

### Task C1: main.tsx — operator 路由分流（保留既有 viewer）

**Objective:** `#/console/...` 或 `/console...` 路徑掛 `<OperatorConsole/>`；其餘維持 `<App/>`（viewer）不變。

**Files:**
- Modify: `web-viewer-sample/src/main.tsx:36-40`
- Test: `web-viewer-sample/src/console/routing.test.ts`（新建，測純函式路由判定）

**Step 0: impact**

跑 `gitnexus_impact({target: "main", direction: "upstream"})`（entrypoint，預期 blast radius 小）。回報後續。

**Step 1: Write failing test（抽純函式測，不依賴 ReactDOM）**

```ts
// web-viewer-sample/src/console/routing.test.ts
import { describe, expect, it } from "vitest";
import { isOperatorConsolePath } from "./routing";

describe("operator console 路由判定（保留既有 viewer）", () => {
  it("/console、/console/coordinator、#/console/intake → operator", () => {
    expect(isOperatorConsolePath("/console", "")).toBe(true);
    expect(isOperatorConsolePath("/console/coordinator", "")).toBe(true);
    expect(isOperatorConsolePath("/", "#/console/intake")).toBe(true);
  });
  it("一般 viewer 路徑（含 ?session=）→ 非 operator（維持 <App/>）", () => {
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/viewer", "")).toBe(false);
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/routing.test.ts`
Expected: FAIL — `isOperatorConsolePath` 未定義。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/routing.ts
// operator console 路由判定（純函式，便於測試）。pathname /console[/...] 或 hash #/console[/...]
// 掛 OperatorConsole；其餘維持既有 viewer <App/>（含 ?session= bootstrap）。
export function isOperatorConsolePath(pathname: string, hash: string): boolean {
  if (/(^|\/)console(\/|$)/.test(pathname)) return true;
  if (/^#\/?console(\/|$)/.test(hash)) return true;
  return false;
}
```

改 `main.tsx`（保留既有 `?session=` bootstrap 與 EdgeConsole 既有掛載不破壞——本 MVP 新增 OperatorConsole 分支；既有 `EdgeConsole` 維持為 legacy，或保留供舊 hash，不刪）：

```tsx
// main.tsx — 修改 import 與分流（替換 36-40 行區段）
import OperatorConsole from "./console/OperatorConsole";
import { isOperatorConsolePath } from "./console/routing";

// /console[/...] 或 #/console[/...] 掛統一治理控制台 operator 三頁；其餘維持既有 viewer App。
const useOperatorConsole = isOperatorConsolePath(window.location.pathname, window.location.hash);
ReactDOM.createRoot(document.getElementById("root")!).render(
    useOperatorConsole ? <OperatorConsole /> : <App />
);
```

> 註：既有 `EdgeConsole` import 若不再使用會被 `noUnusedLocals` 擋。處理：本 task 以 `OperatorConsole` 取代 `EdgeConsole` 的 `/console` 掛載（OperatorConsole 是 MVP 的三頁殼）。移除未用的 `EdgeConsole` import（`EdgeConsole.tsx` 檔保留，不刪，避免動到既有測試 `console.test.tsx` 對 `EdgeConsole` 的引用）。

**Step 4: Run test + build**

Run: `npm run test -- src/console/routing.test.ts` → Expected: PASS（2 passed）。
Run: `npm run build` → Expected: 成功（無 `noUnusedLocals` 錯誤、無型別錯誤）。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/routing.ts web-viewer-sample/src/console/routing.test.ts web-viewer-sample/src/main.tsx
git commit -m "feat(console-mvp): main.tsx 路由分流掛 OperatorConsole（保留既有 viewer <App/>）"
```

---

### Task C2: Window.tsx — overlay 掛載點（spectator 判定 + 預設不破壞 viewer）

**Objective:** 在 viewer render 樹疊上 `<GovernanceOverlay/>`（最小掛載），用既有 `isSpectatorStreamMode` + DataChannel 就緒狀態算 GovPanelState；overlay 預設可見但不改既有 viewer 行為。

**Files:**
- Modify: `web-viewer-sample/src/Window.tsx`（render 區 + 一個 helper）
- Test: `web-viewer-sample/src/console/governance/windowOverlayGlue.test.ts`（新建，測 glue 純函式）

**依據**：`isSpectatorStreamMode()`（`Window.tsx:188`）；DataChannel 就緒 ≈ `state.showStream && _hasRemoteVideoFrame()`（viewer 已連線且有畫面，見 `Window.tsx` `_onStreamStarted` / `_hasRemoteVideoFrame`）。為守邊界與可測，先抽一個純函式 glue。

**Step 0: impact（必跑，R1）**

跑 `gitnexus_impact({target: "Window", direction: "upstream"})` 與 `gitnexus_impact({target: "_sendStreamMessage", direction: "upstream"})`。**若回 HIGH/CRITICAL 先回報再續**（render 區改動風險高）。

**Step 1: Write failing test（glue 純函式）**

```ts
// web-viewer-sample/src/console/governance/windowOverlayGlue.test.ts
import { describe, expect, it } from "vitest";
import { deriveOverlayInputs } from "./windowOverlayGlue";

describe("Window overlay glue（spectator + DataChannel 就緒 → GovPanelState）", () => {
  it("primary + stream 已連線有畫面 → 可操作", () => {
    const r = deriveOverlayInputs({ spectator: false, streamReady: true });
    expect(r.streamRole).toBe("primary");
    expect(r.panelState.canOperate).toBe(true);
  });
  it("spectator → 唯讀（無論串流）", () => {
    const r = deriveOverlayInputs({ spectator: true, streamReady: true });
    expect(r.streamRole).toBe("spectator");
    expect(r.panelState.canOperate).toBe(false);
    expect(r.panelState.disabledReason).toBe("spectator_read_only");
  });
  it("primary + 串流未就緒 → 等待 viewer", () => {
    const r = deriveOverlayInputs({ spectator: false, streamReady: false });
    expect(r.panelState.canOperate).toBe(false);
    expect(r.panelState.disabledReason).toBe("waiting_viewer");
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/windowOverlayGlue.test.ts`
Expected: FAIL — `deriveOverlayInputs` 未定義。

**Step 3: Write minimal implementation**

```ts
// web-viewer-sample/src/console/governance/windowOverlayGlue.ts
// Window.tsx 與 overlay 之間的純函式膠水：把 viewer 的 spectator / 串流就緒狀態轉成 GovPanelState 輸入。
// DataChannel 就緒以「串流已連線且有畫面」近似（viewer 已可送 _sendStreamMessage）。
import { resolveGovPanelState, type GovPanelState, type StreamRole } from "./govPanelState";

export interface ViewerOverlayStatus {
  spectator: boolean;
  streamReady: boolean; // = showStream && hasRemoteVideoFrame()
}

export interface OverlayInputs {
  streamRole: StreamRole;
  dataChannelReady: boolean;
  panelState: GovPanelState;
}

export function deriveOverlayInputs(status: ViewerOverlayStatus): OverlayInputs {
  const streamRole: StreamRole = status.spectator ? "spectator" : "primary";
  const dataChannelReady = status.streamReady;
  return { streamRole, dataChannelReady, panelState: resolveGovPanelState({ streamRole, dataChannelReady }) };
}
```

改 `Window.tsx` render（最小掛載，**在既有 viewer 容器內疊一層 overlay，不改既有子樹**）：

```tsx
// Window.tsx — 增加 import（檔頭 import 區）
import { GovernanceOverlay } from "./console/GovernanceOverlay";
import { deriveOverlayInputs } from "./console/governance/windowOverlayGlue";
import { HighlightBridge, type FailedElement } from "./console/governance/highlightBridge";
import { buildClearHighlightRequest } from "./clients/streamMessages";

// 在 class 內新增（用既有 isSpectatorStreamMode；MappingCache 由 mapping 載入後設，初期可為 null）：
private _overlayHighlight(failed: FailedElement) {
  // MappingCache 初版可由 this.state.mappingItems 即時建（Phase D 接真 mapping）；此處骨架先回 unmapped。
  // 真正接線在 Task C3：用當前 model version 的 MappingCache。
  const bridge = new HighlightBridge({
    cache: this._mappingCache ?? ({ primPathForGuid: () => null } as never),
    sendMessage: (m) => this._sendStreamMessage(m),
    dataChannelReady: () => this.state.showStream && this._hasRemoteVideoFrame(),
  });
  return bridge.highlightFailed(failed);
}

// 在 render() 的 viewer 主容器 return 裡，最外層 div 末端（既有子樹之後）疊上：
{this.state.showStream && (() => {
  const inputs = deriveOverlayInputs({ spectator: isSpectatorStreamMode(), streamReady: this._hasRemoteVideoFrame() });
  return (
    <GovernanceOverlay
      panelState={inputs.panelState}
      coverage={{ coverageOk: true, degraded: false, ratio: this._mappingCache?.coverageRatio() ?? null }}
      failedElements={this.state.govFailedElements ?? []}
      onHighlight={(f) => this._overlayHighlight(f)}
      onClearHighlight={() => { if (inputs.panelState.canOperate) this._sendStreamMessage(buildClearHighlightRequest()); }}
    />
  );
})()}
```

並在 `Window` 加欄位宣告：`private _mappingCache: import("./console/governance/mappingCache").MappingCache | null = null;`，state 增 `govFailedElements?: FailedElement[]`（型別加入 AppState）。

> **守則**：overlay 疊在既有 viewer 容器**之上**（`position:absolute`，overlay.css 已設 `z-index:20`），不改既有 video / USDStage / DemoControlPanel 子樹結構。`showStream=false` 時不渲染 overlay（不擋 loading 畫面）。

**Step 4: Run test + build + detect_changes**

Run: `npm run test -- src/console/governance/windowOverlayGlue.test.ts` → PASS（3 passed）。
Run: `npm run build` → 成功（型別、未用變數皆過）。
Run: `gitnexus_detect_changes()` → 確認只動到 `Window.tsx` + 新 glue（scope 不外溢）。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/windowOverlayGlue.ts web-viewer-sample/src/console/governance/windowOverlayGlue.test.ts web-viewer-sample/src/Window.tsx
git commit -m "feat(console-mvp): Window.tsx 疊 GovernanceOverlay（spectator 唯讀，保留既有 viewer 子樹）"
```

---

### Task C3: Window.tsx — 餵 MappingCache + 點 3D 反查 ifc_guid

**Objective:** 當前 model version 的 `element_mapping` 載入後建 MappingCache（鎖該版本）；既有 mapping 載入流程（`_loadElementMapping`）完成時設 `this._mappingCache`；點 3D 構件（既有 prim 選取回呼）經 MappingCache 反查 ifc_guid（雙向打通的「點 3D → GUID」方向）。

**Files:**
- Modify: `web-viewer-sample/src/Window.tsx`（mapping 載入完成處 + prim 選取回呼處）
- Test: `web-viewer-sample/src/console/governance/mappingCache.test.ts`（追加「點 3D 反查」整合式純函式測）

**依據**：既有 `_loadElementMapping`（`Window.tsx:1233`，已 fetch + 解析 `ElementMappingDocument`、已過 fake 檢查）；既有 prim 選取在 `_onSelectUSDPrims`（`Window.tsx:1196`，拿到 prim path）。`currentModelVersionId` 在 state。

**Step 0: impact**

跑 `gitnexus_impact({target: "_loadElementMapping", direction: "upstream"})` 與 `gitnexus_impact({target: "_onSelectUSDPrims", direction: "upstream"})`。回報。

**Step 1: Write failing test（追加 mappingCache.test.ts：反查方向已有，補「鎖 version 後換版本需重建」誠實邊界）**

```ts
// 追加至 mappingCache.test.ts
describe("MappingCache 鎖單一 model version（Q2：不跨版本失效）", () => {
  it("belongsTo 判定當前鎖定版本（不同版本回 false，提示需重建）", () => {
    const doc: ElementMappingDocument = { mock: false, model_version_id: "mv_1", summary: { mapped_count: 1, fake_mapping_count: 0 }, items: [{ ifc_guid: "g", usd_prim_path: "/W/x" }] };
    const cache = MappingCache.fromDocument(doc, "mv_1");
    expect(cache.belongsTo("mv_1")).toBe(true);
    expect(cache.belongsTo("mv_2")).toBe(false); // 換版本 → 不複用舊 cache（誠實，不跨版本智能失效）
  });
});
```

**Step 2: Run test to verify failure**

Run: `npm run test -- src/console/governance/mappingCache.test.ts`
Expected: FAIL — `belongsTo` 未定義。

**Step 3: Write minimal implementation**

擴充 `mappingCache.ts`：

```ts
// mappingCache.ts — class 內新增
belongsTo(modelVersionId: string | null): boolean {
  return this.modelVersionId !== null && this.modelVersionId === modelVersionId;
}
```

改 `Window.tsx`：在 `_loadElementMapping` 成功解析 `payload`（`ElementMappingDocument`）後，建/換 MappingCache（鎖當前版本）：

```tsx
// Window.tsx — _loadElementMapping 內，解析出 payload 與 items 後追加：
import { MappingCache } from "./console/governance/mappingCache";
// ...
// 鎖當前 model version；換版本則重建（Q2：不跨版本智能失效）。
const mvId = this.state.currentModelVersionId;
if (!this._mappingCache || !this._mappingCache.belongsTo(mvId)) {
  this._mappingCache = MappingCache.fromDocument(payload, mvId);
}
```

在 `_onSelectUSDPrims`（點 3D 構件）追加反查 ifc_guid（帶進治理用，先記事件，Phase D 接 overlay）：

```tsx
// Window.tsx — _onSelectUSDPrims 內，拿到 paths 後追加：
const firstPath = paths[0];
if (firstPath && this._mappingCache) {
  const guid = this._mappingCache.guidForPrimPath(firstPath);
  this._appendReviewEvent(guid ? `點選 3D 構件 → ifc_guid=${guid}（帶進治理）` : `點選 3D 構件 ${firstPath} → 無對映 ifc_guid`);
}
```

**Step 4: Run test + build + detect_changes**

Run: `npm run test -- src/console/governance/mappingCache.test.ts` → PASS（8 passed）。
Run: `npm run build` → 成功。
Run: `gitnexus_detect_changes()` → 只動 `Window.tsx` + `mappingCache.ts`。

**Step 5: Commit**

```bash
git add web-viewer-sample/src/console/governance/mappingCache.ts web-viewer-sample/src/Window.tsx
git commit -m "feat(console-mvp): Window 餵 MappingCache（鎖 model version）+ 點 3D 反查 ifc_guid"
```

---

### Task C4: 全套件回歸 + struct-log gate

**Objective:** 確認 Phase A–C 全綠、build 通過、既有 viewer 測試與 struct-log 未壞。

**Files:** 無新檔（驗證 task）。

**Step 1: 全測試**

Run: `npm run test`
Expected: 既有 + 新增測試全綠（含 `console.test.tsx` 既有案例不變）。

**Step 2: build**

Run: `npm run build`
Expected: 成功。

**Step 3: verify gate**

Run: `npm run verify`（= build + test + test:struct-log）
Expected: 全通過（struct-log 既有契約不破壞）。

**Step 4: detect_changes 總檢**

Run: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})`
Expected: 變更集合 = 新 governance module + overlay/operator 元件 + `main.tsx`/`Window.tsx` 最小掛載；無預期外檔案。

**Step 5: Commit（若有 lockfile / 索引更新）**

```bash
git add -A
git commit -m "test(console-mvp): Phase A–C 全套件回歸通過（build + test + struct-log）" --allow-empty
```

---

## Phase D — E2E 驗收（frontend-operable，真 IFC + 真 3D + 截圖）

> 此 task 是**人工 + 工具混合的端到端驗收**，證明垂直切片在真實後端 + 真 3D 上跑通：A1 進件 → A2/A3/A4 → 點 failed 構件在 3D 標紅 → A8 開 issue。**這是 MVP「done」的關鍵**；任何一步只要靠捏造資料造假即視為失敗（誠實鐵律）。
>
> Omniverse 鐵律提醒：3D / Kit / WebRTC 起停屬 host-native，依 `MEMORY.md`「Kit GPU 渲染需 Windows 原生」「WebRTC 1:1 入口走 coordinator/ui」。本 task **不寫新 Kit code**，只用既有 `start-streaming-server.ps1` + coordinator `/ui/open`。

### Task D1: 後端就緒 + 真 IFC 轉檔（identity guid_exact）

**Objective:** 起 coordinator + governance-service + streaming，對 `storage/` 兩份真 IFC 跑 identity 轉檔，確認 element_mapping 為 guid_exact、coverage 高。

**Files:** 無 code 變更（驗收）。產出 evidence 存 `docs/verification/2026-06-04-unified-console-mvp/`。

**真 IFC（已存在於 repo storage/，本 task 用其中兩份）：**
- `storage/許良宇圖書館建築_2026.ifc`（base）
- `storage/許良宇圖書館建築_2026 - 轉檔測試2.ifc`（target / 第二份）

**Step 1: 起後端**

依 `docs/agents/sub-repo-verify-commands.md` 起：
- coordinator：`bim-review-coordinator` 於 `:8004`（`npm run start` 或既有啟動腳本）。
- governance-service：`:49102`（`.venv\Scripts\python.exe` 起服務；見其 README）。
- streaming + Kit：`start-streaming-server.ps1`（host-native；GPU 在 Windows 原生）。

驗：`curl http://127.0.0.1:8004/health`（或 urllib，curl 被擋時）→ `status: ok`。

**Step 2: 進件第一份真 IFC（identity 轉檔）**

POST `/api/external/ifc-ready`（loopback `127.0.0.1:8090` + `ref=host.docker.internal` 模式見 `MEMORY.md`「IFC POST 走 loopback」），帶 `storage/許良宇圖書館建築_2026.ifc`，要求 identity profile（guid_exact）。等 conversion 完成。

**Step 3: 驗 element_mapping 為 guid_exact / coverage 高**

讀產出的 `element_mapping.json`（streaming `_cache/host-native-conversion/artifacts/<job>/`），確認：
- `summary.fake_mapping_count === 0`（非 fake）。
- `summary.mapped_count` 與 `source_ifc_entity_count`（若有）算出 coverage（記錄真實 %，不修飾）。
- `items[]` 有真實 `ifc_guid` + `usd_prim_path`（抽 3 筆記錄）。

**Step 4: 記錄 evidence**

把 `/health`、ifc-ready job 回應、mapping summary 三筆真實輸出存成
`docs/verification/2026-06-04-unified-console-mvp/backend-identity-conversion.json`（誠實，原樣，不修飾數字）。

**Step 5: Commit**

```bash
git add docs/verification/2026-06-04-unified-console-mvp/backend-identity-conversion.json
git commit -m "test(console-mvp): E2E D1 真 IFC identity 轉檔 evidence（guid_exact，真實 coverage）"
```

---

### Task D2: 開 review session + primary viewer 載入真 3D

**Objective:** 用轉檔產出建 review session，從 coordinator `/ui/open` 開 primary viewer，確認真 3D 畫面（非黑畫面）。

**Files:** 無 code 變更（驗收）。

**Step 1: 建 review session**

POST `/api/review-sessions` 綁 D1 的 `artifact_bindings`（見 `MEMORY.md`「Kit WebRTC 視覺 E2E 流程」：POST review-sessions 綁 artifact_bindings → /ui/open → stage truth matched）。

**Step 2: 開 primary viewer**

瀏覽器開 coordinator `http://<LAN_IP>:8004/ui/open?session=<review_session_id>`（入口走 coordinator/ui，見 `MEMORY.md`；不要直接暴露 viewer :5173）。

**Step 3: 驗真 3D（healthy 判定）**

依 `MEMORY.md`「WebRTC 無畫面用 -ResetUser 救」/「healthy=readyState=4 + 影像尺寸 + DataChannel 回應」：
- `remote-video` `readyState>=HAVE_CURRENT_DATA` 且 `videoWidth>0 && videoHeight>0`（非黑畫面；georeferenced 模型若黑畫面=相機框取，非 pipeline 失敗，用 focusPrim 拉回）。
- stage_truth = matched（`App.tsx` stageLoadStatus）。

若 readyState=0：先 `start-streaming-server.ps1 -ResetUser` 再重試（不要當功能壞掉）。

**Step 4: 截圖**

截 primary viewer 真 3D 畫面（含右側 GovernanceOverlay 已疊上），存
`docs/verification/2026-06-04-unified-console-mvp/01-primary-viewer-3d.png`。

**Step 5: Commit**

```bash
git add docs/verification/2026-06-04-unified-console-mvp/01-primary-viewer-3d.png
git commit -m "test(console-mvp): E2E D2 primary viewer 真 3D + overlay 疊上截圖（readyState 證據）"
```

---

### Task D3: overlay 操作 A2/A3/A4 + 點 failed 構件在 3D 標紅 + A8 開 issue

**Objective:** 在 live 3D 上的 overlay 跑 A3 規則檢核（得 failed 構件）→ 看 A4 治理分 → 點一個帶 `usd_prim_path` 的 failed 構件 → 3D 標紅 → A8 從該 failed 構件開 BCF issue。全程截圖。

**Files:** 無 code 變更（驗收）。

**Step 1: A3 規則檢核（真實 rule-run）**

overlay / operator 觸發 `POST /api/governance/rule-runs`（經 coordinator proxy；body `ifc_source_path` 指向 D1 的真 IFC），輪詢至 `succeeded`，取 `results?status=failed`（真實 failed 構件，帶 `ifc_guid` + `usd_prim_path`）。記錄真實 total/passed/failed/score（不修飾）。

**Step 2: A4 治理分**

確認 rule-run `score` 顯示於 overlay（真實值；無完整治理分時誠實標）。截圖 `02-a3-rulecheck-a4-score.png`。

**Step 3: 點 failed 構件 → 3D 標紅**

在 overlay failed 清單點一個 `usd_prim_path` 非 null 的構件「在 3D 標示」：
- HighlightBridge 經 `_sendStreamMessage(buildHighlightPrimsRequest(...))` 送 `highlightPrimsRequest`（client 主動拉）。
- 觀察 3D 該構件變紅（severity=error → `[1,0,0,1]`）；DemoControlPanel DataChannel log 應出現 `highlightPrimsRequest` sent + `highlightPrimsResult` received（見 `DemoControlPanel.tsx:245`）。
- 截圖 `03-failed-element-highlighted-3d.png`（紅色構件可見）。

**Step 3b（誠實負案例）：** 點一個 `usd_prim_path=null`（未對映）的 failed 構件 → overlay 顯「無法在 3D 標示（未對映）」+ coverage%，**3D 無動作、無捏造 prim**。截圖 `03b-unmapped-honest.png`。

**Step 4: A8 從 failed 構件開 BCF issue**

`POST /api/governance/issues/from-rule-run/<runId>`（綁真實 ifc_guid）→ `GET /api/governance/issues` 確認 issue 建立 → `GET /api/governance/bcf/export` 下載 `.bcfzip`（只含 kind=issue 且有 ifc_guid）。截圖 `04-a8-issue-bcf.png`，存下載的 `.bcfzip` 檔名/大小於 evidence。

**Step 5: 寫 E2E 報告 + Commit**

把 D1–D3 的真實數字（coverage%、rule-run total/passed/failed/score、highlight request_id、issue id、bcf 檔大小）+ 5 張截圖路徑彙整成
`docs/verification/2026-06-04-unified-console-mvp/e2e-report.md`（誠實，含負案例 3b）。

```bash
git add docs/verification/2026-06-04-unified-console-mvp/
git commit -m "test(console-mvp): E2E D3 A2/A3/A4 + failed→3D 標紅 + A8 issue/BCF（含未對映誠實負案例）"
```

**Done 判定（frontend-operable）：** 操作員能在 primary viewer live 3D 上完成 A1 進件（選現成模型）→ A3 檢核 → A4 看分 → 點 failed 構件在 3D 標紅 → A8 開 issue/匯 BCF，且未對映構件誠實顯「無法在 3D 標示」+ coverage%，全程只打 :8004、後端離線顯 502、無假數字。

---

## Phase E — self-review（spec coverage / placeholder scan / type consistency）並 inline 修

> 計畫執行完成後（或執行前對計畫本身），跑以下 self-review；發現問題 inline 修進對應 task 後再續。

### Task E1: spec coverage 自檢（5 requirements 全覆蓋）

對照 `openspec/changes/unified-governance-console/specs/unified-governance-console/spec.md` 逐條打勾：

| spec requirement | 對應 task | 驗證點 |
|---|---|---|
| R1 A1–A10 治理疊 primary viewer overlay + spectator 唯讀 | B1/B2 + C2 | `GovernanceOverlay` 疊在 viewer（`Window.tsx` render），spectator `disabled` 非隱藏（B2 test）。 |
| R2 operator 三頁分離，不混 A1–A10 overlay + A1 進件選現成不手填 | B4/B5 + C1 | `OperatorConsole` 三頁 `not.toContain("gov-overlay")`（B5 test）；`IntakeSelectPage` 無手填路徑 input（B4 test）。 |
| R3 點 3D ↔ ifc_guid 雙向 + failed→client highlightPrimsRequest 標示 + 未對映誠實 | A1/A4 + B3 + C3 | MappingCache 雙向（A1）；HighlightBridge client 主動拉（A4）；overlay 未對映顯「無法在 3D 標示」（B3）；點 3D 反查（C3）。 |
| R4 強制 guid_exact/coverage 1.0，不足誠實降級（引用既有 spec） | A2/A5 + B3 | `evaluateCoverageGate`（A5）warn 不 fail；MappingCache 拒 fake + coverage denominator（A2）；overlay 降級顯 coverage%（B3）。 |
| R5 只經 coordinator :8004 + 誠實 provenance + 離線 502 | A4/B4/B1 全程 | 所有 client 走 `coordinatorClient`/`governanceClient`（只 :8004，既有 console.test 已測 base）；overlay/intake 標 provenance；proxy 既有 502。 |

**inline 修：** 任一列無對應 test 斷言 → 回該 task 補一條斷言。**特別檢查**：每個 scenario 的「SHALL NOT」反向案例都有對應 `not.toContain` / `ok:false` 斷言（如「不捏造 prim」「不 server-push」「非隱藏」「不手填路徑」「不直連 :49102」）。

### Task E2: placeholder / TBD / 「similar to」掃描

掃計畫與產出 code，確認**零 placeholder**：
- `grep -rn "TBD\|TODO\|FIXME\|placeholder\|similar to\|<...>\|XXX" docs/superpowers/plans/2026-06-04-unified-console-mvp.md web-viewer-sample/src/console/governance web-viewer-sample/src/console/GovernanceOverlay.tsx web-viewer-sample/src/console/IntakeSelectPage.tsx web-viewer-sample/src/console/OperatorConsole.tsx`
- Expected: 無命中（計畫內每步都有真實 code/測試 code）。
- 例外白名單：UI 文案內的「待建」「未建」是誠實 provenance 用語（非 placeholder），HighlightBridge fallback 的 `({ primPathForGuid: () => null } as never)` 是 C2 骨架明確過渡（C3 接真 cache）——E1 已標明 C3 接線，非遺留 placeholder。

**inline 修：** 任何真 placeholder → 補上真實 code 或拆成獨立 task。

### Task E3: type consistency 自檢

- 確認新 module 的型別都源自既有共用型別（`types/mapping.ts` `ElementMappingDocument`/`ElementMappingItem`、`types/streamMessages.ts` `HighlightItem`/`StreamMessage`、`console/data.ts` `Prov`），未重造平行型別（DRY）。
- 確認 `Window.tsx` 新增 state 欄位（`govFailedElements`）已加入 `AppState` interface，且 `_mappingCache` 欄位型別正確。
- 確認 overlay props `panelState` 直接 `import type { GovPanelState }`（Task B1 已收斂，不另立平行 `OverlayPanelState`）；若日後有人重新 inline 該 union，視為型別分歧需修回。
- Run: `npm run build`（tsc 嚴格模式，`strict` + `noUnusedLocals` + `noUnusedParameters`）→ Expected: 零型別錯誤。

**inline 修：** 型別分歧 → 收斂到單一來源；未用變數 → 移除（`noUnusedLocals` 會擋 build）。

---

## 執行注意（彙整）

1. **TDD 紀律**：每 task RED（跑驗失敗）→ GREEN（最小實作跑驗通過）→ commit；不跳步。
2. **gitnexus**：改 `Window.tsx`/`main.tsx`/任何既有 symbol 前 `gitnexus_impact`（HIGH/CRITICAL 先回報）；每次 commit 前 `gitnexus_detect_changes`。
3. **守邊界**：零後端改動；新元件全在 `web-viewer-sample/src/console/`（governance/ 子夾）；只打 coordinator :8004。
4. **誠實鐵律**：無假數字；provenance 必標；未對映/離線/未就緒誠實顯示；不復活 server-push；不冒充 guid_exact。
5. **漸進式（Q1）**：Phase A/B 不碰 `Window.tsx`；Phase C 才最小掛載，每步後 `npm run build` 通過、viewer 行為不變。
6. **Verify 入口**：`npm run verify`（build + test + struct-log）為提交 gate。
