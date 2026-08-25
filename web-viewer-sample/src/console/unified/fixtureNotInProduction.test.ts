// unified-console-runtime-truth slice 1（tasks 1.8；spec scenario「fixture 假值不在 production 顯示路徑（符號層驗證）」）：
// (1) import graph：production 元件不得 import 假資料 export；docks／WorkspacePage 的 4 個 slice-2 欠帳以 ratchet 釘住。
// (2) fixtures.ts 不再 export 已搬走的 6 個名稱（initialIssues 留在 production：a3 Issues dock 種入，見 SLICE2_DEBT）。(3) src 下非測試檔不得 import __testdata__。
// (4) 渲染層負向 oracle：#home／#pipeline／#runtime 的 SSR 輸出不含任何原型固定值字串。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { getLang, setLang } from "../i18n";
import { alerts, initialConv, initialIntake, initialIssues, initialOutbox, initialSessions } from "./__testdata__/prototypeFixtures";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..", "..");

const FORBIDDEN = [
  "initialIntake", "initialConv", "initialSessions", "initialOutbox", "initialIssues", "alerts", "services",
  "failDefs", "diffDefs", "fedMembers", "stageTree",
] as const;
const RELOCATED = ["initialIntake", "initialConv", "initialSessions", "initialOutbox", "alerts", "services"] as const;
const PRODUCTION = ["HomePage.tsx", "PipelinePage.tsx", "OpsPage.tsx", "UnifiedShell.tsx", "docks.tsx", "WorkspacePage.tsx", "A1DockLive.tsx", "ConceptPage.tsx", "ServiceHealthList.tsx"] as const;
/** slice 1 誠實欠帳（spec §3 out of scope：§2 dock 互動／§3 A1 視區）；只能縮、不能擴。 */
const SLICE2_DEBT: Record<string, readonly string[]> = {
  "docks.tsx": ["diffDefs", "failDefs", "fedMembers"],
  "WorkspacePage.tsx": ["stageTree"],
  "UnifiedShell.tsx": ["initialIssues"], // Issues/BCF dock 種入（§2 範圍；P3 f1）
};

function importedNamesFromFixtures(source: string): string[] {
  const names: string[] = [];
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"\.\/fixtures"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("fixture 假資料不在 production 顯示路徑", () => {
  it("(1) production 元件 import 自 ./fixtures 的名稱與禁用清單交集＝slice-2 欠帳表（ratchet）", () => {
    for (const file of PRODUCTION) {
      const names = importedNamesFromFixtures(readFileSync(path.join(here, file), "utf8"));
      const forbidden = names.filter((n) => (FORBIDDEN as readonly string[]).includes(n)).sort();
      expect(forbidden, file).toEqual([...(SLICE2_DEBT[file] ?? [])].sort());
    }
  });

  it("(2) fixtures.ts 不再 export 已搬走的 6 個假資料名稱（initialIssues 留在 production 供 a3 Issues dock 種入，見 SLICE2_DEBT）", () => {
    const src = readFileSync(path.join(here, "fixtures.ts"), "utf8");
    for (const name of RELOCATED) expect(src, name).not.toMatch(new RegExp(`export\\s+const\\s+${name}\\b`));
    expect(src).not.toContain("export interface AlertDef");
    expect(src).not.toContain("export interface ServiceDef");
  });

  it("(3) src 下非測試檔不得 import __testdata__", () => {
    const offenders = walk(srcRoot)
      .filter((f) => !/\.(test|spec)\.tsx?$/.test(f) && !f.includes(`${path.sep}__testdata__${path.sep}`))
      .filter((f) => /__testdata__\//.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });

  describe("(4) 渲染層負向 oracle", () => {
    let prevLang: ReturnType<typeof getLang>;
    beforeEach(() => { prevLang = getLang(); setLang("zh"); });
    afterEach(() => { setLang(prevLang); });
    const literals = [
      ...initialIntake.map((x) => x.file), ...initialConv.map((x) => x.file), ...initialSessions.map((x) => x.id),
      ...initialOutbox.map((x) => x.id), ...initialIssues.map((x) => x.id), ...initialIssues.map((x) => x.title), ...alerts.map((x) => x.msgZh),
    ];
    for (const hash of ["#home", "#pipeline", "#runtime"]) {
      it(`${hash} 不含任何原型固定值（${literals.length} 個字串）`, () => {
        const prevHash = window.location.hash;
        try {
          window.location.hash = hash;
          const html = renderToString(createElement(EdgeConsole)); // .ts 檔（tasks.md 指定檔名）不用 JSX
          for (const lit of literals) expect(html, lit).not.toContain(lit);
        } finally {
          window.location.hash = prevHash;
        }
      });
    }
  });
});
