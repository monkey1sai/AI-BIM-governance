import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// 迴歸守門：FlowBar/Stepper 的「已完成（done）」與「當前（active）」兩狀態必須視覺可辨、色彩語意自洽。
// spec §2.1「已完成=綠、當前=青圈」（見 src/console/a1Machine.ts:91-97、a1Machine.test.ts:145）：
//   done   → 內圈數字點 = 實心「綠」（--ab-ok），與 chip 外框（.ec-flow-step.done，同為 --ab-ok）同色。
//   active → 內圈數字點 = 深底「青」圈（--ab-accent 邊框 + glow），非實心填色。
//
// legacy-console.css 在 §6.5 遷移中，同一選擇器 `.ec-flow-step.done .ec-flow-n` 被宣告兩次：
//   前段基礎規則   background:var(--ab-ok)     （綠，正確語意）
//   後段 polish 區塊 background:var(--ab-accent) （青，機械式 --ec-grn→--ab-accent 替換的殘留）
// 兩條 specificity 完全相同、無 @media/!important 條件，CSS cascade 後者勝出 → done 內點誤渲成青，
// 與同一 chip 仍為綠的外框自相矛盾。此衝突是 computed-style 層級（字串測試 ec-token-retirement.test.ts
// 抓不到，因為兩個 token 都是合法 --ab-*；只有真實瀏覽器的 cascade 解析看得見），故以 Playwright setContent
// 直接載入 DS + legacy 兩支真實 CSS、重現 FlowBar DOM，斷言 computed style。

const specDir = dirname(fileURLToPath(import.meta.url));
const readCss = (rel: string) => readFileSync(resolve(specDir, rel), "utf-8");

// @import（Google Fonts）剝除以維持 hermetic（不觸發網路字型抓取）；color token 解析不依賴字型載入。
const dsCss = readCss("../../docs/plans/ai-bim-governance.css").replace(/@import\s+url\([^)]*\)\s*;/g, "");
const legacyCss = readCss("../src/console/legacy-console.css");

// 真實 DOM 對齊 EdgeConsole.tsx:212 / modelData/conversionShared.tsx:20：
//   <span class="ec-flow-step {done|active}"><span class="ec-flow-n">N</span>label</span>
const PAGE = `<!doctype html><html><head><style>
${dsCss}
${legacyCss}
</style></head><body>
  <div class="ec-flow">
    <span style="display:flex;align-items:center;gap:4px">
      <span class="ec-flow-step done" id="done-step"><span class="ec-flow-n" id="done-n">1</span>Intake</span>
    </span>
    <span class="ec-flow-arrow">→</span>
    <span style="display:flex;align-items:center;gap:4px">
      <span class="ec-flow-step active" id="active-step"><span class="ec-flow-n" id="active-n">2</span>Convert</span>
    </span>
  </div>
</body></html>`;

// --ab-ok #31c56d = rgb(49, 197, 109)（綠）；--ab-accent #41c7e8 = rgb(65, 199, 232)（青）；
// --ab-on-accent #04121a = rgb(4, 18, 26)（實心亮色填底上的深墨；DS 無 --ab-on-ok，故 done 綠點沿用此墨色）。
const OK_GREEN = "rgb(49, 197, 109)";
const ACCENT_CYAN = "rgb(65, 199, 232)";
const ON_ACCENT_INK = "rgb(4, 18, 26)";

test.describe("FlowBar/Stepper done=綠 / active=青 色彩語意自洽（.ec-flow-step .ec-flow-n）", () => {
  test("done 內點實心綠、與 chip 外框同色、與 active 態可辨；active 內點非綠實心", async ({ page }) => {
    await page.setContent(PAGE);

    const style = (id: string, prop: string) =>
      page.evaluate(
        ([id, prop]) => {
          const el = document.getElementById(id)!;
          return getComputedStyle(el).getPropertyValue(prop).trim();
        },
        [id, prop] as const,
      );

    const doneBg = await style("done-n", "background-color");
    const doneBorder = await style("done-n", "border-top-color");
    const doneInk = await style("done-n", "color");
    const doneChipBorder = await style("done-step", "border-top-color");
    const activeBg = await style("active-n", "background-color");
    const activeBorder = await style("active-n", "border-top-color");

    // 核心迴歸：done 內點填色必為綠（--ab-ok），不得被後段 polish 覆寫回青（--ab-accent）。
    expect(doneBg).toBe(OK_GREEN);
    expect(doneBg).not.toBe(ACCENT_CYAN);

    // 內部一致：done 內點邊框同綠、且與 chip 外框（.ec-flow-step.done → --ab-ok）同色，不留青環殘影。
    expect(doneBorder).toBe(OK_GREEN);
    expect(doneChipBorder).toBe(OK_GREEN);

    // done 內點數字沿用 --ab-on-accent 深墨（DS 無 --ab-on-ok；深墨於綠底可讀），鎖定此刻意決策不被改成低對比色。
    expect(doneInk).toBe(ON_ACCENT_INK);

    // 狀態可辨：active 內點是深底青圈（邊框青、非實心綠填），與 done 的實心綠明確區隔。
    expect(activeBg).not.toBe(OK_GREEN);
    expect(activeBorder).toBe(ACCENT_CYAN);
    expect(doneBg).not.toBe(activeBg);
  });
});
