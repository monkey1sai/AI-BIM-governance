import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest } from "@playwright/test";

// ifc-ready-api-field-redesign（Task 5，2026-07-01）：#/conv 三視圖對帳 vertical slice。
// 流程：spawn coordinator（S3 stub + conv stub、CONVERSION_LEDGER_STORE_PATH=tmp）
//   → S3 stub 已有 松風庵/root/main/000001/model.ifc（≥3段，符合 deriveIntakeFromKey 規約）
//   → 確定性手動觸發（不靠 watcher 首輪——minio-watch-auto-intake spec：首輪 SHALL 只登記
//     baseline 不觸發）：直打 POST /api/conversion/trigger { key }，coordinator server-side
//     presign + self-POST /api/external/ifc-ready → 建立 ifc-ready job（status=queued_for_conversion）
//     + 落 ledger（status=queued，idempotency_key=mw_<hash16>）→ jobs 表與 ledger 表遂共享同一把
//     idempotency_key。
//   → #/conv：ledger records 表出現該對帳鍵、Ifc-ready jobs 表同一 job 的對帳鍵格出現且與 ledger 相等
//     （三視圖可 join）+ lifecycle chip 顯中文狀態（排隊/轉檔中/偵測，禁假「完成」）+ usdc 誠實標籤
//     ＝待產生（converter 未落地，禁假 parsed）。
//
// *** 誠實標記：STUB MINIO + STUB CONVERSION API ***
//   S3 stub 模擬真實 S3（ListObjectsV2 + 物件 GET，同 minio-closed-loop.spec.ts 手法），供
//   presigned ref 的同步 IFC 下載成功。Conv stub 回 202 queued（dispatch 完成，非真轉檔）。
//   ledger/job 皆 queued 態，全程不得出現「完成」（ready 屬 Phase 2 callback 回填，本 spec 不驗）。
//   截圖落 artifacts/e2e/ifc-ready-field-redesign-conv-*。
//
// *** conditional-skip 適用 ***：dist-ui 未 build → test.skip；本 repo 無自動化 Playwright CI gate。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_REPO_DIR = path.resolve(TEST_DIR, "..");
const COORDINATOR_REPO_DIR = path.resolve(VIEWER_REPO_DIR, "..", "bim-review-coordinator");
const CONSOLE_DIST_DIR = path.resolve(VIEWER_REPO_DIR, "dist-ui");
const WEBHOOK_SECRET = "dev-webhook-secret";
const TRIGGER_KEY = "松風庵/root/main/000001/model.ifc";

let coordinatorBase = "";
let coordinatorProc: ChildProcess | null = null;
let s3Stub: http.Server | null = null;
let convStub: http.Server | null = null;
let tmpRoot = "";

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("stub bind failed");
  return a.port;
}

// S3 stub：POST /api/conversion/trigger 只需 presign 後真下載得到 IFC bytes（不掃 bucket），
// 但仍讓 ListObjectsV2 回同一顆物件，行為上與真實 S3 一致（比照 minio-closed-loop.spec.ts）。
async function startS3Stub(): Promise<number> {
  s3Stub = http.createServer((req, res) => {
    if (req.url && /\/bim-control\/.+\/model\.ifc/.test(req.url) && req.method === "GET" && !req.url.includes("list-type=2")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
        `<Name>bim-control</Name><IsTruncated>false</IsTruncated>` +
        `<Contents><Key>${TRIGGER_KEY}</Key><ETag>&quot;shofuan1&quot;</ETag><Size>10</Size></Contents>` +
        `</ListBucketResult>`,
    );
  });
  return listenOnRandomPort(s3Stub);
}

async function startConvStub(): Promise<number> {
  convStub = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/conversions/ifc-to-usdc") {
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_frf_e2e", status: "queued", authority: "bim-streaming-server" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  return listenOnRandomPort(convStub);
}

// Windows taskkill 對 spawn 出的 cmd.exe wrapper 的子樹整體殺（比照 minio-closed-loop.spec.ts）。
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

