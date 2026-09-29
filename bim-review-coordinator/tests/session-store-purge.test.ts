// model-file-session-lifecycle-contract §4.3：purge 只刪 session 檔與事件檔。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../src/services/eventLog.js";
import { SessionStore } from "../src/services/sessionStore.js";
import type { KitInstance } from "../src/types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-purge-unit-"));
  roots.push(root);
  return root;
}

// 與 tests/unit_sessionstore.test.ts 的 dummyKitInstance 同型（src/types.ts KitInstance），
// 取代 brief 草稿中與實際型別不符的 { kit_instance_id, url } 物件。
const dummyKitInstance: KitInstance = {
  instance_id: "kit_local_001",
  provider: "local_fixed",
  status: "ready",
  stream_server: "127.0.0.1",
  signaling_port: 49100,
  media_server: "127.0.0.1",
};

describe("SessionStore.purge and EventLog.remove", () => {
  it("deletes the session file and reports false on a second call", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    const session = store.create({
      tenant_id: "t",
      project_id: "p",
      model_version_id: "m",
      created_by: "unit",
      kit_instance: dummyKitInstance,
    });
    expect(store.get(session.session_id)).not.toBeNull();
    expect(store.purge(session.session_id)).toBe(true);
    expect(store.get(session.session_id)).toBeNull();
    expect(store.list()).toEqual([]);
    expect(store.purge(session.session_id)).toBe(false);
  });

  it("rejects unsafe ids before touching the filesystem", () => {
    const store = new SessionStore(path.join(tempRoot(), "sessions"));
    expect(() => store.purge("../etc/passwd")).toThrow();
  });

  // R11／spec §4.3「舊 id 永不復活」：purge 留下的墓碑標記，isPurged() 讀得到、list() 讀不到。
  it("leaves a retired marker after purge: isPurged() is true, the marker file exists, list() stays empty", () => {
    const sessionsDir = path.join(tempRoot(), "sessions");
    const store = new SessionStore(sessionsDir);
    const session = store.create({
      tenant_id: "t", project_id: "p", model_version_id: "m", created_by: "unit", kit_instance: dummyKitInstance,
    });
    const neverPurgedId = "review_session_unit_neverpurged1";
    expect(store.isPurged(session.session_id)).toBe(false);
    expect(store.isPurged(neverPurgedId)).toBe(false);

    expect(store.purge(session.session_id)).toBe(true);

    expect(store.isPurged(session.session_id)).toBe(true);
    const marker = fs.readdirSync(sessionsDir).find((entry) => entry.startsWith(`${session.session_id}.json.purged-`));
    expect(marker).toBeDefined();
    expect(store.list()).toEqual([]);
    // A never-purged id must not be reported purged just because some other id's marker exists.
    expect(store.isPurged(neverPurgedId)).toBe(false);
  });

  it("removes the event file and reports false when there was none", () => {
    const log = new EventLog(path.join(tempRoot(), "events"));
    log.append("review_session_unit000001", "sessionCreated", {});
    expect(log.list("review_session_unit000001")).toHaveLength(1);
    expect(log.remove("review_session_unit000001")).toBe(true);
    expect(log.list("review_session_unit000001")).toEqual([]);
    expect(log.remove("review_session_unit000001")).toBe(false);
  });
});
