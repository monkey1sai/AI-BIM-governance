import dotenv from "dotenv";
import {
  assertExplicitSeedEnvLoaded,
  parseSeedCliArgs,
  prepareSeedEvidenceDestination,
  resolveSeedEnv,
  runSeed,
  selectSeedEnvSource,
  writeSeedEvidenceAtomic,
} from "./seedIsolatedIfcReady.js";

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
  // 明示 --env-file 時以該檔為權威，避免 shell 內殘留的 MINIO_WATCH_* 靜默蓋過 operator
  // 指定設定而 seed 到錯誤 bucket；未指定時保留 dotenv 的既有 ambient-env 優先語意。
  const dotenvResult = dotenv.config(args.envFile ? { path: args.envFile, override: true } : undefined);
  assertExplicitSeedEnvLoaded(args.envFile, dotenvResult.error);
  const seedEnv = resolveSeedEnv(selectSeedEnvSource({
    explicitEnvFile: args.envFile,
    parsedEnv: dotenvResult.parsed,
    ambientEnv: process.env,
  }));
  // 在 list／presign／intake 之前驗證目的 volume 的 atomic no-clobber publish 能力。
  const evidencePath = args.outPath ? prepareSeedEvidenceDestination(args.outPath) : undefined;

  const record = await runSeed({
    coordinatorBaseUrl: args.coordinatorBaseUrl,
    changeId: args.changeId,
    runId: args.runId,
    requiredKey: args.requiredKey,
    ...seedEnv,
  });

  if (evidencePath) {
    writeSeedEvidenceAtomic(evidencePath, record);
    console.log(`[seed] evidence 已寫入 ${evidencePath}`);
  }
  // 供 E2E 直接擷取：a4-closeout.spec.ts 讀 A4_E2E_IFC_READY_JOB_ID 鎖定同一個 job。
  console.log(`A4_E2E_IFC_READY_JOB_ID=${record.ifc_ready_job_id}`);
}

main().catch((error: unknown) => {
  console.error(`[seed] 失敗：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
