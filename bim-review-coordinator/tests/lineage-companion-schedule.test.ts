import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPANION_SCHEDULE_FILENAME,
  companionScheduleKey,
  fetchCompanionSchedule,
  ifcFolderOf,
  readCompanionSchedule,
  siblingPath,
} from "../src/services/lineageReports/companionSchedule.js";
import {
  LineageObjectTooLargeError,
  type LineageReportObjectPort,
} from "../src/services/lineageReports/lineageReportObjectStore.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jobDir(): { ifcLocalPath: string; dir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "companion-schedule-"));
  dirs.push(root);
  const dir = path.join(root, "ifc-cache", "ifcready_1");
  mkdirSync(dir, { recursive: true });
  const ifcLocalPath = path.join(dir, "source.ifc");
  writeFileSync(ifcLocalPath, "ISO-10303-21;");
  return { ifcLocalPath, dir };
}

function port(objects: Record<string, string | Error>): LineageReportObjectPort & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async getObjectBytes(key) {
      reads.push(key);
      const hit = objects[key];
      if (hit === undefined) return null;
      if (hit instanceof Error) throw hit;
      return { bytes: Buffer.from(hit, "utf-8"), etag: "etag-1" };
    },
    async putObjectIfAbsent() {
      throw new Error("not used");
    },
    destroy() {},
  };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("companion schedule key helpers", () => {
  it("schedule.csv 與 IFC 在同一個 MinIO 資料夾", () => {
    expect(ifcFolderOf("899/main/p1/model.ifc")).toBe("899/main/p1/");
    expect(companionScheduleKey("899/main/p1/model.ifc")).toBe("899/main/p1/schedule.csv");
    expect(ifcFolderOf("model.ifc")).toBe("");
    expect(companionScheduleKey("model.ifc")).toBe("schedule.csv");
  });

  it("siblingPath 保留原路徑的分隔符", () => {
    expect(siblingPath("/workspace/storage/ifc-cache/j/source.ifc", "schedule.csv")).toBe(
      "/workspace/storage/ifc-cache/j/schedule.csv",
    );
    expect(siblingPath("D:\\runtime\\storage/ifc-cache/j/source.ifc", "schedule.csv")).toBe(
      "D:\\runtime\\storage/ifc-cache/j/schedule.csv",
    );
    expect(siblingPath("C:\\a\\b\\source.ifc", "schedule.csv")).toBe("C:\\a\\b\\schedule.csv");
  });
});

describe("fetchCompanionSchedule", () => {
  it("下載同資料夾的 schedule.csv 並寫下來源 sidecar", async () => {
    const { ifcLocalPath, dir } = jobDir();
    const objects = port({ "899/main/p1/schedule.csv": "ID,IfcGUID\n1,x\n" });

    const outcome = await fetchCompanionSchedule({
      objects,
      bucket: "bim-control",
      ifcKey: "899/main/p1/model.ifc",
      ifcLocalPath,
      now: () => new Date("2026-09-16T12:00:00.000Z"),
    });

    expect(outcome).toEqual({
      status: "downloaded",
      source: {
        schema_version: "companion-schedule-source/v1",
        bucket: "bim-control",
        key: "899/main/p1/schedule.csv",
        etag: "etag-1",
        sha256: sha("ID,IfcGUID\n1,x\n"),
        size_bytes: 15,
        fetched_at: "2026-09-16T12:00:00.000Z",
      },
    });
    expect(readFileSync(path.join(dir, COMPANION_SCHEDULE_FILENAME), "utf-8")).toBe("ID,IfcGUID\n1,x\n");
    expect(JSON.parse(readFileSync(path.join(dir, "schedule.source.json"), "utf-8"))).toEqual(
      outcome.status === "downloaded" ? outcome.source : null,
    );
  });

  it("資料夾沒有 schedule.csv 時回 absent，不寫檔", async () => {
    const { ifcLocalPath, dir } = jobDir();
    const outcome = await fetchCompanionSchedule({
      objects: port({}),
      bucket: "bim-control",
      ifcKey: "899/main/p1/model.ifc",
      ifcLocalPath,
    });
    expect(outcome).toEqual({ status: "absent" });
    expect(existsSync(path.join(dir, COMPANION_SCHEDULE_FILENAME))).toBe(false);
  });

  it("太大或讀取失敗時回 failed 與原因碼，不寫檔", async () => {
    const { ifcLocalPath, dir } = jobDir();
    const tooLarge = await fetchCompanionSchedule({
      objects: port({ "a/schedule.csv": new LineageObjectTooLargeError("a/schedule.csv", 1) }),
      bucket: "bim-control",
      ifcKey: "a/model.ifc",
      ifcLocalPath,
    });
    expect(tooLarge).toEqual({ status: "failed", reason: "schedule_too_large" });
    const broken = await fetchCompanionSchedule({
      objects: port({ "a/schedule.csv": new Error("connect ECONNREFUSED") }),
      bucket: "bim-control",
      ifcKey: "a/model.ifc",
      ifcLocalPath,
    });
    expect(broken).toEqual({ status: "failed", reason: "schedule_unavailable" });
    expect(existsSync(path.join(dir, COMPANION_SCHEDULE_FILENAME))).toBe(false);
  });
});

describe("readCompanionSchedule", () => {
  it("回傳 dispatch 用的 schedule_artifact，兩種路徑都指向 IFC 旁邊", async () => {
    const { ifcLocalPath } = jobDir();
    await fetchCompanionSchedule({
      objects: port({ "a/schedule.csv": "ID,IfcGUID\n" }),
      bucket: "bim-control",
      ifcKey: "a/model.ifc",
      ifcLocalPath,
    });

    const artifact = readCompanionSchedule(ifcLocalPath, "D:\\host\\storage/ifc-cache/ifcready_1/source.ifc");

    expect(artifact).toEqual({
      artifact_id: `schedule_${sha("ID,IfcGUID\n").slice(0, 16)}`,
      format: "csv",
      filename: "schedule.csv",
      checksum_sha256: sha("ID,IfcGUID\n"),
      size_bytes: 11,
      etag: "etag-1",
      local_path: siblingPath(ifcLocalPath, "schedule.csv"),
      host_local_path: "D:\\host\\storage/ifc-cache/ifcready_1/schedule.csv",
    });
  });

  it("沒有 sidecar、檔案被改過或 sidecar 壞掉時回 null", async () => {
    const { ifcLocalPath, dir } = jobDir();
    expect(readCompanionSchedule(ifcLocalPath, ifcLocalPath)).toBeNull();

    await fetchCompanionSchedule({
      objects: port({ "a/schedule.csv": "ID,IfcGUID\n" }),
      bucket: "bim-control",
      ifcKey: "a/model.ifc",
      ifcLocalPath,
    });
    writeFileSync(path.join(dir, COMPANION_SCHEDULE_FILENAME), "tampered");
    expect(readCompanionSchedule(ifcLocalPath, ifcLocalPath)).toBeNull();

    writeFileSync(path.join(dir, "schedule.source.json"), "{not json");
    expect(readCompanionSchedule(ifcLocalPath, ifcLocalPath)).toBeNull();
  });
});
