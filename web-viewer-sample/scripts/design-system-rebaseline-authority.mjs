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
