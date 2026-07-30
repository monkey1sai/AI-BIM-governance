import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

const MANIFEST_RESERVED_PORTS = new Set([
  8004,
  49102,
  49101,
  8010,
  5173,
  5174,
  49100,
  ...Array.from({ length: 41 }, (_, index) => 49110 + index),
]);
const BROWSER_FORBIDDEN_PORTS = new Set([
  ...MANIFEST_RESERVED_PORTS,
  ...Array.from({ length: 5 }, (_, index) => 49103 + index),
]);

export const A4_REQUIRED_OBSERVATION_IDS = [
  "a4-real-loading-1440x900",
  "a4-real-failure-retry-1440x900",
  "a4-real-success-1440x900",
  "a4-real-loading-1920x1080",
  "a4-real-failure-retry-1920x1080",
  "a4-real-success-1920x1080",
] as const;

export type IsolatedStackManifest = {
  schema_version: "isolated-branch-stack/v1";
  stack_kind: "isolated_branch_stack";
  change_id: string;
  run_id: string;
  worktree_root: string;
  head_sha: string;
  started_at: string;
  offset: number;
  ports: { coordinator: number; governance: number; viewer: number };
  base_urls: { coordinator: string; governance: string; viewer: string };
  backend_ready: { governance: boolean; coordinator: boolean };
  lifecycle_owners: { governance: string; coordinator: string; viewer: string };
  viewer: { expected_port: number; owner: string; managed_by_launcher: boolean };
  read_only_fixture_root: string;
  mutable_state: {
    root: string;
    governance_db: string;
    governance_federation_out: string;
    coordinator_root: string;
  };
  processes: IsolatedBackendProcessRecord[];
};

export type IsolatedBackendProcessRecord = {
  role: "governance" | "coordinator";
  pid: number;
  entrypoint: string;
  command_line: string;
  creation_identity: string;
  executable_path?: string | null;
};

export type IsolatedBackendProcessSnapshot = {
  process: {
    pid: number;
    command_line: string;
    creation_identity: string;
    executable_path?: string | null;
  };
  listener_pid: number;
  listener_lineage: Array<{
    pid: number;
    parent_pid: number;
    creation_identity: string;
  }>;
};

export type IsolatedStackConfig = {
  manifestPath: string;
  runDir: string;
  coordinatorBaseUrl: string;
  governanceBaseUrl: string;
  viewerPort: number;
  viewerOrigin: string;
  harnessBuildFlag: boolean;
  manifest: IsolatedStackManifest;
};

export function parseStandaloneViewerPort(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`invalid standalone viewer port: ${raw}`);
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid standalone viewer port: ${raw}`);
  }
  return port;
}

export function requireReal(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[require-real] ${message}`);
}

export function parseObservedNetworkUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return ["http:", "https:", "ws:", "wss:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function createForbiddenRequestGuard() {
  const violations: string[] = [];
  return {
    observe(rawUrl: string) {
      const url = parseObservedNetworkUrl(rawUrl);
      if (!url) return;
      if (BROWSER_FORBIDDEN_PORTS.has(Number(url.port))) violations.push(rawUrl);
    },
    assertClean() {
      if (violations.length) throw new Error(`browser requested reserved ports: ${violations.join(", ")}`);
    },
    violations,
  };
}

export function watchForbiddenRequests(page: Page) {
  const guard = createForbiddenRequestGuard();
  page.on("request", request => guard.observe(request.url()));
  page.on("websocket", websocket => guard.observe(websocket.url()));
  return guard;
}

function manifestProcessForRole(
  manifest: IsolatedStackManifest,
  role: IsolatedBackendProcessRecord["role"],
): IsolatedBackendProcessRecord {
  const matches = Array.isArray(manifest.processes)
    ? manifest.processes.filter(processRecord => processRecord?.role === role)
    : [];
  if (matches.length !== 1) throw new Error(`manifest must contain exactly one ${role} process identity`);
  const processRecord = matches[0];
  if (
    !Number.isSafeInteger(processRecord.pid) || processRecord.pid <= 0 ||
    typeof processRecord.entrypoint !== "string" || !processRecord.entrypoint ||
    typeof processRecord.command_line !== "string" || !processRecord.command_line ||
    typeof processRecord.creation_identity !== "string" || !processRecord.creation_identity
  ) {
    throw new Error(`manifest ${role} process identity is incomplete`);
  }
  return processRecord;
}

