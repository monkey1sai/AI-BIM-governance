import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec §6.5（migrate-console-to-hifi-design Task 7，BREAKING）：
// edge-console.css 退役後，legacy-console.css 與 governance/overlay.css 一律消費 --ab-* 設計
// token，舊的 --ec-* 自訂屬性前綴全域歸零。本檔比照 EdgeConsole.theme-removal.test.ts 手法，
// 把「--ec- 歸零」凍結成持久化回歸守門：日後若有人從歷史 spec / openspec archive 複製舊片段
// 貼回這兩個 console CSS，CI 會在視覺 QA 前就攔下，而非等顏色跑掉才被人眼發現。
//
// 注意：守門對象是 --ec-*「自訂屬性 token」（雙 dash），非 .ec-* 「class 命名空間」（單 dash，
// 如 .ec-btn / .ec-warn-note）——後者是 console 既有 class 名，刻意保留，故正規式鎖 /--ec-/。
const consoleDir = resolve(process.cwd(), "src", "console");
const legacyConsoleCss = readFileSync(resolve(consoleDir, "legacy-console.css"), "utf8");
const overlayCss = readFileSync(resolve(consoleDir, "governance", "overlay.css"), "utf8");

describe("--ec- token 已於 console CSS 全域歸零（edge-console.css 退役，§6.5 BREAKING）", () => {
  it.each([
    ["legacy-console.css", legacyConsoleCss],
    ["governance/overlay.css", overlayCss],
  ])("%s 不再殘留任何 --ec- 自訂屬性 token", (_label, css) => {
    expect(css).not.toMatch(/--ec-/);
  });
});