test.describe("#/conv 三視圖對帳 vertical slice（STUB MINIO + STUB CONVERSION）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );

    const s3Port = await startS3Stub();
    const convPort = await startConvStub();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ifc-ready-field-redesign-e2e-"));

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
      CONVERSION_LEDGER_STORE_PATH: ledgerPath,
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
      // 只需 POST /api/conversion/trigger 的 minioWatchConfigured() 守門通過（四欄齊全即可）；
      // 不 opt-in MINIO_WATCH_ENABLED，本 spec 走確定性手動觸發，不靠 watcher 輪詢首輪。
      MINIO_WATCH_ENDPOINT: `http://127.0.0.1:${s3Port}`,
      MINIO_WATCH_BUCKET: "bim-control",
      MINIO_WATCH_ACCESS_KEY: "ak",
      MINIO_WATCH_SECRET_KEY: "sk",
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
    coordinatorProc.stdout?.on("data", (d) => process.stdout.write(`[field-redesign] ${d}`));
    coordinatorProc.stderr?.on("data", (d) => {
      process.stderr.write(`[field-redesign:err] ${d}`);
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

  test("#/conv：Ifc-ready jobs 表投影 idempotency_key 對帳鍵 + lifecycle chip + 誠實 usdc(STUB MINIO+CONV)", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 前置（確定性手動觸發，不靠 watcher 首輪）：
      //   S3 stub 已有 松風庵/root/main/000001/model.ifc → POST /api/conversion/trigger { key }
      //   coordinator server-side presign 建立 job + 落 ledger（status=queued，mw_<hash16>）；
      //   jobs 表與 ledger 表遂共享同一把 idempotency_key。
      const triggerRes = await api.post(`${coordinatorBase}/api/conversion/trigger`, {
        data: { key: TRIGGER_KEY },
      });
      expect(triggerRes.status(), `POST /api/conversion/trigger 應 202；實得 ${triggerRes.status()}：${await triggerRes.text()}`).toBe(202);

      await page.goto(`${coordinatorBase}/ui#/conv`);

      // 1) ledger records 表出現該對帳鍵。用 Task 3 新增的 ledger 錨點（queued 亦可見）；
      //    不可用 conv-ledger-trigger-*——它僅在 status==='failed' && object_key 才 render，
      //    queued 場景不進 DOM，.first() 會命中 0 元素而逾時。
      const ledgerIdem = page.locator('[data-testid^="conv-ledger-idem-"]').first();
      await expect(ledgerIdem).toBeVisible();
      await expect(ledgerIdem).toContainText("mw_");

      // 2) Ifc-ready jobs 表同一 job 的對帳鍵格出現（可與 ledger 對齊）。
      const idemCell = page.locator('[data-testid^="conv-job-idem-"]').first();
      await expect(idemCell).toContainText("mw_");

      // 3) lifecycle chip 顯中文狀態（排隊/轉檔中/偵測），且誠實：不得出現「完成」假 ready（Phase 2 才回填）。
      const chip = page.locator('[data-testid^="conv-job-lifecycle-"]').first();
      await expect(chip).toBeVisible();
      await expect(page.locator('[data-testid^="conv-job-lifecycle-"]')).not.toContainText("完成");

      // 4) usdc 誠實標籤 = 待產生（禁 parsed）。
      await expect(page.locator('[data-testid^="conv-job-usdc-"]').first()).toContainText("待產生");

      // 5) 真正跨表對帳一致：抓 ledger 錨點與 jobs 格兩個字串，斷言「相等」（非只驗 jobs 自身格式）。
      const jobKey = (await idemCell.textContent())?.trim() ?? "";
      const ledgerKey = (await ledgerIdem.textContent())?.trim() ?? "";
      expect(jobKey).toMatch(/^mw_/);
      expect(jobKey).toBe(ledgerKey); // 同一把 idempotency_key 同時出現在 jobs 表與 ledger 表 → 三視圖可 join（才是 Done 要的「對帳鍵一致」）

      // 截圖證據交付物：fullPage 對本 app-shell 失效——.ec-root position:fixed（legacy-console.css）
      // 包住整個 app、真正內容在 .ec-main{overflow-y:auto}（css:67）內部獨立捲動，body/html scrollHeight
      // 不隨 .ec-main 內容增高，fullPage 只截到外層固定 viewport（頂 nav／Hero／Pipeline／MinIO 面板），
      // 抓不到捲動出去的下半頁（實測兩次不同資料的 fullPage 截圖位元組全同＝從未截到任何資料表）。
      // 修法：ledger 表（pages.tsx:1146）與其後緊接的 jobs 表（pages.tsx:1211）為 .ec-main 最末兩塊內容，
      // 先把 .ec-main 內捲到底、再對 .ec-main 元素截圖（元素框≈一個 viewport 高，最末兩表同框），
      // 確保 PNG 內肉眼可見 ledger↔jobs 兩把 idempotency_key 對帳鍵一致、且無假「完成」ready。
      const ecMain = page.locator(".ec-main");
      await ecMain.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await ecMain.screenshot({ path: `../artifacts/e2e/ifc-ready-field-redesign-conv-${Date.now()}.png` });
    } finally {
      await api.dispose();
    }
  });
});
