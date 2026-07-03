// web-viewer-sample/src/console/MinioCrossLinks.test.tsx
// Task 10（M axis）：.ifc 物件列（obj.role === "source_ifc"）掛 #conv / #a1 cross-link chips。
// 重點驗證 OQ4 決定性 spike：中文 minio_key 經 buildHandoff → URL hash → parseHandoff 完整往返。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioDataPage } from "./pages";
import { coordinatorClient, type MinioFolderListing } from "./coordinatorClient";
import { parseHandoff } from "./handoff";

const CN_KEY = "270專案/建築/v07/模型.ifc";
const folder: MinioFolderListing = { bucket: "bim-control", prefix: "", folders: [], count: 1, objects: [
  { key: CN_KEY, etag: "e1", role: "source_ifc", project_id: "270", project_display_name: "270", category: "建築", version: "v07", idempotency_key: "mw_abc" },
] };

describe("M .ifc cross-link chips with Chinese key round-trip", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "";
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("navigates to #conv carrying the exact Chinese minio_key", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const chip = container.querySelector('[data-testid="minio-link-conv-mw_abc"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    await act(async () => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const parsed = parseHandoff(window.location.hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(CN_KEY); // exact round-trip through encode → hash → decode
  });

  it("navigates to #a1 carrying the exact Chinese minio_key", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(folder);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const chip = container.querySelector('[data-testid="minio-link-a1-mw_abc"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    await act(async () => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const parsed = parseHandoff(window.location.hash);
    expect(parsed?.source).toBe("minio");
    expect(parsed?.minio_key).toBe(CN_KEY);
    expect(window.location.hash.startsWith("#a1?")).toBe(true);
  });
});
