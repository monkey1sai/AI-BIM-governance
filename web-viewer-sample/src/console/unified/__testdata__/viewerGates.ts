// Viewer Gate fixtures for tests (docs/architecture/viewport-slot-adr.md).
import type { ViewerGate } from "../../viewerGate";

/** Both verdicts pass: the viewer takes commands and batch highlights. */
export const OPEN_GATE: ViewerGate = { command: { ok: true }, batch: { ok: true } };

/** Commands pass; batch highlights are refused because the element mapping is stale. */
export const MAPPING_STALE_GATE: ViewerGate = {
  command: { ok: true },
  batch: { ok: false, reason: "mapping_stale", detail: "derived_artifact_unreachable" },
};
