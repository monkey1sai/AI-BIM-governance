import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// conv-prioritize-retry / Task 5 fix：IntentDialog.tsx 用到的 modal class 必須在 edge-console.css 有定義，
// 否則在 browser E2E 下 backdrop/置中/浮層全失效（class name 存在但無樣式 → 視覺損壞）。
// jsdom 不會從 stylesheet 計算 layout，無法測 computed style；改以靜態 selector 存在性把關。
// vitest cwd = package root（web-viewer-sample），故用相對 package 的路徑讀檔。
const css = readFileSync(
  resolve(process.cwd(), "src/console/edge-console.css"),
  "utf8",
);

describe("edge-console.css 提供 IntentDialog modal 樣式", () => {
  it.each([
    ".ec-modal-backdrop",
    ".ec-modal",
    ".ec-modal-actions",
    ".ec-field-k",
    ".ec-input",
  ])("定義了 %s", (selector) => {
    expect(css).toContain(`${selector} {`);
  });

  it("backdrop 有 fixed 覆蓋與 z-index 浮層", () => {
    const block = css.slice(css.indexOf(".ec-modal-backdrop {"));
    const rule = block.slice(0, block.indexOf("}"));
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/z-index/);
  });
});
