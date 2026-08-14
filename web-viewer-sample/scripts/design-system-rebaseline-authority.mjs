const AUTHORING_ORIGIN = "authoring_origin";
const CANONICAL_PRODUCT_SURFACE = "canonical_product_surface";

/**
 * Select only screens whose baseline authority is the approved authoring
 * origin. Legacy screens without a provenance object retain that authority;
 * once provenance is explicit, an unknown or missing authority fails closed.
 */
export function planOriginRebaseline(screens) {
  const captureScreens = [];
  const preservedScreens = [];

  for (const screen of screens) {
    if (!Object.hasOwn(screen, "baseline_provenance")) {
      captureScreens.push(screen);
      continue;
    }

    const authority = screen.baseline_provenance?.authority;
    if (authority === AUTHORING_ORIGIN) {
      captureScreens.push(screen);
      continue;
    }
    if (authority === CANONICAL_PRODUCT_SURFACE) {
      preservedScreens.push(screen);
      continue;
    }

    const authorityLabel =
      typeof authority === "string" && authority.length > 0
        ? authority
        : "missing";
    throw new Error(
      `Unsupported baseline provenance authority '${authorityLabel}' for ${screen.id}.`,
    );
  }

  return { captureScreens, preservedScreens };
}

/**
 * Fail closed when a baseline excluded from origin re-capture no longer
 * matches the digest pinned by its owning product surface.
 */
export async function verifyPreservedBaselineIntegrity(
  preservedScreens,
  viewportIds,
  readDigest,
) {
  for (const screen of preservedScreens) {
    for (const viewportId of viewportIds) {
      const baseline = screen.baselines?.[viewportId];
      if (!baseline) {
        throw new Error(
          `Missing ${viewportId} preserved baseline slot for ${screen.id}.`,
        );
      }
      const digest = await readDigest(baseline.path);
      if (digest !== baseline.sha256) {
        throw new Error(`Preserved baseline hash mismatch: ${baseline.path}`);
      }
    }
  }
}

/**
 * Keep the integrity preflight and both write phases on one testable path.
 * A rejected preflight must prevent both screenshot and manifest writes.
 */
export async function runGuardedOriginRebaseline({
  preservedScreens,
  viewportIds,
  readDigest,
  captureBaselines,
  commitManifest,
}) {
  await verifyPreservedBaselineIntegrity(
    preservedScreens,
    viewportIds,
    readDigest,
  );
  const captureResult = await captureBaselines();
  await commitManifest();
  return captureResult;
}
