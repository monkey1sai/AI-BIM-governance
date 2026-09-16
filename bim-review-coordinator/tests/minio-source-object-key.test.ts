import { describe, expect, it } from "vitest";
import { minioObjectKeyFromSourceRef } from "../src/services/minioSourceObjectKey.js";

// 回歸來源：181 實站上 GET /api/external/ifc-ready 的 source_object_key 恆為 null
// （ledger.object_key 落地全 null），使前端「已選 session」時的 MinIO 選檔比對恆不成立，
// 選檔鈕永遠停在「等待 watcher/轉檔排程」。本檔鎖住從 source_ifc_ref 還原 key 的行為。
describe("minioObjectKeyFromSourceRef", () => {
  it("path-style http ref 還原 key（含 percent-encoded 非 ASCII 路徑）", () => {
    // 逐字取自 181 runtime：GET /api/runtime/status → ifc_ready_jobs.recent[0].source_ifc_ref
    const ref = "http://192.168.20.234:9000/bim-control/"
      + "%E6%9D%B1%E5%8B%A2%E5%8D%80%E8%A8%B1%E8%89%AF%E5%AE%87%E7%B4%80%E5%BF%B5%E5%9C%96%E6%9B%B8%E9%A4%A8"
      + "/root/%E5%BB%BA%E7%AF%89/24e598ab-be3d-4dbb-a1aa-60b0ba610618/model.ifc";
    expect(minioObjectKeyFromSourceRef(ref, "bim-control")).toBe(
      "東勢區許良宇紀念圖書館/root/建築/24e598ab-be3d-4dbb-a1aa-60b0ba610618/model.ifc",
    );
  });

  it("scheme-style minio:// ref 還原 key（bucket 在 authority，見 ifc_ready_payload 契約範例）", () => {
    const ref = "minio://edge-bucket/tenant_demo_001/project_demo_001/ext_mv_demo_001/demo-model.ifc";
    expect(minioObjectKeyFromSourceRef(ref, "edge-bucket")).toBe(
      "tenant_demo_001/project_demo_001/ext_mv_demo_001/demo-model.ifc",
    );
  });

  it("別的 bucket 一律回 null（不可把他 bucket 的物件對成本 bucket 的 key）", () => {
    expect(minioObjectKeyFromSourceRef("http://minio:9000/other-bucket/a/model.ifc", "bim-control")).toBeNull();
    expect(minioObjectKeyFromSourceRef("minio://other-bucket/a/model.ifc", "edge-bucket")).toBeNull();
  });

  it("無法還原時回 null 而非猜測：非 URL、空 key、缺 bucket 設定、壞 encoding", () => {
    expect(minioObjectKeyFromSourceRef("devstorage:demo-model.ifc", "bim-control")).toBeNull();
    expect(minioObjectKeyFromSourceRef("http://minio:9000/bim-control/", "bim-control")).toBeNull();
    expect(minioObjectKeyFromSourceRef("http://minio:9000/bim-control/a.ifc", "")).toBeNull();
    expect(minioObjectKeyFromSourceRef(null, "bim-control")).toBeNull();
    expect(minioObjectKeyFromSourceRef("http://minio:9000/bim-control/%E0%A4%A.ifc", "bim-control")).toBeNull();
  });
});
