import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

const RESERVED_PORTS = new Set([
  8004,
  49102,
  49101,
  8010,
  5173,
  5174,
  49100,
  ...Array.from({ length: 41 }, (_, index) => 49110 + index),
]);

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

export function createForbiddenRequestGuard() {
  const violations: string[] = [];
  return {
    observe(rawUrl: string) {
      const url = new URL(rawUrl);
      if (RESERVED_PORTS.has(Number(url.port))) violations.push(rawUrl);
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
  return guard;
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

  if (!Number.isSafeInteger(manifest.offset) || manifest.offset < 0 || manifest.offset > 4) {
    throw new Error("manifest offset must be an integer from 0 through 4");
  }
  for (const port of Object.values(manifest.ports)) {
    if (RESERVED_PORTS.has(port)) throw new Error(`manifest resolves to reserved port ${port}`);
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
  if (externalViewer && !["0", "1"].includes(env.E2E_VIEWER_HARNESS_BUILD ?? "")) {
    throw new Error("E2E_VIEWER_HARNESS_BUILD=0|1 is required for an external viewer");
  }
  return {
    manifestPath,
    runDir: path.dirname(manifestPath),
    coordinatorBaseUrl,
    governanceBaseUrl: expectedBaseUrls.governance,
    viewerPort,
    viewerOrigin,
    harnessBuildFlag: externalViewer ? env.E2E_VIEWER_HARNESS_BUILD === "1" : false,
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

export async function writeIsolatedEvidenceManifest(
  config: IsolatedStackConfig,
  observation: BrowserEvidenceObservation,
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
  const lockPath = path.join(config.runDir, "evidence-manifest.lock");
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
    const observations = [...(existing.observations ?? []).filter((item: { test_id: string }) => item.test_id !== normalized.test_id), normalized]
      .sort((left, right) => left.test_id.localeCompare(right.test_id));
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
        cpu_browser_operability: "observed",
        design: "not_claimed",
        deploy: "not_claimed",
        kit_webrtc: "not_claimed",
      },
    };
    temporary = `${output}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
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
