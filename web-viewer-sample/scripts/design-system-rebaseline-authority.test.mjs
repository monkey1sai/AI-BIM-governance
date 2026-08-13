import { readFile } from "node:fs/promises";
import path from "node:path";
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
});