export function assertIsolatedBackendProcessSnapshot(
  manifest: IsolatedStackManifest,
  role: IsolatedBackendProcessRecord["role"],
  snapshot: IsolatedBackendProcessSnapshot,
): void {
  const expected = manifestProcessForRole(manifest, role);
  if (
    snapshot.process.pid !== expected.pid ||
    snapshot.process.command_line !== expected.command_line ||
    snapshot.process.creation_identity !== expected.creation_identity ||
    (expected.executable_path != null && snapshot.process.executable_path !== expected.executable_path)
  ) {
    throw new Error(`${role} process identity does not match the manifest`);
  }
  if (!Number.isSafeInteger(snapshot.listener_pid) || !Array.isArray(snapshot.listener_lineage)) {
    throw new Error(`${role} listener process is not owned by the manifest backend lineage`);
  }
  const lineage = snapshot.listener_lineage;
  if (lineage.length === 0 || lineage[0]?.pid !== snapshot.listener_pid) {
    throw new Error(`${role} listener process is not owned by the manifest backend lineage`);
  }
  const seen = new Set<number>();
  for (let index = 0; index < lineage.length; index += 1) {
    const node = lineage[index];
    const createdAt = Date.parse(node.creation_identity);
    if (
      !Number.isSafeInteger(node.pid) || node.pid <= 0 || seen.has(node.pid) ||
      !Number.isSafeInteger(node.parent_pid) || !Number.isFinite(createdAt)
    ) {
      throw new Error(`${role} listener process lineage identity is invalid`);
    }
    seen.add(node.pid);
    const parent = lineage[index + 1];
    if (parent) {
      const parentCreatedAt = Date.parse(parent.creation_identity);
      if (node.parent_pid !== parent.pid || !Number.isFinite(parentCreatedAt) || parentCreatedAt > createdAt) {
        throw new Error(`${role} listener process lineage contains a reused or impossible parent identity`);
      }
    }
  }
  const root = lineage.find(node => node.pid === expected.pid);
  if (!root || root.creation_identity !== expected.creation_identity) {
    throw new Error(`${role} listener process is not owned by the manifest backend lineage`);
  }
}

