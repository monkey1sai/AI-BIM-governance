// R8（2026-07-10 裁決）＋加性慣例（手冊 §1 第 13 條）：新 coordinator 端點進 routes/*.ts，
// 不 append app.ts 巨石。本 route 唯讀、無機密：回傳 local_fs 測試 fixtures 專案清單，
// 供前端 A1 local_fs 選檔渲染「測試資料」badge（清單來源＝部署區 .env 的
// TEST_DATA_PROJECT_IDS；編號不進程式碼，守 D-05／鐵律 #3）。
import type express from "express";
import type { CoordinatorConfig } from "../config.js";

export function registerDevMetaRoutes(app: express.Express, config: CoordinatorConfig): void {
  app.get("/api/dev/test-data-projects", (_request, response) => {
    response.json({ projects: config.testDataProjectIds });
  });
}
