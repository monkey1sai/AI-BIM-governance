import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec §6.5（migrate-console-to-hifi-design Task 7，BREAKING）：
// edge-console.css 退役後，console 下的每一份 CSS（legacy-console.css / governance/overlay.css /
// unified/unified.css / viewer/viewer.css …）一律消費 --ab-* 設計 token，舊的 --ec-* 自訂屬性前綴
// 全域歸零。本檔比照 EdgeConsole.theme-removal.test.ts 手法，把「--ec- 歸零」凍結成持久化回歸守門：
// 日後若有人從歷史 spec / openspec archive 複製舊片段貼回任何 console CSS，CI 會在視覺 QA 前就攔下，
// 而非等顏色跑掉才被人眼發現。
//
// 守門範圍（[f2] 對抗複驗補強）：不再寫死檔名，改為「動態遞迴掃描 src/console 下全部 *.css」——
// 未來新增的 console CSS 檔案自動納入守備，無需回頭改本測試。
//
// 關於 spec §6.5 字面指令 `grep -rc -- "--ec-" web-viewer-sample/src` 的「唯一非零命中」例外：
// 該 grep 掃的是整個 src（含 *.ts/*.tsx），唯一會回非零的是「本守門測試檔自身」——因為要斷言
// /--ec-/ 就得在測試碼裡寫出這個字串（註解、describe/it 敘述、正規式 literal）。這是守門測試自我
// 參照的必然結果，非 production 殘留，屬字面條文允許的唯一例外。本測試只掃 *.css（不掃 *.ts），
// 故此測試自身不會誤判自己；production CSS 側維持「零 --ec-」硬約束。
//
// 注意：守門對象是 --ec-*「自訂屬性 token」（雙 dash），非 .ec-* 「class 命名空間」（單 dash，
// 如 .ec-btn / .ec-warn-note）——後者是 console 既有 class 名，刻意保留，故正規式鎖 /--ec-/。
const consoleDir = resolve(process.cwd(), "src", "console");

function collectCssFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectCssFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".css")) found.push(full);
  }
  return found;
}

const cssFiles = collectCssFiles(consoleDir).sort();

describe("--ec- token 已於 console CSS 全域歸零（edge-console.css 退役，§6.5 BREAKING）", () => {
  // 防呆：discovery 若壞掉（回空陣列）會讓 it.each 產生零案例而「靜默假綠」——先硬斷言至少掃到一檔。
  it("動態掃描至少涵蓋一份 console CSS（discovery 壞掉不得偽綠）", () => {
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  it.each(cssFiles.map((file) => [relative(consoleDir, file).replace(/\\/g, "/"), file] as const))(
    "%s 不再殘留任何 --ec- 自訂屬性 token",
    (_label, file) => {
      expect(readFileSync(file, "utf8")).not.toMatch(/--ec-/);
    },
  );
});
