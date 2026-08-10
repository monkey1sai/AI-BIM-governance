import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { type AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";

// A1/A2 governance file-library 邏輯識別路由（純加性）：
//   POST /api/governance-library/rule-runs  {project_id, model_id, version_name, ids_path?, model_version_id?}
//   POST /api/governance-library/diffs      {base:{三段}, target:{三段}, include_geometry?, *_model_version_id?}
// 根因回歸鎖：/api/governance/files/tree 對瀏覽器遮蔽 version.path 為 "[server-path]"，
// 瀏覽器不可能回送真路徑；coordinator 必須 server-side 直打 governance /api/files/tree
// 解析真路徑（不經遮蔽），轉發後回應再以 proxy 同語意遮蔽絕對路徑。
// 誠實語意：version 不存在=404 {error:"library_version_not_found"}、governance 不可達=502、
// zod 解析失敗=400（全域 error handler）。

const BASE_PATH = "C:\\srv\\storage\\270\\機電\\ver 000001.ifc";
const TARGET_PATH = "C:\\srv\\storage\\270\\機電\\ver 竣工.ifc";
const NESTED_PATH = "C:\\srv\\storage\\松風庵\\建築\\v1\\japanese_villa.ifc";

// 真實 governance /api/files/tree 形狀（2026-07-16 對分支 governance :49103 實測）：
// {root, source_kind, projects:[{project_id, models:[{model_id, versions:[{name, path, size_bytes, mtime}]}]}]}
const LIBRARY_TREE = {
  root: "C:\\srv\\storage",
  source_kind: "local_fs",
  projects: [
    {
      project_id: "270",
      models: [
        {
          model_id: "機電",
          versions: [
            { name: "ver 000001.ifc", path: BASE_PATH, size_bytes: 111, mtime: "2026-07-16T10:00:00+08:00" },
            { name: "ver 竣工.ifc", path: TARGET_PATH, size_bytes: 222, mtime: "2026-07-16T11:00:00+08:00" },
          ],
        },
      ],
    },
    {
      project_id: "松風庵",
      models: [
        {
          model_id: "建築",
          // 三層 version name（name 帶子目錄段）也要能解析。
          versions: [{ name: "v1/japanese_villa.ifc", path: NESTED_PATH, size_bytes: 333, mtime: "2026-07-16T12:00:00+08:00" }],
        },
      ],
    },
  ],
};

let active: CoordinatorApp | null = null;
let governanceStub: http.Server | null = null;
let savedGovBase: string | undefined;

beforeEach(() => {
  savedGovBase = process.env.GOVERNANCE_API_BASE;
});

afterEach(async () => {
  if (active) {
    active.io.close();
    await new Promise<void>((resolve) => active?.server.close(() => resolve()));
    active = null;
  }
  if (governanceStub) {
    await new Promise<void>((resolve) => governanceStub?.close(() => resolve()));
    governanceStub = null;
  }
  if (savedGovBase === undefined) {
    delete process.env.GOVERNANCE_API_BASE;
  } else {
    process.env.GOVERNANCE_API_BASE = savedGovBase;
  }
});

function makeApp(overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bim-review-coordinator-governance-library-test-"));
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"),
    eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"),
    storageRoot: path.join(root, "storage"),
    storageHostRoot: path.join(root, "storage"),
    corsOrigins: ["http://127.0.0.1:5173"],
    conversionPollEnabled: false,
    ...overrides,
  });
  return active;
}

/**
 * governance-service stub：GET /api/files/tree（真形狀樹）＋ POST /api/rule-runs / /api/diffs
 * （記錄收到的 body 供 assert；回應刻意內嵌絕對路徑，驗證 coordinator 遮蔽後才透傳給瀏覽器）。
 */
