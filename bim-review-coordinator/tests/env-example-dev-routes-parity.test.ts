import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * unified-console-runtime-truth slice 2 task 4.4（owner D3 裁決）：ENABLE_DEV_ROUTES／DEV_AUTH_TOKEN 的
 * deploy-time parity guard，沿用 env-example-lineage-parity.test.ts（PR #693）模式並擴到 canonical 路徑。
 *
 * 讀取點 source of truth：src/app.ts 的 `process.env.ENABLE_DEV_ROUTES`（devRoutesEnabled）。
 * 容器內 env 只來自 compose `environment:`（.dockerignore 排除 .env／.env.*），compose 變數替換來源是
 * `--env-file .env.web-plane.host-kit`（scripts/deploy.ps1），其 missing-key merge 的 key source 是
 * `.env.web-plane.host-kit.example`（scripts/lib/preflight-env.ps1）。因此 guard 必須同時釘住：
 *   (1) bim-review-coordinator/.env.example（本 sub-repo 本機執行的 key source）恰宣告一次且為空值；
 *   (2) compose.host-kit.yml coordinator environment 透傳 `ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}`；
 *   (3) .env.web-plane.host-kit.example（canonical 路徑 missing-key source）宣告 ENABLE_DEV_ROUTES=（空）與 DEV_AUTH_TOKEN=；
 *   (4) .env.web-plane.host-kit.canonical-linux.example 宣告 ENABLE_DEV_ROUTES=false 與 DEV_AUTH_TOKEN=（不放真值）。
 * 真值（canonical-linux 的 false 與非預設 token）只存在 owner 私有 env；本測試不讀任何私有 env。
 */
describe("ENABLE_DEV_ROUTES／DEV_AUTH_TOKEN deploy-time parity（IMPORTANT — missing-key safety net on both key sources）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(here, "..", "..");
  const read = (...parts: string[]): string => readFileSync(path.join(...parts), "utf8");
  const envExampleText = read(here, "..", ".env.example");
  const appSrc = read(here, "..", "src", "app.ts");
  const composeText = read(repoRoot, "compose.host-kit.yml");
  const webPlaneExampleText = read(repoRoot, ".env.web-plane.host-kit.example");
  const canonicalLinuxExampleText = read(repoRoot, ".env.web-plane.host-kit.canonical-linux.example");

  const declarationsIn = (text: string, key: string): { lineNumber: number; text: string }[] =>
    text
      .split(/\r?\n/)
      .map((line, index) => ({ lineNumber: index + 1, text: line.trim() }))
      .filter((entry) => entry.text.startsWith(`${key}=`));
  const valueIn = (text: string, key: string): string | null => {
    const first = declarationsIn(text, key)[0];
    return first === undefined ? null : first.text.slice(key.length + 1);
  };
  const expectDeclaredOnce = (label: string, text: string, key: string, expectedValue: string | null) => {
    const declarations = declarationsIn(text, key);
    const inventory = declarations.map((entry) => `L${entry.lineNumber}:${entry.text}`).join(" / ");
    expect(
      declarations.length,
      `${key} 在 ${label} 出現 ${declarations.length} 次（${inventory}）；missing-key merge 與本測試皆 first-match-wins，必須恰宣告一次。`,
    ).toBe(1);
    if (expectedValue !== null) {
      expect(valueIn(text, key), `${key} 在 ${label} 的值必須為「${expectedValue}」`).toBe(expectedValue);
    }
  };
  const appReadKeys = Array.from(new Set(Array.from(appSrc.matchAll(/process\.env\.(ENABLE_DEV_ROUTES)/g)).map((m) => m[1])));

  it("app.ts 恰有一個 ENABLE_DEV_ROUTES 讀取點（devRoutesEnabled）", () => {
    expect(appReadKeys).toEqual(["ENABLE_DEV_ROUTES"]);
    expect(appSrc.match(/process\.env\.ENABLE_DEV_ROUTES/g)).toHaveLength(1);
  });

  it("bim-review-coordinator/.env.example 恰宣告一次 ENABLE_DEV_ROUTES= 且為空值", () => {
    for (const key of appReadKeys) expectDeclaredOnce("bim-review-coordinator/.env.example", envExampleText, key, "");
  });

  it("compose.host-kit.yml 的 coordinator environment 區塊內透傳 ENABLE_DEV_ROUTES（未設＝空＝維持開啟）", () => {
    const lines = composeText.split(/\r?\n/);
    const coordinatorIdx = lines.findIndex((line) => /^  coordinator:\s*$/.test(line));
    expect(coordinatorIdx, "compose.host-kit.yml 缺 services.coordinator").toBeGreaterThanOrEqual(0);
    let nextServiceIdx = lines.findIndex((line, index) => index > coordinatorIdx && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
    if (nextServiceIdx < 0) nextServiceIdx = lines.length;
    const block = lines.slice(coordinatorIdx, nextServiceIdx);
    const passthrough = block.filter((line) => line.trim() === "ENABLE_DEV_ROUTES: ${ENABLE_DEV_ROUTES:-}" && !line.trim().startsWith("#"));
    expect(passthrough, "ENABLE_DEV_ROUTES 透傳行必須位於 services.coordinator 區塊且未被註解").toHaveLength(1);
  });

  it(".env.web-plane.host-kit.example（canonical missing-key source）宣告 ENABLE_DEV_ROUTES=（空）與 DEV_AUTH_TOKEN=", () => {
    expectDeclaredOnce(".env.web-plane.host-kit.example", webPlaneExampleText, "ENABLE_DEV_ROUTES", "");
    expectDeclaredOnce(".env.web-plane.host-kit.example", webPlaneExampleText, "DEV_AUTH_TOKEN", "");
  });

  it(".env.web-plane.host-kit.canonical-linux.example 宣告 ENABLE_DEV_ROUTES=false 與 DEV_AUTH_TOKEN=（不放真值）", () => {
    expectDeclaredOnce(".env.web-plane.host-kit.canonical-linux.example", canonicalLinuxExampleText, "ENABLE_DEV_ROUTES", "false");
    expectDeclaredOnce(".env.web-plane.host-kit.canonical-linux.example", canonicalLinuxExampleText, "DEV_AUTH_TOKEN", "");
  });
});
