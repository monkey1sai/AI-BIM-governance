import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

/**
 * CONVERSION_TRIGGER_IP_ALLOWLIST（D2＝T2，owner 裁決 2026-09-02）的 deploy-time parity guard，
 * 沿用 env-example-dev-routes-parity.test.ts（task 4.4）的模式。
 *
 * 背景（2026-09-02 canonical-linux 實測）：`POST /api/conversion/trigger` 對 LAN 來源恆回
 * 403 `caller ip not in allowlist`。根因是 compose 從未透傳任何 allowlist ——容器內 env 只來自
 * compose `environment:`（.env 不掛入容器、image 不烤 .env），dockerized coordinator 恆用
 * config.ts 的程式碼預設 ["127.0.0.1","::1","172.16.0.0/12"]，owner 在私有 env 設值也無管道生效。
 *
 * 修復走 spec 的 T2 選項而非放寬共用變數：spec unified-console-runtime-truth 明定
 * 「SHALL NOT 放寬 EXTERNAL_INTAKE_IP_ALLOWLIST 或任何 /api/external/* webhook 授權面」，
 * 故新增獨立 CONVERSION_TRIGGER_IP_ALLOWLIST 只作用於四條 conversion 控制路由
 * （trigger／prioritize／retry／watch），未設時沿用既有 external allowlist 判定（預設等於既有行為）。
 *
 * 落點必須是 compose.runtime-manager.yml（不是 compose.host-kit.yml）：coordinator 的基底服務定義在此，
 * 且 scripts/start-runtime-manager-docker.ps1 只載這一支；scripts/deploy.ps1 與
 * scripts/start-web-plane-docker.ps1 則是 runtime-manager 疊 host-kit，兩條路徑都被本落點涵蓋。
 *
 * 本 guard 釘住六件事：
 *   (1) config.ts 恰有一個 CONVERSION_TRIGGER_IP_ALLOWLIST 讀取點；
 *   (2) compose.runtime-manager.yml 的 services.coordinator 區塊內有未被註解的透傳行；
 *   (3) compose **不得**透傳 EXTERNAL_INTAKE_IP_ALLOWLIST（webhook 授權面不放寬——spec SHALL NOT）；
 *   (4) 未設／空字串／全空白 CSV 時為 null（沿用既有 external 判定），絕不解析成空清單造成 fail-open；
 *   (5) external 預設清單含 loopback（MINIO_WATCH_ENABLED=true 的 assertIntakeReachable 前提）；
 *   (6) 設值時 CSV 解析並去空白。
 * 真值（canonical-linux 的實際 LAN CIDR）只存在 owner 私有 env；本測試不讀任何私有 env。
 */
describe("CONVERSION_TRIGGER_IP_ALLOWLIST deploy-time parity（IMPORTANT — compose passthrough safety net）", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.join(here, "..", "..");
  const read = (...parts: string[]): string => readFileSync(path.join(...parts), "utf8");
  const configSrc = read(here, "..", "src", "config.ts");
  const composeText = read(repoRoot, "compose.runtime-manager.yml");

  const ENV_KEY = "CONVERSION_TRIGGER_IP_ALLOWLIST";
  const EXTERNAL_KEY = "EXTERNAL_INTAKE_IP_ALLOWLIST";
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  function coordinatorBlock(): string[] {
    const lines = composeText.split(/\r?\n/);
    const coordinatorIdx = lines.findIndex((line) => /^ {2}coordinator:\s*$/.test(line));
    expect(coordinatorIdx, "compose.runtime-manager.yml 缺 services.coordinator").toBeGreaterThanOrEqual(0);
    let nextServiceIdx = lines.findIndex((line, index) => index > coordinatorIdx && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
    if (nextServiceIdx < 0) nextServiceIdx = lines.length;
    return lines.slice(coordinatorIdx, nextServiceIdx);
  }

  it("config.ts 恰有一個 CONVERSION_TRIGGER_IP_ALLOWLIST 讀取點", () => {
    expect(configSrc.match(new RegExp(`"${ENV_KEY}"`, "g"))).toHaveLength(1);
  });

  it("compose.runtime-manager.yml 的 coordinator environment 區塊內透傳 CONVERSION_TRIGGER_IP_ALLOWLIST", () => {
    const passthrough = coordinatorBlock().filter(
      (line) => line.trim() === `${ENV_KEY}: \${${ENV_KEY}:-}` && !line.trim().startsWith("#"),
    );
    expect(
      passthrough,
      `${ENV_KEY} 透傳行必須位於 compose.runtime-manager.yml 的 services.coordinator 區塊且未被註解；` +
        "缺此行時 dockerized coordinator 收不到私有 env 的值，LAN 來源對 conversion 控制路由恆 403。",
    ).toHaveLength(1);
  });

  it("compose 不得透傳 EXTERNAL_INTAKE_IP_ALLOWLIST（spec：SHALL NOT 放寬 webhook 授權面）", () => {
    const widened = coordinatorBlock().filter(
      (line) => !line.trim().startsWith("#") && line.includes(`${EXTERNAL_KEY}:`),
    );
    expect(
      widened,
      "共用 EXTERNAL_INTAKE_IP_ALLOWLIST 同時守 /api/external/ifc-ready webhook 進件面與 lineage 路由；" +
        "spec unified-console-runtime-truth 明定 SHALL NOT 放寬。LAN 放寬只能走 CONVERSION_TRIGGER_IP_ALLOWLIST。",
    ).toHaveLength(0);
  });

  it("未設／空字串／全空白 CSV → null（沿用既有 external 判定），絕不為空清單（fail-open）", () => {
    delete process.env[ENV_KEY];
    expect(loadConfig().conversionTriggerIpAllowlist).toBeNull();

    process.env[ENV_KEY] = "";
    expect(loadConfig().conversionTriggerIpAllowlist, "compose `${VAR:-}` 未設時解析為空字串").toBeNull();

    process.env[ENV_KEY] = " , ,  ";
    expect(
      loadConfig().conversionTriggerIpAllowlist,
      "全空白 CSV 若解析成空清單，guard 的「空清單＝未啟用 IP 守門」語意會變成 fail-open；必須回 null。",
    ).toBeNull();
  });

  it("external 預設清單含 loopback（否則 MINIO_WATCH_ENABLED=true 會 assertIntakeReachable fail-fast）", () => {
    delete process.env[ENV_KEY];
    const config = loadConfig();
    expect(config.externalIntakeIpAllowlist).toContain("127.0.0.1");
    expect(config.externalIntakeIpAllowlist).toContain("::1");
  });

  it("設值時以 CSV 解析並去除空白（owner 私有 env 的真值路徑）", () => {
    process.env[ENV_KEY] = "127.0.0.1, ::1 ,192.0.2.0/24";
    const config = loadConfig();
    expect(config.conversionTriggerIpAllowlist).toEqual(["127.0.0.1", "::1", "192.0.2.0/24"]);
  });
});
