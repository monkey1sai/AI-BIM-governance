// governanceClient.filesTree()：驗證打 /api/governance/files/tree（coordinator proxy）並回傳樹。
import { afterEach, describe, expect, it, vi } from "vitest";
import { governanceClient } from "./governanceClient";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("governanceClient.filesTree", () => {
  it("GET /api/governance/files/tree 並回傳解析後的樹", async () => {
    const tree = {
      root: "C:/Repos/active/iot/AI-BIM-governance/storage",
      source_kind: "local_fs",
      projects: [
        {
          project_id: "270",
          models: [
            { model_id: "機電", versions: [{ name: "ver 竣工.ifc", path: "C:/Repos/active/iot/AI-BIM-governance/storage/270/機電/ver 竣工.ifc", size_bytes: 22618, mtime: "2026-06-10T17:17:00+08:00" }] },
          ],
        },
      ],
    };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(tree), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await governanceClient.filesTree();

    expect(spy).toHaveBeenCalledTimes(1);
    const calledUrl = String(spy.mock.calls[0][0]);
    expect(calledUrl).toContain("/api/governance/files/tree");
    expect(result.source_kind).toBe("local_fs");
    expect(result.projects[0].project_id).toBe("270");
    expect(result.projects[0].models[0].versions[0].name).toBe("ver 竣工.ifc");
  });

  it("proxy 回非 2xx → 拋錯（誠實，不吞）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
    await expect(governanceClient.filesTree()).rejects.toThrow();
  });
});
