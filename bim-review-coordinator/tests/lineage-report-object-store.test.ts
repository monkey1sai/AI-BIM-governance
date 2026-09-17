import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  LineageObjectTooLargeError,
  LineageReportWriteScopeError,
  assertLineageReportObjectKey,
  createS3LineageReportObjectStore,
} from "../src/services/lineageReports/lineageReportObjectStore.js";

// 真 S3 SDK + 本地 HTTP stub：鎖定 404／412／403 的分類與 conditional create 標頭。

type Recorded = { method: string; path: string; headers: http.IncomingHttpHeaders; body: string };

let stub: http.Server | null = null;

afterEach(async () => {
  if (stub) {
    stub.closeAllConnections?.();
    await new Promise<void>((resolve) => stub!.close(() => resolve()));
    stub = null;
  }
});

async function startStub(
  handler: (request: Recorded, response: http.ServerResponse) => void,
): Promise<{ endpoint: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  stub = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded = {
        method: req.method ?? "",
        path: decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname),
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => stub!.listen(0, "127.0.0.1", () => resolve()));
  const address = stub!.address();
  if (!address || typeof address === "string") throw new Error("stub bind");
  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

function s3Error(res: http.ServerResponse, status: number, code: string): void {
  res.writeHead(status, { "Content-Type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>x</Message></Error>`);
}

const REPORT_KEY = "899/main/p1/lineage-reports/stream_conv_1/alignment_report.json";

describe("assertLineageReportObjectKey", () => {
  it("只放行 lineage-reports/<轉檔編號>/ 下的兩份報表", () => {
    expect(() => assertLineageReportObjectKey(REPORT_KEY)).not.toThrow();
    expect(() => assertLineageReportObjectKey("lineage-reports/stream_conv_1/alignment_report.csv")).not.toThrow();
    for (const key of [
      "899/main/p1/model.ifc",
      "899/main/p1/schedule.csv",
      "899/main/p1/lineage-reports/stream_conv_1/other.json",
      "899/main/p1/lineage-reports/../model.ifc/alignment_report.json",
      "899/main/p1/lineage-reports/a/b/alignment_report.json",
      "899/main/p1/lineage-reports//alignment_report.json",
      "",
    ]) {
      expect(() => assertLineageReportObjectKey(key), key).toThrow(LineageReportWriteScopeError);
    }
  });
});

describe("createS3LineageReportObjectStore", () => {
  it("getObjectBytes：200 回內容、404 回 null", async () => {
    const { endpoint } = await startStub((request, res) => {
      if (request.path === "/bim-control/899/main/p1/schedule.csv") {
        res.writeHead(200, { "Content-Type": "text/csv", ETag: '"e1"' });
        res.end("ID,IfcGUID\n1,abc\n");
        return;
      }
      s3Error(res, 404, "NoSuchKey");
    });
    const store = createS3LineageReportObjectStore({ endpoint, bucket: "bim-control", accessKey: "ak", secretKey: "sk" });
    try {
      const hit = await store.getObjectBytes("899/main/p1/schedule.csv", 1024);
      expect(hit?.bytes.toString("utf-8")).toBe("ID,IfcGUID\n1,abc\n");
      expect(hit?.etag).toBe("e1");
      expect(await store.getObjectBytes("899/main/p1/missing.csv", 1024)).toBeNull();
    } finally {
      store.destroy();
    }
  });

  it("getObjectBytes：超過上限就中止並拋 LineageObjectTooLargeError", async () => {
    const { endpoint } = await startStub((_request, res) => {
      res.writeHead(200, { "Content-Type": "text/csv" });
      res.end("x".repeat(64));
    });
    const store = createS3LineageReportObjectStore({ endpoint, bucket: "bim-control", accessKey: "ak", secretKey: "sk" });
    try {
      await expect(store.getObjectBytes("899/main/p1/schedule.csv", 16)).rejects.toBeInstanceOf(
        LineageObjectTooLargeError,
      );
    } finally {
      store.destroy();
    }
  });

  it("putObjectIfAbsent：帶 If-None-Match:* 建立；412 為 exists；403 為 denied；其他錯誤往上拋", async () => {
    const outcomes = new Map<string, number>([
      ["/bim-control/a/lineage-reports/c1/alignment_report.json", 200],
      ["/bim-control/a/lineage-reports/c2/alignment_report.json", 412],
      ["/bim-control/a/lineage-reports/c3/alignment_report.json", 403],
      ["/bim-control/a/lineage-reports/c4/alignment_report.json", 500],
    ]);
    const { endpoint, requests } = await startStub((request, res) => {
      if (request.method === "HEAD") {
        res.writeHead(404);
        res.end();
        return;
      }
      const status = outcomes.get(request.path) ?? 500;
      if (status === 200) {
        res.writeHead(200, { ETag: '"new"' });
        res.end();
      } else if (status === 412) s3Error(res, 412, "PreconditionFailed");
      else if (status === 403) s3Error(res, 403, "AccessDenied");
      else s3Error(res, 500, "InternalError");
    });
    const store = createS3LineageReportObjectStore({ endpoint, bucket: "bim-control", accessKey: "ak", secretKey: "sk" });
    const body = Buffer.from("{}");
    try {
      expect(await store.putObjectIfAbsent("a/lineage-reports/c1/alignment_report.json", body, "application/json")).toBe("created");
      expect(await store.putObjectIfAbsent("a/lineage-reports/c2/alignment_report.json", body, "application/json")).toBe("exists");
      expect(await store.putObjectIfAbsent("a/lineage-reports/c3/alignment_report.json", body, "application/json")).toBe("denied");
      await expect(
        store.putObjectIfAbsent("a/lineage-reports/c4/alignment_report.json", body, "application/json"),
      ).rejects.toBeTruthy();
    } finally {
      store.destroy();
    }
    const put = requests.find((request) => request.method === "PUT");
    expect(put?.headers["if-none-match"]).toBe("*");
    expect(put?.headers["content-type"]).toBe("application/json");
    expect(put?.body).toBe("{}");
  });

  it("putObjectIfAbsent：HEAD 已存在就不送 PUT", async () => {
    const { endpoint, requests } = await startStub((request, res) => {
      if (request.method === "HEAD") {
        res.writeHead(200, { ETag: '"old"', "Content-Length": "2" });
        res.end();
        return;
      }
      s3Error(res, 500, "InternalError");
    });
    const store = createS3LineageReportObjectStore({ endpoint, bucket: "bim-control", accessKey: "ak", secretKey: "sk" });
    try {
      expect(await store.putObjectIfAbsent("a/lineage-reports/c1/alignment_report.csv", Buffer.from("x"), "text/csv")).toBe(
        "exists",
      );
    } finally {
      store.destroy();
    }
    expect(requests.map((request) => request.method)).toEqual(["HEAD"]);
  });

  it("putObjectIfAbsent：HEAD 被拒（403）視為 denied，不送 PUT", async () => {
    const { endpoint, requests } = await startStub((request, res) => {
      if (request.method === "HEAD") {
        res.writeHead(403);
        res.end();
        return;
      }
      s3Error(res, 500, "InternalError");
    });
    const store = createS3LineageReportObjectStore({ endpoint, bucket: "bim-control", accessKey: "ak", secretKey: "sk" });
    try {
      expect(await store.putObjectIfAbsent("a/lineage-reports/c1/alignment_report.csv", Buffer.from("x"), "text/csv")).toBe(
        "denied",
      );
    } finally {
      store.destroy();
    }
    expect(requests.map((request) => request.method)).toEqual(["HEAD"]);
  });

  it("寫入範圍外的 key 在發出請求前就被擋下", async () => {
    const store = createS3LineageReportObjectStore({
      endpoint: "http://127.0.0.1:9",
      bucket: "bim-control",
      accessKey: "ak",
      secretKey: "sk",
    });
    try {
      await expect(store.putObjectIfAbsent("899/main/p1/model.ifc", Buffer.from("x"), "text/plain")).rejects.toBeInstanceOf(
        LineageReportWriteScopeError,
      );
    } finally {
      store.destroy();
    }
  });
});
