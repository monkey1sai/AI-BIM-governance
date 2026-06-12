import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest } from "@playwright/test";

// minio-watch-auto-intake（spec 2026-06-12，O4 觸發機制 B 案）：user-facing vertical slice。
// MINIO_WATCH_ENABLED=true 的真 coordinator + 本機 fake S3 stub（ListObjectsV2 XML）+ stub conversion。
// stub 注入新物件 → watcher 自動 intake（不碰任何按鈕）→ #/conv 出現 job + watcher Panel triggered≥1。
//
// *** 誠實標記：STUB MINIO + STUB CONVERSION API ***
//   真 MinIO（192.168.20.234:9000）需唯讀 credentials（使用者提供入 env，屬 P7 部署區驗證）；
//   真 conversion 需 host-native GPU runtime。本機 E2E 起本機 stub：
//   - fake S3 stub：http server 回 ListObjectsV2 XML，可程式化注入物件；presigned GET 由 SDK 簽 URL
//     （指向 stub）。watcher 對 stub list → derive → loopback intake。
//   - stub conversion：回 202 queued（job 進 dispatched/queued 級即達 vertical slice 目標）。
//   截圖落 artifacts/e2e/minio-watch-auto-intake-*；evidence summary 標 STUB MINIO + STUB CONVERSION。
//
// *** conditional-skip 限制明文（比照 conversion-artifact-id-sanitize.spec.ts:27-36 先例）***
//   beforeAll 守門（dist-ui 未 build → test.skip）是 conditional skip：Playwright 語意裡 skip != fail。
//   若丟進不保證前置（不 build:ui / 不起 coordinator）的環境會靜默全 skip 仍綠 → 假信心。
//   本 repo .github/workflows 僅 pr-review-agent.yml，無任何 Playwright job，故此 skip 設計不 false-green
//   任何既有自動化 gate。本 spec 屬本機 / 指揮官手動 gate。

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_REPO_DIR = path.resolve(TEST_DIR, "..");
const COORDINATOR_REPO_DIR = path.resolve(VIEWER_REPO_DIR, "..", "bim-review-coordinator");
const CONSOLE_DIST_DIR = path.resolve(VIEWER_REPO_DIR, "dist-ui");
const WEBHOOK_SECRET = "dev-webhook-secret";

interface S3Obj { key: string; etag: string; }
const s3State: { objs: S3Obj[] } = { objs: [{ key: "899/baseline/model.ifc", etag: "base1" }] };

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
  if (!a || typeof a === "string") throw new Error("stub bind");
  return a.port;
}

