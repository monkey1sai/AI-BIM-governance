import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startMinioWatcher, type MinioWatcherStatus } from "../src/services/minioWatcher.js";

let s3Stub: http.Server | null = null;
let intakeStub: http.Server | null = null;
// getStatus 回完整 MinioWatcherStatus（具名型別，無 index signature）；tsconfig include tests/
// 故須與 MinioWatcherHandle 的回傳對齊，不可用 Record<string, unknown>（嚴格模式不可賦值）。
let watcher: { dispose: () => void; getStatus: () => MinioWatcherStatus } | null = null;

afterEach(async () => {
  if (watcher) { watcher.dispose(); watcher = null; }
  for (const s of [s3Stub, intakeStub]) {
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
  s3Stub = null; intakeStub = null;
});

interface S3Obj { key: string; etag: string; }

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function startS3Stub(state: { objs: S3Obj[] }): Promise<string> {
  s3Stub = http.createServer((req, res) => {
    // ListObjectsV2: GET /{bucket}?list-type=2... → 回 XML。GetObject presign 不真打（presigner 只簽 URL）。
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(state.objs));
  });
  await new Promise<void>((r) => s3Stub!.listen(0, "127.0.0.1", () => r()));
  const a = s3Stub!.address();
  if (!a || typeof a === "string") throw new Error("s3 stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function startIntakeStub(received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }>): Promise<string> {
  intakeStub = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ body: JSON.parse(body || "{}"), headers: req.headers });
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ifc_ready_job_id: `ifcready_stub_${received.length}`, idempotent_replay: false }));
    });
  });
  await new Promise<void>((r) => intakeStub!.listen(0, "127.0.0.1", () => r()));
  const a = intakeStub!.address();
  if (!a || typeof a === "string") throw new Error("intake stub bind");
  return `http://127.0.0.1:${a.port}`;
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

function makeWatcher(s3Base: string, selfBase: string, state: { objs: S3Obj[] }) {
  return startMinioWatcher({
    endpoint: s3Base,
    bucket: "bim-control",
    prefix: "",
    accessKey: "ak",
    secretKey: "sk",
    keySuffix: "/model.ifc",
    intervalSeconds: 0.05, // 50ms tick → test 快
    selfBaseUrl: selfBase,
    webhookSecret: "dev-webhook-secret",
    structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
  });
}

describe("minioWatcher loop", () => {
  it("首輪 baseline 不觸發（seen=N、triggered=0）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }, { key: "900/yyy/model.ifc", etag: "e2" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 2);
    // baseline 後再等幾輪，確認不觸發
    await new Promise((r) => setTimeout(r, 300));
    const st = watcher!.getStatus();
    expect(st.baseline_count).toBe(2);
    expect(st.seen_count).toBe(2);
    expect(st.triggered_total).toBe(0);
    expect(received.length).toBe(0);
  });

  it("第二輪新增物件 → 觸發一筆 intake，payload 與 header 正確", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);

    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    // 新增物件 → 下一輪應觸發
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);

    const { body, headers } = received[0];
    expect(body.event).toBe("ifc_ready");
    expect(body.project_id).toBe("988");
    expect(body.external_model_version_id).toBe("zzz");
    expect((body.source_ifc as Record<string, unknown>).ref).toContain("988/zzz/model.ifc"); // presigned GET URL
    expect((body.source_ifc as Record<string, unknown>).ref).toMatch(/X-Amz-Signature=/); // 含簽章參數
    expect((body.source_ifc as Record<string, unknown>).etag).toBe("e9");
    expect(headers["x-webhook-secret"]).toBe("dev-webhook-secret");
    expect(String(headers["x-idempotency-key"])).toMatch(/^mw_[0-9a-f]{16}$/);
    expect(String(headers["x-correlation-id"])).toMatch(/^minio-watch-[0-9a-f]{8}$/);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("同物件後續輪不再觸發（seen 命中，triggered 維持 1）", async () => {
    const state = { objs: [{ key: "899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    await waitFor(() => (watcher!.getStatus().baseline_count as number) === 1);
    state.objs.push({ key: "988/zzz/model.ifc", etag: "e9" });
    await waitFor(() => received.length === 1);
    await new Promise((r) => setTimeout(r, 300)); // 多跑幾輪
    expect(received.length).toBe(1);
    expect(watcher!.getStatus().triggered_total).toBe(1);
  });

  it("層級不符 key → skipped_malformed 計數，不觸發", async () => {
    const state = { objs: [{ key: "deep/899/xxx/model.ifc", etag: "e1" }] };
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    const s3Base = await startS3Stub(state);
    watcher = makeWatcher(s3Base, selfBase, state);
    // 首輪即 baseline，但 malformed 不入 baseline 觸發域；改在新增 malformed 後驗 skip
    await waitFor(() => (watcher!.getStatus().last_poll_at as string | null) !== null);
    state.objs.push({ key: "also/deep/path/model.ifc", etag: "e2" });
    await waitFor(() => (watcher!.getStatus().skipped_malformed_total as number) >= 1);
    expect(received.length).toBe(0);
  });

  it("list 失敗 → 記 last_error，不 crash，下輪重試", async () => {
    const received: Array<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders }> = [];
    const selfBase = await startIntakeStub(received);
    // s3 指向不可達 port → list 失敗
    watcher = startMinioWatcher({
      endpoint: "http://127.0.0.1:1",
      bucket: "bim-control", prefix: "", accessKey: "ak", secretKey: "sk",
      keySuffix: "/model.ifc", intervalSeconds: 0.05, selfBaseUrl: selfBase,
      webhookSecret: "dev-webhook-secret",
      structLog: { anomaly: () => {}, withTraceId: () => ({ anomaly: () => {} }) } as never,
    });
    await waitFor(() => (watcher!.getStatus().last_error as string | null) !== null);
    expect(String(watcher!.getStatus().last_error)).toBeTruthy();
    expect(received.length).toBe(0);
  });
});
