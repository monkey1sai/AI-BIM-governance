import crypto from "node:crypto";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertLocatorConsistent,
  isUtcTimestamp,
  locatorDiagnostics,
  parseMinioRef,
  utcTimestampToMicros,
  utcTimestampToMillis,
} from "../../src/services/lineage/minioLocator.js";
import {
  assertManifestObjectKey,
  assertRefAllowed,
  buildMinioRef,
  createS3SourceBundleObjectPort,
  parseGovernedPrefix,
  resolveAllowedRef,
  SourceBundleAccessDeniedError,
  SourceBundleObjectTooLargeError,
  SourceBundlePrefixError,
  SourceBundleWriteResponseError,
  SourceBundleWriteScopeError,
  versionPrefixesFromObjects,
} from "../../src/services/lineage/sourceBundleObjectPort.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import { TEST_ALLOWLIST, TEST_AUTHORITY, TEST_BUCKET } from "../helpers/governedBundleFixtures.js";

// port 契約與 D-3 allowlist。真 S3 adapter 驗兩類：
//   (1) 不需要網路的（建構、carve-out key gate、allowlist、prefix 解析）；
//   (2) conditional create 的 wire 行為——用 loopback 上的 S3 stub 驗
//       `If-None-Match: *` 有真的送出、412 → conflict、200 → created。
// ListObjectVersions 的分頁與 XML 解析屬 adapter implementation，不在此重演。

let port: FakeSourceBundleObjectPort;
let s3Stub: http.Server | null = null;

interface StubReply {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/** loopback S3 stub（比照 `tests/lineage/legacy-intake-unaffected.ts` 的 startS3Stub 慣例）。 */
async function startS3Stub(
  respond: (request: http.IncomingMessage) => StubReply,
): Promise<string> {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const reply = respond(request);
      response.writeHead(reply.status, {
        "Content-Type": "application/xml",
        ...(reply.headers ?? {}),
      });
      response.end(reply.body ?? "");
    });
  });
  s3Stub = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("s3 stub bind failed");
  // 綁 port 0 由 OS 配發：測試絕不打固定埠，否則會撞到本機正在跑的部署區。
  return `http://127.0.0.1:${address.port}`;
}

