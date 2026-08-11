export interface GovernanceLibraryVersionReference {
  projectId: string;
  modelId: string;
  versionName: string;
}

export interface GovernanceLibraryTree {
  projects?: Array<{
    project_id?: unknown;
    models?: Array<{
      model_id?: unknown;
      versions?: Array<{ name?: unknown; path?: unknown }>;
    }>;
  }>;
}

export interface GovernanceLibraryRuleRunBody {
  ifc_source_path: string;
  ids_path?: string;
  model_version_id?: string;
}

export interface GovernanceLibraryDiffBody {
  base_ifc_path: string;
  target_ifc_path: string;
  include_geometry?: boolean;
  base_model_version_id?: string;
  target_model_version_id?: string;
}

export interface OpaqueGovernanceReply {
  status: number;
  contentType: string;
  bodyText: string;
}

export interface GovernanceLibraryPort {
  loadTree(): Promise<GovernanceLibraryTree>;
  postRuleRun(body: GovernanceLibraryRuleRunBody): Promise<OpaqueGovernanceReply>;
  postDiff(body: GovernanceLibraryDiffBody): Promise<OpaqueGovernanceReply>;
}

export interface GovernanceLibraryRuleRunCommand {
  version: GovernanceLibraryVersionReference;
  idsPath?: unknown;
  modelVersionId?: string;
}

export interface GovernanceLibraryDiffCommand {
  base: GovernanceLibraryVersionReference;
  target: GovernanceLibraryVersionReference;
  includeGeometry?: boolean;
  baseModelVersionId?: string;
  targetModelVersionId?: string;
}

export interface ForwardedGovernanceLibraryOutcome extends OpaqueGovernanceReply {
  kind: "forwarded";
}

export interface InvalidIdsGovernanceLibraryOutcome {
  kind: "invalid_ids";
  detail: string;
}

export interface VersionNotFoundGovernanceLibraryOutcome {
  kind: "version_not_found";
}

export interface UnavailableGovernanceLibraryOutcome {
  kind: "unavailable";
}

export type GovernanceLibraryOutcome =
  | ForwardedGovernanceLibraryOutcome
  | InvalidIdsGovernanceLibraryOutcome
  | VersionNotFoundGovernanceLibraryOutcome
  | UnavailableGovernanceLibraryOutcome;

const idsBasenamePattern = /^[A-Za-z0-9_.-]+\.ids$/;
const invalidIdsDetail = "ids_path must be a rule basename under rules/.";

function normalizeIdsPath(
  value: unknown,
): { ok: true; value?: string } | { ok: false; detail: string } {
  if (value === undefined || value === "") return { ok: true };
  if (typeof value !== "string") {
    return { ok: false, detail: invalidIdsDetail };
  }
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) return { ok: true };
  if (raw.includes(":") || raw.startsWith("/") || raw.includes("..")) {
    return { ok: false, detail: invalidIdsDetail };
  }
  const parts = raw.split("/").filter(Boolean);
  const basename =
    parts.length === 1
      ? parts[0]
      : parts.length === 2 && parts[0] === "rules"
        ? parts[1]
        : "";
  if (!idsBasenamePattern.test(basename)) {
    return { ok: false, detail: invalidIdsDetail };
  }
  return { ok: true, value: "rules/" + basename };
}

function findVersionPath(
  tree: GovernanceLibraryTree,
  ref: GovernanceLibraryVersionReference,
): string | null {
  const projects = Array.isArray(tree.projects) ? tree.projects : [];
  const project = projects.find((candidate) => candidate && candidate.project_id === ref.projectId);
  const models = Array.isArray(project?.models) ? project.models : [];
  const model = models.find((candidate) => candidate && candidate.model_id === ref.modelId);
  const versions = Array.isArray(model?.versions) ? model.versions : [];
  const version = versions.find((candidate) => candidate && candidate.name === ref.versionName);
  return typeof version?.path === "string" && version.path.length > 0 ? version.path : null;
}

function redactServerPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:(?:\\\\|\\|\/)[^"'\r\n<>]*/g, "[server-path]")
    .replace(/\/(?:workspace|storage|data|mnt|home|tmp|var|Users)\/[^"'\s<>]*/g, "[server-path]");
}

export class GovernanceLibraryWorkflow {
  constructor(private readonly port: GovernanceLibraryPort) {}

  async runLibraryRuleRun(
    command: GovernanceLibraryRuleRunCommand,
  ): Promise<GovernanceLibraryOutcome> {
    const ids = normalizeIdsPath(command.idsPath);
    if (!ids.ok) {
      return { kind: "invalid_ids", detail: ids.detail };
    }

    let ifcSourcePath: string | null;
    try {
      ifcSourcePath = findVersionPath(await this.port.loadTree(), command.version);
    } catch {
      return { kind: "unavailable" };
    }
    if (!ifcSourcePath) {
      return { kind: "version_not_found" };
    }

    const body: GovernanceLibraryRuleRunBody = { ifc_source_path: ifcSourcePath };
    if (ids.value) body.ids_path = ids.value;
    if (command.modelVersionId) body.model_version_id = command.modelVersionId;

    let reply: OpaqueGovernanceReply;
    try {
      reply = await this.port.postRuleRun(body);
    } catch {
      return { kind: "unavailable" };
    }
    return {
      kind: "forwarded",
      status: reply.status,
      contentType: reply.contentType,
      bodyText: redactServerPaths(reply.bodyText),
    };
  }

  async runLibraryDiff(
    command: GovernanceLibraryDiffCommand,
  ): Promise<GovernanceLibraryOutcome> {
    let baseIfcPath: string | null;
    let targetIfcPath: string | null;
    try {
      const tree = await this.port.loadTree();
      baseIfcPath = findVersionPath(tree, command.base);
      targetIfcPath = findVersionPath(tree, command.target);
    } catch {
      return { kind: "unavailable" };
    }
    if (!baseIfcPath || !targetIfcPath) {
      return { kind: "version_not_found" };
    }

    const body: GovernanceLibraryDiffBody = {
      base_ifc_path: baseIfcPath,
      target_ifc_path: targetIfcPath,
    };
    if (typeof command.includeGeometry === "boolean") {
      body.include_geometry = command.includeGeometry;
    }
    if (command.baseModelVersionId) {
      body.base_model_version_id = command.baseModelVersionId;
    }
    if (command.targetModelVersionId) {
      body.target_model_version_id = command.targetModelVersionId;
    }

    let reply: OpaqueGovernanceReply;
    try {
      reply = await this.port.postDiff(body);
    } catch {
      return { kind: "unavailable" };
    }
    return {
      kind: "forwarded",
      status: reply.status,
      contentType: reply.contentType,
      bodyText: redactServerPaths(reply.bodyText),
    };
  }
}
