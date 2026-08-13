// 遮蔽 presigned URL 的簽章 query（X-Amz-*）。只留 origin+pathname，簽章/憑證/過期不外洩。
// 誠實鐵律：對外 response 不得含 presigned 簽章。非 URL 或無簽章參數者原樣返回。
export function maskPresignedRef(ref: string): string {
  if (!ref) return ref;
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return ref; // 非 URL（如 devstorage:filename）原樣
  }
  let hasSignature = false;
  for (const k of url.searchParams.keys()) {
    if (k.toLowerCase().startsWith("x-amz-")) {
      hasSignature = true;
      break;
    }
  }
  if (!hasSignature) return ref;
  return `${url.origin}${url.pathname}`;
}

/**
 * Stable object identity for retry comparison. Only recognized signing query
 * parameters are renewable capabilities. Ordinary query parameters can select
 * the underlying object (for example, `/download?key=model.ifc`) and therefore
 * remain part of the identity. URL fragments are not sent to the server.
 * Non-HTTP refs keep exact-string semantics.
 */
export function stableHttpRefIdentity(ref: string): string {
  if (!ref) return ref;
  try {
    const url = new URL(ref);
    if (url.protocol !== "http:" && url.protocol !== "https:") return ref;
    const keys = Array.from(url.searchParams.keys());
    const lowerKeys = keys.map((key) => key.toLowerCase());
    const hasSigV4 = lowerKeys.some((key) => key.startsWith("x-amz-"));
    const hasSigV2 =
      lowerKeys.includes("signature") &&
      (lowerKeys.includes("awsaccesskeyid") || lowerKeys.includes("expires"));

    for (const key of keys) {
      const lower = key.toLowerCase();
      if (
        (hasSigV4 && lower.startsWith("x-amz-")) ||
        (hasSigV2 && ["awsaccesskeyid", "signature", "expires"].includes(lower))
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    const stableQuery = url.searchParams.toString();
    return `${url.origin}${url.pathname}${stableQuery ? `?${stableQuery}` : ""}`;
  } catch {
    return ref;
  }
}
