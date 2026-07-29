// Harness 啟用判定（誠實、可稽核）。
// - 所有 build/dev server：必須同時顯式設定 VITE_VIEWER_HARNESS=1 與 ?harness=1。
// - production/deploy 未設定該 env flag，query 本身永遠無法啟用 fake runtime。
// - E2E runner 只在其 owned loopback Vite process 設定該 flag。
// Keep every import.meta.env access static. A bare/dynamic env object causes
// Vite to serialize every externally supplied VITE_* value into the bundle.

function buildFlagEnabled(): boolean {
  const flag = import.meta.env.VITE_VIEWER_HARNESS;
  return flag === "1" || flag === "true";
}

function harnessQueryEnabled(): boolean {
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
  return resolveHarnessEnabled(buildFlagEnabled(), import.meta.env.DEV, harnessQueryEnabled());
}

// Controlled browser evidence needs the embedded harness to exercise the
// production-shaped late-authority gate. This seam is dev-query-only and is
// inert unless the deterministic harness itself is already enabled.
export function harnessAuthorityRequired(): boolean {
  return resolveHarnessAuthorityRequired(harnessEnabled(), import.meta.env.DEV, devAuthorityQueryEnabled());
}

export function resolveHarnessEnabled(
  buildFlag: boolean,
  _devMode: boolean,
  queryFlag: boolean,
): boolean {
  return buildFlag && queryFlag;
}

export function resolveHarnessAuthorityRequired(
  enabled: boolean,
  devMode: boolean,
  queryFlag: boolean,
): boolean {
  return enabled && devMode && queryFlag;
}
