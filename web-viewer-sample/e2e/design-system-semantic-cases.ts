import type { Page } from "@playwright/test";

import { HARNESS_TRACE_ID } from "../src/harness/fixtures/reviewAuthority";

export type SemanticCaseContext = {
  page: Page;
  screenId: string;
  productionRoute: string;
};

export type SemanticExpectation =
  | "visible"
  | "hidden"
  | "enabled"
  | "disabled"
  | "text_equals"
  | "text_contains"
  | "attribute_equals"
  | "count_equals";

export type SemanticAssertionDefinition = {
  id: string;
  locator: string;
  expectation: SemanticExpectation;
  expected?: string | number;
  attribute?: string;
};

export type SemanticCaseDefinition = {
  prepare: (context: SemanticCaseContext) => Promise<void>;
  assertions: readonly SemanticAssertionDefinition[];
};

// ═══════════════════════════════════════════════════════════════════════
// Design gate semantic contract — 13 screens × 11 required cases = 143 條
// 可執行 DOM 案例。所有觀察/斷言由 design-system-visual.spec.ts 執行；本檔
// 只宣告 prepare（自行導航 + fixture 互動）與 assertions（locator + 期望）。
//
// 誠實原則：
// - 全程 **/api/** 已被 spec 以 503 stub，所有互動都是 UnifiedConsole 的
//   local fixture 行為（state patch + toast 假 API 字串），不宣稱任何後端事實。
// - 找不到天然對映的 case（例：home/ops 的 disabled、ops 的 failure）以
//   count_equals 0 誠實斷言「該狀態表面目前為空」，逐案附註解，不造假 DOM。
// - runtime_truth：fixture 殼（workspace.a1–a3／concept）斷言 data-prov="fixture"；真值頁（home／pipeline／ops，
//   unified-console-runtime-truth）斷言 page-root 內 data-prov="asbuilt" 且主值 cell 為 offline（gate 503 環境）。
//
// state 隔離設計（重要）：
// - hash-only 的 page.goto 是 same-document navigation，React state（含
//   UnifiedStateProvider 的 intake/conv/outbox/issues 與 Workspace local
//   state）會跨 case 存活。case 依 required_case_ids 順序執行，之間的互動
//   已按順序設計為相容；需要絕對乾淨狀態的 case 用 gotoFreshRoute（先過
//   about:blank 造成 full document load）。
// - 每個 screen 的最後一個 case（runtime_truth）一律 gotoFreshRoute 且零互
//   動，保證接續的像素 baseline 擷取拿到與 golden 一致的初始畫面。
// ═══════════════════════════════════════════════════════════════════════

const RUNTIME_NOTE = ":8004/ui · UnifiedConsole";

export function designHarnessRoute(productionRoute: string): string {
  if (!productionRoute.startsWith("#")) {
    throw new Error("Design harness routes must be hash routes");
  }
  const params = new URLSearchParams({
    harness: "1",
    trace_id: HARNESS_TRACE_ID,
  });
  return `/?${params.toString()}${productionRoute}`;
}

/** 任務規約：prepare 一律以 design-owned canonical harness carriers 自行導頁。 */
const gotoRoute = async ({ page, productionRoute }: SemanticCaseContext): Promise<void> => {
  await page.goto(designHarnessRoute(productionRoute), { waitUntil: "domcontentloaded" });
};

/** 先經 about:blank 造成 full document load → React/fixture state 全部重置。 */
const gotoFreshRoute = async (context: SemanticCaseContext): Promise<void> => {
  await context.page.goto("about:blank");
  await gotoRoute(context);
};

const clickFirst = async (page: Page, selector: string): Promise<void> => {
  await page.locator(selector).first().click();
};

/* ── 共用 assertion 片段 ── */

/** i18n_zh_tw：lang toggle「中」為 active（data-active 由元件依當前語言渲染）。 */
const langZhActive: SemanticAssertionDefinition = {
  id: "lang-toggle-zh-active",
  locator: '[data-uc="lang-zh"]',
  expectation: "attribute_equals",
  attribute: "data-active",
  expected: "true",
};

