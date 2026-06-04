// web-viewer-sample/src/console/routing.test.ts
import { describe, expect, it } from "vitest";
import { isOperatorConsolePath } from "./routing";

describe("operator console 路由判定（保留既有 viewer）", () => {
  it("/console、/console/coordinator、#/console/intake → operator", () => {
    expect(isOperatorConsolePath("/console", "")).toBe(true);
    expect(isOperatorConsolePath("/console/coordinator", "")).toBe(true);
    expect(isOperatorConsolePath("/", "#/console/intake")).toBe(true);
  });
  it("巢狀 /foo/console 不誤判為 operator（pathname 只認根層 /console）", () => {
    expect(isOperatorConsolePath("/foo/console", "")).toBe(false);
  });
  it("一般 viewer 路徑（含 ?session=）→ 非 operator（維持 <App/>）", () => {
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/", "")).toBe(false);
    expect(isOperatorConsolePath("/viewer", "")).toBe(false);
  });

  // W8：短 hash #coordinator / #intake / #runtime → operator（無 session= 時）。
  it("短 hash #coordinator / #intake / #runtime（query 無 session=）→ operator", () => {
    expect(isOperatorConsolePath("/", "#coordinator")).toBe(true);
    expect(isOperatorConsolePath("/", "#intake")).toBe(true);
    expect(isOperatorConsolePath("/", "#runtime")).toBe(true);
  });
  it("短 hash 但 query 帶 session= → 非 operator（viewer ?session= 進件優先）", () => {
    expect(isOperatorConsolePath("/", "#coordinator", "?session=review_session_x")).toBe(false);
  });
  it("巢狀 /foo/console（即使帶短 hash 以外）仍非 operator（pathname 只認根層 /console）", () => {
    expect(isOperatorConsolePath("/foo/console", "")).toBe(false);
  });
});
