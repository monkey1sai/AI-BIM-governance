import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";

let active: CoordinatorApp | null = null;
let activeConversionServer: http.Server | null = null;

afterEach(async () => {
  if (activeConversionServer) {
    await new Promise<void>((resolve) => activeConversionServer?.close(() => resolve()));
    activeConversionServer = null;
  }
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
});

function makeApp(overrides: Parameters<typeof createCoordinatorApp>[0] = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-dev-console-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    corsOrigins: ["http://127.0.0.1:5173"],
    ...overrides,
  });
  return active;
}

describe("coordinator dev console", () => {
  it("serves the dev console from /ui and /dev-console", async () => {
    const app = makeApp();

    const ui = await request(app.app).get("/ui");
    const consolePage = await request(app.app).get("/dev-console");

    expect(ui.status).toBe(200);
    expect(ui.text).toContain("審查協調 (Review Coordinator)");
    expect(ui.text).toContain("閉環 Runtime Dashboard");
    expect(ui.text).toContain("/api/runtime/status");
    expect(ui.text).toContain("Kit / WebRTC");
    expect(ui.text).toContain("expected stage URL");
    expect(ui.text).toContain("sourceFileInput");
    expect(ui.text).toContain("/api/dev/conversions/mock");
    expect(ui.text).toContain("/api/external/ifc-ready");
    expect(ui.text).toContain("getLatestConversionReviewPayload");
    expect(ui.text).toContain("互動效果實驗室");
    // remove-conflict-review-from-fast-mvp:衝突檢討(guidedHighlightIssue / guidedAnnotation / guidedConversion)已自 fast MVP 移除
    expect(ui.text).not.toContain("guidedHighlightIssue");
    expect(ui.text).not.toContain("guidedAnnotation");
    expect(ui.text).not.toContain("emitHighlight()");
    expect(ui.text).toContain("步驟 ③ / 3");
    expect(ui.text).toContain("工程參數與 Raw API / Socket controls");
    expect(ui.text).toContain("browser-visible viewer URL");
    expect(consolePage.status).toBe(200);
    expect(consolePage.text).toContain("/api/review-sessions");
  });

  it("serves EdgeConsole dist from /ui while keeping /dev-console and /ui/open separate", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-console-dist-test-"));
    const consoleDist = path.join(root, "console-dist");
    const assetsDir = path.join(consoleDist, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(consoleDist, "index.html"),
      '<!doctype html><html><head><script type="module" src="/ui/assets/index-test.js"></script></head><body><div id="root">Vite Shell</div></body></html>',
    );
    fs.writeFileSync(path.join(assetsDir, "index-test.js"), 'document.body.dataset.edgeConsole = "loaded";');
    const app = makeApp({
      consoleDistDir: consoleDist,
      coordinatorPublicBaseUrl: "http://192.168.10.105:8004",
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
      publicHost: "192.168.10.105",
    });

    const ui = await request(app.app).get("/ui");
    const asset = await request(app.app).get("/ui/assets/index-test.js");
    const devConsole = await request(app.app).get("/dev-console");
    const invalidOpen = await request(app.app).get("/ui/open?session=bad");
    const validOpen = await request(app.app).get("/ui/open?session=review_session_console_dist").redirects(0);

    expect(ui.status).toBe(200);
    expect(ui.text).toContain("Vite Shell");
    expect(ui.text).toContain("/ui/assets/index-test.js");
    expect(asset.status).toBe(200);
    expect(asset.text).toContain("edgeConsole");
    expect(devConsole.status).toBe(200);
    expect(devConsole.text).toContain("審查協調 (Review Coordinator)");
    expect(invalidOpen.status).toBe(400);
    expect(validOpen.status).toBe(302);
    expect(validOpen.headers.location).toContain("http://192.168.10.105:5173/");
    expect(validOpen.headers.location).toContain("session=review_session_console_dist");
  });

  it("redirects /ui/open to configured browser-visible viewer URL", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "http://192.168.10.105:8004",
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
      publicHost: "192.168.10.105",
    });

    const response = await request(app.app)
      .get("/ui/open?session=review_session_test_001&a4_handoff=a4h_1234567890abcdef&redirect=http://evil.example")
      .redirects(0);

    expect(response.status).toBe(302);
    const location = response.headers.location as string;
    expect(location).toContain("http://192.168.10.105:5173/");
    expect(location).toContain("session=review_session_test_001");
    expect(location).toContain("coordinatorApiBase=http%3A%2F%2F192.168.10.105%3A8004");
    expect(location).toContain("coordinatorSocketUrl=http%3A%2F%2F192.168.10.105%3A8004");
    expect(location).toContain("a4_handoff=a4h_1234567890abcdef");
    expect(location).not.toContain("127.0.0.1:5173");
    expect(location).not.toContain("evil.example");

    const invalidHandoff = await request(app.app)
      .get("/ui/open?session=review_session_test_001&a4_handoff=not-an-opaque-handoff")
      .redirects(0);
    expect(invalidHandoff.headers.location).not.toContain("a4_handoff");
  });

  it("CH-E/RK6：/ui/console 301 收斂到 /ui，且不以 /ui/* 萬用吞掉凍結的 /ui/open", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "http://192.168.10.105:8004",
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
      publicHost: "192.168.10.105",
    });

    // /ui/console → 301 /ui（顯式收斂，非 /ui/* 萬用）。
    const consoleRedirect = await request(app.app).get("/ui/console").redirects(0);
    expect(consoleRedirect.status).toBe(301);
    expect(consoleRedirect.headers.location).toBe("/ui");

    // RK6：/ui/open 仍 302 到 viewer，未被 /ui/console 或任何 /ui/* 萬用吞掉（凍結 handoff 逐字保留）。
    const openRedirect = await request(app.app)
      .get("/ui/open?session=review_session_rk6_guard")
      .redirects(0);
    expect(openRedirect.status).toBe(302);
    expect(openRedirect.headers.location).toContain("http://192.168.10.105:5173/");
    expect(openRedirect.headers.location).toContain("session=review_session_rk6_guard");

    // /ui 仍服務 console（200），未被 301 影響。
    const ui = await request(app.app).get("/ui");
    expect(ui.status).toBe(200);
  });

  it("PR#184 risk: /api/dev/ifc-sources 契約形狀（root + items，無絕對路徑 / storage_root / source_ref）", async () => {
    const ifcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bim-ifc-sources-test-"));
    fs.writeFileSync(path.join(ifcRoot, "sample.ifc"), "ISO-10303-21;\nEND-ISO-10303-21;\n");
    const app = makeApp({ storageRoot: ifcRoot });

    const res = await request(app.app).get("/api/dev/ifc-sources");
    expect(res.status).toBe(200);
    expect(res.body.root).toMatchObject({ exists: true, readable: true, item_count: 1 });
    const item = res.body.items[0];
    expect(item.source_id).toMatch(/^ifcsrc_/);
    expect(item.filename).toBe("sample.ifc");
    expect(item.relative_path).toBe("sample.ifc");
    expect(typeof item.size_bytes).toBe("number");
    expect(item.modified_at).toBeTruthy();
    // 契約：絕不洩漏絕對路徑 / storage_root / public source_ref。
    expect("storage_root" in res.body).toBe(false);
    expect("source_ref" in item).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(ifcRoot);
  });

  it("PR#184 risk: 變更型 /api/kit/* 無 dev token 一律 403", async () => {
    const app = makeApp();
    const res = await request(app.app).post("/api/kit/instances/current/open").send({});
    expect(res.status).toBe(403);
  });

  it("CH-C: stage-binding 後端角色權威（spectator/非 primary 403、primary lease token、active/last-good revision、缺 primary 400）", async () => {
    const app = makeApp();
    const created = await request(app.app).post("/api/review-sessions").send({
      project_id: "project_demo_001",
      model_version_id: "version_demo_001",
      created_by: "dev_user_001",
      routing_policy: "same_instance",
      artifact_bindings: [
        {
          artifact_group_id: "ag_version_demo_001",
          artifact_id: "a1",
          artifact_role: "derived",
          url: "http://127.0.0.1:49101/artifacts/stage-binding/model.usdc",
          mapping_url: "http://127.0.0.1:49101/artifacts/stage-binding/element_mapping.json",
          load_order: 0,
          ready_status: "ready",
          conversion_authority: "bim-streaming-server",
          conversion_job_id: "stream_conv_stage_binding",
          conversion_status: "ready",
        },
      ],
      kit_profile: {},
    });
    expect(created.status).toBeLessThan(300);
    const sid = created.body.session_id as string;
    expect(sid).toBeTruthy();
    const claimed = await request(app.app)
      .post(`/api/review-sessions/${sid}/viewer-leases/claim`)
      .send({
        viewer_id: "viewer_primary",
        user_id: "user_primary",
        display_name: "Primary viewer",
        requested_role: "primary",
        client_nonce: `viewer_primary:${sid}:primary`,
      });
    expect(claimed.status).toBe(200);
    const leaseId = claimed.body.lease_id as string;
    const leaseToken = claimed.body.lease_token as string;
    const bind = (b: Record<string, unknown>, token = leaseToken) => {
      const req = request(app.app).post(`/api/review-sessions/${sid}/stage-binding`);
      if (token) req.set("X-Viewer-Lease-Token", token);
      return req.send(b);
    };

    // spectator / 非 primary → 403（後端拒絕，非 UI-only）。
    expect((await bind({ source_client_id: "c_spec", role: "spectator", binding_revision_id: "binding_rev_1", primary_artifact_id: "a1" })).status).toBe(403);
    // primary 缺 lease token → 403（不得再走 legacy first-wins bypass）。
    expect((await bind({ source_client_id: leaseId, role: "primary", binding_revision_id: "binding_rev_1", primary_artifact_id: "a1" }, "")).status).toBe(403);
    // primary（lease token authority）→ 200。
    const p1 = await bind({ source_client_id: leaseId, role: "primary", binding_revision_id: "binding_rev_1", primary_artifact_id: "a1" });
    expect(p1.status).toBe(200);
    expect(p1.body.active_binding_revision).toBe("binding_rev_1");
    expect(p1.body.primary_client_id).toBe(leaseId);
    expect(p1.body.last_good_binding_revision).toBeNull();
    // 另一 client 宣稱 primary → 403（已有 primary 持有者）。
    expect((await bind({ source_client_id: "c_other", role: "primary", binding_revision_id: "binding_rev_2", primary_artifact_id: "a1" })).status).toBe(403);
    // 原 primary 再套用 → 200 + last_good = binding_rev_1（交易式 revision 串）。
    const p2 = await bind({ source_client_id: leaseId, role: "primary", binding_revision_id: "binding_rev_2", primary_artifact_id: "a1" });
    expect(p2.status).toBe(200);
    expect(p2.body.active_binding_revision).toBe("binding_rev_2");
    expect(p2.body.last_good_binding_revision).toBe("binding_rev_1");
    // 缺 primary_artifact_id → 400（交易需恰好一個 primary）。
    expect((await bind({ source_client_id: leaseId, role: "primary", binding_revision_id: "binding_rev_3" })).status).toBe(400);
  });

  it("forwards only whitelisted viewer identity params through /ui/open", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "http://192.168.10.105:8004",
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
      publicHost: "192.168.10.105",
    });

    const response = await request(app.app)
      .get(
        "/ui/open?session=review_session_test_001&userId=viewer_001&displayName=Viewer%20One&streamRole=spectator&kitInstanceId=kit_local_001_spectator_02&signalingServer=evil.example"
      )
      .redirects(0);

    expect(response.status).toBe(302);
    const location = response.headers.location as string;
    expect(location).toContain("userId=viewer_001");
    expect(location).toContain("displayName=Viewer+One");
    expect(location).toContain("streamRole=spectator");
    expect(location).toContain("kitInstanceId=kit_local_001_spectator_02");
    expect(location).not.toContain("signalingServer=");
    expect(location).not.toContain("evil.example");
  });

  it("preserves configured path prefixes in /ui/open redirects", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "https://review.example.test/coordinator",
      viewerPublicBaseUrl: "https://review.example.test/bim-viewer",
      publicHost: "review.example.test",
    });

    const response = await request(app.app).get("/ui/open?session=review_session_test_001").redirects(0);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("https://review.example.test/bim-viewer/");
    expect(response.headers.location).toContain("coordinatorApiBase=https%3A%2F%2Freview.example.test%2Fcoordinator");
  });


  it("runtime status exposes browser-visible viewer and coordinator bases", async () => {
    const app = makeApp({
      coordinatorPublicBaseUrl: "http://192.168.10.105:8004",
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
      publicHost: "192.168.10.105",
    });

    const status = await request(app.app).get("/api/runtime/status");

    expect(status.status).toBe(200);
    expect(status.body.configured_endpoints.coordinator.public_base_url).toBe("http://192.168.10.105:8004");
    expect(status.body.configured_endpoints.viewer.browser_url_base).toBe("http://192.168.10.105:5173");
    expect(status.body.configured_endpoints.viewer.coordinator_api_base).toBe("http://192.168.10.105:8004");
    expect(status.body.configured_endpoints.viewer.coordinator_socket_url).toBe("http://192.168.10.105:8004");
  });

  it("rejects invalid viewer session ids before redirecting", async () => {
    const app = makeApp({
      viewerPublicBaseUrl: "http://192.168.10.105:5173",
    });

    const response = await request(app.app).get("/ui/open?session=http://evil.example").redirects(0);

    expect(response.status).toBe(400);
    expect(response.body.detail).toBe("invalid session id");
  });

  // coordinator-ui-tri-ready-and-queue:Edge BIM Data Server Console 區段
  it("exposes Edge BIM Data Server Console tri-ready + dispatch queue + step rename", async () => {
    const app = makeApp();
    const ui = await request(app.app).get("/ui");
    expect(ui.status).toBe(200);

    // Edge Console section + step rename(4 個 step header literal)
    expect(ui.text).toContain("Edge BIM Data Server Console");
    expect(ui.text).toContain("① 接收 IFC-ready webhook");
    expect(ui.text).toContain("② 產生本機 USDC 資料包");
    expect(ui.text).toContain("③ 啟動 Kit / WebRTC 串流");
    expect(ui.text).toContain("④ 驗證 BIM 語意對照");

    // 三段 ready data-testid + dispatch queue section + legacy disclaimer
    expect(ui.text).toContain('data-testid="tri-ready-badges"');
    expect(ui.text).toContain('data-testid="dispatch-queue-section"');
    expect(ui.text).toContain('data-testid="legacy-assets-disclaimer"');

    // inline JS:tri-ready compute functions + C1 / C4 field 引用
    expect(ui.text).toContain("function computeFileReady");
    expect(ui.text).toContain("function computeRuntimeReady");
    expect(ui.text).toContain("function computeSemanticReady");
    expect(ui.text).toContain("semantic_mapping_fidelity");
    expect(ui.text).toContain("mapping_has_ifc_type");
    expect(ui.text).toContain("mapping_has_ifc_name");
    expect(ui.text).toContain("queued_for_conversion");
    expect(ui.text).toContain("dropped_on_restart");

    // legacy disclaimer 文案
    expect(ui.text).toContain("不代表 當前 session model");
  });

  it("serves the dev console script", async () => {
    const app = makeApp();

    const response = await request(app.app).get("/dev-console-assets/dev-console.js");

    expect(response.status).toBe(200);
    expect(response.text).toContain("joinSession");
    expect(response.text).toContain("bim_review_primary_viewer");
    expect(response.text).toContain("/ui/open?");
    expect(response.text).toContain("userId");
    expect(response.text).toContain("displayName");
    expect(response.text).not.toContain("http://127.0.0.1:5173/?");
  });

  it("proxies dev mock conversion requests to the conversion service", async () => {
    let receivedBody = "";
    let receivedMethod = "";
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedMethod = req.method || "";
      receivedUrl = req.url || "";
      req.on("data", (chunk) => {
        receivedBody += chunk.toString("utf8");
      });
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ job_id: "conv_dev_mock_001", status: "succeeded", mock: true }));
      });
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app)
      .post("/api/dev/conversions/mock")
      .send({ project_id: "project_demo_001", model_version_id: "version_demo_001" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ job_id: "conv_dev_mock_001", status: "succeeded", mock: true });
    expect(receivedMethod).toBe("POST");
    expect(receivedUrl).toBe("/api/dev/mock-conversion-result");
    expect(JSON.parse(receivedBody).project_id).toBe("project_demo_001");
  });

  it("proxies dev real conversion requests to the host-native conversion endpoint", async () => {
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedUrl = req.url || "";
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_dev_001", status: "queued" }));
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app)
      .post("/api/dev/conversions")
      .send({ event_type: "ifc_ready", ifc_artifact: { artifact_id: "ifc_1", format: "ifc", url: "edge-local://storage/model.ifc" } });

    expect(response.status).toBe(202);
    expect(response.body.conversion_job_id).toBe("stream_conv_dev_001");
    expect(receivedUrl).toBe("/api/conversions/ifc-to-usdc");
  });

  it("proxies dev conversion list queries to the host-native conversion endpoint", async () => {
    let receivedUrl = "";
    activeConversionServer = http.createServer((req, res) => {
      receivedUrl = req.url || "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          count: 2,
          items: [
            { conversion_job_id: "stream_conv_dev_002", model_version_id: "version_demo_001", ready: true },
            { conversion_job_id: "stream_conv_dev_001", model_version_id: "version_demo_001", ready: true },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) => {
      activeConversionServer?.listen(0, "127.0.0.1", () => resolve());
    });
    const address = activeConversionServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected conversion test server to listen on a TCP port.");
    }
    const app = makeApp();
    app.config.conversionApiBase = `http://127.0.0.1:${address.port}`;

    const response = await request(app.app).get("/api/dev/conversions?model_version_id=version_demo_001&status=succeeded&ready=true");

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
    expect(receivedUrl).toBe("/api/conversions?model_version_id=version_demo_001&status=succeeded&ready=true");
  });
});
