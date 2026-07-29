// governanceClient.filesTree()：驗證打 /api/governance/files/tree（coordinator proxy）並回傳樹。
import { afterEach, describe, expect, it, vi } from "vitest";
import { A4GovernanceError, governanceClient } from "./governanceClient";

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

describe("governanceClient A4 bounded contract", () => {
  it("sends session search controls only; browser has no generic host-path method", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "ok",
        interpreted_filters: { raw_query: "IfcDoor", interpretable: true },
        results: [],
        stats: { total: 0, matched: 0, unmapped: 0, scanned: 0 },
        evidence_refs: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await governanceClient.searchModelForSession("review_session_a4", {
      query: "IfcDoor",
      interpret_mode: "deterministic",
      limit: 10,
    });

    expect(String(spy.mock.calls[0][0])).toContain("/api/governance/search/model/for-session/review_session_a4");
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      query: "IfcDoor",
      interpret_mode: "deterministic",
      limit: 10,
    });
    expect("searchModel" in governanceClient).toBe(false);
  });

  it("confirms a partial candidate through the session route with only its opaque id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        status: "ok",
        interpreted_filters: { raw_query: "IfcDoor", interpretable: true },
        results: [],
        stats: { total: 0, matched: 0, unmapped: 0, scanned: 0 },
        evidence_refs: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await governanceClient.confirmModelSearchPartialForSession(
      "review_session_a4",
      "a4pf_partial_confirmation_123",
    );

    expect(String(spy.mock.calls[0][0])).toContain(
      "/api/governance/search/model/for-session/review_session_a4/partial-confirmation",
    );
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      partial_fallback_id: "a4pf_partial_confirmation_123",
    });
  });

  it("creates one A4 Issue through the session route with only opaque proof and editable draft", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ issue: { id: "iss_a4", source_type: "a4_search" }, replayed: false }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const proof = `a4p.a4_test_kid.proof_id_with_under_score_0001.${"a".repeat(64)}`;

    await governanceClient.createA4IssueForSession("review_session_a4", {
      evidence_proof: proof,
      title: "A4 selected door needs review",
      description: "Editable draft only.",
      severity: "high",
      assignee: "ops-a4",
    });

    expect(String(spy.mock.calls[0][0])).toContain(
      "/api/governance/issues/from-a4-search/for-session/review_session_a4",
    );
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      evidence_proof: proof,
      title: "A4 selected door needs review",
      description: "Editable draft only.",
      severity: "high",
      assignee: "ops-a4",
    });
  });

  it("preserves only allowlisted A4 error code and never echoes upstream detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        error_code: "a4_authentication_required",
        detail: "C:/internal/model.ifc http://internal.example/token",
      }), { status: 401, headers: { "Content-Type": "application/json" } }),
    );

    try {
      await governanceClient.searchModelForSession("review_session_a4", { query: "IfcDoor" });
      throw new Error("expected A4 request to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(A4GovernanceError);
      const safe = error as A4GovernanceError;
      expect(safe.status).toBe(401);
      expect(safe.code).toBe("a4_authentication_required");
      expect(safe.message).not.toContain("internal");
      expect(safe.message).not.toContain("model.ifc");
    }
  });

  it("preserves an allowlisted nested FastAPI error code without leaking nested detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        detail: {
          code: "a4_authentic_lease_unavailable",
          message: "C:/internal/model.ifc http://internal.example/token",
        },
      }), { status: 503, headers: { "Content-Type": "application/json" } }),
    );

    await expect(
      governanceClient.searchModelForSession("review_session_a4", { query: "IfcDoor" }),
    ).rejects.toMatchObject({
      status: 503,
      code: "a4_authentic_lease_unavailable",
    });
    try {
      await governanceClient.searchModelForSession("review_session_a4", { query: "IfcDoor" });
    } catch (error) {
      expect((error as Error).message).not.toContain("internal");
      expect((error as Error).message).not.toContain("model.ifc");
    }
  });
});
