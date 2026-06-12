import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * IMPORTANT — .env.example ↔ config.ts MINIO_WATCH_* 欄位 parity guard。
 *
 * 背景（deploy-time safety net）：deploy.ps1 Phase 2 的 missing-key merge 以
 * bim-review-coordinator/.env.example 為 key source（preflight-env.ps1 `Get-EnvAudit`：
 * `$missing = @($exampleKeys | Where-Object { $_ -notin $envKeys })`）。若 config.ts 讀取
 * 某個 MINIO_WATCH_* env 但 .env.example 沒有對應 `KEY=` 宣告，部署時：
 *   - deploy.ps1 不會把該 key 補入目標 .env（因為它不在 example key source），
 *   - 也不會報 missing（preflight 只比對 example 與 .env，example 缺就看不到），
 *   - production 操作員從此看不到該欄位，無從知道需要設定。
 *
 * 對 MINIO_WATCH_TENANT_ID 而言尤其危險：config.ts 預設帶 "tenant_demo_001"，
 * 切 tenant 時若沒設此值，watcher intake 會帶錯 tenant（靜默資料污染進 store 與雲端 callback）。
 *
 * 本測試鎖的契約：config.ts 讀取的每一個 MINIO_WATCH_* env，都必須在 .env.example
 * 有一行 `KEY=` 宣告（值可為空），讓 deploy-time missing-key merge 能偵測並提示。
 */
describe(".env.example MINIO_WATCH_* parity（IMPORTANT — deploy-time missing-key safety net）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envExamplePath = path.join(here, "..", ".env.example");
  const envExampleText = readFileSync(envExamplePath, "utf8");

  // config.ts 在 loadConfig() 內讀取的全部 MINIO_WATCH_* env keys（source of truth）。
  // 與 config-minio-watch.test.ts 的 MINIO_KEYS 同一組；任一新增 MINIO_WATCH_* env 讀取
  // 都應同步加入此清單與 .env.example，否則 deploy missing-key merge 會漏。
  const REQUIRED_MINIO_WATCH_KEYS = [
    "MINIO_WATCH_ENABLED",
    "MINIO_WATCH_ENDPOINT",
    "MINIO_WATCH_BUCKET",
    "MINIO_WATCH_PREFIX",
    "MINIO_WATCH_ACCESS_KEY",
    "MINIO_WATCH_SECRET_KEY",
    "MINIO_WATCH_INTERVAL_SECONDS",
    "MINIO_WATCH_INTERVAL_FLOOR_SECONDS",
    "MINIO_WATCH_KEY_SUFFIX",
    "MINIO_WATCH_TENANT_ID",
    "MINIO_WATCH_SELF_BASE_URL",
  ];

  // .env.example 裡實際宣告的 key 集合（行首 `KEY=`，忽略註解行）。
  const declaredKeys = new Set(
    envExampleText
      .split(/\r?\n/)
      .map((line) => {
        const m = /^([A-Z0-9_]+)=/.exec(line.trim());
        return m ? m[1] : null;
      })
      .filter((k): k is string => k !== null),
  );

  it("config.ts 讀取的每個 MINIO_WATCH_* env 都在 .env.example 有 `KEY=` 宣告", () => {
    const missing = REQUIRED_MINIO_WATCH_KEYS.filter((k) => !declaredKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("MINIO_WATCH_TENANT_ID 必須存在且為空值（不給預設值，逼操作員顯式設定避免靜默帶錯 tenant）", () => {
    // 缺漏即 deploy missing-key merge 失效；給預設值則操作員可能誤以為不必設定。
    expect(declaredKeys.has("MINIO_WATCH_TENANT_ID")).toBe(true);
    const tenantLine = envExampleText
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("MINIO_WATCH_TENANT_ID="));
    expect(tenantLine?.trim()).toBe("MINIO_WATCH_TENANT_ID=");
  });
});
