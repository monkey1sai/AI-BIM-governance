/** Decode material evidence without treating legacy selection as material proof. */
export function decodeHighlightResult(payload: Record<string, unknown>) {
  const mode = payload.applied_mode === "material_overlay" ? "material_overlay"
    : payload.applied_mode === "selection" || payload.applied_mode === undefined ? "selection" : "unknown";
  const paths = mode === "material_overlay" ? payload.applied_paths : payload.selected_paths;
  const validPaths = (value: unknown): value is string[] => Array.isArray(value)
    && value.every(path => typeof path === "string" && path.startsWith("/") && path !== "/");
  const missing = payload.missing_paths;
  const unsupported = mode === "material_overlay" ? payload.unsupported_paths : [];
  const fallback = payload.fallback_paths ?? [];
  const valid = mode !== "unknown" && validPaths(paths) && validPaths(missing)
    && validPaths(unsupported) && Array.isArray(fallback);
  return {
    mode, paths: validPaths(paths) ? paths : [],
    missing: validPaths(missing) ? missing : [],
    unsupported: validPaths(unsupported) ? unsupported : [],
    complete: valid && payload.result === "success" && missing.length === 0
      && unsupported.length === 0 && fallback.length === 0,
  };
}