async function startS3Stub(): Promise<number> {
  s3Stub = http.createServer((req, res) => {
    if (req.url?.includes("list-type=2") || req.method === "GET") {
      // ListObjectsV2 或 presigned GET（GET object）皆回 200；object body 給最小 IFC 讓下載不致硬卡。
      if (req.url && /\/bim-control\/.+\/model\.ifc/.test(req.url)) {
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(listObjectsXml(s3State.objs));
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
      res.end(JSON.stringify({ conversion_job_id: "stream_conv_mw_e2e", status: "queued", authority: "bim-streaming-server" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "not found" }));
  });
  return listenOnRandomPort(convStub);
}

// afterAll 收尾：Windows 下 spawn 用 shell:true，coordinatorProc 指向 cmd.exe；單發 SIGTERM 只殺
// shell，真正 bind port 的 node 子進程會變孤兒續占 freePort，重跑時新 coordinator bind 失敗 / waitForHealth
// 逾時（見 I1）。Windows 改用 taskkill /F /T 連同子樹一起殺；Unix 維持 SIGTERM。
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
  // Unix：SIGTERM 是 signal 送出即回，非等進程真正退出。若不 await-on-exit，afterAll 緊接的
  // fs.rmSync(tmpRoot) 可能在 coordinator async shutdown（shutdown.ts）仍寫 SESSION_STORE_DIR /
  // EVENT_LOG_DIR（皆在 tmpRoot 下）時觸發，在有 file-lock 語意的 CI 上造成清理失敗遺留 tmp。
  // 等 exit 事件（3s 上限保護，逾時即放行避免測試卡住）後再 return。
  await new Promise<void>((resolve) => {
    const cap = setTimeout(resolve, 3000);
    proc.once("exit", () => { clearTimeout(cap); resolve(); });
    try { proc.kill("SIGTERM"); } catch { clearTimeout(cap); resolve(); }
  });
}

// earlyExit：coordinator 提早死掉（最常見＝freePort 在 close 與 coordinator bind 之間被別人搶走的
// TOCTOU race，src/index.ts 觸 EADDRINUSE 退出，見 I2）時的明確訊息來源。沒有它時 waitForHealth 會
// 沉默等滿 60s 才以無脈絡訊息逾時；有它時改為帶 stderr 尾段 fail-fast，方便人工判斷是否撞 port。
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

test.describe("MinIO watcher 自動 intake（STUB MINIO + STUB CONVERSION）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );
    // s3State 是模組頂層可變單例（L34），test 內以 push 注入 988（L224）會永久改動該物件。
    // PW 1.60 的 --repeat-each 每輪 fresh-import 模組（已實測 moduleLoadId 每輪不同），故目前不跨輪洩漏；
    // 但為避免「未來 PW 版本改為重用模組」或「本 describe 日後新增第二個 test」時，殘留的 988 被下一輪
    // watcher 首掃當成 baseline（baseline_count≠1 且 triggered_total 卡 0 的靜默失敗），在守門之後顯式重置
    // 回單一 baseline 物件，讓每次執行都從乾淨狀態起跑（defense-in-depth，與 L34 初值一致）。
    s3State.objs = [{ key: "899/baseline/model.ifc", etag: "base1" }];
    const s3Port = await startS3Stub();
    const convPort = await startConvStub();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minio-watch-e2e-"));

    const freePort = await new Promise<number>((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        if (!addr || typeof addr === "string") { reject(new Error("no free port")); return; }
        const p = addr.port; srv.close(() => resolve(p));
      });
    });
    coordinatorBase = `http://127.0.0.1:${freePort}`;

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
      STORAGE_ROOT: path.join(tmpRoot, "storage"),
      LOG_ROOT: path.join(tmpRoot, "logs"),
      // watcher opt-in：指向本機 fake S3 stub、interval 調短。
      MINIO_WATCH_ENABLED: "true",
      MINIO_WATCH_ENDPOINT: `http://127.0.0.1:${s3Port}`,
      MINIO_WATCH_BUCKET: "bim-control",
      MINIO_WATCH_ACCESS_KEY: "ak",
      MINIO_WATCH_SECRET_KEY: "sk",
      // 1s 輪詢：config.ts 預設把 interval 夾到 10s 下限（防忙迴圈），不降檔則 baseline+第二輪
      // 最長合計 20s，在繁忙/cold-start 機器逼近 180s setTimeout 上限有逾時風險（見 C1）。
      // MINIO_WATCH_INTERVAL_FLOOR_SECONDS=1 是 config.ts 提供的唯一降檔入口（production 不設＝floor 10
      // 不變），讓 spawn 出的 coordinator 真的以 1s 輪詢，baseline 與注入後觸發各最長 1s。
      MINIO_WATCH_INTERVAL_SECONDS: "1",
      MINIO_WATCH_INTERVAL_FLOOR_SECONDS: "1",
    };

    const tsxBin = path.join(COORDINATOR_REPO_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    coordinatorProc = spawn(tsxBin, ["src/index.ts"], {
      cwd: COORDINATOR_REPO_DIR, env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32",
    });
    // I2：留最近 stderr 尾段並記 exit code。freePort 探測（listen(0)→close）與 coordinator 實際 bind
    // 之間有 TOCTOU 窗，被搶占時 src/index.ts 觸 EADDRINUSE 退出。把退出轉成 waitForHealth 的 earlyExit
    // 訊號，連同 stderr 尾段 fail-fast，取代沉默 60s 逾時。
    let stderrTail = "";
    let coordinatorExited: number | null = null;
    coordinatorProc.stdout?.on("data", (d) => process.stdout.write(`[coordinator] ${d}`));
    coordinatorProc.stderr?.on("data", (d) => {
      process.stderr.write(`[coordinator:err] ${d}`);
      stderrTail = (stderrTail + String(d)).slice(-1200);
    });
    coordinatorProc.on("exit", (code) => { coordinatorExited = code ?? -1; });
    await waitForHealth(coordinatorBase, {
      earlyExit: () =>
        coordinatorExited === null
          ? null
          : `coordinator 在 health ready 前提早退出（code=${coordinatorExited}），疑似 ${freePort} 埠被搶占（I2 TOCTOU）。stderr 尾段：\n${stderrTail.trim() || "（無 stderr）"}`,
    });
  });

  test.afterAll(async () => {
    if (coordinatorProc) { await stopCoordinator(coordinatorProc); coordinatorProc = null; }
    for (const s of [s3Stub, convStub]) { if (s) await new Promise<void>((r) => s.close(() => r())); }
    s3Stub = null; convStub = null;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("stub 注入新物件 → watcher 自動 intake → #/conv 出現 job + Panel triggered≥1（不碰按鈕）", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 1) 等 watcher baseline 完成（baseline_count=1，base 物件登 seen 不觸發）。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json()).baseline_count;
      }, { timeout: 30_000 }).toBe(1);

      // 2) 注入新物件（baseline 之後）→ 下一輪 watcher 自動觸發 intake。全程不碰任何按鈕。
      s3State.objs.push({ key: "988/auto/model.ifc", etag: "auto9" });

      // 3) backend 真實狀態先確認（user-facing 之前）：job 進 store + watcher triggered≥1。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/ifc-ready?limit=50`);
        const items = (await r.json()).items as Array<{ project_id: string }>;
        return items.some((j) => j.project_id === "988");
      }, { timeout: 30_000 }).toBe(true);
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json()).triggered_total;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

      // 4) 前端：開 #/conv（coordinator 同源 /ui）。仍不碰按鈕——但 ConversionSchedulingPage useEffect
      //    首掛載即自動 load（listIfcReady + minioWatchStatus），故 reload 後資料自動出現。
      await page.goto(`${coordinatorBase}/ui#/conv`);

      // 5) MinIO 自動偵測 Panel：啟用中 + triggered≥1（UI 直接斷言，不只後端對帳）。
      const panel = page.getByTestId("minio-watch-panel");
      await expect(panel).toBeVisible({ timeout: 20_000 });
      await expect(panel).toContainText("啟用中", { timeout: 20_000 });
      // pages.tsx:336 把 triggered 渲染進「baseline / seen / 觸發 / 跳過」Field 的 .ec-v
      //（格式 `${baseline} / ${seen} / ${triggered} / ${skipped}`）。後端步驟 3 已確認 triggered_total≥1，
      //   故此值在 page.goto 後確定性渲染。鎖該 Field 的值欄、斷言第 3 槽（觸發）為非零整數，
      //   讓「Panel triggered≥1」由 UI 層直接驗證，而非僅 backend API 對帳。
      const triggeredField = panel
        .locator(".ec-field", { hasText: "baseline / seen / 觸發 / 跳過" })
        .locator(".ec-v");
      await expect(triggeredField).toBeVisible({ timeout: 20_000 });
      // .ec-v 內容為 `${baseline} / ${seen} / ${triggered} / ${skipped}` + 空白 + ProvTag 文字（如「已實作」），
      //   故用 containText + 不錨末尾的 regex：第 3 槽（觸發）= [1-9]\d*（非零）。
      await expect(triggeredField).toContainText(/\d+\s*\/\s*\d+\s*\/\s*[1-9]\d*\s*\/\s*\d+/);

      // 6) Ifc-ready jobs 表：988 的 job 自動出現（watcher 建立，非手動註冊）。
      //    須 scope 到「Ifc-ready jobs」Panel——另有 MinIO 自動偵測 triggered 表的列文字含
      //    `988/auto/model.ifc`（子字串也含 "988"），若不限定 Panel 會誤命中該表。
      //    project 欄是「正好 988」（非 988/auto/...），故 cell 用 /^988$/ 精確匹配。
      const ifcReadyPanel = page.locator("section.ec-panel", { hasText: "Ifc-ready jobs" });
      const row988 = ifcReadyPanel
        .locator("table.ec-table tbody tr")
        .filter({ has: page.locator("td", { hasText: /^988$/ }) });
      await expect(row988.first()).toBeVisible({ timeout: 20_000 });
      // job 狀態須達 dispatched/queued 級：pages.tsx:357 表頭欄序為
      //   job / project / conversion / dispatch / session / stage，conversion 欄（第 3 td，nth(2)）
      //   渲染 j.conversion_status。watcher 自動派工後 markDispatched 把 conv stub 回的 status="queued"
      //   存進 conversion_status，故此欄顯示 "queued"。直接斷言該欄=queued，確認 job 進 dispatched/queued 級
      //   而非僅「有一列含 988」。
      await expect(row988.first().locator("td").nth(2)).toContainText("queued", { timeout: 20_000 });

      await page.screenshot({ path: "../artifacts/e2e/minio-watch-auto-intake-conv.png", fullPage: true });
    } finally {
      await api.dispose();
    }
  });
});
