// Harness 啟用判定（誠實、可稽核）。
// - production build：DEV=false 且未設 VITE_VIEWER_HARNESS → 永遠關閉（?harness=1 無效，避免假串流誤入正式）。
// - E2E build：以 VITE_VIEWER_HARNESS=1 build/run → 啟用。
// - 本機 dev：vite dev（DEV=true）下 ?harness=1 啟用，方便手動觀察。
// Keep every import.meta.env access static. A bare/dynamic env object causes
// Vite to serialize every externally supplied VITE_* value into the bundle.

function buildFlagEnabled(): boolean {
  const flag = import.meta.env.VITE_VIEWER_HARNESS;
  return flag === "1" || flag === "true";
}

function devQueryEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined" || !window.location) return false;
  const value = new URLSearchParams(window.location.search).get("harness");
  return value === "1" || value === "true";
}

function devAuthorityQueryEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined" || !window.location) return false;
  const value = new URLSearchParams(window.location.search).get("harnessAuthority");
  return value === "1" || value === "true";
}

export function harnessEnabled(): boolean {
  return resolveHarnessEnabled(buildFlagEnabled(), import.meta.env.DEV, devQueryEnabled());
}

// Controlled browser evidence needs the embedded harness to exercise the
// production-shaped late-authority gate. This seam is dev-query-only and is
// inert unless the deterministic harness itself is already enabled.
export function harnessAuthorityRequired(): boolean {
  return resolveHarnessAuthorityRequired(harnessEnabled(), import.meta.env.DEV, devAuthorityQueryEnabled());
}

export function resolveHarnessEnabled(
  buildFlag: boolean,
  devMode: boolean,
  queryFlag: boolean,
): boolean {
  return buildFlag || (devMode && queryFlag);
}

export function resolveHarnessAuthorityRequired(
  enabled: boolean,
  devMode: boolean,
  queryFlag: boolean,
): boolean {
  return enabled && devMode && queryFlag;
}
