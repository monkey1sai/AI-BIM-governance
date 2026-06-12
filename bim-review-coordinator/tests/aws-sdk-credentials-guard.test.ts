import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import * as credentialProviderNode from "@aws-sdk/credential-provider-node";
import clientS3Pkg from "@aws-sdk/client-s3/package.json" with { type: "json" };

/**
 * minio-watch-auto-intake — AWS SDK 顯式 credentials 防護網（IMPORTANT #1）。
 *
 * 背景：本 repo 部署為 LAN MinIO，非 AWS EC2。`@aws-sdk/client-s3` 的預設 credential
 * 解析鏈（`@aws-sdk/credential-provider-node` 的 `defaultProvider()`）會在沒有顯式
 * credentials 時嘗試 IMDS 探測（連線 `http://169.254.169.254/`），在非 EC2 環境會造成
 * 每次 client 建構 ~5s 網路 timeout。因此 watcher（task#3 的 `src/services/minioWatcher.ts`
 * 內 `new S3Client({...})`）MUST 顯式傳入 `credentials: { accessKeyId, secretAccessKey }`。
 *
 * task#2 只新增依賴、不建 watcher，故 watcher 模組尚未存在；此 guard 鎖的是「依賴層的
 * 行為契約」，與 minioWatcher.ts 無耦合：
 *   1. 顯式 credentials 被原樣、同步、快速地解析（不落入 default provider chain）。
 *      斷言 resolved 值恰為顯式輸入：default chain 在乾淨環境下永不會回傳這組哨兵值，
 *      故此等式即「未誤用預設 credential chain」的充分證據。
 *   2. 文件化「為何此約束重要」——預設鏈確實來自 credential-provider-node（IMDS 來源），
 *      若未來該依賴消失或語意改變，本測試會紅，提醒重新評估 task#3 的約束基礎。
 *
 * 註：不用 `vi.spyOn(credentialProviderNode, "defaultProvider")` —— 該 ESM export 的
 * property descriptor `configurable:false`，spyOn 會以 "Cannot redefine property" 失敗。
 * 改以「乾淨環境 + 哨兵值等式」做 ESM-safe 的等效驗證。
 */
describe("AWS SDK 顯式 credentials guard（IMPORTANT #1）", () => {
  const AWS_CRED_ENV = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
];
  const savedEnv = new Map<string, string | undefined>();

  // 隔離 ambient AWS env：否則 default chain 可能從 env 撈到值，讓哨兵等式失去鑑別力。
  beforeEach(() => {
    for (const k of AWS_CRED_ENV) {
      savedEnv.set(k, process.env[k]);
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of AWS_CRED_ENV) {
      const v = savedEnv.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    savedEnv.clear();
  });

  it("顯式 credentials 被原樣、同步解析（不落入 default provider chain / IMDS）", async () => {
    const client = new S3Client({
      region: "us-east-1",
      endpoint: "http://127.0.0.1:9000",
      forcePathStyle: true,
      credentials: { accessKeyId: "AK_GUARD_SENTINEL", secretAccessKey: "SK_GUARD_SENTINEL" },
    });

    // config.credentials 是 provider function；解析後須恰為顯式傳入的哨兵值。
    expect(typeof client.config.credentials).toBe("function");

    // 同步快速解析：default chain 走 IMDS 在非 EC2 會 ~5s timeout；此處限 1s 內必須完成。
    const start = Date.now();
    const resolved = await client.config.credentials();
    const elapsedMs = Date.now() - start;

    expect(resolved.accessKeyId).toBe("AK_GUARD_SENTINEL");
    expect(resolved.secretAccessKey).toBe("SK_GUARD_SENTINEL");
    expect(elapsedMs).toBeLessThan(1000);

    client.destroy();
  });

  it("文件化約束基礎：client-s3 預設鏈依賴 credential-provider-node（IMDS 來源）", () => {
    // 若這層斷言變紅，代表 task#3 的「必須顯式傳 credentials」約束失去 IMDS 風險前提，
    // 需重新評估本 guard 是否仍必要。
    const deps = (clientS3Pkg as { dependencies?: Record<string, string> }).dependencies ?? {};
    expect(deps["@aws-sdk/credential-provider-node"]).toBeTruthy();
    expect(typeof credentialProviderNode.defaultProvider).toBe("function");
  });
});