function s3ErrorXml(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message><Resource>/</Resource><RequestId>test</RequestId></Error>`;
}

beforeEach(() => {
  port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
});

afterEach(async () => {
  if (s3Stub) {
    s3Stub.closeAllConnections?.();
    const server = s3Stub;
    s3Stub = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("minioLocator", () => {
  it("解析合法 governed locator 的四個分量", () => {
    const parsed = parseMinioRef(
      "minio://edge-test-01/source-bundles-test/a/b/model.ifc?versionId=v-1",
    );
    expect(parsed).toEqual({
      authority: "edge-test-01",
      bucket: "source-bundles-test",
      objectKey: "a/b/model.ifc",
      versionId: "v-1",
    });
  });

  it("presign 參數（大小寫皆擋）→ presigned_locator_forbidden", () => {
    for (const ref of [
      "minio://a/b/k?X-Amz-Signature=x",
      "minio://a/b/k?versionId=v-1&x-amz-expires=60",
    ]) {
      expect(parseMinioRef(ref)).toEqual({ error: "presigned_locator_forbidden" });
    }
  });

  it("缺 ?versionId= → unversioned_locator；其餘不符 pattern → malformed", () => {
    expect(parseMinioRef("minio://a/b/k")).toEqual({ error: "unversioned_locator" });
    expect(parseMinioRef("s3://a/b/k?versionId=v-1")).toEqual({ error: "malformed" });
    expect(parseMinioRef("minio://a/b/k?versionId=v-1#frag")).toEqual({ error: "malformed" });
  });

  it("拒絕帶結尾換行的 ref（README §2 的缺口封口）", () => {
    expect(parseMinioRef("minio://a/b/k?versionId=v-1\n")).toEqual({ error: "malformed" });
  });

  it("assertLocatorConsistent 依序回第一個違規", () => {
    const base = {
      ref: "minio://a/b/k?versionId=v-1",
      object_version_id: "v-1",
      etag: "e",
      sha256: "0".repeat(64),
      size_bytes: 10,
    };
    expect(assertLocatorConsistent(base)).toBeNull();
    expect(assertLocatorConsistent({ ...base, object_version_id: "v-2" })).toBe(
      "unversioned_locator",
    );
    expect(assertLocatorConsistent({ ...base, size_bytes: 0 })).toBe("artifact_incomplete");
    expect(assertLocatorConsistent({ ...base, ref: "not-a-locator" })).toBe(
      "semantic_contract_violation",
    );
  });

  it("locatorDiagnostics 對同一個 locator 可同時吐 unversioned + incomplete", () => {
    const codes = locatorDiagnostics(
      {
        ref: "minio://a/b/k?versionId=v-1",
        object_version_id: "v-2",
        etag: "e",
        sha256: "0".repeat(64),
        size_bytes: 0,
      },
      "source_ifc",
    ).map((d) => d.code);
    expect(codes).toEqual(["unversioned_locator", "artifact_incomplete"]);
  });

  it("isUtcTimestamp 擋 calendar-invalid、offset、小寫 z 與結尾換行", () => {
    expect(isUtcTimestamp("2026-07-16T07:58:12.500Z")).toBe(true);
    expect(isUtcTimestamp("2026-02-30T09:19:30.000Z")).toBe(false);
    expect(isUtcTimestamp("2026-07-16T07:58:12+08:00")).toBe(false);
    expect(isUtcTimestamp("2026-07-16T07:58:12z")).toBe(false);
    expect(isUtcTimestamp("2026-07-16T07:58:12Z\n")).toBe(false);
    expect(isUtcTimestamp("2024-02-29T00:00:00Z")).toBe(true);
    expect(isUtcTimestamp("2026-02-29T00:00:00Z")).toBe(false);
  });

  it("時間當 instant 比，不比字串", () => {
    expect(utcTimestampToMillis("2026-07-16T07:58:12Z")).toBe(
      utcTimestampToMillis("2026-07-16T07:58:12.000Z"),
    );
    expect(utcTimestampToMicros("2026-07-16T07:58:12.000001Z")).toBe(
      utcTimestampToMicros("2026-07-16T07:58:12.000000Z") + 1n,
    );
  });
});

describe("allowlist fail-closed（D-3）", () => {
  it("空 allowlist 代表全關", () => {
    expect(() =>
      assertRefAllowed(
        { authority: "a", bucket: "b" },
        { allowedAuthorities: [], allowedBuckets: [] },
      ),
    ).toThrow(SourceBundleAccessDeniedError);
  });

  it("authority 與 bucket 分別開槍，訊息指名是哪一項", () => {
    const allow = { allowedAuthorities: ["a"], allowedBuckets: ["b"] };
    expect(() => assertRefAllowed({ authority: "x", bucket: "b" }, allow)).toThrow(/authority/);
    expect(() => assertRefAllowed({ authority: "a", bucket: "y" }, allow)).toThrow(/bucket/);
    expect(() => assertRefAllowed({ authority: "a", bucket: "b" }, allow)).not.toThrow();
  });

  it("resolveAllowedRef：解析失敗回 null，allowlist 拒絕拋錯（兩種失敗不可混為一談）", () => {
    expect(resolveAllowedRef("not-a-locator", TEST_ALLOWLIST)).toBeNull();
    expect(() =>
      resolveAllowedRef(`minio://other/${TEST_BUCKET}/k?versionId=v-1`, TEST_ALLOWLIST),
    ).toThrow(SourceBundleAccessDeniedError);
    expect(
      resolveAllowedRef(`minio://${TEST_AUTHORITY}/${TEST_BUCKET}/k?versionId=v-1`, TEST_ALLOWLIST),
    ).toEqual({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "k",
      versionId: "v-1",
    });
  });
});

