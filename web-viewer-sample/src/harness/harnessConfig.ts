// Harness 啟用判定（誠實、可稽核）。
// - production build：DEV=false 且未設 VITE_VIEWER_HARNESS → 永遠關閉（?harness=1 無效，避免假串流誤入正式）。
// - E2E build：以 VITE_VIEWER_HARNESS=1 build/run → 啟用。
// - 本機 dev：vite dev（DEV=true）下 ?harness=1 啟用，方便手動觀察。
function viteEnv(): Record<string, unknown> | null {
  try {
    // import.meta.env 在 vite / vitest 下可用；其他 runtime 包 try/catch 防爆。
    return (import.meta as unknown as { env?: Record<string, unknown> }).env ?? null;
  } catch {
    return null;
  }
}

function buildFlagEnabled(): boolean {
  const env = viteEnv();
  if (!env) return false;
  const flag = env.VITE_VIEWER_HARNESS;
  return flag === "1" || flag === "true";
}

function devQueryEnabled(): boolean {
  const env = viteEnv();
  if (!env || env.DEV !== true) return false;
  if (typeof window === "undefined" || !window.location) return false;
  const value = new URLSearchParams(window.location.search).get("harness");
  return value === "1" || value === "true";
}

export function harnessEnabled(): boolean {
  return buildFlagEnabled() || devQueryEnabled();
}
