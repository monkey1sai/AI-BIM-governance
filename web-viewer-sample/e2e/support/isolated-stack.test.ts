import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureWindowsBackendSnapshot } from "./isolated-stack-global-setup";
import {
  assertIsolatedBackendProcessSnapshot,
  classifyHarnessUse,
  createForbiddenRequestGuard,
  loadIsolatedStackConfig,
  parseObservedNetworkUrl,
  parseStandaloneViewerPort,
  requireReal,
  writeIsolatedEvidenceManifest,
  type BrowserEvidenceObservation,
  type IsolatedEvidencePublicationVerifier,
  type IsolatedStackConfig,
} from "./isolated-stack";

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
    started_at: "2026-07-01T00:00:00.000Z",
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
    read_only_fixture_root: path.join(worktreeRoot, "storage"),
    mutable_state: {
      root: path.join(runDir, "state"),
      governance_db: path.join(runDir, "state", "governance", "governance.db"),
      governance_federation_out: path.join(runDir, "state", "governance", "federated"),
      coordinator_root: path.join(runDir, "state", "coordinator"),
    },
    processes: [
      {
        role: "governance",
        pid: 4101,
        entrypoint: "app:app",
        command_line: "python -m uvicorn app:app --port 49103",
        creation_identity: "2026-07-30T01:00:00.000Z",
        executable_path: "C:\\Python312\\python.exe",
      },
      {
        role: "coordinator",
        pid: 4102,
        entrypoint: path.join(worktreeRoot, "bim-review-coordinator", "src", "index.ts"),
        command_line: `node tsx ${path.join(worktreeRoot, "bim-review-coordinator", "src", "index.ts")}`,
        creation_identity: "2026-07-30T01:00:01.000Z",
        executable_path: "C:\\Program Files\\nodejs\\node.exe",
      },
    ],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { worktreeRoot, manifestPath, manifest, headSha };
}

function alternateWindowsDriveCasing(value: string): string {
  return value.replace(/^[A-Za-z]:/, drive => drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase());
}

function sampleObservation(config: IsolatedStackConfig): BrowserEvidenceObservation {
  const screenshotPath = path.join(config.runDir, "a4-success.png");
  const tracePath = path.join(config.runDir, "a4-success-trace.zip");
  writeFileSync(screenshotPath, "png-fixture");
  writeFileSync(tracePath, "trace-fixture");
  return {
    testId: "a4-success",
    route: "#semantic-search",
    mainButtons: ["a4-refresh-sources", "a4-run"],
    fixture: "downloaded ifc_ready_job_id selected from real coordinator",
    backendApi: "POST /api/governance/search/model/for-ifc-ready/job-1",
    observedRuntimeIds: { ifc_ready_job_id: "job-1" },
    visibleStates: ["success"],
    screenshotPaths: [screenshotPath],
    tracePath,
    harness: { buildFlag: false, queryFlag: false, realControlPlaneEligible: true },
  };
}

const unitEvidencePublicationVerifier: IsolatedEvidencePublicationVerifier = {
  assertWorktreeClean() {},
  async assertLiveBackendOwnership() {},
};