/** runtime_truth（fixture 殼：workspace.a1–a3／concept）：data-prov="fixture" 揭露屬性存在 + 殼層 UnifiedConsole 註記。 */
const runtimeTruthCase = (): SemanticCaseDefinition => ({
  prepare: gotoFreshRoute,
  assertions: [
    { id: "fixture-provenance-marker", locator: '[data-prov="fixture"] >> nth=0', expectation: "visible" },
    { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
  ],
});

/** runtime_truth（真值頁：home／pipeline／ops；unified-console-runtime-truth）：page-root 內帶 data-prov="asbuilt"、
    主值 cell 於 gate 503 環境為 offline、「最後更新 —」（無時間戳，確定性）+ 殼層註記。 */
const truthRuntimeTruthCase = (primaryValueUc: string): SemanticCaseDefinition => ({
  prepare: gotoFreshRoute,
  assertions: [
    { id: "asbuilt-provenance-marker", locator: '[data-uc="page-root"] [data-prov="asbuilt"] >> nth=0', expectation: "visible" },
    { id: "primary-value-offline-state", locator: `[data-uc="${primaryValueUc}"]`, expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
    { id: "last-updated-deterministic-dash", locator: '[data-uc="last-updated"]', expectation: "text_contains", expected: "—" },
    { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
  ],
});

type ScreenCases = Record<
  | "navigation"
  | "primary_actions"
  | "loading"
  | "empty"
  | "success"
  | "warning"
  | "failure"
  | "disabled"
  | "confirmation"
  | "i18n_zh_tw"
  | "runtime_truth",
  SemanticCaseDefinition
>;

/* ═══ console.home.default（#home）— 真值頁：gate 503 → 全部誠實 offline ═══ */

function homeCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-home-active", locator: '[data-uc="nav-home"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-workspace-group-label", locator: 'text="工作台"', expectation: "visible" },
      ],
    },
    primary_actions: {
      prepare: gotoRoute,
      assertions: [
        { id: "enter-pipeline-cta-visible", locator: '[data-uc="enter-pipeline"]', expectation: "visible" },
        { id: "enter-pipeline-cta-enabled", locator: '[data-uc="enter-pipeline"]', expectation: "enabled" },
        { id: "enter-pipeline-cta-label", locator: '[data-uc="enter-pipeline"]', expectation: "text_equals", expected: "進入生產線 →" },
        { id: "enter-pipeline-cta-is-nav", locator: '[data-uc="enter-pipeline"]', expectation: "attribute_equals", attribute: "data-action", expected: "nav" },
      ],
    },
    loading: {
      // 進行中狀態的誠實表面：「轉檔中」KPI 在後端不可達時不得顯示任何數字（— + offline），不宣稱有進行中轉檔。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-converting-count", locator: '[data-uc="kpi-conv-val"]', expectation: "text_equals", expected: "—" },
        { id: "kpi-converting-offline-state", locator: '[data-uc="kpi-conv-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      // 可達空狀態：home 無 toast 動作 → toast host 不渲染；服務健康列表存在但無任何 ok 宣稱。
      prepare: gotoRoute,
      assertions: [
        { id: "toast-host-empty", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
        { id: "service-dots-present", locator: '[data-uc="svc-dot"]', expectation: "count_equals", expected: 6 },
      ],
    },
    success: {
      // 成功表面（綠點）機制存在；gate 環境不可達 → 不得有任何綠點（誠實：0 個 ok）。
      prepare: gotoRoute,
      assertions: [
        { id: "no-ok-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="ok"]', expectation: "count_equals", expected: 0 },
      ],
    },
    warning: {
      // 琥珀狀態：Outbox 待送 KPI 與 Coordinator chip 誠實標未連線（琥珀）。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-outbox-pending-count", locator: '[data-uc="kpi-outbox-val"]', expectation: "text_equals", expected: "—" },
        { id: "coordinator-chip-unknown", locator: '[data-uc="chip-coordinator"]', expectation: "attribute_equals", attribute: "data-health", expected: "unknown" },
      ],
    },
    failure: {
      // 紅色表面：既無捏造的「1 失敗」紅字，也無紅點（不可達 ≠ 失敗）。
      prepare: gotoRoute,
      assertions: [
        { id: "kpi-conv-failed-red-text", locator: "text=1 失敗", expectation: "count_equals", expected: 0 },
        { id: "no-degraded-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="degraded"]', expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實對映：home 沒有可停用的控制項（KPI 卡與快照皆為 nav）；aria-disabled="true" 計數 0。
      prepare: gotoRoute,
      assertions: [
        { id: "no-disabled-controls-on-home", locator: '[aria-disabled="true"]', expectation: "count_equals", expected: 0 },
      ],
    },
    confirmation: {
      // 主 CTA 的確認回饋 = 點「進入生產線」後生產線頁標題出現（導覽，非假 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await clickFirst(context.page, '[data-uc="enter-pipeline"]');
      },
      assertions: [
        { id: "pipeline-page-opened", locator: "text=模型資料與轉檔生產線", expectation: "visible" },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-home-title", locator: "text=總覽 · Mission Control", expectation: "visible" },
        { id: "zh-offline-label", locator: '[data-uc="kpi-conv-sub"]', expectation: "text_equals", expected: "未連線" },
        langZhActive,
      ],
    },
    runtime_truth: truthRuntimeTruthCase("kpi-conv-val"),
  };
}

/* ═══ fixture workspace.a1..a3.default（#a1..#a3）═══ */

type WsDock = "a1" | "a2" | "a3";

const WS_CTA: Record<WsDock, { label: string; confirmToast: string }> = {
  // a1Ran 初值 true → CTA 顯示「重新執行」；其餘 dock 初值未執行。
  a1: { label: "重新執行", confirmToast: "POST /api/rule-runs → 202" },
  a2: { label: "計算差異", confirmToast: "POST /api/diffs → 202" },
  a3: { label: "Build Federated USD", confirmToast: "POST /api/federated-sets/FS-01/build" },
};

function workspaceCases(dock: WsDock): ScreenCases {
  /** goto 後點當前 dock 的主 CTA（產出結果面板；重複點擊為冪等的 re-run）。 */
  const runDockCta = async (context: SemanticCaseContext): Promise<void> => {
    await gotoRoute(context);
    await clickFirst(context.page, '[data-uc="dock-cta"]');
  };

  const success: SemanticCaseDefinition =
    dock === "a1"
      ? {
          // A1 選定檔案列的 mapping 98% ✓（初始即為成功態）。
          prepare: gotoRoute,
          assertions: [{ id: "a1-mapping-98-check", locator: "text=✓ mapping 98%", expectation: "visible" }],
        }
      : dock === "a2"
        ? {
            prepare: runDockCta,
            assertions: [{ id: "a2-diff-added-chip", locator: "text=■ 新增 12", expectation: "visible" }],
          }
        : {
            prepare: runDockCta,
            assertions: [{ id: "a3-federated-stage-check", locator: "text=Federated Stage ✓", expectation: "visible" }],
          };

  const failure: SemanticCaseDefinition =
    dock === "a1"
      ? {
          // a1Ran 初值 true → 檢核失敗清單可見；「嚴重」sev chip（紅）。
          prepare: gotoRoute,
          assertions: [
            { id: "a1-critical-sev-chip", locator: 'text="嚴重"', expectation: "visible" },
            { id: "a1-fail-row-issue-action", locator: '[data-uc="fail-issue-btn"] >> nth=0', expectation: "visible" },
          ],
        }
      : dock === "a2"
        ? {
            prepare: runDockCta,
            assertions: [{ id: "a2-diff-removed-chip", locator: "text=■ 移除 4", expectation: "visible" }],
          }
        : {
            // 誠實對映：A3 dock 本身無紅色失敗態；工作區的失敗浮出面 = Issues/BCF
            // dock（open 紅 chip 的既有 fixture issue），以 dock tab 切換（local state）。
            prepare: async (context) => {
              await gotoRoute(context);
              await clickFirst(context.page, '[data-uc="dock-tab-issues"]');
            },
            assertions: [
              { id: "issues-open-red-chip", locator: 'text="open"', expectation: "visible" },
              { id: "issues-firerating-issue-title", locator: "text=防火時效不足", expectation: "visible" },
            ],
          };

  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-ws-active", locator: '[data-uc="nav-ws"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: `sidebar-app-${dock}-active`, locator: `[data-uc="app-${dock}"]`, expectation: "attribute_equals", attribute: "data-active", expected: "true" },
      ],
    },
    primary_actions: {
      prepare: gotoRoute,
      assertions: [
        { id: "dock-cta-visible", locator: '[data-uc="dock-cta"]', expectation: "visible" },
        { id: "dock-cta-enabled", locator: '[data-uc="dock-cta"]', expectation: "enabled" },
        { id: "dock-cta-label", locator: '[data-uc="dock-cta"]', expectation: "text_equals", expected: WS_CTA[dock].label },
      ],
    },
    loading: {
      // 進行中狀態：Streaming 膠囊 + session capsule（fixture 常駐的 live 表面文案）。
      prepare: gotoRoute,
      assertions: [
        { id: "streaming-pill-live", locator: '[data-uc="streaming-pill"]', expectation: "text_contains", expected: "Streaming" },
        { id: "session-capsule-editor-lease", locator: "text=S-240601 · editor lease", expectation: "visible" },
      ],
    },
    empty: {
      // 可達空狀態：初始 sel 為空 → viewport selection callout 不渲染。
      prepare: gotoRoute,
      assertions: [
        { id: "selection-callout-absent", locator: '[data-uc="sel-callout"]', expectation: "count_equals", expected: 0 },
      ],
    },
    success,
    warning: {
      // 琥珀狀態：側欄「模型資料與轉檔」badge 為真值（running+failed）；gate 503 → 誠實顯示 —（offline），不捏造數字。
      prepare: gotoRoute,
      assertions: [
        { id: "nav-pipe-warn-badge-visible", locator: '[data-uc="nav-pipe-badge"]', expectation: "visible" },
        { id: "nav-pipe-warn-badge-count", locator: '[data-uc="nav-pipe-badge"]', expectation: "text_equals", expected: "—" },
      ],
    },
    failure,
    disabled: {
      // 誠實停用（互動後）：A1 檢核失敗列「開單」點過即完成（✓ + aria-disabled，
      // onClick 原本就 no-op）。a2–a4 screen 以 dock tab 切到 A1（local state）套同一語意。
      prepare: async (context) => {
        await gotoRoute(context);
        await clickFirst(context.page, '[data-uc="dock-tab-a1"]');
        await clickFirst(context.page, '[data-uc="fail-issue-btn"]');
      },
      assertions: [
        { id: "issue-btn-aria-disabled", locator: '[data-uc="fail-issue-btn"] >> nth=0', expectation: "attribute_equals", attribute: "aria-disabled", expected: "true" },
        { id: "issue-btn-disabled-state", locator: '[data-uc="fail-issue-btn"] >> nth=0', expectation: "disabled" },
      ],
    },
    confirmation: {
      // 點主 CTA → toast 假 API 字串（先切回本 dock，因 disabled case 已把 dock 切到 a1）。
      prepare: async (context) => {
        await gotoRoute(context);
        await clickFirst(context.page, `[data-uc="dock-tab-${dock}"]`);
        await clickFirst(context.page, '[data-uc="dock-cta"]');
      },
      assertions: [
        { id: "fake-api-toast", locator: '[data-uc="toast"]', expectation: "text_contains", expected: WS_CTA[dock].confirmToast },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-invite-spectator", locator: "text=+ 邀請 Spectator", expectation: "visible" },
        langZhActive,
      ],
    },
    runtime_truth: runtimeTruthCase(),
  };
}