export function classifyHarnessUse(flags: { buildFlag: boolean; queryFlag: boolean }) {
  return { ...flags, realControlPlaneEligible: !(flags.buildFlag && flags.queryFlag) };
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  const root = path.parse(resolved).root;
  const trimmed = resolved.length > root.length ? resolved.replace(/[\\/]+$/, "") : resolved;
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

export function loadIsolatedStackConfig(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  headSha?: string;
} = {}): IsolatedStackConfig | null {
  const env = options.env ?? process.env;
  if (env.E2E_REQUIRE_REAL !== "1") return null;
  if (!env.E2E_STACK_MANIFEST) throw new Error("E2E_STACK_MANIFEST is required in require-real mode");

  const worktreeRoot = realpathSync(
    options.cwd ?? execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
  );
  const manifestPath = realpathSync(path.resolve(env.E2E_STACK_MANIFEST));
  const artifactRoot = path.join(worktreeRoot, "artifacts", "e2e");
  const containmentRelative = path.relative(comparablePath(artifactRoot), comparablePath(manifestPath));
  if (
    containmentRelative === "" ||
    containmentRelative === ".." ||
    containmentRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containmentRelative)
  ) {
    throw new Error("E2E_STACK_MANIFEST must stay inside this worktree artifacts/e2e");
  }

  const relative = path.relative(artifactRoot, manifestPath).split(path.sep);
  if (relative.length !== 3 || relative[2] !== "stack-manifest.json") {
    throw new Error("E2E_STACK_MANIFEST path must be <change-id>/<run-id>/stack-manifest.json");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as IsolatedStackManifest;
  const headSha = options.headSha ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot, encoding: "utf8" }).trim();
  if (manifest.change_id !== relative[0] || manifest.run_id !== relative[1]) {
    throw new Error("manifest path/content identity mismatch");
  }
  if (comparablePath(realpathSync(manifest.worktree_root)) !== comparablePath(worktreeRoot)) {
    throw new Error("manifest worktree identity mismatch");
  }
  if (manifest.head_sha !== headSha) throw new Error("manifest head identity mismatch");
  if (manifest.schema_version !== "isolated-branch-stack/v1" || manifest.stack_kind !== "isolated_branch_stack") {
    throw new Error("unsupported isolated stack manifest");
  }
  if (manifest.backend_ready.governance !== true || manifest.backend_ready.coordinator !== true) {
    throw new Error("isolated backends are not ready");
  }
  if (
    manifest.lifecycle_owners.governance !== "repo_launcher" ||
    manifest.lifecycle_owners.coordinator !== "repo_launcher" ||
    manifest.lifecycle_owners.viewer !== "playwright_webserver"
  ) {
    throw new Error("unexpected lifecycle ownership");
  }
  manifestProcessForRole(manifest, "governance");
  manifestProcessForRole(manifest, "coordinator");

  if (!Number.isSafeInteger(manifest.offset) || manifest.offset < 0 || manifest.offset > 4) {
    throw new Error("manifest offset must be an integer from 0 through 4");
  }
  for (const port of Object.values(manifest.ports)) {
    if (MANIFEST_RESERVED_PORTS.has(port)) throw new Error(`manifest resolves to reserved port ${port}`);
  }
  const expectedPorts = {
    coordinator: 8005 + manifest.offset,
    governance: 49103 + manifest.offset,
    viewer: 5180 + manifest.offset,
  };
  if (
    manifest.ports.coordinator !== expectedPorts.coordinator ||
    manifest.ports.governance !== expectedPorts.governance ||
    manifest.ports.viewer !== expectedPorts.viewer
  ) {
    throw new Error("manifest ports violate fixed base+offset port mapping");
  }
  const expectedBaseUrls = {
    coordinator: `http://127.0.0.1:${manifest.ports.coordinator}`,
    governance: `http://127.0.0.1:${manifest.ports.governance}`,
    viewer: `http://127.0.0.1:${manifest.ports.viewer}`,
  };
  if (
    manifest.base_urls.coordinator !== expectedBaseUrls.coordinator ||
    manifest.base_urls.governance !== expectedBaseUrls.governance ||
    manifest.base_urls.viewer !== expectedBaseUrls.viewer
  ) {
    throw new Error("manifest base URL does not match resolved ports");
  }
  if (
    manifest.viewer.expected_port !== manifest.ports.viewer ||
    manifest.viewer.owner !== "playwright_webserver" ||
    manifest.viewer.managed_by_launcher !== false
  ) {
    throw new Error("unexpected viewer authority");
  }

  const coordinatorBaseUrl = expectedBaseUrls.coordinator;
  const viewerPort = manifest.ports.viewer;
  const viewerOrigin = `http://127.0.0.1:${viewerPort}`;
  if (env.E2E_COORDINATOR_BASE_URL && env.E2E_COORDINATOR_BASE_URL !== coordinatorBaseUrl) {
    throw new Error("coordinator env/manifest mismatch");
  }
  if (env.E2E_VIEWER_PORT && env.E2E_VIEWER_PORT !== String(viewerPort)) {
    throw new Error("viewer env/manifest mismatch");
  }
  if (env.E2E_VIEWER_BASE_URL && new URL(env.E2E_VIEWER_BASE_URL).origin !== viewerOrigin) {
    throw new Error("viewer base env/manifest mismatch");
  }
  const externalViewer = env.E2E_DISABLE_WEBSERVER === "1";
  if (externalViewer) {
    throw new Error("E2E_DISABLE_WEBSERVER=1 is not permitted for require-real evidence without a verifiable build identity");
  }
  return {
    manifestPath,
    runDir: path.dirname(manifestPath),
    coordinatorBaseUrl,
    governanceBaseUrl: expectedBaseUrls.governance,
    viewerPort,
    viewerOrigin,
    harnessBuildFlag: false,
    manifest,
  };
}

export function requireIsolatedStackConfig(): IsolatedStackConfig {
  const config = loadIsolatedStackConfig();
  if (!config) throw new Error("E2E_REQUIRE_REAL=1 is required by this spec");
  return config;
}

export type HarnessDisclosure = {
  buildFlag: boolean;
  queryFlag: boolean;
  realControlPlaneEligible: boolean;
};

export type BrowserEvidenceObservation = {
  testId: string;
  route: string;
  mainButtons: string[];
  fixture: string;
  backendApi: string;
  observedRuntimeIds: Record<string, string>;
  visibleStates: string[];
  screenshotPaths: string[];
  tracePath: string | null;
  harness: HarnessDisclosure;
};

export type IsolatedEvidencePublicationVerifier = {
  assertWorktreeStatusClean(config: IsolatedStackConfig): void;
  assertLiveBackendOwnership(config: IsolatedStackConfig): Promise<void>;
  assertManifestHead(config: IsolatedStackConfig): void;
};

