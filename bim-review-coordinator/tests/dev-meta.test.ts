// R8（2026-07-10 裁決）：local_fs 測試 fixtures 標「測試資料」——清單由 coordinator config 驅動，
// 不得在前端/後端業務邏輯裸寫專案編號（D-05）。本檔測 config 解析與 GET /api/dev/test-data-projects。
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { registerDevMetaRoutes } from "../src/routes/devMeta.js";

const originalTestDataProjectIds = process.env.TEST_DATA_PROJECT_IDS;

afterEach(() => {
  if (originalTestDataProjectIds === undefined) delete process.env.TEST_DATA_PROJECT_IDS;
  else process.env.TEST_DATA_PROJECT_IDS = originalTestDataProjectIds;
});

describe("test data projects config（R8）", () => {
  it("parses TEST_DATA_PROJECT_IDS csv with trimming", () => {
    process.env.TEST_DATA_PROJECT_IDS = "270, 889,990,271";
    expect(loadConfig().testDataProjectIds).toEqual(["270", "889", "990", "271"]);
  });

  it("defaults to empty list（不裸寫編號，D-05）", () => {
    delete process.env.TEST_DATA_PROJECT_IDS;
    expect(loadConfig().testDataProjectIds).toEqual([]);
  });

  it("overrides win（test seam）", () => {
    expect(loadConfig({ testDataProjectIds: ["999"] }).testDataProjectIds).toEqual(["999"]);
  });
});

describe("GET /api/dev/test-data-projects", () => {
  it("returns configured projects（唯讀、無機密）", async () => {
    const app = express();
    registerDevMetaRoutes(app, loadConfig({ testDataProjectIds: ["270", "889"] }));
    const res = await request(app).get("/api/dev/test-data-projects");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ projects: ["270", "889"] });
  });
});