function writeUnitEvidence(config: IsolatedStackConfig, observation: BrowserEvidenceObservation) {
  return writeIsolatedEvidenceManifest(config, observation, unitEvidencePublicationVerifier);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadIsolatedStackConfig", () => {
  it("keeps A3 require-real on the manifest-owned federation route", () => {
    const source = readFileSync(path.join(process.cwd(), "e2e", "a3-federated-session-chain.spec.ts"), "utf8");
    expect(source).not.toMatch(/dist-ui|:8004|49102/);
    expect(source).toContain("loadIsolatedStackConfig");
    expect(source).toContain("search/llm-status");
    expect(source).toContain("requireReal");
    expect(source).toContain("watchForbiddenRequests");
    expect(source).toContain('page.goto("/#/federation")');
  });

  it("keeps A4 require-real without legacy skip gates", () => {
    const source = readFileSync(path.join(process.cwd(), "e2e", "a4-closeout.spec.ts"), "utf8");
    expect(source).not.toMatch(/A4_E2E_REQUIRE_REAL|function unavailable/);
    expect(source).toContain("loadIsolatedStackConfig");
    expect(source).toContain("watchForbiddenRequests");
    expect(source).toContain("DETERMINISTIC_CLASS_CANDIDATES");
    expect(source).toContain("selectOption(jobId)");
    expect(source).toContain("finally");
    for (const failClosedAssertion of [
      "ifc_ready_table_only",
      "search_scope",
      "completion_scope",
      "result_scan_scope",
      "complete_table",
      "a4-create-issues",
      "signed-proof",
    ]) {
      expect(source).toContain(failClosedAssertion);
    }
  });

  it("publishes A3 and A4 evidence only after request guards pass", () => {
    for (const file of ["a3-federated-session-chain.spec.ts", "a4-closeout.spec.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "e2e", file), "utf8");
      const afterEachIndex = source.indexOf("test.afterEach");
      const screenshotIndex = source.indexOf("await page.screenshot", afterEachIndex);
      const traceStopIndex = source.indexOf("await page.context().tracing.stop", afterEachIndex);
      const forbiddenGuardIndex = source.indexOf("forbiddenGuard?.assertClean()", afterEachIndex);
      const evidenceWriteIndex = source.indexOf("writeIsolatedEvidenceManifest(isolated", afterEachIndex);
      expect(afterEachIndex, `${file} has afterEach evidence publication`).toBeGreaterThanOrEqual(0);
      expect(screenshotIndex, `${file} captures its screenshot before the final request guard`).toBeGreaterThan(afterEachIndex);
      expect(traceStopIndex, `${file} stops tracing before the final request guard`).toBeGreaterThan(screenshotIndex);
      expect(forbiddenGuardIndex, `${file} checks requests after all page and trace activity`).toBeGreaterThan(traceStopIndex);
      expect(evidenceWriteIndex, `${file} writes evidence after forbidden request guard`).toBeGreaterThan(forbiddenGuardIndex);
      if (file === "a4-closeout.spec.ts") {
        const genericRouteGuardIndex = source.indexOf('expect(genericSearchRequests, "must not call the generic host-path A4 route")', afterEachIndex);
        expect(genericRouteGuardIndex, "A4 checks the generic route in afterEach").toBeGreaterThan(forbiddenGuardIndex);
        expect(evidenceWriteIndex, "A4 writes evidence after the generic route guard").toBeGreaterThan(genericRouteGuardIndex);
      }
    }
  });

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

  it("rejects external viewer in require-real evidence without build identity", () => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath, E2E_DISABLE_WEBSERVER: "1" },
    })).toThrow(/E2E_DISABLE_WEBSERVER=1 is not permitted/);
  });

  it("records every reserved-port browser request", () => {
    const guard = createForbiddenRequestGuard();
    guard.observe("http://127.0.0.1:8004/api/runtime/status");
    guard.observe("http://127.0.0.1:49102/api/search");
    expect(() => guard.assertClean()).toThrow(/8004.*49102/);
  });

  it("records reserved-port WebSockets and ignores malformed or non-network URLs", () => {
    const guard = createForbiddenRequestGuard();
    guard.observe("ws://127.0.0.1:49100/signaling");
    guard.observe("blob:http://127.0.0.1:5180/fixture");
    guard.observe("not a URL");
    expect(() => guard.assertClean()).toThrow(/49100/);
    expect(parseObservedNetworkUrl("data:text/plain,fixture")).toBeNull();
    expect(parseObservedNetworkUrl("not a URL")).toBeNull();
  });

  it("binds each live backend listener to the exact manifest process lineage", () => {
    const value = fixture();
    const coordinator = value.manifest.processes.find(processRecord => processRecord.role === "coordinator")!;
    expect(() => assertIsolatedBackendProcessSnapshot(value.manifest, "coordinator", {
      process: {
        pid: coordinator.pid,
        command_line: coordinator.command_line,
        creation_identity: coordinator.creation_identity,
        executable_path: coordinator.executable_path,
      },
      listener_pid: 4202,
      listener_lineage: [
        { pid: 4202, parent_pid: coordinator.pid, creation_identity: "2026-07-30T01:00:02.000Z" },
        { pid: coordinator.pid, parent_pid: 1, creation_identity: coordinator.creation_identity },
      ],
    })).not.toThrow();

    expect(() => assertIsolatedBackendProcessSnapshot(value.manifest, "coordinator", {
      process: {
        pid: coordinator.pid,
        command_line: coordinator.command_line,
        creation_identity: coordinator.creation_identity,
        executable_path: coordinator.executable_path,
      },
      listener_pid: 9999,
      listener_lineage: [
        { pid: 9999, parent_pid: 9998, creation_identity: "2026-07-30T01:00:02.000Z" },
        { pid: 9998, parent_pid: 1, creation_identity: "2026-07-30T01:00:01.000Z" },
      ],
    })).toThrow(/listener process is not owned by the manifest backend lineage/);

    expect(() => assertIsolatedBackendProcessSnapshot(value.manifest, "coordinator", {
      process: {
        pid: coordinator.pid,
        command_line: coordinator.command_line,
        creation_identity: coordinator.creation_identity,
        executable_path: coordinator.executable_path,
      },
      listener_pid: 4202,
      listener_lineage: [
        { pid: 4202, parent_pid: coordinator.pid, creation_identity: "2026-07-30T01:00:00.000Z" },
        { pid: coordinator.pid, parent_pid: 1, creation_identity: coordinator.creation_identity },
      ],
    })).toThrow(/reused or impossible parent identity/);
  });

  it.skipIf(process.platform !== "win32")("passes backend snapshot identity through a real pwsh process", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      expect(address && typeof address !== "string").toBe(true);
      if (!address || typeof address === "string") throw new Error("test listener did not expose a TCP port");
      const value = fixture();
      value.manifest.ports.coordinator = address.port;
      const coordinator = value.manifest.processes.find(processRecord => processRecord.role === "coordinator")!;
      coordinator.pid = process.pid;
      coordinator.entrypoint = "node";
      const isolated = {
        manifestPath: value.manifestPath,
        runDir: path.dirname(value.manifestPath),
        coordinatorBaseUrl: "http://127.0.0.1:8005",
        governanceBaseUrl: "http://127.0.0.1:49103",
        viewerPort: 5180,
        viewerOrigin: "http://127.0.0.1:5180",
        harnessBuildFlag: false,
        manifest: value.manifest,
      } as unknown as IsolatedStackConfig;
      const snapshot = captureWindowsBackendSnapshot(isolated, "coordinator");
      coordinator.command_line = snapshot.process.command_line;
      coordinator.creation_identity = snapshot.process.creation_identity;
      coordinator.executable_path = snapshot.process.executable_path;
      expect(snapshot.listener_pid).toBe(process.pid);
      expect(snapshot.listener_lineage[0]?.pid).toBe(process.pid);
      expect(() => assertIsolatedBackendProcessSnapshot(isolated.manifest, "coordinator", snapshot)).not.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it.each([
    [{ buildFlag: false, queryFlag: false }, true],
    [{ buildFlag: true, queryFlag: false }, true],
    [{ buildFlag: true, queryFlag: true }, false],
  ])("discloses harness flags and real-control-plane eligibility", (flags, eligible) => {
    expect(classifyHarnessUse(flags)).toEqual({ ...flags, realControlPlaneEligible: eligible });
  });

  it("requires all real prerequisites without skip semantics", () => {
    expect(() => requireReal(false, "fixture missing")).toThrow("fixture missing");
  });

  it("atomically merges observations only for the same run identity", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })!;
    const observation = sampleObservation(config);
    const output = await writeUnitEvidence(config, observation);
    await writeUnitEvidence(config, { ...observation, visibleStates: ["loading", "success", "retry"] });
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    expect(evidence.observations).toHaveLength(1);
    expect(evidence.observations[0].visible_states).toContain("retry");
    expect(evidence.execution_window.started_at).toBe(value.manifest.started_at);
    expect(Date.parse(evidence.execution_window.finished_at)).toBeGreaterThanOrEqual(Date.parse(value.manifest.started_at));
    expect(readdirSync(config.runDir).filter(name => name.includes(".tmp-") || name === "evidence-manifest.lock")).toEqual([]);
  });

  it("marks A4 browser operability partial until every required viewport observation is published", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })!;
    const requiredIds = [
      "a4-real-loading-1440x900",
      "a4-real-failure-retry-1440x900",
      "a4-real-success-1440x900",
      "a4-real-loading-1920x1080",
      "a4-real-failure-retry-1920x1080",
      "a4-real-success-1920x1080",
    ];
    const output = await writeUnitEvidence(config, { ...sampleObservation(config), testId: requiredIds[0] });
    expect(JSON.parse(readFileSync(output, "utf8")).scope.cpu_browser_operability).toBe("partial");
    for (const testId of requiredIds.slice(1)) {
      await writeUnitEvidence(config, { ...sampleObservation(config), testId });
    }
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    expect(evidence.scope.cpu_browser_operability).toBe("observed");
    expect(evidence.scope.required_observation_ids).toEqual(requiredIds);
  });

  it("requires an unchanged worktree and live backend ownership before publishing evidence", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const original = readFileSync(output, "utf8");
    const leftovers = () => readdirSync(config.runDir).filter(name => name.includes(".tmp-") || name === "evidence-manifest.lock.json");

    await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), visibleStates: ["retry"] }, {
      assertWorktreeClean() { throw new Error("dirty worktree"); },
      async assertLiveBackendOwnership() {},
    })).rejects.toThrow("dirty worktree");
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(leftovers()).toEqual([]);

    await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), visibleStates: ["retry"] }, {
      assertWorktreeClean() {},
      async assertLiveBackendOwnership() { throw new Error("backend ownership changed"); },
    })).rejects.toThrow("backend ownership changed");
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(leftovers()).toEqual([]);

    const support = readFileSync(path.join(process.cwd(), "e2e", "support", "isolated-stack.ts"), "utf8");
    const setup = readFileSync(path.join(process.cwd(), "e2e", "support", "isolated-stack-global-setup.ts"), "utf8");
    expect(setup).toContain("assertIsolatedWorktreeClean(isolated)");
    expect(support).toContain("verifier.assertWorktreeClean(config)");
    expect(support).toContain("await verifier.assertLiveBackendOwnership(config)");
  });

  it("keeps generated isolated runtime output ignored before the clean-worktree gate", () => {
    const repoRoot = path.resolve(process.cwd(), "..");
    const runRoot = "artifacts/e2e/isolated-branch-stack-browser-e2e/ignore-contract";
    for (const generatedPath of [
      `${runRoot}/state/governance/governance.db`,
      `${runRoot}/state/coordinator/logs/coordinator/2026-07-30/coordinator.jsonl`,
      `${runRoot}/playwright-output/a4-closeout/error-context.md`,
    ]) {
      expect(() => execFileSync("git", ["check-ignore", "-q", "--", generatedPath], { cwd: repoRoot, stdio: "ignore" })).not.toThrow();
    }
  });

  it("preserves original bytes on evidence identity mismatch", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = path.join(config.runDir, "evidence-manifest.json");
    const original = JSON.stringify({ schema_version: "isolated-branch-browser-evidence/v1", stack_kind: "isolated_branch_stack", change_id: "other", run_id: "other", head_sha: "f".repeat(40), observations: [] });
    writeFileSync(output, original);
    await expect(writeUnitEvidence(config, sampleObservation(config))).rejects.toThrow(/evidence identity mismatch/);
    expect(readFileSync(output, "utf8")).toBe(original);
  });

  it("rejects evidence artifacts outside the current run directory", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const outsidePath = path.join(value.worktreeRoot, "outside.png");
    writeFileSync(outsidePath, "outside");
    await expect(writeUnitEvidence(config, { ...sampleObservation(config), screenshotPaths: [outsidePath] })).rejects.toThrow(/artifact path must stay inside current run/);
  });

  it("rejects a contained screenshot or trace path that does not exist", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const observation = sampleObservation(config);
    rmSync(observation.tracePath!, { force: true });
    await expect(writeUnitEvidence(config, observation)).rejects.toThrow(/artifact does not exist/);
  });

  it("rejects caller harness build flags that disagree with the manifest authority", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const observation = sampleObservation(config);
    await expect(writeUnitEvidence(config, {
      ...observation,
      harness: { ...observation.harness, buildFlag: true },
    })).rejects.toThrow(/harness build flag mismatch/);
  });

  it("rejects external viewer before it can claim harness evidence", () => {
    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: {
        E2E_REQUIRE_REAL: "1",
        E2E_STACK_MANIFEST: value.manifestPath,
        E2E_DISABLE_WEBSERVER: "1",
        E2E_VIEWER_HARNESS_BUILD: "1",
      },
    })).toThrow(/E2E_DISABLE_WEBSERVER=1 is not permitted/);
  });

  it("fails closed on a pre-existing evidence lock and preserves original bytes", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const original = readFileSync(output, "utf8");
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    closeSync(openSync(lockPath, "wx"));
    try {
      await expect(writeUnitEvidence(config, { ...sampleObservation(config), visibleStates: ["retry"] })).rejects.toThrow(/evidence writer lock exists/);
      expect(readFileSync(output, "utf8")).toBe(original);
    } finally {
      unlinkSync(lockPath);
    }
  });

  it("rejects directory artifacts and physical symlink or junction escapes", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const artifactDirectory = path.join(config.runDir, "not-a-file");
    mkdirSync(artifactDirectory);
    await expect(writeUnitEvidence(config, { ...sampleObservation(config), screenshotPaths: [artifactDirectory] })).rejects.toThrow(/artifact must be a file/);

    const outsideDirectory = path.join(value.worktreeRoot, "outside-artifacts");
    const outsideFile = path.join(outsideDirectory, "outside.png");
    const escape = path.join(config.runDir, "artifact-escape");
    mkdirSync(outsideDirectory);
    writeFileSync(outsideFile, "outside");
    symlinkSync(outsideDirectory, escape, process.platform === "win32" ? "junction" : "dir");
    await expect(writeUnitEvidence(config, {
      ...sampleObservation(config),
      screenshotPaths: [path.join(escape, "outside.png")],
    })).rejects.toThrow(/artifact path must stay inside current run/);
  });
});
