// Task 4A：jsonGet 失敗時可辨識的 404（供 4B/4C dev routes 誠實狀態使用）。
// CoordinatorHttpError 攜帶 status；message 格式與既有 `coordinator ${path} -> ${status} ${detail}`
// 逐字相同（既有測試如 coordinatorClient.test.ts 的 rejects.toThrow(/.../) 不得因此變紅）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, CoordinatorHttpError, isCoordinatorNotFound } from "./coordinatorClient";

describe("coordinatorClient jsonGet：CoordinatorHttpError / isCoordinatorNotFound", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("404 失敗時 throw CoordinatorHttpError，status=404 且 message 與既有格式逐字相同", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "ifc-ready job 不存在" }), { status: 404, statusText: "Not Found" }),
    );
    let caught: unknown;
    try {
      await coordinatorClient.getIfcReadyJob("ifcready_missing");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CoordinatorHttpError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as CoordinatorHttpError;
    expect(err.status).toBe(404);
    expect(err.path).toBe("/api/external/ifc-ready/ifcready_missing");
    // 逐字對齊修改前的 `coordinator ${path} -> ${res.status} ${await errorDetail(res)}`。
    expect(err.message).toBe("coordinator /api/external/ifc-ready/ifcready_missing -> 404 ifc-ready job 不存在");
    expect(isCoordinatorNotFound(err)).toBe(true);
  });

  it("isCoordinatorNotFound 只對 status=404 的 CoordinatorHttpError 回 true；非 404／非此類一律 false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream 502 plain", { status: 502, statusText: "Bad Gateway" }),
    );
    let caught502: unknown;
    try {
      await coordinatorClient.getIfcReadyJob("ifcready_x");
    } catch (e) {
      caught502 = e;
    }
    expect(caught502).toBeInstanceOf(CoordinatorHttpError);
    expect((caught502 as CoordinatorHttpError).status).toBe(502);
    expect(isCoordinatorNotFound(caught502)).toBe(false);
    expect(isCoordinatorNotFound(new Error("plain error, not CoordinatorHttpError"))).toBe(false);
    expect(isCoordinatorNotFound(null)).toBe(false);
    expect(isCoordinatorNotFound(undefined)).toBe(false);
  });
});