describe("parseGovernedPrefix / versionPrefixesFromObjects", () => {
  it("要求 authority/bucket 具名的 minio:// 前綴（裸 key prefix fail closed）", () => {
    expect(parseGovernedPrefix("minio://a/b/some/prefix")).toEqual({
      authority: "a",
      bucket: "b",
      keyPrefix: "some/prefix",
    });
    expect(parseGovernedPrefix("minio://a/b")).toEqual({
      authority: "a",
      bucket: "b",
      keyPrefix: "",
    });
    expect(() => parseGovernedPrefix("some/prefix")).toThrow(SourceBundlePrefixError);
    expect(() => parseGovernedPrefix("minio://a/b/x\n")).toThrow(SourceBundlePrefixError);
  });

  it("只把直接含 manifest.json 的目錄當 version prefix，排序去重", () => {
    const prefixes = versionPrefixesFromObjects([
      {
        ref: "",
        authority: "a",
        bucket: "b",
        objectKey: "root/p2/v1/manifest.json",
        versionId: "v",
        etag: "e",
        sizeBytes: 1,
      },
      {
        ref: "",
        authority: "a",
        bucket: "b",
        objectKey: "root/p1/v1/manifest.json",
        versionId: "v",
        etag: "e",
        sizeBytes: 1,
      },
      {
        ref: "",
        authority: "a",
        bucket: "b",
        objectKey: "root/p1/v1/model.ifc",
        versionId: "v",
        etag: "e",
        sizeBytes: 1,
      },
    ]);
    expect(prefixes).toEqual([
      "minio://a/b/root/p1/v1/",
      "minio://a/b/root/p2/v1/",
    ]);
  });

  it("buildMinioRef 與 parseMinioRef 互為逆運算", () => {
    const parts = { authority: "a", bucket: "b", objectKey: "x/y.ifc", versionId: "v-1" };
    expect(parseMinioRef(buildMinioRef(parts))).toEqual(parts);
  });
});

describe("fake port（測試 seam）", () => {
  it("headVersioned 找不到回 null，不拋錯", async () => {
    const ref = { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "nope", versionId: "v" };
    expect(await port.headVersioned(ref)).toBeNull();
  });

  it("sha256Versioned 回真實 bytes 的 digest", async () => {
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "k",
      versionId: "v-1",
      bytes: "hello governed bundle",
    });
    const expected = crypto
      .createHash("sha256")
      .update(Buffer.from("hello governed bundle", "utf-8"))
      .digest("hex");
    expect(
      await port.sha256Versioned({
        authority: TEST_AUTHORITY,
        bucket: TEST_BUCKET,
        objectKey: "k",
        versionId: "v-1",
      }),
    ).toBe(expected);
  });

  it("getBytesVersioned 超過 maxBytes → fail closed，不截斷", async () => {
    port.seed({
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "big",
      versionId: "v-1",
      bytes: "0123456789",
    });
    const ref = {
      authority: TEST_AUTHORITY,
      bucket: TEST_BUCKET,
      objectKey: "big",
      versionId: "v-1",
    };
    await expect(port.getBytesVersioned(ref, 4)).rejects.toBeInstanceOf(
      SourceBundleObjectTooLargeError,
    );
    expect((await port.getBytesVersioned(ref, 10)).toString("utf-8")).toBe("0123456789");
  });

  it("putIfAbsent 是 conditional create：已存在就衝突，絕不覆寫", async () => {
    const ref = { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "m/manifest.json" };
    const first = await port.putIfAbsent(ref, Buffer.from("{}"), "application/json");
    expect(first.outcome).toBe("created");
    if (first.outcome === "created") {
      expect(first.versionId).not.toBe("");
      expect(first.etag).not.toBe("");
    }
    const second = await port.putIfAbsent(ref, Buffer.from('{"other":1}'), "application/json");
    expect(second.outcome).toBe("conflict_existing_manifest");
    const stored = port.objects.find((o) => o.objectKey === "m/manifest.json");
    expect(stored?.bytes.toString("utf-8")).toBe("{}");
  });

  it("fake 也吃同一份 carve-out key gate（兩個 adapter 共用同一條規則）", async () => {
    await expect(
      port.putIfAbsent(
        { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "m/model.ifc" },
        Buffer.from("{}"),
        "application/json",
      ),
    ).rejects.toBeInstanceOf(SourceBundleWriteScopeError);
    expect(port.objects).toHaveLength(0);
  });

  it("每次讀寫都經過同一份 production allowlist gate", async () => {
    const closed = createFakeSourceBundleObjectPort({
      allowedAuthorities: [],
      allowedBuckets: [],
    });
    await expect(
      closed.headVersioned({ authority: "a", bucket: "b", objectKey: "k", versionId: "v" }),
    ).rejects.toBeInstanceOf(SourceBundleAccessDeniedError);
  });
});

