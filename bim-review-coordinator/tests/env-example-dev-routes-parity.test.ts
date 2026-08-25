import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * unified-console-runtime-truth slice 2 task 4.4(owner D3 裁決):ENABLE_DEV_ROUTES 的 deploy-time
 * parity guard,沿用 env-example-lineage-parity.test.ts(PR #693)模式。
 *
 * deploy.ps1 Phase 2 的 missing-key merge 以 .env.example 為 key source;compose.host-kit.yml 又是
 * dockerized coordinator 唯一的 env 透傳管道(.env 不掛進容器)。兩處缺任一,canonical-linux 的
 * `ENABLE_DEV_ROUTES=false` 就會靜默失效(容器內未定義=dev routes 開)。
 *
 * 讀取點 source of truth:src/app.ts 的 `process.env.ENABLE_DEV_ROUTES`(devRoutesEnabled)。
 * owner 動作(AI 不讀不改任何 .env*):.env.example 只留一行 `ENABLE_DEV_ROUTES=`(空=維持開啟;
 * canonical-linux 由 owner 在私有 canonical env 設 false)。
 *
 * 2026-08-25 實測狀態(C — 已宣告但重複衝突,非「尚未宣告」):.env.example 有兩行 ENABLE_DEV_ROUTES,
 * L66 `=true`(e1c3578／PR #222 舊宣告)排在 L75 `=`(ded6901 owner 追加的空值)之前。
 * scripts/lib/preflight-env.ps1 的 Get-EnvExampleDefaultValue(首個非註解相符行即 return)與本測試
 * 同為 first-match-wins,取到的是 L66 的 `true`,missing-key merge 會把 `true` 寫進所有部署目標,
 * 這道 guard 因此形同虛設。owner 刪掉 L66 前,「必須為空值」與「只宣告一次」兩個 it 預期為紅——
 * 這是要交付給 owner 的誠實訊號,不是要繞過的失敗;AI 一律不修 .env*(計畫檔 Task 3B Step 2 (C) 停手規則)。
 */
describe(".env.example ↔ compose.host-kit.yml ↔ app.ts ENABLE_DEV_ROUTES parity(IMPORTANT — deploy-time missing-key safety net)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envExampleText = readFileSync(path.join(here, "..", ".env.example"), "utf8");
  const appSrc = readFileSync(path.join(here, "..", "src", "app.ts"), "utf8");
  const composeText = readFileSync(path.join(here, "..", "..", "compose.host-kit.yml"), "utf8");

  const envLines = envExampleText.split(/\r?\n/).map((line) => line.trim());
  const declaredKeys = new Set(
    envLines
      .map((line) => {
        const m = /^([A-Z0-9_]+)=/.exec(line);
        return m ? m[1] : null;
      })
      .filter((k): k is string => k !== null),
  );
  const lineValue = (key: string): string | null => {
    const line = envLines.find((candidate) => candidate.startsWith(`${key}=`));
    return line === undefined ? null : line.slice(key.length + 1);
  };
  const declarationsOf = (key: string): { lineNumber: number; text: string }[] =>
    envExampleText
      .split(/\r?\n/)
      .map((text, index) => ({ lineNumber: index + 1, text: text.trim() }))
      .filter((entry) => entry.text.startsWith(`${key}=`));
  const appReadKeys = Array.from(new Set(Array.from(appSrc.matchAll(/process\.env\.(ENABLE_DEV_ROUTES)/g)).map((m) => m[1])));

  it("app.ts 恰有一個 ENABLE_DEV_ROUTES 讀取點(devRoutesEnabled)", () => {
    expect(appReadKeys).toEqual(["ENABLE_DEV_ROUTES"]);
    expect(appSrc.match(/process\.env\.ENABLE_DEV_ROUTES/g)).toHaveLength(1);
  });

  it("app.ts 讀取的 ENABLE_DEV_ROUTES 在 .env.example 有 `ENABLE_DEV_ROUTES=` 宣告且為空值(owner 動作;落地前預期紅)", () => {
    for (const key of appReadKeys) {
      expect(declaredKeys.has(key), `${key} 未在 .env.example 宣告(owner 需加 \`${key}=\`)`).toBe(true);
      expect(lineValue(key), `${key} 在 .env.example 必須為空值:帶 false 會被 missing-key merge 寫進所有部署目標`).toBe("");
    }
  });

  it("ENABLE_DEV_ROUTES 在 .env.example 只宣告一次(重複鍵會讓 first-match-wins 的 missing-key merge 取到過期值;落地前預期紅)", () => {
    for (const key of appReadKeys) {
      const declarations = declarationsOf(key);
      const inventory = declarations.map((entry) => `L${entry.lineNumber}:${entry.text}`).join(" / ");
      expect(
        declarations.length,
        `${key} 在 .env.example 出現 ${declarations.length} 次(${inventory});` +
          `scripts/lib/preflight-env.ps1 的 Get-EnvExampleDefaultValue 與本測試同為 first-match-wins,` +
          `排在前面的過期宣告會蓋掉後面的空值宣告,parity guard 因此失去意義。` +
          `owner 待辦:刪掉過期的重複行,只留一行 \`${key}=\`(空值)。AI 不讀不改任何 .env*。`,
      ).toBe(1);
    }
  });

  it("compose.host-kit.yml coordinator environment 透傳 ENABLE_DEV_ROUTES(未設=空=維持開啟)", () => {
    expect(composeText).toContain("ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}");
  });
});
