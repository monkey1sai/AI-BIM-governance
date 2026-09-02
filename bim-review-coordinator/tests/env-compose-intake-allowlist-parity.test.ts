import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

/**
 * EXTERNAL_INTAKE_IP_ALLOWLIST 的 deploy-time parity guard，沿用 env-example-dev-routes-parity.test.ts
 * （task 4.4）的模式。
 *
 * 背景（2026-09-02 canonical-linux 實測）：`POST /api/conversion/trigger` 對 LAN 來源恆回
 * 403 `caller ip not in allowlist`。根因不是私有 env 設錯，而是 compose 從未透傳
 * EXTERNAL_INTAKE_IP_ALLOWLIST —— 容器內 env 只來自 compose `environment:`（.env 不掛入容器、
 * image 不烤 .env），所以 dockerized coordinator 恆用 config.ts 的程式碼預設
 * ["127.0.0.1","::1","172.16.0.0/12"]（loopback ＋ docker bridge），owner 在私有 env 設值也無管道生效。
 *
 * 落點必須是 compose.runtime-manager.yml（不是 compose.host-kit.yml）：coordinator 的基底服務定義在此，
 * 且 scripts/start-runtime-manager-docker.ps1 只載這一支；scripts/deploy.ps1 與
 * scripts/start-web-plane-docker.ps1 則是 runtime-manager 疊 host-kit，兩條路徑都被本落點涵蓋。
 *
 * 本 guard 釘住四件事：
 *   (1) config.ts 恰有一個 EXTERNAL_INTAKE_IP_ALLOWLIST 讀取點；
 *   (2) compose.runtime-manager.yml 的 services.coordinator 區塊內有未被註解的透傳行；
 *   (3) 透傳為空字串時回退程式碼預設（不是「空清單＝全放行」）——這是本透傳可安全加入的前提；
 *   (4) 預設值含 loopback，否則 MINIO_WATCH_ENABLED=true 時 app.ts 的 assertIntakeReachable 會啟動 fail-fast。
 * 真值（canonical-linux 的實際 LAN CIDR）只存在 owner 私有 env；本測試不讀任何私有 env。
 */
describe("EXTERNAL_INTAKE_IP_ALLOWLIST deploy-time parity（IMPORTANT — compose passthrough safety net）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(here, "..", "..");
  const read = (...parts: string[]): string => readFileSync(path.join(...parts), "utf8");
  const configSrc = read(here, "..", "src", "config.ts");
  const composeText = read(repoRoot, "compose.runtime-manager.yml");

  const ENV_KEY = "EXTERNAL_INTAKE_IP_ALLOWLIST";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("config.ts 恰有一個 EXTERNAL_INTAKE_IP_ALLOWLIST 讀取點", () => {
    expect(configSrc.match(new RegExp(`"${ENV_KEY}"`, "g"))).toHaveLength(1);
  });

  it("compose.runtime-manager.yml 的 coordinator environment 區塊內透傳 EXTERNAL_INTAKE_IP_ALLOWLIST", () => {
    const lines = composeText.split(/\r?\n/);
    const coordinatorIdx = lines.findIndex((line) => /^ {2}coordinator:\s*$/.test(line));
    expect(coordinatorIdx, "compose.runtime-manager.yml 缺 services.coordinator").toBeGreaterThanOrEqual(0);
    let nextServiceIdx = lines.findIndex((line, index) => index > coordinatorIdx && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
    if (nextServiceIdx < 0) nextServiceIdx = lines.length;
    const block = lines.slice(coordinatorIdx, nextServiceIdx);
    const passthrough = block.filter(
      (line) => line.trim() === `${ENV_KEY}: \${${ENV_KEY}:-}` && !line.trim().startsWith("#"),
    );
    expect(
      passthrough,
      `${ENV_KEY} 透傳行必須位於 compose.runtime-manager.yml 的 services.coordinator 區塊且未被註解；` +
        "缺此行時 dockerized coordinator 收不到私有 env 的值，LAN 來源對 conversion 控制路由恆 403。",
    ).toHaveLength(1);
  });

  it("未設值（compose 解析為空字串）時回退程式碼預設，不是空清單全放行", () => {
    process.env[ENV_KEY] = "";
    const config = loadConfig();
    expect(
      config.externalIntakeIpAllowlist,
      "空字串必須回退預設清單；若變成空陣列會關閉 IP 守門（fail-open），本透傳即不可加入。",
    ).toEqual(["127.0.0.1", "::1", "172.16.0.0/12"]);
  });

  it("預設清單含 loopback（否則 MINIO_WATCH_ENABLED=true 會 assertIntakeReachable fail-fast）", () => {
    delete process.env[ENV_KEY];
    const config = loadConfig();
    expect(config.externalIntakeIpAllowlist).toContain("127.0.0.1");
    expect(config.externalIntakeIpAllowlist).toContain("::1");
  });

  it("設值時以 CSV 解析並去除空白（owner 私有 env 的真值路徑）", () => {
    process.env[ENV_KEY] = "127.0.0.1, ::1 ,192.0.2.0/24";
    const config = loadConfig();
    expect(config.externalIntakeIpAllowlist).toEqual(["127.0.0.1", "::1", "192.0.2.0/24"]);
  });
});