describe("carve-out key gate（assertManifestObjectKey）", () => {
  it("只放行以 /manifest.json 結尾的 object key", () => {
    expect(() => assertManifestObjectKey("a/b/v1/manifest.json")).not.toThrow();
    for (const key of [
      "a/b/v1/model.ifc",
      "a/b/v1/manifest.json.bak",
      "manifest.json", // 裸檔名：governed manifest 一定住在 version prefix 之下
      "a/b/v1/MANIFEST.JSON", // 大小寫不同就是不同的 key
      "",
    ]) {
      expect(() => assertManifestObjectKey(key)).toThrow(SourceBundleWriteScopeError);
    }
  });
});

describe("真 S3 adapter — 不需網路即可驗的契約", () => {
  it("非 manifest.json 的 key 在發出請求前就被 carve-out gate 擋下", async () => {
    // endpoint 指向必定不可達的 port 9：若 gate 沒擋，這裡會變成連線錯誤而不是 scope 錯誤。
    const s3 = createS3SourceBundleObjectPort({
      endpoint: "http://127.0.0.1:9",
      accessKey: "test-access",
      secretKey: "test-secret",
      allowedAuthorities: [TEST_AUTHORITY],
      allowedBuckets: [TEST_BUCKET],
    });
    try {
      await expect(
        s3.putIfAbsent(
          { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "m/v1/model.rvt" },
          Buffer.from("bytes"),
          "application/octet-stream",
        ),
      ).rejects.toMatchObject({
        name: "SourceBundleWriteScopeError",
        code: "source_bundle_write_scope_violation",
      });
      // allowlist 仍先於 key gate 開槍：寫入面不得比讀取面寬。
      await expect(
        s3.putIfAbsent(
          { authority: "not-allowlisted", bucket: TEST_BUCKET, objectKey: "m/v1/manifest.json" },
          Buffer.from("{}"),
          "application/json",
        ),
      ).rejects.toBeInstanceOf(SourceBundleAccessDeniedError);
    } finally {
      await s3.destroy();
    }
  });

  it("allowlist 在發出任何請求前就拒絕（不需要可達的 endpoint）", async () => {
    const s3 = createS3SourceBundleObjectPort({
      endpoint: "http://127.0.0.1:9",
      accessKey: "test-access",
      secretKey: "test-secret",
      allowedAuthorities: [TEST_AUTHORITY],
      allowedBuckets: [TEST_BUCKET],
    });
    try {
      await expect(
        s3.headVersioned({
          authority: "not-allowlisted",
          bucket: TEST_BUCKET,
          objectKey: "k",
          versionId: "v",
        }),
      ).rejects.toBeInstanceOf(SourceBundleAccessDeniedError);
      await expect(s3.listObjectsUnder("minio://not-allowlisted/x/y")).rejects.toBeInstanceOf(
        SourceBundleAccessDeniedError,
      );
      await expect(s3.listObjectsUnder("bare/prefix")).rejects.toBeInstanceOf(
        SourceBundlePrefixError,
      );
    } finally {
      await s3.destroy();
    }
  });
});