export type IsolatedGitCommandRunner = (args: string[]) => string;

function defaultIsolatedGitCommandRunner(config: IsolatedStackConfig): IsolatedGitCommandRunner {
  return args => execFileSync("git", args, {
    cwd: config.manifest.worktree_root,
    encoding: "utf8",
    windowsHide: true,
  });
}

export function assertIsolatedWorktreeStatusClean(
  config: IsolatedStackConfig,
  runGit: IsolatedGitCommandRunner = defaultIsolatedGitCommandRunner(config),
): void {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.trim()) throw new Error("isolated evidence requires an unchanged worktree");
}

export function assertIsolatedManifestHead(
  config: IsolatedStackConfig,
  runGit: IsolatedGitCommandRunner = defaultIsolatedGitCommandRunner(config),
): void {
  const head = runGit(["rev-parse", "HEAD"]).trim();
  if (head !== config.manifest.head_sha) throw new Error("isolated evidence requires a manifest-matching HEAD");
}

export function assertIsolatedWorktreeClean(
  config: IsolatedStackConfig,
  runGit: IsolatedGitCommandRunner = defaultIsolatedGitCommandRunner(config),
): void {
  assertIsolatedWorktreeStatusClean(config, runGit);
  assertIsolatedManifestHead(config, runGit);
}

export async function assertLiveIsolatedBackendOwnership(config: IsolatedStackConfig): Promise<void> {
  const { assertLiveIsolatedBackendOwnership: assertLive } = await import("./isolated-stack-global-setup");
  assertLive(config);
}

export const defaultIsolatedEvidencePublicationVerifier: IsolatedEvidencePublicationVerifier = {
  assertWorktreeStatusClean: assertIsolatedWorktreeStatusClean,
  assertLiveBackendOwnership: assertLiveIsolatedBackendOwnership,
  assertManifestHead: assertIsolatedManifestHead,
};

function relativeRunArtifact(runDir: string, candidate: string): string {
  const absolute = path.resolve(candidate);
  if (!existsSync(absolute)) throw new Error(`evidence artifact does not exist: ${candidate}`);
  const physicalRunDir = realpathSync(runDir);
  const physicalArtifact = realpathSync(absolute);
  if (!statSync(physicalArtifact).isFile()) throw new Error(`evidence artifact must be a file: ${candidate}`);
  const relative = path.relative(comparablePath(physicalRunDir), comparablePath(physicalArtifact));
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`artifact path must stay inside current run: ${candidate}`);
  }
  return path.relative(physicalRunDir, physicalArtifact).split(path.sep).join("/");
}

type StoredEvidenceObservation = {
  test_id: string;
  artifacts: { screenshots: string[]; trace: string | null };
  [key: string]: unknown;
};

function storedRunArtifactExists(runDir: string, candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || path.isAbsolute(candidate)) {
    throw new Error("stored evidence artifact reference is malformed");
  }
  const logicalRunDir = path.resolve(runDir);
  const absolute = path.resolve(logicalRunDir, candidate);
  const logicalRelative = path.relative(logicalRunDir, absolute);
  if (
    logicalRelative === "" ||
    logicalRelative === ".." ||
    logicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(logicalRelative)
  ) {
    throw new Error(`stored artifact path must stay inside current run: ${candidate}`);
  }
  if (!existsSync(absolute)) return false;

  const physicalRunDir = realpathSync(logicalRunDir);
  const physicalArtifact = realpathSync(absolute);
  const physicalRelative = path.relative(comparablePath(physicalRunDir), comparablePath(physicalArtifact));
  if (
    physicalRelative === ".." ||
    physicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(physicalRelative)
  ) {
    throw new Error(`stored artifact path must stay inside current run: ${candidate}`);
  }
  if (!statSync(physicalArtifact).isFile()) {
    throw new Error(`stored evidence artifact must be a file: ${candidate}`);
  }
  return true;
}

function existingObservationArtifactsExist(runDir: string, candidate: unknown): candidate is StoredEvidenceObservation {
  if (!candidate || typeof candidate !== "object") throw new Error("stored evidence observation is malformed");
  const observation = candidate as Partial<StoredEvidenceObservation>;
  if (typeof observation.test_id !== "string" || !observation.artifacts || typeof observation.artifacts !== "object") {
    throw new Error("stored evidence observation is malformed");
  }
  const { screenshots, trace } = observation.artifacts;
  if (!Array.isArray(screenshots) || screenshots.some(item => typeof item !== "string") || (trace !== null && typeof trace !== "string")) {
    throw new Error("stored evidence artifact reference is malformed");
  }
  return [...screenshots, ...(trace ? [trace] : [])].every(item => storedRunArtifactExists(runDir, item));
}

