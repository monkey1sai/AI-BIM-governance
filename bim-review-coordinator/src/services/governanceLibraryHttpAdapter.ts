import type {
  GovernanceLibraryPort,
  GovernanceLibraryRuleRunBody,
  GovernanceLibraryTree,
  OpaqueGovernanceReply,
} from "./governanceLibraryWorkflow.js";

const defaultGovernanceApiBase = "http://127.0.0.1:49102";

function resolveGovernanceApiBase(): string {
  return (process.env.GOVERNANCE_API_BASE ?? defaultGovernanceApiBase).replace(/\/+$/, "");
}

export class GovernanceLibraryHttpAdapter implements GovernanceLibraryPort {
  async loadTree(): Promise<GovernanceLibraryTree> {
    const response = await fetch(resolveGovernanceApiBase() + "/api/files/tree", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error("governance files/tree HTTP " + response.status);
    }
    return (await response.json()) as GovernanceLibraryTree;
  }

  async postRuleRun(body: GovernanceLibraryRuleRunBody): Promise<OpaqueGovernanceReply> {
    const response = await fetch(resolveGovernanceApiBase() + "/api/rule-runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      bodyText: await response.text(),
    };
  }
}
