// Live-shape check for kit-message-probe stats. Empty `{}` is the #671
// signature: Runtime.evaluate with replMode:true silently wins over
// awaitPromise:true, so the still-pending Promise serialises as {}.

const REPL_MODE_HINT =
  "statsBefore.pcs must be a non-empty array. Empty {} / missing pcs usually means Runtime.evaluate ran with replMode:true, which silently wins over awaitPromise:true (issue #671). Keep replMode:false.";

export function statsHealth(statsBefore) {
  const pcs = statsBefore && Array.isArray(statsBefore.pcs) ? statsBefore.pcs : null;
  if (pcs && pcs.length > 0) {
    return { ok: true, pcsCount: pcs.length };
  }
  return {
    ok: false,
    pcsCount: pcs ? pcs.length : 0,
    reason: REPL_MODE_HINT,
  };
}

export function assertStatsShape(statsBefore) {
  const health = statsHealth(statsBefore);
  if (!health.ok) {
    throw new Error(health.reason);
  }
  return health;
}

export function recordStatsBefore(result, statsBefore) {
  result.statsBefore = statsBefore;
  result.statsHealth = statsHealth(statsBefore);
  assertStatsShape(statsBefore);
  return result.statsHealth;
}