export async function writeIsolatedEvidenceManifest(
  config: IsolatedStackConfig,
  observation: BrowserEvidenceObservation,
  verifier: IsolatedEvidencePublicationVerifier = defaultIsolatedEvidencePublicationVerifier,
): Promise<string> {
  const output = path.join(config.runDir, "evidence-manifest.json");
  if (observation.harness.buildFlag !== config.harnessBuildFlag) {
    throw new Error("evidence harness build flag mismatch");
  }
  const harness = classifyHarnessUse({
    buildFlag: config.harnessBuildFlag,
    queryFlag: observation.harness.queryFlag,
  });
  if (observation.harness.realControlPlaneEligible !== harness.realControlPlaneEligible) {
    throw new Error("evidence harness eligibility mismatch");
  }
  const identity = {
    schema_version: "isolated-branch-browser-evidence/v1",
    stack_kind: config.manifest.stack_kind,
    change_id: config.manifest.change_id,
    run_id: config.manifest.run_id,
    head_sha: config.manifest.head_sha,
  };
  const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
  let lockDescriptor: number | undefined;
  let temporary: string | undefined;
  try {
    try {
      lockDescriptor = openSync(lockPath, "wx");
    } catch (error) {
      if (existsSync(lockPath)) throw new Error(`evidence writer lock exists: ${lockPath}`);
      throw error;
    }
    const existing = existsSync(output)
      ? JSON.parse(readFileSync(output, "utf8"))
      : { ...identity, observations: [] };
    for (const key of ["schema_version", "stack_kind", "change_id", "run_id", "head_sha"] as const) {
      if (existing[key] !== identity[key]) throw new Error(`evidence identity mismatch: ${key}`);
    }
    const existingObservations: unknown = existing.observations;
    if (!Array.isArray(existingObservations)) throw new Error("stored evidence observations are malformed");
    const retainedObservations = existingObservations.filter(
      (item: unknown): item is StoredEvidenceObservation => existingObservationArtifactsExist(config.runDir, item),
    );
    const normalized = {
      test_id: observation.testId,
      route: observation.route,
      main_buttons: observation.mainButtons,
      fixture: observation.fixture,
      backend_api: observation.backendApi,
      observed_runtime_ids: observation.observedRuntimeIds,
      visible_states: observation.visibleStates,
      harness,
      artifacts: {
        screenshots: observation.screenshotPaths.map(candidate => relativeRunArtifact(config.runDir, candidate)),
        trace: observation.tracePath ? relativeRunArtifact(config.runDir, observation.tracePath) : null,
      },
    };
    const observations = [...retainedObservations.filter(item => item.test_id !== normalized.test_id), normalized]
      .sort((left, right) => left.test_id.localeCompare(right.test_id));
    const hasCompleteA4Observations = A4_REQUIRED_OBSERVATION_IDS.every(testId => observations.some(item => item.test_id === testId));
    const evidence = {
      ...identity,
      resolved_ports: config.manifest.ports,
      base_urls: {
        coordinator: config.coordinatorBaseUrl,
        governance: config.governanceBaseUrl,
        viewer: config.viewerOrigin,
      },
      execution_window: {
        started_at: config.manifest.started_at,
        finished_at: new Date().toISOString(),
      },
      observations,
      scope: {
        cpu_browser_operability: hasCompleteA4Observations ? "observed" : "partial",
        required_observation_ids: A4_REQUIRED_OBSERVATION_IDS,
        design: "not_claimed",
        deploy: "not_claimed",
        kit_webrtc: "not_claimed",
      },
    };
    temporary = path.join(config.runDir, `.evidence-manifest.tmp-${process.pid}-${randomUUID()}.json`);
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    verifier.assertWorktreeStatusClean(config);
    await verifier.assertLiveBackendOwnership(config);
    verifier.assertManifestHead(config);
    renameSync(temporary, output);
    return output;
  } finally {
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    if (lockDescriptor !== undefined) {
      closeSync(lockDescriptor);
      if (existsSync(lockPath)) unlinkSync(lockPath);
    }
  }
}
