import { test, expect } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

// CH-H1：中央 3D 視區「不再空白」。harness（無 GPU）下，原本中央是空白 <video>；現以資訊濃密 mock viewport
// 取代——明標 deterministic·no-GPU（非壞掉），含範本①模型資訊卡 + ④對構表（誠實空狀態）+ loaded layers + 選取 echo。
// 截圖證明「不空白、友善」。真實 ①④ 資料 + live 3D 由 real-ifc 路徑驗。
test.describe("CH-H1 semantic viewer · mock viewport（harness 不空白）", () => {
  test("?harness=1 中央顯資訊濃密 mock viewport（banner/stage/model-info/mapping/layers），非空白", async ({ page }) => {
    await page.goto(harnessRoute());

    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("geo-viewer-left-model")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-center-stage")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-runtime-evidence")).toContainText(/primary|spectator|session/i);

    // 明標非壞掉
    await expect(page.getByTestId("mock-viewport-banner")).toContainText(/no-GPU|deterministic/);

    // 範本①模型資訊卡 + ④對構表 都在中央（不再只有空白視區）
    await expect(page.getByTestId("model-info-card")).toBeVisible();
    await expect(page.getByTestId("mapping-table")).toBeVisible();

    // harness 無真實 mapping_url，但提供標記為 fake 的 demo mapping（見 harness/fixtures/harnessMapping.ts）；
    // MappingTable 既有 fake-mapping 誠實標示機制顯示 mapping-row + mapping-fake badge，不冒充真實對映。
    await expect(page.getByTestId("mapping-row").first()).toBeVisible();
    await expect(page.getByTestId("mapping-fake")).toBeVisible();

    // 資訊濃密證據：harness 三圖層（Building Shell / Levels / MEP）
    await expect(page.getByTestId("mock-layer-count")).toHaveText(/[1-9]/);
    await expect(page.getByTestId("mock-layers")).toBeVisible();

    // viewport 狀態區（stage / selected echo）存在
    await expect(page.getByTestId("mock-stage-url")).toBeVisible();
    await expect(page.getByTestId("mock-selected")).toBeVisible();

    // CH-H1b：範本式 section nav（模型 active；批註等 roadmap 誠實 disabled）
    await expect(page.getByTestId("gv-nav")).toBeVisible();
    await expect(page.getByTestId("nav-model")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("nav-批註")).toBeDisabled();
    const outerScroll = await page.evaluate(() => ({
      documentOverflows: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      bodyOverflows: document.body.scrollHeight > window.innerHeight + 1,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      bodyScrollHeight: document.body.scrollHeight,
      windowInnerHeight: window.innerHeight,
    }));
    expect(outerScroll.documentOverflows, JSON.stringify(outerScroll)).toBe(false);
    expect(outerScroll.bodyOverflows, JSON.stringify(outerScroll)).toBe(false);
    await expect(page.locator(".stage-truth-panel")).toHaveCount(0);
    await expect(page.getByText("DERIVED ready")).toHaveCount(0);
    await expect(page.getByTestId("gov-run-rulecheck")).toHaveCount(0);

    await page.screenshot({ path: "../artifacts/e2e/gov-viewer-layout.png", fullPage: true });
  });

  test("?harness=1 窄視窗七軸 rail 不溢出，且 model tab 不顯示治理/debug 面板", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto(harnessRoute());

    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("viewer-seven-axis-rail")).toBeVisible();
    await expect(page.getByTestId("mapping-table")).toBeVisible();

    const viewportBox = await mv.boundingBox();
    const railBox = await page.getByTestId("viewer-seven-axis-rail").boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect((railBox?.x ?? 0) + (railBox?.width ?? 0)).toBeLessThanOrEqual((viewportBox?.x ?? 0) + (viewportBox?.width ?? 0) + 1);

    const bridge = page.getByTestId("viewer-session-bridge");
    await expect(bridge).toContainText("role");
    await expect(bridge).toContainText("session");
    await expect(bridge).toContainText("stream");
    await expect(bridge).toContainText("File");
    await expect(bridge).toContainText("Runtime");
    await expect(bridge).toContainText("Semantic");
    await expect(page.getByTestId("viewer-seven-axis-rail")).toContainText("A1 疊加");
    await expect(page.getByTestId("viewer-seven-axis-rail")).toContainText("反向定位");
    await expect(page.getByTestId("mock-stage")).not.toContainText("Stage truth");
    await expect(bridge).not.toContainText("Command evidence");
    await expect(bridge).not.toContainText("Review Room");
    await expect(bridge).not.toContainText("mutating commands gated open");

    await page.screenshot({ path: "../artifacts/e2e/gov-viewer-layout-narrow.png", fullPage: true });
  });

  // Task 2 §Step1-3 幾何契約：淺層 toBeVisible 抓不到「gv-C 是不是真的 3 欄x3 列 grid、五區是不是 gv-C 直接子節點」。
  // 這條斷言 .gv-C 本身 display:grid + 五具名區、evidence/left/center/right/bottom 為直接 grid item，並用 boundingBox
  // 驗證 evidence 滿版置頂、left|center|right 併排同列、bottom 滿版置底。對舊的巢狀 2 欄版會 RED（display:block、子節點非直屬）。
  test("?harness=1 C 區塊為真 3x3 grid IA（evidence 滿版 / left|center|right 併排 / bottom 滿版），非巢狀 2 欄", async ({ page }) => {
    await page.goto(harnessRoute());
    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });

    // 1) mock-viewport（.gv-C）本身即 grid 容器，且五具名區在 grid-template-areas 內
    const grid = await mv.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, areas: cs.gridTemplateAreas };
    });
    expect(grid.display).toBe("grid");
    expect(grid.areas).toContain("evidence evidence evidence");
    expect(grid.areas).toContain("left center right");
    expect(grid.areas).toContain("bottom bottom bottom");

    // 2) 五個 IA 區塊必須是 .gv-C 的「直接子節點」(grid item)，否則 grid-area 對它們無效
    const directChildren = await mv.evaluate((el) => ({
      evidence: el.querySelector(':scope > [data-testid="geo-viewer-runtime-evidence"]') ? 1 : 0,
      left: el.querySelector(':scope > [data-testid="geo-viewer-left-model"]') ? 1 : 0,
      center: el.querySelector(':scope > [data-testid="geo-viewer-center-stage"]') ? 1 : 0,
      right: el.querySelector(':scope > [data-testid="geo-viewer-right-semantic"]') ? 1 : 0,
      bottom: el.querySelector(':scope > [data-testid="geo-viewer-bottom-mapping"]') ? 1 : 0,
    }));
    expect(directChildren).toEqual({ evidence: 1, left: 1, center: 1, right: 1, bottom: 1 });

    // 3) evidence 只含 3 個 span（Step2：把 runtime 佐證抽成獨立區塊，不是既有 KV 表貼 testid）
    const evidenceSpanCount = await page
      .getByTestId("geo-viewer-runtime-evidence")
      .evaluate((el) => el.querySelectorAll(":scope > span").length);
    expect(evidenceSpanCount).toBe(3);

    // 4) boundingBox 幾何：evidence 滿版置頂、三欄併排同列、bottom 滿版置底
    const box = async (tid: string) => {
      const b = await page.getByTestId(tid).boundingBox();
      if (!b) throw new Error(`missing bounding box for ${tid}`);
      return b;
    };
    const [evidence, left, center, right, bottom] = await Promise.all([
      box("geo-viewer-runtime-evidence"),
      box("geo-viewer-left-model"),
      box("geo-viewer-center-stage"),
      box("geo-viewer-right-semantic"),
      box("geo-viewer-bottom-mapping"),
    ]);
    // evidence 在三欄之上且比任一單欄寬（滿版）
    expect(evidence.y + evidence.height).toBeLessThanOrEqual(left.y + 2);
    expect(evidence.width).toBeGreaterThan(center.width + 40);
    // left | center | right 併排同一列，由左至右
    expect(left.x).toBeLessThan(center.x);
    expect(center.x).toBeLessThan(right.x);
    expect(Math.abs(left.y - center.y)).toBeLessThan(6);
    expect(Math.abs(center.y - right.y)).toBeLessThan(6);
    // bottom 對構帶在三欄之下且滿版
    expect(bottom.y).toBeGreaterThan(center.y);
    expect(bottom.width).toBeGreaterThan(center.width + 40);
  });

  // Task2 修復契約：reservedLeft（USD Stage Dock 開啟，?debug=1 或 Kit 回報 usdPrims）灌進 .gv-mock 內距時，
  // 收欄斷點必須看「.gv-mock 內容框可用寬」而非僅視窗寬。中等視窗（1100px）+ reservedLeft(300) 下可用寬僅 ~786px
  // 塞不下三欄最小需求(~916px)，舊版只看 @media(max-width:980px) 不會收欄，.gv-C{overflow:hidden} 便把右側語意欄
  // (②IFC語意/③Pset·Qto/⑥空間)靜默裁到框外看不到。此測驗證修復後 .gv-C 收成單欄、無被裁切的水平溢出、右欄完整可見。
  test("?harness=1&debug=1 中等視窗 reservedLeft 生效時，C 版面收單欄、右側語意欄不被 overflow 靜默裁切", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(harnessRoute({ debug: "1" }));

    const mv = page.getByTestId("mock-viewport");
    await expect(mv).toBeVisible({ timeout: 30_000 });
    const right = page.getByTestId("geo-viewer-right-semantic");
    await expect(right).toBeVisible();

    const diag = await mv.evaluate((el) => {
      const mock = el.closest(".gv-mock") as HTMLElement | null;
      const mockCs = mock ? getComputedStyle(mock) : null;
      const gridCs = getComputedStyle(el);
      return {
        paddingLeft: mockCs ? parseFloat(mockCs.paddingLeft) : -1,
        gridTemplateColumns: gridCs.gridTemplateColumns,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });

    // 前置條件：reservedLeft 已生效（.gv-mock paddingLeft 被灌入 sidebar 寬 ~300）。不成立代表觸發條件改變，須重校準。
    expect(diag.paddingLeft, JSON.stringify(diag)).toBeGreaterThan(100);
    // 修復目標一：可用寬不足 → C 版面收單欄（grid-template-columns 只剩單一 track），不維持三欄。
    expect(diag.gridTemplateColumns.trim().split(/\s+/).length, JSON.stringify(diag)).toBe(1);
    // 修復目標二：.gv-C 無被裁切的水平溢出（收欄後 scrollWidth 不超過 clientWidth）。舊版此處 916 > 786 為 RED。
    expect(diag.scrollWidth, JSON.stringify(diag)).toBeLessThanOrEqual(diag.clientWidth + 1);

    // 修復目標三：右側語意欄整體落在 .gv-C 可視框內，不被裁到框外消失。
    const cBox = await mv.boundingBox();
    const rBox = await right.boundingBox();
    expect(cBox).not.toBeNull();
    expect(rBox).not.toBeNull();
    const geom = { cRight: (cBox?.x ?? 0) + (cBox?.width ?? 0), rRight: (rBox?.x ?? 0) + (rBox?.width ?? 0) };
    expect(geom.rRight, JSON.stringify(geom)).toBeLessThanOrEqual(geom.cRight + 1);
  });
});
