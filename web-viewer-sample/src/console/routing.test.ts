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

  // CH-E：6 路由 + #/ 前綴 + coordinator /ui 正規入口。
  it("短 hash 支援 #/ 前綴與新路由 review / kit / demo-control（query 無 session=）", () => {
    expect(isOperatorConsolePath("/", "#/coordinator")).toBe(true);
    expect(isOperatorConsolePath("/", "#/review")).toBe(true);
    expect(isOperatorConsolePath("/", "#/kit")).toBe(true);
    expect(isOperatorConsolePath("/", "#/demo-control")).toBe(true);
    expect(isOperatorConsolePath("/", "#review")).toBe(true);
    expect(isOperatorConsolePath("/", "#/workspace?dock=a4")).toBe(true);
  });
  it("短 hash 支援 Review Room handoff query（#review?source=a1 / #gpu?source=a1）→ operator", () => {
    expect(isOperatorConsolePath("/", "#review?source=a1&rule_run_id=rr_a1&session=review_session_x")).toBe(true);
    expect(isOperatorConsolePath("/", "#/review?source=a1&ifc_guid=g1")).toBe(true);
    expect(isOperatorConsolePath("/", "#gpu?source=a1&rule_run_id=rr_a1")).toBe(true);
  });
  it("coordinator 服務的 /ui pathname → operator console（CH-E 正規入口）", () => {
    expect(isOperatorConsolePath("/ui", "")).toBe(true);
    expect(isOperatorConsolePath("/ui", "#/kit")).toBe(true);
    expect(isOperatorConsolePath("/ui/", "")).toBe(true);
  });
  it("/ui 但帶 ?session= → 非 operator（viewer attach 優先；理論上不會出現但保險）", () => {
    expect(isOperatorConsolePath("/ui", "#/kit", "?session=review_session_x")).toBe(false);
  });
  it("未知短 hash（#/nope）→ 非 operator", () => {
    expect(isOperatorConsolePath("/", "#/nope")).toBe(false);
  });
  it("[F8-route] app/ 前綴願景詳頁 deep-link（EdgeConsole 動態 case）→ operator console", () => {
    expect(isOperatorConsolePath("/", "#app/ai-search")).toBe(true);
    expect(isOperatorConsolePath("/", "#/app/4d-5d")).toBe(true);
    expect(isOperatorConsolePath("/", "#app/ai-search?x=1")).toBe(true);
    // 前綴匹配不得過寬：空 slug 與相似字首不放行。
    expect(isOperatorConsolePath("/", "#app/")).toBe(false);
    expect(isOperatorConsolePath("/", "#apple")).toBe(false);
  });
});
