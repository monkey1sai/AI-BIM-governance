import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * IMPORTANT — .env.example ↔ config.ts lineage governed env parity guard。
 *
 * 與 env-example-minio-watch-parity.test.ts 同一個 deploy-time safety net：
 * deploy.ps1 Phase 2 的 missing-key merge 以 .env.example 為 key source。
 * config.ts 讀取的 lineage governed env（GOVERNED_SOURCE_*、
 * LINEAGE_DOWNLOAD_TARGET_POLICIES）若缺 `KEY=` 宣告，部署時不會補入目標
 * .env、也不會報 missing，操作員從此看不到該欄位。
 *
 * 對 LINEAGE_DOWNLOAD_TARGET_POLICIES 而言：未設定＝空清單＝下載面
 * fail-closed（app.ts 的刻意設計）。這是安全的預設，但操作員必須「看得到
 * 這個 key 存在」才知道開通下載面要設定什麼——parity 缺漏會把 fail-closed
 * 從「已知待開通」變成「不可見的死路」。
 */
describe(".env.example lineage governed env parity（IMPORTANT — deploy-time missing-key safety net）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envExampleText = readFileSync(path.join(here, "..", ".env.example"), "utf8");
  const configSrc = readFileSync(path.join(here, "..", "src", "config.ts"), "utf8");

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

  const lineValue = (key: string): string | null => {
    const line = envExampleText
      .split(/\r?\n/)
      .find((candidate) => candidate.trim().startsWith(`${key}=`));
    return line === undefined ? null : line.trim().slice(key.length + 1);
  };

  // config.ts 讀取點的 source of truth（動態掃描，防清單自身成為盲點）。
  const scanConfigKeys = (pattern: RegExp): Set<string> =>
    new Set(Array.from(configSrc.matchAll(pattern)).map((m) => m[0]));

  const REQUIRED_GOVERNED_SOURCE_KEYS = [
    "GOVERNED_SOURCE_MINIO_ENDPOINT",
    "GOVERNED_SOURCE_MINIO_ACCESS_KEY",
    "GOVERNED_SOURCE_MINIO_SECRET_KEY",
    "GOVERNED_SOURCE_AUTHORITY_ALLOWLIST",
    "GOVERNED_SOURCE_BUCKET_ALLOWLIST",
    "GOVERNED_SOURCE_PREFIX",
  ];

  it("config.ts 讀取的每個 GOVERNED_SOURCE_* env 都在 .env.example 有 `KEY=` 宣告", () => {
    const missing = REQUIRED_GOVERNED_SOURCE_KEYS.filter((k) => !declaredKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("LINEAGE_DOWNLOAD_TARGET_POLICIES 在 .env.example 有宣告且為空值（未設＝下載面 fail-closed 是刻意預設；帶值會被 missing-key merge 寫進生產）", () => {
    expect(declaredKeys.has("LINEAGE_DOWNLOAD_TARGET_POLICIES")).toBe(true);
    expect(lineValue("LINEAGE_DOWNLOAD_TARGET_POLICIES")).toBe("");
  });

  it("GOVERNED_SOURCE_MINIO_ACCESS_KEY / SECRET_KEY 宣告必須為空值（.env.example 不得攜帶任何 credential 預設）", () => {
    for (const key of ["GOVERNED_SOURCE_MINIO_ACCESS_KEY", "GOVERNED_SOURCE_MINIO_SECRET_KEY"]) {
      expect(declaredKeys.has(key), `${key} 未宣告`).toBe(true);
      expect(lineValue(key), `${key} 不得帶預設值`).toBe("");
    }
  });

  it("config.ts 的 GOVERNED_SOURCE_* 讀取點與 REQUIRED 清單三方一致（反向 parity）", () => {
    const configKeys = scanConfigKeys(/GOVERNED_SOURCE_[A-Z0-9_]+/g);
    const required = new Set(REQUIRED_GOVERNED_SOURCE_KEYS);
    for (const k of configKeys) {
      expect(required.has(k), `config.ts 讀取 ${k} 但 REQUIRED_GOVERNED_SOURCE_KEYS 未列`).toBe(true);
    }
    for (const k of REQUIRED_GOVERNED_SOURCE_KEYS) {
      expect(configKeys.has(k), `REQUIRED 列了 ${k} 但 config.ts 未讀取`).toBe(true);
    }
  });

  it("config.ts 的 LINEAGE_DOWNLOAD_* 讀取點恰為 TARGET_POLICIES 一個（新增 key 必須同步本測試與 .env.example）", () => {
    const configKeys = scanConfigKeys(/LINEAGE_DOWNLOAD_[A-Z0-9_]+/g);
    expect(Array.from(configKeys).sort()).toEqual(["LINEAGE_DOWNLOAD_TARGET_POLICIES"]);
  });
});
