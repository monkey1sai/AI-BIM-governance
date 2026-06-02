import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventLog } from "../../src/services/eventLog.js";

/**
 * EventLog lifecycle filtering vs. full-log passthrough.
 *
 * Retired collaboration event types (`highlightRequest` / `selectionUpdate` /
 * `annotationCreate`, removed 2026-05-21 in `remove-conflict-review-from-fast-mvp`)
 * are still appendable for archive compatibility. listLifecycle() excludes them
 * via its allowlist; list() returns the full history including them.
 */
describe("EventLog lifecycle filter vs. archive passthrough", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "eventlog-filter-"));
  });

  afterEach(() => {
    try {
      rmSync(storageRoot, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  const COLLABORATION_TYPES = ["highlightRequest", "selectionUpdate", "annotationCreate"];

  it("listLifecycle() excludes retired collaboration event types", () => {
    const eventLog = new EventLog(storageRoot);
    const sessionId = "review_session_filter";

    for (const type of COLLABORATION_TYPES) {
      eventLog.append(sessionId, type, {});
    }
    eventLog.append(sessionId, "sessionCreated", {});

    const lifecycle = eventLog.listLifecycle(sessionId);
    expect(lifecycle.map((event) => event.type)).toEqual(["sessionCreated"]);
    for (const type of COLLABORATION_TYPES) {
      expect(lifecycle.some((event) => event.type === type)).toBe(false);
    }
  });

  it("list() returns the full history including retired collaboration types (archive compatibility)", () => {
    const eventLog = new EventLog(storageRoot);
    const sessionId = "review_session_filter";

    for (const type of COLLABORATION_TYPES) {
      eventLog.append(sessionId, type, {});
    }
    eventLog.append(sessionId, "sessionCreated", {});

    const all = eventLog.list(sessionId);
    const allTypes = all.map((event) => event.type);
    expect(allTypes).toContain("sessionCreated");
    for (const type of COLLABORATION_TYPES) {
      expect(allTypes).toContain(type);
    }
    expect(all).toHaveLength(COLLABORATION_TYPES.length + 1);
  });
});
