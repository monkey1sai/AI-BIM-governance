import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertLocatorConsistent,
  isUtcTimestamp,
  locatorDiagnostics,
  parseMinioRef,
  utcTimestampToMillis,
} from "../../src/services/lineage/minioLocator.js";
import {
  assertRefAllowed,
  buildMinioRef,
  createS3SourceBundleObjectPort,
  parseGovernedPrefix,
  resolveAllowedRef,
  SourceBundleAccessDeniedError,
  SourceBundleObjectTooLargeError,
  SourceBundlePrefixError,
  SourceBundleWriteNotPermittedError,
  versionPrefixesFromObjects,
} from "../../src/services/lineage/sourceBundleObjectPort.js";
import {
  createFakeSourceBundleObjectPort,
  type FakeSourceBundleObjectPort,
} from "../helpers/fakeSourceBundleObjectPort.js";
import { TEST_ALLOWLIST, TEST_AUTHORITY, TEST_BUCKET } from "../helpers/governedBundleFixtures.js";

// port 契約與 D-3 allowlist。真 S3 adapter 只驗**不需要網路**的那幾條
// （建構、寫入拒絕、allowlist、prefix 解析）；分頁與 XML 解析屬 adapter
// implementation，不在此重演。

let port: FakeSourceBundleObjectPort;

beforeEach(() => {
  port = createFakeSourceBundleObjectPort(TEST_ALLOWLIST);
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
    const second = await port.putIfAbsent(ref, Buffer.from('{"other":1}'), "application/json");
    expect(second.outcome).toBe("conflict_existing_manifest");
    const stored = port.objects.find((o) => o.objectKey === "m/manifest.json");
    expect(stored?.bytes.toString("utf-8")).toBe("{}");
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

describe("真 S3 adapter — 不需網路即可驗的契約", () => {
  it("putIfAbsent 一律拒絕：coordinator 尚未取得 MinIO 寫入 carve-out（D-4）", async () => {
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
          { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "m/manifest.json" },
          Buffer.from("{}"),
          "application/json",
        ),
      ).rejects.toMatchObject({
        name: "SourceBundleWriteNotPermittedError",
        code: "source_bundle_write_awaiting_owner_carve_out",
        httpStatus: 501,
      });
      await expect(
        s3.putIfAbsent(
          { authority: TEST_AUTHORITY, bucket: TEST_BUCKET, objectKey: "m/manifest.json" },
          Buffer.from("{}"),
          "application/json",
        ),
      ).rejects.toBeInstanceOf(SourceBundleWriteNotPermittedError);
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
