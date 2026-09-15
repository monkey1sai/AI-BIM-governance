import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadIfcToSharedVolume } from "../src/services/ifcDownloader.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
describe("confirmed IFC download", () => {
  it.each(["old", "new", null])("checks the response ETag (%s) even if a server ignores If-Match", async etag => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reconvert-source-")); roots.push(storageRoot);
    const fetchImpl = vi.fn(async () => new Response("IFC", { headers: etag ? { etag: `"${etag}"` } : {} }));
    const result = await downloadIfcToSharedVolume("http://fixture.test/source.ifc", "job_test", {
      storageRoot, expectedHttpEtag: "old", fetchImpl: fetchImpl as typeof fetch, fallbackOnFetchError: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { "If-Match": '"old"' } }));
    expect(result.ok).toBe(etag === "old");
    expect(fs.existsSync(path.join(storageRoot, "ifc-cache/job_test/source.ifc"))).toBe(etag === "old");
  });
  it("never turns a conditional GET failure into placeholder success", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reconvert-source-")); roots.push(storageRoot);
    const result = await downloadIfcToSharedVolume("http://fixture.test/source.ifc", "job_test", {
      storageRoot, expectedHttpEtag: "old", fetchImpl: (async () => new Response(null, { status: 412 })) as typeof fetch,
      fallbackOnFetchError: true,
    });
    expect(result).toMatchObject({ ok: false, http_status: 412 });
  });
});
