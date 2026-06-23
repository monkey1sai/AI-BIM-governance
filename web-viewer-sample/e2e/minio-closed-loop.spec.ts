import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest } from "@playwright/test";

// minio-closed-loop（Task 8，2026-06-23）：端到端四段一致。
// 流程：spawn coordinator（MINIO_WATCH_ENABLED + S3 stub + CONVERSION_LEDGER_STORE_PATH=tmp）
//   → S3 stub 回一個 松風庵/root/main/000001/model.ifc（≥3段，符合 watcher 規約）
//   → watcher 自動 intake → ledger 落 queued
//   → #/minio 出現物件（來源 IFC）+ model.usdc 標「待產生」
//   → #/conv 出現 ledger 紀錄（000001 版本，status=排隊）+ watcher 啟用中
//   → **全程無假 ready、無捏造 coverage**
//
// *** 誠實標記：STUB MINIO + STUB CONVERSION API ***
//   S3 stub 只回 .ifc，無 .usdc → MinioDataPage 正確標 pending·待產生（誠實鐵律）。
//   Conv stub 回 202 queued（watcher dispatch 完成，非真轉檔）。
//   ledger status=queued，不得出現 ready（Phase 2 才回填）。
//   截圖落 artifacts/e2e/minio-closed-loop-*。
//
// *** conditional-skip 適用（見 minio-watch-auto-intake.spec.ts 說明）***
//   dist-ui 未 build → test.skip；本 repo 無自動化 Playwright CI gate，此設計不 false-green。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_REPO_DIR = path.resolve(TEST_DIR, "..");
const COORDINATOR_REPO_DIR = path.resolve(VIEWER_REPO_DIR, "..", "bim-review-coordinator");
const CONSOLE_DIST_DIR = path.resolve(VIEWER_REPO_DIR, "dist-ui");
const WEBHOOK_SECRET = "dev-webhook-secret";

// S3 stub：可程式化注入物件，watcher 輪詢此 stub 的 ListObjectsV2。
interface S3Obj { key: string; etag: string; }
const s3State: { objs: S3Obj[] } = { objs: [] };

let coordinatorBase = "";
let coordinatorProc: ChildProcess | null = null;
let s3Stub: http.Server | null = null;
let convStub: http.Server | null = null;
let tmpRoot = "";