/* ═══ workspace.a4.default（canonical live/table-only surface）═══ */

function a4Cases(): ScreenCases {
  // The manifest still reaches this screen through the legacy #a4 alias until
  // the design-reference owner re-approves its canonical query-bearing route.
  // Wait for the explicit scrubbed canonical destination before observing DOM.
  const gotoA4 = async (context: SemanticCaseContext): Promise<void> => {
    await gotoRoute(context);
    await context.page.waitForURL(/#workspace\?dock=a4$/);
    await context.page.getByTestId("a4-semantic-search-page").waitFor({ state: "visible" });
  };
  const gotoFreshA4 = async (context: SemanticCaseContext): Promise<void> => {
    await context.page.goto("about:blank");
    await gotoA4(context);
  };

  return {
    navigation: {
      prepare: gotoA4,
      assertions: [
        { id: "sidebar-nav-ws-active", locator: '[data-uc="nav-ws"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-app-a4-active", locator: '[data-uc="app-a4"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "canonical-a4-page-visible", locator: '[data-testid="a4-semantic-search-page"]', expectation: "visible" },
      ],
    },
    primary_actions: {
      // The design harness deliberately gives every /api request a 503.  A4
      // must therefore expose input but never fake an enabled runtime action.
      prepare: gotoA4,
      assertions: [
        { id: "a4-query-input-visible", locator: '[data-testid="a4-query-input"]', expectation: "visible" },
        { id: "a4-refresh-sources-visible", locator: '[data-testid="a4-refresh-sources"]', expectation: "visible" },
        { id: "a4-run-disabled-without-live-session", locator: '[data-testid="a4-run"]', expectation: "disabled" },
      ],
    },
    loading: {
      // Offline design evidence may observe only safe, unconfigured/not-observed
      // model state; it must not claim that a model was reached.
      prepare: gotoA4,
      assertions: [
        { id: "a4-llm-readiness-not-observed", locator: '[data-testid="a4-llm-missing"]', expectation: "visible" },
      ],
    },
    empty: {
      prepare: gotoA4,
      assertions: [
        { id: "a4-empty-results-table", locator: '[data-testid="a4-results-table"]', expectation: "text_contains", expected: "無列" },
      ],
    },
    success: {
      // A design-only 503 harness has no authority to fabricate a search result.
      // This required semantic slot proves the absence of the retired fake success
      // surface rather than marking an external search as successful.
      prepare: gotoA4,
      assertions: [
        { id: "a4-no-fixed-compliance-success", locator: 'text="符合 7"', expectation: "count_equals", expected: 0 },
        { id: "a4-no-local-query-success-fixture", locator: '[data-testid="a4-results-table"] tbody tr', expectation: "count_equals", expected: 1 },
      ],
    },
    warning: {
      prepare: gotoA4,
      assertions: [
        { id: "a4-table-only-boundary-visible", locator: '[data-testid="a4-table-only"]', expectation: "visible" },
      ],
    },
    failure: {
      prepare: gotoA4,
      assertions: [
        { id: "a4-source-load-safe-error", locator: '[data-testid="a4-load-err"]', expectation: "visible" },
      ],
    },
    disabled: {
      prepare: gotoA4,
      assertions: [
        { id: "a4-run-disabled", locator: '[data-testid="a4-run"]', expectation: "disabled" },
        // main 生態（unit test 與 a4-closeout e2e）以「存在但 disabled」表達
        // Issue 尚不可用，而非移除控制項；此處對齊該既有契約。
        { id: "a4-no-issue-control", locator: '[data-testid="a4-create-issues"]', expectation: "disabled" },
        { id: "a4-no-handoff-control", locator: '[data-testid*="handoff"]', expectation: "count_equals", expected: 0 },
      ],
    },
    confirmation: {
      // There is no A4 Issue/3D confirmation until proof + authentic C-M4 lease
      // capabilities exist; absence is the truthful fail-closed confirmation.
      prepare: gotoA4,
      assertions: [
        { id: "a4-no-manual-issue-confirmation", locator: '[data-testid="a4-issue-msg"]', expectation: "count_equals", expected: 0 },
        { id: "a4-no-viewer-command-confirmation", locator: '[data-testid*="highlight"], [data-testid*="focus"]', expectation: "count_equals", expected: 0 },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoA4,
      assertions: [
        { id: "zh-a4-title", locator: "text=A4 語意查詢與證據", expectation: "visible" },
        langZhActive,
      ],
    },
    runtime_truth: {
      prepare: gotoFreshA4,
      assertions: [
        { id: "a4-asbuilt-partial-marker", locator: "text=asbuilt · PARTIAL", expectation: "visible" },
        { id: "a4-runtime-table-only-marker", locator: '[data-testid="a4-table-only"]', expectation: "visible" },
      ],
    },
  };
}

/* ═══ pipeline.default（#pipeline）— 真值頁 ═══ */

function pipelineCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-pipe-active", locator: '[data-uc="nav-pipe"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "nav-pipe-badge-initial", locator: '[data-uc="nav-pipe-badge"]', expectation: "text_equals", expected: "—" },
      ],
    },
    primary_actions: {
      // 主要動作面：「觸發轉檔」存在但誠實停用（D2 授權於 slice 2）；真頁導向連結可用。
      prepare: gotoRoute,
      assertions: [
        { id: "trigger-conv-visible", locator: '[data-uc="trigger-conv"]', expectation: "visible" },
        { id: "trigger-conv-honest-disabled", locator: '[data-uc="trigger-conv"]', expectation: "attribute_equals", attribute: "data-action", expected: "disabled" },
        { id: "trigger-conv-label", locator: '[data-uc="trigger-conv"]', expectation: "text_equals", expected: "觸發轉檔" },
        { id: "to-minio-nav-enabled", locator: '[data-uc="to-minio"]', expectation: "enabled" },
      ],
    },
    loading: {
      // 進行中狀態：running 計數在不可達時為 — / offline，不宣稱任何進行中轉檔。
      prepare: gotoRoute,
      assertions: [
        { id: "converting-count-offline", locator: '[data-uc="conv-running-val"]', expectation: "text_equals", expected: "—" },
        { id: "converting-offline-state", locator: '[data-uc="conv-running-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      // 可達空狀態：3D handoff 段無 session anchor（不可達時不渲染任何 /ui/open 連結，亦無 iframe）。
      prepare: gotoRoute,
      assertions: [
        { id: "no-handoff-links", locator: '[data-uc="handoff-link"]', expectation: "count_equals", expected: 0 },
        { id: "no-live-iframe", locator: "iframe", expectation: "count_equals", expected: 0 },
      ],
    },
    success: {
      // 完成表面：ready 計數 cell 存在，不可達時不得顯示任何完成數字。
      prepare: gotoRoute,
      assertions: [
        { id: "ready-count-offline", locator: '[data-uc="conv-ready-val"]', expectation: "text_equals", expected: "—" },
      ],
    },
    warning: {
      // 琥珀狀態：Outbox 待送與 MinIO watch 皆誠實 —（offline）。
      prepare: gotoRoute,
      assertions: [
        { id: "outbox-pending-offline", locator: '[data-uc="outbox-pending-val"]', expectation: "text_equals", expected: "—" },
        { id: "watch-status-offline", locator: '[data-uc="intake-watch-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    failure: {
      // 紅色表面：failed 計數不可達為 —；無捏造的重試鈕。
      prepare: gotoRoute,
      assertions: [
        { id: "failed-count-offline", locator: '[data-uc="conv-failed-val"]', expectation: "text_equals", expected: "—" },
        { id: "no-fake-retry-button", locator: "text=重試", expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實停用：觸發轉檔 aria-disabled + 原因（aria-describedby）。
      prepare: gotoRoute,
      assertions: [
        { id: "trigger-aria-disabled", locator: '[data-uc="trigger-conv"]', expectation: "attribute_equals", attribute: "aria-disabled", expected: "true" },
        { id: "trigger-disabled-state", locator: '[data-uc="trigger-conv"]', expectation: "disabled" },
        { id: "trigger-reason-visible", locator: '[data-uc="trigger-conv-reason"]', expectation: "visible" },
      ],
    },
    confirmation: {
      // 點停用的觸發鈕 → 不得出現任何成功回饋（無 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await context.page.locator('[data-uc="trigger-conv"]').first().click({ force: true });
      },
      assertions: [
        { id: "no-fake-success-toast", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-pipeline-title", locator: "text=模型資料與轉檔生產線", expectation: "visible" },
        { id: "zh-rvt-retired", locator: '[data-uc="rvt-retired"]', expectation: "text_contains", expected: "已退役" },
        langZhActive,
      ],
    },
    runtime_truth: truthRuntimeTruthCase("conv-ready-val"),
  };
}

/* ═══ runtime.ops.default（#runtime）— 真值頁 ═══ */

function opsCases(): ScreenCases {
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-nav-ops-active", locator: '[data-uc="nav-ops"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-nav-home-inactive", locator: '[data-uc="nav-home"]', expectation: "attribute_equals", attribute: "data-active", expected: "false" },
      ],
    },
    primary_actions: {
      prepare: gotoRoute,
      assertions: [
        { id: "to-instances-visible", locator: '[data-uc="to-instances"]', expectation: "visible" },
        { id: "to-instances-enabled", locator: '[data-uc="to-instances"]', expectation: "enabled" },
        { id: "to-instances-is-nav", locator: '[data-uc="to-instances"]', expectation: "attribute_equals", attribute: "data-action", expected: "nav" },
      ],
    },
    loading: {
      // 進行中狀態：Kit instance 不可達 → — / offline（不宣稱 running）。
      prepare: gotoRoute,
      assertions: [
        { id: "kit-instance-offline", locator: '[data-uc="kit-instance-id"]', expectation: "text_equals", expected: "—" },
        { id: "kit-instance-offline-state", locator: '[data-uc="kit-instance-id"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
      ],
    },
    empty: {
      prepare: gotoRoute,
      assertions: [
        { id: "toast-host-empty", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    success: {
      // 六顆服務點存在；不可達 → 0 個 ok（不捏造全綠）。
      prepare: gotoRoute,
      assertions: [
        { id: "service-dots-total", locator: '[data-uc="svc-dot"]', expectation: "count_equals", expected: 6 },
        { id: "no-ok-service-dots-offline", locator: '[data-uc="svc-dot"][data-health="ok"]', expectation: "count_equals", expected: 0 },
      ],
    },
    warning: {
      // 琥珀狀態：Kit Runtime chip 未連線；GPU 卡 —。
      prepare: gotoRoute,
      assertions: [
        { id: "kit-chip-unknown", locator: '[data-uc="chip-kit"]', expectation: "attribute_equals", attribute: "data-health", expected: "unknown" },
        { id: "gpu-card-offline", locator: '[data-uc="gpu-val"]', expectation: "text_equals", expected: "—" },
      ],
    },
    failure: {
      // 紅色表面：紅點機制存在，不可達 ≠ 失敗 → 0 個 degraded。
      prepare: gotoRoute,
      assertions: [
        { id: "failed-service-dots-count", locator: '[data-uc="svc-dot"][data-health="degraded"]', expectation: "count_equals", expected: 0 },
      ],
    },
    disabled: {
      // 誠實停用：事件流控制項 aria-disabled + 原因。
      prepare: gotoRoute,
      assertions: [
        { id: "events-aria-disabled", locator: '[data-uc="events-disabled"]', expectation: "attribute_equals", attribute: "aria-disabled", expected: "true" },
        { id: "events-disabled-state", locator: '[data-uc="events-disabled"]', expectation: "disabled" },
        { id: "events-reason-visible", locator: '[data-uc="events-reason"]', expectation: "visible" },
      ],
    },
    confirmation: {
      // 點停用的事件流控制項 → 無任何成功回饋（無 toast）。
      prepare: async (context) => {
        await gotoRoute(context);
        await context.page.locator('[data-uc="events-disabled"]').first().click({ force: true });
      },
      assertions: [
        { id: "no-fake-success-toast", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "zh-service-health-label", locator: 'text="服務健康"', expectation: "visible" },
        langZhActive,
      ],
    },
    runtime_truth: {
      prepare: gotoFreshRoute,
      assertions: [
        { id: "asbuilt-provenance-marker", locator: '[data-uc="page-root"] [data-prov="asbuilt"] >> nth=0', expectation: "visible" },
        { id: "gpu-offline-state-no-number", locator: '[data-uc="gpu-val"]', expectation: "attribute_equals", attribute: "data-state", expected: "offline" },
        { id: "no-fixed-gpu-percent", locator: "text=82%", expectation: "count_equals", expected: 0 },
        { id: "console-runtime-note", locator: '[data-uc="runtime-note"]', expectation: "text_contains", expected: RUNTIME_NOTE },
      ],
    },
  };
}

/* ═══ concept.a5..a10.default（#a5..#a10）═══ */

type ConceptSlug = "a5" | "a6" | "a7" | "a8" | "a9" | "a10";

/** 每頁 zh 標題的唯一子字串（a8 標題本身無中文，i18n case 另以 concept_note 補中文斷言）。 */
const CONCEPT_TITLE_SNIPPET: Record<ConceptSlug, string> = {
  a5: "IoT / FM 數位分身",
  a6: "4D / 5D 施工模擬",
  a7: "Reality Capture 比對",
  a8: "A8 · Synthetic Data Studio",
  a9: "機器人 / 自主巡檢",
  a10: "其他應用 / AI 決策",
};

const CONCEPT_IMG_GLOB = "**/design-assets/ai-bim-geo-viewer-*.png";

function conceptCases(slug: ConceptSlug): ScreenCases {
  const imgSrc = `/design-assets/ai-bim-geo-viewer-A${slug.slice(1)}.png`;
  return {
    navigation: {
      prepare: gotoRoute,
      assertions: [
        { id: `sidebar-app-${slug}-active`, locator: `[data-uc="app-${slug}"]`, expectation: "attribute_equals", attribute: "data-active", expected: "true" },
        { id: "sidebar-apps-group-label", locator: 'text="AI 應用模組"', expectation: "visible" },
      ],
    },
    primary_actions: {
      // 誠實對映：概念頁自身無 CTA；本頁主要可行動作 = 側欄 A1 LIVE 項（可點、enabled）。
      prepare: gotoRoute,
      assertions: [
        { id: "sidebar-a1-live-visible", locator: '[data-uc="app-a1"]', expectation: "visible" },
        { id: "sidebar-a1-live-enabled", locator: '[data-uc="app-a1"]', expectation: "enabled" },
        { id: "sidebar-a1-live-badge", locator: '[data-uc="app-a1"]', expectation: "text_contains", expected: "LIVE" },
      ],
    },
    loading: {
      // 大圖載入完成：img 可見 + src 指向產品資產路徑（visible 需版面高度>0，即已載入）。
      prepare: gotoRoute,
      assertions: [
        { id: "concept-image-loaded", locator: '[data-uc="concept-img"]', expectation: "visible" },
        { id: "concept-image-src", locator: '[data-uc="concept-img"]', expectation: "attribute_equals", attribute: "src", expected: imgSrc },
      ],
    },
    empty: {
      // 可達空狀態：概念頁初始無 toast/彈出通知 → toast host 不渲染（誠實計數 0）。
      prepare: gotoRoute,
      assertions: [
        { id: "toast-host-empty", locator: '[data-uc="toast"]', expectation: "count_equals", expected: 0 },
      ],
    },
    success: {
      // 綠色上線狀態：側欄 A1–A4 的 LIVE 徽章恰為 4 顆（本頁唯一的成功/上線語意表面）。
      prepare: gotoRoute,
      assertions: [
        { id: "live-badges-count", locator: 'text="LIVE"', expectation: "count_equals", expected: 4 },
      ],
    },
    warning: {
      // 琥珀狀態：頁首「Concept Preview / Roadmap」章（非正式功能的誠實警示）。
      prepare: gotoRoute,
      assertions: [
        { id: "concept-roadmap-amber-chip", locator: "text=Concept Preview / Roadmap", expectation: "visible" },
        { id: "concept-note-live-hint", locator: "text=本頁為概念稿", expectation: "visible" },
      ],
    },
    failure: {
      // 真實失敗路徑：攔截概念大圖請求（abort）→ full reload → img onError 觸發
      // 原型同語意的 fallback 卡。route 於同一 prepare 內 try/finally 解除，
      // 不污染後續 case / 像素擷取（runtime_truth 會 fresh reload 還原）。
      prepare: async (context) => {
        const { page } = context;
        await page.route(CONCEPT_IMG_GLOB, (route) => route.abort());
        try {
          await gotoFreshRoute(context);
        } finally {
          await page.unroute(CONCEPT_IMG_GLOB);
        }
      },
      assertions: [
        { id: "concept-fallback-rendered", locator: '[data-uc="concept-fallback"]', expectation: "visible" },
        { id: "concept-image-removed", locator: '[data-uc="concept-img"]', expectation: "count_equals", expected: 0 },
        { id: "concept-fallback-explains-missing-asset", locator: "text=未隨程式碼打包", expectation: "visible" },
      ],
    },
    disabled: {
      // 誠實對映：概念稿頁內沒有可操作按鈕（純靜態預覽）→ enabled 按鈕計數 0。
      prepare: gotoRoute,
      assertions: [
        { id: "no-operable-buttons-in-concept", locator: '[data-uc="concept-root"] button, [data-uc="concept-root"] [role="button"]', expectation: "count_equals", expected: 0 },
      ],
    },
    confirmation: {
      // 誠實調整：概念頁無 toast 動作；可行動作 = 切到 LIVE 模組，確認回饋 =
      // 工作區 A1 dock tab 進入 active 狀態。
      prepare: async (context) => {
        await gotoRoute(context);
        await clickFirst(context.page, '[data-uc="app-a1"]');
      },
      assertions: [
        { id: "workspace-a1-dock-active", locator: '[data-uc="dock-tab-a1"]', expectation: "attribute_equals", attribute: "data-active", expected: "true" },
      ],
    },
    i18n_zh_tw: {
      prepare: gotoRoute,
      assertions: [
        { id: "concept-title-snippet", locator: `text=${CONCEPT_TITLE_SNIPPET[slug]}`, expectation: "visible" },
        { id: "zh-concept-note", locator: "text=本頁為概念稿", expectation: "visible" },
        langZhActive,
      ],
    },
    runtime_truth: runtimeTruthCase(),
  };
}

/* ═══ 合成 registry：`${screenId}:${caseId}` → 143 條 ═══ */

const screenFamilies: ReadonlyArray<readonly [string, ScreenCases]> = [
  ["console.home.default", homeCases()],
  ["workspace.a1.default", workspaceCases("a1")],
  ["workspace.a2.default", workspaceCases("a2")],
  ["workspace.a3.default", workspaceCases("a3")],
  ["workspace.a4.default", a4Cases()],
  ["pipeline.default", pipelineCases()],
  ["runtime.ops.default", opsCases()],
  ["concept.a5.default", conceptCases("a5")],
  ["concept.a6.default", conceptCases("a6")],
  ["concept.a7.default", conceptCases("a7")],
  ["concept.a8.default", conceptCases("a8")],
  ["concept.a9.default", conceptCases("a9")],
  ["concept.a10.default", conceptCases("a10")],
];

export const semanticCaseDefinitions: ReadonlyMap<string, SemanticCaseDefinition> = new Map(
  screenFamilies.flatMap(([screenId, cases]) =>
    Object.entries(cases).map(
      ([caseId, definition]) => [`${screenId}:${caseId}`, definition] as [string, SemanticCaseDefinition],
    ),
  ),
);
