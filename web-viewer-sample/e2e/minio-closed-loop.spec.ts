import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, request as pwRequest } from "@playwright/test";

// minio-closed-loop（minio-folderview-and-baseline-disclosure，2026-06-24 改寫）：端到端四段一致。
// 流程：spawn coordinator（MINIO_WATCH_ENABLED + S3 stub + CONVERSION_LEDGER_STORE_PATH=tmp）
//   → S3 stub 從一開始就有 松風庵/root/main/000001/model.ifc（≥3段，符合 watcher 規約）
//   → §3.4 全自動 auto-enroll：watcher 首輪即對 ledger 無紀錄的既有物件觸發 intake（取代舊「注入新物件才觸發」
//     的 delta 模型——app.ts 無條件注入 isLedgered，production 走 ledger 去重水印）
//   → ledger 落 queued
//   → #/minio 逐層資料夾導覽（S3 Delimiter='/'）：頂層見 松風庵/ 資料夾 → 點入 root/→main/→000001/
//     → 葉層見 model.ifc（來源 IFC role）+ ledger chip「排隊」（stub 無 .usdc → 不偽稱已轉 USDC）
//   → 同頁 GlobalConversionPane（#303 IA 合併後 ledger/watcher 面板在 #/minio，#/conv 只剩轉檔歷史）：
//     watcher 啟用中 + Ifc-ready 佇列出現 job（conversion=queued）+ 診斷 triggered≥1
//   → **全程無假 ready、無捏造 coverage**
//
// *** 誠實標記：STUB MINIO + STUB CONVERSION API ***
//   S3 stub 模擬真實 S3 ListObjectsV2 的 Delimiter='/' 分組（回 CommonPrefixes 資料夾節點 + 當層直屬
//   Contents），讓 coordinator 的 listMinioFolder 逐層 list 如同真 MinIO。stub 只回 .ifc、無 .usdc →
//   MinioDataPage chip 顯 ledger 狀態（排隊），不偽稱已轉。Conv stub 回 202 queued（watcher dispatch
//   完成，非真轉檔）。ledger status=queued，不得出現 ready（Phase 2 才回填）。
//   截圖落 artifacts/e2e/minio-folderview-*。
//
// *** conditional-skip 適用 ***：dist-ui 未 build → test.skip；本 repo 無自動化 Playwright CI gate。

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

