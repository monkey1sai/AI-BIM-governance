// web-viewer-sample/src/console/handoff.ts
// Generic cross-axis handoff (frontend-only). Carries non-secret correlation IDs in the URL hash query;
// the receiving page must re-verify each ID against its authoritative endpoint (spec §4.2). Never carry a
// lease token, auth header, or any secret in this payload.

// "a3" 為 A3-G1（federation→session 一鍵鏈）新增的發射端身分：#federation 頁建立 review session 後
// 以 source="a3" 發 #sessions chip；接收端（SessionManagementPage useIncomingHandoff("sessions")）向
// runtime/status 重驗 session id。純加性——不進 SharedStatusRail 七軸列，也不改任何既有 selfAxis。
export type AxisKey = "a1" | "conv" | "sessions" | "instances" | "minio" | "intake" | "runtime" | "a3";

const AXIS_KEYS: readonly AxisKey[] = ["a1", "conv", "sessions", "instances", "minio", "intake", "runtime", "a3"];

export interface CrossAxisHandoff {
  source: AxisKey;
  session?: string;
  rule_run_id?: string;
  ifc_guid?: string;
  usd_prim_path?: string;
  rule_code?: string;
  job_id?: string;
  conversion_id?: string;
  minio_key?: string;
  prefix?: string;
}

// Excludes "source" so `out[k] = v` below type-checks as a plain string write (source stays AxisKey-typed).
const PAYLOAD_KEYS: readonly Exclude<keyof CrossAxisHandoff, "source">[] = [
  "session", "rule_run_id", "ifc_guid", "usd_prim_path", "rule_code", "job_id", "conversion_id", "minio_key", "prefix",
];

export function isAxisKey(v: string): v is AxisKey {
  return (AXIS_KEYS as readonly string[]).includes(v);
}

// `target` is the hash page being navigated TO, which includes non-axis alias routes (e.g. "review",
// "gpu" — spec N1) alongside the seven AxisKeys; only `payload.source` (where the handoff came FROM) is
// constrained to AxisKey.
export function buildHandoff(target: string, payload: CrossAxisHandoff): string {
  const q = new URLSearchParams({ source: payload.source });
  for (const k of PAYLOAD_KEYS) {
    const v = payload[k];
    if (typeof v === "string" && v.length > 0) q.set(k, v);
  }
  return `#${target}?${q.toString()}`;
}

export function parseHandoff(hash: string = typeof window !== "undefined" ? window.location.hash : ""): CrossAxisHandoff | null {
  const i = hash.indexOf("?");
  if (i < 0) return null;
  const p = new URLSearchParams(hash.slice(i + 1));
  const source = p.get("source");
  if (!source || !isAxisKey(source)) return null;
  const out: CrossAxisHandoff = { source };
  for (const k of PAYLOAD_KEYS) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}
