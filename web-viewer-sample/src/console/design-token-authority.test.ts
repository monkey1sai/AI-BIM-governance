import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec R1：ai-bim-governance.css 為唯一 production design
// token 權威，SHALL 真實 import（vitest cwd = web-viewer-sample）。jsdom 不算 layout，
// 故以靜態存在性把關：import 邊、token 定義邊各驗一半。
const authorityCss = readFileSync(
  resolve(process.cwd(), "..", "docs", "plans", "ai-bim-governance.css"),
  "utf8",
);
const edgeConsoleTsx = readFileSync(
  resolve(process.cwd(), "src", "console", "EdgeConsole.tsx"),
  "utf8",
);

describe("ai-bim-governance.css 是被真實 import 的唯一 token 權威", () => {
  it("EdgeConsole.tsx import 授權檔（相對路徑指向 docs/plans 正本，不是副本）", () => {
    expect(edgeConsoleTsx).toContain('import "../../../docs/plans/ai-bim-governance.css"');
  });

  it.each([
    "--ab-accent-soft",
    "--ab-accent-strong",
    "--ab-info-soft",
    "--ab-warn-soft",
    "--ab-danger-soft",
    "--ab-violet-soft",
    "--ab-ok-soft",
    "--ab-space-9",
    "--ab-shadow-card",
    "--ab-ease",
    "--ab-dur-fast",
    "--ab-dur",
    "--ab-dur-slow",
    "--ab-track-label",
    "--ab-track-tag",
    "--ab-fs-page",
    "--ab-fs-h2",
    "--ab-fs-h3",
    "--ab-fs-body",
    "--ab-fs-sm",
    "--ab-fs-xs",
    "--ab-fs-mono",
    "--ab-scroll-thumb",
    "--ab-scroll-thumb-hover",
    "--ab-text-ghost",
    "--ab-violet-dim",
    "--ab-violet-bright",
  ])("缺口 token %s 已定義於授權檔", (token) => {
    expect(authorityCss).toContain(`${token}:`);
  });

  it("核心 token 值未被漂移（權威值凍結）", () => {
    expect(authorityCss).toContain("--ab-bg:            #060a10");
    expect(authorityCss).toContain("--ab-accent:        #41c7e8");
    expect(authorityCss).toContain("--ab-accent-2:      #2f7bf6");
  });
});
