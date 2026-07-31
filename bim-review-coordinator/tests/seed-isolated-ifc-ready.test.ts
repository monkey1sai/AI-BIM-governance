import { describe, expect, it } from "vitest";
import {
  RESERVED_DEPLOYMENT_PORTS,
  assertIsolatedCoordinatorTarget,
  buildSeedEvidenceRecord,
  buildSeedIntakeFetchInit,
  buildSeedIntakeRequest,
  parseSeedCliArgs,
  resolveSeedEnv,
  selectSeedCandidate,
} from "../src/tools/seedIsolatedIfcReady.js";
import { correlationIdFor, idempotencyKeyFor } from "../src/services/minioWatcher.js";

const KEY_SUFFIX = "/model.ifc";
const REAL_KEY = "東勢區許良宇紀念圖書館/root/main/181b3686-2263-4c53-93d9-ba95a010fc85/model.ifc";
const REAL_ETAG = "\"9f2c4a1b7d3e5f60718293a4b5c6d7e8\"";

describe("assertIsolatedCoordinatorTarget — 隔離 stack 專用，硬擋部署區", () => {
  it("接受 offset 0..4 的隔離 coordinator loopback base", () => {
    for (const port of [8005, 8006, 8007, 8008, 8009]) {
      const url = assertIsolatedCoordinatorTarget(`http://127.0.0.1:${port}`);
      expect(url.port).toBe(String(port));
    }
    expect(assertIsolatedCoordinatorTarget("http://localhost:8005").hostname).toBe("localhost");
  });

  it("拒絕測試部署區 coordinator :8004（本 change 契約禁止連線部署區）", () => {
    expect(() => assertIsolatedCoordinatorTarget("http://127.0.0.1:8004")).toThrow(/8004/);
    expect(RESERVED_DEPLOYMENT_PORTS).toContain(8004);
  });

  it("拒絕部署區 governance :49102 與 Kit primary :49100", () => {
    expect(() => assertIsolatedCoordinatorTarget("http://127.0.0.1:49102")).toThrow(/49102/);
    expect(() => assertIsolatedCoordinatorTarget("http://127.0.0.1:49100")).toThrow(/49100/);
  });

  it("拒絕非 loopback host（防把 seed 打到 LAN 上的真部署）", () => {
    expect(() => assertIsolatedCoordinatorTarget("http://192.168.20.234:8005")).toThrow(/loopback/);
  });

  it("拒絕非 http scheme 與不合法 URL", () => {
    expect(() => assertIsolatedCoordinatorTarget("https://127.0.0.1:8005")).toThrow(/http:/);
    expect(() => assertIsolatedCoordinatorTarget("not-a-url")).toThrow(/URL/);
  });

  it("拒絕未指定 port（避免落到預設 80 而非隔離 stack）", () => {
    expect(() => assertIsolatedCoordinatorTarget("http://127.0.0.1")).toThrow(/port/);
  });
});

describe("selectSeedCandidate — 確定性挑選真實 MinIO 物件", () => {
  const objects = [
    { key: "zzz/root/main/v2/model.ifc", etag: "\"bbb\"" },
    { key: "aaa/root/main/v1/model.ifc", etag: "\"aaa\"" },
    { key: "no-suffix/root/main/v1/other.ifc", etag: "\"ccc\"" },
    { key: "tooshort/model.ifc", etag: "\"ddd\"" },
  ];

  it("以 key 字典序挑第一個可導出的物件（同 bucket 內容 → 同 job，可重現）", () => {
    const first = selectSeedCandidate({ objects, prefix: "", keySuffix: KEY_SUFFIX });
    const again = selectSeedCandidate({ objects: [...objects].reverse(), prefix: "", keySuffix: KEY_SUFFIX });
    expect(first.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(first.candidate.key).toBe("aaa/root/main/v1/model.ifc");
    expect(again.candidate.key).toBe(first.candidate.key);
  });

  it("略過不符 suffix 與段數不足的 key，並回報略過理由計數", () => {
    const result = selectSeedCandidate({ objects, prefix: "", keySuffix: KEY_SUFFIX });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map(s => s.key)).toContain("tooshort/model.ifc");
  });

  it("requiredKey 命中時只用該 key；未命中即 fail closed（不靜默改挑別的）", () => {
    const hit = selectSeedCandidate({
      objects, prefix: "", keySuffix: KEY_SUFFIX, requiredKey: "zzz/root/main/v2/model.ifc",
    });
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.candidate.key).toBe("zzz/root/main/v2/model.ifc");

    const miss = selectSeedCandidate({
      objects, prefix: "", keySuffix: KEY_SUFFIX, requiredKey: "absent/root/main/v1/model.ifc",
    });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason).toMatch(/absent\/root\/main\/v1\/model\.ifc/);
  });

  it("bucket 無任何可導出物件時 fail closed 並附診斷", () => {
    const result = selectSeedCandidate({
      objects: [{ key: "tooshort/model.ifc", etag: "\"d\"" }], prefix: "", keySuffix: KEY_SUFFIX,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/沒有可導出/);
  });

  it("拒絕含 '|' 的 key（與 idempotency hash 分隔符衝突）", () => {
    const result = selectSeedCandidate({
      objects: [{ key: "pipe|proj/root/main/v1/model.ifc", etag: "\"e\"" }], prefix: "", keySuffix: KEY_SUFFIX,
    });
    expect(result.ok).toBe(false);
  });
});