// 模擬真實 S3 ListObjectsV2：依 query 的 prefix + delimiter 分組。
// - delimiter='/'（getMinioFolder 逐層 list）：回當層直屬 <Contents> + <CommonPrefixes>（下一段資料夾）。
// - 無 delimiter（watcher listAllKeys / prefixHasSourceIfc 遞迴 probe）：回 prefix 下全部 <Contents>。
function s3ListXml(reqUrl: string): string {
  const u = new URL(reqUrl, "http://stub");
  const prefix = u.searchParams.get("prefix") ? decodeURIComponent(u.searchParams.get("prefix")!) : "";
  const delimiter = u.searchParams.get("delimiter") || "";
  const matching = s3State.objs.filter((o) => o.key.startsWith(prefix));
  let contents = matching;
  let cpsXml = "";
  if (delimiter === "/") {
    const cps = new Set<string>();
    const direct: S3Obj[] = [];
    for (const o of matching) {
      const rest = o.key.slice(prefix.length);
      const i = rest.indexOf("/");
      if (i === -1) direct.push(o); // 當層直屬檔
      else cps.add(prefix + rest.slice(0, i + 1)); // 下一段資料夾（絕對 prefix）
    }
    contents = direct;
    cpsXml = [...cps].map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join("");
  }
  const contentsXml = contents
    .map((o) => `<Contents><Key>${o.key}</Key><ETag>&quot;${o.etag}&quot;</ETag><Size>10</Size></Contents>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>bim-control</Name><IsTruncated>false</IsTruncated>${cpsXml}${contentsXml}</ListBucketResult>`;
}

async function listenOnRandomPort(server: http.Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("stub bind failed");
  return a.port;
}

async function startS3Stub(): Promise<number> {
  s3Stub = http.createServer((req, res) => {
    // 物件 GET（presigned URL，/bim-control/.../model.ifc，非 list-type=2）→ 回最小 IFC stub body。
    if (req.url && /\/bim-control\/.+\/model\.ifc/.test(req.url) && req.method === "GET" && !req.url.includes("list-type=2")) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
      return;
    }
    // ListObjectsV2 → 依 prefix/delimiter 模擬真 S3 分組。
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(s3ListXml(req.url || ""));
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

// Windows taskkill 對 spawn 出的 cmd.exe wrapper 的子樹整體殺。
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

test.describe("MinIO 閉環四段一致 + 逐層資料夾導覽（STUB MINIO + STUB CONVERSION）", () => {
  test.setTimeout(180_000);

  test.beforeAll(async () => {
    test.skip(
      !fs.existsSync(path.join(CONSOLE_DIST_DIR, "index.html")),
      "dist-ui 未 build；先跑 `cd web-viewer-sample && npm run build:ui` 再執行本 spec。",
    );
    // §3.4 auto-enroll：物件從一開始就在 bucket。ledger 空 → watcher 首輪即觸發 intake（既有未轉檔自動補轉）。
    // 松風庵/root/main/000001/model.ifc：4段，category=main（倒數二），version=000001（末段）。
    s3State.objs = [{ key: "松風庵/root/main/000001/model.ifc", etag: "shofuan1" }];

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

  test("四段一致：auto-enroll 觸發 → ledger queued → #/minio 逐層導覽到 model.ifc（來源IFC+排隊chip）→ 同頁轉檔面板 紀錄+啟用中+無假 ready", async ({ page }) => {
    const api = await pwRequest.newContext();
    try {
      // 1) §3.4 auto-enroll：watcher 首輪即對 ledger 無紀錄的既有物件觸發（triggered_total≥1）。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/external/minio-watch/status`);
        return (await r.json() as { triggered_total: number }).triggered_total;
      }, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

      // 2) 後端真實狀態確認：/api/conversion/records 出現 000001 版本的 queued 紀錄。
      await expect.poll(async () => {
        const r = await api.get(`${coordinatorBase}/api/conversion/records`);
        const body = await r.json() as { items: Array<{ external_model_version_id: string; status: string }> };
        return body.items.some((rec) => rec.external_model_version_id === "000001");
      }, { timeout: 30_000 }).toBe(true);

      // 3) 斷言一：#/minio 逐層資料夾導覽（S3 Delimiter='/'）。
      //    首幀 prefix=''：只見資料夾節點 松風庵/（非攤平樹）；逐層點入才到 model.ifc。
      await page.goto(`${coordinatorBase}/ui#/minio`);

      // 頂層：松風庵/ 資料夾鈕可見（含 source IFC badge，prefixHasSourceIfc 遞迴 probe 命中 .ifc）。
      await expect(page.getByTestId("minio-folder-open-松風庵/")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("minio-folder-badge-松風庵/")).toBeVisible({ timeout: 10_000 });
      // 逐層導覽（非攤平）：頂層只有資料夾節點，無物件級 chip（物件要逐層下行才出現）。
      // 註：body 文字層含 DEMO「Bucket layout 示意」Panel（規約說明，含 來源 IFC/model.ifc 模板字樣），
      // 故不以 body 文字斷言物件不存在；改用物件專屬 testid（minio-chip-*）計數＝0 精準驗（不受 DEMO 干擾）。
      await expect(page.locator('[data-testid^="minio-chip-"]')).toHaveCount(0);
      await page.screenshot({ path: "../artifacts/e2e/minio-folderview-toplevel.png", fullPage: true });

      // 逐層下行：松風庵/ → root/ → main/ → 000001/（每層點資料夾鈕換 prefix 重打 getMinioFolder）。
      await page.getByTestId("minio-folder-open-松風庵/").click();
      await page.getByTestId("minio-folder-open-松風庵/root/").click();
      await page.getByTestId("minio-folder-open-松風庵/root/main/").click();
      await page.getByTestId("minio-folder-open-松風庵/root/main/000001/").click();

      // 葉層：物件 chip 出現＝drill-down 已到 model.ifc 物件層（物件專屬 testid，不受 DEMO Panel 干擾）。
      const leafChip = page.locator('[data-testid^="minio-chip-"]').first();
      await expect(leafChip).toBeVisible({ timeout: 15_000 });
      // chip = 排隊：auto-enroll 已落 ledger queued，ledgerChipStatus 以 idempotency_key 命中該紀錄。
      await expect(leafChip).toContainText("排隊", { timeout: 15_000 });
      // 誠實鐵律：stub 無 .usdc → 不偽稱已轉 USDC（roleLabel parsed_usdc 字樣不應出現於物件列）。
      await expect(page.locator("body")).not.toContainText("已轉 USDC");
      await page.screenshot({ path: "../artifacts/e2e/minio-folderview-leaf.png", fullPage: true });

      // 4) 斷言二（#303/#304 IA 合併後，ledger/watcher 面板在 #/minio 的 GlobalConversionPane；
      //    舊 conv-ledger-panel 已不存在，#/conv 只剩轉檔歷史）：同頁直接斷言，不另 goto。
      // minio-watch-panel：watcher 啟用中（MINIO_WATCH_ENABLED=true）。
      const mwPanel = page.getByTestId("minio-watch-panel");
      await expect(mwPanel).toBeVisible({ timeout: 15_000 });
      await expect(mwPanel).toContainText("啟用中", { timeout: 15_000 });

      // Ifc-ready jobs 佇列表：auto-enroll 建立的 job（project 欄渲染「松風庵 · main」），
      // conversion 欄（表頭 job/key/lifecycle/project/usdc/conversion/… 的 nth(5)）= conv stub 回的 queued。
      const jobsPanel = page.locator("section.ec-panel", { hasText: "Ifc-ready jobs" });
      const rowShofuan = jobsPanel
        .locator("table.ec-table tbody tr")
        .filter({ has: page.locator("td", { hasText: "松風庵" }) });
      await expect(rowShofuan.first()).toBeVisible({ timeout: 15_000 });
      await expect(rowShofuan.first().locator("td").nth(5)).toContainText("queued", { timeout: 15_000 });

      // watcher 診斷欄位在 <details data-testid="md-pipeline-details"> 內，先展開再斷言 triggered≥1。
      await page.getByTestId("md-pipeline-details").locator("summary").click();
      await expect(page.getByTestId("conv-triggered-total")).toHaveText(/^[1-9]\d*$/, { timeout: 15_000 });

      // 誠實鐵律：stub 無真轉檔 → ready 統計必為 0（ready Phase 2 才回填，Phase 1 禁假 ready）。
      await expect(page.getByTestId("md-stat-ready")).toHaveText("0");

      await page.screenshot({ path: "../artifacts/e2e/minio-folderview-conv.png", fullPage: true });
    } finally {
      await api.dispose();
    }
  });
});