async function startGovernanceStub(
  options: {
    ruleRunStatus?: number;
    ruleRunContentType?: string;
    ruleRunBody?: string;
    diffStatus?: number;
    diffContentType?: string;
    diffBody?: string;
  } = {},
): Promise<{
  baseUrl: string;
  urls: string[];
  ruleRunBodies: Array<Record<string, unknown>>;
  diffBodies: Array<Record<string, unknown>>;
}> {
  const urls: string[] = [];
  const ruleRunBodies: Array<Record<string, unknown>> = [];
  const diffBodies: Array<Record<string, unknown>> = [];
  governanceStub = http.createServer((req, res) => {
    const url = req.url ?? "/";
    urls.push(`${req.method ?? "GET"} ${url}`);
    if (req.method === "GET" && url === "/api/files/tree") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(LIBRARY_TREE));
      return;
    }
    if (req.method === "POST" && (url === "/api/rule-runs" || url === "/api/diffs")) {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        if (url === "/api/rule-runs") {
          ruleRunBodies.push(body);
          res.writeHead(
            options.ruleRunStatus ?? 200,
            { "Content-Type": options.ruleRunContentType ?? "application/json" },
          );
          // governance 回應會回顯絕對路徑——coordinator 必須遮蔽後才給瀏覽器。
          res.end(options.ruleRunBody
            ?? JSON.stringify({ rule_run_id: "rr_lib_001", status: "queued", ifc_source_path: body.ifc_source_path }));
        } else {
          diffBodies.push(body);
          res.writeHead(
            options.diffStatus ?? 200,
            { "Content-Type": options.diffContentType ?? "application/json" },
          );
          res.end(options.diffBody
            ?? JSON.stringify({ diff_id: "diff_lib_001", status: "queued", base_ifc_path: body.base_ifc_path }));
        }
      });
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });

  await new Promise<void>((resolve) => governanceStub?.listen(0, "127.0.0.1", () => resolve()));
  const address = governanceStub.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, urls, ruleRunBodies, diffBodies };
}

describe("POST /api/governance-library/rule-runs", () => {
  it("成功：server-side 解析真路徑轉發 governance；瀏覽器回應被遮蔽（零絕對路徑）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({
        project_id: "270",
        model_id: "機電",
        version_name: "ver 000001.ifc",
        ids_path: "rules/sample-fire-rating.ids",
        model_version_id: "270/機電/ver 000001.ifc",
      });

    expect(res.status).toBe(200);
    expect(res.body.rule_run_id).toBe("rr_lib_001");
    // coordinator 先查 tree 再轉發 rule-run。
    expect(gov.urls).toEqual(["GET /api/files/tree", "POST /api/rule-runs"]);
    // governance 收到的是真路徑 + 透傳欄位。
    expect(gov.ruleRunBodies).toHaveLength(1);
    expect(gov.ruleRunBodies[0]).toEqual({
      ifc_source_path: BASE_PATH,
      ids_path: "rules/sample-fire-rating.ids",
      model_version_id: "270/機電/ver 000001.ifc",
    });
    // 瀏覽器回應零絕對路徑（proxy 同語意遮蔽）。
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/[A-Za-z]:[\\/]/); // 無任何 drive-letter 絕對路徑外洩
    expect(raw).toContain("[server-path]");
  });

  it.each([202, 400, 404, 500])(
    "透傳 upstream %i/custom content-type/opaque text，且先遮蔽 Windows/POSIX 路徑",
    async (status) => {
      const upstreamBody = "windows=\"" + BASE_PATH + "\" posix=\"/var/data/model.ifc\"";
      const gov = await startGovernanceStub({
        ruleRunStatus: status,
        ruleRunContentType: "text/plain",
        ruleRunBody: upstreamBody,
      });
      process.env.GOVERNANCE_API_BASE = gov.baseUrl;
      const app = makeApp();

      const res = await request(app.app)
        .post("/api/governance-library/rule-runs")
        .send({ project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" });

      expect(res.status).toBe(status);
      expect(res.headers["content-type"]).toMatch(/^text\/plain/);
      expect(res.text).toBe("windows=\"[server-path]\" posix=\"[server-path]\"");
    },
  );

  it("三層 version name（v1/japanese_villa.ifc）也可解析", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({ project_id: "松風庵", model_id: "建築", version_name: "v1/japanese_villa.ifc" });

    expect(res.status).toBe(200);
    expect(gov.ruleRunBodies[0]).toEqual({ ifc_source_path: NESTED_PATH });
  });

  it("version 不存在 → 404 {error:'library_version_not_found'}，不打 rule-runs", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({ project_id: "270", model_id: "機電", version_name: "no-such-version.ifc" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "library_version_not_found" });
    expect(gov.urls).toEqual(["GET /api/files/tree"]);
  });

  it("governance 不可達 → 502 {error:'governance_unreachable'}", async () => {
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({ project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "governance_unreachable" });
  });

  it("body 缺 version_name → 400（zod），不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({ project_id: "270", model_id: "機電" });

    expect(res.status).toBe(400);
    expect(gov.urls).toHaveLength(0);
  });

  it("ids_path 穿越（../../etc）→ 400 invalid_ids_path，不打 governance（與 proxy 白名單同語意）", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/rule-runs")
      .send({ project_id: "270", model_id: "機電", version_name: "ver 000001.ifc", ids_path: "../../etc/x.ids" });

    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe("invalid_ids_path");
    expect(gov.urls).toHaveLength(0);
  });
});

