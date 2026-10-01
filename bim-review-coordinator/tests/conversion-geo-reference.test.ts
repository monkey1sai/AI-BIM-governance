import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import { buildGeoReferenceSummary } from "../src/services/geoReferenceSummary.js";

const job = "stream_conv_geo_test";
const geo = { conversion_job_id: job, available: false, true_north_degrees: 15,
  true_north_source: "IfcGeometricRepresentationContext.TrueNorth", grid_north_degrees: null, warnings: [] };
let active: CoordinatorApp | undefined, stub: http.Server | undefined, root: string | undefined;
afterEach(async () => {
  active?.io.close();
  if (stub) await new Promise<void>(resolve => stub!.close(() => resolve()));
  if (root) fs.rmSync(root, { recursive: true, force: true });
  active = undefined; stub = undefined; root = undefined; vi.restoreAllMocks();
});
async function route(payload: unknown, status = 200) {
  stub = http.createServer((req, res) => {
    expect(req.url).toBe(`/api/conversions/${job}/geo-reference`);
    res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => stub!.listen(0, "127.0.0.1", resolve));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cfd-geo-test-"));
  active = createCoordinatorApp({ sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback.json"),
    streamingConversionApiBase: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, corsOrigins: [] });
  return request(active.app).get(`/api/conversions/${job}/geo-reference`);
}
describe("conversion north metadata", () => {
  it("allows reliable IFC north independently of map-conversion availability and strips location", async () => {
    const res = await route({ ...geo, site: { latitude: 1 }, path: "private/path" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ conversion_job_id: job, available: false,
      true_north: { degrees: 15, source: geo.true_north_source, status: "reliable" }, grid_north_degrees: null });
  });
  it.each([
    [{ ...geo, true_north_degrees: 0 }, "default_direction"],
    [{ ...geo, warnings: ["true_north_default_direction"] }, "default_direction"],
    [{ ...geo, true_north_degrees: null }, "missing"],
    [{ ...geo, true_north_source: "manual" }, "missing"],
    [{ ...geo, warnings: ["geo_lookup_failed"] }, "missing"],
  ])("classifies unreliable source without claiming true north", (value, status) => {
    expect(buildGeoReferenceSummary(job, value).true_north.status).toBe(status);
  });
  it("rejects a reply for another conversion", async () => {
    expect(buildGeoReferenceSummary(job, { ...geo, true_north_degrees: -15 }).true_north)
      .toMatchObject({ degrees: 345, status: "reliable" });
    expect((await route({ ...geo, conversion_job_id: "other" })).status).toBe(502);
  });
  it.each([404, 502])("maps upstream %i without disclosing upstream data", async status => {
    const res = await route({ secret: "must_not_escape" }, status);
    expect(res.status).toBe(status); expect(JSON.stringify(res.body)).not.toContain("must_not_escape");
  });
  it("reports timeout as 503", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timeout", "TimeoutError")));
    expect((await route(geo)).status).toBe(503);
  });
  it("rejects unsafe identifiers before reaching upstream", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cfd-geo-test-"));
    active = createCoordinatorApp({ sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
      callbackOutboxStorePath: path.join(root, "callback.json"), streamingConversionApiBase: "http://127.0.0.1:1" });
    expect((await request(active.app).get("/api/conversions/bad%20id/geo-reference")).status).toBe(400);
  });
});
