/** Presentation only: never changes session identity, lease or command authority. */
export function isWorkspaceViewerPresentation(
  search = window.location.search,
  embedded = window.parent !== window,
): boolean {
  return embedded && new URLSearchParams(search).get("presentation") === "workspace";
}

/** Local Vite previews need the current Viewer bundle, not an older deployed UI.
 * Production and non-loopback entrypoints retain the Coordinator's endpoint. */
export function previewViewerOrigin(configured: string | null, development: boolean, location: Pick<Location, "hostname" | "port" | "origin">): string | null {
  return configured && development
    && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
    && ["5173", "5180"].includes(location.port)
    ? location.origin : configured;
}
