import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

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
