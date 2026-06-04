// web-viewer-sample/src/console/routing.test.ts
import { describe, expect, it } from "vitest";
import { isOperatorConsolePath } from "./routing";

describe("operator console 路由判定（保留既有 viewer）", () => {
  it("/console、/console/coordinator、#/console/intake → operator", () => {
    expect(isOperatorConsolePath("/console", "")).toBe(true);
    expect(isOperatorConsolePath("/console/coordinator", "")).toBe(true);
    expect(isOperatorConsolePath("/", "#/console/intake")).toBe(true);
  });
  it("一般 viewer 路徑（含 ?session=）→ 非 operator（維持 <App/>）", () => {
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/viewer", "")).toBe(false);
  });
});
