// GovernanceIssueHttpAdapter (docs/architecture/cfd-run-workflow-adr.md §3) against an in-process governance
// `/api/issues` stand-in: per-call base resolution, the annotation lookup rule, and the error text the finding
// route reports as its `governance_unavailable` detail.
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { GovernanceIssueHttpAdapter, type CfdFindingIssuePayload } from "../src/services/cfdRunWorkflow/index.js";

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

const servers: http.Server[] = [];
afterEach(async () => {
  delete process.env.GOVERNANCE_API_BASE;
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function governance(answer: (seen: Seen) => { status: number; body: unknown }): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString(); });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const entry: Seen = { method: req.method ?? "", path: url.pathname, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : null };
      seen.push(entry);
      const reply = answer(entry);
      const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      res.writeHead(reply.status, { "Content-Type": typeof reply.body === "string" ? "text/plain" : "application/json" });
      res.end(text);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as { port: number };
  return { base: `http://127.0.0.1:${address.port}`, seen };
}

const PAYLOAD: CfdFindingIssuePayload = {
  title: "CFD 風環境 0°：行人面 |U|max 3.58 m/s > 3.4 m/s（screening，設計比較用）",
  description: "fixture",
  severity: "medium",
  usd_prim_path: "/World/Overlays/Cfd/cfd_20260921T070000Z_mem001_w000/PedestrianWind_1p5m",
  model_version_id: "version_001",
};

describe("GovernanceIssueHttpAdapter", () => {
  it("resolves GOVERNANCE_API_BASE on every call and posts the payload unchanged", async () => {
    const first = await governance(() => ({ status: 201, body: { id: "iss_a", kind: "annotation" } }));
    const second = await governance(() => ({ status: 200, body: { id: "iss_b" } }));
    const adapter = new GovernanceIssueHttpAdapter();
    process.env.GOVERNANCE_API_BASE = `${first.base}/`;
    expect(await adapter.createIssue(PAYLOAD)).toEqual({ id: "iss_a", kind: "annotation" });
    process.env.GOVERNANCE_API_BASE = second.base;
    expect(await adapter.createIssue(PAYLOAD)).toEqual({ id: "iss_b", kind: "annotation" });
    expect([first.seen.length, second.seen.length]).toEqual([1, 1]);
    expect(first.seen[0]).toMatchObject({ method: "POST", path: "/api/issues", body: PAYLOAD });
  });

  it("finds an annotation only when prim path, title and model binding all match", async () => {
    const rows = [
      { id: "iss_1", kind: "annotation", title: PAYLOAD.title, usd_prim_path: PAYLOAD.usd_prim_path, model_version_id: "version_other" },
      { id: "iss_2", title: PAYLOAD.title, usd_prim_path: PAYLOAD.usd_prim_path, model_version_id: "version_001" },
    ];
    const stub = await governance(() => ({ status: 200, body: { issues: rows } }));
    process.env.GOVERNANCE_API_BASE = stub.base;
    const adapter = new GovernanceIssueHttpAdapter();
    const query = { title: PAYLOAD.title, usdPrimPath: PAYLOAD.usd_prim_path };
    expect(await adapter.findAnnotation({ ...query, modelVersionId: "version_001" })).toEqual({ id: "iss_2", kind: "annotation" });
    expect(stub.seen[0]).toMatchObject({ method: "GET", path: "/api/issues", query: { kind: "annotation", model_version_id: "version_001" } });
    expect(await adapter.findAnnotation({ ...query, title: "another title", modelVersionId: "version_001" })).toBeNull();
    // An unbound finding matches only rows without a model binding and sends no model filter.
    expect(await adapter.findAnnotation({ ...query, modelVersionId: null })).toBeNull();
    expect(stub.seen[2].query).toEqual({ kind: "annotation" });
  });

  it("says what governance answered when it refuses or replies without an id", async () => {
    const stub = await governance((seen) => {
      if (seen.method === "GET") return { status: 503, body: { detail: "down" } };
      return (seen.body as { title?: string }).title === "no id" ? { status: 201, body: { kind: "annotation" } } : { status: 500, body: "x".repeat(400) };
    });
    process.env.GOVERNANCE_API_BASE = stub.base;
    const adapter = new GovernanceIssueHttpAdapter();
    await expect(adapter.findAnnotation({ title: "t", usdPrimPath: "/p", modelVersionId: null })).rejects.toThrow(/^governance GET \/api\/issues HTTP 503$/);
    await expect(adapter.createIssue(PAYLOAD)).rejects.toThrow(/^governance POST \/api\/issues HTTP 500: x{300}$/);
    await expect(adapter.createIssue({ ...PAYLOAD, title: "no id" })).rejects.toThrow(/^governance issue reply carries no id$/);
  });
});
