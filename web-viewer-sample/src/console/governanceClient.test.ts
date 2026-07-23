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

// file-library 邏輯識別 wire 測試：瀏覽器只送 {project_id, model_id, version_name} 三段
// （files/tree 的 version.path 已被 proxy 遮蔽成 "[server-path]"，不可回送），
// 打 coordinator /api/governance-library/*。
describe("governanceClient.createRuleRunForLibrary", () => {
  it("POST /api/governance-library/rule-runs 帶邏輯三段 + ids_path/model_version_id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ rule_run_id: "rr_lib", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await governanceClient.createRuleRunForLibrary({
      project_id: "270",
      model_id: "機電",
      version_name: "ver 竣工.ifc",
      ids_path: "rules/sample-fire-rating.ids",
      model_version_id: "270/機電/ver 竣工.ifc",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/api/governance-library/rule-runs");
    const init = spy.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      project_id: "270",
      model_id: "機電",
      version_name: "ver 竣工.ifc",
      ids_path: "rules/sample-fire-rating.ids",
      model_version_id: "270/機電/ver 竣工.ifc",
    });
    expect(result.rule_run_id).toBe("rr_lib");
  });

  it("404 library_version_not_found → 拋錯含後端 error（誠實，不吞）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "library_version_not_found" }), { status: 404 }),
    );
    await expect(
      governanceClient.createRuleRunForLibrary({ project_id: "270", model_id: "機電", version_name: "nope.ifc" }),
    ).rejects.toThrow(/library_version_not_found/);
  });
});

describe("governanceClient.createDiffForLibrary", () => {
  it("POST /api/governance-library/diffs 帶 base/target 邏輯三段與版本綁定", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ diff_id: "d_lib", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await governanceClient.createDiffForLibrary({
      base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
      target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
      include_geometry: false,
      base_model_version_id: "270/機電/ver 000001.ifc",
      target_model_version_id: "270/機電/ver 竣工.ifc",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/api/governance-library/diffs");
    const init = spy.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
      target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
      include_geometry: false,
      base_model_version_id: "270/機電/ver 000001.ifc",
      target_model_version_id: "270/機電/ver 竣工.ifc",
    });
    expect(result.diff_id).toBe("d_lib");
  });
});

describe("governanceClient A4 scoped search", () => {
  it.each([
    {
      name: "session",
      expectedPath: "/api/governance/search/model/for-session/review_session_x",
      invoke: (carrier: string) => governanceClient.searchModelForSession(
        "review_session_x",
        { query: "IfcDoor", interpret_mode: "deterministic" },
        carrier,
      ),
    },
    {
      name: "ifc-ready",
      expectedPath: "/api/governance/search/model/for-ifc-ready/ifcready_x",
      invoke: (carrier: string) => governanceClient.searchModelForIfcReady(
        "ifcready_x",
        { query: "IfcDoor", interpret_mode: "deterministic" },
        carrier,
      ),
    },
  ])("keeps the $name principal carrier in X-User-Token only", async ({ expectedPath, invoke }) => {
    const carrier = "dynamic_local_lab_principal_carrier";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await invoke(carrier);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain(expectedPath);
    expect(String(url)).not.toContain(carrier);
    expect(init?.headers).toEqual(expect.objectContaining({ "X-User-Token": carrier }));
    expect(String(init?.body)).not.toContain(carrier);
  });

  it("does not expose the generic host-path search client to production callers", () => {
    expect(governanceClient).not.toHaveProperty("searchModel");
  });

  it("keeps scoped model-aware browser deadlines above the coordinator ceiling", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await governanceClient.searchModelForSession(
      "review_session_x",
      { query: "IfcDoor", interpret_mode: "deterministic" },
      "local_lab_principal",
    );
    expect(timeoutSpy).toHaveBeenLastCalledWith(15_000);

    await governanceClient.searchModelForSession(
      "review_session_x",
      { query: "doors on level two", interpret_mode: "semantic" },
      "local_lab_principal",
    );
    expect(timeoutSpy).toHaveBeenLastCalledWith(150_000);

    await governanceClient.searchModelForIfcReady(
      "ifcready_x",
      { query: "doors on level two", interpret_mode: "auto" },
      "local_lab_principal",
    );
    expect(timeoutSpy).toHaveBeenLastCalledWith(150_000);

    await governanceClient.searchModelForIfcReady(
      "ifcready_x",
      { query: "doors on level two" },
      "local_lab_principal",
    );
    expect(timeoutSpy).toHaveBeenLastCalledWith(150_000);
  });

  it("fails closed before fetch when the local-dev carrier is empty", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    await expect(governanceClient.searchModelForSession(
      "review_session_x",
      { query: "IfcDoor" },
      "",
    )).rejects.toThrow(/principal carrier/i);
    expect(spy).not.toHaveBeenCalled();
  });
});
