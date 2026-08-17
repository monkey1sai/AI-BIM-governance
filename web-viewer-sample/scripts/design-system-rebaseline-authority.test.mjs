import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  planOriginRebaseline,
  runGuardedOriginRebaseline,
  verifyPreservedBaselineIntegrity,
} from "./design-system-rebaseline-authority.mjs";

describe("design-system origin rebaseline authority", () => {
  it("preserves canonical product-surface baselines while selecting origin-authority screens", () => {
    const legacyOrigin = {
      id: "workspace.home.default",
      baselines: { desktop: { sha256: "legacy-origin" } },
    };
    const explicitOrigin = {
      id: "workspace.issue.default",
      baseline_provenance: { authority: "authoring_origin" },
      baselines: { desktop: { sha256: "explicit-origin" } },
    };
    const canonicalProduct = {
      id: "workspace.a4.default",
      baseline_provenance: { authority: "canonical_product_surface" },
      baselines: { desktop: { sha256: "human-approved-product" } },
    };

    const plan = planOriginRebaseline([
      legacyOrigin,
      canonicalProduct,
      explicitOrigin,
    ]);

    expect(plan.captureScreens.map((screen) => screen.id)).toEqual([
      "workspace.home.default",
      "workspace.issue.default",
    ]);
    expect(plan.preservedScreens.map((screen) => screen.id)).toEqual([
      "workspace.a4.default",
    ]);

    for (const screen of plan.captureScreens) {
      screen.baselines.desktop.sha256 = "new-origin-capture";
    }
    expect(canonicalProduct.baselines.desktop.sha256).toBe(
      "human-approved-product",
    );
  });

  it.each([
    [{ authority: "future_product_surface" }, "future_product_surface"],
    [{}, "missing"],
  ])("fails closed for unsupported explicit provenance %j", (provenance, label) => {
    expect(() =>
      planOriginRebaseline([
        {
          id: `workspace.${label}.default`,
          baseline_provenance: provenance,
          baselines: {},
        },
      ]),
    ).toThrow(/Unsupported baseline provenance authority/);
  });

  it("routes the pinned A4 product baseline to preservation in the real manifest", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.resolve(
          process.cwd(),
          "..",
          "docs",
          "plans",
          "design-system-reference.manifest.json",
        ),
        "utf8",
      ),
    );
    const plan = planOriginRebaseline(manifest.screens);
    const capturedIds = plan.captureScreens.map((screen) => screen.id);
    const preservedIds = plan.preservedScreens.map((screen) => screen.id);

    expect(preservedIds).toContain("workspace.a4.default");
    expect(capturedIds).not.toContain("workspace.a4.default");
    expect(capturedIds.length + preservedIds.length).toBe(
      manifest.screens.length,
    );
  });

  it("fails closed when a preserved product baseline no longer matches its pinned digest", async () => {
    const preservedScreen = {
      id: "workspace.a4.default",
      baselines: {
        desktop: {
          path: "docs/plans/design-system-baseline/workspace.a4.default/desktop.png",
          sha256: "approved-product-digest",
        },
      },
    };

    await expect(
      verifyPreservedBaselineIntegrity(
        [preservedScreen],
        ["desktop"],
        async () => "corrupted-product-digest",
      ),
    ).rejects.toThrow(/Preserved baseline hash mismatch/);
  });

  it("checks every pinned viewport before origin capture may proceed", async () => {
    const reads = [];
    const preservedScreen = {
      id: "workspace.a4.default",
      baselines: {
        desktop: { path: "desktop.png", sha256: "desktop-digest" },
        wide: { path: "wide.png", sha256: "wide-digest" },
      },
    };

    await verifyPreservedBaselineIntegrity(
      [preservedScreen],
      ["desktop", "wide"],
      async (baselinePath) => {
        reads.push(baselinePath);
        return baselinePath === "desktop.png" ? "desktop-digest" : "wide-digest";
      },
    );

    expect(reads).toEqual(["desktop.png", "wide.png"]);
  });

  it("prevents screenshot and manifest writes when preserved integrity fails", async () => {
    const writes = [];

    await expect(
      runGuardedOriginRebaseline({
        preservedScreens: [
          {
            id: "workspace.a4.default",
            baselines: {
              desktop: {
                path: "desktop.png",
                sha256: "approved-product-digest",
              },
            },
          },
        ],
        viewportIds: ["desktop"],
        readDigest: async () => "corrupted-product-digest",
        captureBaselines: async () => {
          writes.push("screenshot");
        },
        commitManifest: async () => {
          writes.push("manifest");
        },
      }),
    ).rejects.toThrow(/Preserved baseline hash mismatch/);

    expect(writes).toEqual([]);
  });

  it("runs the preserved digest guard through the production entrypoint before browser or writes", async () => {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "ai-bim-design-rebaseline-"),
    );
    try {
      const sourceScriptDir = path.dirname(fileURLToPath(import.meta.url));
      const fixtureScriptDir = path.join(
        tempRoot,
        "web-viewer-sample",
        "scripts",
      );
      const fixtureManifestPath = path.join(
        tempRoot,
        "docs",
        "plans",
        "design-system-reference.manifest.json",
      );
      const sourceRoot = path.join(tempRoot, "authoring-origin");
      const productBaselinePath = path.join(
        tempRoot,
        "docs",
        "plans",
        "design-system-baseline",
        "workspace.a4.default",
        "desktop.png",
      );
      const originBaselinePath = path.join(
        tempRoot,
        "docs",
        "plans",
        "design-system-baseline",
        "workspace.home.default",
        "desktop.png",
      );
      await Promise.all([
        mkdir(fixtureScriptDir, { recursive: true }),
        mkdir(path.dirname(fixtureManifestPath), { recursive: true }),
        mkdir(sourceRoot, { recursive: true }),
        mkdir(path.dirname(productBaselinePath), { recursive: true }),
        mkdir(path.dirname(originBaselinePath), { recursive: true }),
      ]);
      await Promise.all([
        copyFile(
          path.join(sourceScriptDir, "capture-design-system-reference.mjs"),
          path.join(fixtureScriptDir, "capture-design-system-reference.mjs"),
        ),
        copyFile(
          path.join(sourceScriptDir, "design-system-rebaseline-authority.mjs"),
          path.join(fixtureScriptDir, "design-system-rebaseline-authority.mjs"),
        ),
        writeFile(path.join(sourceRoot, "index.html"), "fixture source", "utf8"),
        writeFile(productBaselinePath, "approved product baseline", "utf8"),
        writeFile(originBaselinePath, "unchanged origin baseline", "utf8"),
      ]);

      const originDigest = createHash("sha256")
        .update("unchanged origin baseline")
        .digest("hex");
      const manifest = {
        authority: { authoring_origin: sourceRoot },
        source: { files: [], snapshot_sha256: "", captured_at_utc: null },
        fidelity_contract: {
          platform: process.platform === "win32" ? "windows" : process.platform,
          device_scale_factor: 1,
          playwright_version: "not-loaded",
          chromium_revision: "not-loaded",
          chromium_version: "not-loaded",
          viewports: [{ id: "desktop", width: 100, height: 100 }],
        },
        screens: [
          {
            id: "workspace.home.default",
            baseline_provenance: { authority: "authoring_origin" },
            baselines: {
              desktop: {
                path: "docs/plans/design-system-baseline/workspace.home.default/desktop.png",
                sha256: originDigest,
              },
            },
          },
          {
            id: "workspace.a4.default",
            baseline_provenance: { authority: "canonical_product_surface" },
            baselines: {
              desktop: {
                path: "docs/plans/design-system-baseline/workspace.a4.default/desktop.png",
                sha256: "0".repeat(64),
              },
            },
          },
        ],
      };
      await writeFile(
        fixtureManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      const [manifestBefore, productBefore, originBefore] = await Promise.all([
        readFile(fixtureManifestPath),
        readFile(productBaselinePath),
        readFile(originBaselinePath),
      ]);

      const result = spawnSync(
        process.execPath,
        [
          path.join(fixtureScriptDir, "capture-design-system-reference.mjs"),
          "--rebaseline",
          "--confirm-rebaseline",
        ],
        {
          cwd: path.join(tempRoot, "web-viewer-sample"),
          env: {
            ...process.env,
            DESIGN_SYSTEM_REFERENCE_ROOT: sourceRoot,
            PLAYWRIGHT_MODULE_ROOT: "",
          },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(output).toMatch(/Preserved baseline hash mismatch/);
      expect(output).not.toMatch(/Cannot find package ['"]@playwright\/test/);
      const [manifestAfter, productAfter, originAfter] = await Promise.all([
        readFile(fixtureManifestPath),
        readFile(productBaselinePath),
        readFile(originBaselinePath),
      ]);
      expect(manifestAfter).toEqual(manifestBefore);
      expect(productAfter).toEqual(productBefore);
      expect(originAfter).toEqual(originBefore);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
