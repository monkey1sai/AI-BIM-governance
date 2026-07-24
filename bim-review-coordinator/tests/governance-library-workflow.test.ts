import { describe, expect, it } from "vitest";
import {
  GovernanceLibraryWorkflow,
  type GovernanceLibraryPort,
  type GovernanceLibraryRuleRunBody,
  type GovernanceLibraryTree,
} from "../src/services/governanceLibraryWorkflow.js";

const VERSION = {
  projectId: "270",
  modelId: "機電",
  versionName: "ver 000001.ifc",
};
const IFC_PATH = "C:\\srv\\storage\\270\\機電\\ver 000001.ifc";

class RecordingGovernanceLibraryPort implements GovernanceLibraryPort {
  loadTreeCalls = 0;
  ruleRunBodies: GovernanceLibraryRuleRunBody[] = [];

  async loadTree() {
    this.loadTreeCalls += 1;
    return {
      projects: [{
        project_id: VERSION.projectId,
        models: [{
          model_id: VERSION.modelId,
          versions: [{ name: VERSION.versionName, path: IFC_PATH }],
        }],
      }],
    };
  }

  async postRuleRun(body: GovernanceLibraryRuleRunBody) {
    this.ruleRunBodies.push(body);
    return {
      status: 202,
      contentType: "text/plain; charset=utf-8",
      bodyText: JSON.stringify({
        windows: IFC_PATH,
        posix: "/workspace/models/example.ifc",
      }),
    };
  }
}

describe("GovernanceLibraryWorkflow.runLibraryRuleRun", () => {
  it("resolves the logical version and returns an opaque path-redacted upstream reply", async () => {
    const port = new RecordingGovernanceLibraryPort();
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({
      version: VERSION,
      idsPath: "sample-fire-rating.ids",
      modelVersionId: "270/機電/ver 000001.ifc",
    });

    expect(port.loadTreeCalls).toBe(1);
    expect(port.ruleRunBodies).toEqual([{
      ifc_source_path: IFC_PATH,
      ids_path: "rules/sample-fire-rating.ids",
      model_version_id: "270/機電/ver 000001.ifc",
    }]);
    expect(outcome).toEqual({
      kind: "forwarded",
      status: 202,
      contentType: "text/plain; charset=utf-8",
      bodyText: JSON.stringify({ windows: "[server-path]", posix: "[server-path]" }),
    });
  });

  it("omits optional upstream fields when the command leaves them absent", async () => {
    const port = new RecordingGovernanceLibraryPort();
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({ version: VERSION });

    expect(outcome.kind).toBe("forwarded");
    expect(port.ruleRunBodies).toEqual([{
      ifc_source_path: IFC_PATH,
    }]);
  });

  it.each([
    "../../etc/x.ids",
    "C:\\rules\\x.ids",
    "/rules/x.ids",
    "nested/x.ids",
    "rules/x.txt",
    42,
  ])("rejects unsafe IDS value %p before tree or POST I/O", async (idsPath) => {
    const port = new RecordingGovernanceLibraryPort();
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({
      version: VERSION,
      idsPath,
    });

    expect(outcome).toEqual({
      kind: "invalid_ids",
      detail: "ids_path must be a rule basename under rules/.",
    });
    expect(port.loadTreeCalls).toBe(0);
    expect(port.ruleRunBodies).toHaveLength(0);
  });

  it("returns version_not_found without POST when the exact logical version is absent", async () => {
    let postCalls = 0;
    const port: GovernanceLibraryPort = {
      async loadTree() {
        return { projects: [] };
      },
      async postRuleRun() {
        postCalls += 1;
        return {
          status: 200,
          contentType: "application/json",
          bodyText: "{}",
        };
      },
    };
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({ version: VERSION });

    expect(outcome).toEqual({ kind: "version_not_found" });
    expect(postCalls).toBe(0);
  });

  it("treats an unusual but valid JSON tree shape as version_not_found", async () => {
    const port: GovernanceLibraryPort = {
      async loadTree() {
        return { projects: {} } as unknown as GovernanceLibraryTree;
      },
      async postRuleRun() {
        throw new Error("unexpected POST");
      },
    };
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({
      version: {
        projectId: "missing-project",
        modelId: "missing-model",
        versionName: "missing.ifc",
      },
    });

    expect(outcome).toEqual({ kind: "version_not_found" });
  });

  it("maps a lookup exception to unavailable", async () => {
    const throwingTree = Object.defineProperty({}, "projects", {
      get() {
        throw new Error("lookup failed");
      },
    }) as GovernanceLibraryTree;
    const port: GovernanceLibraryPort = {
      async loadTree() {
        return throwingTree;
      },
      async postRuleRun() {
        throw new Error("unexpected POST");
      },
    };
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({ version: VERSION });

    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("maps a tree transport failure to unavailable", async () => {
    const port: GovernanceLibraryPort = {
      async loadTree() {
        throw new Error("tree unavailable");
      },
      async postRuleRun() {
        throw new Error("unexpected POST");
      },
    };
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({ version: VERSION });

    expect(outcome).toEqual({ kind: "unavailable" });
  });

  it("maps a POST transport failure to unavailable without retry", async () => {
    let postCalls = 0;
    const port: GovernanceLibraryPort = {
      async loadTree() {
        return {
          projects: [{
            project_id: VERSION.projectId,
            models: [{
              model_id: VERSION.modelId,
              versions: [{ name: VERSION.versionName, path: IFC_PATH }],
            }],
          }],
        };
      },
      async postRuleRun() {
        postCalls += 1;
        throw new Error("POST unavailable");
      },
    };
    const workflow = new GovernanceLibraryWorkflow(port);

    const outcome = await workflow.runLibraryRuleRun({ version: VERSION });

    expect(outcome).toEqual({ kind: "unavailable" });
    expect(postCalls).toBe(1);
  });
});