describe("buildSeedIntakeRequest — 與 minioWatcher tick 同構的 intake 契約", () => {
  const built = buildSeedIntakeRequest({
    bucket: "bim-control",
    key: REAL_KEY,
    etag: REAL_ETAG,
    presignedRef: "http://192.168.20.234:9000/bim-control/x?X-Amz-Signature=deadbeef",
    tenantId: "tenant_demo_001",
    prefix: "",
    keySuffix: KEY_SUFFIX,
  });

  it("idempotency / correlation key 與 watcher 完全一致（seed 後 watcher 不會重複進件）", () => {
    expect(built.idempotencyKey).toBe(idempotencyKeyFor("bim-control", REAL_KEY, REAL_ETAG));
    expect(built.correlationId).toBe(correlationIdFor("bim-control", REAL_KEY, REAL_ETAG));
  });

  it("body 欄位與 watcher triggerIntake 同形（含中文專案名 → 安全 project_id）", () => {
    expect(built.body.event).toBe("ifc_ready");
    expect(built.body.tenant_id).toBe("tenant_demo_001");
    expect(built.body.project_display_name).toBe("東勢區許良宇紀念圖書館");
    expect(built.body.project_id).toMatch(/^mv_[0-9a-f]{8}$/);
    expect(built.body.model_category).toBe("main");
    expect(built.body.external_model_version_id).toBe("181b3686-2263-4c53-93d9-ba95a010fc85");
    expect(built.body.external_conversion_task_id).toBe(
      "181b3686-2263-4c53-93d9-ba95a010fc85_mw_9f2c4a1b",
    );
    expect(built.body.requested_outputs).toEqual(["usdc", "element_mapping", "entity_index", "metadata"]);
  });

  it("source_ifc.etag 去引號、ref 帶 presigned URL、filename 為規約檔名", () => {
    expect(built.body.source_ifc.etag).toBe("9f2c4a1b7d3e5f60718293a4b5c6d7e8");
    expect(built.body.source_ifc.filename).toBe("model.ifc");
    expect(built.body.source_ifc.format).toBe("ifc");
    expect(built.body.source_ifc.ref).toContain("X-Amz-Signature");
  });

  it("key 不可導出時 throw（呼叫端應先過 selectSeedCandidate）", () => {
    expect(() => buildSeedIntakeRequest({
      bucket: "bim-control",
      key: "tooshort/model.ifc",
      etag: REAL_ETAG,
      presignedRef: "http://x/y",
      tenantId: "tenant_demo_001",
      prefix: "",
      keySuffix: KEY_SUFFIX,
    })).toThrow();
  });
});

describe("buildSeedIntakeFetchInit — secret-bearing intake transport guard", () => {
  const intake = buildSeedIntakeRequest({
    bucket: "bim-control",
    key: REAL_KEY,
    etag: REAL_ETAG,
    presignedRef: "http://192.168.20.234:9000/bim-control/x?X-Amz-Signature=deadbeef",
    tenantId: "tenant_demo_001",
    prefix: "",
    keySuffix: KEY_SUFFIX,
  });

  it("禁止 redirect 並為同步 intake 設 request timeout，避免 secret／presigned URL 外送或無限等待", () => {
    const init = buildSeedIntakeFetchInit({ intake, webhookSecret: "local-secret", timeoutMs: 605_000 });
    const headers = new Headers(init.headers);

    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get("X-Webhook-Secret")).toBe("local-secret");
    expect(init.body).toContain("X-Amz-Signature");
  });

  it("拒絕停用或無效 timeout", () => {
    expect(() => buildSeedIntakeFetchInit({ intake, webhookSecret: "local-secret", timeoutMs: 0 }))
      .toThrow(/timeout.*正數/);
    expect(() => buildSeedIntakeFetchInit({ intake, webhookSecret: "local-secret", timeoutMs: Number.NaN }))
      .toThrow(/timeout.*正數/);
  });
});