describe("真 S3 adapter — conditional create 的 wire 行為（loopback stub）", () => {
  const MANIFEST_KEY = "governed/tenant/version/manifest.json";

  function portFor(endpoint: string) {
    return createS3SourceBundleObjectPort({
      endpoint,
      accessKey: "test-access",
      secretKey: "test-secret",
      allowedAuthorities: [TEST_AUTHORITY],
      allowedBuckets: [TEST_BUCKET],
    });
  }

  it("送出 If-None-Match: *，200 → created（帶 versionId/etag）", async () => {
    const seen: Array<{ method?: string; url?: string; ifNoneMatch?: string }> = [];
    const endpoint = await startS3Stub((request) => {
      seen.push({
        method: request.method,
        url: request.url,
        ifNoneMatch: request.headers["if-none-match"] as string | undefined,
      });
      return {
        status: 200,
        headers: { ETag: '"etag-created-0001"', "x-amz-version-id": "v-created-0001" },
      };
    });
    const s3 = portFor(endpoint);
    try {
      const outcome = await s3.putIfAbsent(
        { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: MANIFEST_KEY },
        Buffer.from('{"ok":true}'),
        "application/json",
      );
      expect(outcome).toEqual({
        outcome: "created",
        versionId: "v-created-0001",
        // ETag 的引號在 port 層剝掉（與 head/list 同一個 stripEtagQuotes）。
        etag: "etag-created-0001",
      });
    } finally {
      await s3.destroy();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("PUT");
    // forcePathStyle：bucket 在 path 上，不是 vhost。
    //（SDK 會附一個 `?x-id=PutObject` 查詢參數，故比前綴而不是全等。）
    expect(seen[0].url?.startsWith(`/${TEST_BUCKET}/${MANIFEST_KEY}`)).toBe(true);
    // conditional create 的關鍵證據：header 真的送出去了，不是只寫在註解裡。
    expect(seen[0].ifNoneMatch).toBe("*");
  });

  it("412 Precondition Failed → conflict_existing_manifest（不是錯誤、也不重試成覆寫）", async () => {
    let requests = 0;
    const endpoint = await startS3Stub(() => {
      requests += 1;
      return {
        status: 412,
        body: s3ErrorXml(
          "PreconditionFailed",
          "At least one of the pre-conditions you specified did not hold",
        ),
      };
    });
    const s3 = portFor(endpoint);
    try {
      const outcome = await s3.putIfAbsent(
        { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: MANIFEST_KEY },
        Buffer.from('{"ok":true}'),
        "application/json",
      );
      expect(outcome).toEqual({ outcome: "conflict_existing_manifest" });
    } finally {
      await s3.destroy();
    }
    // 412 不是可重試錯誤：adapter 不得在收到衝突後再打一次（那就有覆寫風險）。
    expect(requests).toBe(1);
  });

  it("其他 4xx/5xx 照常 propagate（不被誤讀成 conflict）", async () => {
    const endpoint = await startS3Stub(() => ({
      status: 403,
      body: s3ErrorXml("AccessDenied", "Access Denied"),
    }));
    const s3 = portFor(endpoint);
    try {
      await expect(
        s3.putIfAbsent(
          { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: MANIFEST_KEY },
          Buffer.from("{}"),
          "application/json",
        ),
      ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
    } finally {
      await s3.destroy();
    }
  });

  it("bucket 沒開 versioning（回應缺 x-amz-version-id）→ fail closed，不偽造 locator", async () => {
    const endpoint = await startS3Stub(() => ({
      status: 200,
      headers: { ETag: '"etag-created-0002"' },
    }));
    const s3 = portFor(endpoint);
    try {
      await expect(
        s3.putIfAbsent(
          { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: MANIFEST_KEY },
          Buffer.from("{}"),
          "application/json",
        ),
      ).rejects.toBeInstanceOf(SourceBundleWriteResponseError);
    } finally {
      await s3.destroy();
    }
  });
});
