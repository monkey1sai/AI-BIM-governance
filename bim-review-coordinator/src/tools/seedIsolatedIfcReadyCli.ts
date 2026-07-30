import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { parseSeedCliArgs, resolveSeedEnv, runSeed } from "./seedIsolatedIfcReady.js";

/**
 * `seedIsolatedIfcReady` 的 CLI 外殼。
 *
 * 與函式庫分檔的理由：`dotenv.config()` 與 `process.exit` 是行程層副作用，放進函式庫會讓
 * 單元測試在 import 當下就吃到本機 `.env`，測試結果隨機器而異。本檔只做「讀設定 → 呼叫
 * runSeed → 落檔」，解析與驗證邏輯都在函式庫且已被單元測試覆蓋。
 *
 * MinIO 連線參數沿用 coordinator 既有的 `MINIO_WATCH_*` env 名稱：隔離 stack 的 coordinator
 * 由 `config.ts` 的 `dotenv.config()` 讀同一組名稱，seed 與被 seed 的服務因此指向同一個真實
 * bucket，不需要第二套設定，credentials 也不會落進 tracked 檔。
 */
async function main(): Promise<void> {
  const args = parseSeedCliArgs(process.argv.slice(2));
  // worktree 內不存在 untracked 的 .env，故允許明示指向可用設定檔；未指定時沿用 cwd 的 .env。
  dotenv.config(args.envFile ? { path: args.envFile } : undefined);
  const seedEnv = resolveSeedEnv(process.env);

  const record = await runSeed({
    coordinatorBaseUrl: args.coordinatorBaseUrl,
    changeId: args.changeId,
    runId: args.runId,
    requiredKey: args.requiredKey,
    ...seedEnv,
  });

  if (args.outPath) {
    const resolved = path.resolve(args.outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(`[seed] evidence 已寫入 ${resolved}`);
  }
  // 供 E2E 直接擷取：a4-closeout.spec.ts 讀 A4_E2E_IFC_READY_JOB_ID 鎖定同一個 job。
  console.log(`A4_E2E_IFC_READY_JOB_ID=${record.ifc_ready_job_id}`);
}

main().catch((error: unknown) => {
  console.error(`[seed] 失敗：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
