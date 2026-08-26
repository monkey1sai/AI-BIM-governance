// unified-console-runtime-truth slice 1（tasks 1.2）：coordinatorClient 十端點允許清單擴充的 wire 契約，
// 與「GET 非 2xx 丟帶 status 的 CoordinatorHttpError（message 逐字不變）」。
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoordinatorHttpError, coordinatorClient } from "./coordinatorClient";

function mockRes(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, statusText: `HTTP ${status}`, json: async () => body, text: async () => text };
}

describe("coordinatorClient runtime-truth 擴充", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("kitHealth 打 GET /api/kit/health（forward-only proxy）並原樣回 JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.kitHealth()).resolves.toEqual({ status: "ok" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/kit/health");
  });

  it("governanceIssues 打 GET /api/governance/issues 並回 { issues }", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { issues: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.governanceIssues()).resolves.toEqual({ issues: [] });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/governance\/issues$/);
  });

  it("governanceRuleRuns 打 GET /api/governance/rule-runs?limit=N（預設 5）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockRes(200, { filters: {}, limit: 5, offset: 0, total: 0, items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(coordinatorClient.governanceRuleRuns()).resolves.toMatchObject({ total: 0 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/governance/rule-runs?limit=5");
  });

  it("GET 非 2xx 丟 CoordinatorHttpError：帶 status／path，message 逐字維持既有格式", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes(503, { detail: "design_gate_deterministic_offline" })));
    const err = await coordinatorClient.runtimeStatus().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoordinatorHttpError);
    expect(err).toMatchObject({ name: "CoordinatorHttpError", status: 503, path: "/api/runtime/status" });
    expect((err as Error).message).toBe("coordinator /api/runtime/status -> 503 design_gate_deterministic_offline");
  });
});
