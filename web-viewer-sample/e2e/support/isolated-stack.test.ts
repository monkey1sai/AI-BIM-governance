import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { captureWindowsBackendSnapshot } from "./isolated-stack-global-setup";
import {
  assertIsolatedBackendProcessSnapshot,
  assertIsolatedManifestHead,
  assertIsolatedWorktreeClean,
  assertIsolatedWorktreeStatusClean,
  assertLiveIsolatedBackendOwnership,
  A4_REQUIRED_OBSERVATION_IDS,
  ISOLATED_REQUIRED_OBSERVATION_IDS,
  beginIsolatedEvidenceInvocation,
  classifyHarnessUse,
  createForbiddenRequestGuard,
  defaultIsolatedEvidencePublicationVerifier,
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
const UNIT_EVIDENCE_GENERATION = "11111111-1111-4111-8111-111111111111";
const NEXT_EVIDENCE_GENERATION = "22222222-2222-4222-8222-222222222222";
const STALE_LOCK_ID = "33333333-3333-4333-8333-333333333333";
const UNIT_EVIDENCE_LOCK_IDENTITY = "unit-evidence-writer-process";
const unitEvidenceLockIdentityLookup = (processId: number) =>
  processId === process.pid ? UNIT_EVIDENCE_LOCK_IDENTITY : null;

function fixture() {
  const worktreeRoot = mkdtempSync(path.join(tmpdir(), "isolated-stack-"));
  roots.push(worktreeRoot);
  const changeId = "isolated-branch-stack-browser-e2e";
  const runId = "unit-r1";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const runDir = path.join(worktreeRoot, "artifacts", "e2e", changeId, runId);
  const manifestPath = path.join(runDir, "stack-manifest.json");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.join(worktreeRoot, "storage"), { recursive: true });
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
  writeFileSync(path.join(runDir, "evidence-invocation.json"), JSON.stringify({
    schema_version: "isolated-branch-evidence-invocation/v1",
    invocation_generation: UNIT_EVIDENCE_GENERATION,
    head_sha: headSha,
    created_at: "2026-07-30T01:00:02.000Z",
  }));
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
    invocationGeneration: UNIT_EVIDENCE_GENERATION,
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
  assertWorktreeStatusClean() {},
  async assertLiveBackendOwnership() {},
  assertManifestHead() {},
  evidenceLockIdentityLookup: unitEvidenceLockIdentityLookup,
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
    expect(source).toContain('path.join(isolated.readOnlyFixtureRoot, "e2e-a3")');
    expect(source).not.toMatch(/E2E_A3_USD_DIR|C:\/Repos\/active\/iot\/AI-BIM-governance/);
  });

  it("keeps A4 require-real without legacy skip gates", () => {
    const source = readFileSync(path.join(process.cwd(), "e2e", "a4-closeout.spec.ts"), "utf8");
    expect(source).not.toMatch(/A4_E2E_REQUIRE_REAL|function unavailable/);
    expect(source).toContain("loadIsolatedStackConfig");
    expect(source).toContain("watchForbiddenRequests");
    expect(source).toContain("DETERMINISTIC_CLASS_CANDIDATES");
    expect(source).toContain("selectOption(jobId)");
    expect(source).toContain("SAFE_A4_QUERY_ID");
    expect(source).toContain("query_id: observedQueryId");
    expect(source).toContain("empty match stays explicit and does not enable legacy actions");
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
    expect(config?.readOnlyFixtureRoot).toBe(realpathSync(path.join(value.worktreeRoot, "storage")));
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
    ["relative fixture root", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, read_only_fixture_root: "storage" }), /fixture root must be absolute/],
    ["fixture root identity", (value: ReturnType<typeof fixture>) => ({ ...value.manifest, read_only_fixture_root: path.join(value.worktreeRoot, "artifacts") }), /fixture root identity mismatch/],
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

  it("forbids isolated governance ports in the browser while accepting them in the manifest", () => {
    const guard = createForbiddenRequestGuard();
    guard.observe("http://127.0.0.1:49103/api/search");
    guard.observe("http://127.0.0.1:49107/api/search");
    expect(() => guard.assertClean()).toThrow(/49103.*49107/);

    const value = fixture();
    expect(() => loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })).not.toThrow();
  });

  it("allows only the current manifest coordinator origin across isolated offsets", () => {
    const guard = createForbiddenRequestGuard("http://127.0.0.1:8005");
    guard.observe("http://127.0.0.1:8005/health");
    guard.observe("ws://127.0.0.1:8005/socket.io");
    const peerHttp = "http://127.0.0.1:8006/health";
    const peerWebSocket = "ws://127.0.0.1:8009/socket.io";
    const wrongHost = "http://localhost:8005/health";
    const wrongProtocol = "https://127.0.0.1:8005/health";
    guard.observe(peerHttp);
    guard.observe(peerWebSocket);
    guard.observe(wrongHost);
    guard.observe(wrongProtocol);
    expect(guard.violations).toEqual([peerHttp, peerWebSocket, wrongHost, wrongProtocol]);
    expect(() => guard.assertClean()).toThrow(/8006.*8009.*localhost:8005.*https:\/\/127\.0\.0\.1:8005/);
  });

  it("maps every default evidence verifier contract key to the intended gate", () => {
    expect(defaultIsolatedEvidencePublicationVerifier).toEqual({
      assertWorktreeStatusClean: assertIsolatedWorktreeStatusClean,
      assertLiveBackendOwnership: assertLiveIsolatedBackendOwnership,
      assertManifestHead: assertIsolatedManifestHead,
    });
  });

  it("limits require-real isolated Playwright discovery to the A3 and A4 specs", () => {
    const source = readFileSync(path.join(process.cwd(), "playwright.config.ts"), "utf8");
    expect(source).toContain('testMatch: ["**/a3-federated-session-chain.spec.ts", "**/a4-closeout.spec.ts"]');
  });

  it("starts an isolated viewer without rerunning the mutating design-asset sync", () => {
    const source = readFileSync(path.join(process.cwd(), "playwright.config.ts"), "utf8");
    expect(source).toContain('? `npm exec -- vite --host 127.0.0.1 --port ${viewerPort} --strictPort`');
    expect(source).toContain(': `npm run dev -- --host 127.0.0.1 --port ${viewerPort} --strictPort`');
    expect(source).toContain('metadata: isolated ? { isolatedEvidenceGeneration } : {}');
    expect(source).toContain('path.join(isolated.runDir, "playwright-output", isolatedEvidenceGeneration!)');
    expect(source).toContain('path.join(isolated.runDir, "playwright-report", isolatedEvidenceGeneration!)');
  });

  it("records the query actually exercised by the A4 empty observation", () => {
    const source = readFileSync(path.join(process.cwd(), "e2e", "a4-closeout.spec.ts"), "utf8");
    expect(source).toContain("fixture: pendingEvidence.fixture");
    expect(source).toContain("deterministic query=${emptyQuery}");
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
    expect(readdirSync(config.runDir).filter(name => name.includes(".tmp-") || name === "evidence-manifest.lock.json")).toEqual([]);
  });

  it("keeps browser operability partial until A3 and every required A4 viewport observation are published", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({
      cwd: value.worktreeRoot,
      headSha: value.headSha,
      env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath },
    })!;
    const a4Ids = [...A4_REQUIRED_OBSERVATION_IDS];
    const output = await writeUnitEvidence(config, { ...sampleObservation(config), testId: a4Ids[0] });
    expect(JSON.parse(readFileSync(output, "utf8")).scope.cpu_browser_operability).toBe("partial");
    for (const testId of a4Ids.slice(1)) {
      await writeUnitEvidence(config, { ...sampleObservation(config), testId });
    }
    expect(JSON.parse(readFileSync(output, "utf8")).scope.cpu_browser_operability).toBe("partial");
    await writeUnitEvidence(config, { ...sampleObservation(config), testId: "a3-federated-session-chain" });
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    expect(evidence.scope.cpu_browser_operability).toBe("observed");
    expect(evidence.scope.required_observation_ids).toEqual([...ISOLATED_REQUIRED_OBSERVATION_IDS]);
  });

  it("prunes observations whose in-run artifacts were deleted and recomputes partial scope", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const stale = sampleObservation(config);
    for (const testId of ISOLATED_REQUIRED_OBSERVATION_IDS) {
      await writeUnitEvidence(config, { ...stale, testId });
    }
    rmSync(stale.screenshotPaths[0], { force: true });
    rmSync(stale.tracePath!, { force: true });

    const currentScreenshot = path.join(config.runDir, "current.png");
    const currentTrace = path.join(config.runDir, "current-trace.zip");
    writeFileSync(currentScreenshot, "current-png");
    writeFileSync(currentTrace, "current-trace");
    const output = await writeUnitEvidence(config, {
      ...stale,
      testId: "a3-current",
      screenshotPaths: [currentScreenshot],
      tracePath: currentTrace,
    });
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    expect(evidence.observations.map((item: { test_id: string }) => item.test_id)).toEqual(["a3-current"]);
    expect(evidence.scope.cpu_browser_operability).toBe("partial");
  });

  it("leases each invocation generation and rejects stale concurrent writers", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    expect(existsSync(output)).toBe(true);

    const finishSetup = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    expect(existsSync(output)).toBe(false);
    expect(existsSync(lockPath)).toBe(true);
    await expect(writeIsolatedEvidenceManifest(config, sampleObservation(config), unitEvidencePublicationVerifier))
      .rejects.toThrow(/evidence writer lock exists/);
    finishSetup(true);
    expect(existsSync(lockPath)).toBe(false);
    await expect(writeIsolatedEvidenceManifest(config, sampleObservation(config), unitEvidencePublicationVerifier))
      .rejects.toThrow(/invocation generation is stale/);

    const nextObservation = {
      ...sampleObservation(config),
      invocationGeneration: NEXT_EVIDENCE_GENERATION,
      testId: "next-generation",
    };
    await expect(writeIsolatedEvidenceManifest(config, nextObservation, unitEvidencePublicationVerifier)).resolves.toBe(output);
    expect(JSON.parse(readFileSync(output, "utf8")).invocation_generation).toBe(NEXT_EVIDENCE_GENERATION);
    const setup = readFileSync(path.join(process.cwd(), "e2e", "support", "isolated-stack-global-setup.ts"), "utf8");
    expect(setup.indexOf("beginIsolatedEvidenceInvocation(isolated, invocationGeneration)")).toBeLessThan(setup.indexOf("assertIsolatedWorktreeClean(isolated)"));
    expect(setup).toContain("finishInvocationSetup(setupSucceeded)");
  });

  it("removes the invocation lease when global setup fails", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const finishSetup = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);

    finishSetup(false);

    expect(existsSync(output)).toBe(false);
    expect(existsSync(path.join(config.runDir, "evidence-invocation.json"))).toBe(false);
    await expect(writeIsolatedEvidenceManifest(config, {
      ...sampleObservation(config),
      invocationGeneration: NEXT_EVIDENCE_GENERATION,
    }, unitEvidencePublicationVerifier)).rejects.toThrow(/invocation lease is missing/);
  });

  it("fails closed on malformed or outside-run stored artifact references", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const evidence = JSON.parse(readFileSync(output, "utf8"));

    evidence.observations[0].artifacts.screenshots = ["../outside.png"];
    writeFileSync(output, JSON.stringify(evidence));
    await expect(writeUnitEvidence(config, { ...sampleObservation(config), testId: "replacement" })).rejects.toThrow(/stored artifact path must stay inside current run/);

    evidence.observations[0].artifacts.screenshots = "not-an-array";
    writeFileSync(output, JSON.stringify(evidence));
    await expect(writeUnitEvidence(config, { ...sampleObservation(config), testId: "replacement" })).rejects.toThrow(/stored evidence artifact reference is malformed/);
  });

  it.each(["missing", "null"])("fails closed when an existing manifest has %s observations", async state => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const evidence = JSON.parse(readFileSync(output, "utf8"));
    if (state === "missing") delete evidence.observations;
    else evidence.observations = null;
    writeFileSync(output, JSON.stringify(evidence));

    await expect(writeUnitEvidence(config, { ...sampleObservation(config), testId: "replacement" }))
      .rejects.toThrow(/stored evidence observations are malformed/);
  });

  it("requires an unchanged worktree and live backend ownership before publishing evidence", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const original = readFileSync(output, "utf8");
    const leftovers = () => readdirSync(config.runDir).filter(name => name.includes(".tmp-") || name === "evidence-manifest.lock.json");

    await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), visibleStates: ["retry"] }, {
      assertWorktreeStatusClean() { throw new Error("dirty worktree"); },
      async assertLiveBackendOwnership() {},
      assertManifestHead() {},
    })).rejects.toThrow("dirty worktree");
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(leftovers()).toEqual([]);

    await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), visibleStates: ["retry"] }, {
      assertWorktreeStatusClean() {},
      async assertLiveBackendOwnership() { throw new Error("backend ownership changed"); },
      assertManifestHead() {},
    })).rejects.toThrow("backend ownership changed");
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(leftovers()).toEqual([]);

    const support = readFileSync(path.join(process.cwd(), "e2e", "support", "isolated-stack.ts"), "utf8");
    const setup = readFileSync(path.join(process.cwd(), "e2e", "support", "isolated-stack-global-setup.ts"), "utf8");
    expect(setup).toContain("assertIsolatedWorktreeClean(isolated)");
    expect(support).toContain("verifier.assertWorktreeStatusClean(config)");
    expect(support).toContain("await verifier.assertLiveBackendOwnership(config)");
    expect(support).toContain("verifier.assertManifestHead(config)");
  });

  it("rejects a clean worktree that drifted from its manifest HEAD before publishing evidence", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const original = readFileSync(output, "utf8");
    const driftedHead = "f".repeat(40);
    const gitCalls: string[] = [];
    const runGit = (args: string[]) => {
      gitCalls.push(args[0]);
      return args[0] === "rev-parse" ? driftedHead : "";
    };

    expect(() => assertIsolatedWorktreeClean(config, runGit)).toThrow("manifest-matching HEAD");
    expect(gitCalls).toEqual(["status", "rev-parse"]);
    gitCalls.splice(0);
    const publicationCalls: string[] = [];
    await expect(writeIsolatedEvidenceManifest(config, { ...sampleObservation(config), visibleStates: ["retry"] }, {
      assertWorktreeStatusClean(current) {
        publicationCalls.push("status");
        assertIsolatedWorktreeStatusClean(current, runGit);
      },
      async assertLiveBackendOwnership() { publicationCalls.push("live"); },
      assertManifestHead(current) {
        publicationCalls.push("rev-parse");
        assertIsolatedManifestHead(current, runGit);
      },
    })).rejects.toThrow("manifest-matching HEAD");
    expect(gitCalls).toEqual(["status", "rev-parse"]);
    expect(publicationCalls).toEqual(["status", "live", "rev-parse"]);
    expect(readFileSync(output, "utf8")).toBe(original);
  });

  it("keeps generated isolated runtime output ignored before the clean-worktree gate", () => {
    const repoRoot = path.resolve(process.cwd(), "..");
    const runRoot = "artifacts/e2e/isolated-branch-stack-browser-e2e/ignore-contract";
    for (const generatedPath of [
      `${runRoot}/state/governance/governance.db`,
      `${runRoot}/state/coordinator/logs/coordinator/2026-07-30/coordinator.jsonl`,
      `${runRoot}/playwright-output/a4-closeout/error-context.md`,
      `${runRoot}/playwright-report/${UNIT_EVIDENCE_GENERATION}/index.html`,
      `${runRoot}/evidence-manifest.lock.json.reclaim-${STALE_LOCK_ID}.json`,
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

  it("fails closed on an active evidence lock and preserves original bytes", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const original = readFileSync(output, "utf8");
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const activeBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-lock/v1",
      lock_id: STALE_LOCK_ID,
      owner_pid: process.pid,
      owner_creation_identity: UNIT_EVIDENCE_LOCK_IDENTITY,
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`;
    writeFileSync(lockPath, activeBytes);

    await expect(writeUnitEvidence(config, { ...sampleObservation(config), visibleStates: ["retry"] })).rejects.toThrow(/evidence writer lock exists/);
    expect(readFileSync(lockPath, "utf8")).toBe(activeBytes);
    expect(readFileSync(output, "utf8")).toBe(original);
    unlinkSync(lockPath);
  });

  it("only lets global setup reclaim an identity-proven stale evidence lock", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const originalEvidence = readFileSync(output, "utf8");
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const staleRecord = {
      schema_version: "isolated-branch-evidence-writer-lock/v1",
      lock_id: STALE_LOCK_ID,
      owner_pid: 999_999,
      owner_creation_identity: "stale-process-identity",
      created_at: "2026-07-30T00:00:00.000Z",
    };
    const staleBytes = `${JSON.stringify(staleRecord, null, 2)}\n`;
    writeFileSync(lockPath, staleBytes);

    await expect(writeUnitEvidence(config, { ...sampleObservation(config), visibleStates: ["retry"] })).rejects.toThrow(/evidence writer lock exists/);
    expect(readFileSync(lockPath, "utf8")).toBe(staleBytes);
    expect(readFileSync(output, "utf8")).toBe(originalEvidence);

    const finishSetup = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    expect(existsSync(output)).toBe(false);
    finishSetup(true);
    expect(existsSync(lockPath)).toBe(false);
    const nextObservation = {
      ...sampleObservation(config),
      invocationGeneration: NEXT_EVIDENCE_GENERATION,
      visibleStates: ["retry"],
    };
    await expect(writeUnitEvidence(config, nextObservation)).resolves.toBe(output);
    expect(JSON.parse(readFileSync(output, "utf8")).observations[0].visible_states).toContain("retry");

    const malformedBytes = "{}\n";
    writeFileSync(lockPath, malformedBytes);
    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup)).toThrow(/evidence writer lock is malformed/);
    expect(readFileSync(lockPath, "utf8")).toBe(malformedBytes);
    unlinkSync(lockPath);
  });

  it("serializes competing global-setup reclaimers with a per-lock claim", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const staleBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-lock/v1",
      lock_id: STALE_LOCK_ID,
      owner_pid: 999_999,
      owner_creation_identity: "stale-process-identity",
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`;
    const reclaimClaimPath = `${lockPath}.reclaim-${STALE_LOCK_ID}.json`;
    writeFileSync(lockPath, staleBytes);
    writeFileSync(reclaimClaimPath, `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-reclaim/v1",
      stale_lock_id: STALE_LOCK_ID,
      claimant_pid: process.pid,
      claimant_creation_identity: UNIT_EVIDENCE_LOCK_IDENTITY,
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`);

    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup)).toThrow(/stale-reclaim claim exists/);
    expect(readFileSync(lockPath, "utf8")).toBe(staleBytes);
    expect(existsSync(reclaimClaimPath)).toBe(true);

    unlinkSync(reclaimClaimPath);
    const finishSetup = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    expect(existsSync(reclaimClaimPath)).toBe(false);
    finishSetup(true);
  });

  it("recovers an identity-proven abandoned reclaim claim after its canonical lock is gone", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const reclaimClaimPath = `${lockPath}.reclaim-${STALE_LOCK_ID}.json`;
    writeFileSync(reclaimClaimPath, `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-reclaim/v1",
      stale_lock_id: STALE_LOCK_ID,
      claimant_pid: 999_999,
      claimant_creation_identity: "abandoned-claimant-identity",
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`);

    const finishSetup = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    expect(existsSync(reclaimClaimPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(true);
    finishSetup(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("retains an abandoned claim when its same-id canonical lock makes recovery ambiguous", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const reclaimClaimPath = `${lockPath}.reclaim-${STALE_LOCK_ID}.json`;
    const staleLockBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-lock/v1",
      lock_id: STALE_LOCK_ID,
      owner_pid: 888_888,
      owner_creation_identity: "abandoned-lock-owner",
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`;
    const abandonedClaimBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-reclaim/v1",
      stale_lock_id: STALE_LOCK_ID,
      claimant_pid: 999_999,
      claimant_creation_identity: "abandoned-claimant-identity",
      created_at: "2026-07-30T00:00:01.000Z",
    }, null, 2)}\n`;
    writeFileSync(lockPath, staleLockBytes);
    writeFileSync(reclaimClaimPath, abandonedClaimBytes);

    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup)).toThrow(/requires manual cleanup/);
    expect(readFileSync(lockPath, "utf8")).toBe(staleLockBytes);
    expect(readFileSync(reclaimClaimPath, "utf8")).toBe(abandonedClaimBytes);
  });

  it("fails closed on malformed or unobservable reclaim claims", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const reclaimClaimPath = `${lockPath}.reclaim-${STALE_LOCK_ID}.json`;
    const malformedClaimBytes = "{}\n";
    writeFileSync(reclaimClaimPath, malformedClaimBytes);
    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup)).toThrow(/claim is malformed/);
    expect(readFileSync(reclaimClaimPath, "utf8")).toBe(malformedClaimBytes);

    unlinkSync(reclaimClaimPath);
    const unobservableClaimBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-reclaim/v1",
      stale_lock_id: STALE_LOCK_ID,
      claimant_pid: 777_777,
      claimant_creation_identity: "unobservable-claimant-identity",
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`;
    writeFileSync(reclaimClaimPath, unobservableClaimBytes);
    const unavailableLookup = (processId: number) => {
      if (processId === process.pid) return UNIT_EVIDENCE_LOCK_IDENTITY;
      throw new Error("injected claimant provider failure");
    };
    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unavailableLookup)).toThrow(/claimant lookup failed/);
    expect(readFileSync(reclaimClaimPath, "utf8")).toBe(unobservableClaimBytes);
  });

  it("fails closed when stale-lock owner identity cannot be observed", async () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const output = await writeUnitEvidence(config, sampleObservation(config));
    const originalEvidence = readFileSync(output, "utf8");
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const lockBytes = `${JSON.stringify({
      schema_version: "isolated-branch-evidence-writer-lock/v1",
      lock_id: STALE_LOCK_ID,
      owner_pid: 888_888,
      owner_creation_identity: "unobservable-process-identity",
      created_at: "2026-07-30T00:00:00.000Z",
    }, null, 2)}\n`;
    writeFileSync(lockPath, lockBytes);
    const unavailableLookup = (processId: number) => {
      if (processId === process.pid) return UNIT_EVIDENCE_LOCK_IDENTITY;
      throw new Error("injected process provider failure");
    };

    expect(() => beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unavailableLookup)).toThrow(/owner lookup failed/);
    expect(readFileSync(lockPath, "utf8")).toBe(lockBytes);
    expect(readFileSync(output, "utf8")).toBe(originalEvidence);
    unlinkSync(lockPath);
  });

  it("prevents a delayed old-owner release from deleting a successor lock", () => {
    const value = fixture();
    const config = loadIsolatedStackConfig({ cwd: value.worktreeRoot, headSha: value.headSha, env: { E2E_REQUIRE_REAL: "1", E2E_STACK_MANIFEST: value.manifestPath } })!;
    const lockPath = path.join(config.runDir, "evidence-manifest.lock.json");
    const releaseOld = beginIsolatedEvidenceInvocation(config, UNIT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    const oldBytes = readFileSync(lockPath, "utf8");
    unlinkSync(lockPath);
    const releaseSuccessor = beginIsolatedEvidenceInvocation(config, NEXT_EVIDENCE_GENERATION, unitEvidenceLockIdentityLookup);
    const successorBytes = readFileSync(lockPath, "utf8");

    expect(successorBytes).not.toBe(oldBytes);
    expect(() => releaseOld(true)).toThrow(/identity changed before release/);
    expect(readFileSync(lockPath, "utf8")).toBe(successorBytes);
    releaseSuccessor(true);
    expect(existsSync(lockPath)).toBe(false);
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
