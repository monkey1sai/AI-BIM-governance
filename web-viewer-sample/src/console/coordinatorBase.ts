// 共用：決定 coordinator API base。
// served from coordinator /ui（非 dev port）→ same-origin；否則回退 127.0.0.1:8004。
// 由 coordinatorClient.ts / governanceClient.ts 共用，避免兩處 defaultCoordinatorBase 重複（DRY）。
export function defaultCoordinatorBase(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:8004";
  const { origin, pathname, port } = window.location;
  const devPorts = new Set(["5173", "5174", "5180"]);
  if (pathname.startsWith("/ui") && !devPorts.has(port)) return origin;
  return "http://127.0.0.1:8004";
}
