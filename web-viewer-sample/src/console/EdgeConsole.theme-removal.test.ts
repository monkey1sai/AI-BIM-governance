import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// console-design-token-authority spec R2：UnifiedConsole 收斂為純深色，
// 不提供亮色主題切換（UI / state / localStorage 讀寫全移除）。
const src = readFileSync(
  resolve(process.cwd(), "src", "console", "EdgeConsole.tsx"),
  "utf8",
);

describe("EdgeConsole 主題切換已移除（純深色 console）", () => {
  it.each(["aibim:ec-theme", "theme-light", "setTheme", '"light"'])(
    "源碼不再含 %s",
    (needle) => {
      expect(src).not.toContain(needle);
    },
  );
});