describe("buildSeedEvidenceRecord — 誠實揭露且不外洩簽章/密鑰", () => {
  const record = buildSeedEvidenceRecord({
    changeId: "a4-console-convergence",
    runId: "seed-20260730-000000",
    coordinatorBaseUrl: "http://127.0.0.1:8005",
    bucket: "bim-control",
    endpoint: "http://192.168.20.234:9000",
    key: REAL_KEY,
    etag: REAL_ETAG,
    presignedRef: "http://192.168.20.234:9000/bim-control/x?X-Amz-Signature=deadbeef",
    webhookSecret: "super-secret-value",
    ifcReadyJobId: "ifc_job_123",
    downloadStatus: "downloaded",
    idempotencyKey: idempotencyKeyFor("bim-control", REAL_KEY, REAL_ETAG),
    correlationId: correlationIdFor("bim-control", REAL_KEY, REAL_ETAG),
  });

  it("記錄可對帳的真實來源身分（endpoint/bucket/key/etag/job id）", () => {
    expect(record.schema_version).toBe("a4-isolated-seed-result/v1");
    expect(record.source.endpoint).toBe("http://192.168.20.234:9000");
    expect(record.source.bucket).toBe("bim-control");
    expect(record.source.key).toBe(REAL_KEY);
    expect(record.source.etag).toBe("9f2c4a1b7d3e5f60718293a4b5c6d7e8");
    expect(record.ifc_ready_job_id).toBe("ifc_job_123");
    expect(record.download_status).toBe("downloaded");
    expect(record.source_chain).toBe("real_minio_presigned_intake");
  });

  it("序列化後不得含 presigned 簽章或 webhook secret", () => {
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("super-secret-value");
  });
});

describe("parseSeedCliArgs — wrapper 與手動除錯兩種旗標式", () => {
  const base = [
    "--coordinator-base-url", "http://127.0.0.1:8005",
    "--change-id", "a4-console-convergence",
    "--run-id", "seed-1",
  ];

  it("解析 `--flag value` 與 `--flag=value`", () => {
    const spaced = parseSeedCliArgs([...base, "--required-key", "a/b/c/model.ifc"]);
    expect(spaced.coordinatorBaseUrl).toBe("http://127.0.0.1:8005");
    expect(spaced.requiredKey).toBe("a/b/c/model.ifc");

    const equals = parseSeedCliArgs([
      "--coordinator-base-url=http://127.0.0.1:8006",
      "--change-id=a4-console-convergence",
      "--run-id=seed-2",
      "--env-file=C:/x/.env",
    ]);
    expect(equals.coordinatorBaseUrl).toBe("http://127.0.0.1:8006");
    expect(equals.envFile).toBe("C:/x/.env");
  });

  it("缺任一必要參數即列出全部缺項後 throw", () => {
    expect(() => parseSeedCliArgs(["--run-id", "seed-1"]))
      .toThrow(/--coordinator-base-url.*--change-id/);
  });

  it("未給選用參數時為 undefined，而非空字串", () => {
    const args = parseSeedCliArgs(base);
    expect(args.requiredKey).toBeUndefined();
    expect(args.outPath).toBeUndefined();
    expect(args.envFile).toBeUndefined();
  });
});

describe("resolveSeedEnv — 空字串等同缺漏", () => {
  const complete = {
    MINIO_WATCH_ENDPOINT: "http://192.168.20.234:9000",
    MINIO_WATCH_BUCKET: "bim-control",
    MINIO_WATCH_ACCESS_KEY: "ak",
    MINIO_WATCH_SECRET_KEY: "sk",
  };

  it("補上 prefix／keySuffix／tenant／webhook secret 的預設值", () => {
    const resolved = resolveSeedEnv({ ...complete } as NodeJS.ProcessEnv);
    expect(resolved.prefix).toBe("");
    expect(resolved.keySuffix).toBe("/model.ifc");
    expect(resolved.tenantId).toBe("tenant_demo_001");
    expect(resolved.webhookSecret).toBe("dev-webhook-secret");
  });

  it("宣告但為空值的 MinIO 設定必須當成缺漏（本機 .env 的真實形態）", () => {
    expect(() => resolveSeedEnv({ ...complete, MINIO_WATCH_BUCKET: "" } as NodeJS.ProcessEnv))
      .toThrow(/MINIO_WATCH_BUCKET/);
    expect(() => resolveSeedEnv({ ...complete, MINIO_WATCH_ACCESS_KEY: "" } as NodeJS.ProcessEnv))
      .toThrow(/MINIO_WATCH_ACCESS_KEY/);
  });

  it("錯誤訊息指出 worktree 需要 --env-file（避免重蹈空 bucket 的難解錯誤）", () => {
    expect(() => resolveSeedEnv({} as NodeJS.ProcessEnv)).toThrow(/--env-file/);
  });
});