function listObjectsXml(objs: S3Obj[]): string {
  const contents = objs
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`;
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("stub bind failed");
  return a.port;
}

async function startS3Stub(): Promise<number> {
  s3Stub = http.createServer((req, res) => {
    // ListObjectsV2（list-type=2）→ 回 XML；物件 GET（presigned URL，/bim-control/.../model.ifc）→ 回最小 IFC stub body。
    if (req.url && /\/bim-control\/.+\/model\.ifc/.test(req.url) && req.method === "GET" && !req.url.includes("list-type=2")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(listObjectsXml(s3State.objs));
  });
  return listenOnRandomPort(s3Stub);
}

async function startConvStub(): Promise<number> {
  convStub = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_mw_cl_e2e", status: "queued", authority: "bim-streaming-server" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  return listenOnRandomPort(convStub);
}

// Windows taskkill 對 spawn 出的 cmd.exe wrapper 的子樹整體殺（照 minio-watch-auto-intake 模式）。
async function stopCoordinator(proc: ChildProcess): Promise<void> {
  const pid = proc.pid;
  if (pid && process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
      killer.on("exit", () => resolve());
      killer.on("error", () => { try { proc.kill("SIGKILL"); } catch { /* already gone */ } resolve(); });
    });
    return;
  }
  await new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, 3000);
    proc.once("exit", () => { clearTimeout(cap); resolve(); });
    try { proc.kill("SIGTERM"); } catch { clearTimeout(cap); resolve(); }
  });
}

async function waitForHealth(
  base: string,
  opts: { timeoutMs?: number; earlyExit?: () => string | null } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const api = await pwRequest.newContext();
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const exitMsg = opts.earlyExit?.();
      if (exitMsg) throw new Error(exitMsg);
      try { const res = await api.get(`${base}/health`, { timeout: 2000 }); if (res.ok()) return; } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`coordinator /health not ready within ${timeoutMs}ms at ${base}`);
  } finally { await api.dispose(); }
}

test.describe("MinIO 閉環四段一致（STUB MINIO + STUB CONVERSION）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );
    // 重置 S3 state：以一個 baseline 物件起始（watcher 首輪登記為 seen，不觸發 intake）。
    // 新物件（松風庵）於步驟 2 注入，確保 watcher 以 delta 偵測觸發 intake。
    s3State.objs = [{ key: "baseline/root/init/000000/model.ifc", etag: "base0" }];

    const s3Port = await startS3Stub();
    const convPort = await startConvStub();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minio-closed-loop-e2e-"));

    const freePort = await new Promise<number>((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") { reject(new Error("no free port")); return; }
        const p = addr.port; srv.close(() => resolve(p));
      });
    });
    coordinatorBase = `http://127.0.0.1:${freePort}`;

    const ledgerPath = path.join(tmpRoot, "conversion-ledger.json");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(freePort),
      PUBLIC_HOST: "127.0.0.1",
      STREAMING_CONVERSION_API_BASE: `http://127.0.0.1:${convPort}`,
      CONSOLE_DIST_DIR,
      CONVERSION_POLL_ENABLED: "false",
      IFC_DOWNLOAD_STRICT: "false",
      EXTERNAL_INTAKE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      SESSION_STORE_DIR: path.join(tmpRoot, "sessions"),
      EVENT_LOG_DIR: path.join(tmpRoot, "events"),
      CALLBACK_OUTBOX_STORE_PATH: path.join(tmpRoot, "callback-outbox.json"),
      // Task 8 要求：CONVERSION_LEDGER_STORE_PATH 指向 tmp 檔，確保 ledger 持久且測試隔離。
      CONVERSION_LEDGER_STORE_PATH: ledgerPath,
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
      // watcher opt-in：指向本機 fake S3 stub，interval 調短（1s）。
      MINIO_WATCH_ENABLED: "true",
      MINIO_WATCH_ENDPOINT: `http://127.0.0.1:${s3Port}`,
      MINIO_WATCH_BUCKET: "bim-control",
      MINIO_WATCH_ACCESS_KEY: "ak",
      MINIO_WATCH_SECRET_KEY: "sk",
      MINIO_WATCH_INTERVAL_SECONDS: "1",
      MINIO_WATCH_INTERVAL_FLOOR_SECONDS: "1",
    };

    const tsxBin = path.join(
      COORDINATOR_REPO_DIR, "node_modules", ".bin",
      process.platform === "win32" ? "tsx.cmd" : "tsx",
    );
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: COORDINATOR_REPO_DIR, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    });

    let stderrTail = "";
    let coordinatorExited: number | null = null;
    coordinatorProc.stdout?.on("data", (d) => process.stdout.write(`[closed-loop] ${d}`));
    coordinatorProc.stderr?.on("data", (d) => {
      process.stderr.write(`[closed-loop:err] ${d}`);
      stderrTail = (stderrTail + String(d)).slice(-1200);
    });
    coordinatorProc.on("exit", (code) => { coordinatorExited = code ?? -1; });
    await waitForHealth(coordinatorBase, {
      earlyExit: () =>
        coordinatorExited === null
          ? null
          : `coordinator 在 health ready 前提早退出（code=${coordinatorExited}），疑似埠被搶占（TOCTOU）。stderr 尾段：\n${stderrTail.trim() || "（無 stderr）"}`,
    });
  });

  test.afterAll(async () => {
    if (coordinatorProc) { await stopCoordinator(coordinatorProc); coordinatorProc = null; }
    for (const s of [s3Stub, convStub]) { if (s) await new Promise<void>((r) => s!.close(() => r())); }
    s3Stub = null; convStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("四段一致：watcher 偵測 → ledger queued → #/minio 來源IFC + 待產生 → #/conv 紀錄 + 啟用中 + 無假 ready", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 1) 等 watcher baseline 完成（baseline_count≥1）。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json() as { baseline_count: number }).baseline_count;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

      // 2) 注入新物件（≥3段 key，符合 watcher 規約）。baseline 已鎖，下一輪 watcher delta 偵測。
      //    松風庵/root/main/000001/model.ifc：4段，category=main（倒數二），version=000001（末段）。
      s3State.objs.push({ key: "松風庵/root/main/000001/model.ifc", etag: "shofuan1" });

      // 3) 等後端真實狀態確認：watcher triggered≥1 且 /api/conversion/records 出現 queued 紀錄。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json() as { triggered_total: number }).triggered_total;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/conversion/records`);
        const body = await r.json() as { items: Array<{ external_model_version_id: string; status: string }> };
        return body.items.some((rec) => rec.external_model_version_id === "000001");
      }, { timeout: 30_000 }).toBe(true);

      // 4) 斷言一：#/minio 頁 → GET /api/minio/objects → 出現 松風庵 物件、role 來源 IFC、
      //    且 model.usdc 標「待產生」（stub 無 .usdc → 誠實鐵律）。
      // 注意：SPA hash 路由不重新整頁，MinioDataPage useEffect 掛載後才打 API。
      // 用 expect(...).toBeVisible 的內建自動重試等待 React 完成渲染（照 minio-fileserver-source 慣例）。
      await page.goto(`${coordinatorBase}/ui#/minio`);

      // 樹節點：松風庵 專案可見（MinioDataPage 讀 /api/minio/objects 完成後渲染）。
      await expect(page.getByText("松風庵/", { exact: false }).first()).toBeVisible({ timeout: 20_000 });

      // 物件角色 label：「來源 IFC」（roleLabel("source_ifc") = "來源 IFC"）。
      await expect(page.getByText("來源 IFC", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

      // 誠實鐵律：stub 無 .usdc → 頁面標 "pending · 待產生"（pages.tsx:1266）。
      await expect(page.getByText("待產生", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

      // 確認無 parsed_usdc（.usdc 角色）——stub 只有 .ifc，不應偽稱已轉。
      // 用 not.toContainText 確保 DOM 文字層完全無該字樣（不受 CSS 隱藏影響）。
      await expect(page.locator("body")).not.toContainText("已轉 USDC");

      await page.screenshot({ path: "../artifacts/e2e/minio-closed-loop-minio.png", fullPage: true });

      // 5) 斷言二：#/conv 頁 → ledger panel 出現 000001 紀錄、status=排隊、
      //    minio-watch-panel 啟用中、且 ledger panel 不含「完成」（無假 ready）。
      await page.goto(`${coordinatorBase}/ui#/conv`);

      const ledgerPanel = page.getByTestId("conv-ledger-panel");
      await expect(ledgerPanel).toBeVisible({ timeout: 15_000 });

      // ledger 版本 000001 可見。
      await expect(ledgerPanel.getByText("000001", { exact: false })).toBeVisible({ timeout: 15_000 });

      // status = 排隊（LEDGER_STATUS_LABEL["queued"]="排隊"）。
      await expect(ledgerPanel.getByText("排隊", { exact: false })).toBeVisible({ timeout: 15_000 });

      // 誠實鐵律：ledger panel 不得含「完成」（ready Phase 2 才回填，Phase 1 禁假 ready）。
      // 用 not.toContainText 確保 DOM 文字層完全無該字樣（不受 CSS 隱藏影響）。
      await expect(ledgerPanel).not.toContainText("完成");

      // minio-watch-panel：watcher 啟用中（MINIO_WATCH_ENABLED=true）。
      const mwPanel = page.getByTestId("minio-watch-panel");
      await expect(mwPanel).toBeVisible({ timeout: 15_000 });
      await expect(mwPanel).toContainText("啟用中", { timeout: 15_000 });

      await page.screenshot({ path: "../artifacts/e2e/minio-closed-loop-conv.png", fullPage: true });
    } finally {
      await api.dispose();
    }
  });
});
