import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIsolatedStackConfig, parseStandaloneViewerPort } from "./isolated-stack";

const roots: string[] = [];

function fixture() {
  const worktreeRoot = mkdtempSync(path.join(tmpdir(), "isolated-stack-"));
  roots.push(worktreeRoot);
  const changeId = "isolated-branch-stack-browser-e2e";
  const runId = "unit-r1";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const runDir = path.join(worktreeRoot, "artifacts", "e2e", changeId, runId);
  const manifestPath = path.join(runDir, "stack-manifest.json");
  mkdirSync(runDir, { recursive: true });
  const manifest = {
    schema_version: "isolated-branch-stack/v1",
    stack_kind: "isolated_branch_stack",
    change_id: changeId,
    run_id: runId,
    worktree_root: worktreeRoot,
    head_sha: headSha,
    started_at: "2026-07-30T00:00:00.000Z",
    offset: 0,
    ports: { coordinator: 8005, governance: 49103, viewer: 5180 },
    base_urls: {
      coordinator: "http://127.0.0.1:8005",
      governance: "http://127.0.0.1:49103",
      viewer: "http://127.0.0.1:5180",
    },
    backend_ready: { governance: true, coordinator: true },
    lifecycle_owners: {
      governance: "repo_launcher",
      coordinator: "repo_launcher",
      viewer: "playwright_webserver",
    },
    viewer: { expected_port: 5180, owner: "playwright_webserver", managed_by_launcher: false },
    processes: {},
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { worktreeRoot, manifestPath, manifest, headSha };
}

function alternateWindowsDriveCasing(value: string): string {
  return value.replace(/^[A-Za-z]:/, drive => drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase());
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadIsolatedStackConfig", () => {
  it("requires the manifest before Playwright starts", () => {
    expect(() => loadIsolatedStackConfig({ env: { E2E_REQUIRE_REAL: "1" } })).toThrow(/E2E_STACK_MANIFEST is required/);
  });

  it("accepts only the exact worktree/path/content/head identity", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    });
    expect(config).not.toBeNull();
    expect(config?.coordinatorBaseUrl).toBe("http://127.0.0.1:8005");
    expect(config?.viewerPort).toBe(5180);
  });

  it("accepts alternate Windows drive casing for the same worktree and manifest", () => {
    if (process.platform !== "win32") return;
    const value = fixture();
    const alternateRoot = alternateWindowsDriveCasing(value.worktreeRoot);
    const alternateManifestPath = alternateWindowsDriveCasing(value.manifestPath);
    writeFileSync(value.manifestPath, JSON.stringify({ ...value.manifest, worktree_root: alternateRoot }));
    expect(() => loadIsolatedStackConfig({
      cwd: alternateRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: alternateManifestPath },
    })).not.toThrow();
  });

  it.each([
    ["path/content identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, run_id: "unit-r2" }), /path\/content identity/],
    ["change identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, change_id: "other-change" }), /path\/content identity/],
    ["worktree identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, worktree_root: path.dirname(value.worktreeRoot) }), /worktree identity/],
    ["head identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, head_sha: "f".repeat(40) }), /head identity/],
    ["offset domain", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, offset: 5 }), /offset must be an integer from 0 through 4/],
    ["base plus offset port mapping", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, offset: 1 }), /base\+offset port mapping/],
    ["reserved port", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, ports: { ...value.manifest.ports, coordinator: 8004 } }), /reserved port 8004/],
    ["reserved viewer", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, ports: { ...value.manifest.ports, viewer: 5173 }, base_urls: { ...value.manifest.base_urls, viewer: "http://127.0.0.1:5173" } }), /reserved port 5173/],
    ["backend readiness", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, backend_ready: { governance: true, coordinator: false } }), /backends are not ready/],
    ["backend readiness string", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, backend_ready: { governance: "false", coordinator: true } }), /backends are not ready/],
    ["lifecycle ownership", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, lifecycle_owners: { ...value.manifest.lifecycle_owners, viewer: "launcher" } }), /lifecycle ownership/],
    ["viewer authority", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, viewer: { ...value.manifest.viewer, managed_by_launcher: true } }), /viewer authority/],
    ["base URL mismatch", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, base_urls: { ...value.manifest.base_urls, coordinator: "http://127.0.0.1:8006" } }), /base URL.*ports/],
  ])("rejects %s", (_label, mutate, expected) => {
    const value = fixture();
    writeFileSync(value.manifestPath, JSON.stringify(mutate(value)));
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })).toThrow(expected);
  });

  it("rejects a manifest outside this worktree artifacts/e2e", () => {
    const value = fixture();
    const outside = path.join(value.worktreeRoot, "outside.json");
    writeFileSync(outside, JSON.stringify(value.manifest));
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: outside },
    })).toThrow(/inside this worktree artifacts\/e2e/);
  });

  it.each([
    [{ E2E_COORDINATOR_BASE_URL: "http://127.0.0.1:8006" }, /coordinator env\/manifest mismatch/],
    [{ E2E_VIEWER_PORT: "5181" }, /viewer env\/manifest mismatch/],
    [{ E2E_VIEWER_BASE_URL: "http://127.0.0.1:5181" }, /viewer base env\/manifest mismatch/],
  ])("rejects compatibility env that points to another valid offset", (extra, expected) => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath, ...extra },
    })).toThrow(expected);
  });

  it.each(["0", "65536", "abc", "5180.5"])("rejects invalid standalone viewer port %s", raw => {
    expect(() => parseStandaloneViewerPort(raw)).toThrow(/standalone viewer port/);
  });

  it("requires external-viewer harness disclosure", () => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath, E2E_DISABLE_WEBSERVER: "1" },
    })).toThrow(/E2E_VIEWER_HARNESS_BUILD=0\|1/);
  });
});