describe("POST /api/governance-library/diffs", () => {
  it("成功：base/target 雙路徑解析轉發 /api/diffs；tree 只查一次；瀏覽器回應被遮蔽", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/diffs")
      .send({
        base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
        target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
        include_geometry: true,
        base_model_version_id: "270/機電/ver 000001.ifc",
        target_model_version_id: "270/機電/ver 竣工.ifc",
      });

    expect(res.status).toBe(200);
    expect(res.body.diff_id).toBe("diff_lib_001");
    expect(gov.urls).toEqual(["GET /api/files/tree", "POST /api/diffs"]);
    expect(gov.diffBodies).toHaveLength(1);
    expect(gov.diffBodies[0]).toEqual({
      base_ifc_path: BASE_PATH,
      target_ifc_path: TARGET_PATH,
      include_geometry: true,
      base_model_version_id: "270/機電/ver 000001.ifc",
      target_model_version_id: "270/機電/ver 竣工.ifc",
    });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/[A-Za-z]:[\\/]/); // 無任何 drive-letter 絕對路徑外洩
    expect(raw).toContain("[server-path]");
  });

  it.each([202, 400, 404, 500])(
    "透傳 upstream %i/custom content-type/opaque text，且先遮蔽 Windows/POSIX 路徑",
    async (status) => {
      const gov = await startGovernanceStub({
        diffStatus: status,
        diffContentType: "text/plain",
        diffBody: `windows=\"${BASE_PATH}\" posix=\"/var/data/model.ifc\"`,
      });
      process.env.GOVERNANCE_API_BASE = gov.baseUrl;
      const app = makeApp();

      const res = await request(app.app)
        .post("/api/governance-library/diffs")
        .send({
          base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
          target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
        });

      expect(res.status).toBe(status);
      expect(res.headers["content-type"]).toMatch(/^text\/plain/);
      expect(res.text).toBe("windows=\"[server-path]\" posix=\"[server-path]\"");
    },
  );

  it.each([
    {
      label: "omits every optional field",
      optional: {},
      expected: {},
    },
    {
      label: "preserves false and exact model version IDs",
      optional: {
        include_geometry: false,
        base_model_version_id: "base-id",
        target_model_version_id: "target-id",
      },
      expected: {
        include_geometry: false,
        base_model_version_id: "base-id",
        target_model_version_id: "target-id",
      },
    },
  ])("$label", async ({ optional, expected }) => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/diffs")
      .send({
        base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
        target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
        ...optional,
      });

    expect(res.status).toBe(200);
    expect(gov.diffBodies).toEqual([{
      base_ifc_path: BASE_PATH,
      target_ifc_path: TARGET_PATH,
      ...expected,
    }]);
  });

  it.each(["base", "target"] as const)(
    "%s version 不存在 → 404 {error:'library_version_not_found'}，不打 diffs",
    async (missingSide) => {
      const gov = await startGovernanceStub();
      process.env.GOVERNANCE_API_BASE = gov.baseUrl;
      const app = makeApp();

      const res = await request(app.app)
        .post("/api/governance-library/diffs")
        .send({
          base: {
            project_id: "270",
            model_id: "機電",
            version_name: missingSide === "base" ? "no-such.ifc" : "ver 000001.ifc",
          },
          target: {
            project_id: "270",
            model_id: "機電",
            version_name: missingSide === "target" ? "no-such.ifc" : "ver 竣工.ifc",
          },
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "library_version_not_found" });
      expect(gov.urls).toEqual(["GET /api/files/tree"]);
    },
  );

  it("governance 不可達 → 502 {error:'governance_unreachable'}", async () => {
    process.env.GOVERNANCE_API_BASE = "http://127.0.0.1:1";
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/diffs")
      .send({
        base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" },
        target: { project_id: "270", model_id: "機電", version_name: "ver 竣工.ifc" },
      });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "governance_unreachable" });
  });

  it("body 缺 target → 400（zod），不打 governance", async () => {
    const gov = await startGovernanceStub();
    process.env.GOVERNANCE_API_BASE = gov.baseUrl;
    const app = makeApp();

    const res = await request(app.app)
      .post("/api/governance-library/diffs")
      .send({ base: { project_id: "270", model_id: "機電", version_name: "ver 000001.ifc" } });

    expect(res.status).toBe(400);
    expect(gov.urls).toHaveLength(0);
  });
});
