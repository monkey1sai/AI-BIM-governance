import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 迴歸守門：.gov-overlay 掛在 .ec-root 之外（App.tsx → Window.tsx，而非 EdgeConsole.tsx），
// 但 GovernanceOverlay.tsx 仍渲染 .ec-btn / .ec-warn-note / .ec-note / .ec-cap / .ec-table 這些
// 由 edge-console.css 上色、引用 var(--ec-*) 的 legacy class。--ec-* token 只定義在 .ec-root 下，
// 故 overlay 需要一份本地 --ec-* 值才能解析。migrate-console-to-hifi-design 把這份本地副本刪掉後，
// 這些 token 在 .gov-overlay 內無處解析 → 按鈕背景/邊框失效、警示色坍縮成內文色。
//
// renderToString 的 unit test（GovernanceOverlay.test.tsx）無 CSS engine，結構性抓不到；只有真實
// 瀏覽器的 computed style 看得見（見 e2e/a9-a10-identity-a4-primary.spec.ts 檔頭同款盲點註記）。
// 本測試以 setContent 直接載入三支真實 CSS，重現 .gov-overlay 不在 .ec-root 下的 DOM，斷言 computed style。

const specDir = dirname(fileURLToPath(import.meta.url));
const readCss = (rel: string) => readFileSync(resolve(specDir, rel), "utf-8");

// @import（Google Fonts）剝除以維持 hermetic（不觸發網路字型抓取）；token 解析不依賴字型載入。
// 注意：字型 URL 內含分號（wght@400;500;700），故以 url(...) 的右括號為界，不可用 [^;]。
const dsCss = readCss("../../docs/plans/ai-bim-governance.css").replace(/@import\s+url\([^)]*\)\s*;/g, "");
const edgeCss = readCss("../src/console/edge-console.css");
const overlayCss = readCss("../src/console/governance/overlay.css");

const PAGE = `<!doctype html><html><head><style>
${dsCss}
${edgeCss}
${overlayCss}
</style></head><body>
  <!-- 刻意不套 .ec-root：真實 DOM 中 .gov-overlay 永遠不是 .ec-root 的後代 -->
  <div class="gov-overlay">
    <button class="ec-btn" id="btn">Export</button>
    <p class="ec-warn-note" id="warn">warn</p>
    <p class="ec-note" id="note">note</p>
  </div>
</body></html>`;

test.describe("GovernanceOverlay legacy .ec-* token 在 .gov-overlay（.ec-root 之外）可解析", () => {
  test("警示色不坍縮、按鈕背景與邊框可見", async ({ page }) => {
    await page.setContent(PAGE);

    const style = (id: string, prop: string) =>
      page.evaluate(
        ([id, prop]) => {
          const el = document.getElementById(id)!;
          return getComputedStyle(el).getPropertyValue(prop).trim();
        },
        [id, prop] as const,
      );

    const warnColor = await style("warn", "color");
    const noteColor = await style("note", "color");
    const btnBg = await style("btn", "background-color");
    const btnBorderStyle = await style("btn", "border-top-style");

    // 警示色（--ec-amb → --ab-warn #e6b23e）必須解析成琥珀警示色，且與一般內文色不同色。
    expect(warnColor).toBe("rgb(230, 178, 62)");
    expect(warnColor).not.toBe(noteColor);

    // 按鈕背景（--ec-bg-3）不得透明；邊框（--ec-line-2 shorthand）不得整條失效。
    expect(btnBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(btnBorderStyle).toBe("solid");
  });
});
