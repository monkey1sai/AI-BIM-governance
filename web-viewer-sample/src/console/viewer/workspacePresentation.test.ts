import { describe, expect, it } from "vitest";
import { isWorkspaceViewerPresentation, previewViewerOrigin } from "./workspacePresentation";

describe("workspace-only viewer presentation", () => {
  it("requires an explicitly embedded workspace; standalone navigation stays intact", () => {
    expect(isWorkspaceViewerPresentation("?presentation=workspace", true)).toBe(true);
    expect(isWorkspaceViewerPresentation("?presentation=workspace", false)).toBe(false);
    expect(isWorkspaceViewerPresentation("?session=existing", true)).toBe(false);
  });
  const local = { hostname: "127.0.0.1", port: "5173", origin: "http://127.0.0.1:5173" };
  const configured = "http://viewer.internal:5173";
  it("uses the current local bundle only for a supported Vite preview", () => {
    expect(previewViewerOrigin(configured, true, local)).toBe(local.origin);
    expect(previewViewerOrigin(configured, false, local)).toBe(configured);
    expect(previewViewerOrigin(configured, true, { ...local, hostname: "viewer.internal" })).toBe(configured);
    expect(previewViewerOrigin(configured, true, { ...local, port: "8004" })).toBe(configured);
    expect(previewViewerOrigin(null, true, local)).toBeNull();
  });
});
